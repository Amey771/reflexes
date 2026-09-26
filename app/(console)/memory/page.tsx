"use client";

import { useEffect, useState } from "react";
import { NODE_LABEL, NODES } from "@/lib/workload";
import { useRun } from "../data";

// Memory: the experience the harness has accumulated, searchable by meaning.
// A reflex only acts alone on alerts that look like ones where it has proven itself.

type Hit = { seq: number; text: string; score: number; agree?: Record<string, boolean> };

const EXAMPLES = ["prompt injection against our chatbot", "password spraying from Tor", "employee uploaded files to personal cloud storage", "vulnerability scanner login failures"];

export default function Memory() {
  const { data } = useRun();
  const [q, setQ] = useState(EXAMPLES[0]);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(query = q) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/similar?q=${encodeURIComponent(query)}`);
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Search failed");
      setHits(body.results);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  useEffect(() => {
    let alive = true;
    fetch(`/api/similar?q=${encodeURIComponent(EXAMPLES[0])}`)
      .then((r) => r.json())
      .then((b) => alive && setHits(b.results ?? []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const recent = [...(data?.alerts ?? [])].slice(-12).reverse();

  return (
    <main className="mx-auto w-full max-w-[1280px] space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Memory</h1>
        <p className="mt-1 text-sm text-ink-3">
          Every alert the agent handles is stored in MongoDB and embedded automatically by Atlas (voyage-4-lite). Before a reflex acts, Vector Search recalls similar past alerts: nothing similar means the LLM decides.
        </p>
      </div>

      <section className="rounded-xl border border-line bg-surface-1 p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
          className="flex gap-2"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Describe an alert…"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-ink-3"
          />
          <button disabled={busy} className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-page disabled:opacity-50">
            {busy ? "Searching…" : "Search memory"}
          </button>
        </form>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => {
                setQ(ex);
                search(ex);
              }}
              className="rounded-full border border-line px-2.5 py-1 text-ink-3 hover:border-ink-3"
            >
              {ex}
            </button>
          ))}
        </div>
        {error && <p className="mt-3 text-sm text-bad">{error}</p>}
        <ul className="mt-4 divide-y divide-line">
          {hits?.length === 0 && <li className="py-3 text-sm text-ink-3">Nothing similar in memory.</li>}
          {hits?.map((h) => {
            const flags = NODES.filter((n) => typeof h.agree?.[n] === "boolean");
            const agreed = flags.filter((n) => h.agree?.[n]).length;
            return (
              <li key={h.seq} className="grid grid-cols-[4rem_1fr] gap-3 py-3 text-sm">
                <div className="tabular-nums">
                  <div className="text-lg font-semibold">{h.score.toFixed(2)}</div>
                  <div className="text-xs text-ink-3">similarity</div>
                </div>
                <div className="min-w-0">
                  <div className="text-ink-2">
                    <span className="text-ink-3">#{h.seq} · </span>
                    {h.text}
                  </div>
                  {flags.length > 0 && (
                    <div className="mt-1 text-xs text-ink-3">
                      Jev agreed with the LLM on {agreed} of {flags.length} decisions checked here: {flags.map((n) => `${NODE_LABEL[n]} ${h.agree?.[n] ? "✓" : "✗"}`).join(" · ")}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-xl border border-line bg-surface-1 p-4">
        <div className="mb-3 text-sm font-medium text-ink-2">Most recent experience</div>
        <ul className="space-y-2 text-sm">
          {recent.map((a) => (
            <li key={a.seq} className="flex gap-3">
              <span className="w-12 shrink-0 tabular-nums text-ink-3">#{a.seq}</span>
              <span className="min-w-0 flex-1 truncate text-ink-2" title={a.text}>{a.text}</span>
              {a.novel && <span className="shrink-0 text-xs text-warn">◎ never seen before</span>}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
