<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

Rules for any coding agent (Claude Code, Codex, Kiro) working in this repo.

## What we're building

**Reflexes: agents that grow reflexes.** An agent harness that learns from its own experience. Every decision point in an agent starts on a System 2 LLM. Reflexes shadows each one with Jev, TypeSafe AI's System One model, and stores every outcome in MongoDB. When a decision point is reliable, it graduates to a ~100 ms reflex. If a reflex starts failing (drift), it is demoted, its question is rewritten by an evolver, and it re-graduates.

Demo workload: an online store's AI ops agent during a Black Friday surge, with 6 decision points per customer message: `intent`, `urgency`, `needs_human`, `tool`, `policy_ok`, `reply_ok`.

Built solo for the MongoDB x Cerebral Valley "Harness Engineering & Model Wrangling" hackathon, 2026-09-26. Primary track: Recursive Harnessing (statement 1). Secondary: Long Horizon (statement 2). Local context is in HACKATHON_PLAYBOOK.md (gitignored).

## Hard constraints

- **Deadline: 4:00pm EDT, 2026-09-26.** Code freeze at 3:05pm.
- The database is the MongoDB Atlas Hackathon Sandbox cluster. Don't use a different cluster.
- All code is written today. Don't paste in prior projects.
- No Streamlit (organizer rule).
- The repo is public, so no secrets in code, commits or logs.
- OpenRouter budget is about $10. Use cheap models for bulk calls, and don't write loops that make unbounded LLM calls.

## Stack

- Next.js 16 (App Router, TypeScript), Tailwind 4, Recharts. Deployed on Vercel.
- System 2: Vercel AI SDK 7 with `@openrouter/ai-sdk-provider`, and `zod` for structured output.
- System 1: Jev via OpenRouter's System One endpoint (`POST https://openrouter.ai/api/v1/systemone`, model `jev-1.13`, auth with `OPENROUTER_API_KEY`).
- Official `mongodb` Node driver 7. Scripts run with `tsx`.
- Model IDs live in `lib/models.ts`, never inline.

## Layout (planned)

```text
app/                    dashboard, plus API routes: /api/state, /api/run
lib/db.ts               cached MongoClient (one per serverless instance)
lib/models.ts           model IDs: system2, evolver, jev
lib/jev.ts              System One client: one fan-out call answers all reflex questions
lib/system2.ts          LLM teacher: structured answers for all decision points
lib/harness.ts          load and save harness versions (decision graph + reflex definitions)
lib/engine/decide.ts    route each decision point: system2 | shadow | reflex (+ confidence fallback + audit)
lib/engine/graduate.ts  aggregation stats per node, then promote or demote
lib/engine/evolve.ts    rewrite a reflex question from disagreement examples
scripts/seed.ts         generate labeled workload (base + "new product launch" drift batch)
scripts/run.ts          stream the workload through the agent
scripts/jev-smoke.ts    Jev connectivity check
```

## Data model (database from `MONGODB_DB`, default `reflexes`)

| Collection | Holds |
| --- | --- |
| `requests` | Workload messages: `text`, `facts` (precomputed order facts), `truth` (label per node), `batch` (base or launch) |
| `harness_versions` | `version`, `parent_id`, `nodes{ name: { mode, question, context_fields[], thresholds } }`, `reason`, `created_at` |
| `decisions` | One per request × node: `s2{answer, ms, cost}`, `s1{answer, confidence, ms}`, `mode_used`, `final`, `agree`, `correct`, `harness_version` |
| `events` | Timeline of promotions, demotions and rewrites: `type`, `node`, `from`, `to`, `detail`, `ts` |

## Engine rules

- **Hard metrics decide promotion, never vibes.** A node promotes when S1–S2 agreement is ≥ threshold over ≥ N shadow samples. It demotes when audited agreement falls below the demote threshold.
- In production there are no labels, so the engine uses S2 as teacher plus audit sampling. Ground-truth `truth` is only for reporting accuracy, which proves the engine isn't fooling itself.
- Jev is bad at math, dates and counting. Deterministic code computes facts (e.g. `within_refund_window: true`) and passes them as state. Never ask Jev to compute.
- Keep Jev state small and relevant (context policy per node). Irrelevant context degrades it.
- All reflex questions go in **one** Jev call per request (fan-out pattern).
- Log `ms` and `cost` for every S1 and S2 call. The demo depends on them.

## How to work

- **Demo first.** If a feature won't appear in the 60-second video, don't build it.
- Build the smallest thing that works end to end, then improve it. No speculative abstractions, and no test suite beyond the smoke scripts.
- Commit after each working milestone with a short message.
- Secrets live in `.env.local` (see `.env.example`). Never read, print or commit them.
- Ask before `git push`, `vercel --prod`, or anything that deletes data in Atlas.

## Commands

- `npm run dev`: local dashboard
- `npm run jev`: Jev smoke test
- `npm run seed`: generate and load the workload
- `npm run run`: stream the workload through the agent
- `npm run build`: production build (run it before deploying)
