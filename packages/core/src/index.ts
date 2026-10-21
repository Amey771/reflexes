/** A scalar answer is intentional: use a stable enum ID for structured actions. */
export type Answer = string | number | boolean;
export type Prediction = { answer: Answer; confidence: number };
export type Mode = "shadow" | "reflex";
export type Context = { risk: "low" | "high"; familiar: boolean; memoryAvailable: boolean };
export type Reason = "shadow" | "high_risk" | "memory_unavailable" | "novel" | "invalid_prediction" | "low_confidence" | "reflex";
export type Sample = { confidence: number; agree: boolean };
export type Config = {
  tuneSize: number;
  validationSize: number;
  minCoverage: number;
  maxDisagreement: number;
  auditRate: number;
  maxAuditRate: number;
  auditBudget: number;
  auditBurst: number;
  auditWindow: number;
  minAudits: number;
  demoteDisagreement: number;
  boostDecisions: number;
  maxPending: number;
};
export const DEFAULT_CONFIG: Readonly<Config> = Object.freeze({
  tuneSize: 64, validationSize: 256, minCoverage: 0.6, maxDisagreement: 0.03,
  auditRate: 0.08, maxAuditRate: 0.5, auditBudget: 0.12, auditBurst: 4,
  auditWindow: 24, minAudits: 6, demoteDisagreement: 0.15, boostDecisions: 32,
  maxPending: 1024,
});
export type Event = {
  type: "promote" | "demote" | "reset" | "validation_failed";
  node: string; revision: string; epoch: number; reason: string;
};
export type Route = {
  id: number; node: string; revision: string; epoch: number;
  use: "teacher" | "fast"; reason: Reason; audit: boolean;
  /** Conditional selection chance after the deterministic token budget gate. */
  auditProbability: number;
  requestedAuditProbability: number;
  auditBudgetBlocked: boolean;
};
type Pending = { issued: Route; route: Route; prediction: Prediction | undefined };

const probability = (x: number) => Number.isFinite(x) && x >= 0 && x <= 1;
const scalar = (x: unknown): x is Answer =>
  typeof x === "string" || typeof x === "boolean" || (typeof x === "number" && Number.isFinite(x));
const valid = (p: Prediction | undefined): p is Prediction => !!p && scalar(p.answer) && probability(p.confidence);

