import { ObjectId } from "mongodb";
import { getDb } from "./db";
import { processRequest, type RequestResult } from "./engine";
import { rewriteQuestion, type Example } from "./evolve";
import { Graduator, type Change } from "./graduate";
import { ensureVectorIndex, Memory } from "./memory";
import { actionFor, initialHarness, NODES, type Answer, type Harness, type NodeName, type Request } from "./workload";

export type RunOptions = {
  limit?: number;
  concurrency?: number;
  arrivalsPerSec?: number; // alerts arrive at a fixed rate; a slow agent builds a queue
  reset?: boolean;
  log?: (msg: string) => void;
};

const MAX_REWRITES_PER_NODE = 2;

export async function latestHarness(): Promise<Harness | null> {
  const db = await getDb();
  return db.collection<Harness>("harness_versions").find().sort({ version: -1 }).limit(1).next();
}

export async function resetAll() {
  const db = await getDb();
  await Promise.all(
    ["decisions", "results", "events", "harness_versions", "runs", "experience"].map((c) => db.collection(c).deleteMany({})),
  );
  await db.collection("harness_versions").insertOne(initialHarness());
  await db.collection("decisions").createIndex({ run_id: 1, node: 1, seq: -1 });
  await db.collection("results").createIndex({ run_id: 1, seq: 1 });
}

