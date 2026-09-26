import type { ObjectId } from "mongodb";
import { getDb } from "./db";
import { NODES, type NodeName } from "./workload";

// Experience memory: every processed alert, auto-embedded by Atlas (Voyage model inside Atlas),
// with whether each reflex agreed with the System 2 teacher on it. Before a reflex acts, Vector
// Search recalls the most similar past alerts: a reflex only fires where it has proven itself.

export const VECTOR_INDEX = "experience_text";
const EMBED_MODEL = "voyage-4-lite";
const K = 5;
const WARMUP = 30; // experiences before novelty detection starts
const NOVEL_PERCENTILE = 0.05; // novel = closest match below the 5th percentile of recent matches
const NOVEL_WINDOW = 150;
export const TRUST_MIN = 0.5; // share of similar past cases where this reflex agreed with the teacher
export const TRUST_MIN_CASES = 3;

export type Recall = {
  available: boolean;
  top: number | null; // similarity of the closest past alert
  novel: boolean;
  trust: Partial<Record<NodeName, { cases: number; rate: number }>>;
  neighbors: number[]; // seqs of the similar past alerts
  hits: { seq: number; score: number; agree?: Partial<Record<NodeName, boolean>> }[]; // the recalled neighbors
  novel_below: number | null; // similarity under which an alert counts as novel (null during warm-up)
};

export function untrusted(r: Recall, node: NodeName): boolean {
  if (!r.available) return false;
  if (r.novel) return true;
  const t = r.trust[node];
  return !!t && t.cases >= TRUST_MIN_CASES && t.rate < TRUST_MIN;
}

export async function ensureVectorIndex(log: (m: string) => void = console.log) {
  const db = await getDb();
  const exists = await db.listCollections({ name: "experience" }).hasNext();
  if (!exists) await db.createCollection("experience");
  const col = db.collection("experience");
  const indexes = await col.listSearchIndexes(VECTOR_INDEX).toArray();
  if (!indexes.length) {
    await col.createSearchIndex({
      name: VECTOR_INDEX,
      type: "vectorSearch",
      definition: {
        fields: [
          { type: "autoEmbed", modality: "text", path: "text", model: EMBED_MODEL },
          { type: "filter", path: "run_id" },
        ],
      },
    });
    log(`Created vector index ${VECTOR_INDEX} (auto-embed, ${EMBED_MODEL})`);
  }
  for (let i = 0; i < 60; i++) {
    const [idx] = (await col.listSearchIndexes(VECTOR_INDEX).toArray()) as { queryable?: boolean; status?: string }[];
    if (idx?.queryable) return true;
    if (i === 0) log(`Waiting for vector index (status: ${idx?.status ?? "unknown"})...`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  log("Vector index not queryable yet; memory recall will be skipped until it is.");
  return false;
}

export class Memory {
  private tops: number[] = [];
  private count = 0;
  private warned = false;
  constructor(
    private run_id: ObjectId,
    private log: (m: string) => void = console.log,
  ) {}

  // Memory over an existing run's experience (count and recent closest-match scores), so novelty
  // can be judged outside the live runner. Read-only.
  static async forRun(run_id: ObjectId) {
    const db = await getDb();
    const m = new Memory(run_id, () => {});
    const [count, rows] = await Promise.all([
      db.collection("experience").countDocuments({ run_id }),
      db
        .collection("results")
        .find({ run_id, recall_top: { $ne: null } }, { projection: { _id: 0, recall_top: 1 } })
        .sort({ seq: -1 })
        .limit(NOVEL_WINDOW)
        .toArray(),
    ]);
    m.count = count;
    m.tops = rows.map((r) => r.recall_top as number).reverse();
    return m;
  }

  get experiences() {
    return this.count;
  }

  // `exclude`: a seq left out of the neighbors, so an alert never matches its own past record.
  async recall(text: string, opts: { exclude?: number } = {}): Promise<Recall> {
    const empty: Recall = { available: false, top: null, novel: false, trust: {}, neighbors: [], hits: [], novel_below: null };
    if (this.count < 3) return { ...empty, available: true };
    try {
      const db = await getDb();
      const hits = await db
        .collection("experience")
        .aggregate([
          { $vectorSearch: { index: VECTOR_INDEX, path: "text", query: text, limit: K + (opts.exclude !== undefined ? 1 : 0), numCandidates: 60, filter: { run_id: this.run_id } } },
          { $project: { _id: 0, seq: 1, agree: 1, score: { $meta: "vectorSearchScore" } } },
        ])
        .toArray()
        .then((rows) => rows.filter((h) => h.seq !== opts.exclude).slice(0, K));
      const top = hits[0]?.score ?? null;
      const novel_below = this.count >= WARMUP ? percentile(this.tops, NOVEL_PERCENTILE) : null;
      const novel = top !== null && novel_below !== null && top < novel_below;
      if (top !== null) this.tops = [...this.tops.slice(-(NOVEL_WINDOW - 1)), top];
      const trust: Recall["trust"] = {};
      for (const n of NODES) {
        const flags = hits.map((h) => h.agree?.[n]).filter((v): v is boolean => typeof v === "boolean");
        if (flags.length) trust[n] = { cases: flags.length, rate: flags.filter(Boolean).length / flags.length };
      }
      return {
        available: true,
        top,
        novel,
        trust,
        neighbors: hits.map((h) => h.seq),
        hits: hits.map((h) => ({ seq: h.seq, score: h.score, agree: h.agree })),
        novel_below,
      };
    } catch (e) {
      if (!this.warned) this.log(`Memory recall unavailable: ${(e as Error).message}`);
      this.warned = true;
      return empty;
    }
  }

  async remember(seq: number, text: string, agree: Partial<Record<NodeName, boolean>>) {
    const db = await getDb();
    await db.collection("experience").insertOne({ run_id: this.run_id, seq, text, agree, ts: new Date() });
    this.count++;
  }

  // Similar past alerts, for the evolver: the cluster around a new pattern.
  async similarSeqs(text: string, k = 15): Promise<number[]> {
    try {
      const db = await getDb();
      const hits = await db
        .collection("experience")
        .aggregate([
          { $vectorSearch: { index: VECTOR_INDEX, path: "text", query: text, limit: k, numCandidates: 100, filter: { run_id: this.run_id } } },
          { $project: { _id: 0, seq: 1 } },
        ])
        .toArray();
      return hits.map((h) => h.seq);
    } catch {
      return [];
    }
  }
}

function percentile(xs: number[], p: number) {
  if (!xs.length) return -Infinity;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
