"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { NODE_LABEL, NODES } from "@/lib/workload";

// Sandbox: follow ONE alert through the real engine, stage by stage.
// Stages reveal one at a time; every timing and cost shown is the real one from the run.

type Node = (typeof NODES)[number];
type Question = { type: string; instructions: string; criteria?: Record<string, string> | string[] };
type Facts = { asset_criticality: "high" | "low"; user_privileged: boolean; threat_intel_match: boolean; off_hours: boolean; repeated_today: boolean };
type Answer = string | number | boolean;
type Sample = { seq: number; batch: "base" | "campaign"; text: string; facts: Facts };
type Result = {
  alert: { seq: number; batch: string; text: string; facts: Facts; truth?: Record<string, Answer> };
  harness: { version: number; nodes: Record<Node, { mode: "shadow" | "reflex"; confidence_floor: number; context: string[]; question: Question }> };
  memory: {
    available: boolean;
    experiences: number;
    top: number | null;
    novel: boolean;
    novel_below: number | null;
    trust: Partial<Record<Node, { cases: number; rate: number }>>;
    neighbors: { seq: number; score: number; text: string; agree?: Partial<Record<Node, boolean>> }[];
    rules: { trust_min: number; trust_min_cases: number };
  };
  trace: { recall_ms: number; s1_ms: number; s1_cost: number; s2_learning?: { nodes: Node[]; ms: number; cost: number }; s2_fallback?: { nodes: Node[]; ms: number; cost: number } };
  decisions: { node: Node; mode: "shadow" | "reflex"; used: "system2" | "reflex" | "fallback"; reason: string | null; s1: { answer: Answer; confidence: number } | null; s2: Answer | null; final: Answer; agree: boolean | null; correct?: boolean }[];
  action: string;
  totals: { ms: number; cost: number };
};

const BLANK: Facts = { asset_criticality: "low", user_privileged: false, threat_intel_match: false, off_hours: false, repeated_today: false };
const FACTS: { key: keyof Facts; label: string }[] = [
  { key: "asset_criticality", label: "Critical asset" },
  { key: "user_privileged", label: "Privileged (admin) user" },
  { key: "threat_intel_match", label: "Matches threat intel" },
  { key: "off_hours", label: "Outside business hours" },
  { key: "repeated_today", label: "Already seen today" },
];
const factOn = (f: Facts, k: keyof Facts) => (k === "asset_criticality" ? f.asset_criticality === "high" : !!f[k]);

const COLOR = { reflex: "var(--status-good)", llm: "var(--thinking)", fallback: "var(--status-warning)", bad: "var(--status-critical)" };
const WHO = {
  reflex: { label: "Reflex", color: COLOR.reflex },
  system2: { label: "LLM (still learning)", color: COLOR.llm },
  fallback: { label: "LLM (reflex stepped aside)", color: COLOR.fallback },
} as const;
const REVEAL_MS = 900;

