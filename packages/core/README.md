# Reflexes core — experimental alpha

A provider-independent controller for **repeated typed decisions**. It learns when a fast predictor agrees sufficiently with a reference model, serves eligible decisions through the fast path, audits a budgeted sample, and demotes on disagreement. It does not validate free-form answers or enforce action permissions.

The original Next.js/MongoDB SOC application remains a separate hackathon demonstration. This package has no runtime dependencies on that application, model APIs, MongoDB, or Jev.

## Run from this repository

Requires Node 22.18+ and the root development dependencies.

```bash
npm ci
npm run core:test
npm run core:example
npm run research:replay
```

The package is private and unpublished. Build output is generated locally; import `packages/core/dist/index.js`, or use a local file dependency after building. The npm name is provisional. A license and contributor-rights review remains a release gate.

```ts
import { ReflexController, decide } from "./packages/core/dist/index.js";

const intent = new ReflexController("support.intent", "fastA-teacherB-prompt1-schema1");
const result = await decide(intent, ticket, {
  risk: "low",
  familiar: true,       // supply a real novelty/trust check in a live integration
  memoryAvailable: true,
}, {
  fast: predictIntent, // async input => { answer: string|number|boolean, confidence, cost }
  teacher: referenceIntent,
});

// The caller owns action execution and any required human approval.
console.log(result.answer, result.route.reason, result.servingMs);
const audit = result.audit ? await result.audit : undefined;
const totalKnownCost = result.servingCost + (audit?.cost ?? 0);
const costsComplete = result.costComplete && (audit?.costComplete ?? true);
for (const event of intent.drainEvents()) persist(event);
```

This snippet shows integration; the [support example](examples/support.mts) is executable with mock callbacks.

## Lifecycle

1. Start in shadow. The teacher decides; valid, low-risk, familiar inputs supply paired evidence.
2. Use 64 tuning observations to choose a confidence floor. Every tie is included together.
3. Freeze that floor and validate it on the next 256 eligible-context observations. Require at least 60% coverage and an upper Wilson disagreement endpoint of at most 3%.
4. Promote and allow the fast path only when all input guardrails and the learned threshold pass.
5. Audit with base probability 8%, increased to 50% for 32 eligible decisions after a disagreement. A token bucket caps audit calls at 12% of fast-path decisions, starting empty with capacity four.
6. Demote if at least six recent audits have more than 15% disagreement, or an audit fails. Clear evidence and learn again.

These are configurable engineering defaults, not calibrated production recommendations. The Wilson endpoint uses z=1.96 as a descriptive fixed-block statistic. Repeated attempts, adaptive selection, correlation, teacher errors, and distribution shift prevent interpreting it as a global 95% guarantee. Three percent disagreement with a teacher is not three percent task error.

## Lower-level API and operational contract

- `route(prediction, context, rng)` returns an immutable, in-process route handle with reason, epoch and audit selection.
- `complete(route, teacherAnswer)` consumes it exactly once. Supply a teacher answer for every teacher route and selected audit. For a fast route without an audit, call `complete(route)` immediately.
- `cancel(route, auditFailed)` releases outstanding work. An unavailable selected audit demotes the node.
- `reset(revision)` invalidates all evidence and pending feedback. Change the revision whenever the fast model, reference model, prompt, schema or context policy changes.
- `state` returns a copy of diagnostic state. `drainEvents()` consumes lifecycle events; persist them externally.

Handles are bound to their controller instance. They are not serialized jobs. Stale, duplicate and foreign feedback is ignored. An epoch change invalidates in-flight observations. Pending work is bounded; callers must drain/cancel it. Evidence is recorded in completion order, so integrations with concurrent calls must account for latency-related sampling bias.

The callback adapter falls back when the fast provider fails or returns invalid data, and propagates reference-provider failure. Failed requests can still be billed: `costComplete=false` marks incomplete accounting. Providers must implement timeouts and cancellation. Background audits begin after the serving result is assembled; drain them at shutdown. Serverless handlers need a supported background-work mechanism or must await them explicitly.

## Boundaries

- In-memory, one process per controller; a restart returns to shadow. Persistence and distributed ownership are follow-up work.
- Context guardrails are supplied by the caller. Missing memory fails closed. This package does not compute embeddings or novelty.
- High-risk requests always use the teacher; that is a model-routing rule, not a substitute for human approval or deterministic authorization.
- The simple adapter calls the fast predictor before a fallback teacher, so fallback latency can exceed teacher-only latency. Audit cost is separate from serving cost.
- A provider's confidence is only a ranking signal until externally validated. Never treat model self-confidence as evidence of correctness.
- No self-rewriting, free-form response caching, action execution, or automatic coding-tool configuration changes are implemented.
