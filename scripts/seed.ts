import { config } from "dotenv";
config({ path: ".env.local" });

import { generateText, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { closeDb, getDb } from "../lib/db";
import { MODELS } from "../lib/models";
import { autoOkFor, playbookFor, type Facts, type Request } from "../lib/workload";

// Generates the labeled SOC alert storm: a base stream, then a new attack campaign
// (attacks on the company's AI agents) mixed in from BASE_ONLY onward.
// Labels are fixed in code; the LLM only writes the alert text.

const BASE = 360;
const CAMPAIGN = 90;
const BASE_ONLY = 240;
const BATCH = 15;

type Spec = { id: number; category: string; facts: Facts; scanner: boolean; fp: boolean; severity: number };

const rand = (p: number) => Math.random() < p;
const pick = <T,>(weights: [T, number][]): T => {
  let r = Math.random() * weights.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of weights) if ((r -= w) <= 0) return v;
  return weights[0][0];
};

const ATTACKS = new Set(["phishing", "malware", "credential_compromise", "brute_force", "data_exfiltration", "ai_agent_attack"]);
const BREACH = new Set(["credential_compromise", "data_exfiltration", "malware", "ai_agent_attack"]);

function spec(id: number, category: string): Spec {
  const benign = category === "benign_admin_activity";
  const facts: Facts = {
    asset_criticality: rand(0.3) ? "high" : "low",
    user_privileged: rand(0.2),
    threat_intel_match: ATTACKS.has(category) ? rand(0.35) : rand(0.03),
    off_hours: rand(0.4),
    repeated_today: rand(0.2),
  };
  const scanner = category === "brute_force" && rand(0.2);
  const fp = benign || scanner;
  const severity = fp
    ? 0
    : BREACH.has(category) && (facts.asset_criticality === "high" || facts.user_privileged)
      ? 3
      : ATTACKS.has(category) && (facts.threat_intel_match || facts.user_privileged || facts.asset_criticality === "high")
        ? 2
        : 1;
  return { id, category, facts, scanner, fp, severity };
}

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

async function writeAlerts(specs: Spec[]) {
  const { output } = await generateText({
    model: openrouter(MODELS.generator),
    output: Output.object({ schema: z.object({ items: z.array(z.object({ id: z.number(), text: z.string() })) }) }),
    system:
      "You write realistic security alerts exactly as SOC tools emit them (Okta, CrowdStrike Falcon, Microsoft Defender, Proofpoint, Zscaler, AWS GuardDuty, an internal LLM gateway). Each alert is a title line plus 1-3 lines of details with plausible users, hosts, IPs, counts and tool names. Vary tools, formats and wording a lot. Never state the category label itself.",
    prompt: `Write one alert per spec.
Category meanings:
- phishing: suspicious email, link or attachment reported or detected
- malware: malicious process, file or behavior on an endpoint
- credential_compromise: impossible travel, token theft, suspicious MFA or session reuse
- brute_force: many failed logins or password spraying. If scanner is true, the source is the company's own internal vulnerability scanner (name it, e.g. vuln-scanner-01).
- data_exfiltration: unusual upload volume or transfer to an unknown destination
- policy_violation: an employee broke policy without malice (personal cloud storage, unapproved software, sharing a file publicly)
- benign_admin_activity: legitimate admin or maintenance work that looks suspicious (mention a change ticket, backup job or patch window)
- other: an unusual but hard-to-classify event
- ai_agent_attack: an attack on the company's AI agents. Examples: prompt injection against the customer chatbot, a coding agent trying to read secrets after processing an untrusted README, an MCP tool description that changed after approval, an agent calling an unknown external domain, LLM output containing an API key pattern. Vary these.
Use hostnames and roles that fit the given asset_criticality (high: prod-db, domain controller, payments; low: laptops, test boxes) and user_privileged (admin accounts).

Specs:
${JSON.stringify(specs.map(({ id, category, scanner, facts }) => ({ id, category, scanner, asset_criticality: facts.asset_criticality, user_privileged: facts.user_privileged })))}`,
  });
  return output.items;
}

async function main() {
  const categories: [string, number][] = [
    ["phishing", 0.2], ["malware", 0.12], ["credential_compromise", 0.14], ["brute_force", 0.14],
    ["data_exfiltration", 0.08], ["policy_violation", 0.12], ["benign_admin_activity", 0.15], ["other", 0.05],
  ];
  const base = Array.from({ length: BASE }, (_, i) => spec(i, pick(categories)));
  const campaign = Array.from({ length: CAMPAIGN }, (_, i) => spec(BASE + i, "ai_agent_attack"));

  // Order: base only first, then the rest of base shuffled with the campaign.
  const tail = [...base.slice(BASE_ONLY), ...campaign].sort(() => Math.random() - 0.5);
  const ordered = [...base.slice(0, BASE_ONLY), ...tail];

  const chunks: Spec[][] = [];
  for (let i = 0; i < ordered.length; i += BATCH) chunks.push(ordered.slice(i, i + BATCH));
  console.log(`Generating ${ordered.length} alerts in ${chunks.length} calls...`);

  const texts = new Map<number, string>();
  let done = 0;
  const queue = [...chunks];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const chunk = queue.shift()!;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            for (const it of await writeAlerts(chunk)) texts.set(it.id, it.text);
            break;
          } catch (e) {
            if (attempt === 2) console.error("chunk failed:", (e as Error).message);
          }
        }
        console.log(`  ${++done}/${chunks.length}`);
      }
    }),
  );

  const requests: Request[] = ordered
    .filter((s) => texts.has(s.id))
    .map((s, seq) => ({
      seq,
      batch: s.category === "ai_agent_attack" ? "campaign" : "base",
      text: texts.get(s.id)!,
      facts: s.facts,
      truth: {
        category: s.category,
        severity: s.severity,
        false_positive: s.fp,
        escalate: !s.fp && s.severity >= 2,
        playbook: playbookFor(s.category, s.fp),
        auto_ok: autoOkFor(s.fp, s.severity, s.facts),
      },
    }));

  const db = await getDb();
  await db.collection("requests").deleteMany({});
  await db.collection("requests").insertMany(requests);
  await db.collection("requests").createIndex({ seq: 1 }, { unique: true });
  const firstCampaign = requests.find((r) => r.batch === "campaign")?.seq;
  console.log(`Seeded ${requests.length} alerts (${requests.filter((r) => r.batch === "campaign").length} campaign, first at #${firstCampaign}).`);
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
