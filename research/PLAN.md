# Reflexes: redesign and execution plan

Status: 2026-10-21. Working plan for an eight-week development and validation cycle, ending 2026-12-15. Dates are targets; experimental evidence determines whether the research advances.

## Decision and intended user

Redesign the architecture and developer experience around a reusable lifecycle controller. Preserve the original SOC demonstration and its archived results. A new dashboard is secondary to an installable core, honest evaluation, and a successful external integration.

Primary user: an engineer operating an agent with repeated, typed decisions such as support intent, escalation, or runbook selection. Their problem is not simply choosing the cheapest model. It is deciding when a cheaper path has earned trust, when evidence has expired, and how much checking is necessary as traffic changes.

Provisional product statement: **Reflexes helps agent developers learn, monitor, and revoke fast paths for repeated decisions.** The deliverable is a library plus a reproducible evaluation harness. The research question is whether adaptive monitoring improves the quality/cost/recovery frontier against fixed auditing under controlled shifts.

The original proposal to select model and reasoning effort can eventually use these interfaces, but changing a coding agent's effort setting is a separate integration. The current controller neither modifies Claude Code nor claims to optimize general coding quality.

## Repository audit

Base inspected: `2a6ceeb20603567af7724f27e02cdc26c6105164`.

| Finding | Implication | Response |
|---|---|---|
| Engine imports SOC node names and workload types directly | General-purpose use requires source edits | New generic core under `packages/core` |
| Live routing imports MongoDB recall and model clients | Tests/integrations require hosted dependencies | Inject prediction and context; keep storage optional |
| Confidence floor selected and evaluated on the same 20 cases | Threshold search is optimistic; too little evidence for a reliability claim | Disjoint tuning/validation blocks; descriptive uncertainty bound |
| Sorting/slicing confidence samples can separate ties | Reported coverage need not match the cases a threshold will actually select | Include every tied confidence together |
| Fixed random audits and hardcoded constants | No explicit monitoring-budget experiment | Injectable randomness and configurable capped audit policy |
| Teacher agreement drives learning | Agreement can coexist with shared errors | Keep independent task labels in scorer only; test teacher drift |
| Existing README compares different phases of a single evolving stream | Workload changes confound a causal cost/accuracy comparison | Replay each policy on identical recorded outputs |
| Reflex fallbacks call fast predictor then teacher | Mean and tail latency can worsen | Count both calls and include p95; evaluate scheduling separately |
| Memory errors can permit original-demo reflexes to act | Availability and uncertainty are conflated | New core defaults to teacher when required memory is unavailable |
| No repository license found | Public source is not yet a clearly licensed reusable release | Contributor-rights and license decision before publication |
| Frozen live run and destructive reset command | Existing data is valuable | All current work is offline and separate from the live runner |

Existing README results remain historical observations, including the reported four-point accuracy trade-off. They are not reinterpreted as evidence of quality preservation.

## Target architecture

| Layer | Responsibility | Initial implementation |
|---|---|---|
| Core policy | Per-node state, calibration, routing, audit budget, promotion/demotion, revision invalidation | `packages/core/src/index.ts` |
| Execution adapter | Call validated provider callbacks, fallback, report timing/cost, expose background audit completion | `decide()` in the core package |
| Integration adapters | Provider APIs, novelty/trust retrieval, event storage | Interfaces/callback boundaries now; concrete live adapters later |
| Evaluation | Paired replay, scorer-only labels, fixed seeds, delayed audits, baselines | `research/replay.mts` |
| Examples | Show integration in another domain without infrastructure | Mock support-intent example now; real support and SOC adapters later |
| Product console | Visualize recorded decisions and lifecycle evidence | Existing demo retained; new evaluation console only after API settles |

Core data flow: input + fast prediction + label-free context → route → reference feedback when required → lifecycle update. The scorer independently compares the served answer with a task label. An event is evidence of a policy transition, not proof that the answer was correct.

