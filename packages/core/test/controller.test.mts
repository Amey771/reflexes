import test from "node:test";
import assert from "node:assert/strict";
import { ReflexController, disagreementUpper, selectFloor, decide } from "../dist/index.js";
const context = { risk: "low", familiar: true, memoryAvailable: true } as const;
const prediction = { answer: "ok", confidence: 0.95 };
const config = { tuneSize: 4, validationSize: 128 };
function trained(extra = {}) {
  const c = new ReflexController("intent", "v1", { ...config, ...extra });
  for (let i = 0; i < 132; i++) c.complete(c.route(prediction, context), "ok");
  assert.equal(c.state.mode, "reflex");
  return c;
}

test("confidence ties cannot be sliced to hide errors", () => {
  const samples = Array.from({ length: 20 }, (_, i) => ({ confidence: 0.9, agree: i !== 0 }));
  assert.equal(selectFloor(samples, 0.6, 0.03), null);
});
test("20 perfect observations are not evidence of 97% reliability", () => {
  assert.ok(disagreementUpper(0, 20) > 0.03);
  assert.ok(disagreementUpper(0, 128) < 0.03);
  assert.throws(() => disagreementUpper(2, 1));
});
test("promotion requires a separate full validation block", () => {
  const c = new ReflexController("intent", "v1", config);
  for (let i = 0; i < 131; i++) c.complete(c.route(prediction, context), "ok");
  assert.equal(c.state.mode, "shadow");
  c.complete(c.route(prediction, context), "ok");
  assert.equal(c.state.mode, "reflex");
  assert.equal(c.state.floor, 0.95);
});
test("tuning success cannot hide validation failures", () => {
  const c = new ReflexController("intent", "v1", config);
  for (let i = 0; i < 132; i++) c.complete(c.route(prediction, context), i < 4 ? "ok" : "wrong");
  assert.equal(c.state.mode, "shadow");
  assert.equal(c.state.tuningSamples, 0);
  assert.equal(c.drainEvents()[0].type, "validation_failed");
});
test("held-out coverage must also pass", () => {
  const c = new ReflexController("intent", "v1", config);
  for (let i = 0; i < 132; i++) c.complete(c.route({ ...prediction, confidence: i < 4 ? 0.95 : 0.5 }, context), "ok");
  assert.equal(c.state.mode, "shadow");
});
test("all guardrails fail closed and do not bypass a promoted threshold", () => {
  const c = trained();
  for (const [change, reason] of [
    [{ risk: "high" }, "high_risk"], [{ memoryAvailable: false }, "memory_unavailable"], [{ familiar: false }, "novel"],
  ] as const) {
    const r = c.route(prediction, { ...context, ...change });
    assert.equal(r.reason, reason); assert.equal(r.use, "teacher"); c.complete(r, "ok");
  }
  for (const confidence of [NaN, Infinity, -1, 1.1]) {
    const r = c.route({ ...prediction, confidence }, context);
    assert.equal(r.reason, "invalid_prediction"); c.complete(r, "ok");
  }
  const r = c.route({ ...prediction, confidence: 0.94 }, context);
  assert.equal(r.reason, "low_confidence"); c.complete(r, "ok");
});
test("blocked contexts do not supply promotion evidence", () => {
  const c = new ReflexController("intent", "v1", config);
  for (let i = 0; i < 200; i++) c.complete(c.route(prediction, { ...context, risk: "high" }), "ok");
  assert.equal(c.state.tuningSamples, 0);
});
test("feedback is exactly once, route-bound, and revision-bound", () => {
  const c = new ReflexController("intent", "v1", config);
  const foreign = new ReflexController("intent", "v1", config);
  const r = c.route(prediction, context), other = foreign.route(prediction, context);
  assert.equal(c.complete(other, "ok"), false);
  assert.equal(c.complete({ ...r }, "ok"), false);
  assert.equal(c.complete(r, "ok"), true);
  assert.equal(c.complete(r, "ok"), false);
  const late = c.route(prediction, context); c.reset("v2");
  assert.equal(c.complete(late, "ok"), false);
  assert.equal(c.state.mode, "shadow"); assert.equal(c.state.pending, 0);
});
test("audit caps bound actual calls and increase attention after disagreement", () => {
  const c = trained({ auditRate: 0.1, maxAuditRate: 0.8, auditBudget: 0.2, minAudits: 24 });
  let audits = 0, boosted = false;
  for (let i = 0; i < 100; i++) {
    const r = c.route(prediction, context, () => 0);
    if (r.auditProbability === 0.8) boosted = true;
    if (r.audit) audits++;
    c.complete(r, r.audit ? (audits === 1 ? "wrong" : "ok") : undefined);
  }
  assert.ok(boosted); assert.ok(audits <= 20); assert.ok(audits > 0);
});
test("audits demote and old in-flight feedback cannot re-promote", () => {
  const c = trained({ auditRate: 1, maxAuditRate: 1, auditBudget: 1 });
  const late = c.route(prediction, context, () => 0);
  for (let i = 0; i < 6; i++) c.complete(c.route(prediction, context, () => 0), "wrong");
  assert.equal(c.state.mode, "shadow"); assert.equal(c.complete(late, "ok"), false);
  assert.equal(c.state.pending, 0);
});
test("audit provider failures demote instead of silently extending trust", () => {
  const c = trained({ auditRate: 1, maxAuditRate: 1, auditBudget: 1 });
  const r = c.route(prediction, context, () => 0); c.cancel(r, true);
  assert.equal(c.state.mode, "shadow");
  assert.equal(c.drainEvents().at(-1)?.reason, "audit_unavailable");
});
test("feedback capacity is bounded, and cancellation frees capacity", () => {
  const c = new ReflexController("intent", "v1", { maxPending: 1 });
  const r = c.route(prediction, context);
  assert.throws(() => c.route(prediction, context), /Pending/);
  assert.throws(() => c.complete(r), /Reference/);
  c.cancel(r); assert.doesNotThrow(() => c.route(prediction, context));
});
test("configuration is validated and defensively copied", () => {
  assert.throws(() => new ReflexController("intent", "v1", { auditRate: 2 }));
  assert.throws(() => new ReflexController("intent", "v1", { tuneSize: 1.1 }));
  assert.throws(() => new ReflexController("intent", "v1", { minCoverage: 0 }));
  const c = trained(); c.state.config.auditRate = 1;
  assert.equal(c.state.config.auditRate, 0.08);
});
test("callback adapter falls back on fast error, surfaces teacher error, cleans pending", async () => {
  const c = new ReflexController("intent", "v1");
  const fast = async () => { throw new Error("timeout"); };
  const teacher = async () => ({ ...prediction, cost: 0.01 });
  const out = await decide(c, "ticket", context, { fast, teacher });
  assert.equal(out.answer, "ok"); assert.equal(out.fastFailed, true); assert.equal(out.costComplete, false); assert.equal(out.servingCost, 0.01);
  await assert.rejects(decide(c, "ticket", context, { fast, teacher: fast }), /timeout/);
  assert.equal(c.state.pending, 0);
});
test("audit is off the serving path and its cost is separately available", async () => {
  const c = trained({ auditRate: 1, maxAuditRate: 1, auditBudget: 1 });
  let finish!: (v: { answer: string; confidence: number; cost: number }) => void;
  const reference = new Promise<{ answer: string; confidence: number; cost: number }>(resolve => { finish = resolve; });
  const out = await decide(c, "ticket", context, {
    fast: async () => ({ ...prediction, cost: 0.001 }), teacher: async () => reference,
  }, () => 0);
  assert.equal(out.answer, "ok"); assert.equal(out.servingCost, 0.001); assert.equal(c.state.pending, 1);
  finish({ ...prediction, cost: 0.01 });
  assert.equal((await out.audit)?.cost, 0.01); assert.equal(c.state.pending, 0);
});
test("callback audit failures are resolved and invalidate trust", async () => {
  const c = trained({ auditRate: 1, maxAuditRate: 1, auditBudget: 1 });
  const out = await decide(c, "ticket", context, {
    fast: async () => ({ ...prediction, cost: 0 }), teacher: async () => { throw new Error("offline"); },
  }, () => 0);
  assert.equal((await out.audit)?.failed, true); assert.equal(c.state.mode, "shadow");
});

test("budget-blocked routes report zero effective selection probability", () => {
  const c = trained();
  const r = c.route(prediction, context, () => 0);
  assert.equal(r.auditProbability, 0); assert.equal(r.auditBudgetBlocked, true);
  assert.equal(r.requestedAuditProbability, 0.08); c.complete(r);
});
test("issued route and captured prediction cannot be modified by the caller", () => {
  const c = new ReflexController("intent", "v1", config);
  const pred = { ...prediction };
  const r = c.route(pred, context); pred.answer = "changed";
  assert.throws(() => { r.reason = "reflex"; }, TypeError);
  c.complete(r, "ok"); assert.equal(c.state.tuningSamples, 1);
});
