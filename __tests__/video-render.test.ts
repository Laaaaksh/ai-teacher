import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateSilenceWav } from "../lib/video/wav";

const ORIGINAL_SARVAM_KEY = process.env.SARVAM_API_KEY;
const ORIGINAL_CACHE_DIR = process.env.VIDEO_CACHE_DIR;
const ORIGINAL_DB_PATH = process.env.DB_PATH;

function ttsResponse(): Response {
  const wav = generateSilenceWav(0.4, 8000);
  return new Response(JSON.stringify({ audios: [wav.toString("base64")] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function ffprobeStreams(mp4Path: string): { codec_type: string; codec_name: string; pix_fmt?: string }[] {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,pix_fmt", "-of", "json", mp4Path]).toString();
  return (JSON.parse(out) as { streams: { codec_type: string; codec_name: string; pix_fmt?: string }[] }).streams;
}

beforeEach(() => {
  process.env.SARVAM_API_KEY = "test-key";
  process.env.DB_PATH = ":memory:";
  process.env.VIDEO_CACHE_DIR = path.join(os.tmpdir(), `ait-video-render-test-${randomUUID()}`);
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(ttsResponse())));
});

afterEach(() => {
  if (process.env.VIDEO_CACHE_DIR) fs.rmSync(process.env.VIDEO_CACHE_DIR, { recursive: true, force: true });
  process.env.SARVAM_API_KEY = ORIGINAL_SARVAM_KEY;
  process.env.VIDEO_CACHE_DIR = ORIGINAL_CACHE_DIR;
  process.env.DB_PATH = ORIGINAL_DB_PATH;
  vi.restoreAllMocks();
});

/**
 * A real end-to-end pass through the pipeline: real Chromium frame capture,
 * real KaTeX/Shiki/Mermaid rendering, real ffmpeg encode+mux+concat. Only
 * the Sarvam network boundary is mocked (as in __tests__/sarvam.test.ts) —
 * everything downstream of that response is exercised for real, so this
 * test fails on a broken renderer, not just a broken mock expectation.
 */
describe("renderLessonVideo (real Chromium + real ffmpeg, mocked Sarvam network)", () => {
  it("produces a playable H.264/yuv420p MP4 with both video and audio streams", async () => {
    const { resetDbForTests } = await import("../lib/db/connection");
    resetDbForTests();
    const { createLearnerProfile, createLessonSession, createLessonPlan, createScenes } = await import("../lib/db");
    const { renderLessonVideo } = await import("../lib/video/render");

    const profile = createLearnerProfile({
      name: "Test",
      level: "beginner",
      priorKnowledge: "",
      goal: "",
      style: "",
      language: "en-IN",
      minutesAvailable: 5,
      depth: "overview",
    });
    const session = createLessonSession({ learnerProfileId: profile.id, topic: "Test Topic", language: "en-IN", totalMinutes: 5, depth: "overview" });
    const conceptId = randomUUID();
    const plan = createLessonPlan({
      lessonSessionId: session.id,
      learnerProfileId: profile.id,
      topic: "Test Topic",
      language: "en-IN",
      totalMinutes: 5,
      depth: "overview",
      concepts: [
        {
          id: conceptId,
          title: "A Simple Equation",
          summary: "",
          subject: "mathematics",
          difficulty: 1,
          prerequisiteConceptIds: [],
          timeBudgetSeconds: 10,
          citations: [],
          visual: { kind: "equation", renderer: "katex", rationale: "test", content: "x + 1 = 2" },
        },
      ],
    });
    createScenes([
      {
        lessonPlanId: plan.id,
        conceptId,
        type: "explanation",
        order: 0,
        narration: "This is a short test scene.",
        estimatedSeconds: 2,
        visual: { kind: "equation", renderer: "katex", rationale: "test", content: "x + 1 = 2" },
      },
    ]);

    const outputPath = path.join(process.env.VIDEO_CACHE_DIR!, "out.mp4");
    const progressStages: string[] = [];

    const result = await renderLessonVideo(plan.id, outputPath, {
      fps: 4,
      onProgress: (p) => progressStages.push(p.stage),
    });

    expect(result.sceneCount).toBe(1);
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(1000);
    expect(progressStages).toContain("narrating");
    expect(progressStages).toContain("rendering");
    expect(progressStages).toContain("muxing");

    const streams = ffprobeStreams(outputPath);
    const video = streams.find((s) => s.codec_type === "video");
    const audio = streams.find((s) => s.codec_type === "audio");
    expect(video?.codec_name).toBe("h264");
    expect(video?.pix_fmt).toBe("yuv420p");
    expect(audio).toBeDefined();
  }, 60_000);

  /**
   * A scene's composed page carries its position in the WHOLE plan ("Scene 2 /
   * 3"), so rendering it alone must compose — and therefore cache — byte for
   * byte the same as rendering it inside the full lesson. If the position were
   * taken from the rendered subset instead, the segment render would burn in
   * "Scene 1 / 1" and miss the cache.
   */
  it("composes a scene identically whether rendered alone or as part of the whole plan", async () => {
    const { resetDbForTests } = await import("../lib/db/connection");
    resetDbForTests();
    const { createLearnerProfile, createLessonSession, createLessonPlan, createScenes } = await import("../lib/db");
    const { renderLessonVideo } = await import("../lib/video/render");

    const profile = createLearnerProfile({
      name: "Test",
      level: "beginner",
      priorKnowledge: "",
      goal: "",
      style: "",
      language: "en-IN",
      minutesAvailable: 5,
      depth: "overview",
    });
    const session = createLessonSession({ learnerProfileId: profile.id, topic: "Test Topic", language: "en-IN", totalMinutes: 5, depth: "overview" });
    const conceptId = randomUUID();
    const plan = createLessonPlan({
      lessonSessionId: session.id,
      learnerProfileId: profile.id,
      topic: "Test Topic",
      language: "en-IN",
      totalMinutes: 5,
      depth: "overview",
      concepts: [
        {
          id: conceptId,
          title: "A Simple Equation",
          summary: "",
          subject: "mathematics",
          difficulty: 1,
          prerequisiteConceptIds: [],
          timeBudgetSeconds: 10,
          citations: [],
          visual: { kind: "equation", renderer: "katex", rationale: "test", content: "x + 1 = 2" },
        },
      ],
    });
    const scenes = createScenes([
      { lessonPlanId: plan.id, conceptId, type: "introduction", order: 0, narration: "First scene.", estimatedSeconds: 2 },
      { lessonPlanId: plan.id, conceptId, type: "explanation", order: 1, narration: "Second scene.", estimatedSeconds: 2 },
    ]);

    const { sceneCacheDir } = await import("../lib/video/paths");
    await renderLessonVideo(plan.id, path.join(process.env.VIDEO_CACHE_DIR!, "full.mp4"), { fps: 4 });
    const afterFullRender = fs.readdirSync(sceneCacheDir()).sort();

    await renderLessonVideo(plan.id, path.join(process.env.VIDEO_CACHE_DIR!, "segment.mp4"), {
      fps: 4,
      sceneIds: [scenes[1].id],
      skipTitleCard: true,
    });

    expect(fs.readdirSync(sceneCacheDir()).sort()).toEqual(afterFullRender);
  }, 90_000);
});
