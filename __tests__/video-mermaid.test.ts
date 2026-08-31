import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderMermaidVisual } from "../lib/video/visuals/mermaid";

describe("renderMermaidVisual", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  it("renders real Mermaid source to an inline SVG via a real headless browser (no CDN/network access)", async () => {
    const result = await renderMermaidVisual("flowchart TD; A[Start] --> B[End];", page);
    expect(result.html).toContain("<svg");
    expect(result.stepCount).toBe(1);
    expect(result.revealMode).toBe("fade");
  });

  it("falls back to an inline error message for invalid Mermaid source instead of throwing", async () => {
    const result = await renderMermaidVisual("this is not a valid diagram $$$", page);
    expect(result.html).toContain("could not be rendered");
  });
});
