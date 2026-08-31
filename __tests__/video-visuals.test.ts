import { describe, expect, it } from "vitest";
import { renderBulletsVisual, renderComparisonTableVisual, renderImageVisual } from "../lib/video/visuals/bullets";
import { renderKatexVisual } from "../lib/video/visuals/katex";
import { renderLabelledDiagramVisual } from "../lib/video/visuals/labelledDiagram";
import { renderPlotterVisual } from "../lib/video/visuals/plotter";
import { renderShikiVisual } from "../lib/video/visuals/shiki";

describe("renderKatexVisual", () => {
  it("renders a single LaTeX string (non-JSON fallback) as one step", () => {
    const result = renderKatexVisual("E = mc^2");
    expect(result.stepCount).toBe(1);
    expect(result.html).toContain("katex");
    expect(result.css?.[0]?.name).toBe("katex");
  });

  it("renders a JSON array of steps as that many reveal steps, in order", () => {
    const result = renderKatexVisual(JSON.stringify(["a = 1", "b = 2", "c = a + b"]));
    expect(result.stepCount).toBe(3);
    expect(result.html.match(/data-step="0"/)).toBeTruthy();
    expect(result.html.match(/data-step="2"/)).toBeTruthy();
  });

  it("adds an extra final step labeled distinctly when {steps, final} is given", () => {
    const result = renderKatexVisual(JSON.stringify({ steps: ["x + 1 = 2"], final: "x = 1" }));
    expect(result.stepCount).toBe(2);
    expect(result.html).toContain("math-step-final");
    expect(result.html).toContain("Result");
  });

  it("inlines KaTeX fonts as data URIs so they render with no local server", () => {
    const result = renderKatexVisual("x");
    expect(result.css?.[0]?.content).toContain("data:font/woff2;base64,");
    expect(result.css?.[0]?.content).not.toContain("url(fonts/");
  });
});

describe("renderShikiVisual", () => {
  it("renders code as one step when there is no output", async () => {
    const result = await renderShikiVisual(JSON.stringify({ language: "python", code: "print(1)" }));
    expect(result.stepCount).toBe(1);
    expect(result.html).toContain("print");
  });

  it("adds an output step + execution-flow callout when output is present", async () => {
    const result = await renderShikiVisual(JSON.stringify({ language: "python", code: "print(1+1)", output: "2" }));
    expect(result.stepCount).toBe(2);
    expect(result.html).toContain("runs to");
    expect(result.html).toContain(">2<");
  });

  it("falls back to plain text for non-JSON content instead of throwing", async () => {
    const result = await renderShikiVisual("just some raw text");
    expect(result.stepCount).toBe(1);
    expect(result.html).toContain("just some raw text");
  });
});

describe("renderPlotterVisual", () => {
  it("plots a function via the safe expression evaluator", () => {
    const result = renderPlotterVisual(JSON.stringify({ fn: "x^2", xMin: -2, xMax: 2, samples: 4 }));
    expect(result.revealMode).toBe("continuous");
    expect(result.html).toContain("plot-line");
    expect(result.html).toContain("data-continuous-reveal");
  });

  it("plots explicit series with one reveal step per bar", () => {
    const result = renderPlotterVisual(
      JSON.stringify({ kind: "bar", series: [{ label: "s", points: [[0, 1], [1, 4], [2, 9]] }] }),
    );
    expect(result.stepCount).toBe(3);
    expect(result.revealMode).toBe("steps");
  });

  it("falls back to a placeholder rather than throwing on malformed JSON", () => {
    const result = renderPlotterVisual("not json");
    expect(result.html).toContain("not valid JSON");
  });

  it("falls back to a placeholder when the function expression is invalid", () => {
    const result = renderPlotterVisual(JSON.stringify({ fn: "x +" }));
    expect(result.html).toContain("Could not evaluate");
  });

  it("falls back to a placeholder for valid JSON of the wrong shape", () => {
    expect(renderPlotterVisual(JSON.stringify({ series: [{ label: "s" }] })).html).toContain("No plottable data");
    expect(renderPlotterVisual(JSON.stringify({ series: [{ points: [["a", "b"]] }] })).html).toContain("No plottable data");
    expect(renderPlotterVisual("null").html).toContain("not in the expected shape");
  });
});

describe("renderLabelledDiagramVisual", () => {
  it("gives each label its own reveal step", () => {
    const result = renderLabelledDiagramVisual(
      JSON.stringify({ title: "Cell", shape: "circle", labels: [{ text: "Nucleus", x: 50, y: 50 }, { text: "Membrane", x: 10, y: 10 }] }),
    );
    expect(result.stepCount).toBe(2);
    expect(result.html).toContain("Nucleus");
    expect(result.html).toContain("Membrane");
  });

  it("falls back to a placeholder for valid JSON of the wrong shape", () => {
    expect(renderLabelledDiagramVisual("null").html).toContain("not in the expected shape");
    expect(renderLabelledDiagramVisual(JSON.stringify({ labels: "nope" })).stepCount).toBe(1);
  });

  it("drops labels with no text and centres coordinates that are missing or out of range", () => {
    const result = renderLabelledDiagramVisual(JSON.stringify({ labels: [{ text: "Nucleus" }, { x: 10, y: 10 }] }));
    expect(result.stepCount).toBe(1);
    expect(result.html).toContain("Nucleus");
  });
});

describe("renderBulletsVisual / renderComparisonTableVisual / renderImageVisual", () => {
  it("bullets: one reveal step per bullet, from a JSON array", () => {
    const result = renderBulletsVisual(JSON.stringify(["first", "second", "third"]));
    expect(result.stepCount).toBe(3);
  });

  it("bullets: falls back to newline-splitting for plain text", () => {
    const result = renderBulletsVisual("first\nsecond\n\nthird");
    expect(result.stepCount).toBe(3);
  });

  it("comparison table: one reveal step per row", () => {
    const result = renderComparisonTableVisual(JSON.stringify({ headers: ["A", "B"], rows: [["1", "2"], ["3", "4"]] }));
    expect(result.stepCount).toBe(2);
    expect(result.html).toContain("<table>");
  });

  it("bullets: renders non-string JSON entries instead of throwing", () => {
    const result = renderBulletsVisual("[1,2,3]");
    expect(result.stepCount).toBe(3);
    expect(result.html).toContain(">1<");
  });

  it("comparison table: falls back to bullets when headers/rows are missing", () => {
    const result = renderComparisonTableVisual(JSON.stringify({ rows: [["a"]] }));
    expect(result.html).toContain("visual-bullets");
  });

  it("image: accepts a data URI and rejects anything else", () => {
    const good = renderImageVisual("data:image/png;base64,AAAA");
    expect(good.html).toContain("<img");

    const bad = renderImageVisual("not an image source");
    expect(bad.html).toContain("No image source");
  });
});
