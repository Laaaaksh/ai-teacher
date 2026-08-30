import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { getLessonPlan, getScenesForLessonPlan } from "../db";
import type { SceneRow } from "../db/types";
import type { LanguageCode } from "../types";
import { getPersona, type TeacherPersona } from "./avatar/personas";
import { buildCaptionCues } from "./captions";
import { RESOLUTION, composeScenePage, composeTitleCardPage } from "./compose";
import { concatVideos, encodeSceneVideo } from "./ffmpeg";
import { ENVELOPE_FPS, narrate } from "./narrate";
import { framesDirFor, sceneCacheDir } from "./paths";
import { renderVisual } from "./visuals";

export const DEFAULT_FPS = 24;

/** Bumped whenever the rendering logic changes in a way that should invalidate every cached scene video. */
const PIPELINE_VERSION = 1;

export interface RenderProgress {
  stage: "narrating" | "rendering" | "muxing";
  percent: number;
  detail: string;
}

export interface RenderLessonOptions {
  fps?: number;
  personaId?: string;
  onProgress?: (p: RenderProgress) => void;
}

function sceneCacheKey(input: { narration: string; visualKey: string; personaId: string; fps: number; durationSeconds: number }): string {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify({
      v: PIPELINE_VERSION,
      narration: input.narration,
      visual: input.visualKey,
      persona: input.personaId,
      fps: input.fps,
      duration: input.durationSeconds,
      resolution: RESOLUTION,
    }),
  );
  return hash.digest("hex");
}

async function captureScenePlainToVideo(params: {
  browser: import("playwright").Browser;
  html: string;
  fps: number;
  durationSeconds: number;
  audioPath: string;
  cacheKey: string;
}): Promise<string> {
  const outputPath = path.join(sceneCacheDir(), `${params.cacheKey}.mp4`);
  if (fs.existsSync(outputPath)) return outputPath;

  const framesDir = framesDirFor(params.cacheKey);
  const page = await params.browser.newPage({ viewport: RESOLUTION });
  try {
    await page.setContent(params.html, { waitUntil: "load" });

    const totalFrames = Math.max(1, Math.ceil(params.durationSeconds * params.fps));
    for (let i = 0; i < totalFrames; i++) {
      const tMs = Math.round((i * 1000) / params.fps);
      await page.evaluate((t) => {
        const w = window as unknown as { __renderFrame?: (t: number) => void };
        w.__renderFrame?.(t);
      }, tMs);
      const framePath = path.join(framesDir, `frame-${String(i + 1).padStart(6, "0")}.png`);
      await page.screenshot({ path: framePath });
    }

    await encodeSceneVideo({ framesDir, fps: params.fps, audioPath: params.audioPath, outputPath });
    return outputPath;
  } finally {
    await page.close();
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
}

/** ~3s title card with a short spoken welcome, giving the lesson a real opening beat instead of dropping straight into content. */
async function buildTitleCard(params: {
  browser: import("playwright").Browser;
  topic: string;
  language: LanguageCode;
  persona: TeacherPersona;
  fps: number;
}): Promise<string> {
  const welcomeText = `Welcome! In this lesson, we will explore ${params.topic}.`;
  const { envelope, durationSeconds, wavPath } = await narrate({ text: welcomeText, language: params.language, speaker: params.persona.speaker });

  const cacheKey = sceneCacheKey({ narration: `title-card:${welcomeText}`, visualKey: "title-card", personaId: params.persona.id, fps: params.fps, durationSeconds });
  const outputPath = path.join(sceneCacheDir(), `${cacheKey}.mp4`);
  if (fs.existsSync(outputPath)) return outputPath;

  const html = composeTitleCardPage({
    kind: "title-card",
    persona: params.persona,
    envelope,
    envelopeFps: ENVELOPE_FPS,
    durationSeconds,
    captions: buildCaptionCues(welcomeText, durationSeconds),
    sceneSeed: hashSeed(params.topic),
    lessonTopic: params.topic,
    language: params.language,
  });

  return captureScenePlainToVideo({ browser: params.browser, html, fps: params.fps, durationSeconds, audioPath: wavPath, cacheKey });
}

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * Renders a full lesson video: narration -> per-scene visual + avatar
 * composition -> deterministic frame capture -> ffmpeg mux -> concat. Each
 * scene's rendered MP4 is cached by content hash (narration + visual +
 * persona + fps), so re-running after editing one scene only re-renders
 * that scene, not the whole lesson.
 */
