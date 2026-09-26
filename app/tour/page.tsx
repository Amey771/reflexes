"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CHAPTERS, LEGEND, PAIN, STORY_DB } from "@/lib/story";
import { NODE_LABEL, NODES, type NodeName } from "@/lib/workload";

// Story mode: the recorded run told in six chapters, each pinned to a real moment.
// Same data as /details, rendered for a 10-second read: plain words, one sentence, big states.

type Question = { instructions: string; criteria?: Record<string, string> | string[] };
type Version = { version: number; nodes: Record<string, { mode: "shadow" | "reflex"; question: Question }> };
type Dec = { seq: number; node: string; used: "system2" | "reflex" | "fallback" };
type Ev = { _id: string; type: "promote" | "demote" | "rewrite" | "novel"; node: string | null; version: number; seq: number; before?: { question?: Question }; after?: { question?: Question } };
type Point = { seq: number; cost: number };
type Alert = { seq: number; text: string; action: string };
type Payload = { versions?: Version[]; decisions?: Dec[]; events?: Ev[]; series?: Point[]; alerts?: Alert[] };

type CardState = keyof typeof LEGEND;
const STATE_COLOR: Record<CardState, string> = {
  llm: "var(--thinking)",
  reflex: "var(--status-good)",
  handedBack: "var(--status-warning)",
  rewriting: "var(--series-1)",
};
const SOURCE: Record<Dec["used"], CardState> = { system2: "llm", reflex: "reflex", fallback: "handedBack" };

// Result numbers from the recorded runs (see README → Results).
const RESULTS = [
  { label: "Cost per 1,000 alerts", value: "$1.03 → $0.40", note: "2.6× cheaper" },
  { label: "Alerts with no LLM call", value: "0% → 38%", note: "all six decisions by reflexes" },
  { label: "All-reflex alert", value: "257 ms", note: "vs 890 ms on the LLM (3.5×)" },
  { label: "With a frontier LLM", value: "238 ms", note: "vs 2.4 s (10×, earlier run)" },
  { label: "Accuracy", value: "95.8% → 91.8%", note: "the trade, measured on labels it never sees" },
];

const WINDOW = 20;
const ANIM_MS = 2600;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
// Option names of a choice question (score levels are descriptions, not options, so they never diff).
const keys = (q?: Question) => (!q?.criteria || Array.isArray(q.criteria) ? [] : Object.keys(q.criteria));

