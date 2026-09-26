"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { NODES } from "@/lib/workload";

// The Reflexes console: sidebar navigation, workspace + run picker, harness status.

const NAV = [
  { href: "/", label: "Overview", icon: "◉" },
  { href: "/decisions", label: "Decisions", icon: "◆" },
  { href: "/memory", label: "Memory", icon: "⌗" },
  { href: "/history", label: "Harness history", icon: "⏱" },
  { href: "/try", label: "Try it", icon: "▶" },
];

const RUNS = [
  { value: "", label: "Latest run" },
  { value: "run3", label: "Run 3 · gpt-5.4-mini teacher" },
  { value: "run2", label: "Run 2 · Sonnet 5 teacher" },
  { value: "run1", label: "Run 1 · first full run" },
];

type Status = { reflex: number; running: boolean; version: number | null } | null;

export default function ConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const db = params.get("db") ?? "";
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch(db ? `/api/state?db=${db}` : "/api/state", { cache: "no-store" });
        const p = await r.json();
        const v = p.versions?.[p.versions.length - 1];
        if (alive)
          setStatus({
            reflex: v ? NODES.filter((n) => v.nodes?.[n]?.mode === "reflex").length : 0,
            running: p.run?.status === "running",
            version: v?.version ?? null,
          });
        if (alive && p.run?.status === "running") timer = setTimeout(tick, 5000);
      } catch {}
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [db]);

  const withDb = (href: string) => (db ? `${href}?db=${db}` : href);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface-1 p-4 md:flex">
        <Link href={withDb("/")} className="mb-6 block">
          <div className="text-xl font-bold tracking-tight">Reflexes</div>
          <div className="text-xs text-ink-3">agent harness console</div>
        </Link>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={withDb(item.href)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${active ? "bg-surface-2 font-semibold text-ink" : "text-ink-2 hover:bg-surface-2/60"}`}
              >
                <span aria-hidden className="w-4 text-center text-ink-3">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-1 text-xs text-ink-3">
          <div>System 1 · Jev (TypeSafe AI)</div>
          <div>System 2 · LLM via OpenRouter</div>
          <div>Memory · MongoDB Atlas</div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-page/90 px-6 py-3 backdrop-blur">
          <span className="rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-sm font-medium">SOC · Alert triage</span>
          <select
            value={db}
            onChange={(e) => router.push(e.target.value ? `${pathname}?db=${e.target.value}` : pathname)}
            className="rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-sm"
            aria-label="Run"
          >
            {RUNS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          {status && (
            <span className="inline-flex items-center gap-2 rounded-full bg-surface-1 px-3 py-1.5 text-sm tabular-nums" style={{ color: status.reflex === NODES.length ? "var(--status-good)" : "var(--text-secondary)" }}>
              <span aria-hidden>⚡</span>
              {status.reflex}/{NODES.length} decisions on reflex
              {status.version != null && <span className="text-ink-3">· harness v{status.version}</span>}
              {status.running && <span className="text-warn">· live</span>}
            </span>
          )}
          <Link href="/tour" className="ml-auto rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-page hover:opacity-90">
            Product tour ▶
          </Link>
        </header>
        <div key={db} className="min-w-0 flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}
