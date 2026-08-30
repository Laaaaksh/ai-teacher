import type { SceneType } from "../types";
import { avatarRuntimeScript, renderAvatarSvg } from "./avatar/avatarRuntime";
import type { TeacherPersona } from "./avatar/personas";
import type { CaptionCue } from "./captions";
import type { RenderedVisual, RevealMode } from "./visuals";

export const RESOLUTION = { width: 1280, height: 720 } as const;

interface BaseComposeInput {
  persona: TeacherPersona;
  envelope: number[];
  envelopeFps: number;
  durationSeconds: number;
  captions: CaptionCue[];
  sceneSeed: number;
}

export interface ComposeSceneInput extends BaseComposeInput {
  kind: "scene";
  sceneType: SceneType;
  conceptTitle: string;
  lessonTopic: string;
  sceneIndex: number;
  totalScenes: number;
  visual: RenderedVisual | null;
  onScreenText: string;
}

export interface ComposeTitleCardInput extends BaseComposeInput {
  kind: "title-card";
  lessonTopic: string;
  language: string;
}

/** Base CSS shared by every scene. No `transition`/`@keyframes` anywhere — all motion is driven explicitly per-frame by __renderFrame(tMs) so captured frames are a pure function of logical time, not wall-clock time (required for deterministic frame capture). */
const BASE_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; width: ${RESOLUTION.width}px; height: ${RESOLUTION.height}px; overflow: hidden; }
  body { background: radial-gradient(circle at 20% 15%, #1b2436 0%, #0c0f16 70%); font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #f1f3f6; }
  .reveal-step { opacity: 0; }
  .scene-wrap { display: flex; flex-direction: column; height: 100%; padding: 26px 30px 0 30px; }
  .scene-header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 14px; }
  .scene-header h1 { font-size: 22px; margin: 0; font-weight: 600; }
  .scene-header .scene-progress { font-size: 13px; color: #8f97a6; }
  .scene-body { flex: 1; display: flex; gap: 22px; min-height: 0; }
  .visual-panel { flex: 0 0 66%; background: #131826; border-radius: 18px; padding: 24px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 12px 30px rgba(0,0,0,0.35); }
  .visual-panel > div { flex: 1; min-height: 0; display: flex; flex-direction: column; justify-content: center; }
  .avatar-panel { flex: 0 0 32%; display: flex; align-items: flex-end; justify-content: center; position: relative; }
  .avatar-panel svg { width: 100%; height: auto; max-height: 460px; }
  .caption-bar { height: 64px; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.55); margin: 0 -30px; padding: 0 40px; }
  #caption-text { font-size: 20px; font-weight: 600; text-align: center; line-height: 1.3; }
  .visual-caption { color: #9aa4b2; font-size: 13px; margin-top: 10px; text-align: center; }
  .math-step { font-size: 22px; margin: 10px 0; }
  .math-step-label { display: block; font-size: 12px; color: #6fa8ff; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px; }
  .math-step-final .katex { color: #6fcf97; }
  .visual-code pre { border-radius: 10px; padding: 16px !important; font-size: 15px; margin: 0; }
  .code-output-arrow { color: #8f97a6; font-size: 13px; margin: 10px 0 4px; }
  .code-output-pane { background: #0d1117; border: 1px solid #2a2f3a; border-radius: 10px; padding: 12px 16px; font-family: ui-monospace, monospace; font-size: 14px; color: #6fcf97; margin: 0; }
  .visual-bullets ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 14px; }
  .visual-bullets li { font-size: 20px; padding-left: 26px; position: relative; }
  .visual-bullets li::before { content: "▸"; position: absolute; left: 0; color: #e8b13a; }
  .visual-table table { width: 100%; border-collapse: collapse; font-size: 16px; }
  .visual-table th, .visual-table td { border-bottom: 1px solid #2a2f3a; padding: 8px 10px; text-align: left; }
  .visual-table th { color: #8f97a6; font-weight: 600; }
  .visual-diagram, .visual-plot, .visual-image { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; }
  .visual-diagram-mermaid svg { max-width: 100%; max-height: 100%; }
  .visual-diagram-title { margin: 0 0 12px; font-size: 18px; }
  .visual-image img { max-width: 100%; max-height: 100%; border-radius: 10px; }
  .plot-svg { width: 100%; height: 100%; }
  .plot-legend { display: flex; gap: 16px; margin-top: 8px; font-size: 13px; justify-content: center; }
  .plot-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; }
  .visual-diagram-error, .visual-plot-error { color: #f2994a; font-size: 15px; padding: 20px; text-align: center; }
  .title-card-wrap { display: flex; flex-direction: column; height: 100%; }
  .title-card { position: relative; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 18px; min-height: 0; }
  .title-card .wordmark { font-size: 16px; letter-spacing: 0.3em; text-transform: uppercase; color: #6fa8ff; }
  .title-card h1 { font-size: 44px; margin: 0; max-width: 900px; }
  .title-card .lang-badge { font-size: 14px; color: #8f97a6; border: 1px solid #2a2f3a; border-radius: 999px; padding: 6px 18px; }
  .title-card .title-avatar { position: absolute; bottom: 24px; right: 60px; width: 220px; }
`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function frameDriverScript(opts: { durationMs: number; captions: CaptionCue[]; revealMode: RevealMode; stepCount: number }): string {
  return `
(function () {
  var DURATION_MS = ${opts.durationMs};
  var STEP_COUNT = ${opts.stepCount};
  var CAPTIONS = ${JSON.stringify(opts.captions)};
  var continuousCache = null;

  function updatePanelIntro(t) {
    var panel = document.querySelector(".visual-panel, .title-card");
    if (!panel) return;
    var introT = Math.min(1, t / 400);
    panel.style.opacity = String(introT);
    panel.style.transform = "translateY(" + ((1 - introT) * 10).toFixed(1) + "px)";
  }

  function updateSteps(t) {
    var active = Math.min(STEP_COUNT - 1, Math.floor((t / Math.max(1, DURATION_MS)) * STEP_COUNT));
    var steps = document.querySelectorAll(".reveal-step");
    for (var i = 0; i < steps.length; i++) {
      var el = steps[i];
      var idx = Number(el.getAttribute("data-step"));
      el.style.opacity = idx <= active ? "1" : "0";
    }
  }

  function updateContinuous(t) {
    if (!continuousCache) {
      continuousCache = [];
      var els = document.querySelectorAll("[data-continuous-reveal]");
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var len = el.getTotalLength ? el.getTotalLength() : 0;
        el.style.strokeDasharray = String(len);
        continuousCache.push({ el: el, len: len });
      }
    }
    var frac = Math.min(1, t / Math.max(1, DURATION_MS));
    for (var j = 0; j < continuousCache.length; j++) {
      continuousCache[j].el.style.strokeDashoffset = String(continuousCache[j].len * (1 - frac));
    }
  }

  function updateCaptions(t) {
    var el = document.getElementById("caption-text");
    if (!el) return;
    var text = "";
    for (var i = 0; i < CAPTIONS.length; i++) {
      if (t >= CAPTIONS[i].startMs && t < CAPTIONS[i].endMs) { text = CAPTIONS[i].text; break; }
    }
    el.textContent = text;
  }

  window.__renderFrame = function (t) {
    updatePanelIntro(t);
    updateSteps(t);
    updateContinuous(t);
    updateCaptions(t);
    if (window.__avatarStep) window.__avatarStep(t);
  };
})();`.trim();
}

function page(bodyHtml: string, extraCss: string, scripts: string[]): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<style>${BASE_CSS}\n${extraCss}</style>
</head>
<body>
${bodyHtml}
${scripts.map((s) => `<script>${s}</script>`).join("\n")}
</body>
</html>`;
}

function wrapAvatarSvg(inner: string): string {
  return `<svg viewBox="0 0 320 420" xmlns="http://www.w3.org/2000/svg" style="display:block">${inner}</svg>`;
}

export function composeScenePage(input: ComposeSceneInput): string {
  const visual = input.visual;
  const css = visual?.css?.map((c) => c.content).join("\n") ?? "";
  const durationMs = Math.round(input.durationSeconds * 1000);

  const body = `
<div class="scene-wrap">
  <div class="scene-header">
    <h1>${escapeHtml(input.conceptTitle)}</h1>
    <span class="scene-progress">Scene ${input.sceneIndex + 1} / ${input.totalScenes} &middot; ${escapeHtml(input.lessonTopic)}</span>
  </div>
  <div class="scene-body">
    <div class="visual-panel">${visual ? visual.html : `<div class="visual-bullets"><p>${escapeHtml(input.onScreenText)}</p></div>`}</div>
    <div class="avatar-panel">${wrapAvatarSvg(renderAvatarSvg(input.persona))}</div>
  </div>
  <div class="caption-bar"><div id="caption-text"></div></div>
</div>`;

  const scripts = [
    avatarRuntimeScript({ envelope: input.envelope, envelopeFps: input.envelopeFps, sceneSeed: input.sceneSeed }),
    frameDriverScript({
      durationMs,
      captions: input.captions,
      revealMode: visual?.revealMode ?? "fade",
      stepCount: visual?.stepCount ?? 1,
    }),
  ];

  return page(body, css, scripts);
}

export function composeTitleCardPage(input: ComposeTitleCardInput): string {
  const durationMs = Math.round(input.durationSeconds * 1000);

  const body = `
<div class="title-card-wrap">
  <div class="title-card">
    <div class="wordmark">AI Teacher</div>
    <h1>${escapeHtml(input.lessonTopic)}</h1>
    <div class="lang-badge">${escapeHtml(input.language)}</div>
    <div class="title-avatar">${wrapAvatarSvg(renderAvatarSvg(input.persona))}</div>
  </div>
  <div class="caption-bar"><div id="caption-text"></div></div>
</div>`;

  const scripts = [
    avatarRuntimeScript({ envelope: input.envelope, envelopeFps: input.envelopeFps, sceneSeed: input.sceneSeed }),
    frameDriverScript({ durationMs, captions: input.captions, revealMode: "fade", stepCount: 1 }),
  ];

  return page(body, "", scripts);
}
