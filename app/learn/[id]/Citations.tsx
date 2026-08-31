"use client";

import { useState } from "react";
import type { Citation } from "./types";

/**
 * Renders a claim's citations and lets the student open the full source
 * passage — a Citation only carries a 240-char excerpt, so "open" fetches
 * the chunk's full text (GET /api/documents/[id]/chunks/[chunkId]).
 */
export function CitationList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Grounded in your material</p>
      {citations.map((c) => (
        <CitationCard key={c.chunkId} citation={c} />
      ))}
    </div>
  );
}

function CitationCard({ citation }: { citation: Citation }) {
  const [expanded, setExpanded] = useState(false);
  const [fullText, setFullText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function openSource() {
    setExpanded((prev) => !prev);
    if (fullText || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/documents/${citation.documentId}/chunks/${citation.chunkId}`);
      const data = await res.json();
      setFullText(res.ok ? data.chunk.text : "Couldn't load the source passage.");
    } catch {
      setFullText("Couldn't load the source passage.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded bg-neutral-50 p-2 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
      <div className="flex items-start justify-between gap-2">
        <p>
          <span className="font-medium">{citation.section ?? (citation.page ? `Page ${citation.page}` : "Source")}:</span> {citation.excerpt}
        </p>
        <button type="button" onClick={openSource} className="shrink-0 text-neutral-500 underline hover:text-neutral-900 dark:hover:text-neutral-100">
          {expanded ? "Hide" : "Open source"}
        </button>
      </div>
      {expanded && (
        <p className="mt-2 whitespace-pre-wrap rounded border border-neutral-200 bg-white p-2 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
          {loading ? "Loading…" : fullText}
        </p>
      )}
    </div>
  );
}

/** For an answer that wasn't grounded — the honest "outside your material" disclaimer, surfaced rather than hidden. */
export function UngroundedNotice() {
  return (
    <p className="mt-2 text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
      Not from your uploaded material — general knowledge
    </p>
  );
}
