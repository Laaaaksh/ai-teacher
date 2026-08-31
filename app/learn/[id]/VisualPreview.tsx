"use client";

import { useEffect, useRef } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { VisualSpec } from "./types";

/**
 * A lightweight preview of a planned visual for the plan-review screen —
 * not the full renderer (lib/video/visuals/*.ts, which composes Mermaid/
 * Shiki/labelled-diagram content server-side for the actual video). KaTeX
 * content renders faithfully here since it's cheap and already a
 * dependency; everything else shows its rationale and caption plus a raw
 * preview, with the polished version appearing in the generated video.
 */
export function VisualPreview({ visual }: { visual: VisualSpec }) {
  const isMath = visual.renderer === "katex";

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-neutral-900 px-2.5 py-1 font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">
          {visual.kind}
        </span>
        <span className="text-neutral-400">via {visual.renderer}</span>
      </div>
      <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
        <span className="font-medium text-neutral-900 dark:text-neutral-50">Why this visual: </span>
        {visual.rationale}
      </p>

      {isMath ? (
        <KatexBlock latex={visual.content} />
      ) : (
        <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-xs text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
          {visual.content}
        </pre>
      )}
      {visual.caption && <p className="mt-2 text-xs italic text-neutral-500 dark:text-neutral-400">{visual.caption}</p>}
      {!isMath && <p className="mt-1 text-[11px] text-neutral-400">Full rendering appears in the teaching video.</p>}
    </div>
  );
}

function KatexBlock({ latex }: { latex: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    try {
      katex.render(latex, ref.current, { throwOnError: false, displayMode: true });
    } catch {
      if (ref.current) ref.current.textContent = latex;
    }
  }, [latex]);

  return <div ref={ref} className="mt-3 overflow-x-auto rounded bg-white p-3 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100" />;
}
