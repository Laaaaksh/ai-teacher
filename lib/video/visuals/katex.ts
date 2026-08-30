import katex from "katex";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { RenderedVisual } from "./types";

const require = createRequire(import.meta.url);

const FONT_MIME: Record<string, string> = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf" };

/**
 * katex.min.css references its fonts as relative `url(fonts/...)` paths,
 * which don't resolve when the CSS is inlined into a page loaded via
 * page.setContent() (no base URL). Inlined once as base64 data URIs so
 * every glyph (integrals, sums, fractions) renders correctly with no local
 * HTTP server required.
 */
let cachedCss: string | undefined;
function katexCss(): string {
  if (cachedCss) return cachedCss;

  const cssPath = require.resolve("katex/dist/katex.min.css");
  const cssDir = path.dirname(cssPath);
  const raw = fs.readFileSync(cssPath, "utf8");

  cachedCss = raw.replace(/url\((fonts\/[^)]+)\)/g, (_match, rel: string) => {
    const ext = rel.split(".").pop()!;
    const mime = FONT_MIME[ext] ?? "application/octet-stream";
    const bytes = fs.readFileSync(path.join(cssDir, rel));
    return `url(data:${mime};base64,${bytes.toString("base64")})`;
  });

  return cachedCss;
}

/**
 * Content contract for kind "equation"/"step-by-step" (renderer "katex"):
 *   - a JSON array of LaTeX strings, one per reveal step, or
 *   - `{ "steps": string[], "final"?: string }`, or
 *   - a single raw LaTeX string (rendered as one step) as a fallback so a
 *     planner that hasn't adopted the JSON contract yet still renders.
 */
function parseSteps(content: string): { steps: string[]; final?: string } {
  try {
    const parsed: unknown = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return { steps: parsed as string[] };
    }
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { steps?: unknown }).steps)) {
      const obj = parsed as { steps: string[]; final?: string };
      return { steps: obj.steps, final: obj.final };
    }
  } catch {
    // not JSON — fall through to treating the whole string as one LaTeX expression
  }
  return { steps: [content] };
}

export function renderKatexVisual(content: string, caption?: string): RenderedVisual {
  const { steps, final } = parseSteps(content);
  const allSteps = final ? [...steps, final] : steps;

  const stepsHtml = allSteps
    .map((latex, i) => {
      const rendered = katex.renderToString(latex, { throwOnError: false, displayMode: true });
      const isFinal = final !== undefined && i === allSteps.length - 1;
      return `<div class="reveal-step math-step${isFinal ? " math-step-final" : ""}" data-step="${i}">
        ${allSteps.length > 1 ? `<span class="math-step-label">${isFinal ? "Result" : `Step ${i + 1}`}</span>` : ""}
        ${rendered}
      </div>`;
    })
    .join("\n");

  return {
    html: `<div class="visual-math">${stepsHtml}${caption ? `<p class="visual-caption">${escapeHtml(caption)}</p>` : ""}</div>`,
    css: [{ name: "katex", content: katexCss() }],
    stepCount: allSteps.length,
    revealMode: "steps",
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
