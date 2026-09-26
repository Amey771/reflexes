import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { closeDb, getDb } from "../lib/db";
import { ensureVectorIndex, VECTOR_INDEX } from "../lib/memory";

// Creates the auto-embedding vector index and checks that a $vectorSearch text query works.
async function main() {
  const db = await getDb();
  const info = await db.admin().command({ buildInfo: 1 });
  console.log("MongoDB", info.version);
  const ok = await ensureVectorIndex();
  if (ok) {
    const col = db.collection("experience");
    await col.insertMany([
      { run_id: "probe", seq: -1, text: "Okta: 40 failed logins for admin from Tor exit node", agree: {} },
      { run_id: "probe", seq: -2, text: "Proofpoint: user reported phishing email with fake invoice link", agree: {} },
    ]);
    await new Promise((r) => setTimeout(r, 8000));
    const hits = await col
      .aggregate([
        { $vectorSearch: { index: VECTOR_INDEX, path: "text", query: "password spraying against VPN accounts", limit: 2, numCandidates: 10, filter: { run_id: "probe" } } },
        { $project: { _id: 0, text: 1, score: { $meta: "vectorSearchScore" } } },
      ])
      .toArray();
    console.log("vectorSearch hits:", hits);
    await col.deleteMany({ run_id: "probe" });
  }
  await closeDb();
}
main().catch(async (e) => {
  console.error("FAIL:", e.codeName ?? "", e.message);
  await closeDb();
  process.exit(1);
});
