import { codeToHtml } from "shiki";
import type { RenderedVisual } from "./types";

const SUPPORTED_LANGS = new Set([
  "javascript",
  "typescript",
  "python",
  "java",
  "c",
  "cpp",
  "csharp",
  "go",
  "rust",
  "html",
  "css",
  "sql",
  "bash",
  "json",
]);

interface ShikiContent {
  language?: string;
  code: string;
  /** What the snippet produces when run — shown as an execution-flow callout below the code. */
  output?: string;
}

/**
 * Content contract for kind "code" (renderer "shiki"):
 *   `{ "language": "python", "code": "...", "output"?: "..." }`.
 * A non-JSON string falls back to plain code with language "text" so
 * unstructured input still renders instead of throwing.
 */
function parseContent(content: string): ShikiContent {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === "object" && typeof (parsed as { code?: unknown }).code === "string") {
      return parsed as ShikiContent;
    }
  } catch {
    // not JSON
  }
  return { code: content };
}

export async function renderShikiVisual(content: string, caption?: string): Promise<RenderedVisual> {
  const parsed = parseContent(content);
  const lang = parsed.language && SUPPORTED_LANGS.has(parsed.language) ? parsed.language : "text";

  const codeHtml = await codeToHtml(parsed.code, { lang, theme: "github-dark" });

  const outputHtml = parsed.output
    ? `<div class="reveal-step code-output" data-step="1">
        <div class="code-output-arrow">&darr; runs to</div>
        <pre class="code-output-pane">${escapeHtml(parsed.output)}</pre>
      </div>`
    : "";

  return {
    html: `<div class="visual-code">
      <div class="reveal-step" data-step="0">${codeHtml}</div>
      ${outputHtml}
      ${caption ? `<p class="visual-caption">${escapeHtml(caption)}</p>` : ""}
    </div>`,
    stepCount: parsed.output ? 2 : 1,
    revealMode: "steps",
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
