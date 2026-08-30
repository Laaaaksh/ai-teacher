import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = process.env.SARVAM_API_KEY;

const checkHealth = vi.fn();
vi.mock("@/lib/sarvam", () => ({ checkHealth: () => checkHealth() }));

const REACHABLE = [
  { service: "chat", reachable: true, latencyMs: 12 },
  { service: "tts", reachable: true, latencyMs: 12 },
  { service: "translate", reachable: true, latencyMs: 12 },
  { service: "stt", reachable: true, latencyMs: 12 },
];

beforeEach(() => {
  process.env.SARVAM_API_KEY = "test-key";
  checkHealth.mockReset().mockResolvedValue(REACHABLE);
  vi.resetModules();
});

afterEach(() => {
  process.env.SARVAM_API_KEY = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("serves the previous real probe result within the cache TTL", async () => {
    const { GET } = await import("../app/api/health/route");

    const first = await (await GET()).json();
    const second = await (await GET()).json();

    expect(checkHealth).toHaveBeenCalledTimes(1);
    expect(first.cachedAgeMs).toBeUndefined();
    expect(second.cachedAgeMs).toBeGreaterThanOrEqual(0);
    expect(second.services).toEqual(first.services);
  });

  it("re-probes once the cached result has aged past the TTL", async () => {
    const { GET } = await import("../app/api/health/route");

    await GET();
    // Well past any sane TTL; the route keeps its own TTL private because a
    // Next route module may only export handlers and known route config.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10 * 60_000);
    const fresh = await (await GET()).json();

    expect(checkHealth).toHaveBeenCalledTimes(2);
    expect(fresh.cachedAgeMs).toBeUndefined();
  });

  it("caches an unhealthy result rather than synthesising a healthy one", async () => {
    checkHealth.mockResolvedValue([
      { service: "chat", reachable: false, error: "http: 500" },
      ...REACHABLE.slice(1),
    ]);
    const { GET } = await import("../app/api/health/route");

    const first = await GET();
    const second = await GET();

    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    expect((await second.json()).ok).toBe(false);
    expect(checkHealth).toHaveBeenCalledTimes(1);
  });
});