/** Upper Wilson endpoint with z=1.96. Descriptive fixed-block statistic, not an online guarantee. */
export function disagreementUpper(errors: number, n: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(errors) || n < 0 || errors < 0 || errors > n)
    throw new RangeError("Expected integer counts with 0 <= errors <= n");
  if (!n) return 1;
  const z2 = 1.96 ** 2, p = errors / n;
  return (p + z2 / (2 * n) + 1.96 * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

/** Searches tuning data only; a threshold includes ALL ties at that confidence. */
export function selectFloor(samples: readonly Sample[], minCoverage: number, maxDisagreement: number): number | null {
  if (!probability(minCoverage) || minCoverage === 0 || !probability(maxDisagreement) ||
      samples.some(s => !probability(s.confidence) || typeof s.agree !== "boolean"))
    throw new RangeError("Invalid calibration data or thresholds");
  if (!samples.length) return null;
  const floors = [...new Set(samples.map(s => s.confidence))].sort((a, b) => a - b);
  for (const floor of floors) {
    const above = samples.filter(s => s.confidence >= floor);
    if (above.length / samples.length >= minCoverage && above.filter(s => !s.agree).length / above.length <= maxDisagreement)
      return floor;
  }
  return null;
}

/** One controller per decision and explicit model/prompt/schema revision. No provider or DB imports. */
export class ReflexController {
  readonly node: string;
  private revisionValue: string;
  private cfg: Readonly<Config>;
  private modeValue: Mode = "shadow";
  private epochValue = 0;
  private nextId = 0;
  private tune: Sample[] = [];
  private validation: Sample[] = [];
  private candidate: number | null = null;
  private floorValue: number | null = null;
  private audits: boolean[] = [];
  private boost = 0;
  private tokens = 0;
  private pending = new Map<number, Pending>();
  private events: Event[] = [];

  constructor(node: string, revision: string, config: Partial<Config> = {}) {
    if (!node.trim() || !revision.trim()) throw new Error("Node and revision must be nonempty");
    this.node = node; this.revisionValue = revision;
    const c = { ...DEFAULT_CONFIG, ...config };
    for (const k of ["tuneSize", "validationSize", "auditBurst", "auditWindow", "minAudits", "boostDecisions", "maxPending"] as const)
      if (!Number.isInteger(c[k]) || c[k] < 1) throw new RangeError(`Invalid ${k}`);
    for (const k of ["minCoverage", "maxDisagreement", "auditRate", "maxAuditRate", "auditBudget", "demoteDisagreement"] as const)
      if (!probability(c[k])) throw new RangeError(`Invalid ${k}`);
    if (!c.minCoverage || c.minAudits > c.auditWindow || c.auditRate > c.maxAuditRate)
      throw new RangeError("Inconsistent coverage/audit configuration");
    this.cfg = Object.freeze(c);
  }

  get state() {
    return { node: this.node, revision: this.revisionValue, epoch: this.epochValue, mode: this.modeValue,
      floor: this.floorValue, tuningSamples: this.tune.length, validationSamples: this.validation.length,
      auditSamples: this.audits.length, pending: this.pending.size, config: { ...this.cfg } };
  }

  drainEvents(): Event[] { return this.events.splice(0); }

  /** Call whenever fast model, teacher, prompt, answer schema or context policy changes. */
  reset(revision: string): void {
    if (!revision.trim()) throw new Error("Revision must be nonempty");
    this.revisionValue = revision;
    this.clear("reset", "revision_changed");
  }

  private clear(type: "demote" | "reset", reason: string): void {
    this.modeValue = "shadow"; this.epochValue++; this.floorValue = null;
    this.tune = []; this.validation = []; this.candidate = null; this.audits = [];
    this.boost = 0; this.tokens = 0; this.pending.clear();
    this.events.push({ type, node: this.node, revision: this.revisionValue, epoch: this.epochValue, reason });
  }

  /** random must be independent of predictions/labels; inject a seeded RNG for replay. */
  route(prediction: Prediction | undefined, context: Context, random = Math.random): Route {
    if (this.pending.size >= this.cfg.maxPending) throw new Error("Pending feedback limit reached; complete or cancel routes");
    let reason: Reason;
    // Missing or malformed guardrail context fails closed at runtime too.
    if (context.risk !== "low") reason = "high_risk";
    else if (context.memoryAvailable !== true) reason = "memory_unavailable";
    else if (context.familiar !== true) reason = "novel";
    else if (!valid(prediction)) reason = "invalid_prediction";
    else if (this.modeValue === "shadow") reason = "shadow";
    else if (prediction.confidence < this.floorValue!) reason = "low_confidence";
    else reason = "reflex";
    const use = reason === "reflex" ? "fast" : "teacher";
    let audit = false, auditProbability = 0, requestedAuditProbability = 0, auditBudgetBlocked = false;
    if (use === "fast") {
      this.tokens = Math.min(this.cfg.auditBurst, this.tokens + this.cfg.auditBudget);
      requestedAuditProbability = this.boost > 0 ? this.cfg.maxAuditRate : this.cfg.auditRate;
      if (this.boost > 0) this.boost--;
      auditBudgetBlocked = this.tokens < 1;
      auditProbability = auditBudgetBlocked ? 0 : requestedAuditProbability;
      if (auditProbability > 0) {
        const draw = random();
        if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new RangeError("RNG must return [0, 1)");
        audit = draw < auditProbability;
        if (audit) this.tokens -= 1;
      }
    }
    const route: Route = { id: ++this.nextId, node: this.node, revision: this.revisionValue,
      epoch: this.epochValue, use, reason, audit, auditProbability, requestedAuditProbability, auditBudgetBlocked };
    // Keep a defensive copy; feedback cannot alter the original route or confidence.
    Object.freeze(route);
    this.pending.set(route.id, { issued: route, route: { ...route }, prediction: valid(prediction) ? { ...prediction } : undefined });
    return route;
  }

  /** Exactly once. Labels must NEVER be supplied here: teacher is a reference, not truth. */
  complete(route: Route, teacher?: Answer): boolean {
    const p = this.pending.get(route.id);
    if (!p || p.issued !== route || p.route.node !== route.node || p.route.epoch !== route.epoch || p.route.revision !== route.revision)
      return false; // stale, duplicate or foreign feedback
    const r = p.route;
    const needsTeacher = r.use === "teacher" || r.audit;
    if (needsTeacher && !scalar(teacher)) throw new Error("Reference answer required");
    this.pending.delete(route.id);
    const prediction = p.prediction;
    if (!prediction || !needsTeacher) return true;
    const agree = prediction.answer === teacher;
    if (this.modeValue === "shadow" && r.reason === "shadow") {
      this.learn({ confidence: prediction.confidence, agree });
    } else if (this.modeValue === "reflex" && r.use === "fast" && r.audit) {
      this.audits.push(agree); this.audits = this.audits.slice(-this.cfg.auditWindow);
      if (!agree) this.boost = this.cfg.boostDecisions;
      if (this.audits.length >= this.cfg.minAudits &&
          this.audits.filter(x => !x).length / this.audits.length > this.cfg.demoteDisagreement)
        this.clear("demote", "audit_disagreement");
    }
    return true;
  }

  /** An audit failure invalidates trust; it must not be counted as successful agreement. */
  cancel(route: Route, auditFailed = false): void {
    const p = this.pending.get(route.id);
    if (!p || p.issued !== route || p.route.node !== route.node || p.route.epoch !== route.epoch || p.route.revision !== route.revision) return;
    this.pending.delete(route.id);
    if (auditFailed && p.route.audit && this.modeValue === "reflex") this.clear("demote", "audit_unavailable");
  }

  private learn(sample: Sample): void {
    if (this.candidate === null) {
      this.tune.push(sample);
      if (this.tune.length === this.cfg.tuneSize) {
        this.candidate = selectFloor(this.tune, this.cfg.minCoverage, this.cfg.maxDisagreement);
        if (this.candidate === null) this.tune = [];
      }
      return; // the last tuning sample NEVER becomes a validation sample
    }
    this.validation.push(sample);
    if (this.validation.length !== this.cfg.validationSize) return;
    const eligible = this.validation.filter(s => s.confidence >= this.candidate!);
    const errors = eligible.filter(s => !s.agree).length;
    const upper = disagreementUpper(errors, eligible.length);
    if (eligible.length / this.validation.length >= this.cfg.minCoverage && upper <= this.cfg.maxDisagreement) {
      this.floorValue = this.candidate; this.modeValue = "reflex";
      this.epochValue++; this.pending.clear(); // ignore in-flight shadow results
      this.events.push({ type: "promote", node: this.node, revision: this.revisionValue,
        epoch: this.epochValue, reason: `held_out=${eligible.length};errors=${errors};upper=${upper.toFixed(6)};floor=${this.floorValue}` });
    } else {
      this.events.push({ type: "validation_failed", node: this.node, revision: this.revisionValue,
        epoch: this.epochValue, reason: `held_out=${eligible.length};errors=${errors};upper=${upper.toFixed(6)}` });
      this.tune = []; this.validation = []; this.candidate = null;
    }
  }
}

export type ModelResult = Prediction & { cost: number };
export type Provider<I> = (input: I) => Promise<ModelResult>;
export type Outcome = {
  answer: Answer; route: Route; servingMs: number; servingCost: number;
  fastFailed: boolean;
  /** Failed requests may still be billed; successful response costs alone are incomplete. */
  costComplete: boolean;
  audit?: Promise<{ cost: number; ms: number; failed: boolean; applied: boolean; costComplete: boolean }>;
};

/** Small callback adapter. Providers own cancellation/timeouts; audit promises must be drained. */
export async function decide<I>(controller: ReflexController, input: I, context: Context,
  providers: { fast: Provider<I>; teacher: Provider<I> }, random = Math.random): Promise<Outcome> {
  const started = performance.now();
  let fast: ModelResult | undefined, fastFailed = false;
  const checked = async (provider: Provider<I>) => {
    const result = await provider(input);
    if (!valid(result) || !Number.isFinite(result.cost) || result.cost < 0) throw new Error("Invalid provider response");
    return result;
  };
  try { fast = await checked(providers.fast); } catch { fastFailed = true; }
  const route = controller.route(fast, context, random);
  let reference: ModelResult | undefined;
  if (route.use === "teacher") {
    try { reference = await checked(providers.teacher); controller.complete(route, reference.answer); }
    catch (error) { controller.cancel(route); throw error; }
  } else if (!route.audit) controller.complete(route);
  const outcome: Outcome = { answer: (reference ?? fast)!.answer, route, fastFailed, costComplete: !fastFailed,
    servingMs: performance.now() - started, servingCost: (fast?.cost ?? 0) + (reference?.cost ?? 0) };
  if (route.audit) {
    outcome.audit = (async () => {
      const auditStart = performance.now();
      try {
        const result = await checked(providers.teacher);
        return { cost: result.cost, ms: performance.now() - auditStart, failed: false, costComplete: true,
          applied: controller.complete(route, result.answer) };
      } catch {
        controller.cancel(route, true);
        return { cost: 0, ms: performance.now() - auditStart, failed: true, applied: false, costComplete: false };
      }
    })();
  }
  return outcome;
}
