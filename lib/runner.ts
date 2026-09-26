import { ObjectId } from "mongodb";
import { getDb } from "./db";
import { processRequest, type RequestResult } from "./engine";
import { rewriteQuestion, type Example } from "./evolve";
import { Graduator, type Change } from "./graduate";
import { initialHarness, NODES, type Harness, type NodeName, type Request } from "./workload";

export type RunOptions = {
  limit?: number;
  concurrency?: number;
  arrivalsPerSec?: number; // customers arrive at a fixed rate; a slow agent builds a queue
  reset?: boolean;
  log?: (msg: string) => void;
};

export async function latestHarness(): Promise<Harness | null> {
  const db = await getDb();
  return db.collection<Harness>("harness_versions").find().sort({ version: -1 }).limit(1).next();
}

export async function resetAll() {
  const db = await getDb();
  await Promise.all(["decisions", "results", "events", "harness_versions", "runs"].map((c) => db.collection(c).deleteMany({})));
  await db.collection("harness_versions").insertOne(initialHarness());
  await db.collection("decisions").createIndex({ run_id: 1, node: 1, seq: -1 });
  await db.collection("results").createIndex({ run_id: 1, seq: 1 });
}

export async function runSurge(opts: RunOptions = {}) {
  const { concurrency = 6, arrivalsPerSec = 3, log = console.log } = opts;
  const db = await getDb();
  if (opts.reset || !(await latestHarness())) await resetAll();

  let h = (await latestHarness())!;
  const requests = await db
    .collection<Request>("requests")
    .find()
    .sort({ seq: 1 })
    .limit(opts.limit ?? 10_000)
    .toArray();
  const run_id = new ObjectId();
  const startedAt = Date.now();
  await db.collection("runs").insertOne({ _id: run_id, status: "running", started_at: new Date(), total: requests.length, processed: 0 });
  log(`Run ${run_id}: ${requests.length} requests, ${arrivalsPerSec}/s arrivals, concurrency ${concurrency}`);

  const g = new Graduator();
  let processed = 0;
  let lastSeq = 0;

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
    return nh;
  }

  async function event(type: string, node: NodeName, detail: string, extra: Record<string, unknown> = {}) {
    await db.collection("events").insertOne({ run_id, type, node, detail, version: h.version, seq: lastSeq, ts: new Date(), ...extra });
    log(`[v${h.version}] ${type.toUpperCase()} ${node}: ${detail}`);
  }

  async function rewrite(node: NodeName, why: string) {
    g.busy.add(node);
    try {
      const rows = await db
        .collection("decisions")
        .find({ run_id, node, $or: [{ agree: false }, { used: "fallback" }] })
        .sort({ seq: -1 })
        .limit(15)
        .toArray();
      const examples: Example[] = rows.map((d) => ({
        text: d.text,
        s1: d.s1?.answer,
        confidence: d.s1?.confidence,
        s2: d.s2,
        suggestion: d.suggestion,
      }));
      const before = h.nodes[node].question;
      const { question, reason } = await rewriteQuestion(node, h.nodes[node], examples, why);
      await newVersion((nh) => {
        nh.nodes[node].question = question;
        nh.nodes[node].mode = "shadow";
      }, `Rewrote ${node}: ${reason}`);
      g.reset(node, h.version);
      await event("rewrite", node, reason, { before, after: question });
    } finally {
      g.busy.delete(node);
    }
  }

  function apply(c: Change) {
    return withLock(async () => {
      const mode = h.nodes[c.node].mode;
      if (c.type === "promote" && mode === "shadow") {
        await newVersion((nh) => void (nh.nodes[c.node].mode = "reflex"), `Promoted ${c.node} to reflex: ${c.detail}`);
        await event("promote", c.node, c.detail);
      } else if (c.type === "demote" && mode === "reflex") {
        await newVersion((nh) => void (nh.nodes[c.node].mode = "shadow"), `Demoted ${c.node}: ${c.detail}`);
        g.reset(c.node, h.version);
        await event("demote", c.node, c.detail);
        void withLock(() => rewrite(c.node, `Demoted after drift: ${c.detail}`));
      } else if (c.type === "rewrite" && mode === "shadow") {
        await rewrite(c.node, c.detail);
      }
    });
  }

  // Arrivals: request i arrives at i / arrivalsPerSec seconds after start.
  const queue = requests.map((r, i) => ({ r, arrives: startedAt + (i * 1000) / arrivalsPerSec }));
  async function worker() {
    while (queue.length) {
      const item = queue.shift()!;
      const wait = item.arrives - Date.now();
      if (wait > 0) await new Promise((res) => setTimeout(res, wait));
      const started = Date.now();
      const backlog = queue.filter((q) => q.arrives <= started).length;
      let res: RequestResult | null = null;
      for (let attempt = 0; attempt < 2 && !res; attempt++) {
        try {
          res = await processRequest(item.r, h);
        } catch (e) {
          log(`seq ${item.r.seq} failed: ${(e as Error).message}`);
        }
      }
      if (!res) continue;
      lastSeq = Math.max(lastSeq, res.seq);
      const correct = res.decisions.filter((d) => d.correct).length / res.decisions.length;
      const reflexShare = res.decisions.filter((d) => d.used === "reflex").length / res.decisions.length;
      await db.collection("results").insertOne({
        run_id,
        seq: res.seq,
        batch: res.batch,
        ms: res.ms,
        wait_ms: started - item.arrives,
        total_ms: Date.now() - item.arrives,
        backlog,
        cost: res.cost,
        correct,
        reflex_share: reflexShare,
        harness_version: res.harness_version,
        ts: res.ts,
      });
      await db.collection("decisions").insertMany(res.decisions.map((d) => ({ ...d, run_id, text: item.r.text })));
      await db.collection("runs").updateOne({ _id: run_id }, { $set: { processed: ++processed } });
      for (const c of g.observe(res, h)) void apply(c);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  await lock;
  await db.collection("runs").updateOne({ _id: run_id }, { $set: { status: "done", finished_at: new Date() } });
  log(`Run done: ${processed} processed, final harness v${h.version}`);
  log(NODES.map((n) => `${n}=${h.nodes[n].mode}`).join("  "));
  return run_id;
}
