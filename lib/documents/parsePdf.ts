import { PDFParse } from "pdf-parse";
import type { ParsedDocument, ParsedParagraph, ParsedSection } from "./types";

function splitParagraphs(pageText: string): ParsedParagraph[] {
  return pageText
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0)
    .map((text, order) => ({ order, text }));
}

/**
 * Parses a PDF into one section per page. A 300-page textbook is handled by
 * asking pdf-parse for text page-by-page (not one giant string) so memory
 * stays proportional to a single page at a time.
 */
export async function parsePdf(buffer: Buffer, title: string): Promise<ParsedDocument> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();

    const sections: ParsedSection[] = result.pages.map((page, index) => ({
      order: index,
      page: page.num,
      paragraphs: splitParagraphs(page.text),
    }));

    return {
      format: "pdf",
      title,
      sections,
      pageCount: result.total,
    };
  } finally {
    await parser.destroy();
  }
}
