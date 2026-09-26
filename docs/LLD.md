# Reflexes: Low-Level Design

This document covers the module-level design: data schemas, algorithms, constants, APIs and operations. For the big picture, start with [HLD.md](HLD.md).

## 1. Module map

| File | Responsibility | Key exports |
| --- | --- | --- |
| `lib/models.ts` | Every model ID and per-token price | `MODELS`, `PRICE` |
| `lib/db.ts` | One cached `MongoClient` per process (survives Next.js hot reload) | `getDb`, `closeDb` |
| `lib/workload.ts` | Node names, v0 harness, SOC taxonomy, labels, facts, context policy, actions, correctness | `NODES`, `initialHarness`, `stateFor`, `contextFacts`, `isCorrect`, `actionFor` |
| `lib/jev.ts` | System One HTTP client (OpenRouter `/api/v1/systemone`) | `askJev`, `JevQuestion`, `JevAnswer` |
| `lib/system2.ts` | Structured LLM call (AI SDK `generateText` + `Output.object`) | `askSystem2` |
| `lib/engine.ts` | Per-alert routing, fallbacks, async audit | `processRequest`, `readS1`, `AUDIT_RATE` |
| `lib/memory.ts` | Experience store, auto-embed vector index, recall, novelty, trust | `Memory`, `ensureVectorIndex`, `untrusted` |
| `lib/graduate.ts` | Promotion, demotion and rewrite rules | `Graduator`, `calibratedFloor` |
| `lib/evolve.ts` | Rewrites a reflex question and context policy | `rewriteQuestion` |
| `lib/runner.ts` | Run loop, versioning, events, audit application, credit stop | `runSurge`, `resetAll`, `latestHarness` |
| `app/api/state/route.ts` | Whole-run read API, archive selection, CDN caching | `GET` |
| `app/api/run/route.ts` | Local-only run trigger | `POST` |
| `app/(console)/layout.tsx`, `shell.tsx` | Console shell: sidebar navigation, workspace label, run picker (`?db=`), reflex-status pill, tour link | `ConsoleShell` |
| `app/(console)/page.tsx` | Overview: "as of alert N" rendering, replay, drill-down | default component |
| `app/(console)/decisions`, `memory`, `history`, `try` | Decision cards; memory search; version timeline; live triage of a pasted alert | pages |
| `app/(console)/data.ts` | Shared payload types, `useRun()` hook, event styles | `useRun`, `optionKeys` |
| `app/tour/page.tsx` | Product tour: six chapters pinned to real moments of the recorded run | default component |
| `lib/triage.ts` | Triage one pasted alert with the learned harness (Jev + Vector Search, no LLM call) | `triageAlert` |
| `lib/story.ts` | Story chapters (frame, caption, proof), pain line, plain-language legend | `CHAPTERS`, `PAIN`, `LEGEND`, `STORY_DB` |
| `scripts/*.ts` | Seed, index, run, archive, stats, headline, timing, probe, checks | CLI entry points |

## 2. Data model

Database: `MONGODB_DB` (default `reflexes`). Archives are sibling databases named `reflexes_<name>`.

### `requests`: the workload (static)

```ts
{ seq: number, batch: "base" | "campaign", text: string,
  facts: { asset_criticality: "high"|"low", user_privileged: boolean, threat_intel_match: boolean,
           off_hours: boolean, repeated_today: boolean },
  truth: { category: string, severity: 0|1|2|3, false_positive: boolean, escalate: boolean,
           playbook: string, auto_ok: boolean } }
// index: { seq: 1 } unique
```

### `harness_versions`: the harness itself

```ts
{ version: number, parent_version: number | null, reason: string, created_at: Date,
  nodes: Record<NodeName, {
    mode: "shadow" | "reflex",
    question: JevQuestion,              // noul | choice (criteria map) | score (criteria levels)
    context: ("text" | "facts")[],      // context policy: what the reflex sees
    thresholds: { promote_agreement, min_samples, confidence_floor, audit_rate,
                  demote_agreement, max_fallback_rate } }> }
```

