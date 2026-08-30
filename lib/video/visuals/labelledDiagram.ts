import type { RenderedVisual } from "./types";

interface Label {
  text: string;
  /** 0-100, percentage position within the diagram frame. */
  x: number;
  y: number;
}

interface LabelledDiagramContent {
  title?: string;
  /** Coarse background shape the labels point at — there is no image-generation credential, so this is a generic schematic, not real illustrative art (see docs/VIDEO.md known limitations). */
  shape?: "blob" | "rect" | "circle" | "none";
  labels: Label[];
}

const WIDTH = 560;
const HEIGHT = 400;

/**
 * Content contract for kind "labelled-diagram" (renderer "svg"): JSON
 * matching LabelledDiagramContent. Each label gets a leader line into the
 * shape and appears as its own reveal step, timed with the narration
 * calling it out.
 */
export function renderLabelledDiagramVisual(content: string, caption?: string): RenderedVisual {
  let parsed: LabelledDiagramContent;
  try {
    parsed = JSON.parse(content) as LabelledDiagramContent;
  } catch {
    return { html: `<div class="visual-diagram-error">Diagram data was not valid JSON.</div>`, stepCount: 1, revealMode: "fade" };
  }

  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const shape = parsed.shape ?? "blob";
  const shapeSvg =
    shape === "none"
      ? ""
      : shape === "rect"
        ? `<rect x="${cx - 130}" y="${cy - 90}" width="260" height="180" rx="14" fill="#2b3444" stroke="#4f8ff7" stroke-width="2"/>`
        : shape === "circle"
          ? `<circle cx="${cx}" cy="${cy}" r="130" fill="#2b3444" stroke="#4f8ff7" stroke-width="2"/>`
          : `<path d="M${cx - 140} ${cy} Q${cx - 120} ${cy - 130} ${cx} ${cy - 110} Q${cx + 150} ${cy - 90} ${cx + 130} ${cy + 10} Q${cx + 110} ${cy + 130} ${cx - 20} ${cy + 120} Q${cx - 160} ${cy + 110} ${cx - 140} ${cy} Z" fill="#2b3444" stroke="#4f8ff7" stroke-width="2"/>`;

  const labelsHtml = parsed.labels
    .map((label, i) => {
      const px = (label.x / 100) * WIDTH;
      const py = (label.y / 100) * HEIGHT;
      const outX = px < cx ? px - 90 : px + 90;
      const outY = py < 50 ? 24 : py > HEIGHT - 50 ? HEIGHT - 24 : py;
      return `<g class="reveal-step diagram-label" data-step="${i}">
        <line x1="${px}" y1="${py}" x2="${outX}" y2="${outY}" stroke="#e8b13a" stroke-width="1.5"/>
        <circle cx="${px}" cy="${py}" r="4" fill="#e8b13a"/>
        <text x="${outX}" y="${outY}" text-anchor="${px < cx ? "end" : "start"}" font-size="14" fill="#f1f3f6" dx="${px < cx ? -6 : 6}">${escapeHtml(label.text)}</text>
      </g>`;
    })
    .join("\n");

  return {
    html: `<div class="visual-diagram">
      ${parsed.title ? `<h3 class="visual-diagram-title">${escapeHtml(parsed.title)}</h3>` : ""}
      <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" class="diagram-svg">
        ${shapeSvg}
        ${labelsHtml}
      </svg>
      ${caption ? `<p class="visual-caption">${escapeHtml(caption)}</p>` : ""}
    </div>`,
    stepCount: Math.max(1, parsed.labels.length),
    revealMode: "steps",
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
