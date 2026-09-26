import { runSurge } from "@/lib/runner";

export const dynamic = "force-dynamic";

// Starts a surge in the background. Only enabled locally (the deployed site is read-only).
let running = false;

export async function POST(req: Request) {
  if (process.env.ALLOW_RUN !== "1") return Response.json({ error: "Runs are disabled on this deployment" }, { status: 403 });
  if (running) return Response.json({ error: "A run is already in progress" }, { status: 409 });
  const body = await req.json().catch(() => ({}));
  running = true;
  runSurge({ limit: body.limit, arrivalsPerSec: body.rate, reset: true })
    .catch((e) => console.error(e))
    .finally(() => (running = false));
  return Response.json({ started: true });
}