### `decisions`: one document per alert × node

```ts
{ run_id, seq, node, harness_version, mode: "shadow"|"reflex",
  used: "system2" | "reflex" | "fallback",
  fallback_reason?: "low_confidence" | "novel" | "unproven_here",
  s1?: { answer, confidence }, s2?: answer, suggestion?: string,   // suggestion = proposed new option
  final: answer, agree?: boolean, correct: boolean, audited: boolean, text }
// index: { run_id: 1, node: 1, seq: -1 }
```

### `results`: one document per alert

```ts
{ run_id, seq, batch, ms, wait_ms, total_ms, backlog, cost, correct /* share of 6 */,
  reflex_share, recall_top, novel, action, harness_version, audited?, ts }
// index: { run_id: 1, seq: 1 }
```

### `experience`: vector memory

```ts
{ run_id, seq, text /* auto-embedded */, agree: Partial<Record<NodeName, boolean>>, ts }
// search index "experience_text": { type: "autoEmbed", path: "text", model: "voyage-4-lite" }
//                                 { type: "filter", path: "run_id" }
```

### `events` and `runs`

```ts
events: { run_id, type: "promote"|"demote"|"rewrite"|"novel", node: NodeName | null, detail,
          version, seq, ts, before?: { question, context }, after?: { question, context }, cluster_size?, alert? }
runs:   { _id: run_id, status: "running"|"done", started_at, finished_at?, total, processed }
```

## 3. Per-alert routing (`processRequest`)

```text
all      = the 6 nodes with their current config
s2First  = nodes in shadow mode
start askSystem2(s2First)               // in parallel
await runSystem1(all) and memory.recall(text)

for each node in reflex mode:
  if s1.confidence < floor         → fallback: low_confidence
  else if recall.novel             → fallback: novel
  else if untrusted(recall, node)  → fallback: unproven_here
await askSystem2(fallback nodes) together with s2First

decision.used  = shadow ? "system2" : fallback ? "fallback" : "reflex"
decision.final = used == "reflex" ? s1.answer : s2.answer
decision.agree = s1 and s2 both present ? s1 == s2 : undefined

with probability AUDIT_RATE and at least one reflex decision:
  audit = askSystem2(reflex nodes)       // not awaited; runner applies it later
```

**System 1 fan-out.** Nodes are grouped by context policy (for example `text` vs `text,facts`). Each group is one Jev call, and the groups run in parallel.

**Normalizing Jev answers (`readS1`):**

| Type | Answer | Confidence |
| --- | --- | --- |
| noul | `noul ≥ 0.5` | `max(noul, 1 − noul)` |
| choice | `choice` | `confidence` |
| score | most probable level, where probability keys are level indices or labels | `confidence` |

**System 2 model.** `openai/gpt-5.4-mini` with reasoning off and `maxOutputTokens` 600, set in `lib/models.ts`. Runs 1 and 2 used `anthropic/claude-sonnet-5`.

**System 2 schema.** For each node there's one zod field: an enum over the choice keys, an integer level index, or a boolean. Each choice node also gets `<node>__new_option: string | null`, which is how the teacher proposes a category the reflex doesn't have. Reasoning is disabled, and `maxOutputTokens` is 600.

**Facts are computed in code.** `contextFacts` adds `auto_fix_eligible = asset low && !privileged`, because Jev isn't built to combine facts.

## 4. Memory (`lib/memory.ts`)

