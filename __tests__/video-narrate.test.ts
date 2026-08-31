import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateSilenceWav } from "../lib/video/wav";

const ORIGINAL_SARVAM_KEY = process.env.SARVAM_API_KEY;
const ORIGINAL_CACHE_DIR = process.env.VIDEO_CACHE_DIR;

function ttsResponse(wav: Buffer): Response {
  return new Response(JSON.stringify({ audios: [wav.toString("base64")] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  process.env.SARVAM_API_KEY = "test-key";
  process.env.VIDEO_CACHE_DIR = path.join(os.tmpdir(), `ait-video-test-${randomUUID()}`);
  vi.resetModules();
});

afterEach(() => {
  if (process.env.VIDEO_CACHE_DIR) fs.rmSync(process.env.VIDEO_CACHE_DIR, { recursive: true, force: true });
  process.env.SARVAM_API_KEY = ORIGINAL_SARVAM_KEY;
  process.env.VIDEO_CACHE_DIR = ORIGINAL_CACHE_DIR;
  vi.restoreAllMocks();
});

describe("narrate()", () => {
  it("calls Sarvam TTS once and returns a decoded duration + envelope", async () => {
    const wav = generateSilenceWav(1, 8000);
    const fetchMock = vi.fn().mockResolvedValue(ttsResponse(wav));
    vi.stubGlobal("fetch", fetchMock);

    const { narrate } = await import("../lib/video/narrate");
    const result = await narrate({ text: "Hello there.", language: "en-IN", speaker: "priya" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.durationSeconds).toBeCloseTo(1, 1);
    expect(result.envelope.length).toBeGreaterThan(0);
    expect(fs.existsSync(result.wavPath)).toBe(true);
  });

  it("caches by content hash: identical (text, language, speaker) skips the network call", async () => {
    const wav = generateSilenceWav(0.5, 8000);
    const fetchMock = vi.fn().mockResolvedValue(ttsResponse(wav));
    vi.stubGlobal("fetch", fetchMock);

    const { narrate } = await import("../lib/video/narrate");
    const params = { text: "Cache me.", language: "en-IN" as const, speaker: "priya" as const };

    const first = await narrate(params);
    const second = await narrate(params);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.wavPath).toBe(first.wavPath);
    expect(second.durationSeconds).toBeCloseTo(first.durationSeconds, 6);
  });

  it("does not cache across a different speaker or language", async () => {
    const wav = generateSilenceWav(0.3, 8000);
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(ttsResponse(wav)));
    vi.stubGlobal("fetch", fetchMock);

    const { narrate } = await import("../lib/video/narrate");
    await narrate({ text: "Same text.", language: "en-IN", speaker: "priya" });
    await narrate({ text: "Same text.", language: "en-IN", speaker: "aditya" });
    await narrate({ text: "Same text.", language: "hi-IN", speaker: "priya" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("sends hinglish narration to Sarvam with the Hindi target language code", async () => {
    const wav = generateSilenceWav(0.2, 8000);
    const fetchMock = vi.fn().mockResolvedValue(ttsResponse(wav));
    vi.stubGlobal("fetch", fetchMock);

    const { narrate } = await import("../lib/video/narrate");
    await narrate({ text: "Mujhe samjhao.", language: "hinglish", speaker: "priya" });

    const call = fetchMock.mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.target_language_code).toBe("hi-IN");
  });
});
