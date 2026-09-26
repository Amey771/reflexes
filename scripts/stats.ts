import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { closeDb, getDb } from "../lib/db";
import { NODES } from "../lib/workload";

// Per-node report for the latest run: S1-S2 agreement, S1/S2 accuracy vs ground truth, confidence split.
async function main() {
  const db = await getDb();
  const run = await db.collection("runs").find().sort({ started_at: -1 }).limit(1).next();
  if (!run) throw new Error("no run");
  const secs = ((run.finished_at ?? new Date()).getTime() - run.started_at.getTime()) / 1000;
  console.log(`run ${run._id} ${run.status} ${run.processed}/${run.total} in ${secs.toFixed(0)} s (${(run.processed / secs).toFixed(2)}/s)`);
  const reqs = new Map((await db.collection("requests").find().toArray()).map((r) => [r.seq, r]));
  const ds = await db.collection("decisions").find({ run_id: run._id }).toArray();
  for (const n of NODES) {
    const rows = ds.filter((d) => d.node === n);
    const both = rows.filter((d) => d.s1 && d.s2 !== undefined && d.s2 !== null);
    const truth = (d: (typeof rows)[number]) => reqs.get(d.seq)?.truth[n];
    const s1ok = both.filter((d) => d.s1.answer === truth(d)).length;
    const s2ok = both.filter((d) => d.s2 === truth(d)).length;
    const agree = both.filter((d) => d.s1.answer === d.s2).length;
    const hi = both.filter((d) => d.s1.confidence >= 0.8);
    const hiAgree = hi.filter((d) => d.s1.answer === d.s2).length;
    const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "-");
    console.log(
      `${n.padEnd(15)} n=${String(both.length).padStart(3)}  S1~S2 ${pct(agree, both.length).padStart(4)}  S1 correct ${pct(s1ok, both.length).padStart(4)}  S2 correct ${pct(s2ok, both.length).padStart(4)}  conf>=.8: ${hi.length} agree ${pct(hiAgree, hi.length)}`,
    );
  }
  await closeDb();
}

main();
