"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

// Shared payload types and a hook that loads the selected run (?db=) from /api/state.

export type Question = { type: string; instructions: string; criteria?: Record<string, string> | string[] };
export type NodeCfg = { mode: "shadow" | "reflex"; question: Question; context: string[]; thresholds: { confidence_floor: number } };
export type Version = { version: number; reason: string; created_at: string; nodes: Record<string, NodeCfg> };
export type Dec = { seq: number; node: string; used: "system2" | "reflex" | "fallback"; agree?: boolean | null; audited?: boolean; mode: string; v: number; reason?: string; conf?: number };
export type Ev = {
  _id: string;
  type: "promote" | "demote" | "rewrite" | "novel";
  node: string | null;
  detail: string;
  version: number;
  seq: number;
  ts: string;
  before?: { question?: Question; context?: string[] };
  after?: { question?: Question; context?: string[] };
};
export type Alert = { seq: number; text: string; action: string; novel: boolean; batch: string };
export type Payload = {
  run: { id: string; status: string; processed: number; total: number } | null;
  versions?: Version[];
  decisions?: Dec[];
  events?: Ev[];
  alerts?: Alert[];
};

export function useRun() {
  const db = useSearchParams().get("db") ?? "";
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(db ? `/api/state?db=${db}` : "/api/state")
      .then((r) => r.json())
      .then((p: Payload) => alive && setData(p))
      .catch(() => alive && setData({ run: null }));
    return () => {
      alive = false;
    };
  }, [db]);
  return { data, db };
}

export const EVENT_STYLE: Record<Ev["type"], { icon: string; label: string; color: string }> = {
  promote: { icon: "⚡", label: "Promoted to reflex", color: "var(--status-good)" },
  demote: { icon: "↓", label: "Demoted", color: "var(--status-critical)" },
  rewrite: { icon: "✎", label: "Rewrote its own question", color: "var(--thinking)" },
  novel: { icon: "◎", label: "Never seen before", color: "var(--status-warning)" },
};

// Option names of a choice question (score levels are descriptions, not options).
export const optionKeys = (q?: Question) => (!q?.criteria || Array.isArray(q.criteria) ? [] : Object.keys(q.criteria));
