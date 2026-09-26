import { getDb } from "@/lib/db";
import { processRequest } from "@/lib/engine";
import { Memory, TRUST_MIN, TRUST_MIN_CASES, type Recall } from "@/lib/memory";
import { latestHarness } from "@/lib/runner";
import { actionFor, initialHarness, NODES, type Answer, type Facts, type NodeName, type Request as Alert } from "@/lib/workload";

export const dynamic = "force-dynamic";

// Sandbox: send ONE alert through the real engine (memory, Jev, routing checks, the LLM where
// needed) and return every stage. Read-only: it never writes to MongoDB.

const enabled = () => process.env.ALLOW_RUN === "1" || process.env.ALLOW_SANDBOX === "1";
const DISABLED = "The sandbox is turned off on this deployment. Set ALLOW_SANDBOX=1 to enable it.";
const MAX_CHARS = 1000;
const LIMIT = 10; // runs per IP per minute (per server instance); each run can call the LLM
const hits = new Map<string, number[]>();
let busy = false;

function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > LIMIT;
}

const DEFAULT_FACTS: Facts = { asset_criticality: "low", user_privileged: false, threat_intel_match: false, off_hours: false, repeated_today: false };

// Custom alerts: accept only the known fact fields, with the right types.
function cleanFacts(raw: unknown): Facts {
  const f = (typeof raw === "object" && raw ? raw : {}) as Record<string, unknown>;
  const bool = (k: keyof Facts) => (typeof f[k] === "boolean" ? (f[k] as boolean) : (DEFAULT_FACTS[k] as boolean));
  return {
    asset_criticality: f.asset_criticality === "high" ? "high" : "low",
    user_privileged: bool("user_privileged"),
    threat_intel_match: bool("threat_intel_match"),
    off_hours: bool("off_hours"),
    repeated_today: bool("repeated_today"),
  };
}

export async function GET() {
  if (!enabled()) return Response.json({ enabled: false, message: DISABLED, samples: [] });
  const db = await getDb();
  const pick = (batch: Alert["batch"]) =>
    db.collection<Alert>("requests").find({ batch }, { projection: { _id: 0, seq: 1, batch: 1, text: 1, facts: 1 } }).sort({ seq: 1 }).limit(4).toArray();
  const [base, campaign] = await Promise.all([pick("base"), pick("campaign")]);
  return Response.json({ enabled: true, samples: [...base, ...campaign] });
}

export async function POST(req: Request) {
  if (!enabled()) return Response.json({ error: DISABLED }, { status: 403 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (limited(ip)) return Response.json({ error: "Too many runs, try again in a minute." }, { status: 429 });
  if (busy) return Response.json({ error: "Another alert is running through the agent. Try again in a moment." }, { status: 409 });
  busy = true;
  try {
    const body = await req.json().catch(() => ({}));
    const db = await getDb();

    // The alert: a seeded one (has hidden labels) or a custom one (no labels).
    let alert: Alert;
    const seeded = typeof body.seq === "number";
    if (seeded) {
      const found = await db.collection<Alert>("requests").findOne({ seq: body.seq }, { projection: { _id: 0 } });
      if (!found) return Response.json({ error: `No sample alert #${body.seq}.` }, { status: 404 });
      alert = found;
    } else {
      const text = String(body.text ?? "").trim().slice(0, MAX_CHARS);
      if (!text) return Response.json({ error: "Write an alert first." }, { status: 400 });
      alert = { seq: -1, batch: "base", text, facts: cleanFacts(body.facts), truth: {} as Alert["truth"] };
    }

    const h = (await latestHarness()) ?? initialHarness();
    const run = await db.collection("runs").find().sort({ started_at: -1 }).limit(1).next();
    const memory = run ? await Memory.forRun(run._id) : null;
    const noMemory: Recall = { available: false, top: null, novel: false, trust: {}, neighbors: [], hits: [], novel_below: null };
    // A seeded alert is already in memory from the recorded run: leave its own record out.
    const recall = (text: string) => (memory ? memory.recall(text, seeded ? { exclude: alert.seq } : {}) : Promise.resolve(noMemory));

    const res = await processRequest(alert, h, recall, { audit: false });

    const neighborDocs = run && res.recall.hits.length
      ? await db.collection("experience").find({ run_id: run._id, seq: { $in: res.recall.hits.map((x) => x.seq) } }, { projection: { _id: 0, seq: 1, text: 1 } }).toArray()
      : [];
    const textOf = new Map(neighborDocs.map((d) => [d.seq as number, d.text as string]));
    const finals = Object.fromEntries(res.decisions.map((d) => [d.node, d.final])) as Partial<Record<NodeName, Answer>>;

    return Response.json({
      alert: { seq: alert.seq, batch: alert.batch, text: alert.text, facts: alert.facts, ...(seeded ? { truth: alert.truth } : {}) },
      harness: {
        version: h.version,
        nodes: Object.fromEntries(
          NODES.map((n) => [n, { mode: h.nodes[n].mode, confidence_floor: h.nodes[n].thresholds.confidence_floor, context: h.nodes[n].context, question: h.nodes[n].question }]),
        ),
      },
      memory: {
        available: res.recall.available,
        experiences: memory?.experiences ?? 0,
        top: res.recall.top,
        novel: res.recall.novel,
        novel_below: res.recall.novel_below,
        trust: res.recall.trust,
        neighbors: res.recall.hits.map((x) => ({ ...x, text: textOf.get(x.seq) ?? "" })),
        rules: { trust_min: TRUST_MIN, trust_min_cases: TRUST_MIN_CASES },
      },
      trace: res.trace,
      decisions: res.decisions.map((d) => ({
        node: d.node,
        mode: d.mode,
        used: d.used,
        reason: d.fallback_reason ?? null,
        s1: d.s1 ?? null,
        s2: d.s2 ?? null,
        final: d.final,
        agree: d.agree ?? null,
        ...(seeded ? { correct: d.correct } : {}),
      })),
      action: actionFor(finals),
      totals: { ms: res.ms, cost: res.cost },
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  } finally {
    busy = false;
  }
}
