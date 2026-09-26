# Reflexes

**Agents that grow reflexes.** An agent harness that gets faster and cheaper the longer it runs, without losing accuracy.

- Demo video: TODO
- Live app: TODO
- Built for the MongoDB x Cerebral Valley Harness Engineering & Model Wrangling Hackathon (NYC, Sep 26 2026). Tracks: Recursive Harnessing (primary) and Long Horizon Engineering.

## The problem

When you learned to drive, you thought hard about every mirror check. A year later it was reflex. AI agents never make that jump. Every small decision, like what kind of alert this is, how severe it is, or which playbook to run, goes through a slow, expensive LLM call, forever. During an alert storm that means a queue, and a real intrusion waiting in line behind hundreds of noisy alerts.

Demo workload: a security operations center (SOC) agent triaging an alert storm, with six decisions per alert. Midway through, a new attack campaign (attacks on the company's own AI agents) appears.

## What Reflexes does

1. **Shadow.** Every decision point runs on a System 2 LLM and, in parallel, on Jev, TypeSafe AI's System One model. Every outcome is stored in MongoDB.
2. **Graduate.** When a decision point's agreement is high enough, it becomes a ~100 ms reflex, with a confidence floor the harness sets for itself from Jev's calibration.
3. **Recall before acting.** Atlas Vector Search pulls the most similar past alerts from experience memory. A reflex fires only if the alert isn't novel and the reflex proved reliable on those similar cases. Otherwise System 2 decides.
4. **Audit.** A small sample of reflex decisions is re-checked by the LLM.
5. **Demote and rewrite.** When the world changes, the reflex is demoted. The evolver rewrites its question (adding categories the teacher keeps proposing) and its context policy, using a Vector Search cluster of the problem cases, and it graduates again.

TODO: confirm against the final build.

## Results

TODO: latency, cost per request and accuracy before and after, the graduation timeline, and the drift recovery.

## How MongoDB is used

| Feature | Role |
| --- | --- |
| Documents | The harness itself (decision graph, reflex questions, thresholds) is a versioned document with lineage |
| Decision memory | Every S1 and S2 decision is stored and becomes the experience that reflexes are learned from |
| Aggregation pipelines | Rolling agreement per decision point drives promotion and demotion, plus the dashboard |
| Vector Search (Automated Embedding) | Recall before every reflex: novelty detection and "proven on similar alerts" trust, plus the evolver's example cluster |

TODO: confirm once built.

## Model wrangling

- System 2: an LLM on OpenRouter with structured output
- System 1: Jev (`jev-1.13`), also through OpenRouter
- The harness decides, per decision point, which system handles it

## Architecture

TODO: diagram.

## Run it locally

```bash
cp .env.example .env.local   # fill in MONGODB_URI, MONGODB_DB, OPENROUTER_API_KEY
npm install
npm run jev    # check Jev connectivity
npm run seed
npm run run
npm run dev
```

## Team

- Amey Borkar