export default function Story() {
  const [data, setData] = useState<Payload | null>(null);
  const [idx, setIdx] = useState(0);
  const [cursor, setCursor] = useState(CHAPTERS[0].at);
  const [animating, setAnimating] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const goTo = useCallback((i: number) => {
    const ch = CHAPTERS[Math.max(0, Math.min(CHAPTERS.length - 1, i))];
    const target = CHAPTERS.indexOf(ch);
    setIdx(target);
    if (timer.current) clearInterval(timer.current);
    if (ch.from == null) {
      setAnimating(false);
      setCursor(ch.at);
      return;
    }
    const from = ch.from;
    const t0 = Date.now();
    setAnimating(true);
    setCursor(from);
    timer.current = setInterval(() => {
      const t = Math.min(1, (Date.now() - t0) / ANIM_MS);
      setCursor(Math.round(from + (ch.at - from) * ease(t)));
      if (t >= 1) {
        if (timer.current) clearInterval(timer.current);
        setAnimating(false);
      }
    }, 40);
  }, []);

  // Load the recorded run once; ?ch=N opens chapter N (1-based).
  useEffect(() => {
    fetch(`/api/state?db=${STORY_DB}`)
      .then((r) => r.json())
      .then((p: Payload) => {
        setData(p);
        const ch = Number(new URLSearchParams(window.location.search).get("ch"));
        if (ch >= 1 && ch <= CHAPTERS.length) goTo(ch - 1);
      })
      .catch(() => setData({}));
  }, [goTo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        goTo(idx + 1);
      } else if (e.key === "ArrowLeft") goTo(idx - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, goTo]);

  // Index the run once.
  const index = useMemo(() => {
    const bySeq = new Map<number, Dec[]>();
    const reflexCount = new Map<number, number>();
    for (const d of data?.decisions ?? []) {
      bySeq.set(d.seq, [...(bySeq.get(d.seq) ?? []), d]);
      if (d.used === "reflex") reflexCount.set(d.seq, (reflexCount.get(d.seq) ?? 0) + 1);
    }
    const series = new Map((data?.series ?? []).map((p) => [p.seq, p]));
    const alerts = new Map((data?.alerts ?? []).map((a) => [a.seq, a]));
    return { bySeq, reflexCount, series, alerts };
  }, [data]);

  const ch = CHAPTERS[idx];
  const view = useMemo(() => {
    const at = cursor;
    const events = (data?.events ?? []).filter((e) => e.seq <= at);
    const vAt = events.reduce((m, e) => Math.max(m, e.version ?? 0), 0);
    const versions = data?.versions ?? [];
    const harness = [...versions].reverse().find((v) => v.version <= vAt) ?? versions[0];
    const exampleSeq = ch.alertSeq ?? at;
    const example = index.bySeq.get(exampleSeq) ?? [];

    const cards = NODES.map((n: NodeName) => {
      const mode = harness?.nodes[n]?.mode ?? "shadow";
      const mine = events.filter((e) => e.node === n);
      const lastPromote = [...mine].reverse().find((e) => e.type === "promote");
      const lastChange = [...mine].reverse().find((e) => e.type === "demote" || e.type === "rewrite");
      const lastRewrite = [...mine].reverse().find((e) => e.type === "rewrite");
      const used = example.find((d) => d.node === n)?.used;
      let state: CardState = mode === "reflex" ? "reflex" : "llm";
      if (mode === "shadow" && lastChange && (!lastPromote || lastChange.seq > lastPromote.seq)) state = "rewriting";
      if (mode === "reflex" && used === "fallback") state = "handedBack";
      const added = lastRewrite ? keys(lastRewrite.after?.question).filter((k) => !keys(lastRewrite.before?.question).includes(k)) : [];
      return { n, state, added };
    });

    let full = 0;
    let seen = 0;
    for (let s = Math.max(0, at - WINDOW + 1); s <= at; s++) {
      if (!index.bySeq.has(s)) continue;
      seen++;
      if (index.reflexCount.get(s) === NODES.length) full++;
    }
    return {
      cards,
      exampleSeq,
      example,
      alert: index.alerts.get(exampleSeq),
      cost: index.series.get(at)?.cost,
      costWas: index.series.get(WINDOW - 1)?.cost,
      noLlm: seen ? full / seen : 0,
    };
  }, [cursor, data, index, ch]);

  const loading = !data;
  const isResult = ch.id === "result";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col gap-4 px-6 py-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">
          Reflexes <span className="font-normal text-ink-2">· agents that grow reflexes</span>
        </h1>
        <Link href={`/?db=${STORY_DB}&at=${cursor}`} className="rounded-full border border-line bg-surface-1 px-4 py-2 text-sm text-ink-2 hover:border-ink-3">
          Open the console →
        </Link>
      </header>

      <div className="rounded-xl border border-line bg-surface-1 px-5 py-3 text-xl font-medium text-ink" style={{ borderLeft: "4px solid var(--thinking)" }}>{PAIN}</div>

      <nav className="flex flex-wrap items-center gap-2" aria-label="Chapters">
        {CHAPTERS.map((c, i) => (
          <button
            key={c.id}
            onClick={() => goTo(i)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${i === idx ? "border-ink bg-ink font-semibold text-page" : i < idx ? "border-line bg-surface-2 text-ink-2" : "border-line bg-surface-1 text-ink-3 hover:border-ink-3"}`}
          >
            {c.title}
          </button>
        ))}
        <span className="ml-auto text-sm tabular-nums text-ink-3">alert #{cursor}</span>
        <button onClick={() => goTo(idx - 1)} disabled={idx === 0} className="rounded-full border border-line px-4 py-2 text-sm text-ink-2 disabled:opacity-40">
          ←
        </button>
        <button
          onClick={() => goTo(idx + 1)}
          disabled={idx === CHAPTERS.length - 1}
          className="rounded-full bg-ink px-6 py-2 text-base font-semibold text-page hover:opacity-90 disabled:opacity-40"
        >
          Next →
        </button>
        <span className="text-xs text-ink-3">or press →</span>
      </nav>

      <section>
        <p className="text-[30px] font-semibold leading-tight tracking-tight">{ch.caption}</p>
        <p className="mt-1.5 text-[13.5px] text-ink-3">{ch.proof}</p>
      </section>

      {loading ? (
        <div className="rounded-xl border border-line bg-surface-1 p-10 text-ink-3">Loading the recorded run…</div>
      ) : (
        <section className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.7fr)_auto_minmax(0,0.8fr)]">
          {/* Security alert */}
          <div className="flex flex-col rounded-xl border border-line bg-surface-1 p-4">
            <div className="mb-2 text-sm text-ink-3">Security alert #{view.exampleSeq}</div>
            <pre className="max-h-40 flex-1 overflow-hidden whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-mono text-[13px] leading-relaxed text-ink">{view.alert?.text ?? "…"}</pre>
            <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              {NODES.map((n) => {
                const used = view.example.find((d) => d.node === n)?.used;
                const s = used ? SOURCE[used] : "llm";
                return (
                  <li key={n} className="flex items-center gap-1.5">
                    <span aria-hidden style={{ color: STATE_COLOR[s] }}>{LEGEND[s].icon}</span>
                    <span className="text-ink-2">{NODE_LABEL[n]}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="hidden items-center text-3xl text-ink-3 lg:flex" aria-hidden>→</div>

          {/* The six decisions */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {view.cards.map(({ n, state, added }) => {
              const focus = ch.focus === n;
              return (
                <div
                  key={n}
                  className="flex flex-col justify-between rounded-xl border bg-surface-1 p-3.5 transition-colors"
                  style={{
                    borderColor: focus ? "var(--text-primary)" : "var(--border)",
                    boxShadow: focus ? "0 0 0 2px var(--text-primary)" : state === "reflex" ? `inset 0 0 0 1px ${STATE_COLOR.reflex}` : undefined,
                  }}
                >
                  <div className="text-base font-medium text-ink-2">{NODE_LABEL[n]}</div>
                  <div className="mt-2 flex items-center gap-2" style={{ color: STATE_COLOR[state] }}>
                    <span className="text-4xl leading-none" aria-hidden>{LEGEND[state].icon}</span>
                    <span className="text-2xl font-bold leading-tight">{LEGEND[state].label}</span>
                  </div>
                  <div className="mt-1 text-xs text-ink-3">{LEGEND[state].sub}</div>
                  {added.map((k) => (
                    <div key={k} className="mt-2 rounded-lg border px-2 py-1" style={{ borderColor: "var(--status-good)", background: "color-mix(in oklab, var(--status-good) 14%, transparent)" }}>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-good">New category</div>
                      <div className="break-all font-mono text-[13px] font-semibold text-good">+ {k}</div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          <div className="hidden items-center text-3xl text-ink-3 lg:flex" aria-hidden>→</div>

          {/* Action taken */}
          <div className="flex flex-col justify-center rounded-xl border border-line bg-surface-1 p-4">
            <div className="text-sm text-ink-3">Action taken</div>
            <div className="mt-2 text-lg font-semibold leading-snug">{view.alert?.action ?? "…"}</div>
          </div>
        </section>
      )}

      {!loading && !isResult && (
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface-1 p-4">
            <div className="text-sm text-ink-3">{ch.metric?.label ?? "Cost per 1,000 alerts"}</div>
            <div className="mt-1 text-4xl font-semibold tabular-nums">
              {ch.metric ? ch.metric.after : view.cost != null ? `$${(view.cost * 1000).toFixed(2)}` : "–"}
            </div>
            <div className="mt-1 text-sm text-ink-3">
              was {ch.metric ? ch.metric.before : view.costWas != null ? `$${(view.costWas * 1000).toFixed(2)}` : "–"} with every decision on the LLM
              {!ch.metric && view.cost != null && view.costWas != null && view.cost > view.costWas && " · up while the LLM handles what the reflexes haven't learned yet"}
            </div>
          </div>
          <div className="rounded-xl border border-line bg-surface-1 p-4">
            <div className="text-sm text-ink-3">Alerts with no LLM call (last 20)</div>
            <div className="mt-1 text-4xl font-semibold tabular-nums">{Math.round(view.noLlm * 100)}%</div>
            <div className="mt-1 text-sm text-ink-3">all six decisions made by reflexes</div>
          </div>
        </section>
      )}

      {isResult && (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {RESULTS.map((r) => (
            <div key={r.label} className="rounded-xl border border-line bg-surface-1 p-4">
              <div className="text-sm text-ink-3">{r.label}</div>
              <div className="mt-1 text-[28px] font-bold leading-tight tabular-nums">{r.value}</div>
              <div className="mt-1 text-xs text-ink-3">{r.note}</div>
            </div>
          ))}
        </section>
      )}

      <footer className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-sm text-ink-3">
        {(Object.keys(LEGEND) as CardState[]).map((k) => (
          <span key={k}>
            <span aria-hidden style={{ color: STATE_COLOR[k] }}>{LEGEND[k].icon}</span> {LEGEND[k].label}
          </span>
        ))}
        <span className="ml-auto">LLM = System 2 (slow thinking) · Jev = System 1 (reflex) · MongoDB = memory</span>
        {animating && <span className="sr-only">Replaying…</span>}
      </footer>
    </main>
  );
}
