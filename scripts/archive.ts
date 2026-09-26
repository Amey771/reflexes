import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { closeDb, getDb } from "../lib/db";

// Copy the current run into a sibling database so the next run's reset doesn't erase it.
// Usage: npx tsx scripts/archive.ts reflexes_run1
const target = process.argv[2];
const COLLECTIONS = ["runs", "results", "decisions", "events", "harness_versions", "requests"];

async function main() {
  if (!target?.startsWith("reflexes_")) throw new Error("usage: archive.ts reflexes_<name>");
  const db = await getDb();
  for (const c of COLLECTIONS) {
    await db.collection(c).aggregate([{ $match: {} }, { $out: { db: target, coll: c } }]).toArray();
    const n = await db.client.db(target).collection(c).countDocuments();
    console.log(`${c.padEnd(17)} → ${target}.${c}: ${n}`);
  }
  await closeDb();
}

main().catch((e) => {
  console.error("ARCHIVE FAIL:", e.message);
  process.exit(1);
});
