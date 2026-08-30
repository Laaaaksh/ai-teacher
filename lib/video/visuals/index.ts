import type { Page } from "playwright";
import type { VisualSpec } from "../../types";
import { renderBulletsVisual, renderComparisonTableVisual, renderImageVisual } from "./bullets";
import { renderKatexVisual } from "./katex";
import { renderLabelledDiagramVisual } from "./labelledDiagram";
import { renderMermaidVisual } from "./mermaid";
import { renderPlotterVisual } from "./plotter";
import { renderShikiVisual } from "./shiki";
import type { RenderedVisual } from "./types";

export type { RenderedVisual, RevealMode } from "./types";

/**
 * Dispatches a VisualSpec to its renderer. `page` is only used by the
 * mermaid renderer (it needs a real DOM); every other renderer runs in pure
 * Node. See docs/VIDEO.md for the per-renderer content-format contract.
 */
export async function renderVisual(visual: VisualSpec, page: Page): Promise<RenderedVisual> {
  switch (visual.renderer) {
    case "katex":
      return renderKatexVisual(visual.content, visual.caption);
    case "shiki":
      return renderShikiVisual(visual.content, visual.caption);
    case "plotter":
      return renderPlotterVisual(visual.content, visual.caption);
    case "mermaid":
      return renderMermaidVisual(visual.content, page, visual.caption);
    case "svg":
      return renderLabelledDiagramVisual(visual.content, visual.caption);
    case "image":
      return renderImageVisual(visual.content, visual.caption);
    case "html":
      return visual.kind === "comparison-table" ? renderComparisonTableVisual(visual.content, visual.caption) : renderBulletsVisual(visual.content, visual.caption);
  }
}
