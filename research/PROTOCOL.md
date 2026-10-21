# Evaluation protocol and recording contract

## Reproduce the current offline checks

```bash
npm ci --ignore-scripts
npm run core:test
npm run research:test
npm run core:lint
npx next typegen
npx tsc --noEmit -p .
npm run research:replay
```

[SYNTHETIC.md](results/SYNTHETIC.md) contains scenario means. `results/synthetic.json` contains the manifest, source hash, every seed and every policy. These runs use generated class outcomes and arbitrary costs. Their timing fields simulate sequential fast-then-teacher serving, excluding background audit latency. They do not measure real provider latency, pricing or task quality.

The workload has a shift at decision 1,000 of 2,400, 20% hard cases, independent teacher errors, high-risk inputs, and occasional missing memory. Randomness for traffic and auditing uses separate seeded streams. Audits complete eight decisions later; stale audits are charged even when their feedback can no longer affect the controller. A null detection delay means no post-shift demotion was observed. Stable scenarios have no actual shift; their post-index metric is just the later segment.

## Recorded-output replay

```bash
npm run research:replay -- --input /absolute/path/recorded.json --output /absolute/path/replay-output
```

Supply a JSON envelope with `schemaVersion: 1`, `kind: "recorded"`, `costUnit: "USD"`, a nonempty `node`, a nonempty `revision`, and `records`. Optional `shiftAt` is a zero-based index of a known externally defined shift. Without it, post-shift accuracy and detection delay are null.

Each record must contain:

| Field | Contract |
|---|---|
| `seq` | Zero-based contiguous integer in arrival order |
| `truth` | Independently established string, finite number or boolean, used only by scorer |
| `fast.answer`, `fast.confidence` | Typed prediction; finite confidence in [0,1] |
| `teacher` | Typed reference answer, from an actual logged call |
| `context.risk` | `low` or `high`, determined without ground truth |
| `context.familiar`, `context.memoryAvailable` | Booleans computed from information available at routing time |
| `fastMs`, `teacherMs` | Nonnegative measured durations of the individual recorded calls |
| `fastCost`, `teacherCost` | Nonnegative per-call USD cost; teacher total must be positive |

One file represents one decision node and one model/prompt/schema/context revision. Separate different revisions. Keep source text or sensitive payloads out of the replay file when only predictions are needed. Do not include private customer data in a public contribution.

The current loader requires complete paired predictions for every record. It cannot perform valid counterfactual replay from selectively missing teacher answers. Collecting a fully paired dataset has an up-front cost separate from the simulated deployment cost. Replaying it does not save the actual money already spent collecting it.

Recorded latency is estimated from individual calls with a sequential serving model, not a measured end-to-end replay. Actual deployment must measure queueing, concurrency, API rate limits, retrieval, audit contention and timeout behavior separately. Audit seeds do not create new independent model samples; the ten runs share the same underlying recorded outputs.

## Prevent evaluation leakage

1. Split by time and source/template family, not just random rows. Deduplicate before splitting.
2. Use a pilot/tuning partition to choose all thresholds, budgets and reference models.
3. Use validation to freeze the exact experiment manifest and quality targets.
4. Keep the final chronological evaluation set untouched until configuration freezes.
5. Online paired feedback may update the deployed policy only after its defined arrival time. Evaluation labels never enter `route`, `complete`, context, threshold selection or event handling.
6. Record every model/prompt/schema version and discard incompatible evidence after a change.
7. Do not choose a baseline model by inspecting final evaluation accuracy.

The controller's internal disjoint tuning/validation blocks are online promotion evidence. They do not replace the outer experimental train/validation/test split.

## Metrics

Primary: task error against independent labels; error difference from teacher-only; total cost; fast-path coverage; cumulative errors after shift. Report per-node and end-to-end task success when nodes form a workflow.

Operational: serving p50/p95/p99, warm-up calls and payback point, audit count/cost, fallback count by reason, promotion/demotion counts, false demotions on stable traffic, detection delay and recovery delay, provider failures, missing/incomplete cost, and stale feedback.

Total cost includes successful and billed failed fast/teacher calls, audits, retries, retrieval and embeddings, and any other policy-specific service. Separate dataset-collection/development cost from deployment inference cost. Do not count an audit as free because it ran in the background.

Estimate paired error/cost differences on the same records. Account for temporal and source correlation using source-level or time-block bootstrap intervals; publish interval construction and seeds. Summarize variability over datasets/model pairs, not only different audit RNG seeds. For no observed failures, provide sample counts and uncertainty; never imply zero true risk.

## Policy caveats

The promotion Wilson endpoint is descriptive, with no claimed anytime-valid or distribution-shift guarantee. Repeated validation attempts and adaptive audits need more care than independent binomial trials. Audit disagreement is a monitoring signal against the teacher, not an unbiased estimate of task accuracy. The current adaptive boost is a heuristic to evaluate, not a contribution already established by experiment.

Both fixed and adaptive policies use an 8% base rate and a 12% cap in the synthetic harness. Adaptive boosts can spend differently. Compare realized spend and a full frontier before claiming an advantage. Fixed confidence may be an excellent cheap baseline on stable traffic; include it even when it outperforms the proposed method.
