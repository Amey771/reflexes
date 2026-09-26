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
  max_fallback_rate: 0.55, // promotion allows up to 40% low-confidence cases, so only demote well above that
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
          instructions:
            "Rate severity using the SOC severity policy. Attack types are phishing, malware, credential compromise, brute force, data exfiltration, and attacks on AI agents. Breach types are malware, credential compromise, data exfiltration, and attacks on AI agents.",
          criteria: [
            "Low: a false positive (expected admin, scanner or maintenance activity)",
            "Medium: a real event with none of the High or Critical conditions, including all policy violations and unclassifiable events",
            "High: an attack type where the context shows a threat-intel match, a privileged user, or a high-criticality asset",
            "Critical: a breach type affecting a high-criticality asset or a privileged user",
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
          instructions:
            "Should the on-call analyst be paged now? SOC paging policy: page if and only if the alert is a real threat (not a false positive) AND it is High or Critical severity, meaning an attack with a threat-intel match, a privileged user, or a high-criticality asset. Whether a tool already blocked or contained it does not matter.",
        },
      },
      playbook: {
        mode: "shadow",
        context: ["text", "facts"],
        thresholds: t,
        question: {
          type: "choice",
          instructions:
            "Which response playbook should run? SOC runbook: false positives get close_alert; phishing gets quarantine_email; malware and data exfiltration get isolate_host; credential compromise gets reset_credentials; brute force gets block_indicator; attacks on AI agents get disable_agent_tool; policy violations and anything else get open_ticket.",
          criteria: PLAYBOOKS,
        },
      },
      auto_ok: {
        mode: "shadow",
        context: ["text", "facts"],
        thresholds: t,
        question: {
          type: "noul",
          instructions:
            "SOC auto-remediation policy: may the response run automatically, without human approval? Yes if the alert is a false positive. Otherwise yes exactly when context.auto_fix_eligible is true (low-criticality asset and non-privileged user). Otherwise no.",
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

// The SOC's systems also compute the auto-fix eligibility flag, so no model has to combine facts.
export function contextFacts(req: Request) {
  return { ...req.facts, auto_fix_eligible: req.facts.asset_criticality === "low" && !req.facts.user_privileged };
}

// Context policy: build the state each node's reflex sees.
export function stateFor(req: Request, fields: ContextField[]) {
  const s: Record<string, unknown> = {};
  if (fields.includes("text")) s.alert = req.text;
  if (fields.includes("facts")) s.context = contextFacts(req);
  return s;
}
