<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

Rules for any coding agent (Claude Code, Codex, Kiro) working in this repo.

## What this is

**Reflexes: agents that grow reflexes.** Every decision point in an agent starts on a System 2 LLM. Reflexes shadows each one with Jev, TypeSafe AI's System One model, and stores every outcome in MongoDB. When a decision point proves reliable, it's promoted to a reflex with a confidence floor it sets itself. Before a reflex acts, Atlas Vector Search checks that the alert resembles cases where that reflex has proven itself. Background audits and confidence collapse demote reflexes. An evolver then rewrites the reflex's question (options, instructions, context policy), and the node relearns.

Demo workload: a SOC agent with 6 decisions per alert (`category`, `severity`, `false_positive`, `escalate`, `playbook`, `auto_ok`). A campaign of attacks on AI agents starts at alert #246, and the v0 taxonomy has no category for it.

Built solo for the MongoDB x Cerebral Valley "Harness Engineering & Model Wrangling" hackathon, 2026-09-26. Primary track: Recursive Harnessing. Secondary: Long Horizon.

**Read first:** [docs/HLD.md](docs/HLD.md) (architecture) and [docs/LLD.md](docs/LLD.md) (schemas, algorithms, constants, APIs, operations). Results are in [README.md](README.md#results).

## Status (2026-09-26, afternoon)

- The final run is done: **run #3** (360 alerts, gpt-5.4-mini teacher). It's live in `reflexes` and archived as `reflexes_run3`. Backups: `reflexes_run1` (Sonnet teacher, full) and `reflexes_run2` (Sonnet teacher, cut at 259 by the credit cap).
- **The engine is frozen**, and the OpenRouter budget is nearly exhausted. Don't start new runs without asking the user.
- Code freeze is 3:05pm EDT; the deadline is 4:00pm EDT.

## Hard constraints

- The database is the MongoDB Atlas Hackathon Sandbox cluster. Don't use a different cluster.
- All code is written today. Don't paste in prior projects.
- No Streamlit (organizer rule).
- The repo is public, so no secrets in code, commits or logs.
- **`resetAll` (run by `npm run run` unless you pass `--keep`) wipes every run collection.** Archive first with `npx tsx scripts/archive.ts reflexes_<name>`, then add the name to `ARCHIVES` in `app/api/state/route.ts`.

## Stack

- Next.js 16 (App Router, TypeScript), Tailwind 4, Recharts.
- System 2 and the evolver: Vercel AI SDK 7, `@openrouter/ai-sdk-provider`, `zod`.
- System 1: Jev through OpenRouter's System One endpoint (`POST https://openrouter.ai/api/v1/systemone`, model `jev-1.13`).
- MongoDB Node driver 7. Vector Search with Automated Embedding (`voyage-4-lite`). Scripts run with `tsx`.
- Model IDs live only in `lib/models.ts`.

## Layout

```text
app/page.tsx               story mode (default): six chapters pinned to run-3 moments (?ch=N, ←/→)
app/details/page.tsx       dashboard: renders a run "as of alert N" (live, replay, ?db= ?at= ?node= ?replay= ?speed=)
lib/story.ts               story chapters, pain line, plain-language legend
app/api/state/route.ts     whole-run read API (+ archive whitelist, CDN cache for finished runs)
app/api/run/route.ts       local-only run trigger (ALLOW_RUN=1)
lib/models.ts              model IDs and prices
lib/db.ts                  cached MongoClient
lib/workload.ts            nodes, v0 harness, taxonomy, labels, facts, context policy, actions, correctness
lib/jev.ts                 System 1 client (fan-out)
lib/system2.ts             System 2 client (structured output, new-option suggestions)
lib/engine.ts              per-alert routing, fallbacks (low confidence / novel / unproven), async audit
lib/memory.ts              experience store, auto-embed index, $vectorSearch recall, novelty, trust
lib/graduate.ts            calibrated promotion, demotion, rewrite triggers
lib/evolve.ts              rewrites a reflex question + context policy
lib/runner.ts              run loop, harness versioning, events, audit application, credit stop
scripts/                   seed, index, run, archive, stats, headline, timing, probe, check, jev-smoke
data/alerts.json           the 450 generated, labeled alerts (seed cache)
docs/HLD.md, docs/LLD.md   design docs
docs/DEMO.md               demo kit: video script, table demo, Q&A, submission text
```

## Data model (summary; full schemas in LLD §2)

| Collection | Holds |
| --- | --- |
| `requests` | Workload alerts: `text`, `facts`, `truth`, `batch` |
| `harness_versions` | The harness itself: `version`, `parent_version`, `reason`, `nodes{mode, question, context, thresholds}` |
| `decisions` | Per alert × node: `s1{answer, confidence}`, `s2`, `used`, `fallback_reason`, `suggestion`, `final`, `agree`, `correct`, `audited` |
| `results` | Per alert: `ms`, `cost` (audits included), `correct`, `reflex_share`, `recall_top`, `novel`, `action` |
| `experience` | Processed alerts + per-node agreement; `text` auto-embedded (index `experience_text`) |
| `events` | `promote`, `demote`, `rewrite` (with `before` and `after`), and `novel` |
| `runs` | Run status and progress |

## Engine rules

- **Hard metrics only.**
  - Promotion needs a calibrated floor: at least 97% agreement with the teacher on at least 60% of the last 20 shadow samples.
  - Demotion happens when audit agreement drops below 0.75, or when the low-confidence fallback rate exceeds 0.55.
- **Labels are for reporting only.** The engine learns from System 2 and audits. `truth` exists only to prove accuracy.
- **Keep audits off the latency path.** They're async, sample 8% of alerts, and their cost goes into `results.cost`.
- **Only low-confidence fallbacks count against a reflex.** Novelty and unproven-on-similar-alerts fallbacks don't.
- **Jev can't do math or dates.** Compute facts in code (`contextFacts`, including `auto_fix_eligible`).
- **Keep Jev state small** with the per-node context policy, and send one Jev call per context group.
- **Log `ms` and `cost` for every call.**

## Team split (during the hackathon)

- The engine session owned `lib/` and `scripts/`, plus all runs, seeds, resets and archives.
- The dashboard session owns `app/`, `README.md` and `docs/`.
- Root files like this one are shared: keep edits small and say what changed.
- Only the engine owner runs anything that writes to the `reflexes` db.

## How to work

- **Demo first.** If a change won't show up in the 60-second video or the judges' walkthrough, skip it.
- Build the smallest thing that works end to end. No test suite beyond the scripts.
- Before you commit, run `npx tsc --noEmit -p .` and `npx eslint app lib scripts`. Run `npx next build` before any deploy.
- Commit after each working milestone; pushing to `main` is approved. Run `git pull --rebase` before you push.
- Secrets live in `.env.local` (see `.env.example`). Never read, print or commit them.
- Ask the user before `vercel --prod`, before any new run, or before anything that deletes data in Atlas.

## Commands

- `npm run dev`: story mode at http://localhost:3000, dashboard at `/details` (try `/details?db=run3&replay=1&speed=2`)
- `npm run build && npm start`: production build (no dev badge, for recording)
- `npm run jev`, `npx tsx scripts/check.ts`: connectivity
- `npm run seed`, `npx tsx scripts/index.ts`, `npm run run`: workload, vector index, run
- `npx tsx scripts/archive.ts reflexes_<name>`: archive the current run
- `npx tsx scripts/stats.ts`, `npx tsx scripts/headline.ts [db]`: numbers