export async function runSurge(opts: RunOptions = {}) {
  const { concurrency = 6, arrivalsPerSec = 3, log = console.log } = opts;
  const db = await getDb();
  if (opts.reset || !(await latestHarness())) await resetAll();
  await ensureVectorIndex(log);

  let h = (await latestHarness())!;
  const requests = await db.collection<Request>("requests").find().sort({ seq: 1 }).limit(opts.limit ?? 10_000).toArray();
  const run_id = new ObjectId();
  const memory = new Memory(run_id, log);
  const startedAt = Date.now();
  await db.collection("runs").insertOne({ _id: run_id, status: "running", started_at: new Date(), total: requests.length, processed: 0 });
  log(`Run ${run_id}: ${requests.length} alerts, ${arrivalsPerSec}/s arrivals, concurrency ${concurrency}`);

  const g = new Graduator();
  const rewrites = Object.fromEntries(NODES.map((n) => [n, 0])) as Record<NodeName, number>;
  let processed = 0;
  let lastSeq = 0;
  let lastNovelEventSeq = -100;
  const pending = new Set<Promise<unknown>>();

  // Serialize harness changes so versions stay linear.
  let lock = Promise.resolve();
  const withLock = (fn: () => Promise<void>) => (lock = lock.then(fn).catch((e) => log(`change failed: ${e.message}`)));

  async function newVersion(mutate: (nh: Harness) => void, reason: string) {
    const nh = structuredClone(h) as Harness;
    delete nh._id;
    mutate(nh);
    nh.parent_version = h.version;
    nh.version = h.version + 1;
    nh.reason = reason;
    nh.created_at = new Date();
    await db.collection("harness_versions").insertOne(nh);
    h = nh;
  }

  async function event(type: string, node: NodeName | null, detail: string, extra: Record<string, unknown> = {}) {
    await db.collection("events").insertOne({ run_id, type, node, detail, version: h.version, seq: lastSeq, ts: new Date(), ...extra });
    log(`[v${h.version}] ${type.toUpperCase()} ${node ?? ""}: ${detail}`);
  }

  async function rewrite(node: NodeName, why: string) {
    if (rewrites[node] >= MAX_REWRITES_PER_NODE) return;
    rewrites[node]++;
    g.busy.add(node);
    try {
      if (h.nodes[node].mode === "reflex") {
        await newVersion((nh) => void (nh.nodes[node].mode = "shadow"), `Demoted ${node}: ${why}`);
        await event("demote", node, why);
      }
      // Recent problem cases, plus the Vector Search cluster around the newest one.
      const recent = await db
        .collection("decisions")
        .find({ run_id, node, $or: [{ agree: false }, { used: "fallback" }, { suggestion: { $exists: true, $ne: null } }] })
        .sort({ seq: -1 })
        .limit(10)
        .toArray();
      const cluster = recent[0] ? await memory.similarSeqs(recent[0].text, 12) : [];
      const clustered = cluster.length
        ? await db.collection("decisions").find({ run_id, node, seq: { $in: cluster } }).toArray()
        : [];
      const seen = new Set<number>();
      const examples: Example[] = [...recent, ...clustered]
        .filter((d) => (seen.has(d.seq) ? false : (seen.add(d.seq), true)))
        .map((d) => ({ text: d.text, s1: d.s1?.answer, confidence: d.s1?.confidence, s2: d.s2, suggestion: d.suggestion }));

      const before = { question: h.nodes[node].question, context: h.nodes[node].context };
      const { question, context, reason } = await rewriteQuestion(node, h.nodes[node], examples, why);
      await newVersion((nh) => {
        nh.nodes[node].question = question;
        nh.nodes[node].context = context;
        nh.nodes[node].mode = "shadow";
      }, `Rewrote ${node}: ${reason}`);
      g.reset(node, h.version);
      await event("rewrite", node, reason, { before, after: { question, context }, cluster_size: clustered.length });
    } finally {
      g.busy.delete(node);
    }
  }

  function apply(c: Change) {
    return withLock(async () => {
      const mode = h.nodes[c.node].mode;
      if (c.type === "promote" && mode === "shadow") {
        const floor = c.floor; // self-tuned from calibration data by the graduator
        await newVersion((nh) => {
          nh.nodes[c.node].mode = "reflex";
          nh.nodes[c.node].thresholds.confidence_floor = floor;
        }, `Promoted ${c.node} to reflex: ${c.detail}`);
        await event("promote", c.node, c.detail);
      } else if (c.type === "demote" && mode === "reflex") {
        await newVersion((nh) => void (nh.nodes[c.node].mode = "shadow"), `Demoted ${c.node}: ${c.detail}`);
        g.reset(c.node, h.version);
        await event("demote", c.node, c.detail);
        void withLock(() => rewrite(c.node, `Demoted after drift: ${c.detail}`));
      } else if (c.type === "rewrite") {
        await rewrite(c.node, c.detail);
      }
    });
  }

  // Arrivals: alert i arrives at i / arrivalsPerSec seconds after start.
  const queue = requests.map((r, i) => ({ r, arrives: startedAt + (i * 1000) / arrivalsPerSec }));
  let outOfCredit = false;
  async function worker() {
    while (queue.length && !outOfCredit) {
      const item = queue.shift()!;
      const wait = item.arrives - Date.now();
      if (wait > 0) await new Promise((res) => setTimeout(res, wait));
      const started = Date.now();
      const backlog = queue.filter((q) => q.arrives <= started).length;
      let res: RequestResult | null = null;
      for (let attempt = 0; attempt < 2 && !res; attempt++) {
        try {
          res = await processRequest(item.r, h, (t) => memory.recall(t));
        } catch (e) {
          const msg = (e as Error).message;
          log(`seq ${item.r.seq} failed: ${msg.slice(0, 200)}`);
          if (/credits|402/i.test(msg)) {
            outOfCredit = true; // stop cleanly and keep everything recorded so far
            log("Out of OpenRouter credit: stopping the run.");
            break;
          }
        }
      }
      if (!res) continue;
      lastSeq = Math.max(lastSeq, res.seq);
      const finals = Object.fromEntries(res.decisions.map((d) => [d.node, d.final])) as Partial<Record<NodeName, Answer>>;
      const agree = Object.fromEntries(res.decisions.filter((d) => d.agree !== undefined).map((d) => [d.node, d.agree]));
      // Writes are off the decision path: the alert is already triaged when they start.
      const writes = Promise.all([db.collection("results").insertOne({
        run_id,
        seq: res.seq,
        batch: res.batch,
        ms: res.ms,
        wait_ms: started - item.arrives,
        total_ms: started - item.arrives + res.ms,
        backlog,
        cost: res.cost,
        correct: res.decisions.filter((d) => d.correct).length / res.decisions.length,
        reflex_share: res.decisions.filter((d) => d.used === "reflex").length / res.decisions.length,
        recall_top: res.recall.top,
        novel: res.recall.novel,
        action: actionFor(finals),
        harness_version: res.harness_version,
        ts: res.ts,
      }),
        db.collection("decisions").insertMany(res.decisions.map((d) => ({ ...d, run_id, text: item.r.text }))),
        memory.remember(res.seq, item.r.text, agree),
        db.collection("runs").updateOne({ _id: run_id }, { $set: { processed: ++processed } }),
      ]).catch((e) => log(`write failed for #${res.seq}: ${e.message}`));
      pending.add(writes);
      void writes.finally(() => pending.delete(writes));

      if (res.recall.novel && res.seq - lastNovelEventSeq > 10) {
        lastNovelEventSeq = res.seq;
        void event("novel", null, `alert unlike anything in memory (closest match ${res.recall.top?.toFixed(2)}); reflexes handed it to System 2`, { alert: item.r.text });
      }
      for (const c of g.observe(res, h)) void apply(c);

      // Async audit: when System 2's second opinion arrives, record it and let the graduator judge.
      if (res.audit) {
        const seq = res.seq;
        const version = res.harness_version;
        const done = res.audit
          .then(async ({ updates, cost }) => {
            await writes;
            // Audits are real spend: add their cost to the alert so cost-per-1,000 stays honest.
            await db.collection("results").updateOne({ run_id, seq }, { $inc: { cost }, $set: { audited: true } });
            await Promise.all(
              updates.map((u) =>
                db.collection("decisions").updateOne(
                  { run_id, seq, node: u.node },
                  { $set: { s2: u.s2, agree: u.agree, audited: true, ...(u.suggestion ? { suggestion: u.suggestion } : {}) } },
                ),
              ),
            );
            await db.collection("experience").updateOne(
              { run_id, seq },
              { $set: Object.fromEntries(updates.map((u) => [`agree.${u.node}`, u.agree])) },
            );
            const late = updates.map((u) => ({ node: u.node, s2: u.s2, agree: u.agree, suggestion: u.suggestion, audited: true, used: "reflex" as const }));
            for (const c of g.observe({ decisions: late as never, harness_version: version }, h, true)) void apply(c);
          })
          .catch((e) => log(`audit failed for #${seq}: ${e.message}`));
        pending.add(done);
        void done.finally(() => pending.delete(done));
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  // Drain audits and harness changes (a change can queue another, e.g. demote then rewrite).
  for (let i = 0; i < 5; i++) {
    while (pending.size) await Promise.all([...pending]);
    await lock;
  }
  await db.collection("runs").updateOne({ _id: run_id }, { $set: { status: "done", finished_at: new Date() } });
  log(`Run done: ${processed} processed, final harness v${h.version}`);
  log(NODES.map((n) => `${n}=${h.nodes[n].mode}`).join("  "));
  return run_id;
}
