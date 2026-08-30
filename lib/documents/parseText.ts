import type { ParsedDocument } from "./types";

/** Parses plain text as a single section, with paragraphs split on blank lines. */
export function parseText(text: string, title: string): ParsedDocument {
  const paragraphs = text
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0)
    .map((paragraphText, order) => ({ order, text: paragraphText }));

  return {
    format: "txt",
    title,
    sections: [{ order: 0, paragraphs }],
  };
}
