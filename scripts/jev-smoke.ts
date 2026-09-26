import { config } from "dotenv";
config({ path: ".env.local" });

import { askJev } from "../lib/jev";

async function main() {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set in .env.local");

  const state = {
    message: "I ordered a blender last week and it arrived cracked. I want my money back!",
    order: { status: "delivered", within_refund_window: true },
  };
  const result = await askJev(state, {
    intent: {
      type: "choice",
      instructions: "What is the customer asking for?",
      criteria: {
        refund: "Wants money back",
        order_status: "Asking where an order is",
        cancel: "Wants to cancel an order",
        other: "Anything else",
      },
    },
    urgency: {
      type: "score",
      instructions: "How urgent is this message?",
      criteria: ["Not urgent", "Normal", "High", "Critical"],
    },
    needs_human: { type: "noul", instructions: "Should a human agent handle this instead of automation?" },
  });

  console.log(`Jev answered in ${result.ms} ms, ${result.inputTokens} input tokens, $${result.cost.toFixed(6)}`);
  console.log(JSON.stringify(result.answers, null, 2));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
