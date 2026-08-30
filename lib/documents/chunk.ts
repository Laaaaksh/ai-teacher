import type { DocumentChunk, ParsedDocument } from "./types";

const DEFAULT_CHUNK_CHARS = 1000;

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

    for (const paragraph of section.paragraphs) {
      const candidate = buffer ? `${buffer}\n\n${paragraph.text}` : paragraph.text;
      if (candidate.length > maxChars && buffer) {
        flush();
        buffer = paragraph.text;
      } else {
        buffer = candidate;
      }
    }
    flush();
  }

  return chunks;
}
