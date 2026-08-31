/** What compose.ts's client-side runtime does with a rendered visual's progressive-reveal markup. */
export type RevealMode =
  /** `.reveal-step[data-step]` elements appear one by one, evenly spaced across the scene duration. */
  | "steps"
  /** Elements with `[data-draw-length]` (SVG paths) get their stroke drawn on continuously as the scene plays. */
  | "continuous"
  /** The whole visual fades/scales in once near the start of the scene; used for diagrams meant to be read as a whole. */
  | "fade";

export interface RenderedVisual {
  /** Inner HTML of the visual panel (no outer <html>/<body>). */
  html: string;
  /** Extra CSS blocks to inline once per page, deduped by `name`. */
  css?: { name: string; content: string }[];
  /** Number of `.reveal-step` elements; only meaningful when revealMode is "steps". */
  stepCount: number;
  revealMode: RevealMode;
}
