import type { RequestResult } from "./engine";
import { NODES, type Harness, type NodeName } from "./workload";

export type Change =
  | { type: "promote"; node: NodeName; detail: string }
  | { type: "demote"; node: NodeName; detail: string }
  | { type: "rewrite"; node: NodeName; detail: string };

type Window = { shadow: boolean[]; audits: boolean[]; fallbacks: boolean[]; sinceRewrite: number };

const REWRITE_AFTER = 30; // shadow samples before a stuck node gets its question rewritten
const REWRITE_BELOW = 0.8;

const rate = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : 0);
const last = <T,>(xs: T[], n: number) => xs.slice(-n);

// Watches decisions and decides when each node graduates, is demoted, or needs a rewrite.
// Pure hard metrics: agreement with the System 2 teacher, audit agreement, fallback rate.
export class Graduator {
  w = Object.fromEntries(NODES.map((n) => [n, this.fresh()])) as Record<NodeName, Window>;
  // Ignore in-flight results computed with a question that has since been rewritten.
  questionSince = Object.fromEntries(NODES.map((n) => [n, 0])) as Record<NodeName, number>;
  busy = new Set<NodeName>();

  fresh(): Window {
    return { shadow: [], audits: [], fallbacks: [], sinceRewrite: 0 };
  }

  reset(node: NodeName, version: number) {
    this.w[node] = this.fresh();
    this.questionSince[node] = version;
  }

  observe(r: RequestResult, h: Harness): Change[] {
    const changes: Change[] = [];
    for (const d of r.decisions) {
      const n = d.node;
      if (r.harness_version < this.questionSince[n] || this.busy.has(n)) continue;
      const w = this.w[n];
      const t = h.nodes[n].thresholds;
      const mode = h.nodes[n].mode;

      if (mode === "shadow" && d.agree !== undefined) {
        w.shadow.push(d.agree);
        w.sinceRewrite++;
        const recent = last(w.shadow, t.min_samples);
        if (recent.length >= t.min_samples && rate(recent) >= t.promote_agreement) {
          changes.push({ type: "promote", node: n, detail: `agreement ${pct(rate(recent))} over ${recent.length} decisions` });
        } else if (w.sinceRewrite >= REWRITE_AFTER && rate(last(w.shadow, REWRITE_AFTER)) < REWRITE_BELOW) {
          changes.push({ type: "rewrite", node: n, detail: `stuck at ${pct(rate(last(w.shadow, REWRITE_AFTER)))} agreement` });
        }
      }

      if (mode === "reflex") {
        w.fallbacks.push(d.used === "fallback");
        if (d.audited && d.agree !== undefined) w.audits.push(d.agree);
        const audits = last(w.audits, 6);
        const fb = last(w.fallbacks, 15);
        if (audits.length >= 4 && rate(audits) < t.demote_agreement) {
          changes.push({ type: "demote", node: n, detail: `audit agreement fell to ${pct(rate(audits))}` });
        } else if (fb.length >= 10 && rate(fb) > t.max_fallback_rate) {
          changes.push({ type: "demote", node: n, detail: `confidence collapsed: ${pct(rate(fb))} of recent decisions fell back` });
        }
      }
    }
    // One change per node per observation.
    const seen = new Set<NodeName>();
    return changes.filter((c) => (seen.has(c.node) ? false : (seen.add(c.node), true)));
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
