import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { readFileSync } from "node:fs";
import { processRequest } from "../lib/engine";
import { initialHarness, NODES, type Request } from "../lib/workload";

// Offline probe (no database): shadow-run N alerts and report System 1 vs System 2 agreement per node.
// Usage: npx tsx scripts/probe.ts [N] [start]
const N = Number(process.argv[2] ?? 20);
const START = Number(process.argv[3] ?? 0);

async function main() {
  const alerts: Request[] = JSON.parse(readFileSync("data/alerts.json", "utf8")).slice(START, START + N);
  const h = initialHarness();
  const noMemory = async () => ({ available: false, top: null, novel: false, trust: {}, neighbors: [] });
  const results = [];
  const queue = [...alerts];
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      while (queue.length) {
        const a = queue.shift()!;
        try {
          results.push(await processRequest(a, h, noMemory));
        } catch (e) {
          console.error(`#${a.seq} failed: ${(e as Error).message}`);
        }
      }
    }),
  );
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  const cost = results.reduce((s, r) => s + r.cost, 0);
  console.log(`${results.length} alerts · median ${ms[Math.floor(ms.length / 2)]} ms · total $${cost.toFixed(4)}\n`);
  console.log("node            S1~S2   S2 correct   S1 correct   mean S1 conf");
  for (const n of NODES) {
    const ds = results.map((r) => r.decisions.find((d) => d.node === n)!);
    const req = (seq: number) => alerts.find((a) => a.seq === seq)!;
    const agree = ds.filter((d) => d.agree).length / ds.length;
    const s2ok = ds.filter((d) => d.s2 === req(d.seq).truth[n]).length / ds.length;
    const s1ok = ds.filter((d) => d.s1?.answer === req(d.seq).truth[n]).length / ds.length;
    const conf = ds.reduce((s, d) => s + (d.s1?.confidence ?? 0), 0) / ds.length;
    const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(5);
    console.log(`${n.padEnd(15)} ${pct(agree)}   ${pct(s2ok)}        ${pct(s1ok)}        ${conf.toFixed(2)}`);
  }
  const dis = results.flatMap((r) => r.decisions.filter((d) => d.agree === false).map((d) => ({ seq: r.seq, node: d.node, s1: d.s1?.answer, conf: d.s1?.confidence?.toFixed(2), s2: d.s2 })));
  console.log("\nSample disagreements:", JSON.stringify(dis.slice(0, 12)));
}

main();
