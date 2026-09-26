import { MODELS, PRICE } from "./models";

const JEV_URL = "https://openrouter.ai/api/v1/systemone";

export type JevQuestion =
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | {
      type: "score";
      score: number;
      probabilities: Record<string, number>;
      confidence: number;
      legend?: Record<string, string>;
    };

export type JevResult = {
  answers: Record<string, JevAnswer>;
  ms: number;
  cost: number;
  inputTokens: number;
};

// One fan-out call answers every question against the same state.
export async function askJev(
  state: unknown,
  questions: Record<string, JevQuestion>,
): Promise<JevResult> {
  const t0 = performance.now();
  const res = await fetch(JEV_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODELS.jev, state, questions }),
  });
  const ms = Math.round(performance.now() - t0);
  if (!res.ok) throw new Error(`Jev ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const inputTokens: number = body.usage?.input_tokens ?? 0;
  return { answers: body.answers, ms, cost: inputTokens * PRICE.jevInput, inputTokens };
}
