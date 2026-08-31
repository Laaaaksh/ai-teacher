import { asDisplayText, escapeHtml } from "../html";
import type { RenderedVisual } from "./types";

interface TableContent {
  headers: string[];
  rows: string[][];
}

function textLines(content: string): string[] {
  return content.split("\n").filter((line) => line.trim().length > 0);
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
    const entries = Array.isArray(parsed) ? parsed.map(asDisplayText).filter((item): item is string => item !== null) : [];
    items = entries.length > 0 ? entries : textLines(content);
  } catch {
    items = textLines(content);
  }

  const html = `<div class="visual-bullets">
    <ul>
      ${items.map((item, i) => `<li class="reveal-step" data-step="${i}">${escapeHtml(item)}</li>`).join("\n")}
    </ul>
    ${caption ? `<p class="visual-caption">${escapeHtml(caption)}</p>` : ""}
  </div>`;

  return { html, stepCount: Math.max(1, items.length), revealMode: "steps" };
}

/** LLM-authored content reaches here as arbitrary JSON, so the {headers, rows} shape is checked rather than assumed; anything else falls back to the bullet renderer. */
function coerceTable(value: unknown): TableContent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { headers, rows } = value as { headers?: unknown; rows?: unknown };
  if (!Array.isArray(headers) || !Array.isArray(rows)) return null;

  const cells = rows.filter(Array.isArray).map((row) => (row as unknown[]).map((cell) => asDisplayText(cell) ?? ""));
  return { headers: headers.map((header) => asDisplayText(header) ?? ""), rows: cells };
}

/** Content contract for kind "comparison-table" (renderer "html"): `{ headers: string[], rows: string[][] }`. Rows reveal one at a time. */
export function renderComparisonTableVisual(content: string, caption?: string): RenderedVisual {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return renderBulletsVisual(content, caption);
  }

  const parsed = coerceTable(raw);
  if (!parsed) return renderBulletsVisual(content, caption);

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
 * or `http(s)://` URL. Nothing reaches this renderer today — no
 * SUBJECT_VISUAL_RULES entry selects it and no lib/documents parser extracts
 * images from an upload — and there is no image-generation credential, so it
 * stays a display-only path for material a lesson actually cites (see
 * docs/VIDEO.md's known limitations).
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
