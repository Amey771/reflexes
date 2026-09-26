import { askJev, type JevAnswer, type JevQuestion } from "./jev";
import { untrusted, type Recall } from "./memory";
import { askSystem2, type System2Result } from "./system2";
import { isCorrect, NODES, stateFor, type Answer, type Harness, type NodeConfig, type NodeName, type Request } from "./workload";

export type S1 = { answer: Answer; confidence: number };

export type Decision = {
  seq: number;
  node: NodeName;
  harness_version: number;
  mode: "shadow" | "reflex";
  used: "system2" | "reflex" | "fallback"; // who actually decided
  fallback_reason?: "low_confidence" | "novel" | "unproven_here";
  s1?: S1;
  s2?: Answer;
  suggestion?: string;
  final: Answer;
  agree?: boolean; // s1 vs s2, when both ran
  correct: boolean; // vs ground truth (reporting only; the engine never sees it)
  audited: boolean;
};

export type RequestResult = {
  seq: number;
  batch: Request["batch"];
  recall: Pick<Recall, "available" | "top" | "novel" | "neighbors">;
  ms: number;
  cost: number;
  decisions: Decision[];
  harness_version: number;
  ts: Date;
};

// Convert a Jev answer into the node's answer space plus a confidence in [0.5, 1].
export function readS1(q: JevQuestion, a: JevAnswer): S1 {
  if (a.type === "noul") return { answer: a.noul >= 0.5, confidence: Math.max(a.noul, 1 - a.noul) };
  if (a.type === "choice") return { answer: a.choice, confidence: a.confidence };
  // score: pick the most probable level; keys may be level indices or level labels
  const levels = q.type === "score" ? q.criteria : [];
  let best = Math.round(a.score);
  let bestP = -1;
  for (const [k, p] of Object.entries(a.probabilities ?? {})) {
    const idx = /^\d+$/.test(k) ? Number(k) : levels.indexOf(k);
    if (idx >= 0 && p > bestP) [best, bestP] = [idx, p];
  }
  return { answer: best, confidence: a.confidence };
}

export function same(a: Answer | undefined, b: Answer | undefined) {
  return a !== undefined && b !== undefined && a === b;
}

// Group nodes that share a context policy so each group is one Jev call (all in parallel).
async function runSystem1(req: Request, nodes: [NodeName, NodeConfig][]) {
  const groups = new Map<string, [NodeName, NodeConfig][]>();
  for (const n of nodes) {
    const key = n[1].context.join(",");
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const results = await Promise.all(
    [...groups.values()].map((g) =>
      askJev(stateFor(req, g[0][1].context), Object.fromEntries(g.map(([n, c]) => [n, c.question]))),
    ),
  );
  const answers: Partial<Record<NodeName, S1>> = {};
  let cost = 0;
  let ms = 0;
  results.forEach((r, i) => {
    cost += r.cost;
    ms = Math.max(ms, r.ms);
    for (const [n, c] of [...groups.values()][i]) answers[n] = readS1(c.question, r.answers[n]);
  });
  return { answers, cost, ms };
}

export async function processRequest(
  req: Request,
  h: Harness,
  recall: (text: string) => Promise<Recall>,
): Promise<RequestResult> {
  const t0 = performance.now();
  const all = NODES.map((n) => [n, h.nodes[n]] as [NodeName, NodeConfig]);
  const audited = new Set(
    all.filter(([, c]) => c.mode === "reflex" && Math.random() < c.thresholds.audit_rate).map(([n]) => n),
  );
  // System 2 starts right away for shadow and audited nodes; System 1 and memory recall always run.
  const s2First = all.filter(([n, c]) => c.mode === "shadow" || audited.has(n));
  const s2Promise: Promise<System2Result | null> = s2First.length ? askSystem2(req, s2First) : Promise.resolve(null);
  const [s1, mem] = await Promise.all([runSystem1(req, all), recall(req.text)]);

  // A reflex falls back to System 2 when Jev isn't confident, when the alert is unlike anything
  // in memory, or when this reflex hasn't proven itself on similar past alerts.
  const reason = new Map<NodeName, NonNullable<Decision["fallback_reason"]>>();
  for (const [n, c] of all) {
    if (c.mode !== "reflex" || audited.has(n)) continue;
    if ((s1.answers[n]?.confidence ?? 0) < c.thresholds.confidence_floor) reason.set(n, "low_confidence");
    else if (mem.novel) reason.set(n, "novel");
    else if (untrusted(mem, n)) reason.set(n, "unproven_here");
  }
  const fallback = all.filter(([n]) => reason.has(n));
  const [s2a, s2b] = await Promise.all([
    s2Promise,
    fallback.length ? askSystem2(req, fallback) : Promise.resolve(null),
  ]);
  const s2Answers = { ...s2a?.answers, ...s2b?.answers };
  const suggestions = { ...s2a?.suggestions, ...s2b?.suggestions };

  const decisions: Decision[] = all.map(([n, c]) => {
    const a1 = s1.answers[n];
    const a2 = s2Answers[n];
    const used: Decision["used"] = c.mode === "shadow" ? "system2" : reason.has(n) ? "fallback" : "reflex";
    const final = (used === "reflex" ? a1?.answer : a2) as Answer;
    return {
      seq: req.seq,
      node: n,
      harness_version: h.version,
      mode: c.mode,
      used,
      fallback_reason: reason.get(n),
      s1: a1,
      s2: a2,
      suggestion: suggestions[n],
      final,
      agree: a1 && a2 !== undefined ? same(a1.answer, a2) : undefined,
      correct: isCorrect(n, final, req),
      audited: audited.has(n),
    };
  });

  return {
    seq: req.seq,
    batch: req.batch,
    recall: { available: mem.available, top: mem.top, novel: mem.novel, neighbors: mem.neighbors },
    ms: Math.round(performance.now() - t0),
    cost: s1.cost + (s2a?.cost ?? 0) + (s2b?.cost ?? 0),
    decisions,
    harness_version: h.version,
    ts: new Date(),
  };
}
