import { triageAlert } from "@/lib/triage";

export const dynamic = "force-dynamic";

// Triage one pasted alert with the learned harness (Jev + Vector Search memory, no LLM call).
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await triageAlert({ text: String(body.text ?? ""), facts: body.facts ?? {} });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