const ACRONYMS: Record<string, string> = { ai: "AI", llm: "LLM", mfa: "MFA", ip: "IP", api: "API" };
function pretty(s: string) {
  const words = s.replaceAll("_", " ").split(" ").map((w) => ACRONYMS[w.toLowerCase()] ?? w);
  const out = words.join(" ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}
// Readable answers: Yes/No for booleans, the level name for severity scores, spaces for underscores.
function fmtAnswer(a: Answer | null | undefined, q?: Question) {
  if (a === null || a === undefined) return "–";
  if (typeof a === "boolean") return a ? "Yes" : "No";
  if (typeof a === "number" && Array.isArray(q?.criteria)) return (q.criteria[a] ?? String(a)).split(":")[0];
  return pretty(String(a));
}
const money = (x: number) => (x < 0.0001 ? `$${x.toFixed(5)}` : `$${x.toFixed(4)}`);
const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);

function Mark({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="text-ink-3">–</span>;
  return <span style={{ color: ok ? COLOR.reflex : COLOR.fallback }}>{ok ? "✓" : "✗"}</span>;
}

function FactChips({ facts }: { facts: Facts }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-xs">
      {FACTS.map((f) => {
        const on = factOn(facts, f.key);
        return (
          <span key={f.key} className={`rounded-full px-2.5 py-1 ${on ? "bg-surface-2 text-ink" : "text-ink-3 line-through"}`}>
            {f.label}
          </span>
        );
      })}
    </div>
  );
}

function Step({ n, title, hint, meta, shown, children }: { n: number; title: string; hint: string; meta?: string | null; shown: boolean; children?: React.ReactNode }) {
  return (
    <li className={`relative pb-8 pl-12 transition-opacity duration-500 last:pb-0 ${shown ? "opacity-100" : "opacity-30"}`}>
      <span className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-ink text-sm font-bold text-page">{n}</span>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-base font-semibold">{title}</h3>
        {shown && meta && <span className="text-xs tabular-nums text-ink-3">{meta}</span>}
      </div>
      <p className="mt-0.5 text-sm text-ink-3">{hint}</p>
      {shown && children && <div className="mt-3">{children}</div>}
    </li>
  );
}

export default function Sandbox() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [choice, setChoice] = useState<number | "custom" | null>(null);
  const [text, setText] = useState("");
  const [facts, setFacts] = useState<Facts>(BLANK);
  const [result, setResult] = useState<Result | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    fetch("/api/sandbox")
      .then((r) => r.json())
      .then((b) => {
        setEnabled(!!b.enabled);
        setMessage(b.message ?? null);
        setSamples(b.samples ?? []);
        if (b.samples?.length) setChoice(b.samples[0].seq);
      })
      .catch(() => setEnabled(false));
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const sample = typeof choice === "number" ? samples.find((s) => s.seq === choice) : undefined;
  const pendingAlert = choice === "custom" ? { text, facts } : sample ? { text: sample.text, facts: sample.facts } : null;

  async function run() {
    if (choice === null || (choice === "custom" && !text.trim())) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setResult(null);
    setError(null);
    setBusy(true);
    setRevealed(1);
    try {
      const r = await fetch("/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(choice === "custom" ? { text, facts } : { seq: choice }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "The run failed");
      setResult(body);
      for (let step = 2; step <= 5; step++) timers.current.push(setTimeout(() => setRevealed(step), (step - 1) * REVEAL_MS));
    } catch (e) {
      setError((e as Error).message);
      setRevealed(0);
    }
    setBusy(false);
  }

  const q = (n: Node) => result?.harness.nodes[n].question;
  const mem = result?.memory;
  const memEmpty = !!result && (!mem?.available || (mem?.experiences ?? 0) < 3);
  const llmCalls = [result?.trace.s2_learning, result?.trace.s2_fallback].filter(Boolean) as { ms: number; cost: number }[];
  const llmMeta = result ? (llmCalls.length ? `LLM: ${Math.max(...llmCalls.map((c) => c.ms))} ms · ${money(llmCalls.reduce((s, c) => s + c.cost, 0))}` : "LLM not called") : null;
  const seeded = !!result?.alert.truth;

  return (
    <main className="mx-auto w-full max-w-[1280px] px-6 py-8">
      <Link href="/" className="text-sm text-ink-3 hover:text-ink-2">← Dashboard</Link>
      <h1 className="mt-2 text-4xl font-bold tracking-tight">Sandbox</h1>
      <p className="mt-2 max-w-3xl text-lg text-ink-2">Follow a single alert through the agent, step by step.</p>

      {enabled === false && (
        <div className="mt-8 rounded-xl border border-line bg-surface-1 p-6 text-ink-2">{message ?? "The sandbox is turned off on this deployment."}</div>
      )}

      {enabled && (
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          {/* Left: choose an alert */}
          <section>
            <h2 className="text-xl font-semibold">1. Choose an alert</h2>
            <p className="mt-1 text-sm text-ink-3">Pick a sample or write your own. &ldquo;New attack type&rdquo; samples are attacks on the company&apos;s AI agents, which the agent wasn&apos;t built for.</p>
            <div className="mt-4 space-y-2">
              {samples.map((s) => (
                <button
                  key={s.seq}
                  onClick={() => setChoice(s.seq)}
                  className={`block w-full rounded-xl border bg-surface-1 p-3 text-left transition-colors ${choice === s.seq ? "border-ink" : "border-line hover:border-ink-3"}`}
                >
                  <div className="text-xs" style={{ color: s.batch === "campaign" ? COLOR.fallback : "var(--text-muted)" }}>
                    {s.batch === "campaign" ? "◎ New attack type" : "Everyday alert"}
                  </div>
                  <div className="mt-1 line-clamp-2 text-sm text-ink">{s.text}</div>
                </button>
              ))}
              <button
                onClick={() => setChoice("custom")}
                className={`block w-full rounded-xl border bg-surface-1 p-3 text-left text-sm font-medium transition-colors ${choice === "custom" ? "border-ink" : "border-line hover:border-ink-3"}`}
              >
                ✎ Write your own
              </button>
              {choice === "custom" && (
                <div className="space-y-2 rounded-xl border border-line bg-surface-1 p-3">
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={1000}
                    rows={5}
                    placeholder="Paste or write a security alert…"
                    className="w-full resize-y rounded-lg border border-line bg-surface-2 p-3 font-mono text-[13px] leading-relaxed text-ink outline-none focus:border-ink-3"
                  />
                  <div className="text-xs text-ink-3">Facts come from the company&apos;s own systems (asset inventory, directory, threat-intel feeds), not from AI.</div>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {FACTS.map((f) => {
                      const on = factOn(facts, f.key);
                      return (
                        <button
                          key={f.key}
                          onClick={() =>
                            setFacts(f.key === "asset_criticality" ? { ...facts, asset_criticality: on ? "low" : "high" } : { ...facts, [f.key]: !on })
                          }
                          className={`rounded-full border px-2.5 py-1 ${on ? "border-ink bg-surface-2 text-ink" : "border-line text-ink-3"}`}
                        >
                          {f.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={run}
              disabled={busy || choice === null || (choice === "custom" && !text.trim())}
              className="mt-4 w-full rounded-full bg-ink py-3 text-base font-semibold text-page hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Running…" : "Run through the agent"}
            </button>
            <p className="mt-2 text-xs text-ink-3">Each run makes one Jev call and at most two LLM calls (a fraction of a cent). Nothing is saved.</p>
            {error && <p className="mt-2 text-sm" style={{ color: COLOR.bad }}>{error}</p>}
          </section>

          {/* Right: watch it get decided */}
          <section>
            <h2 className="text-xl font-semibold">2. Watch it get decided</h2>
            <p className="mt-1 text-sm text-ink-3">Each stage lights up in order. The timings and costs are real.</p>
            <ol className="relative mt-4 rounded-2xl border border-line bg-surface-1 p-5 before:absolute before:bottom-8 before:left-[36px] before:top-8 before:w-px before:bg-line">
              <Step n={1} title="The alert arrives" hint="The alert text plus a few facts computed by ordinary code." shown={revealed >= 1}>
                {(result?.alert ?? pendingAlert) && (
                  <div className="space-y-2">
                    <div className="rounded-lg bg-surface-2 p-3 text-sm leading-relaxed text-ink">{(result?.alert ?? pendingAlert)!.text}</div>
                    <FactChips facts={(result?.alert ?? pendingAlert)!.facts} />
                    {busy && <div className="text-sm text-ink-3">Running the real engine…</div>}
                  </div>
                )}
              </Step>

              <Step
                n={2}
                title="Memory: have we seen something like this?"
                hint="MongoDB Vector Search finds the most similar past alerts. If nothing is close, no reflex is trusted with this one."
                meta={result ? `${result.trace.recall_ms} ms · runs at the same time as step 3` : null}
                shown={revealed >= 2}
              >
                {mem && memEmpty && <div className="text-sm text-ink-2">Memory is empty. Run an alert storm first so there are past alerts to compare with.</div>}
                {mem && !memEmpty && (
                  <div className="space-y-3 text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <span>
                        Closest match: <span className="font-semibold tabular-nums">{pct(mem.top)}</span> similar
                      </span>
                      {mem.novel_below == null ? (
                        <span className="text-ink-3">Novelty check still warming up</span>
                      ) : mem.novel ? (
                        <span style={{ color: COLOR.fallback }}>◎ Unfamiliar (below the novelty line of {pct(mem.novel_below)})</span>
                      ) : (
                        <span style={{ color: COLOR.reflex }}>✓ Familiar (novelty line {pct(mem.novel_below)})</span>
                      )}
                    </div>
                    <div className="text-xs text-ink-3">
                      Searched {mem.experiences} past alerts{seeded ? "; this sample's own past record is left out" : ""}.
                    </div>
                    <ul className="space-y-1.5">
                      {mem.neighbors.slice(0, 3).map((nb) => (
                        <li key={nb.seq} className="flex items-center gap-3">
                          <span className="w-10 shrink-0 tabular-nums text-ink-3">{pct(nb.score)}</span>
                          <span className="min-w-0 flex-1 truncate text-ink-2" title={nb.text}>{nb.text}</span>
                          <span className="flex shrink-0 gap-1" aria-label="did each reflex agree with the LLM on this past alert">
                            {NODES.map((n) => {
                              const a = nb.agree?.[n];
                              return (
                                <span
                                  key={n}
                                  title={`${NODE_LABEL[n]}: ${a === undefined ? "not checked" : a ? "agreed" : "disagreed"}`}
                                  className="h-2 w-2 rounded-full"
                                  style={{ background: a === undefined ? "var(--surface-2)" : a ? COLOR.reflex : COLOR.bad }}
                                />
                              );
                            })}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="text-xs text-ink-3">Dots: did each reflex agree with the LLM on that past alert (green yes, red no, grey not checked)?</div>
                  </div>
                )}
              </Step>

              <Step
                n={3}
                title="Jev answers all six questions at once"
                hint="One fast call to Jev (System 1) answers every decision, each with a confidence score."
                meta={result ? `${result.trace.s1_ms} ms · ${money(result.trace.s1_cost)}` : null}
                shown={revealed >= 3}
              >
                {result && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {result.decisions.map((d) => (
                      <div key={d.node} className="rounded-lg bg-surface-2 p-3">
                        <div className="text-xs text-ink-3">{NODE_LABEL[d.node]}</div>
                        <div className="mt-0.5 truncate text-sm font-semibold" title={fmtAnswer(d.s1?.answer, q(d.node))}>{fmtAnswer(d.s1?.answer, q(d.node))}</div>
                        <div className="mt-2 h-1.5 rounded-full bg-page">
                          <div className="h-full rounded-full" style={{ width: `${Math.round((d.s1?.confidence ?? 0) * 100)}%`, background: "var(--series-1)" }} />
                        </div>
                        <div className="mt-1 text-xs tabular-nums text-ink-3">confidence {d.s1?.confidence.toFixed(2) ?? "–"}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Step>

              <Step
                n={4}
                title="Should each reflex act?"
                hint="A graduated reflex acts only if all three checks pass. Anything else goes to the LLM (System 2)."
                meta={llmMeta}
                shown={revealed >= 4}
              >
                {result && mem && (
                  <div className="space-y-2">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[560px] table-fixed text-sm">
                        <colgroup>
                          <col className="w-[24%]" />
                          <col className="w-[19%]" />
                          <col className="w-[15%]" />
                          <col className="w-[18%]" />
                          <col className="w-[24%]" />
                        </colgroup>
                        <thead>
                          <tr className="text-left text-xs text-ink-3">
                            <th className="pb-2 font-normal">Decision</th>
                            <th className="pb-2 font-normal">Confident enough?</th>
                            <th className="pb-2 font-normal">Familiar alert?</th>
                            <th className="pb-2 font-normal">Proven on similar?</th>
                            <th className="pb-2 font-normal">Who decides</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {result.decisions.map((d) => {
                            const cfg = result.harness.nodes[d.node];
                            const who = WHO[d.used];
                            if (d.mode === "shadow")
                              return (
                                <tr key={d.node}>
                                  <td className="py-2 font-medium">{NODE_LABEL[d.node]}</td>
                                  <td colSpan={3} className="py-2 text-ink-3">Still learning this decision, so the LLM decides.</td>
                                  <td className="py-2 font-medium" style={{ color: who.color }}>● LLM</td>
                                </tr>
                              );
                            const conf = d.s1?.confidence ?? 0;
                            const t = mem.trust[d.node];
                            const agreed = t ? Math.round(t.rate * t.cases) : 0;
                            const enough = !!t && t.cases >= mem.rules.trust_min_cases;
                            return (
                              <tr key={d.node}>
                                <td className="py-2 font-medium">{NODE_LABEL[d.node]}</td>
                                <td className="py-2 tabular-nums">
                                  <Mark ok={conf >= cfg.confidence_floor} /> {conf.toFixed(2)} vs {cfg.confidence_floor.toFixed(2)}
                                </td>
                                <td className="py-2">
                                  {memEmpty ? <Mark ok={null} /> : <Mark ok={!mem.novel} />} {memEmpty ? "no memory" : mem.novel ? "no" : "yes"}
                                </td>
                                <td className="py-2 tabular-nums">
                                  {!t ? (
                                    <span className="text-ink-3">– no data</span>
                                  ) : (
                                    <>
                                      <Mark ok={enough ? t.rate >= mem.rules.trust_min : null} /> {agreed}/{t.cases} agreed
                                    </>
                                  )}
                                </td>
                                <td className="py-2 font-medium" style={{ color: who.color }}>● {d.used === "reflex" ? "Reflex" : "LLM"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-ink-3">
                      Confidence has to clear the floor each reflex set for itself when it graduated. &ldquo;Proven on similar&rdquo; needs at least {mem.rules.trust_min_cases} similar past alerts where the reflex was checked; it fails if it agreed with the LLM on fewer than {Math.round(mem.rules.trust_min * 100)}% of them.
                      {!llmCalls.length && " Every decision was handled by a reflex, so the LLM was never called."}
                    </p>
                  </div>
                )}
              </Step>

              <Step
                n={5}
                title="Final decision"
                hint="The six answers combine into what the security team's agent actually does."
                meta={result ? `total ${result.totals.ms >= 1000 ? `${(result.totals.ms / 1000).toFixed(1)} s` : `${result.totals.ms} ms`} · ${money(result.totals.cost)}` : null}
                shown={revealed >= 5}
              >
                {result && (
                  <div className="space-y-3">
                    <div className="rounded-xl bg-surface-2 p-4">
                      <div className="text-xs text-ink-3">Action</div>
                      <div className="mt-1 text-2xl font-bold leading-snug">{result.action}</div>
                    </div>
                    <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                      {result.decisions.map((d) => (
                        <li key={d.node} className="flex items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: WHO[d.used].color }} />
                          <span className="w-32 shrink-0 text-ink-3">{NODE_LABEL[d.node]}</span>
                          <span className="min-w-0 flex-1 truncate font-medium" title={fmtAnswer(d.final, q(d.node))}>{fmtAnswer(d.final, q(d.node))}</span>
                          {seeded && <span style={{ color: d.correct ? COLOR.reflex : COLOR.bad }}>{d.correct ? "✓" : "✗"}</span>}
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-ink-3">
                      {Object.values(WHO).map((w) => (
                        <span key={w.label}>
                          <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: w.color }} />
                          {w.label}
                        </span>
                      ))}
                      {seeded && <span>✓/✗ compared with the hidden label, which the agent never sees</span>}
                    </div>
                  </div>
                )}
              </Step>
            </ol>
            {result && (
              <p className="mt-3 text-xs text-ink-3">
                Harness v{result.harness.version}, from the most recent recorded run. Which reflexes have graduated, and what memory holds, depend on how far that run got.
              </p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
