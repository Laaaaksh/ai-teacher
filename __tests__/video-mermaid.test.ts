import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderMermaidVisual, stripMarkdownEmphasis } from "../lib/video/visuals/mermaid";

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

  it("strips markdown emphasis the model writes into node labels rather than letting the lexer reject it", async () => {
    expect(stripMarkdownEmphasis("flowchart TD; X[बीच में **गैप**] --> Y[*तार* और `wire`];")).toBe("flowchart TD; X[बीच में गैप] --> Y[तार और wire];");

    const result = await renderMermaidVisual("flowchart TD; A[a **gap**] --> B[the `wire`];", page);
    expect(result.html).toContain("<svg");
  });

  it("falls back to the caption instead of baking the parser error into the frame", async () => {
    const result = await renderMermaidVisual("this is not a valid diagram $$$", page, "A broken circuit stops the current");
    expect(result.html).toContain("A broken circuit stops the current");
    expect(result.html).not.toMatch(/could not be rendered|Lexical error|Parse error|at Parser/i);
  });

  it("falls back to a neutral panel with no error text when the scene has no caption", async () => {
    const result = await renderMermaidVisual("this is not a valid diagram $$$", page);
    expect(result.html).toBe(`<div class="visual-diagram visual-diagram-fallback"></div>`);
  });
});
