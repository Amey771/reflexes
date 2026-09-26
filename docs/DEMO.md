# Reflexes: demo kit

The scripts for the 60-second video, the live table demo, and judge Q&A. They follow the six story-mode chapters in [`lib/story.ts`](../lib/story.ts), each pinned to a real moment in run 3 (`/?db=run3`).

## Numbers (run 3, the only figures to quote)

| Window | Median decision | Cost per 1,000 alerts | Accuracy (held-out labels) | Alerts with no LLM call |
| --- | --- | --- | --- | --- |
| Baseline: first 20 alerts, all on the LLM | 886 ms | $1.03 | 95.8% | 0% |
| Steady state: alerts #100–245 (81% of decisions off the LLM: 707 of 876) | — | **$0.40 (2.6× lower)** | 91.8% | **38%** |
| All-reflex alerts only | **257 ms** (vs 890 ms all-LLM, 3.5×) | | | |

With a frontier teacher (run 2, Sonnet 5), the reflex path is **10× faster**: 238 ms vs 2.4 s.

**Honesty rules:**
- Never say "same accuracy". Say "96% → 92%, a 4-point trade for 2.6× lower cost".
- Always give the source for "10×": run 2, frontier teacher.
- Average latency improves only about 10%. The speed claim is about alerts handled entirely by reflexes.

## The one-breath pitch

> "AI agents send every small decision to an LLM, forever. Reflexes watches those decisions, promotes the ones a fast System One model gets right into 250 ms reflexes, and uses MongoDB memory to know when not to trust them. It gets cheaper the longer it runs, and rewrites itself when the world changes."

## Video, 60 seconds

Record story mode with `npm run build && npm start`, Chrome at 1440×900, clicking Next through the chapters. Record the voiceover first if clicking and talking at once is hard.

| Time | Chapter | On screen | Voiceover |
| --- | --- | --- | --- |
| 0:00–0:08 | 1 · The problem | 6 cards 🧠 "Asking the LLM"; alert #3 | "When you learned to drive, you thought about every mirror check. Now it's reflex. AI agents never make that jump: every decision goes to an LLM, forever." |
| 0:08–0:20 | 2 · It learns | Cards flip ⚡ green, #19–24 | "Reflexes shadows each decision with Jev, a new System One model, and remembers every outcome in MongoDB. Where Jev agrees 100% on the cases it's sure about, that decision becomes a reflex, and it sets its own safety threshold." |
| 0:20–0:28 | 3 · It corrects itself | "Page analyst?" ↓, then ✎, then ⚡ | "When a reflex gets unsure, it steps back, rewrites its own question, and earns its promotion again." |
| 0:28–0:42 | 4 · Something new | Alert #246, handed back ↩ | "Then a new attack hits: a prompt-injected coding agent trying to read cloud credentials. Memory finds nothing similar, so the reflexes hand it to the LLM. No guessing." |
| 0:42–0:50 | 5 · It rewrote itself | Category card: "+ ai_agent_prompt_injection" | "The harness adds a new attack category to its own taxonomy, and re-learns it." |
| 0:50–1:00 | 6 · The result | 81% of decisions off the LLM · 2.6× cheaper · 96% → 92% | "Eighty-one percent of decisions moved off the LLM, two point six times cheaper, and alerts handled by reflexes alone come back in a quarter second. Reflexes: agents that grow reflexes, and know when not to trust them." |

About 150 words. Rehearse it 3 times with a timer.

## Table demo, 2–3 minutes: a story told through the real app

The app is a product console (Overview · Decisions · Memory · Harness history · Try it). The demo walks through it as a story: **pain → it learned → it rewrote itself → try it live → the numbers.** Use the Product tour only for the video.

| Step | Where | What you do | What you say |
| --- | --- | --- | --- |
| 1 · Pain (15 s) | Overview, run picker on **Run 3** | Point at the decision pipeline | "This is a security team's AI agent. Every alert needs 6 decisions, and normally every one goes to an LLM, forever. This morning, that's where it started." |
| 2 · It learned (30 s) | **Decisions** | Point at the green ⚡ cards and one threshold | "Reflexes shadowed each decision with Jev. Within 24 alerts, all six became reflexes. Each one set its own confidence threshold: it only acts alone where it agreed 100% with the LLM." |
| 3 · It rewrote itself (30 s) | **Harness history** | Open the category rewrite at #325 | "Then attacks on AI agents started. The harness had no category for them, so it demoted that reflex, wrote a new category into its own question, and re-learned it. Every version is a MongoDB document." |
| 4 · Try it live (45 s) | **Try it**, 3 presets | Click **Known attack**, then **Learned today**, then **Never seen** | Known: "Familiar attack: five of six decisions are reflexes, in milliseconds." Learned today: "This morning it had never seen prompt injection. Now it recognizes it, and here are the 3 similar alerts in MongoDB memory it's relying on." Never seen: "Something it has never seen: Vector Search finds nothing close, so all six go to the LLM. It knows what it doesn't know." |
| 5 · Numbers (15 s) | Overview | Point at the KPI tiles | "81% of decisions moved off the LLM, 2.6× cheaper per alert, 38% of alerts with no LLM call at all, and a 4-point accuracy trade we show openly." |
| 6 · Hand over | Try it | Give the judge the keyboard | "Paste any alert you like." |

