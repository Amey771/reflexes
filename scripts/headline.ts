import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { closeDb, getDb } from "../lib/db";

// Headline numbers for a run: learning phase (first 20 alerts) vs after graduation.
// Usage: npx tsx scripts/headline.ts [db]   (default: MONGODB_DB)
async function main() {
  const db = (await getDb()).client.db(process.argv[2] ?? process.env.MONGODB_DB ?? "reflexes");
  const run = await db.collection("runs").find().sort({ started_at: -1 }).limit(1).next();
  const rs = await db.collection("results").find({ run_id: run!._id }).sort({ seq: 1 }).toArray();
  const firstPromote = await db.collection("events").find({ run_id: run!._id, type: "promote" }).sort({ seq: 1 }).limit(1).next();
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const report = (label: string, rows: typeof rs) =>
    console.log(
      `${label.padEnd(26)} n=${String(rows.length).padStart(3)}  median decision ${String(median(rows.map((r) => r.ms))).padStart(5)} ms  ` +
        `cost/1k $${(avg(rows.map((r) => r.cost)) * 1000).toFixed(2)}  accuracy ${(avg(rows.map((r) => r.correct)) * 100).toFixed(1)}%  ` +
        `no-LLM ${((rows.filter((r) => r.reflex_share === 1).length / (rows.length || 1)) * 100).toFixed(0)}%`,
    );
  console.log(`first promotion at #${firstPromote?.seq}`);
  report("learning (#0-19)", rs.filter((r) => r.seq < 20));
  report("graduated, base (#80-245)", rs.filter((r) => r.seq >= 80 && r.batch === "base" && r.seq < 246));
  report("campaign alerts", rs.filter((r) => r.batch === "campaign"));
  report("after campaign base", rs.filter((r) => r.seq >= 246 && r.batch === "base"));
  const allReflex = rs.filter((r) => r.reflex_share === 1);
  console.log(`all-reflex alerts: ${allReflex.length}, median ${median(allReflex.map((r) => r.ms))} ms`);
  await db.client.close();
  await closeDb();
}

main();
