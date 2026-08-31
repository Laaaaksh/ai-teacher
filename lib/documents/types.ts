/**
 * Structure-preserving output of document parsing: document -> sections ->
 * paragraphs. This is deliberately format-agnostic so the planner and the
 * RAG slice don't need to know whether material came from a PDF, DOCX,
 * PPTX, or plain text — they just need citable locations.
 *
 * - PDF: one section per page (page number set, title usually unset).
 * - DOCX: one section per heading (h1/h2/h3); title is the heading text.
 * - PPTX: one section per slide; title is the slide's title placeholder, if any.
 * - TXT: a single section; paragraphs split on blank lines.
 * - Markdown: one section per heading; title is the heading text.
 */

export type DocumentFormat = "pdf" | "docx" | "pptx" | "txt" | "md";

export interface ParsedParagraph {
  order: number;
  text: string;
}

export interface ParsedSection {
  order: number;
  /** Heading/slide-title text, when the format has one. */
  title?: string;
  /** Heading depth (1 = h1/top-level), when the format has real heading levels (DOCX, Markdown). Unset for PDF pages and PPTX slides, which are flat. */
  level?: number;
  /** 1-indexed page number (PDF) or slide number (PPTX). */
  page?: number;
  paragraphs: ParsedParagraph[];
}

export interface ParsedDocument {
  format: DocumentFormat;
  /** Best-effort document title (filename fallback if none found in the content). */
  title: string;
  sections: ParsedSection[];
  /** Total pages (PDF) or slides (PPTX). */
  pageCount?: number;
}

/** A chunk of a parsed document sized for embedding/retrieval, carrying enough location info to cite. */
export interface DocumentChunk {
  order: number;
  text: string;
  page?: number;
  section?: string;
}

export const SUPPORTED_EXTENSIONS = ["pdf", "docx", "pptx", "txt", "md", "markdown"] as const;
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

export function formatFromExtension(ext: SupportedExtension): DocumentFormat {
  if (ext === "markdown") return "md";
  return ext as DocumentFormat;
}
