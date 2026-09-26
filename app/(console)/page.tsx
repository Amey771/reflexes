"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { IconLLM, IconReflex, IconRewrite } from "@/app/icons";
import ImpactCard from "@/app/impact";
import { NODE_LABEL as LABELS, NODES } from "@/lib/workload";

// ---------- payload types (from /api/state) ----------
type Question = { type: string; instructions: string; criteria?: Record<string, string> | string[] };
type NodeCfg = { mode: "shadow" | "reflex"; question: Question; context: string[]; thresholds: { confidence_floor: number } };
type Version = { version: number; reason: string; nodes: Record<string, NodeCfg> };
type Point = { seq: number; batch: string; novel?: boolean; recall_top?: number | null; ms: number; ms_raw?: number; wait: number; cost: number; accuracy: number; reflex: number; noLlm?: number };
type Dec = { seq: number; node: string; used: "system2" | "reflex" | "fallback"; agree?: boolean | null; audited?: boolean; mode: string; v: number; reason?: string; conf?: number };
type Ev = {
  _id: string;
  type: "promote" | "demote" | "rewrite" | "novel";
  node: string | null;
  detail: string;
  version: number;
  seq: number;
  before?: { question?: Question; context?: string[] } & Question;
  after?: { question?: Question; context?: string[] };
};
type Alert = { seq: number; text: string; action: string; novel: boolean; batch: string };
type Payload = {
  run: { id: string; status: string; processed: number; total: number } | null;
  canRun: boolean;
  versions?: Version[];
  series?: Point[];
  decisions?: Dec[];
  events?: Ev[];
  alerts?: Alert[];
};

const NODE_ORDER: string[] = [...NODES];
const NODE_LABEL: Record<string, string> = LABELS;
const WINDOW = 20;

