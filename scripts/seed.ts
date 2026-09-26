import { config } from "dotenv";
config({ path: ".env.local" });

import { generateText, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { closeDb, getDb } from "../lib/db";
import { MODELS } from "../lib/models";
import { policyFor, toolFor, type Facts, type Request } from "../lib/workload";

// Generates the labeled Black Friday workload: a base stream, then a "gift card launch"
// batch mixed in from BASE_ONLY onward. Labels are fixed in code; the LLM only writes text.

const BASE = 360;
const LAUNCH = 90;
const BASE_ONLY = 240;
const BATCH = 15;

type Special = "none" | "legal_threat" | "safety_hazard" | "fraud";
type Flaw = "none" | "false_promise" | "rude" | "ignores_question" | "wrong_info";
type Spec = { id: number; intent: string; facts: Facts; special: Special; angry: boolean; urgency: number; needs_human: boolean; flaw: Flaw };

const rand = (p: number) => Math.random() < p;
const pick = <T,>(weights: [T, number][]): T => {
  let r = Math.random() * weights.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of weights) if ((r -= w) <= 0) return v;
  return weights[0][0];
};

function spec(id: number, intent: string): Spec {
  const status: Facts["order_status"] =
    intent === "product_question" || intent === "gift_card" || intent === "other"
      ? "no_order"
      : intent === "refund"
        ? pick([["delivered", 0.85], ["shipped", 0.15]])
        : intent === "cancel" || intent === "change_address"
          ? pick([["processing", 0.6], ["shipped", 0.4]])
          : pick([["processing", 0.3], ["shipped", 0.5], ["delivered", 0.2]]);
  const facts: Facts = {
    order_status: status,
    within_refund_window: status === "delivered" ? rand(0.7) : false,
    customer_tier: rand(0.15) ? "vip" : "standard",
    repeat_contact: rand(0.12),
  };
  const special: Special =
    intent === "gift_card" ? (rand(0.05) ? "fraud" : "none") : pick([["none", 0.88], ["legal_threat", 0.04], ["safety_hazard", 0.04], ["fraud", 0.04]]);
  const angry = intent === "complaint" || rand(0.25);
  const urgency =
    special !== "none" ? 3 : angry && (intent === "complaint" || intent === "refund" || facts.customer_tier === "vip") ? 2 : ["product_question", "other"].includes(intent) ? 0 : 1;
  const needs_human =
    special !== "none" ||
    (facts.customer_tier === "vip" && angry) ||
    (facts.repeat_contact && ["order_status", "complaint", "refund", "gift_card"].includes(intent));
  const flaw: Flaw = rand(0.75) ? "none" : pick([["false_promise", 1], ["rude", 1], ["ignores_question", 1], ["wrong_info", 1]]);
  return { id, intent, facts, special, angry, urgency, needs_human, flaw };
}

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

async function writeTexts(specs: Spec[]) {
  const { output } = await generateText({
    model: openrouter(MODELS.generator),
    output: Output.object({
      schema: z.object({ items: z.array(z.object({ id: z.number(), text: z.string(), draft_reply: z.string() })) }),
    }),
    system:
      "You write realistic, varied customer messages for an online electronics and home goods store during Black Friday, plus the support agent's draft reply. Vary length, tone, typos and phrasing. Never mention the labels you were given.",
    prompt: `For each spec, write:
- text: the customer's message (1-4 sentences) matching intent, anger, and any special situation (legal_threat: threatens to sue or report to authorities; safety_hazard: product overheated, sparked, injured someone; fraud: charges they didn't make or suspicious account activity). If repeat_contact is true, the customer mentions they've already contacted support about this.
- draft_reply: the agent's draft reply (1-3 sentences). If flaw is "none", it's polite, relevant and promises nothing outside policy. Otherwise it has exactly that flaw: false_promise (guarantees a delivery date or an out-of-policy refund), rude, ignores_question (answers something else), wrong_info (states an incorrect fact about the order).
Intents: order_status, refund, cancel, change_address, product_question, complaint, other (random unrelated request), gift_card (gift card code not working, balance check, gift card email never arrived, combining gift cards).

Specs:
${JSON.stringify(specs.map(({ id, intent, facts, special, angry, flaw }) => ({ id, intent, special, angry, repeat_contact: facts.repeat_contact, order_status: facts.order_status, flaw })))}`,
  });
  return output.items;
}

async function main() {
  const intents: [string, number][] = [
    ["order_status", 0.22], ["refund", 0.2], ["cancel", 0.12], ["change_address", 0.1],
    ["product_question", 0.16], ["complaint", 0.12], ["other", 0.08],
  ];
  const base = Array.from({ length: BASE }, (_, i) => spec(i, pick(intents)));
  const launch = Array.from({ length: LAUNCH }, (_, i) => spec(BASE + i, "gift_card"));

  // Order: base only first, then the rest of base shuffled with the launch batch.
  const tail = [...base.slice(BASE_ONLY), ...launch].sort(() => Math.random() - 0.5);
  const ordered = [...base.slice(0, BASE_ONLY), ...tail];

  const chunks: Spec[][] = [];
  for (let i = 0; i < ordered.length; i += BATCH) chunks.push(ordered.slice(i, i + BATCH));
  console.log(`Generating ${ordered.length} messages in ${chunks.length} calls...`);

  const texts = new Map<number, { text: string; draft_reply: string }>();
  let done = 0;
  const queue = [...chunks];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const chunk = queue.shift()!;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            for (const it of await writeTexts(chunk)) texts.set(it.id, it);
            break;
          } catch (e) {
            if (attempt === 2) console.error("chunk failed:", (e as Error).message);
          }
        }
        console.log(`  ${++done}/${chunks.length}`);
      }
    }),
  );

  const requests: Request[] = ordered
    .filter((s) => texts.has(s.id))
    .map((s, seq) => ({
      seq,
      batch: s.intent === "gift_card" ? "launch" : "base",
      text: texts.get(s.id)!.text,
      draft_reply: texts.get(s.id)!.draft_reply,
      facts: s.facts,
      truth: {
        intent: s.intent,
        urgency: s.urgency,
        needs_human: s.needs_human,
        tool: toolFor(s.intent),
        policy_ok: policyFor(s.intent, s.facts),
        reply_ok: s.flaw === "none",
      },
    }));

  const db = await getDb();
  await db.collection("requests").deleteMany({});
  await db.collection("requests").insertMany(requests);
  await db.collection("requests").createIndex({ seq: 1 }, { unique: true });
  console.log(`Seeded ${requests.length} requests (${requests.filter((r) => r.batch === "launch").length} launch).`);
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
