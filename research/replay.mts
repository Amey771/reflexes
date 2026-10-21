/** Synthetic stress harness, NOT an LLM performance benchmark. No network or credentials. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ReflexController } from "../packages/core/dist/index.js";
import type { Answer, Context, Prediction, Route } from "../packages/core/dist/index.js";

export function rng(seed: number) {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export type Scenario = "stable" | "sudden" | "gradual" | "novelty" | "teacher_shift";
export type Policy = "teacher_only" | "fast_only" | "confidence_only" | "no_audits" | "fixed_audits" | "adaptive_audits";
export type Frame = { seq: number; truth: Answer; fast: Prediction; teacher: Answer; context: Context; fastMs: number; teacherMs: number; fastCost: number; teacherCost: number };
export const SHIFT_AT = 1000;
const FAST_COST = 1, TEACHER_COST = 20, AUDIT_DELAY = 8;
export function stream(seed: number, scenario: Scenario, size = 2400): Frame[] {
  const random = rng(seed);
  return Array.from({ length: size }, (_, seq) => {
    const shifted = seq >= SHIFT_AT, hard = random() < 0.2;
    let error = hard ? 0.12 : 0.001;
    if (shifted && (scenario === "sudden" || scenario === "novelty")) error = hard ? 0.35 : 0.25;
    if (shifted && scenario === "gradual") error += 0.25 * Math.min(1, (seq - SHIFT_AT) / 800);
    const truth = `class_${Math.floor(random() * 4)}`;
    const wrong = `class_${(Number(truth.slice(-1)) + 1) % 4}`;
    const fast = { answer: random() < error ? wrong : truth, confidence: hard ? 0.55 : 0.95 };
    const teacher = random() < (shifted && scenario === "teacher_shift" ? 0.2 : 0.002) ? wrong : truth;
    const context: Context = { risk: random() < 0.05 ? "high" : "low", memoryAvailable: random() >= 0.02,
      familiar: !(shifted && scenario === "novelty" && random() < 0.5) };
    return { seq, truth, fast, teacher, context, fastMs: 40 + random() * 40, teacherMs: 400 + random() * 200, fastCost: FAST_COST, teacherCost: TEACHER_COST };
  });
}
const quantile = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)];

export function replay(frames: Frame[], policy: Policy, seed: number, budget = 0.12, shiftAt: number | null = SHIFT_AT) {
  const controller = new ReflexController("classify", "synthetic-v1", {
    auditRate: policy === "no_audits" ? 0 : Math.min(0.08, budget),
    maxAuditRate: policy === "no_audits" ? 0 : policy === "fixed_audits" ? Math.min(0.08, budget) : 0.5,
    auditBudget: policy === "no_audits" ? 0 : budget,
  });
  const random = rng(seed + 100000);
  const queued: { due: number; route: Route; teacher: Answer }[] = [];
  const times: number[] = [], events: { seq: number; type: string }[] = [];
  let correct = 0, postCorrect = 0, postN = 0, teacherCorrect = 0, teacherCalls = 0, fastCalls = 0,
    auditCalls = 0, reflex = 0, staleAudits = 0, cost = 0;
  function apply(seq: number) {
    while (queued.length && queued[0].due <= seq) {
      const a = queued.shift()!;
      if (!controller.complete(a.route, a.teacher)) staleAudits++;
    }
    events.push(...controller.drainEvents().map(e => ({ seq, type: e.type })));
  }
  for (const f of frames) {
    apply(f.seq);
    let answer: string | number | boolean, ms: number;
    if (policy === "teacher_only") { answer = f.teacher; ms = f.teacherMs; teacherCalls++; cost += f.teacherCost; }
    else if (policy === "fast_only") { answer = f.fast.answer; ms = f.fastMs; fastCalls++; reflex++; cost += f.fastCost; }
    else if (policy === "confidence_only") {
      fastCalls++; cost += f.fastCost;
      const useFast = f.fast.confidence >= 0.9 && f.context.risk === "low" && f.context.memoryAvailable && f.context.familiar;
      answer = useFast ? f.fast.answer : f.teacher; ms = f.fastMs + (useFast ? 0 : f.teacherMs);
      if (useFast) reflex++; else { teacherCalls++; cost += f.teacherCost; }
    } else {
      fastCalls++; cost += f.fastCost;
      // Only reference feedback and label-free context reach the controller.
      const route = controller.route(f.fast, f.context, random);
      answer = route.use === "fast" ? f.fast.answer : f.teacher;
      ms = f.fastMs + (route.use === "fast" ? 0 : f.teacherMs);
      if (route.use === "teacher") { teacherCalls++; cost += f.teacherCost; controller.complete(route, f.teacher); }
      else {
        reflex++;
        if (route.audit) { teacherCalls++; auditCalls++; cost += f.teacherCost; queued.push({ due: f.seq + AUDIT_DELAY, route, teacher: f.teacher }); }
        else controller.complete(route);
      }
    }
    // Scorer-only labels. Neither the route nor feedback sees f.truth.
    correct += Number(answer === f.truth); teacherCorrect += Number(f.teacher === f.truth);
    if (shiftAt !== null && f.seq >= shiftAt) { postN++; postCorrect += Number(answer === f.truth); }
    times.push(ms);
  }
  apply(Infinity); // charge/drain all background work, including stale audits
  const firstDemotion = events.find(e => e.type === "demote" && shiftAt !== null && e.seq >= shiftAt && Number.isFinite(e.seq));
  return { policy, seed, budget, n: frames.length, accuracy: correct / frames.length,
    postShiftAccuracy: postN ? postCorrect / postN : null, teacherAccuracy: teacherCorrect / frames.length,
    costUnits: cost,
    costVsTeacher: cost / frames.reduce((sum, f) => sum + f.teacherCost, 0),
    simulatedP50Ms: quantile(times, 0.5), simulatedP95Ms: quantile(times, 0.95), teacherCalls, fastCalls, auditCalls,
    reflexShare: reflex / frames.length, staleAudits, promotions: events.filter(e => e.type === "promote").length,
    demotions: events.filter(e => e.type === "demote").length,
    firstPostShiftDemotionDelay: firstDemotion ? firstDemotion.seq - (shiftAt ?? 0) : null };
}

export function readDataset(path: string): { node: string; revision: string; shiftAt?: number; records: Frame[] } {
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value.schemaVersion !== 1 || value.kind !== "recorded" || value.costUnit !== "USD" ||
      typeof value.node !== "string" || !value.node.trim() || typeof value.revision !== "string" || !value.revision.trim() ||
      !Array.isArray(value.records) || !value.records.length) throw new Error("Invalid recorded dataset envelope");
  if (value.shiftAt !== undefined && (!Number.isInteger(value.shiftAt) || value.shiftAt < 0 || value.shiftAt >= value.records.length)) throw new Error("Invalid shiftAt");
  const scalar = (x: unknown) => typeof x === "string" || typeof x === "boolean" || (typeof x === "number" && Number.isFinite(x));
  for (const [index, f] of value.records.entries()) {
    if (f.seq !== index || !scalar(f.truth) || !scalar(f.teacher) || !f.fast || !scalar(f.fast.answer) ||
        !Number.isFinite(f.fast.confidence) || f.fast.confidence < 0 || f.fast.confidence > 1 ||
        !f.context || !["low", "high"].includes(f.context.risk) || typeof f.context.familiar !== "boolean" ||
        typeof f.context.memoryAvailable !== "boolean" ||
        [f.fastMs, f.teacherMs, f.fastCost, f.teacherCost].some(x => !Number.isFinite(x) || x < 0))
      throw new Error(`Invalid recorded frame ${index}`);
  }
  if (value.records.reduce((s: number, f: Frame) => s + f.teacherCost, 0) <= 0) throw new Error("Teacher total cost must be positive");
  return value;
}

function recordedMain(input: string, output: string) {
  const dataset = readDataset(input);
  const policies: Policy[] = ["teacher_only", "fast_only", "confidence_only", "no_audits", "fixed_audits", "adaptive_audits"];
  const rows = Array.from({ length: 10 }, (_, i) => policies.map(policy => replay(dataset.records, policy, i + 1, 0.12, dataset.shiftAt ?? null))).flat();
  mkdirSync(output, { recursive: true });
  const manifest = { kind: "recorded-output-replay", node: dataset.node, revision: dataset.revision, costUnit: "USD",
    inputSha256: createHash("sha256").update(readFileSync(input)).digest("hex"),
    note: "Costs are counterfactual serving costs from recorded calls; collection cost excluded. Latencies use a serial fast-then-teacher model. Seeds vary auditing, not model outputs. Shift index comes from the input or is unspecified." };
  writeFileSync(resolve(output, "recorded.json"), JSON.stringify({ manifest, rows }, null, 2) + "\n");
  console.log(`Replayed ${dataset.records.length} recorded frames across ${rows.length} runs.`);
}

function main() {
  const inputIndex = process.argv.indexOf("--input");
  if (inputIndex >= 0) {
    const input = process.argv[inputIndex + 1];
    const outputIndex = process.argv.indexOf("--output");
    if (!input || outputIndex < 0 || !process.argv[outputIndex + 1]) throw new Error("Provide --input FILE --output DIRECTORY");
    return recordedMain(input, process.argv[outputIndex + 1]);
  }
  const scenarios: Scenario[] = ["stable", "sudden", "gradual", "novelty", "teacher_shift"];
  const policies: Policy[] = ["teacher_only", "fast_only", "confidence_only", "no_audits", "fixed_audits", "adaptive_audits"];
  const rows = scenarios.flatMap(scenario => Array.from({ length: 10 }, (_, seed) => {
    const frames = stream(seed + 1, scenario);
    return policies.map(policy => ({ scenario, ...replay(frames, policy, seed + 1) }));
  }).flat());
  const summary = scenarios.flatMap(scenario => policies.map(policy => {
    const subset = rows.filter(r => r.scenario === scenario && r.policy === policy);
    const mean = (field: "accuracy" | "postShiftAccuracy" | "costVsTeacher" | "auditCalls" | "simulatedP95Ms" | "demotions") =>
      subset.reduce((s, r) => s + (r[field] ?? 0), 0) / subset.length;
    return { scenario, policy, accuracy: mean("accuracy"), postShiftAccuracy: mean("postShiftAccuracy"),
      costVsTeacher: mean("costVsTeacher"), auditCalls: mean("auditCalls"), simulatedP95Ms: mean("simulatedP95Ms"), demotions: mean("demotions") };
  }));
  const manifest = {
    kind: "synthetic-controller-stress-test", version: 1, seeds: 10, framesPerSeed: 2400,
    shiftAt: SHIFT_AT, auditDelayDecisions: AUDIT_DELAY, costs: { fast: FAST_COST, teacher: TEACHER_COST, units: "arbitrary" },
    auditBudgetCap: 0.12, note: "Equal audit caps are NOT equal realized spend. No real models, tokens or wall-clock latency measured.",
    sourceSha256: createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url)))
      .update(readFileSync(new URL("../packages/core/src/index.ts", import.meta.url))).digest("hex"),
  };
  writeFileSync(new URL("results/synthetic.json", import.meta.url), JSON.stringify({ manifest, summary, rows }, null, 2) + "\n");
  const lines = ["# Synthetic controller stress test", "", "Generated by `npm run research:replay`. Ten seeds per scenario; 2,400 decisions per seed.",
    "These are simulated decisions and arbitrary cost units, not model-quality, dollar-cost or real latency measurements.",
    "Fixed and adaptive audits share a 12% token-bucket cap; realized calls differ. This is not a matched-spend superiority comparison.", "",
    "| Scenario | Policy | Accuracy | After shift | Cost / teacher | Audits | Demotions |", "|---|---|---:|---:|---:|---:|---:|"];
  for (const r of summary) lines.push(`| ${r.scenario} | ${r.policy} | ${(100 * r.accuracy).toFixed(2)}% | ${(100 * r.postShiftAccuracy).toFixed(2)}% | ${r.costVsTeacher.toFixed(3)} | ${r.auditCalls.toFixed(1)} | ${r.demotions.toFixed(1)} |`);
  lines.push("", "The teacher-shift case deliberately makes the reference worse. Agreement cannot establish correctness.",
    "Use the per-seed JSON for variability and detection delays; null delay means no demotion was observed, not instant detection.",
    "A controller that never promotes can preserve teacher quality while saving nothing. Report coverage and cost alongside accuracy.", "");
  writeFileSync(new URL("results/SYNTHETIC.md", import.meta.url), lines.join("\n"));
  console.log(`Wrote ${rows.length} runs and ${summary.length} summaries; no external calls.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
