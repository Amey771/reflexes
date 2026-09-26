import type { ObjectId } from "mongodb";
import type { JevQuestion } from "./jev";

// The demo workload: an online store's AI ops agent during a Black Friday surge.
// Each customer message passes through six decision points ("nodes").

export const NODES = ["intent", "urgency", "needs_human", "tool", "policy_ok", "reply_ok"] as const;
export type NodeName = (typeof NODES)[number];

export type Facts = {
  order_status: "processing" | "shipped" | "delivered" | "no_order";
  within_refund_window: boolean;
  customer_tier: "standard" | "vip";
  repeat_contact: boolean;
};

export type Truth = {
  intent: string;
  urgency: number; // 0-3
  needs_human: boolean;
  tool: string;
  policy_ok: boolean;
  reply_ok: boolean;
};

export type Request = {
  _id?: ObjectId;
  seq: number;
  batch: "base" | "launch";
  text: string;
  draft_reply: string;
  facts: Facts;
  truth: Truth;
};

export type Answer = string | number | boolean;

export type NodeMode = "shadow" | "reflex";

export type NodeConfig = {
  mode: NodeMode;
  question: JevQuestion;
  context: ("text" | "facts" | "draft_reply")[]; // context policy: what this reflex sees
  thresholds: {
    promote_agreement: number; // shadow -> reflex when rolling agreement >= this
    min_samples: number;
    confidence_floor: number; // reflex falls back to System 2 below this
    audit_rate: number; // share of reflex decisions re-checked by System 2
    demote_agreement: number; // reflex -> shadow when audited agreement < this
    max_fallback_rate: number; // reflex -> shadow when too many low-confidence fallbacks
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

export const INTENTS: Record<string, string> = {
  order_status: "Asking where an order is or when it will arrive",
  refund: "Wants money back for an order",
  cancel: "Wants to cancel an order",
  change_address: "Wants to change the shipping address",
  product_question: "Question about a product before buying",
  complaint: "Unhappy about service or quality, not asking for a specific action",
  other: "Anything that fits none of the above",
};

export const TOOLS: Record<string, string> = {
  lookup_order: "Look up order status and tracking",
  issue_refund: "Refund an order",
  cancel_order: "Cancel an order",
  update_address: "Change the shipping address",
  search_catalog: "Search product information",
  check_gift_card: "Check a gift card's balance or status",
  none: "No tool needed; just reply",
};

// Version 0 of the harness: every node starts in shadow (System 2 decides, Jev learns).
export function initialHarness(): Harness {
  const t = DEFAULT_THRESHOLDS;
  return {
    version: 0,
    parent_version: null,
    reason: "Initial harness: all decisions on System 2",
    created_at: new Date(),
    nodes: {
      intent: {
        mode: "shadow",
        context: ["text"],
        thresholds: t,
        question: { type: "choice", instructions: "What is the customer asking for?", criteria: INTENTS },
      },
      urgency: {
        mode: "shadow",
        context: ["text", "facts"],
        thresholds: t,
        question: {
          type: "score",
          instructions: "How urgently does this message need a response?",
          criteria: [
            "Low: general question, no time pressure",
            "Normal: routine order issue",
            "High: customer is blocked or upset, or money is involved",
            "Critical: safety issue, legal threat, or fraud",
          ],
        },
      },
      needs_human: {
        mode: "shadow",
        context: ["text", "facts"],
        thresholds: t,
        question: {
          type: "noul",
          instructions:
            "Should this be escalated to a human agent? Escalate for legal threats, safety hazards, suspected fraud, angry VIP customers, or customers contacting us repeatedly about the same problem.",
        },
      },
      tool: {
        mode: "shadow",
        context: ["text", "facts"],
        thresholds: t,
        question: { type: "choice", instructions: "Which tool should the agent call first?", criteria: TOOLS },
      },
      policy_ok: {
        mode: "shadow",
        context: ["text", "facts"],
        thresholds: t,
        question: {
          type: "noul",
          instructions:
            "Is the action the customer wants allowed by store policy? Refunds only if within_refund_window is true. Cancellations only if order_status is processing. Address changes only if order_status is processing. Questions and status checks are always allowed.",
        },
      },
      reply_ok: {
        mode: "shadow",
        context: ["text", "draft_reply"],
        thresholds: t,
        question: {
          type: "noul",
          instructions:
            "Is the draft reply safe to send as-is? It must be polite, answer the customer's actual question, and make no promises the store can't keep (like guaranteed delivery dates or refunds outside policy).",
        },
      },
    },
  };
}

// Deterministic ground truth for the tool and policy nodes.
export function toolFor(intent: string): string {
  return (
    {
      order_status: "lookup_order",
      refund: "issue_refund",
      cancel: "cancel_order",
      change_address: "update_address",
      product_question: "search_catalog",
      gift_card: "check_gift_card",
    }[intent] ?? "none"
  );
}

export function policyFor(intent: string, f: Facts): boolean {
  if (intent === "refund") return f.within_refund_window && f.order_status === "delivered";
  if (intent === "cancel" || intent === "change_address") return f.order_status === "processing";
  return true;
}

// Context policy: build the state each node's reflex sees.
export function stateFor(req: Request, fields: NodeConfig["context"]) {
  const s: Record<string, unknown> = {};
  if (fields.includes("text")) s.customer_message = req.text;
  if (fields.includes("facts")) s.order_facts = req.facts;
  if (fields.includes("draft_reply")) s.draft_reply = req.draft_reply;
  return s;
}
