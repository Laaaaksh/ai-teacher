import { compileExpression } from "./expr";
import type { RenderedVisual } from "./types";

interface SeriesSpec {
  label?: string;
  points: [number, number][];
}

interface PlotContent {
  fn?: string;
  xMin?: number;
  xMax?: number;
  samples?: number;
  series?: SeriesSpec[];
  xLabel?: string;
  yLabel?: string;
  kind?: "line" | "scatter" | "bar";
}

const WIDTH = 620;
const HEIGHT = 380;
const MARGIN = { top: 24, right: 24, bottom: 48, left: 56 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

const PALETTE = ["#4f8ff7", "#f2994a", "#6fcf97", "#bb6bd9"];

/**
 * Content contract for kind "graph" (renderer "plotter"): JSON matching
 * PlotContent above — either `fn` (a single-variable expression, evaluated
 * with the safe evaluator in expr.ts, never `eval`) over [xMin, xMax], or
 * explicit `series` of points. Falls back to a "could not plot" note rather
 * than throwing, since a malformed spec shouldn't crash the whole render.
 */
export function renderPlotterVisual(content: string, caption?: string): RenderedVisual {
  let parsed: PlotContent;
  try {
    parsed = JSON.parse(content) as PlotContent;
  } catch {
    return placeholder("Graph data was not valid JSON.", caption);
  }

  const series: SeriesSpec[] = [];
  if (parsed.fn) {
    try {
      const f = compileExpression(parsed.fn);
      const xMin = parsed.xMin ?? -10;
      const xMax = parsed.xMax ?? 10;
      const samples = Math.max(2, parsed.samples ?? 60);
      const points: [number, number][] = [];
      for (let i = 0; i <= samples; i++) {
        const x = xMin + (i / samples) * (xMax - xMin);
        const y = f(x);
        if (Number.isFinite(y)) points.push([x, y]);
      }
      series.push({ label: parsed.fn, points });
    } catch (err) {
      return placeholder(`Could not evaluate function: ${(err as Error).message}`, caption);
    }
  }
  if (parsed.series) series.push(...parsed.series);

  if (series.length === 0 || series.every((s) => s.points.length === 0)) {
    return placeholder("No plottable data.", caption);
  }

  const allPoints = series.flatMap((s) => s.points);
  const xs = allPoints.map((p) => p[0]);
  const ys = allPoints.map((p) => p[1]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(...ys);

  const sx = (x: number) => MARGIN.left + ((x - xMin) / (xMax - xMin || 1)) * PLOT_W;
  const sy = (y: number) => MARGIN.top + PLOT_H - ((y - yMin) / (yMax - yMin || 1)) * PLOT_H;

  const gridLines: string[] = [];
  for (let i = 0; i <= 5; i++) {
    const gy = MARGIN.top + (i / 5) * PLOT_H;
    const value = yMax - (i / 5) * (yMax - yMin);
    gridLines.push(
      `<line x1="${MARGIN.left}" y1="${gy}" x2="${WIDTH - MARGIN.right}" y2="${gy}" stroke="#2a2f3a" stroke-width="1"/>`,
      `<text x="${MARGIN.left - 8}" y="${gy + 4}" text-anchor="end" font-size="11" fill="#9aa4b2">${value.toFixed(1)}</text>`,
    );
  }
  for (let i = 0; i <= 5; i++) {
    const gx = MARGIN.left + (i / 5) * PLOT_W;
    const value = xMin + (i / 5) * (xMax - xMin);
    gridLines.push(`<text x="${gx}" y="${HEIGHT - MARGIN.bottom + 18}" text-anchor="middle" font-size="11" fill="#9aa4b2">${value.toFixed(1)}</text>`);
  }

  const seriesHtml = series
    .map((s, i) => {
      const color = PALETTE[i % PALETTE.length];
      if (parsed.kind === "bar") {
        const barWidth = PLOT_W / s.points.length / 1.6;
        return s.points
          .map(([x, y], idx) => {
            const barX = sx(x) - barWidth / 2;
            const barY = sy(Math.max(0, y));
            const barH = Math.abs(sy(0) - sy(y));
            return `<rect class="reveal-step" data-step="${idx}" x="${barX}" y="${barY}" width="${barWidth}" height="${barH}" fill="${color}" />`;
          })
          .join("");
      }
      if (parsed.kind === "scatter") {
        return s.points
          .map(([x, y], idx) => `<circle class="reveal-step" data-step="${idx}" cx="${sx(x)}" cy="${sy(y)}" r="4" fill="${color}"/>`)
          .join("");
      }
      const d = s.points.map(([x, y], idx) => `${idx === 0 ? "M" : "L"}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join(" ");
      return `<path class="plot-line" data-continuous-reveal="true" d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`;
    })
    .join("\n");

  const legend =
    series.length > 1
      ? `<div class="plot-legend">${series
          .map((s, i) => `<span><i style="background:${PALETTE[i % PALETTE.length]}"></i>${escapeHtml(s.label ?? `series ${i + 1}`)}</span>`)
          .join("")}</div>`
      : "";

  const barOrScatterSteps = parsed.kind === "bar" || parsed.kind === "scatter" ? Math.max(...series.map((s) => s.points.length)) : 1;

  return {
    html: `<div class="visual-plot">
      <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" class="plot-svg">
        ${gridLines.join("\n")}
        <line x1="${MARGIN.left}" y1="${MARGIN.top}" x2="${MARGIN.left}" y2="${HEIGHT - MARGIN.bottom}" stroke="#5a6472" stroke-width="1.5"/>
        <line x1="${MARGIN.left}" y1="${HEIGHT - MARGIN.bottom}" x2="${WIDTH - MARGIN.right}" y2="${HEIGHT - MARGIN.bottom}" stroke="#5a6472" stroke-width="1.5"/>
        ${seriesHtml}
        ${parsed.xLabel ? `<text x="${WIDTH / 2}" y="${HEIGHT - 8}" text-anchor="middle" font-size="12" fill="#c7ccd4">${escapeHtml(parsed.xLabel)}</text>` : ""}
        ${parsed.yLabel ? `<text x="14" y="${HEIGHT / 2}" text-anchor="middle" font-size="12" fill="#c7ccd4" transform="rotate(-90 14 ${HEIGHT / 2})">${escapeHtml(parsed.yLabel)}</text>` : ""}
      </svg>
      ${legend}
      ${caption ? `<p class="visual-caption">${escapeHtml(caption)}</p>` : ""}
    </div>`,
    stepCount: barOrScatterSteps,
    revealMode: parsed.kind === "bar" || parsed.kind === "scatter" ? "steps" : "continuous",
  };
}

function placeholder(message: string, caption?: string): RenderedVisual {
  return {
    html: `<div class="visual-plot visual-plot-error"><p>${escapeHtml(message)}</p>${caption ? `<p class="visual-caption">${escapeHtml(caption)}</p>` : ""}</div>`,
    stepCount: 1,
    revealMode: "fade",
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
