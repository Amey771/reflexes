# AGENTS.md

Rules for any coding agent (Claude Code, Codex, Kiro) working in this repo.

## What we're building

**Antibody: agents that heal themselves.** A customer-support agent for a small online store runs a suite of tickets. Its failures (wrong refunds, leaked data, prompt injections) become incidents. An evolver model turns each incident into a new harness version: a rule, a tool precondition, or revoked tool access. We keep the version only if it measurably helps.

Built solo for the MongoDB x Cerebral Valley "Harness Engineering & Model Wrangling" hackathon, 2026-09-26. Full context, judges and timeline are in [HACKATHON_PLAYBOOK.md](HACKATHON_PLAYBOOK.md).

## Hard constraints

- **Deadline: 4:00pm EDT, 2026-09-26.** Code freeze at 3:05pm.
- The database is the MongoDB Atlas Hackathon Sandbox cluster. Don't use a different cluster.
- All code is written today. Don't paste in prior projects.
- No Streamlit (organizer rule).
- The repo goes public, so no secrets in code, commits or logs.

## Stack

- Next.js (App Router, TypeScript), Tailwind, shadcn/ui, Recharts. Deployed on Vercel.
- Vercel AI SDK with `@openrouter/ai-sdk-provider` for every LLM call. `zod` for structured output.
- Official `mongodb` Node driver. Scripts run with `tsx`.
- Model IDs live in one place (`lib/models.ts`), never inline.

## Layout (planned)

```
app/                 UI pages and API routes
lib/db.ts            cached MongoClient (one per serverless instance)
lib/models.ts        OpenRouter model IDs: agent, evolver, attacker
lib/engine/
  harness.ts         load and save harness versions
  tools.ts           store tools plus precondition enforcement
  agent.ts           tool-calling support agent built from a harness doc
  grader.ts          deterministic checks on DB state and the tool log
  evolver.ts         incidents in, harness patch out (generateObject + zod)
  run.ts             run a suite for one harness version
scripts/seed.ts      reset and seed the store world and scenarios
scripts/evolve.ts    N generations: run, grade, evolve, keep or roll back
data/scenarios.json  legitimate and trap tickets, train and holdout splits
```

## Data model (database `antibody`)

| Collection | Holds |
| --- | --- |
| `customers`, `orders` | The store world. Reseeded before every suite run so runs are independent. |
| `harness_versions` | `version`, `parent_id`, `rules[]`, `tool_policies{}`, `model`, `score{exploit_rate, legit_success, cost_usd}`, `status` (kept or rolled_back), `diff_summary` |
| `scenarios` | `kind` (legit or trap), `split` (train or holdout), `messages[]`, `checks[]` |
| `runs` | `harness_version`, `scenario_id`, `transcript`, `tool_calls[]`, `passed`, `failures[]`, `cost_usd` |
| `incidents` | `text` (autoEmbed vector index), `scenario_id`, `harness_version`, `failure_type`, `patch` |

## Engine rules

- **Pass/fail is deterministic.** The grader checks DB state and the tool-call log. Never use an LLM as the judge of pass/fail.
- **Guardrails are enforced in code.** Tool preconditions in `tool_policies` are checked in `tools.ts` before a tool executes, not just written into the prompt.
- **Keep or roll back:** keep a new version only if holdout exploit rate falls and legitimate success drops no more than 5 points. Otherwise mark it `rolled_back`.
- The evolver pulls similar past incidents with `$vectorSearch` before writing a patch.
- Log cost per run, because the model-routing story needs it.

## How to work

- **Demo first.** If a feature won't appear in the 60-second video, don't build it. The cut order is in the playbook's timeline section.
- Build the smallest thing that works end to end, then improve it. No speculative abstractions, and no test suite beyond one smoke script.
- Commit after each working milestone with a short message.
- Secrets live in `.env.local` (see `.env.example`). Never read, print or commit them.
- Ask before `git push`, `vercel --prod`, or anything that deletes data in Atlas.

## Commands

Filled in once the app is scaffolded:

- `npm run dev`: local app
- `npm run seed`: reset the world and load scenarios
- `npm run evolve`: run the evolution loop
- `npm run build`: production build (run it before deploying)
