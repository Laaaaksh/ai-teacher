import type { DocumentChunk, ParsedDocument } from "./types";

const DEFAULT_CHUNK_CHARS = 1000;

/**
 * Splits a paragraph that is on its own longer than the budget. Extracted PDF
 * text often has no blank lines, so a whole dense page can arrive as a single
 * paragraph; without this a chunk could be many times the embedding budget.
 * Breaks on the last whitespace inside the window, falling back to a hard cut.
 */
function splitOversizedParagraph(text: string, maxChars: number): string[] {
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
 * Turns a parsed document into chunks sized for embedding/retrieval.
 * Chunks never span sections, so every chunk keeps one unambiguous
 * page/section citation — required for the RAG slice's grounding.
 */
export function chunkDocument(doc: ParsedDocument, maxChars: number = DEFAULT_CHUNK_CHARS): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let order = 0;

  for (const section of doc.sections) {
    let buffer = "";

    const flush = () => {
      const text = buffer.trim();
      if (text) {
        chunks.push({ order: order++, text, page: section.page, section: section.title });
      }
      buffer = "";
    };

    // An outline slide or a bare heading carries its only text in the title;
    // without this it would be dropped and never reach retrieval.
    if (section.paragraphs.length === 0 && section.title?.trim()) {
      buffer = section.title.trim();
    }

    for (const paragraph of section.paragraphs) {
      for (const piece of splitOversizedParagraph(paragraph.text, maxChars)) {
        const candidate = buffer ? `${buffer}\n\n${piece}` : piece;
        if (candidate.length > maxChars && buffer) {
          flush();
          buffer = piece;
        } else {
          buffer = candidate;
        }
      }
    }
    flush();
  }

  return chunks;
}
