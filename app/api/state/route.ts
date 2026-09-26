import { getDb } from "@/lib/db";
import { NODES, type Harness } from "@/lib/workload";

export const dynamic = "force-dynamic";

const WINDOW = 20;

export async function GET() {
  const db = await getDb();
  const harness = await db.collection<Harness>("harness_versions").find().sort({ version: -1 }).limit(1).next();
  const run = await db.collection("runs").find().sort({ started_at: -1 }).limit(1).next();
  if (!run) return Response.json({ run: null, harness });
  const run_id = run._id;

  const [series, nodeRows, events, recent, versions] = await Promise.all([
    // Rolling metrics over the request stream, computed in MongoDB with window functions.
    db
      .collection("results")
      .aggregate([
        { $match: { run_id } },
        {
          $setWindowFields: {
            sortBy: { seq: 1 },
            output: {
              ms: { $avg: "$ms", window: { documents: [-(WINDOW - 1), 0] } },
              wait: { $avg: "$total_ms", window: { documents: [-(WINDOW - 1), 0] } },
              cost: { $avg: "$cost", window: { documents: [-(WINDOW - 1), 0] } },
              accuracy: { $avg: "$correct", window: { documents: [-(WINDOW - 1), 0] } },
              reflex: { $avg: "$reflex_share", window: { documents: [-(WINDOW - 1), 0] } },
            },
          },
        },
        { $project: { _id: 0, seq: 1, batch: 1, backlog: 1, ms: 1, wait: 1, cost: 1, accuracy: 1, reflex: 1 } },
      ])
      .toArray(),
    // Per-node health over its most recent decisions.
    db
      .collection("decisions")
      .aggregate([
        { $match: { run_id } },
        { $sort: { seq: -1 } },
        { $group: { _id: "$node", recent: { $push: { agree: "$agree", used: "$used", conf: "$s1.confidence" } } } },
        { $project: { recent: { $slice: ["$recent", 30] } } },
      ])
      .toArray(),
    db.collection("events").find({ run_id }).sort({ ts: -1 }).limit(40).toArray(),
    db
      .collection("decisions")
      .aggregate([
        { $match: { run_id } },
        { $sort: { seq: -1 } },
        { $limit: 60 },
        { $group: { _id: "$seq", text: { $first: "$text" }, nodes: { $push: { node: "$node", used: "$used", correct: "$correct" } } } },
        { $sort: { _id: -1 } },
        { $limit: 8 },
      ])
      .toArray(),
    db.collection("harness_versions").countDocuments(),
  ]);

  const nodes = Object.fromEntries(
    NODES.map((n) => {
      const recent = (nodeRows.find((r) => r._id === n)?.recent ?? []) as { agree?: boolean; used: string; conf?: number }[];
      const withAgree = recent.filter((r) => r.agree !== undefined && r.agree !== null);
      const confs = recent.map((r) => r.conf).filter((c): c is number => typeof c === "number");
      return [
        n,
        {
          mode: harness?.nodes[n].mode,
          question: harness?.nodes[n].question,
          agreement: withAgree.length ? withAgree.filter((r) => r.agree).length / withAgree.length : null,
          samples: withAgree.length,
          reflexShare: recent.length ? recent.filter((r) => r.used === "reflex").length / recent.length : 0,
          confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null,
        },
      ];
    }),
  );

  const bySeq = [...series].sort((a, b) => a.seq - b.seq);
  const avg = (rows: typeof series, k: string) => (rows.length ? rows.reduce((s, r) => s + (r[k] as number), 0) / rows.length : null);
  const first = bySeq.slice(0, WINDOW);
  const lastRows = bySeq.slice(-WINDOW);
  const pick = (rows: typeof series) => ({
    ms: avg(rows, "ms"),
    wait: avg(rows, "wait"),
    cost: avg(rows, "cost"),
    accuracy: avg(rows, "accuracy"),
    reflex: avg(rows, "reflex"),
  });

  return Response.json({
    run: { status: run.status, processed: run.processed, total: run.total, started_at: run.started_at },
    harness: { version: harness?.version, reason: harness?.reason, versions },
    kpis: { before: pick(first.length ? [first[first.length - 1]] : []), now: pick(lastRows.length ? [lastRows[lastRows.length - 1]] : []) },
    nodes,
    series: bySeq,
    events,
    recent,
  });
}