**Presets (tested live):**
- *Known attack:* Okta brute force from a Tor exit node against an admin, then success. 5/6 reflex; Attack type handed back (0.52 < its 0.93 threshold). Say "it's honest about the one it's unsure of".
- *Learned today:* chatbot prompt injection that leaks a Stripe key pattern. Attack type reflex at 1.00; 3 similar campaign alerts in memory.
- *Never seen:* physical tailgating at a loading dock. Novel (closest match 0.70); all 6 handed to the LLM.

## Judge Q&A

- **"What problem does this solve?"** Agents at volume pay an LLM call for every small decision, forever. The cost is linear and the latency never improves. Today, engineers move steps to cheaper models by hand and never notice drift.
- **"What's novel?"** Four things together, which we haven't seen combined:
  1. Promotion per decision, calibrated on the model's own confidence.
  2. Vector-Search memory as a trust check before every reflex.
  3. A harness that rewrites its own questions, including its taxonomy.
  4. Built on a System One model (Jev) released 11 days ago.
- **"Isn't this a model router?"** A router picks one model per request up front and never checks the result. Reflexes works per decision inside the agent, promotes on evidence, audits after promotion, demotes on drift, and rewrites itself.
- **"How is it different from fine-tuning or distillation?"** There's no training. Promotion takes minutes and demotion is instant. You can see and roll back every change as a versioned MongoDB document.
- **"Why not use Jev from day one?"** You don't know which decisions it's reliable on for your workload. Reflexes measures that per decision, and some decisions never graduate.
- **"Why did accuracy drop 4 points?"** Reflexes match the teacher on confident cases; the gap comes from cases near the threshold. Raising the agreement target trades coverage for accuracy. It's a dial, and every run records it. The engine never sees the labels.
- **"Where's MongoDB?"**
  - The harness itself is a versioned document with lineage.
  - Every decision is stored: it's the experience and the audit trail.
  - Vector Search with Automated Embedding checks, before every reflex, whether it has proven itself on similar alerts. It also finds the cluster of cases the evolver learns from.
  - Window functions compute the live metrics.
- **"Would you trust this for security?"**
  - Facts are computed deterministically in code.
  - Low-confidence, novel and unproven cases all go to the LLM.
  - Audits continue after promotion.
  - Every decision is logged.
  - Critical decisions can be pinned to the LLM.
- **"How does it scale?"**
  - Wrap any decision point in any agent framework.
  - One harness document per tenant.
  - More traffic makes decisions graduate faster, so cost per task falls, which is the opposite of normal LLM economics.
  - Jev answers all 6 decisions in about 250 ms.
- **"What's the business?"** Any company running agents at volume (SOC, support, fraud, ops) pays per decision. Reflexes turns a linear LLM bill into a falling one, with an audit trail compliance teams accept.

## Submission text

**Tagline:** Agents that grow reflexes: a self-improving harness that gets cheaper and faster the longer it runs, and knows when not to trust itself.

**Description:**

> AI agents send every small decision (classify, prioritize, route, check policy) to a slow, expensive LLM, forever. Reflexes is a self-improving harness that fixes this. Each decision point starts on an LLM (System 2) while Jev, TypeSafe AI's new System One model, shadows it. When Jev proves reliable on a decision, the harness promotes it to a ~250 ms reflex and sets its own confidence threshold from Jev's calibration. Before any reflex fires, MongoDB Atlas Vector Search (Automated Embedding) recalls similar past cases, so reflexes only act where they've earned trust. When the world changes, reflexes are demoted, and an evolver rewrites their questions (adding categories, changing context policy) before they re-graduate. Every change is a versioned harness document in MongoDB.
>
> Demo: a SOC agent triaging an alert storm, with 6 decisions per alert. Results: 81% of decisions moved off the LLM; 2.6× lower cost per alert; 38% of alerts handled with no LLM call at 257 ms (10× faster than the LLM path with a frontier teacher); accuracy 96% → 92% on held-out labels. Mid-run, a new campaign of attacks on AI agents is flagged as unfamiliar, the affected reflexes hand off to the LLM, and the harness adds a new category to itself and recovers.
>
> Tracks: Recursive Harnessing (primary), Long Horizon Engineering. Stack: MongoDB Atlas (Vector Search, Automated Embedding, window functions), Jev and LLMs via OpenRouter, Vercel AI SDK, Next.js on Vercel.
