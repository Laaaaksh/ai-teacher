import { describe, expect, it } from "vitest";
import { getPersona } from "../lib/video/avatar/personas";
import { composeScenePage } from "../lib/video/compose";
import type { RenderedVisual } from "../lib/video/visuals";

function scenePage(overrides: { captions?: { text: string; startMs: number; endMs: number }[]; visual?: RenderedVisual | null } = {}): string {
  return composeScenePage({
    kind: "scene",
    persona: getPersona(),
    envelope: [0, 0.4, 0.8],
    envelopeFps: 10,
    durationSeconds: 2,
    captions: overrides.captions ?? [{ text: "A caption.", startMs: 0, endMs: 2000 }],
    sceneSeed: 7,
    sceneType: "explanation",
    conceptTitle: "A Concept",
    lessonTopic: "A Lesson",
    sceneIndex: 0,
    totalScenes: 2,
    visual: overrides.visual ?? null,
    onScreenText: "On-screen text.",
  });
}

describe("composeScenePage", () => {
  it("keeps narration containing </script> inside the inline frame-driver script", () => {
    const html = scenePage({ captions: [{ text: "Close the tag with </script> like this.", startMs: 0, endMs: 2000 }] });
    expect(html).not.toContain("</script> like this");
    expect(html).toContain("\\u003c/script>");
    expect(html).toContain("window.__renderFrame");
  });

  it("drives the reveal updater the visual's revealMode asks for", () => {
    const steps = scenePage({ visual: { html: "<div></div>", stepCount: 3, revealMode: "steps" } });
    expect(steps).toContain('var REVEAL_MODE = "steps"');

    const continuous = scenePage({ visual: { html: "<div></div>", stepCount: 1, revealMode: "continuous" } });
    expect(continuous).toContain('var REVEAL_MODE = "continuous"');
  });
});
