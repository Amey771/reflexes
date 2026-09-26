import { getDb } from "./db";
import { runSystem1 } from "./engine";
import { VECTOR_INDEX } from "./memory";
import { actionFor, NODE_LABEL, NODES, type Answer, type Facts, type Harness, type NodeName, type Request } from "./workload";

// "Try it": triage one pasted alert with the harness the system has learned so far.
// Uses Jev (System 1) and Atlas Vector Search over the live experience memory.
// It never calls the LLM: decisions that would need it are reported as such (costs ~$0.00004 per try).

const NOVEL_PERCENTILE = 0.05;
const TRUST_MIN = 0.5;
const TRUST_MIN_CASES = 3;

export type TriageDecision = {
  node: NodeName;
  label: string;
  answer: Answer;
  confidence: number;
  floor: number;
  route: "reflex" | "llm_learning" | "handed_back";
  reason: string;
};

export type TriageResult = {
  ms: number;
  cost: number;
  harness_version: number;
  novel: boolean;
  top: number | null;
  decisions: TriageDecision[];
  neighbors: { seq: number; text: string; score: number }[];
  action: string | null; // the agent's action, if every decision was a reflex
};

const DEFAULT_FACTS: Facts = {
  asset_criticality: "low",
  user_privileged: false,
  threat_intel_match: false,
  off_hours: false,
  repeated_today: false,
};

// Public input: accept only the known fact keys with the right types, nothing else.
function cleanFacts(raw: unknown): Facts {
  const f = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bool = (k: keyof Facts) => (typeof f[k] === "boolean" ? (f[k] as boolean) : (DEFAULT_FACTS[k] as boolean));
  return {
    asset_criticality: f.asset_criticality === "high" ? "high" : "low",
    user_privileged: bool("user_privileged"),
    threat_intel_match: bool("threat_intel_match"),
    off_hours: bool("off_hours"),
    repeated_today: bool("repeated_today"),
  };
}

export async function triageAlert(input: { text: string; facts?: Partial<Facts> }): Promise<TriageResult> {
  const t0 = performance.now();
  const text = input.text.trim().slice(0, 4000);
  if (!text) throw new Error("alert text is required");
  const db = await getDb();
  const h = (await db.collection<Harness>("harness_versions").find().sort({ version: -1 }).limit(1).next())!;
  const run = await db.collection("runs").find().sort({ started_at: -1 }).limit(1).next();
  const req: Request = { seq: -1, batch: "base", text, facts: cleanFacts(input.facts), truth: {} as Request["truth"] };

  const all = NODES.map((n) => [n, h.nodes[n]] as const);
  const [s1, hits, tops] = await Promise.all([
    runSystem1(req, all.map(([n, c]) => [n, c])),
    db
      .collection("experience")
      .aggregate([
        { $vectorSearch: { index: VECTOR_INDEX, path: "text", query: text, limit: 5, numCandidates: 100, ...(run ? { filter: { run_id: run._id } } : {}) } },
        { $project: { _id: 0, seq: 1, text: 1, agree: 1, score: { $meta: "vectorSearchScore" } } },
      ])
      .toArray(),
    run
      ? db.collection("results").find({ run_id: run._id, recall_top: { $ne: null } }).project({ _id: 0, recall_top: 1 }).toArray()
      : Promise.resolve([]),
  ]);

  // Novel = closest past alert is less similar than the 5th percentile of the run's own recalls.
  const top: number | null = hits[0]?.score ?? null;
  const sorted = tops.map((r) => r.recall_top as number).sort((a, b) => a - b);
  const threshold = sorted.length ? sorted[Math.floor(NOVEL_PERCENTILE * sorted.length)] : -Infinity;
  const novel = top !== null && top < threshold;

  const decisions: TriageDecision[] = all.map(([n, c]) => {
    const a = s1.answers[n]!;
    const base = { node: n, label: NODE_LABEL[n], answer: a.answer, confidence: a.confidence, floor: c.thresholds.confidence_floor };
    if (c.mode === "shadow") return { ...base, route: "llm_learning", reason: "Still learning this decision: the LLM decides." };
    if (a.confidence < c.thresholds.confidence_floor)
      return { ...base, route: "handed_back", reason: `Not confident enough (${a.confidence.toFixed(2)} < ${c.thresholds.confidence_floor.toFixed(2)}): the LLM decides.` };
    if (novel) return { ...base, route: "handed_back", reason: "Unlike anything in memory: the LLM decides." };
    const flags = hits.map((x) => x.agree?.[n]).filter((v): v is boolean => typeof v === "boolean");
    if (flags.length >= TRUST_MIN_CASES && flags.filter(Boolean).length / flags.length < TRUST_MIN)
      return { ...base, route: "handed_back", reason: "Not proven on similar past alerts: the LLM decides." };
    return { ...base, route: "reflex", reason: `Reflex: confident (${a.confidence.toFixed(2)}) and proven on similar alerts.` };
  });

  const allReflex = decisions.every((d) => d.route === "reflex");
  return {
    ms: Math.round(performance.now() - t0),
    cost: s1.cost,
    harness_version: h.version,
    novel,
    top,
    decisions,
    neighbors: hits.slice(0, 3).map((x) => ({ seq: x.seq, text: x.text, score: x.score })),
    action: allReflex ? actionFor(Object.fromEntries(decisions.map((d) => [d.node, d.answer]))) : null,
  };
}
