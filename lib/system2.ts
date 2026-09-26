import { generateText, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { MODELS, PRICE } from "./models";
import type { Answer, NodeConfig, NodeName, Request } from "./workload";

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

export type System2Result = {
  answers: Partial<Record<NodeName, Answer>>;
  suggestions: Partial<Record<NodeName, string>>; // proposed new options when none fit
  ms: number;
  cost: number;
};

function schemaFor(nodes: [NodeName, NodeConfig][]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, cfg] of nodes) {
    const q = cfg.question;
    if (q.type === "choice") {
      shape[name] = z.enum(Object.keys(q.criteria) as [string, ...string[]]);
      shape[`${name}__new_option`] = z
        .string()
        .nullable()
        .describe("If no option fits well, a short snake_case name for a new option. Otherwise null.");
    } else if (q.type === "score") {
      shape[name] = z.number().int().min(0).max(q.criteria.length - 1).describe("Level index, 0-based");
    } else {
      shape[name] = z.boolean();
    }
  }
  return z.object(shape);
}

function describe(name: string, cfg: NodeConfig): string {
  const q = cfg.question;
  if (q.type === "choice")
    return `- ${name} (pick one): ${q.instructions}\n${Object.entries(q.criteria)
      .map(([k, v]) => `    ${k}: ${v}`)
      .join("\n")}`;
  if (q.type === "score")
    return `- ${name} (level index): ${q.instructions}\n${q.criteria.map((c, i) => `    ${i}: ${c}`).join("\n")}`;
  return `- ${name} (true/false): ${q.instructions}`;
}

// System 2: one structured LLM call answers every requested decision for a request.
export async function askSystem2(req: Request, nodes: [NodeName, NodeConfig][]): Promise<System2Result> {
  const t0 = performance.now();
  const { output, usage } = await generateText({
    model: openrouter(MODELS.system2),
    output: Output.object({ schema: schemaFor(nodes) }),
    system:
      "You are the decision engine inside an online store's customer-support agent. Think carefully and answer every decision for the message below.",
    prompt: [
      `Customer message:\n${req.text}`,
      `Order facts (computed by the store's systems, trust them):\n${JSON.stringify(req.facts)}`,
      `Draft reply written by the agent:\n${req.draft_reply}`,
      `Decisions:\n${nodes.map(([n, c]) => describe(n, c)).join("\n")}`,
    ].join("\n\n"),
  });
  const ms = Math.round(performance.now() - t0);

  const out = output as Record<string, unknown>;
  const answers: System2Result["answers"] = {};
  const suggestions: System2Result["suggestions"] = {};
  for (const [name] of nodes) {
    answers[name] = out[name] as Answer;
    const s = out[`${name}__new_option`];
    if (typeof s === "string" && s) suggestions[name] = s;
  }
  const cost =
    (usage.inputTokens ?? 0) * PRICE.system2Input + (usage.outputTokens ?? 0) * PRICE.system2Output;
  return { answers, suggestions, ms, cost };
}
