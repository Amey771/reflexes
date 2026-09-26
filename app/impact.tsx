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
    <section
      className={`relative overflow-hidden rounded-2xl border ${compact ? "p-3" : "p-5"}`}
      style={{
        borderColor: "color-mix(in oklab, var(--status-good) 45%, var(--border))",
        background: "radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, var(--status-good) 12%, var(--surface-1)) 0%, var(--surface-1) 55%)",
      }}
    >
      <div className={`flex flex-wrap items-end gap-x-6 gap-y-1 ${compact ? "mb-2" : "mb-4"}`}>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-good">Impact · Run 3</div>
          <div className={`${compact ? "text-2xl" : "text-[34px]"} font-bold leading-tight tracking-tight`}>
            81% of decisions moved off the LLM
          </div>
        </div>
        <div className="pb-1 text-sm text-ink-3">
          after ~24 alerts of learning · first 20 alerts (all on the LLM) vs alerts 100–245 (graduated, before the new attack)
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {METRICS.map((m) => (
          <div key={m.label} className="rounded-xl border border-line/70 bg-page/40 p-3">
            <div className="text-xs text-ink-3">{m.label}</div>
            <div className={`${compact ? "text-2xl" : "text-[26px]"} mt-0.5 font-bold leading-tight tabular-nums`}>
              <span className="text-ink-3">{m.before}</span> <span className="text-ink-3">→</span> {m.after}
            </div>
            <div className={`mt-0.5 text-xs font-medium ${m.tone === "good" ? "text-good" : "text-warn"}`}>{m.note}</div>
          </div>
        ))}
      </div>
      <p className={`${compact ? "mt-2" : "mt-3"} text-xs text-ink-3`}>
        <span className="font-semibold text-ink-2">Projection:</span> at 3M alerts/month (a mid-size SOC) with a frontier teacher,{" "}
        <span className="text-ink-2">$13.6k → $6.3k per month</span> in decision cost. Assumes run 2&apos;s measured rate with a Claude Sonnet 5 teacher ($4.53 → $2.09 per 1,000 alerts); there, the reflex path was 238 ms vs 2.4 s (10×).
      </p>
    </section>
  );
}
