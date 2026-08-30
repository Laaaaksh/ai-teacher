import { describe, expect, it } from "vitest";
import { buildCaptionCues } from "../lib/video/captions";

describe("buildCaptionCues", () => {
  it("chunks narration into ~8-word cues spanning the full duration", () => {
    const narration = Array.from({ length: 24 }, (_, i) => `word${i}`).join(" ");
    const cues = buildCaptionCues(narration, 12);

    expect(cues).toHaveLength(3);
    expect(cues[0].startMs).toBe(0);
    expect(cues[cues.length - 1].endMs).toBe(12000);
    cues.forEach((cue, i) => {
      if (i > 0) expect(cue.startMs).toBe(cues[i - 1].endMs);
    });
  });

  it("returns no cues for empty narration", () => {
    expect(buildCaptionCues("   ", 10)).toEqual([]);
  });

  it("handles narration shorter than one chunk as a single cue spanning the whole duration", () => {
    const cues = buildCaptionCues("just a few words here", 5);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ startMs: 0, endMs: 5000, text: "just a few words here" });
  });
});
