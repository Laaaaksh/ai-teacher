import { NextResponse } from "next/server";
import { checkHealth } from "@/lib/sarvam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Real reachability check for every Sarvam endpoint the app depends on —
 * each result comes from an actual call (chat/tts/translate/stt), not a
 * hardcoded "ok". If SARVAM_API_KEY is missing, every check reports
 * unreachable with a config error rather than throwing.
 */
export async function GET() {
  const startedAt = Date.now();

  if (!process.env.SARVAM_API_KEY) {
    return NextResponse.json(
      {
        ok: false,
        checkedAt: new Date().toISOString(),
        services: ["chat", "tts", "translate", "stt"].map((service) => ({
          service,
          reachable: false,
          error: "config: SARVAM_API_KEY is not set",
        })),
      },
      { status: 503 },
    );
  }

  const services = await checkHealth();
  const ok = services.every((s) => s.reachable);

  return NextResponse.json(
    {
      ok,
      checkedAt: new Date().toISOString(),
      totalLatencyMs: Date.now() - startedAt,
      services,
    },
    { status: ok ? 200 : 503 },
  );
}