Each decision has a stable node ID and a revision covering fast model, reference model, prompt, schema, and context policy. Revision changes discard previous trust. In-process route handles prevent duplicated or old feedback from contaminating a new epoch. A distributed design will need durable identities, atomic ownership and explicit feedback ordering; the alpha does not claim those properties.

## What is implemented in this change

- Provider-independent TypeScript controller, with a compiled JS/declaration output.
- Tied-confidence-safe threshold search and disjoint fixed-block validation.
- Low-risk/familiarity/memory checks, automatic demotion, bounded pending feedback, and revision resets.
- Fixed or adaptive audit selection with a token budget and injectable RNG.
- Callback execution adapter, separate serving/audit metrics, and incomplete-cost flags on failed calls.
- Executable support example, controller tests, replay tests, and secret-free CI on Node 22/24.
- Six policy baselines, five synthetic stress scenarios, ten seeds, and deterministic per-run results.
- Validated input format for replaying recorded model outputs.

This is an experimental alpha. Real-provider evaluation, persistence, distributed execution, community adoption and a publishable research finding are outstanding.

## Scope and acceptance gates

### Gate A — usable engineering alpha

A developer can clone, install, build, run tests, run the support example, and replay experiments without API keys or a database. Every route explains why it used a teacher or fast path. Missing guardrail context falls back. Bad, duplicate and stale feedback cannot establish trust. All background work is explicitly owned by the caller.

### Gate B — credible empirical result

At least two independently labeled workloads and two model pairs; frozen calibration and evaluation splits; identical recorded outputs for paired policy comparisons; cost includes fast predictions, fallbacks, audits, memory and retries where applicable. Publish seed-level outcomes, uncertainty and failed experiments. A provider-independent replay alpha alone does not satisfy this gate.

Provisional product target, to be frozen before collecting the final test set: at least 30% total inference-cost reduction while the upper 95% paired interval for task error increase remains below one percentage point on each primary workload, with a declared p95-latency allowance. This is a goal, not an achieved result or a universal promise. Report shift recovery separately. Under hard shifts the correct response may be to use the teacher for most decisions and save little.

### Gate C — reusable release

Resolve contributor rights and attribution with all actual contributors, including Meet where applicable; choose a license; review dependencies and data redistribution rights; add installation docs and a changelog; obtain three external integration attempts. Aim for at least one independently reproducible result or accepted useful integration, rather than using star count as the main success measure.

### Gate D — research publication

Proceed only if a scoped question has a reproducible finding beyond competent engineering, and the literature comparison supports its contribution. Otherwise release a careful technical report or negative-result analysis. Do not manufacture novelty or claim publication acceptance.

## Eight-week work breakdown

| Week / target dates | Deliverables | Acceptance criteria / dependency |
|---|---|---|
| 1 · Oct 21–27 | Repository audit, redesign RFC, related-work map, standalone controller and baseline harness | Offline alpha checks pass; user/problem and research hypothesis are explicit |
| 2 · Oct 28–Nov 3 | First real provider adapter, structured recording format, small support workload pilot, label rubric | Prompt/schema/model revisions logged; labels withheld from routing; cost completeness checked |
| 3 · Nov 4–10 | Support dataset and SOC workload with temporal splits; duplicate/label audit | Labels adjudicated independently; split manifest and source rights documented; pilot estimates collection cost |
| 4 · Nov 11–17 | Fixed-audit and calibrated-cascade baselines; matched-spend pilot; audit-delay and failure tests | Configuration frozen using validation only; no selection using final test outcomes |
| 5 · Nov 18–24 | Full paired runs across shifts, model pairs and seeds | Export raw records, events, actual billing/usage and per-run metrics; preserve failures |
| 6 · Nov 25–Dec 1 | Ablations, robustness checks, paired intervals, explanatory figures | Identify where adaptation wins, loses or saves nothing; avoid unsupported generalization |
| 7 · Dec 2–8 | API hardening, first live integration, docs and external reproduction kit | Installation works outside this repository; rights/license resolved before public package release |
| 8 · Dec 9–15 | Technical report and reproducibility release; paper decision | Claims match evidence; external feedback recorded; submit only if contribution is defensible |

