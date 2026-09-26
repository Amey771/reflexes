import type { Document } from "mongodb";
import { getDb } from "@/lib/db";
import type { Harness } from "@/lib/workload";

export const dynamic = "force-dynamic";

const WINDOW = 20;

// Alert texts never change, so read them once per server instance.
let texts: Map<number, string> | null = null;

// Returns the whole latest run. The dashboard renders the state "as of alert #N",
// so the same payload drives both the live view and the replay.
export async function GET() {
  const db = await getDb();
  const run = await db.collection("runs").find().sort({ started_at: -1 }).limit(1).next();
  const canRun = process.env.ALLOW_RUN === "1";
  if (!run) return Response.json({ run: null, canRun });
  const run_id = run._id;

  if (!texts) {
    const rows = await db.collection("requests").find({}, { projection: { _id: 0, seq: 1, text: 1 } }).toArray();
    texts = new Map(rows.map((r) => [r.seq as number, r.text as string]));
  }

  const [series, decisions, events, versions] = await Promise.all([
    // Rolling metrics over the alert stream, computed in MongoDB with window functions.
    db
      .collection("results")
      .aggregate([
        { $match: { run_id } },
        {
          $setWindowFields: {
            sortBy: { seq: 1 },
            output: {
              ms_avg: { $avg: "$ms", window: { documents: [-(WINDOW - 1), 0] } },
              wait_avg: { $avg: "$total_ms", window: { documents: [-(WINDOW - 1), 0] } },
              cost_avg: { $avg: "$cost", window: { documents: [-(WINDOW - 1), 0] } },
              accuracy_avg: { $avg: "$correct", window: { documents: [-(WINDOW - 1), 0] } },
              reflex_avg: { $avg: "$reflex_share", window: { documents: [-(WINDOW - 1), 0] } },
            },
          },
        },
        {
          $project: {
            _id: 0,
            seq: 1,
            batch: 1,
            novel: 1,
            recall_top: 1,
            action: 1,
            ms: "$ms_avg",
            wait: "$wait_avg",
            cost: "$cost_avg",
            accuracy: "$accuracy_avg",
            reflex: "$reflex_avg",
          },
        },
      ])
      .toArray(),
    db
      .collection("decisions")
      .find({ run_id }, { projection: { _id: 0, seq: 1, node: 1, used: 1, agree: 1, audited: 1, mode: 1, v: "$harness_version", reason: "$fallback_reason", conf: "$s1.confidence" } })
      .sort({ seq: 1 })
      .toArray(),
    db.collection("events").find({ run_id }, { projection: { run_id: 0 } }).sort({ ts: 1 }).toArray(),
    db
      .collection<Harness>("harness_versions")
      .find({}, { projection: { _id: 0, version: 1, reason: 1, nodes: 1, created_at: 1 } })
      .sort({ version: 1 })
      .toArray(),
  ]);

  const alerts = series.map((s: Document) => ({
    seq: s.seq,
    text: (texts!.get(s.seq) ?? "").slice(0, 220),
    action: s.action,
    novel: !!s.novel,
    batch: s.batch,
  }));

  // A finished run never changes, so let the CDN serve it; live runs are never cached.
  const headers = run.status === "done" ? { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300" } : { "Cache-Control": "no-store" };
  return Response.json({
    run: { id: String(run_id), status: run.status, processed: run.processed, total: run.total, started_at: run.started_at },
    canRun,
    versions,
    series: series.map(({ action: _a, ...rest }: Document) => rest),
    decisions,
    events: events.map((e) => ({ ...e, _id: String(e._id) })),
    alerts,
  }, { headers });
}
