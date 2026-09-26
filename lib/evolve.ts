import { generateText, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { MODELS } from "./models";
import type { JevQuestion } from "./jev";
import type { NodeConfig, NodeName } from "./workload";

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

export type Example = { text: string; s1?: unknown; s2?: unknown; suggestion?: string; confidence?: number };

// The evolver rewrites a reflex's own question so System 1 agrees with the System 2 teacher.
export async function rewriteQuestion(
  node: NodeName,
  cfg: NodeConfig,
  examples: Example[],
  why: string,
): Promise<{ question: JevQuestion; reason: string }> {
  const q = cfg.question;
  const criteriaSchema =
    q.type === "choice"
      ? z.array(z.object({ key: z.string().describe("snake_case option id"), description: z.string() })).min(2)
      : q.type === "score"
        ? z.array(z.string()).length(q.criteria.length)
        : z.null();

  const suggestions = examples.map((e) => e.suggestion).filter(Boolean);
  const { output } = await generateText({
    model: openrouter(MODELS.evolver),
    output: Output.object({
      schema: z.object({
        instructions: z.string(),
        criteria: criteriaSchema,
        reason: z.string().describe("One short sentence describing what you changed and why"),
      }),
    }),
    system: `You maintain the "reflexes" of an AI agent harness. A reflex is a typed question answered by a System One model (Jev): fast, calibrated, but it cannot do math or date reasoning, and it gets worse with vague or overlapping options. A slower System 2 LLM is the teacher. Rewrite the reflex question so System 1 agrees with System 2. Keep existing option keys unless they are clearly wrong. Add a new option only when the teacher keeps proposing one. Make options crisp and mutually exclusive.`,
    prompt: `Decision node: ${node} (${q.type})
Why a rewrite is needed: ${why}

Current question:
${JSON.stringify(q, null, 2)}

Recent cases where System 1 disagreed with System 2, or was not confident:
${JSON.stringify(examples.slice(0, 15), null, 2)}

New options the teacher proposed: ${suggestions.length ? JSON.stringify(suggestions) : "none"}`,
  });

  const o = output as { instructions: string; criteria: unknown; reason: string };
  let question: JevQuestion;
  if (q.type === "choice") {
    const opts = o.criteria as { key: string; description: string }[];
    question = { type: "choice", instructions: o.instructions, criteria: Object.fromEntries(opts.map((x) => [x.key, x.description])) };
  } else if (q.type === "score") {
    question = { type: "score", instructions: o.instructions, criteria: o.criteria as string[] };
  } else {
    question = { type: "noul", instructions: o.instructions };
  }
  return { question, reason: o.reason };
}
