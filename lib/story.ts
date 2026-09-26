import type { NodeName } from "./workload";

// Story mode for the demo: six chapters, each pinned to a real moment in the recorded run
// (database reflexes_run3). One sentence, one visual change, one number per chapter.

export const STORY_DB = "run3";

export const PAIN =
  "AI agents send every small decision to an LLM, on every alert, forever. Reflexes teaches them which decisions can become 200 ms reflexes.";

// Plain-language legend used everywhere on the story screen (no S1/S2/shadow/floor jargon).
export const LEGEND = {
  llm: { icon: "🧠", label: "Asking the LLM", sub: "slow, careful, costs money" },
  reflex: { icon: "⚡", label: "Reflex", sub: "Jev, ~200 ms, almost free" },
  handedBack: { icon: "↩", label: "Handed back to the LLM", sub: "not sure, or never seen before" },
  rewriting: { icon: "✎", label: "Rewriting itself", sub: "the harness is editing its own question" },
} as const;

export type Chapter = {
  id: string;
  title: string;
  at: number; // alert seq to freeze the replay at
  from?: number; // optional: animate the replay from this seq up to `at`
  focus?: NodeName; // decision card to highlight / open
  alertSeq?: number; // alert whose text and decisions are shown as the example
  caption: string; // one sentence, big type
  metric?: { label: string; before: string; after: string };
  proof: string; // small print: the real event behind the chapter
};

export const CHAPTERS: Chapter[] = [
  {
    id: "problem",
    title: "1 · The problem",
    at: 3,
    alertSeq: 3,
    caption: "Every tiny decision goes to an LLM, on every alert, forever.",
    metric: { label: "Cost per 1,000 alerts", before: "$1.03", after: "$1.03" },
    proof: "Alert #3: six decisions, all on the LLM, 773 ms. Result: paged analyst, reset credentials awaiting approval.",
  },
  {
    id: "learns",
    title: "2 · It learns",
    from: 15,
    at: 24,
    caption:
      "Jev watched the LLM decide. Where it agreed 100% on the cases it was sure about, that decision became a reflex.",
    proof: "#19–#24: all six decisions promoted, each with a confidence threshold it set for itself (e.g. Attack type: 100% agreement on 90% of cases, floor 0.84).",
  },
  {
    id: "self-correct",
    title: "3 · It corrects itself",
    from: 50,
    at: 93,
    focus: "escalate",
    caption: "When a reflex got unsure, it stepped back, rewrote its own question, and earned its promotion again.",
    proof: "'Page analyst?' demoted at #54 (60% low-confidence), question rewritten at #71, re-promoted at #93.",
  },
  {
    id: "surprise",
    title: "4 · Something new",
    from: 240,
    at: 250,
    alertSeq: 246,
    focus: "category",
    caption:
      "A brand-new attack type: attacks on AI agents. Memory found nothing similar, so the LLM took over. No guessing.",
    proof: "Alert #246: a coding agent tried to read ~/.aws/credentials after a prompt-injected README. Low confidence and 'not proven here' (Vector Search) sent those decisions back to the LLM.",
  },
  {
    id: "rewrite",
    title: "5 · It rewrote itself",
    from: 290,
    at: 347,
    focus: "category",
    caption: "The harness added a new attack category to its own taxonomy, then re-learned it as a reflex.",
    proof: "Category demoted at #294, rewritten at #325 (+ ai_agent_prompt_injection), re-promoted at #347.",
  },
  {
    id: "result",
    title: "6 · The result",
    at: 359,
    caption: "Cheaper and faster the longer it runs, with a small, visible accuracy trade and a full audit trail in MongoDB.",
    metric: { label: "Cost per 1,000 alerts", before: "$1.03", after: "$0.40" },
    proof: "Run 3 (#100–245 vs first 20 alerts): 81% of decisions moved off the LLM (707 of 876); 38% of alerts need no LLM call at all, at 257 ms median (vs 890 ms all-LLM); 2.6× cheaper ($1.03 → $0.40 per 1,000); accuracy 95.8% → 91.8%. With a frontier teacher (run 2): reflex path 10× faster (238 ms vs 2.4 s).",
  },
];
