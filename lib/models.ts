// Every model ID lives here. All calls go through OpenRouter.
export const MODELS = {
  // System 1: TypeSafe AI's Jev, via OpenRouter's System One endpoint
  jev: "jev-1.13",
  // System 2: the "slow, thoughtful" LLM every decision starts on
  system2: "openai/gpt-5.4-mini",
  // Rewrites reflex questions when they drift; called rarely
  evolver: "anthropic/claude-sonnet-5",
  // Bulk synthetic workload generation
  generator: "openai/gpt-5.4-mini",
} as const;

// USD per token, used to estimate cost when a provider doesn't report it
export const PRICE = {
  jevInput: 0.042 / 1e6,
  system2Input: 0.75 / 1e6,
  system2Output: 4.5 / 1e6,
} as const;
