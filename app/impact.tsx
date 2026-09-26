// Impact of the final recorded run (run 3): first 20 alerts (everything on the LLM) vs alerts 100–245
// (graduated, before the drift). Same numbers as README → Results. The projection uses run 2's
// measured rate with a frontier teacher and is labelled as a projection.

const METRICS = [
  { label: "Cost per 1,000 alerts", before: "$1.03", after: "$0.40", note: "2.6× lower", tone: "good" },
  { label: "Alerts with no LLM call", before: "0%", after: "38%", note: "all six decisions by reflexes", tone: "good" },
  { label: "Reflex-path decision", before: "890 ms", after: "257 ms", note: "3.5× faster", tone: "good" },
  { label: "Accuracy vs labels", before: "95.8%", after: "91.8%", note: "−4.0 pts, the trade", tone: "warn" },
] as const;

export default function ImpactCard({ compact = false }: { compact?: boolean }) {
  return (
    <section className={`rounded-xl border border-line bg-surface-1 ${compact ? "p-3" : "p-4"}`}>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-base font-semibold">Impact</h2>
        <span className="text-xs text-ink-3">Run 3 · first 20 alerts (all on the LLM) vs alerts 100–245 (graduated, before the new attack)</span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {METRICS.map((m) => (
          <div key={m.label} className="rounded-lg bg-surface-2 p-3">
            <div className="text-xs text-ink-3">{m.label}</div>
            <div className={`${compact ? "text-2xl" : "text-[26px]"} mt-0.5 font-bold leading-tight tabular-nums`}>
              <span className="text-ink-3">{m.before}</span> <span className="text-ink-3">→</span> {m.after}
            </div>
            <div className={`mt-0.5 text-xs font-medium ${m.tone === "good" ? "text-good" : "text-warn"}`}>{m.note}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-3">
        <span className="font-semibold text-ink-2">Projection:</span> at 3M alerts/month (a mid-size SOC) with a frontier teacher,{" "}
        <span className="text-ink-2">$13.6k → $6.3k per month</span> in decision cost. Assumes run 2&apos;s measured rate with a Claude Sonnet 5 teacher ($4.53 → $2.09 per 1,000 alerts); there, the reflex path was 238 ms vs 2.4 s (10×).
      </p>
    </section>
  );
}
