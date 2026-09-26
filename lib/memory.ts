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
const NOVEL_PERCENTILE = 0.05;
const TRUST_MIN = 0.6; // share of similar past cases where this reflex agreed with the teacher
const TRUST_MIN_CASES = 2;

export type Recall = {
  available: boolean;
  top: number | null; // similarity of the closest past alert
  novel: boolean;
  trust: Partial<Record<NodeName, { cases: number; rate: number }>>;
  neighbors: number[]; // seqs of the similar past alerts
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

  async recall(text: string): Promise<Recall> {
    const empty: Recall = { available: false, top: null, novel: false, trust: {}, neighbors: [] };
    if (this.count < 3) return { ...empty, available: true };
    try {
      const db = await getDb();
      const hits = await db
        .collection("experience")
        .aggregate([
          { $vectorSearch: { index: VECTOR_INDEX, path: "text", query: text, limit: K, numCandidates: 60, filter: { run_id: this.run_id } } },
          { $project: { _id: 0, seq: 1, agree: 1, score: { $meta: "vectorSearchScore" } } },
        ])
        .toArray();
      const top = hits[0]?.score ?? null;
      const novel = top !== null && this.count >= WARMUP && top < percentile(this.tops, NOVEL_PERCENTILE);
      if (top !== null) this.tops = [...this.tops.slice(-199), top];
      const trust: Recall["trust"] = {};
      for (const n of NODES) {
        const flags = hits.map((h) => h.agree?.[n]).filter((v): v is boolean => typeof v === "boolean");
        if (flags.length) trust[n] = { cases: flags.length, rate: flags.filter(Boolean).length / flags.length };
      }
      return { available: true, top, novel, trust, neighbors: hits.map((h) => h.seq) };
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
