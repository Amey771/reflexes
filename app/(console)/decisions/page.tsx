"use client";

import { useState } from "react";
import { IconLLM, IconReflex } from "@/app/icons";
import { NODE_LABEL, NODES } from "@/lib/workload";
import { EVENT_STYLE, optionKeys, useRun, type Ev } from "../data";

// Decisions: every decision point the harness manages, its current reflex question, and its history.

function Clamp({ text, lines = 3 }: { text: string; lines?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      onClick={() => setOpen(!open)}
      className="cursor-pointer text-ink"
      style={open ? undefined : { display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" }}
      title={open ? "Click to collapse" : "Click to expand"}
    >
      {text}
    </div>
  );
}

function Rewrite({ e }: { e: Ev }) {
  const b = optionKeys(e.before?.question);
  const a = optionKeys(e.after?.question);
  const added = a.filter((k) => !b.includes(k));
  const bc = e.before?.context?.join(" + ");
  const ac = e.after?.context?.join(" + ");
  return (
    <div className="space-y-1 text-sm">
      <div className="text-ink-2">{e.detail}</div>
      {added.map((k) => (
        <span key={k} className="mr-1 inline-block rounded-full bg-surface-2 px-2 py-0.5 font-mono text-xs text-good">+ {k}</span>
      ))}
      {bc && ac && bc !== ac && (
        <div className="text-xs text-ink-3">
          Context: <span className="line-through">{bc}</span> → <span className="text-ink-2">{ac}</span>
        </div>
      )}
    </div>
  );
}

export default function Decisions() {
  const { data } = useRun();
  const latest = data?.versions?.[data.versions.length - 1];
  const events = data?.events ?? [];
  const decisions = data?.decisions ?? [];

  return (
    <main className="mx-auto w-full max-w-[1280px] space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Decisions</h1>
        <p className="mt-1 text-sm text-ink-3">
          Each decision the agent makes per alert. A decision starts on the LLM, becomes a reflex when Jev proves it agrees, and goes back to the LLM when it stops being sure.
        </p>
      </div>
      {!data && <div className="rounded-xl border border-line bg-surface-1 p-8 text-ink-3">Loading…</div>}
      {data && !latest && <div className="rounded-xl border border-line bg-surface-1 p-8 text-ink-3">No run yet.</div>}
      {latest && (
        <div className="grid gap-4 lg:grid-cols-2">
          {NODES.map((n) => {
            const cfg = latest.nodes[n];
            const mine = events.filter((e) => e.node === n);
            const lastRewrite = [...mine].reverse().find((e) => e.type === "rewrite");
            const ds = decisions.filter((d) => d.node === n);
            const recent = ds.slice(-50);
            const reflexShare = recent.length ? recent.filter((d) => d.used === "reflex").length / recent.length : 0;
            const reflex = cfg.mode === "reflex";
            return (
              <section key={n} className="flex flex-col gap-3 rounded-xl border bg-surface-1 p-4" style={{ borderColor: reflex ? "var(--status-good)" : "var(--border)" }}>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{NODE_LABEL[n]}</h2>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-sm font-semibold" style={{ color: reflex ? "var(--status-good)" : "var(--thinking)" }}>
                    {reflex ? <IconReflex size={15} /> : <IconLLM size={15} />}
                    {reflex ? "Reflex" : "On the LLM"}
                  </span>
                </div>
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wider text-ink-3">Question Jev answers ({cfg.question.type})</div>
                  <Clamp text={cfg.question.instructions} />
                </div>
                {optionKeys(cfg.question).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {optionKeys(cfg.question).map((k) => (
                      <span key={k} className="rounded-full bg-surface-2 px-2 py-0.5 text-ink-2">{k}</span>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="rounded-lg bg-surface-2 p-2">
                    <div className="text-xs text-ink-3">Sees</div>
                    <div>{cfg.context.join(" + ")}</div>
                  </div>
                  <div className="rounded-lg bg-surface-2 p-2">
                    <div className="text-xs text-ink-3">Safety floor</div>
                    <div className="tabular-nums">{reflex ? cfg.thresholds.confidence_floor.toFixed(2) : "–"}</div>
                  </div>
                  <div className="rounded-lg bg-surface-2 p-2">
                    <div className="text-xs text-ink-3">On reflex (last 50)</div>
                    <div className="tabular-nums">{Math.round(reflexShare * 100)}%</div>
                  </div>
                </div>
                {lastRewrite && (
                  <div className="rounded-lg border border-line p-3">
                    <div className="mb-1 text-xs uppercase tracking-wider text-ink-3">Latest self-rewrite · v{lastRewrite.version} · alert #{lastRewrite.seq}</div>
                    <Rewrite e={lastRewrite} />
                  </div>
                )}
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wider text-ink-3">History</div>
                  <ul className="space-y-1 text-sm">
                    {mine.length === 0 && <li className="text-ink-3">No changes yet</li>}
                    {mine.map((e) => (
                      <li key={e._id}>
                        <span style={{ color: EVENT_STYLE[e.type].color }}>{EVENT_STYLE[e.type].icon} {EVENT_STYLE[e.type].label}</span>
                        <span className="text-ink-3"> · v{e.version} · alert #{e.seq}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
