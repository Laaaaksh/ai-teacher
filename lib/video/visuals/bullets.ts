import type { RenderedVisual } from "./types";

interface TableContent {
  headers: string[];
  rows: string[][];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Content contract for kind "bullets"/"concept-map" (renderer "html"): a
 * JSON string[] of bullet lines, or plain text with one bullet per
 * non-empty line as a fallback. Each bullet is its own reveal step.
 */
export function renderBulletsVisual(content: string, caption?: string): RenderedVisual {
  let items: string[];
  try {
    const parsed: unknown = JSON.parse(content);
    items = Array.isArray(parsed) ? (parsed as string[]) : content.split("\n").filter(Boolean);
  } catch {
    items = content.split("\n").filter((line) => line.trim().length > 0);
  }

  const html = `<div class="visual-bullets">
    <ul>
      ${items.map((item, i) => `<li class="reveal-step" data-step="${i}">${escapeHtml(item)}</li>`).join("\n")}
    </ul>
    ${caption ? `<p class="visual-caption">${escapeHtml(caption)}</p>` : ""}
  </div>`;

  return { html, stepCount: Math.max(1, items.length), revealMode: "steps" };
}

/** Content contract for kind "comparison-table" (renderer "html"): `{ headers: string[], rows: string[][] }`. Rows reveal one at a time. */
export function renderComparisonTableVisual(content: string, caption?: string): RenderedVisual {
  let parsed: TableContent;
  try {
    parsed = JSON.parse(content) as TableContent;
  } catch {
    return renderBulletsVisual(content, caption);
  }

  const html = `<div class="visual-table">
    <table>
      <thead><tr>${parsed.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
      <tbody>
        ${parsed.rows
          .map((row, i) => `<tr class="reveal-step" data-step="${i}">${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
          .join("\n")}
      </tbody>
    </table>
    ${caption ? `<p class="visual-caption">${escapeHtml(caption)}</p>` : ""}
  </div>`;

  return { html, stepCount: Math.max(1, parsed.rows.length), revealMode: "steps" };
}

/**
 * Content contract for kind "image" (renderer "image"): a `data:image/...`
 * or `http(s)://` URL — e.g. an image lifted from a parsed PPTX/PDF slide by
 * the RAG/documents slice. There is no image-generation credential, so this
 * renderer only ever displays material the lesson actually cites.
 */
export function renderImageVisual(content: string, caption?: string): RenderedVisual {
  const isUsable = content.startsWith("data:image") || content.startsWith("http://") || content.startsWith("https://");
  if (!isUsable) {
    return { html: `<div class="visual-diagram-error">No image source provided.</div>`, stepCount: 1, revealMode: "fade" };
  }
  return {
    html: `<div class="visual-image"><img src="${content.replace(/"/g, "&quot;")}" alt="${escapeHtml(caption ?? "")}"/>${
      caption ? `<p class="visual-caption">${escapeHtml(caption)}</p>` : ""
    }</div>`,
    stepCount: 1,
    revealMode: "fade",
  };
}
