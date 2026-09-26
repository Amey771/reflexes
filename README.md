# Antibody

**Agents that heal themselves.** Every agent incident becomes a permanent, tested guardrail, automatically.

- Demo video: TODO
- Live app: TODO
- Built for the MongoDB x Cerebral Valley Harness Engineering & Model Wrangling Hackathon (NYC, Sep 26 2026), problem statement 1: Recursive Harnessing.

## The problem

Production agents repeat the same mistakes, such as refunding the wrong order, leaking another customer's data, or obeying instructions hidden in user input. Today an engineer reads the logs and hand-patches the prompt. That doesn't scale, and a fix for one case often breaks another.

## What Antibody does

TODO: one-paragraph summary once built.

1. **Run.** A support agent handles a suite of legitimate tickets and traps against a real store database.
2. **Grade.** Deterministic checks on database state and the tool-call log: was a refund written, was it over policy, did another customer's data leak?
3. **Evolve.** Each failure becomes an incident. An evolver model retrieves similar past incidents with Atlas Vector Search, then writes a patch: a rule, a tool precondition, or revoked tool access.
4. **Verify.** The new harness version replays the suite plus held-out attack variants it never saw. It's kept only if exploits fall and legitimate tickets still succeed. Otherwise it rolls back.

## Results

TODO: exploit rate and legitimate-success rate per generation, the model × harness table, and a screenshot.

## How MongoDB is used

| Feature | Role |
| --- | --- |
| Flexible documents | The harness itself is a versioned document with parent lineage, so the evolver can add new guardrail types without a migration |
| Atlas Vector Search (Automated Embedding) | Incident memory: retrieve similar past failures before writing a patch |
| Aggregation pipelines | Scores per generation, cost rollups, and the dashboard |
| Store collections | Ground truth for the grader |

TODO: confirm once built.

## Model wrangling

TODO: the agent, evolver and attacker models on OpenRouter, and the cost and quality comparison.

## Architecture

TODO: diagram.

## Run it locally

```bash
cp .env.example .env.local   # fill in MONGODB_URI, OPENROUTER_API_KEY
npm install
npm run seed
npm run evolve
npm run dev
```

## Team

- Amey Borkar
