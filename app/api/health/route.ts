import { NextResponse } from "next/server";
import { checkHealth } from "@/lib/sarvam";
import type { HealthCheckResult } from "@/lib/sarvam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Probing all four Sarvam endpoints costs real quota, so a result is reused briefly. */
const HEALTH_CACHE_TTL_MS = 30_000;

interface HealthPayload {
  ok: boolean;
  checkedAt: string;
  totalLatencyMs: number;
  services: HealthCheckResult[];
}

let cached: { at: number; payload: HealthPayload } | null = null;

/**
 * Real reachability check for every Sarvam endpoint the app depends on —
 * each result comes from an actual call (chat/tts/translate/stt), not a
 * hardcoded "ok". If SARVAM_API_KEY is missing, every check reports
 * unreachable with a config error rather than throwing. A real result is
 * cached for HEALTH_CACHE_TTL_MS and replayed with a `cachedAgeMs` marker so
 * repeated polling does not burn four API calls per request.
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

  const age = cached ? Date.now() - cached.at : Infinity;
  if (cached && age < HEALTH_CACHE_TTL_MS) {
    return NextResponse.json({ ...cached.payload, cachedAgeMs: age }, { status: cached.payload.ok ? 200 : 503 });
  }

  const services = await checkHealth();
  const payload: HealthPayload = {
    ok: services.every((s) => s.reachable),
    checkedAt: new Date().toISOString(),
    totalLatencyMs: Date.now() - startedAt,
    services,
  };
  cached = { at: Date.now(), payload };

  return NextResponse.json(payload, { status: payload.ok ? 200 : 503 });
}
