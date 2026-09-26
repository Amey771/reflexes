import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { ObjectId } from "mongodb";
import { closeDb, getDb } from "../lib/db";
import { askJev } from "../lib/jev";
import { Memory } from "../lib/memory";
import { askSystem2 } from "../lib/system2";
import { initialHarness, NODES, type Request } from "../lib/workload";

// Latency of each call on the per-alert path, to find where the time goes.
const t = async (label: string, fn: () => Promise<unknown>) => {
  const t0 = performance.now();
  await fn();
  console.log(label.padEnd(28), Math.round(performance.now() - t0), "ms");
};

async function main() {
  const db = await getDb();
  await t("ping (cold)", () => db.command({ ping: 1 }));
  await t("ping (warm)", () => db.command({ ping: 1 }));
  const req = (await db.collection<Request>("requests").findOne({ seq: 5 }))!;
  const h = initialHarness();
  const mem = new Memory(new ObjectId());
  (mem as unknown as { count: number }).count = 5; // skip the warmup guard
  await t("vectorSearch recall", () => mem.recall(req.text));
  await t("vectorSearch recall (2)", () => mem.recall(req.text));
  await t("jev (6 questions)", () =>
    askJev({ alert: req.text, context: req.facts }, Object.fromEntries(NODES.map((n) => [n, h.nodes[n].question]))),
  );
  await t("system2 (6 decisions)", () => askSystem2(req, NODES.map((n) => [n, h.nodes[n]])));
  await t("insertOne", () => db.collection("timing_probe").insertOne({ x: 1 }));
  await t("insertMany(6)", () => db.collection("timing_probe").insertMany(Array.from({ length: 6 }, (_, i) => ({ i }))));
  await db.collection("timing_probe").drop();
  await closeDb();
}

main();