Suggested personal allocation: 6–8 focused hours a week, kept within the existing Applied/FDE AI career priority. Development automation can shorten implementation, but not replace independent labels, real adoption or elapsed observation.

## Research design

H1: adaptive auditing reduces cumulative post-shift errors or detection delay at comparable total reference-model spend versus fixed audits.

H2: disjoint validation avoids some overly optimistic promotions relative to the original 20-sample in-sample rule, at the cost of warm-up time and lower coverage.

H3: revision-aware invalidation and conservative context fallback prevent stale or unavailable evidence from silently keeping a fast path active.

H1 is unresolved. The synthetic report is a controller stress test, not evidence of LLM efficiency. Fixed and adaptive policies start with the same 8% base rate and share a 12% cap; the realized spend still differs. A cap is not a matched-spend comparison.

Primary experiment matrix:

- Policies: teacher-only; fast-only diagnostic; fixed confidence cascade; calibrated/no-audit; calibrated/fixed-audit; calibrated/adaptive-audit. Add RouteLLM and a FrugalGPT/AutoMix-style comparator where their inputs/objectives can be made comparable; do not relabel a toy threshold as an implementation of those papers.
- Workloads: support intent/escalation and SOC triage, with per-node error and end-to-end task success. Use a second fast/teacher pair to test portability.
- Shifts: stable, abrupt new intent, gradual mixture change, overconfident failure, teacher degradation, missing memory, provider errors and delayed audits. Include long no-shift controls for false demotions.
- Spend: sweep base rates/caps on validation, then compare frozen test policies at overlapping **realized total cost**; show the full cost/error frontier rather than cherry-picking a point.
- Ablations: remove adaptive boost; remove audits; remove novelty; use in-sample promotion; change validation size; remove revision reset. Keep other components identical.
- Auditing: log the actual conditional selection probability and whether budget gating blocked the call. Nonuniform audit observations are not an unbiased global error estimate. Use an independent uniform evaluation sample for population reporting; implement propensity-aware inference only with verified support/assumptions.

See [PROTOCOL.md](PROTOCOL.md) for the measurement and data contract.

## Risks and decision rules

| Risk | Response / stop rule |
|---|---|
| Adaptive auditing is merely more expensive auditing | Compare cost/error curves; if fixed auditing is competitive, report that and simplify |
| Rare high-confidence failures are missed | Keep uniform sampling support, assess delay tails; do not infer safety from zero observed errors |
| The teacher becomes wrong | Independent labels and teacher-shift control; require external review for high-risk actions |
| Conservative validation prevents useful coverage | Measure warm-up/payback; tune on validation only; abandon workloads without sufficient repetition |
| Model-call overhead erases savings | Include every stage and p95; evaluate parallel fallback scheduling after correctness is established |
| Benchmark is generated by the same model used as teacher | Independent labels and a second source/model; document provenance and shared bias |
| Related work already solves the proposed question | Reframe as an integration/measurement contribution or narrow the question; no claim of firstness |
| Scope expands into a general agent platform | Defer self-evolution, free-form coding, dashboards, marketplaces and multi-agent orchestration |

## Next executable steps

1. Review this branch and the alpha API. Inspect the failure cases as closely as the happy path.
2. Build a real-provider recording adapter for one low-risk support decision, with explicit model/prompt/schema IDs, timeout and usage accounting.
3. Collect a small pilot only after its provider configuration and bounded cost are concrete. No live Atlas reset is needed for this path.
4. Freeze the label rubric, data split and comparison protocol before the larger collection.
5. Use the research gates to decide what can be claimed and released.

No scheduled background development or automatic external outreach is configured by this change. Future weeks describe milestones, not work that has already happened.