const fmtMs = (v: number | null | undefined) => (v == null ? "–" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const fmtPct = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v * 100)}%`);
const fmtCost = (v: number | null | undefined) => (v == null ? "–" : `$${(v * 1000).toFixed(2)}`);
const rate = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : null);

function ratio(before: number | null | undefined, now: number | null | undefined) {
  if (!before || !now) return null;
  const r = before / now;
  return r >= 1.2 ? `${r.toFixed(r >= 10 ? 0 : 1)}× lower` : null;
}

// ---------- small components ----------
function Tile({ label, now, before, fmt, better, note }: { label: string; now?: number | null; before?: number | null; fmt: (v: number | null | undefined) => string; better?: string | null; note?: string | null }) {
  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <div className="text-sm text-ink-3">{label}</div>
      <div className="mt-1 text-4xl font-semibold tabular-nums tracking-tight">{fmt(now)}</div>
      <div className="mt-2 flex items-center gap-2 text-sm text-ink-2">
        <span className="tabular-nums">was {fmt(before)}</span>
        {better && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-good">▼ {better}</span>}
      </div>
      {note && <div className="mt-1 text-xs text-ink-3">{note}</div>}
    </div>
  );
}

type NodeView = { mode: "shadow" | "reflex"; demoted: boolean; agreement: number | null; samples: number; audits: number; reflexShare: number; confidence: number | null; floor: number };

function nodeStatus(n: NodeView) {
  if (n.demoted && n.mode === "shadow") return { label: "Demoted · relearning", icon: <IconRewrite size={15} />, color: "var(--status-critical)" };
  if (n.mode === "reflex") return { label: "Reflex", icon: <IconReflex size={15} />, color: "var(--status-good)" };
  if (n.samples >= 5) return { label: `Learning ${fmtPct(n.agreement)}`, icon: <IconLLM size={15} />, color: "var(--status-warning)" };
  return { label: "On the LLM", icon: <IconLLM size={15} />, color: "var(--thinking)" };
}

function NodeCard({ name, n, selected, onClick }: { name: string; n: NodeView; selected: boolean; onClick: () => void }) {
  const s = nodeStatus(n);
  const bar = n.mode === "reflex" ? n.reflexShare : n.agreement ?? 0;
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border bg-surface-1 p-4 text-left transition-colors ${selected ? "border-ink-2" : "border-line hover:border-ink-3"}`}
      style={{ boxShadow: n.mode === "reflex" ? "inset 0 0 0 1px var(--status-good)" : undefined }}
    >
      <div className="text-base font-medium">{NODE_LABEL[name]}</div>
      <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-sm font-semibold" style={{ color: s.color }}>
        <span aria-hidden>{s.icon}</span>
        {s.label}
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.round(bar * 100)}%`, background: s.color }} />
      </div>
      <div className="mt-2 flex justify-between text-xs tabular-nums text-ink-3">
        {n.mode === "reflex" ? (
          <>
            <span>on reflex {fmtPct(n.reflexShare)}</span>
            <span>audits {n.audits >= 3 ? fmtPct(n.agreement) : "–"}</span>
          </>
        ) : (
          <>
            <span>agrees with LLM {fmtPct(n.agreement)}</span>
            <span>conf {n.confidence == null ? "–" : n.confidence.toFixed(2)}</span>
          </>
        )}
      </div>
    </button>
  );
}

const tooltipStyle = { background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-primary)" };
const EVENT_COLOR: Record<Ev["type"], string> = {
  promote: "var(--status-good)",
  demote: "var(--status-critical)",
  rewrite: "var(--thinking)",
  novel: "var(--status-warning)",
};

function Chart({ title, data, lines, fmt, events, campaignSeq, domain, xMax }: {
  title: string;
  data: Point[];
  lines: { key: keyof Point; name: string; color: string }[];
  fmt: (v: number) => string;
  events: Ev[];
  campaignSeq: number | null;
  domain?: [number, number];
  xMax: number;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <div className="mb-2 text-sm font-medium text-ink-2">{title}</div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="seq" type="number" domain={[0, xMax]} tick={{ fill: "var(--text-muted)", fontSize: 12 }} stroke="var(--border)" />
            <YAxis tickFormatter={fmt} domain={domain} tick={{ fill: "var(--text-muted)", fontSize: 12 }} stroke="var(--border)" width={58} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(Number(v))} labelFormatter={(l) => `Alert #${l}`} />
            {lines.length > 1 && <Legend wrapperStyle={{ color: "var(--text-secondary)", fontSize: 12 }} />}
            {campaignSeq != null && (
              <ReferenceLine
                x={campaignSeq}
                stroke="var(--text-muted)"
                strokeDasharray="4 4"
                label={{ value: "New campaign: attacks on AI agents", fill: "var(--text-secondary)", fontSize: 11, position: "insideTopLeft" }}
              />
            )}
            {events
              .filter((e) => e.type !== "novel")
              .map((e) => (
                <ReferenceLine key={e._id} x={e.seq} stroke={EVENT_COLOR[e.type]} strokeOpacity={0.45} strokeDasharray={e.type === "rewrite" ? "2 3" : undefined} />
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

// The one chart that tells the story: reflex share rises, accuracy holds, the new attack is absorbed.
function HeroChart({ data, xMax, marks }: { data: Point[]; xMax: number; marks: { seq: number; label: string; color: string }[] }) {
  return (
    <section className="rounded-2xl border border-line bg-surface-1 p-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">How the harness learned</h2>
        <div className="flex gap-4 text-xs text-ink-3">
          <span><span className="mr-1 inline-block h-0.5 w-4 align-middle" style={{ background: "var(--series-2)" }} />Decisions on reflex</span>
          <span><span className="mr-1 inline-block h-0.5 w-4 align-middle" style={{ background: "var(--series-1)" }} />Accuracy vs labels</span>
        </div>
      </div>
      <div className="text-xs text-ink-3">Rolling 20 alerts. No human changed anything during the run.</div>
      <div className="mt-3 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 28, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="seq" type="number" domain={[0, xMax]} tick={{ fill: "var(--text-muted)", fontSize: 12 }} stroke="var(--border)" />
            <YAxis tickFormatter={(v) => fmtPct(v)} domain={[0, 1]} tick={{ fill: "var(--text-muted)", fontSize: 12 }} stroke="var(--border)" width={48} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtPct(Number(v))} labelFormatter={(l) => `Alert #${l}`} />
            {marks.map((m) => (
              <ReferenceLine
                key={m.label}
                x={m.seq}
                stroke={m.color}
                strokeDasharray="4 4"
                label={{ value: m.label, fill: m.color, fontSize: 12, fontWeight: 600, position: "top" }}
              />
            ))}
            <Line type="monotone" dataKey="reflex" name="Decisions on reflex" stroke="var(--series-2)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="accuracy" name="Accuracy vs labels" stroke="var(--series-1)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

const EVENT_STYLE: Record<Ev["type"], { icon: string; label: string }> = {
  promote: { icon: "⚡", label: "Promoted to reflex" },
  demote: { icon: "↓", label: "Demoted" },
  rewrite: { icon: "✎", label: "Rewrote its own question" },
  novel: { icon: "◎", label: "Never seen before" },
};

function storyLine(e: Ev | undefined): { text: string; color: string; icon: string } {
  if (!e) return { icon: "●", color: "var(--thinking)", text: "Every decision starts on System 2, the LLM. Jev, a System One model, shadows each one and learns." };
  const who = e.node ? NODE_LABEL[e.node] : "";
  if (e.type === "promote") return { icon: "⚡", color: EVENT_COLOR.promote, text: `"${who}" became a reflex at alert #${e.seq}: ${e.detail}` };
  if (e.type === "demote") return { icon: "↓", color: EVENT_COLOR.demote, text: `"${who}" was demoted back to the LLM at alert #${e.seq}: ${e.detail}` };
  if (e.type === "rewrite") return { icon: "✎", color: EVENT_COLOR.rewrite, text: `The harness rewrote "${who}" at alert #${e.seq}: ${e.detail}` };
  return { icon: "◎", color: EVENT_COLOR.novel, text: `Vector Search flagged alert #${e.seq} as unlike anything in memory, so reflexes handed it to the LLM.` };
}

function Clamp({ text, lines = 3, className = "" }: { text: string; lines?: number; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      onClick={() => setOpen(!open)}
      title={open ? "Click to collapse" : "Click to expand"}
      className={`cursor-pointer ${className}`}
      style={open ? undefined : { display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" }}
    >
      {text}
    </div>
  );
}

function criteriaKeys(q?: Question) {
  if (!q?.criteria) return [];
  return Array.isArray(q.criteria) ? q.criteria : Object.keys(q.criteria);
}

function RewriteDiff({ e }: { e: Ev }) {
  const bq = e.before?.question ?? (e.before as Question | undefined);
  const aq = e.after?.question;
  if (!bq || !aq) return null;
  // Only choice options diff; score levels are rewritten descriptions, not added options.
  const optionKeys = (q: Question) => (Array.isArray(q.criteria) ? [] : criteriaKeys(q));
  const bk = optionKeys(bq);
  const ak = optionKeys(aq);
  const added = ak.filter((k) => !bk.includes(k));
  const removed = bk.filter((k) => !ak.includes(k));
  const bc = e.before?.context;
  const ac = e.after?.context;
  return (
    <div className="space-y-2 text-sm">
      <div className="text-ink-3">Latest rewrite · v{e.version} · alert #{e.seq}</div>
      <div className="rounded-lg bg-surface-2 p-3">
        <Clamp text={bq.instructions} lines={2} className="text-ink-3 line-through decoration-ink-3/60" />
        <Clamp text={aq.instructions} lines={4} className="mt-2 text-ink" />
      </div>
      {(added.length > 0 || removed.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {added.map((k) => (
            <span key={k} className="rounded-full bg-surface-2 px-2 py-0.5 text-good">+ {k}</span>
          ))}
          {removed.map((k) => (
            <span key={k} className="rounded-full bg-surface-2 px-2 py-0.5 text-bad">− {k}</span>
          ))}
        </div>
      )}
      {bc && ac && bc.join(",") !== ac.join(",") && (
        <div className="text-ink-2">
          Context policy: <span className="text-ink-3 line-through">{bc.join(" + ")}</span> → <span className="text-ink">{ac.join(" + ")}</span>
        </div>
      )}
    </div>
  );
}

// ---------- page ----------
export default function Overview() {
  const [data, setData] = useState<Payload | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number | null>(null); // null = live
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1); // alerts per tick (10 ticks/s)
  const [msg, setMsg] = useState<string | null>(null);
  const autoReplayed = useRef(false);
  const holdUntil = useRef(0);
  const inFlight = useRef(false);

  // Poll while a run is live; slow down once it's done.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    // URL params, applied once when the first run arrives: ?replay=1 autoplays, ?at=N freezes on
    // alert N, ?node=<name> opens a node, ?speed=N. Otherwise the console opens on the latest state.
    const applyStartParams = (p: Payload) => {
      if (autoReplayed.current || !p.series?.length) return;
      const q = new URLSearchParams(window.location.search);
      const last = p.series[p.series.length - 1].seq;
      const node = q.get("node");
      if (node && NODE_ORDER.includes(node)) setSelected(node);
      if (q.get("speed")) setSpeed(Math.max(1, Number(q.get("speed")) || 1));
      if (q.get("at")) {
        autoReplayed.current = true;
        setCursor(Math.min(Number(q.get("at")) || 0, last));
      } else if (q.get("replay") === "1") {
        autoReplayed.current = true;
        setCursor(0);
        setPlaying(true);
      }
    };
    const tick = async () => {
      if (!inFlight.current) {
        inFlight.current = true;
        try {
          const db = new URLSearchParams(window.location.search).get("db");
          const r = await fetch(db ? `/api/state?db=${encodeURIComponent(db)}` : "/api/state", { cache: "no-store" });
          if (alive && r.ok) {
            const p: Payload = await r.json();
            setData(p);
            applyStartParams(p);
          }
        } catch {}
        inFlight.current = false;
      }
      if (alive) timer = setTimeout(tick, data?.run?.status === "running" ? 1000 : 6000);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [data?.run?.status]);

  const series = useMemo(() => data?.series ?? [], [data]);
  const lastSeq = series.length ? series[series.length - 1].seq : 0;

  // Replay: advance the cursor, pausing briefly on each key moment so its story line can be read.
  const keySeqs = useMemo(() => {
    const evs = data?.events ?? [];
    const firstNovel = evs.find((e) => e.type === "novel");
    return evs.filter((e) => e.type !== "novel" || e === firstNovel).map((e) => e.seq);
  }, [data?.events]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      if (Date.now() < holdUntil.current) return;
      setCursor((c) => {
        const from = c ?? 0;
        const next = from + speed;
        if (next >= lastSeq) {
          setPlaying(false);
          return null;
        }
        const hit = keySeqs.find((s) => s > from && s <= next);
        if (hit !== undefined) {
          holdUntil.current = Date.now() + 1500;
          return hit;
        }
        return next;
      });
    }, 100);
    return () => clearInterval(id);
  }, [playing, speed, lastSeq, keySeqs]);

  const at = cursor ?? lastSeq;
  const view = useMemo(() => {
    const seriesAt = series.filter((p) => p.seq <= at);
    const eventsAt = (data?.events ?? []).filter((e) => e.seq <= at);
    const versions = data?.versions ?? [];
    const vAt = eventsAt.reduce((m, e) => Math.max(m, e.version ?? 0), 0);
    const harness = [...versions].reverse().find((v) => v.version <= vAt) ?? versions[0];
    const decisions = (data?.decisions ?? []).filter((d) => d.seq <= at);

    const nodes: Record<string, NodeView> = {};
    for (const n of NODE_ORDER) {
      const cfg = harness?.nodes[n];
      const mode = cfg?.mode ?? "shadow";
      const nodeEvents = eventsAt.filter((e) => e.node === n);
      const lastRewrite = [...nodeEvents].reverse().find((e) => e.type === "rewrite");
      const lastDemote = [...nodeEvents].reverse().find((e) => e.type === "demote");
      const lastPromote = [...nodeEvents].reverse().find((e) => e.type === "promote");
      const since = lastRewrite?.version ?? 0;
      const ds = decisions.filter((d) => d.node === n && (d.v ?? 0) >= since);
      const recent = ds.slice(-WINDOW);
      const confs = recent.map((d) => d.conf).filter((c): c is number => typeof c === "number");
      const shadowAgree = ds.filter((d) => d.mode === "shadow" && typeof d.agree === "boolean").slice(-WINDOW).map((d) => !!d.agree);
      const audits = ds.filter((d) => d.audited && typeof d.agree === "boolean").slice(-10).map((d) => !!d.agree);
      nodes[n] = {
        mode,
        demoted: !!lastDemote && (!lastPromote || lastDemote.seq > lastPromote.seq) && mode === "shadow",
        agreement: mode === "reflex" ? rate(audits) : rate(shadowAgree),
        samples: shadowAgree.length,
        audits: audits.length,
        reflexShare: recent.length ? recent.filter((d) => d.used === "reflex").length / recent.length : 0,
        confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null,
        floor: cfg?.thresholds?.confidence_floor ?? 0.6,
      };
    }

    // An alert skips the LLM entirely only when all six decisions were served by reflexes.
    const reflexCount = new Map<number, number>();
    for (const d of decisions) if (d.used === "reflex") reflexCount.set(d.seq, (reflexCount.get(d.seq) ?? 0) + 1);
    const full = seriesAt.map((p) => (reflexCount.get(p.seq) ?? 0) === NODE_ORDER.length);
    for (let i = 0; i < seriesAt.length; i++) {
      const w = full.slice(Math.max(0, i - WINDOW + 1), i + 1);
      seriesAt[i] = { ...seriesAt[i], noLlm: w.filter(Boolean).length / w.length };
    }
    const fastMs = seriesAt.filter((p, i) => full[i] && typeof p.ms_raw === "number").map((p) => p.ms_raw as number).sort((a, b) => a - b);
    const reflexPathMs = fastMs.length >= 5 ? fastMs[Math.floor(fastMs.length / 2)] : null;

    const before = seriesAt.length >= WINDOW ? seriesAt[WINDOW - 1] : seriesAt[0];
    const now = seriesAt[seriesAt.length - 1];
    const recentAlerts = (data?.alerts ?? []).filter((a) => a.seq <= at).slice(-7).reverse();
    const decBySeq = new Map<number, Dec[]>();
    for (const d of decisions.filter((d) => recentAlerts.some((a) => a.seq === d.seq))) decBySeq.set(d.seq, [...(decBySeq.get(d.seq) ?? []), d]);
    const campaignSeq = seriesAt.find((p) => p.batch === "campaign")?.seq ?? null;
    // Key moments for the hero chart, from the whole run.
    const modes: Record<string, string> = Object.fromEntries(NODE_ORDER.map((n) => [n, "shadow"]));
    let allReflexSeq: number | null = null;
    let newCategorySeq: number | null = null;
    for (const e of data?.events ?? []) {
      if (!e.node) continue;
      if (e.type === "promote") modes[e.node] = "reflex";
      if (e.type === "demote" || e.type === "rewrite") modes[e.node] = "shadow";
      if (allReflexSeq == null && NODE_ORDER.every((n) => modes[n] === "reflex")) allReflexSeq = e.seq;
      if (newCategorySeq == null && e.type === "rewrite") {
        const b = e.before?.question ?? (e.before as Question | undefined);
        const a = e.after?.question;
        const bk = b && !Array.isArray(b.criteria) ? criteriaKeys(b) : [];
        const ak = a && !Array.isArray(a.criteria) ? criteriaKeys(a) : [];
        if (ak.some((k) => !bk.includes(k))) newCategorySeq = e.seq;
      }
    }
    const firstCampaign = series.find((p) => p.batch === "campaign")?.seq ?? null;
    const marks = [
      allReflexSeq != null && { seq: allReflexSeq, label: `All 6 reflexes · #${allReflexSeq}`, color: "var(--status-good)" },
      firstCampaign != null && { seq: firstCampaign, label: `New attack type · #${firstCampaign}`, color: "var(--status-warning)" },
      newCategorySeq != null && { seq: newCategorySeq, label: `Added a category · #${newCategorySeq}`, color: "var(--thinking)" },
    ].filter(Boolean) as { seq: number; label: string; color: string }[];

    return { seriesAt, eventsAt, harness, nodes, before, now, recentAlerts, decBySeq, campaignSeq, versionCount: vAt + 1, reflexPathMs, marks };
  }, [series, data, at]);

  async function start() {
    if (!confirm("Start a new alert storm? This resets the current run.")) return;
    const r = await fetch("/api/run", { method: "POST", body: JSON.stringify({}) });
    const body = await r.json();
    setMsg(body.error ?? "Alert storm started");
    setCursor(null);
  }

  const run = data?.run;
  const total = run?.total ?? lastSeq;
  const story = storyLine([...view.eventsAt].reverse().find((e) => e.type !== "novel") ?? view.eventsAt[view.eventsAt.length - 1]);
  const sel = selected ? view.nodes[selected] : null;
  const selCfg = selected ? view.harness?.nodes[selected] : null;
  const selEvents = view.eventsAt.filter((e) => e.node === selected);
  const selRewrite = [...selEvents].reverse().find((e) => e.type === "rewrite");
  const b = view.before;
  const k = view.now;

  return (
    <main className="mx-auto w-full max-w-[1280px] space-y-4 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-ink-3">Six decisions per alert. The LLM thinks, Jev learns, MongoDB remembers.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {run && (
            <div className="rounded-full border border-line bg-surface-1 px-4 py-2 text-sm tabular-nums text-ink-2">
              {cursor != null ? "▶ Replay" : run.status === "running" ? "● Live" : "Recorded run"} · alert {at}/{total} · harness v{view.harness?.version ?? 0}
            </div>
          )}
          {run?.status === "done" && (
            <>
              <button
                onClick={() => {
                  if (playing) setPlaying(false);
                  else {
                    setCursor((c) => (c == null || c >= lastSeq ? 0 : c));
                    setPlaying(true);
                  }
                }}
                className="rounded-full border border-line bg-surface-1 px-4 py-2 text-sm font-medium hover:border-ink-3"
              >
                {playing ? "❚❚ Pause" : "▶ Replay"}
              </button>
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="rounded-full border border-line bg-surface-1 px-3 py-2 text-sm"
                aria-label="Replay speed"
              >
                <option value={1}>10 alerts/s</option>
                <option value={3}>30 alerts/s</option>
                <option value={8}>80 alerts/s</option>
              </select>
              {cursor != null && (
                <button onClick={() => { setPlaying(false); setCursor(null); }} className="rounded-full border border-line bg-surface-1 px-4 py-2 text-sm hover:border-ink-3">
                  Jump to end
                </button>
              )}
            </>
          )}
          {data?.canRun && (
            <button onClick={start} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-page hover:opacity-90">
              Start alert storm
            </button>
          )}
        </div>
      </header>
      {msg && <div className="text-sm text-ink-3">{msg}</div>}
      {run?.status === "done" && (
        <input
          type="range"
          min={0}
          max={lastSeq}
          value={at}
          onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }}
          className="w-full accent-[var(--series-1)]"
          aria-label="Scrub through the run"
        />
      )}

      {!run && <div className="rounded-xl border border-line bg-surface-1 p-8 text-ink-2">No run yet. Start an alert storm to watch the agent grow reflexes.</div>}

      {run && (
        <>
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-1 px-5 py-3 text-lg">
            <span aria-hidden style={{ color: story.color }}>{story.icon}</span>
            <span className="text-ink" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{story.text}</span>
          </div>

          <ImpactCard />

          <HeroChart data={view.seriesAt} xMax={total} marks={view.marks} />


          <section className="rounded-xl border border-line bg-surface-1/40 p-4">
            <div className="mb-3 flex items-center gap-3 text-sm text-ink-3">
              <span>Security alert</span>
              <span aria-hidden>→</span>
              <span>6 decisions per alert · click one to see its reflex</span>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
              {NODE_ORDER.map((n) => (
                <NodeCard key={n} name={n} n={view.nodes[n]} selected={selected === n} onClick={() => setSelected(selected === n ? null : n)} />
              ))}
            </div>
            {sel && selCfg && selected && (
              <div className="mt-4 grid gap-6 rounded-xl border border-line bg-surface-1 p-4 md:grid-cols-3">
                <div>
                  <div className="text-sm text-ink-3">Reflex question sent to Jev ({selCfg.question.type})</div>
                  <Clamp text={selCfg.question.instructions} lines={4} className="mt-1 text-ink" />
                  {selCfg.question.criteria && (
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      {criteriaKeys(selCfg.question).map((c) => (
                        <span key={c} className="rounded-full bg-surface-2 px-2 py-0.5 text-ink-2">{c}</span>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 text-sm text-ink-3">
                    Sees: <span className="text-ink-2">{selCfg.context.join(" + ")}</span> · confidence floor{" "}
                    <span className="text-ink-2">{sel.floor.toFixed(2)}</span>
                  </div>
                </div>
                <div>{selRewrite ? <RewriteDiff e={selRewrite} /> : <div className="text-sm text-ink-3">Not rewritten yet.</div>}</div>
                <div>
                  <div className="text-sm text-ink-3">History</div>
                  <ul className="mt-1 space-y-2 text-sm">
                    {selEvents.length === 0 && <li className="text-ink-3">No changes yet</li>}
                    {selEvents.map((e) => (
                      <li key={e._id}>
                        <span style={{ color: EVENT_COLOR[e.type] }}>{EVENT_STYLE[e.type].icon} {EVENT_STYLE[e.type].label}</span>{" "}
                        <span className="text-ink-2">v{e.version} · #{e.seq}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </section>

          <div className="text-xs font-medium uppercase tracking-wider text-ink-3">Live metrics · at alert #{at}, rolling 20 alerts vs alert 20</div>
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Tile
              label="Decision time per alert"
              now={k?.ms}
              before={b?.ms}
              fmt={fmtMs}
              better={ratio(b?.ms, k?.ms)}
              note={view.reflexPathMs != null ? `all-reflex alerts: ${fmtMs(view.reflexPathMs)} (median)` : null}
            />
            <Tile label="Cost per 1,000 alerts" now={k?.cost} before={b?.cost} fmt={fmtCost} better={ratio(b?.cost, k?.cost)} note="incl. background audits" />
            <Tile label="Accuracy vs ground truth" now={k?.accuracy} before={b?.accuracy} fmt={fmtPct} note="labels never shown to the engine" />
            <Tile label="Decisions on reflex" now={k?.reflex} before={b?.reflex} fmt={fmtPct} />
            <Tile label="Alerts with no LLM call" now={k?.noLlm} before={b?.noLlm} fmt={fmtPct} note="all 6 decisions made by Jev" />
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <Chart
              title="Decision time per alert"
              data={view.seriesAt}
              lines={[{ key: "ms", name: "Decision time", color: "var(--series-1)" }]}
              fmt={(v) => fmtMs(v)}
              events={view.eventsAt}
              campaignSeq={view.campaignSeq}
              xMax={total}
            />
            <Chart
              title="Alerts decided with no LLM call (rolling 20)"
              data={view.seriesAt}
              lines={[{ key: "noLlm", name: "No LLM call", color: "var(--series-1)" }]}
              fmt={(v) => fmtPct(v)}
              events={view.eventsAt}
              campaignSeq={view.campaignSeq}
              domain={[0, 1]}
              xMax={total}
            />
            <Chart
              title="Cost per 1,000 alerts"
              data={view.seriesAt}
              lines={[{ key: "cost", name: "Cost", color: "var(--series-1)" }]}
              fmt={(v) => fmtCost(v)}
              events={view.eventsAt}
              campaignSeq={view.campaignSeq}
              xMax={total}
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface-1 p-4">
              <div className="mb-3 text-sm font-medium text-ink-2">Live alerts · what the agent did</div>
              <ul className="space-y-2.5">
                {view.recentAlerts.map((a) => (
                  <li key={a.seq} className="text-sm">
                    <div className="flex items-center gap-3">
                      <span className="w-12 shrink-0 tabular-nums text-ink-3">#{a.seq}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-2">{a.text}</span>
                      <span className="flex shrink-0 gap-1" aria-label="who decided">
                        {NODE_ORDER.map((n) => {
                          const d = view.decBySeq.get(a.seq)?.find((x) => x.node === n);
                          const c = d?.used === "reflex" ? "var(--status-good)" : d?.used === "fallback" ? "var(--status-warning)" : "var(--thinking)";
                          return <span key={n} title={`${NODE_LABEL[n]}: ${d?.used ?? "?"}${d?.reason ? ` (${d.reason})` : ""}`} className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />;
                        })}
                      </span>
                    </div>
                    <div className="mt-0.5 flex gap-3 pl-15 text-xs">
                      <span className="text-ink-2">→ {a.action}</span>
                      {a.novel && <span className="text-warn">◎ never seen before: sent to the LLM</span>}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-3">
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-think" />LLM (System 2)</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-good" />Reflex (Jev)</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-warn" />Reflex handed back: low confidence, never seen, or unproven on similar alerts</span>
              </div>
            </div>
            <div className="rounded-xl border border-line bg-surface-1 p-4">
              <div className="mb-3 text-sm font-medium text-ink-2">Harness evolution · {view.versionCount} {view.versionCount === 1 ? "version" : "versions"} stored in MongoDB</div>
              <ul className="max-h-80 space-y-2.5 overflow-auto text-sm">
                {view.eventsAt.length === 0 && <li className="text-ink-3">Waiting for the first graduation…</li>}
                {[...view.eventsAt].reverse().map((e) => (
                  <li key={e._id} className="flex gap-2">
                    <span className="shrink-0 font-medium" style={{ color: EVENT_COLOR[e.type] }}>
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
        </>
      )}
    </main>
  );
}
