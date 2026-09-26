import { getDb } from "@/lib/db";
import { VECTOR_INDEX } from "@/lib/memory";

export const dynamic = "force-dynamic";

// Memory explorer: semantic search over the live experience memory of the latest run.
// Read-only; Atlas embeds the query text itself (Automated Embedding).
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 500);
  if (!q) return Response.json({ error: "Missing q" }, { status: 400 });
  const db = await getDb();
  const run = await db.collection("runs").find().sort({ started_at: -1 }).limit(1).next();
  if (!run) return Response.json({ results: [] });
  try {
    const results = await db
      .collection("experience")
      .aggregate([
        { $vectorSearch: { index: VECTOR_INDEX, path: "text", query: q, limit: 8, numCandidates: 120, filter: { run_id: run._id } } },
        { $project: { _id: 0, seq: 1, text: 1, agree: 1, score: { $meta: "vectorSearchScore" } } },
      ])
      .toArray();
    return Response.json({ results });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
