import type { ObjectId } from "mongodb";
import type { JevQuestion } from "./jev";

// The demo workload: a security operations center (SOC) triaging an alert storm.
// Each alert passes through six decision points ("nodes").

export const NODES = ["category", "severity", "false_positive", "escalate", "playbook", "auto_ok"] as const;
export type NodeName = (typeof NODES)[number];

export const NODE_LABEL: Record<NodeName, string> = {
  category: "Attack type",
  severity: "Severity",
  false_positive: "False positive?",
  escalate: "Page analyst?",
  playbook: "Playbook",
  auto_ok: "Safe to auto-fix?",
};

// Deterministic facts computed by the SOC's own systems (Jev never computes these).
export type Facts = {
  asset_criticality: "high" | "low";
  user_privileged: boolean;
  threat_intel_match: boolean;
  off_hours: boolean;
  repeated_today: boolean;
};

export type Truth = {
  category: string;
  severity: number; // 0-3
  false_positive: boolean;
  escalate: boolean;
  playbook: string;
  auto_ok: boolean;
};

export type Request = {
  _id?: ObjectId;
  seq: number;
  batch: "base" | "campaign";
  text: string;
  facts: Facts;
  truth: Truth;
};

export type Answer = string | number | boolean;

export type NodeMode = "shadow" | "reflex";

export type ContextField = "text" | "facts";

export type NodeConfig = {
  mode: NodeMode;
  question: JevQuestion;
  context: ContextField[]; // context policy: what this reflex sees
  thresholds: {
    promote_agreement: number; // shadow -> reflex when rolling agreement >= this
    min_samples: number;
    confidence_floor: number; // reflex falls back to System 2 below this (self-tuned on promotion)
    audit_rate: number; // share of reflex decisions re-checked by System 2
    demote_agreement: number; // reflex -> shadow when audited agreement < this
    max_fallback_rate: number; // reflex -> shadow when too many fallbacks
  };
};

export type Harness = {
  _id?: ObjectId;
  version: number;
  parent_version: number | null;
  nodes: Record<NodeName, NodeConfig>;
  reason: string;
  created_at: Date;
};

const DEFAULT_THRESHOLDS: NodeConfig["thresholds"] = {
  promote_agreement: 0.9,
  min_samples: 20,
  confidence_floor: 0.6,
  audit_rate: 0.15,
  demote_agreement: 0.75,
  max_fallback_rate: 0.35,
};

export const CATEGORIES: Record<string, string> = {
  phishing: "Suspicious or malicious email, link or attachment",
  malware: "Malicious code or process running on a host",
  credential_compromise: "An account's credentials appear stolen or misused (impossible travel, token theft)",
  brute_force: "Many failed logins or password spraying",
  data_exfiltration: "Unusual volume of data leaving the company",
  policy_violation: "An employee broke security policy without malicious intent",
  benign_admin_activity: "Expected admin, scanner or maintenance activity that looks suspicious",
  other: "Fits none of the categories above",
};
export const V0_CATEGORIES = new Set(Object.keys(CATEGORIES));

export const PLAYBOOKS: Record<string, string> = {
  isolate_host: "Cut the host off the network",
  reset_credentials: "Force a password reset and revoke sessions",
  block_indicator: "Block the IP, domain or file hash",
  quarantine_email: "Pull the email from all inboxes",
  disable_agent_tool: "Revoke an AI agent's tool or integration access",
  open_ticket: "Open a ticket for follow-up; no immediate action",
  close_alert: "Close the alert; nothing to do",
};

// Version 0 of the harness: every node starts in shadow (System 2 decides, Jev learns).
export function initialHarness(): Harness {
  const t = DEFAULT_THRESHOLDS;
  return {
    version: 0,
    parent_version: null,
    reason: "Initial harness: every decision on System 2",
    created_at: new Date(),
    nodes: {
      category: {
        mode: "shadow",
        context: ["text"],
        thresholds: t,
        question: { type: "choice", instructions: "What kind of security event is this alert about?", criteria: CATEGORIES },
      },
      severity: {
        mode: "shadow",
        context: ["text", "facts"],
        thresholds: t,
        question: {
          type: "score",
          instructions: "How severe is this alert?",
          criteria: [
            "Low: false positive or no real risk",
            "Medium: real but contained, routine follow-up",
            "High: active threat, or a privileged user or known-bad indicator is involved",
            "Critical: likely breach of a high-criticality asset or privileged account, or data leaving the company",
          ],
        },
      },
      false_positive: {
        mode: "shadow",
        context: ["text", "facts"],
        thresholds: t,
        question: {
          type: "noul",
          instructions: "Is this alert a false positive: expected admin, scanner or maintenance activity rather than a real threat?",
        },
      },
      escalate: {
        mode: "shadow",
        context: ["text", "facts"],
        thresholds: t,
        question: {
          type: "noul",
          instructions: "Should the on-call analyst be paged right now? Page only for real threats of High or Critical severity.",
        },
      },
      playbook: {
        mode: "shadow",
        context: ["text", "facts"],
        thresholds: t,
        question: { type: "choice", instructions: "Which response playbook should run?", criteria: PLAYBOOKS },
      },
      auto_ok: {
        mode: "shadow",
        context: ["text", "facts"],
        thresholds: t,
        question: {
          type: "noul",
          instructions:
            "Is it safe to run the response automatically, without human approval? Yes for false positives. Otherwise only if the asset is low criticality, the user is not privileged, and the alert is not Critical.",
        },
      },
    },
  };
}

// Deterministic ground truth for the dependent nodes.
export function playbookFor(category: string, falsePositive: boolean): string {
  if (falsePositive) return "close_alert";
  return (
    {
      phishing: "quarantine_email",
      malware: "isolate_host",
      credential_compromise: "reset_credentials",
      brute_force: "block_indicator",
      data_exfiltration: "isolate_host",
      policy_violation: "open_ticket",
      ai_agent_attack: "disable_agent_tool",
    }[category] ?? "open_ticket"
  );
}

export function autoOkFor(falsePositive: boolean, severity: number, f: Facts): boolean {
  return falsePositive || (f.asset_criticality === "low" && !f.user_privileged && severity < 3);
}

// The campaign introduces a category the v0 taxonomy doesn't have. Whatever name the harness
// gives its new category counts as correct, as long as it's a new category (not a v0 one).
export function isCorrect(node: NodeName, final: Answer | undefined, req: Request): boolean {
  if (final === undefined) return false;
  if (node === "category" && req.batch === "campaign")
    return typeof final === "string" && !V0_CATEGORIES.has(final);
  return final === req.truth[node];
}

// The agent's action, derived from its decisions (what the SOC actually does).
export function actionFor(d: Partial<Record<NodeName, Answer>>): string {
  if (d.false_positive === true) return "Closed as false positive";
  const pb = String(d.playbook ?? "open_ticket").replaceAll("_", " ");
  if (d.escalate === true) return d.auto_ok ? `Paged analyst · ran ${pb}` : `Paged analyst · ${pb} awaiting approval`;
  return d.auto_ok ? `Auto-ran ${pb}` : `Queued ${pb} for approval`;
}

// Context policy: build the state each node's reflex sees.
export function stateFor(req: Request, fields: ContextField[]) {
  const s: Record<string, unknown> = {};
  if (fields.includes("text")) s.alert = req.text;
  if (fields.includes("facts")) s.context = req.facts;
  return s;
}
