import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { escapeHtml } from "../html";
import type { RenderedVisual } from "./types";

let cachedBundle: string | undefined;
function mermaidBundle(): string {
  if (!cachedBundle) cachedBundle = fs.readFileSync(path.join(process.cwd(), "node_modules", "mermaid", "dist", "mermaid.min.js"), "utf8");
  return cachedBundle;
}

/**
 * Renders Mermaid source to an inline SVG string using a scratch Playwright
 * page (mermaid needs a real DOM — there is no Node-only renderer). The
 * bundle is inlined as a classic `<script>` so this works via
 * `page.setContent()` with no local HTTP server or network access.
 */
export async function renderMermaidSvg(source: string, page: Page): Promise<string> {
  // Derived from the source, not a counter: the id ends up inside the emitted
  // SVG, and render.ts caches a scene by the hash of its composed page — a
  // per-process counter would make an unchanged scene miss its cache.
  const id = `mmd-${createHash("sha256").update(source).digest("hex").slice(0, 12)}`;
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
 * The model writes markdown emphasis into node labels (`X[a **gap**]`) no
 * matter what the prompt says, and Mermaid either renders the asterisks
 * literally or, combined with other label syntax, fails to lex the line at
 * all — so the emphasis is stripped in code rather than asked for in a prompt.
 */
export function stripMarkdownEmphasis(source: string): string {
  return source
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1");
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
    svg = await renderMermaidSvg(stripMarkdownEmphasis(source), page);
  } catch (err) {
    // A parse failure must never reach the frame: render.ts bakes this HTML
    // into the MP4, so the message would be a stack trace the student watches.
    // The caption carries the scene's real content instead, and the error is
    // only logged server-side.
    console.error("[video] Mermaid render failed; falling back to a caption panel:", err);
    return {
      html: caption
        ? `<div class="visual-diagram visual-diagram-fallback"><p class="visual-fallback-text">${escapeHtml(caption)}</p></div>`
        : `<div class="visual-diagram visual-diagram-fallback"></div>`,
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