export async function renderLessonVideo(lessonPlanId: string, outputPath: string, opts: RenderLessonOptions = {}): Promise<{ outputPath: string; sceneCount: number }> {
  const plan = getLessonPlan(lessonPlanId);
  if (!plan) throw new Error(`No lesson plan found for id ${lessonPlanId}.`);
  const scenes = getScenesForLessonPlan(lessonPlanId);
  if (scenes.length === 0) throw new Error(`Lesson plan ${lessonPlanId} has no scenes to render.`);

  const fps = opts.fps ?? DEFAULT_FPS;
  const persona = getPersona(opts.personaId);
  const report = (p: RenderProgress) => opts.onProgress?.(p);

  const browser = await chromium.launch();
  try {
    // --- Narration: one Sarvam TTS call per scene, cached by content hash (narrate.ts) ---
    report({ stage: "narrating", percent: 0, detail: "Synthesizing title card narration" });
    const titleCardVideoPromise = buildTitleCard({ browser, topic: plan.topic, language: plan.language, persona, fps });

    const narrations: { scene: SceneRow; audioPath: string; durationSeconds: number; envelope: number[] }[] = [];
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      report({ stage: "narrating", percent: Math.round(((i + 1) / scenes.length) * 20), detail: `Narrating scene ${i + 1}/${scenes.length}` });
      const result = await narrate({ text: scene.narration, language: plan.language, speaker: persona.speaker });
      narrations.push({ scene, audioPath: result.wavPath, durationSeconds: result.durationSeconds, envelope: result.envelope });
    }

    // --- Per-scene visual + avatar composition, deterministic frame capture, ffmpeg mux ---
    const prepPage = await browser.newPage({ viewport: RESOLUTION });
    const sceneVideoPaths: string[] = [];
    try {
      for (let i = 0; i < narrations.length; i++) {
        const { scene, audioPath, durationSeconds, envelope } = narrations[i];
        report({ stage: "rendering", percent: 20 + Math.round((i / narrations.length) * 65), detail: `Rendering scene ${i + 1}/${narrations.length}` });

        const rendered = scene.visual ? await renderVisual(scene.visual, prepPage) : null;
        const concept = plan.concepts.find((c) => c.id === scene.conceptId);

        const visualKey = scene.visual ? `${scene.visual.renderer}:${scene.visual.kind}:${scene.visual.content}` : "none";
        const cacheKey = sceneCacheKey({ narration: scene.narration, visualKey, personaId: persona.id, fps, durationSeconds });

        const html = composeScenePage({
          kind: "scene",
          persona,
          envelope,
          envelopeFps: ENVELOPE_FPS,
          durationSeconds,
          captions: buildCaptionCues(scene.narration, durationSeconds),
          sceneSeed: hashSeed(scene.id),
          sceneType: scene.type,
          conceptTitle: concept?.title ?? plan.topic,
          lessonTopic: plan.topic,
          sceneIndex: i,
          totalScenes: narrations.length,
          visual: rendered,
          onScreenText: scene.narration,
        });

        const scenePath = await captureScenePlainToVideo({ browser, html, fps, durationSeconds, audioPath, cacheKey });
        sceneVideoPaths.push(scenePath);
      }
    } finally {
      await prepPage.close();
    }

    const titleCardPath = await titleCardVideoPromise;

    // --- Concatenate title card + scenes into the final lesson video ---
    report({ stage: "muxing", percent: 90, detail: "Concatenating scenes" });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await concatVideos([titleCardPath, ...sceneVideoPaths], outputPath);

    report({ stage: "muxing", percent: 100, detail: "Done" });
    return { outputPath, sceneCount: scenes.length };
  } finally {
    await browser.close();
  }
}
