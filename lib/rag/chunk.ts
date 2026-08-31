import type { DocumentChunk, ParsedDocument, ParsedSection } from "../documents/types";

/**
 * Retrieval-sized chunking for the RAG slice, and the only chunker the
 * upload route uses. It replaced the foundation's citation-preserving
 * chunker, differing from it in two ways this slice needs and that one
 * didn't have: chunks overlap across a semantic boundary (so a fact split across two
 * paragraphs is still fully present in at least one chunk), and multi-level
 * headings (DOCX/Markdown) are folded into a breadcrumb `section` string
 * ("Chapter 4 > Ohm's Law") instead of just the immediate heading, so a
 * citation is legible on its own without the reader needing the rest of the
 * document's structure.
 */

const DEFAULT_MAX_CHARS = 1000;
const DEFAULT_OVERLAP_CHARS = 150;

export interface ChunkOptions {
  /** Soft cap on a chunk's character length. */
  maxChars?: number;
  /** How much trailing text (by whole paragraph/piece) a chunk carries into the next one within the same section. */
  overlapChars?: number;
}

/**
 * Splits a single piece of text that is on its own longer than the budget,
 * breaking at the last whitespace inside the window rather than mid-word.
 * Extracted PDF text often has no blank lines, so a whole dense page can
 * arrive as one paragraph — without this a chunk could be many times the
 * embedding budget.
 */
function splitOversized(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let rest = text;

  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars + 1);
    const breakAt = window.lastIndexOf(" ");
    const cut = breakAt > 0 ? breakAt : maxChars;
    const piece = rest.slice(0, cut).trim();
    if (piece) pieces.push(piece);
    rest = rest.slice(cut).trimStart();
  }

  const tail = rest.trim();
  if (tail) pieces.push(tail);
  return pieces;
}

/**
 * Greedily packs semantic pieces (paragraphs, or oversized-paragraph
 * fragments) into chunks under maxChars, carrying whole trailing pieces
 * forward into the next chunk as overlap — never a mid-paragraph character
 * cut, so overlap never reintroduces a half-sentence.
 */
function packPieces(pieces: string[], maxChars: number, overlapChars: number): string[] {
  const out: string[] = [];
  let buffer: string[] = [];
  let bufferLen = 0;

  const flush = () => {
    if (buffer.length > 0) out.push(buffer.join("\n\n"));
  };

  for (const piece of pieces) {
    const addLen = piece.length + (buffer.length > 0 ? 2 : 0);

    if (buffer.length > 0 && bufferLen + addLen > maxChars) {
      flush();

      // Carry trailing whole pieces forward as overlap, most recent first,
      // until the overlap budget would be exceeded.
      const carried: string[] = [];
      let carriedLen = 0;
      for (let i = buffer.length - 1; i >= 0; i--) {
        const p = buffer[i];
        const withSep = p.length + (carried.length > 0 ? 2 : 0);
        if (carriedLen + withSep > overlapChars) break;
        carried.unshift(p);
        carriedLen += withSep;
      }
      buffer = carried;
      bufferLen = carried.reduce((sum, p, i) => sum + p.length + (i > 0 ? 2 : 0), 0);
    }

    buffer.push(piece);
    bufferLen += piece.length + (buffer.length > 1 ? 2 : 0);
  }
  flush();

  return out;
}

/** Maintains a stack of open headings by level so a heading's full breadcrumb path can be read off at any point. */
class HeadingStack {
  private stack: { level: number; title: string }[] = [];

  push(level: number, title: string): void {
    while (this.stack.length > 0 && this.stack[this.stack.length - 1].level >= level) this.stack.pop();
    this.stack.push({ level, title });
  }

  path(): string[] {
    return this.stack.map((f) => f.title);
  }
}

/**
 * Turns a parsed document into overlapping, citation-carrying chunks sized
 * for embedding/retrieval. A chunk never spans a section (so `page` stays
 * unambiguous), but text near a section boundary is duplicated into both
 * neighbouring chunks via overlap so a fact stated right at a paragraph
 * break is still whole in at least one chunk.
 */
export function chunkForRetrieval(doc: ParsedDocument, opts?: ChunkOptions): DocumentChunk[] {
  const maxChars = opts?.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = opts?.overlapChars ?? DEFAULT_OVERLAP_CHARS;

  const chunks: DocumentChunk[] = [];
  let order = 0;
  const headings = new HeadingStack();

  for (const section of doc.sections) {
    if (section.title && section.level !== undefined) headings.push(section.level, section.title);

    const breadcrumb = section.level !== undefined ? headings.path().join(" > ") : section.title;

    const pieces: string[] = [];
    for (const paragraph of section.paragraphs) {
      pieces.push(...splitOversized(paragraph.text, maxChars));
    }
    // An outline slide or a bare heading carries its only text in the
    // title; without this it would be dropped and never reach retrieval.
    if (pieces.length === 0 && section.title?.trim()) {
      pieces.push(section.title.trim());
    }
    if (pieces.length === 0) continue;

    for (const text of packPieces(pieces, maxChars, overlapChars)) {
      chunks.push({ order: order++, text, page: section.page, section: breadcrumb || undefined });
    }
  }

  return chunks;
}

export type { ParsedSection };
