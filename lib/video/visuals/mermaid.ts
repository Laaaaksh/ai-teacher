import fs from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "playwright";
import type { RenderedVisual } from "./types";

const require = createRequire(import.meta.url);

let cachedBundle: string | undefined;
function mermaidBundle(): string {
  if (!cachedBundle) cachedBundle = fs.readFileSync(require.resolve("mermaid/dist/mermaid.min.js"), "utf8");
  return cachedBundle;
}

let diagramCounter = 0;

/**
 * Renders Mermaid source to an inline SVG string using a scratch Playwright
 * page (mermaid needs a real DOM — there is no Node-only renderer). The
 * bundle is inlined as a classic `<script>` so this works via
 * `page.setContent()` with no local HTTP server or network access.
 */
export async function renderMermaidSvg(source: string, page: Page): Promise<string> {
  const id = `mmd-${++diagramCounter}`;
  await page.setContent(`<!doctype html><html><body><script>${mermaidBundle()}</script></body></html>`, { waitUntil: "load" });

  interface MermaidGlobal {
    mermaid: {
      initialize: (opts: { startOnLoad: boolean; theme: string; fontFamily: string }) => void;
      render: (id: string, source: string) => Promise<{ svg: string }>;
    };
  }

  const svg = await page.evaluate(
    async ({ id, source }) => {
      const mermaid = (window as unknown as MermaidGlobal).mermaid;
      mermaid.initialize({ startOnLoad: false, theme: "dark", fontFamily: "system-ui, sans-serif" });
      const { svg } = await mermaid.render(id, source);
      return svg;
    },
    { id, source },
  );

  return svg;
}

/**
 * Content contract for kinds "diagram"/"timeline"/"architecture-diagram"
 * (renderer "mermaid"): raw Mermaid diagram source — Mermaid's own syntax,
 * unambiguous, so no extra JSON wrapping. Diagrams are revealed as a single
 * considered fade/scale-in rather than node-by-node: Mermaid's DOM shape
 * differs enough per diagram type (flowchart vs timeline vs sequence) that
 * reliable per-node staggering isn't worth the fragility (documented in
 * docs/VIDEO.md).
 */
export async function renderMermaidVisual(source: string, page: Page, caption?: string): Promise<RenderedVisual> {
  let svg: string;
  try {
    svg = await renderMermaidSvg(source, page);
  } catch (err) {
    return {
      html: `<div class="visual-diagram-error">Diagram could not be rendered: ${(err as Error).message}</div>`,
      stepCount: 1,
      revealMode: "fade",
    };
  }

  return {
    html: `<div class="visual-diagram visual-diagram-mermaid">${svg}${caption ? `<p class="visual-caption">${escapeHtml(caption)}</p>` : ""}</div>`,
    stepCount: 1,
    revealMode: "fade",
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