- **Recall.** `$vectorSearch` on `experience` with the plain alert text: `limit 5`, `numCandidates 60`, `filter { run_id }`. It returns the top-1 similarity, the neighbor seqs, and per-node trust, i.e. the share of neighbors where that node agreed with the teacher.
- **Novelty.** An alert is novel if the top-1 similarity is below the 5th percentile of the last 150 top-1 scores. It only activates after 30 experiences. The threshold adapts: once campaign alerts are in memory, later ones match them and stop counting as novel.
- **Trust.** A node is `unproven_here` if at least 3 neighbors carry an agreement flag for it and their agreement is below 0.5.
- **Similar-case cluster for the evolver.** `similarSeqs(text, k)` returns up to k similar alerts (`numCandidates 100`).
- **State.** The novelty window and count live in process memory, per run.

## 5. Graduator (`lib/graduate.ts`)

Per-node windows hold shadow samples `{agree, conf}`, audit results, low-confidence fallback flags, and taxonomy-gap flags. Any result computed under an older question version (`harness_version < questionSince[node]`) is ignored.

**Promotion.** `calibratedFloor(last 20 shadow samples)`:

```text
sort samples by confidence ascending
for i in 0 .. n·(1 − MIN_COVERAGE):
  above = samples[i..]
  if agreement(above) ≥ FLOOR_AGREEMENT:
    return floor = max(0.5, samples[i].conf), coverage = |above| / n, agreement
return null
```

In practice, with n = 20 and a 97% target, this needs **zero disagreements** above the floor on at least 12 samples. On promotion, the node's `confidence_floor` is set to the returned floor, and the event text reads "agrees X% on the Y% of cases it is confident about (floor Z)".

**Rewrite triggers:**

- **Stuck:** at least 20 shadow samples since the last rewrite, with plain agreement below 85%.
- **Taxonomy gap:** at least 5 System 2 answers observed, and at least 3 of the last 10 carried a `__new_option` suggestion.

**Demotion triggers (reflex mode):**

- **Audits:** at least 4 of the last 6 audits observed, and agreement below `demote_agreement` (0.75).
- **Low confidence:** at least 10 of the last 15 decisions observed, and the low-confidence fallback rate above `max_fallback_rate` (0.55). Novelty and unproven fallbacks don't count.

A demotion always queues a rewrite. There's one change per node per observation.

## 6. Evolver (`lib/evolve.ts`)

- **Input:**
  - the current question and context policy
  - the reason for the rewrite
  - up to 15 problem examples: the 10 most recent disagreements, fallbacks or suggestions for the node, plus decisions from the Vector Search cluster around the newest one
  - the teacher's proposed options
- **Model:** `anthropic/claude-sonnet-5` with reasoning off; `maxOutputTokens` 2000.
- **Output (zod):**
  - `instructions`
  - `criteria`: option list for choice nodes; the same number of levels for score nodes; null for noul
  - `context` ⊆ {text, facts}
  - `reason`, 15 words or fewer
- **Effect:** a new harness version with the rewritten question and context, and the node reset to shadow. The event stores `before` and `after`. There are at most 2 rewrites per node per run.

## 7. Runner (`lib/runner.ts`)

