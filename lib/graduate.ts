import type { RequestResult } from "./engine";
import { NODES, type Harness, type NodeName } from "./workload";

export type Change =
  | { type: "promote"; node: NodeName; detail: string; floor: number }
  | { type: "demote"; node: NodeName; detail: string }
  | { type: "rewrite"; node: NodeName; detail: string };

type Sample = { agree: boolean; conf: number };
type Window = { shadow: Sample[]; audits: boolean[]; fallbacks: boolean[]; gaps: boolean[]; sinceRewrite: number };

const REWRITE_AFTER = 20; // shadow samples before a stuck node gets its question rewritten
const REWRITE_BELOW = 0.85;
const FLOOR_AGREEMENT = 0.97; // a reflex must agree with the teacher this often on the cases it would handle
const MIN_COVERAGE = 0.6; // ...and handle at least this share of cases itself

// Promotion on what the reflex would actually do: the lowest confidence floor at which agreement on
// cases at or above the floor is >= FLOOR_AGREEMENT while covering >= MIN_COVERAGE of cases.
export function calibratedFloor(samples: Sample[]) {
  const sorted = [...samples].sort((a, b) => a.conf - b.conf);
  for (let i = 0; i <= sorted.length * (1 - MIN_COVERAGE); i++) {
    const above = sorted.slice(i);
    const agreement = above.filter((s) => s.agree).length / above.length;
    if (agreement >= FLOOR_AGREEMENT)
      return { floor: Math.max(0.5, sorted[i].conf), coverage: above.length / sorted.length, agreement };
  }
  return null;
}
const GAP_WINDOW = 10; // recent System 2 answers checked for "none of the options fit"
const GAP_MIN = 3;

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
    return { shadow: [], audits: [], fallbacks: [], gaps: [], sinceRewrite: 0 };
  }

  reset(node: NodeName, version: number) {
    this.w[node] = this.fresh();
    this.questionSince[node] = version;
  }

  // `late` = async audit results arriving after the alert was served (don't count them as fallbacks).
  observe(r: Pick<RequestResult, "decisions" | "harness_version">, h: Harness, late = false): Change[] {
    const changes: Change[] = [];
    for (const d of r.decisions) {
      const n = d.node;
      if (r.harness_version < this.questionSince[n] || this.busy.has(n)) continue;
      const w = this.w[n];
      const t = h.nodes[n].thresholds;
      const mode = h.nodes[n].mode;

      // Taxonomy gap: the teacher keeps proposing an option the reflex doesn't have.
      if (d.s2 !== undefined) {
        w.gaps.push(!!d.suggestion);
        const gaps = last(w.gaps, GAP_WINDOW).filter(Boolean).length;
        if (w.gaps.length >= GAP_WINDOW / 2 && gaps >= GAP_MIN) {
          changes.push({ type: "rewrite", node: n, detail: `teacher proposed a new option in ${gaps} of the last ${GAP_WINDOW} decisions ("${d.suggestion ?? "new pattern"}")` });
          continue;
        }
      }

      if (mode === "shadow" && d.agree !== undefined && d.s1) {
        w.shadow.push({ agree: d.agree, conf: d.s1.confidence });
        w.sinceRewrite++;
        const recent = last(w.shadow, t.min_samples);
        const cal = recent.length >= t.min_samples ? calibratedFloor(recent) : null;
        const plain = rate(recent.map((s) => s.agree));
        if (cal) {
          changes.push({
            type: "promote",
            node: n,
            floor: cal.floor,
            detail: `agrees ${pct(cal.agreement)} on the ${pct(cal.coverage)} of cases it is confident about (floor ${cal.floor.toFixed(2)})`,
          });
        } else if (w.sinceRewrite >= REWRITE_AFTER && plain < REWRITE_BELOW) {
          changes.push({ type: "rewrite", node: n, detail: `stuck at ${pct(plain)} agreement` });
        }
      }

      if (mode === "reflex") {
        // Only low-confidence fallbacks are the reflex's own fault; novelty and memory fallbacks aren't.
        if (!late) w.fallbacks.push(d.fallback_reason === "low_confidence");
        if (d.audited && d.agree !== undefined) w.audits.push(d.agree);
        const audits = last(w.audits, 6);
        const fb = last(w.fallbacks, 15);
        if (audits.length >= 4 && rate(audits) < t.demote_agreement) {
          changes.push({ type: "demote", node: n, detail: `audit agreement fell to ${pct(rate(audits))}` });
        } else if (fb.length >= 10 && rate(fb) > t.max_fallback_rate) {
          changes.push({ type: "demote", node: n, detail: `confidence collapsed: ${pct(rate(fb))} of recent decisions were low-confidence` });
        }
      }
    }
    // One change per node per observation.
    const seen = new Set<NodeName>();
    return changes.filter((c) => (seen.has(c.node) ? false : (seen.add(c.node), true)));
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
