"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { NODE_LABEL as LABELS, NODES } from "@/lib/workload";

type NodeState = {
  mode: "shadow" | "reflex";
  question: { type: string; instructions: string; criteria?: unknown };
  agreement: number | null;
  samples: number;
  reflexShare: number;
  confidence: number | null;
};
type Point = { seq: number; batch: string; ms: number; wait: number; cost: number; accuracy: number; reflex: number };
type Ev = { _id: string; type: "promote" | "demote" | "rewrite" | "novel"; node: string | null; detail: string; version: number; seq: number; ts: string; before?: unknown; after?: unknown };
type Kpi = { ms: number | null; wait: number | null; cost: number | null; accuracy: number | null; reflex: number | null };
type State = {
  run: { status: string; processed: number; total: number } | null;
  harness: { version: number; reason: string; versions: number } | null;
  kpis?: { before: Kpi; now: Kpi };
  nodes?: Record<string, NodeState>;
  series?: Point[];
  events?: Ev[];
  recent?: { seq: number; text: string; action: string; novel: boolean; batch: string; nodes: { node: string; used: string; correct: boolean; reason?: string }[] }[];
};

const NODE_ORDER: string[] = [...NODES];
const NODE_LABEL: Record<string, string> = LABELS;

const fmtMs = (v: number | null | undefined) => (v == null ? "–" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const fmtPct = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v * 100)}%`);
const fmtCost = (v: number | null | undefined) => (v == null ? "–" : `$${(v * 1000).toFixed(2)}`);

function ratio(before: number | null | undefined, now: number | null | undefined) {
  if (!before || !now) return null;
  const r = before / now;
  return r >= 1.2 ? `${r.toFixed(r >= 10 ? 0 : 1)}× lower` : null;
}

function Tile({ label, now, before, fmt, better }: { label: string; now?: number | null; before?: number | null; fmt: (v: number | null | undefined) => string; better?: string | null }) {
  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <div className="text-sm text-ink-3">{label}</div>
      <div className="mt-1 text-4xl font-semibold tabular-nums tracking-tight">{fmt(now)}</div>
      <div className="mt-2 flex items-center gap-2 text-sm text-ink-2">
        <span className="tabular-nums">was {fmt(before)}</span>
        {better && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-good">▼ {better}</span>}
      </div>
    </div>
  );
}

function nodeStatus(n: NodeState, demotedRecently: boolean) {
  if (demotedRecently && n.mode === "shadow") return { label: "Demoted", icon: "↓", color: "var(--status-critical)" };
  if (n.mode === "reflex") return { label: "Reflex", icon: "⚡", color: "var(--status-good)" };
  if (n.samples >= 8) return { label: `Learning ${fmtPct(n.agreement)}`, icon: "◐", color: "var(--status-warning)" };
  return { label: "Thinking", icon: "●", color: "var(--thinking)" };
}

function NodeCard({ name, n, demoted, selected, onClick }: { name: string; n: NodeState; demoted: boolean; selected: boolean; onClick: () => void }) {
  const s = nodeStatus(n, demoted);
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border bg-surface-1 p-4 text-left transition-colors ${selected ? "border-ink-2" : "border-line hover:border-ink-3"}`}
      style={{ boxShadow: n.mode === "reflex" ? "inset 0 0 0 1px var(--status-good)" : undefined }}
    >
      <div className="text-base font-medium">{NODE_LABEL[name]}</div>
      <div className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold" style={{ color: s.color, background: "var(--surface-2)" }}>
        <span aria-hidden>{s.icon}</span>
        {s.label}
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${Math.round((n.agreement ?? 0) * 100)}%`, background: s.color }} />
      </div>
      <div className="mt-2 flex justify-between text-xs text-ink-3 tabular-nums">
        <span>agree {fmtPct(n.agreement)}</span>
        <span>conf {n.confidence == null ? "–" : n.confidence.toFixed(2)}</span>
      </div>
    </button>
  );
}

const tooltipStyle = { background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-primary)" };

function Chart({ title, data, lines, fmt, events, launchSeq, domain }: {
  title: string;
  data: Point[];
  lines: { key: keyof Point; name: string; color: string }[];
  fmt: (v: number) => string;
  events: Ev[];
  launchSeq: number | null;
  domain?: [number, number];
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <div className="mb-2 text-sm font-medium text-ink-2">{title}</div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="seq" type="number" domain={["dataMin", "dataMax"]} tick={{ fill: "var(--text-muted)", fontSize: 12 }} stroke="var(--border)" />
            <YAxis tickFormatter={fmt} domain={domain} tick={{ fill: "var(--text-muted)", fontSize: 12 }} stroke="var(--border)" width={56} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(Number(v))} labelFormatter={(l) => `Alert #${l}`} />
            {lines.length > 1 && <Legend wrapperStyle={{ color: "var(--text-secondary)", fontSize: 12 }} />}
            {launchSeq != null && (
              <ReferenceLine x={launchSeq} stroke="var(--text-muted)" strokeDasharray="4 4" label={{ value: "New campaign: attacks on AI agents", fill: "var(--text-secondary)", fontSize: 11, position: "insideTopLeft" }} />
            )}
            {events.map((e) => (
              <ReferenceLine
                key={e._id}
                x={e.seq}
                stroke={e.type === "promote" ? "var(--status-good)" : e.type === "demote" ? "var(--status-critical)" : e.type === "novel" ? "var(--status-warning)" : "var(--thinking)"}
                strokeOpacity={0.5}
                strokeDasharray={e.type === "rewrite" ? "2 3" : undefined}
              />
            ))}
            {lines.map((l) => (
              <Line key={String(l.key)} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={2} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const EVENT_STYLE = {
  promote: { icon: "⚡", label: "Promoted", color: "var(--status-good)" },
  demote: { icon: "↓", label: "Demoted", color: "var(--status-critical)" },
  rewrite: { icon: "✎", label: "Rewrote", color: "var(--thinking)" },
  novel: { icon: "◎", label: "Novel pattern", color: "var(--status-warning)" },
};

export default function Dashboard() {
  const [s, setS] = useState<State | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/state", { cache: "no-store" });
        if (alive && r.ok) setS(await r.json());
      } catch {}
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  async function start() {
    setMsg(null);
    const r = await fetch("/api/run", { method: "POST", body: JSON.stringify({}) });
    const body = await r.json();
    setMsg(body.error ?? "Surge started");
  }

  const series = s?.series ?? [];
  const events = s?.events ?? [];
  const launchSeq = series.find((p) => p.batch === "campaign")?.seq ?? null;
  const now = Date.now();
  const recentlyDemoted = new Set(events.filter((e) => e.type === "demote" && e.node && now - new Date(e.ts).getTime() < 20_000).map((e) => e.node as string));
  const k = s?.kpis;
  const sel = selected && s?.nodes?.[selected];
  const selEvents = events.filter((e) => e.node === selected);

  return (
    <main className="mx-auto w-full max-w-[1440px] space-y-5 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Reflexes</h1>
          <p className="mt-1 text-lg text-ink-2">A SOC agent that grows reflexes. System 2 thinks, System 1 learns, MongoDB remembers.</p>
        </div>
        <div className="flex items-center gap-3">
          {s?.run && (
            <div className="rounded-full border border-line bg-surface-1 px-4 py-2 text-sm tabular-nums text-ink-2">
              {s.run.status === "running" ? "● Live" : "Done"} · {s.run.processed}/{s.run.total} alerts · harness v{s.harness?.version}
            </div>
          )}
          <button onClick={start} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-page hover:opacity-90">
            Start alert storm
          </button>
        </div>
      </header>
      {msg && <div className="text-sm text-ink-3">{msg}</div>}

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Tile label="Time to triage (incl. queue)" now={k?.now.wait} before={k?.before.wait} fmt={fmtMs} better={ratio(k?.before.wait, k?.now.wait)} />
        <Tile label="Decision time per alert" now={k?.now.ms} before={k?.before.ms} fmt={fmtMs} better={ratio(k?.before.ms, k?.now.ms)} />
        <Tile label="Cost per 1,000 alerts" now={k?.now.cost} before={k?.before.cost} fmt={fmtCost} better={ratio(k?.before.cost, k?.now.cost)} />
        <Tile label="Accuracy (held-out labels)" now={k?.now.accuracy} before={k?.before.accuracy} fmt={fmtPct} />
        <Tile label="Decisions on reflex" now={k?.now.reflex} before={k?.before.reflex} fmt={fmtPct} />
      </section>

      <section className="rounded-xl border border-line bg-surface-1/40 p-4">
        <div className="mb-3 flex items-center gap-3 text-sm text-ink-3">
          <span>Security alert</span>
          <span aria-hidden>→</span>
          <span>6 decisions per alert · click one to inspect its reflex</span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {NODE_ORDER.map((n) =>
            s?.nodes?.[n] ? (
              <NodeCard key={n} name={n} n={s.nodes[n]} demoted={recentlyDemoted.has(n)} selected={selected === n} onClick={() => setSelected(selected === n ? null : n)} />
            ) : (
              <div key={n} className="rounded-xl border border-line bg-surface-1 p-4 text-ink-3">{NODE_LABEL[n]}</div>
            ),
          )}
        </div>
        {sel && (
          <div className="mt-4 grid gap-4 rounded-xl border border-line bg-surface-1 p-4 md:grid-cols-2">
            <div>
              <div className="text-sm text-ink-3">Current reflex question (Jev · {sel.question.type})</div>
              <div className="mt-1 text-ink">{sel.question.instructions}</div>
              {sel.question.criteria != null && (
                <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-surface-2 p-3 text-xs text-ink-2">{JSON.stringify(sel.question.criteria, null, 2)}</pre>
              )}
            </div>
            <div>
              <div className="text-sm text-ink-3">History</div>
              <ul className="mt-1 space-y-2 text-sm">
                {selEvents.length === 0 && <li className="text-ink-3">No changes yet</li>}
                {selEvents.map((e) => (
                  <li key={e._id}>
                    <span style={{ color: EVENT_STYLE[e.type].color }}>{EVENT_STYLE[e.type].icon} {EVENT_STYLE[e.type].label}</span>{" "}
                    <span className="text-ink-2">v{e.version} · #{e.seq}: {e.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Chart title="Time to triage, including queue (rolling 20 alerts)" data={series} lines={[{ key: "wait", name: "Wait", color: "var(--series-1)" }]} fmt={(v) => fmtMs(v)} events={events} launchSeq={launchSeq} />
        <Chart title="Cost per 1,000 alerts" data={series} lines={[{ key: "cost", name: "Cost", color: "var(--series-1)" }]} fmt={(v) => fmtCost(v)} events={events} launchSeq={launchSeq} />
        <Chart title="Decision time per alert" data={series} lines={[{ key: "ms", name: "Decision time", color: "var(--series-1)" }]} fmt={(v) => fmtMs(v)} events={events} launchSeq={launchSeq} />
        <Chart
          title="Accuracy vs share of decisions on reflex"
          data={series}
          lines={[
            { key: "accuracy", name: "Accuracy (held-out labels)", color: "var(--series-1)" },
            { key: "reflex", name: "On reflex", color: "var(--series-2)" },
          ]}
          fmt={(v) => fmtPct(v)}
          events={events}
          launchSeq={launchSeq}
          domain={[0, 1]}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface-1 p-4">
          <div className="mb-3 text-sm font-medium text-ink-2">Live alerts · what the agent did</div>
          <ul className="space-y-2">
            {(s?.recent ?? []).map((r) => (
              <li key={r.seq} className="text-sm">
                <div className="flex items-center gap-3">
                  <span className="w-12 shrink-0 tabular-nums text-ink-3">#{r.seq}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{r.text}</span>
                  <span className="flex shrink-0 gap-1" aria-label="decision sources">
                    {NODE_ORDER.map((n) => {
                      const d = r.nodes.find((x) => x.node === n);
                      const c = d?.used === "reflex" ? "var(--status-good)" : d?.used === "fallback" ? "var(--status-warning)" : "var(--thinking)";
                      return <span key={n} title={`${NODE_LABEL[n]}: ${d?.used}${d?.reason ? ` (${d.reason})` : ""}`} className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />;
                    })}
                  </span>
                </div>
                <div className="ml-15 mt-0.5 flex gap-2 text-xs text-ink-3">
                  <span className="text-ink-2">→ {r.action}</span>
                  {r.novel && <span style={{ color: "var(--status-warning)" }}>◎ novel: sent to System 2</span>}
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-4 text-xs text-ink-3">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: "var(--thinking)" }} />System 2 (LLM)</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: "var(--status-good)" }} />Reflex (Jev)</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: "var(--status-warning)" }} />Fell back (low confidence, novel, or not proven on similar alerts)</span>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface-1 p-4">
          <div className="mb-3 text-sm font-medium text-ink-2">Harness evolution · {s?.harness?.versions ?? 0} versions in MongoDB</div>
          <ul className="max-h-72 space-y-2 overflow-auto text-sm">
            {events.length === 0 && <li className="text-ink-3">Waiting for the first graduation…</li>}
            {events.map((e) => (
              <li key={e._id} className="flex gap-2">
                <span className="shrink-0 font-medium" style={{ color: EVENT_STYLE[e.type].color }}>
                  {EVENT_STYLE[e.type].icon} {EVENT_STYLE[e.type].label}
                </span>
                <span className="text-ink-2">
                  {e.node && <span className="text-ink">{NODE_LABEL[e.node]} · </span>}v{e.version} · #{e.seq} · {e.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