- **Arrivals.** Alert *i* arrives at `start + i / arrivalsPerSec`. A pool of `concurrency` workers pulls from the queue. Defaults are 3 alerts/s and 6 workers.
- **Versioning.** All harness changes go through one promise chain (`withLock`), so versions stay linear. `newVersion` clones the current harness, applies the change, and inserts it with `parent_version` and `reason`.
- **Writes.** `results`, `decisions`, `experience` and `runs.processed` are written after the decision is served, and are tracked in a `pending` set that's drained before the run ends.
- **Async audit.** When an audit resolves:
  - `$inc` the audit cost into `results.cost` and set `audited`
  - update `decisions.s2`, `agree`, `audited` and `suggestion`
  - update `experience.agree.<node>`
  - feed the late decisions to the graduator (`late = true`, so they don't count as fallbacks)
- **Novelty events** are throttled to at most one every 10 alerts.
- **Credit stop.** A `402` or "credits" error stops the loop cleanly and keeps everything recorded so far.
- **`resetAll`** empties all run collections and inserts the v0 harness. Always archive before resetting (see §10).

## 8. Constants

| Constant | Value | Where | Effect |
| --- | --- | --- | --- |
| `min_samples` | 20 | `workload.ts` thresholds | Promotion window |
| `FLOOR_AGREEMENT` | 0.97 | `graduate.ts` | Agreement required on confident cases |
| `MIN_COVERAGE` | 0.6 | `graduate.ts` | Share of cases the reflex must handle |
| `REWRITE_AFTER` / `REWRITE_BELOW` | 20 / 0.85 | `graduate.ts` | Stuck-node rewrite |
| `GAP_WINDOW` / `GAP_MIN` | 10 / 3 | `graduate.ts` | Taxonomy-gap rewrite |
| `demote_agreement` | 0.75 | `workload.ts` thresholds | Audit demotion |
| `max_fallback_rate` | 0.55 | `workload.ts` thresholds | Low-confidence demotion |
| `AUDIT_RATE` | 0.08 | `engine.ts` | Share of alerts audited in the background |
| `MAX_REWRITES_PER_NODE` | 2 | `runner.ts` | Evolver budget |
| `K`, `WARMUP`, `NOVEL_PERCENTILE`, `NOVEL_WINDOW` | 5, 30, 0.05, 150 | `memory.ts` | Recall and novelty |
| `TRUST_MIN`, `TRUST_MIN_CASES` | 0.5, 3 | `memory.ts` | Unproven-on-similar-alerts fallback |
| `promote_agreement`, `audit_rate` | 0.9, 0.15 | `workload.ts` thresholds | **Unused.** The code uses `FLOOR_AGREEMENT` and `AUDIT_RATE`. |

## 9. APIs

### `GET /api/state[?db=run1|run2|run3]`

This endpoint returns the latest run in the chosen database. `db` is whitelisted to the archive databases.

```ts
{ run: { id, status, processed, total, started_at } | null,
  canRun: boolean,                       // ALLOW_RUN=1 and not an archive
  versions: HarnessVersion[],            // all versions, ascending
  series: { seq, batch, novel, recall_top, ms, ms_raw, wait, cost, accuracy, reflex }[],  // rolling 20 via $setWindowFields
  decisions: { seq, node, used, agree, audited, mode, v, reason, conf }[],
  events: Event[],                       // ascending by time, with before/after on rewrites
  alerts: { seq, text /* 220 chars */, action, novel, batch }[] }
```

- **Caching.** Finished runs are served with `s-maxage=30, stale-while-revalidate=300`; live runs use `no-store`.
- **Alert texts** are cached per database in the server process.

### `POST /api/triage`

The request is `{ text, facts? }`. Jev answers all six questions under the latest harness, and `$vectorSearch` over the live experience memory gives novelty, trust and the top 3 neighbors. **No LLM is called**; decisions that would need one come back as `handed_back` or `llm_learning`. It costs about $0.00004 per call.

- **Response:** `{ ms, cost, harness_version, novel, top, decisions[{ node, label, answer, confidence, floor, route, reason }], neighbors[{ seq, text, score }], action }`
- **Limits:** 2,000 characters per alert and 20 requests per IP per minute (in-memory, per instance).

### `GET /api/similar?q=`

A semantic search of the live `experience` memory, filtered to the latest run (`limit 8`, `numCandidates 120`). It returns `{ results[{ seq, text, score, agree }] }` and backs the Memory page.

### `POST /api/run`

This starts `runSurge({ reset: true })` in the background. It only works when `ALLOW_RUN=1`, and returns 403 otherwise. It isn't intended for serverless use.

## 10. Console (`app/(console)`) and product tour (`app/tour/page.tsx`)

- **One payload, rendered as of alert N.**
  - Live mode sets N to the last processed seq.
  - Replay moves N forward on a 100 ms timer, `speed` alerts per tick.
  - Replay holds 1.5 s on each promote, demote or rewrite event, and on the first novel event.
- **Node state at N.**
  - The harness version at N is the largest version among events at or before N.
  - For nodes in shadow, agreement is measured over the last 20 shadow decisions since the node's latest rewrite.
  - For reflex nodes, agreement comes from the last 10 audits, and the bar shows the reflex share.
- **Metrics.** Rolling 20-alert windows:
  - "was" is the rolling value at alert 20, when everything is still on the LLM.
  - An alert has "no LLM call" when all 6 decisions were served by reflexes.
  - "All-reflex alerts" is the median raw latency of those alerts.
- **URL parameters.** They're applied once, on the first payload:

  | Parameter | Effect |
  | --- | --- |
  | `?db=run3` | Show an archived run |
  | `?replay=1` | Start the replay automatically |
  | `?speed=N` | Replay speed (N alerts per tick) |
  | `?at=N` | Freeze on alert N |
  | `?node=<name>` | Open that node's detail panel |

  A read-only deployment replays a finished run automatically.

**Product tour (`/tour`).** `/details` redirects to `/` for old links.
- It loads `/api/state?db=run3` once. Each chapter in `lib/story.ts` pins a frame (`at`), an optional animation start (`from`), a focus card and an example alert.
- **Next**, the chapter pills, or ←/→ move between chapters; `?ch=N` opens one directly. A chapter with `from` animates the cursor from `from` to `at` over 2.6 s.
- Each card shows one plain state:

  | State | When |
  | --- | --- |
  | 🧠 Asking the LLM | The node is in shadow mode |
  | ⚡ Reflex | The node is a reflex |
  | ↩ Handed back to the LLM | The node is a reflex, but the example alert's decision fell back |
  | ✎ Rewriting itself | The node is in shadow after a demotion or rewrite, with no promotion since |

- A card shows chips for choice options that a rewrite added, e.g. `+ ai_agent_prompt_injection`.
- The chapter-6 result numbers are constants taken from README → Results.

## 11. Operations

| Task | Command |
| --- | --- |
| Check connectivity (Atlas + OpenRouter credit) | `npx tsx scripts/check.ts` |
| Jev smoke test | `npm run jev` |
| Create the auto-embed vector index | `npx tsx scripts/index.ts` |
| Load the workload (cached in `data/alerts.json`; `--fresh` regenerates it) | `npm run seed` |
| Run (resets run collections) | `npm run run -- --limit 360 --rate 3 --concurrency 6` |
| **Archive before any new run** | `npx tsx scripts/archive.ts reflexes_run4` |
| Per-node stats / headline numbers | `npx tsx scripts/stats.ts` · `npx tsx scripts/headline.ts [db]` |
| Latency probe / offline agreement probe | `npx tsx scripts/timing.ts` · `npx tsx scripts/probe.ts 20 0` |

After archiving, add the new archive name to `ARCHIVES` in `app/api/state/route.ts`.

## 12. Failure handling

| Failure | Behavior |
| --- | --- |
| Model call throws | Retried once per alert. If it fails again, the alert is skipped and the run continues. |
| Out of OpenRouter credit (402) | The run stops cleanly, and everything recorded is kept |
| Vector index not ready or query error | Recall returns "unavailable". Reflexes act without memory guardrails, and a warning is logged once. |
| Async audit fails | Logged. The alert keeps its reflex decision. |
| Unhandled promise rejection | Logged by `scripts/run.ts`, and the run keeps going |
| Jev hangs | **Not handled.** There's no fetch timeout, so a worker stalls (see HLD §10). |

## 13. Security

- Secrets live only in `.env.local`, which is gitignored and denied to agents in `.claude/settings.json`.
- The deployed app is read-only. `ALLOW_RUN` is unset there, and `?db=` is whitelisted.
- `/api/state` exposes synthetic alert data only.
- Recommended: a read-only Atlas user for the deployment.
