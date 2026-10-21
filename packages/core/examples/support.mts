import { ReflexController, decide } from "../dist/index.js";
// Replace these callbacks with validated provider calls. Example makes no network requests.
const controller = new ReflexController("support.intent", "modelA-modelB-prompt1-schema1");
const context = { risk: "low", familiar: true, memoryAvailable: true } as const;
const providers = {
  fast: async (text: string) => ({ answer: text.includes("invoice") ? "billing" : "general", confidence: 0.95, cost: 0.001 }),
  teacher: async (text: string) => ({ answer: text.includes("invoice") ? "billing" : "general", confidence: 1, cost: 0.02 }),
};
for (let i = 0; i < 400; i++) {
  const result = await decide(controller, "Please explain my invoice", context, providers);
  // A service should persist these events and drain all audits before shutdown.
  if (result.audit) await result.audit;
  for (const event of controller.drainEvents()) console.log(event);
}
console.log(controller.state);
