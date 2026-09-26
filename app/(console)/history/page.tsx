"use client";

import { NODE_LABEL } from "@/lib/workload";
import { EVENT_STYLE, optionKeys, useRun } from "../data";

// Harness history: every version of the harness, why it changed, and when.

export default function History() {
  const { data } = useRun();
  const events = [...(data?.events ?? [])].reverse();
  const count = (t: string) => (data?.events ?? []).filter((e) => e.type === t).length;
  const versions = data?.versions?.length ?? 0;

  return (
    <main className="mx-auto w-full max-w-[1100px] space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Harness history</h1>
        <p className="mt-1 text-sm text-ink-3">
          The harness is a document in MongoDB. Every promotion, demotion and self-rewrite creates a new version with its parent and the reason.
        </p>
      </div>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Versions", versions],
          ["Promotions", count("promote")],
          ["Demotions", count("demote")],
          ["Self-rewrites", count("rewrite")],
          ["Never-seen alerts", count("novel")],
        ].map(([label, n]) => (
          <div key={label} className="rounded-xl border border-line bg-surface-1 p-3">
            <div className="text-xs text-ink-3">{label}</div>
            <div className="text-2xl font-semibold tabular-nums">{n}</div>
          </div>
        ))}
      </section>
      {!data && <div className="rounded-xl border border-line bg-surface-1 p-8 text-ink-3">Loading…</div>}
      <ol className="relative space-y-3 border-l border-line pl-6">
        {events.map((e) => {
          const s = EVENT_STYLE[e.type];
          const added = e.type === "rewrite" ? optionKeys(e.after?.question).filter((k) => !optionKeys(e.before?.question).includes(k)) : [];
          return (
            <li key={e._id} className="relative">
              <span className="absolute -left-[31px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-page text-xs" style={{ color: s.color }} aria-hidden>
                ●
              </span>
              <div className="rounded-xl border border-line bg-surface-1 p-3">
                <div className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="font-semibold" style={{ color: s.color }}>{s.icon} {s.label}</span>
                  {e.node && <span className="text-ink">{NODE_LABEL[e.node as keyof typeof NODE_LABEL]}</span>}
                  <span className="text-ink-3">· v{e.version} · alert #{e.seq}</span>
                </div>
                <div className="mt-1 text-sm text-ink-2">{e.detail}</div>
                {added.map((k) => (
                  <span key={k} className="mr-1 mt-1 inline-block rounded-full bg-surface-2 px-2 py-0.5 font-mono text-xs text-good">+ {k}</span>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
