import { triageAlert } from "@/lib/triage";

export const dynamic = "force-dynamic";

// Triage one pasted alert with the learned harness (Jev + Vector Search memory, no LLM call).
// Public endpoint that spends the OpenRouter key: cap input size and rate-limit per IP.
const MAX_CHARS = 2000;
const LIMIT = 20; // requests per IP per minute (per server instance)
const hits = new Map<string, number[]>();

function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > LIMIT;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (limited(ip)) return Response.json({ error: "Too many requests, try again in a minute." }, { status: 429 });
  try {
    const body = await req.json();
    const text = String(body.text ?? "").trim();
    if (!text) return Response.json({ error: "Paste a security alert first." }, { status: 400 });
    if (text.length > MAX_CHARS) return Response.json({ error: `Alerts are limited to ${MAX_CHARS} characters.` }, { status: 400 });
    const facts = typeof body.facts === "object" && body.facts ? body.facts : {};
    return Response.json(await triageAlert({ text, facts }));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
