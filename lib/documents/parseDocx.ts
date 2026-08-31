import mammoth from "mammoth";
import * as cheerio from "cheerio";
import type { ParsedDocument, ParsedSection } from "./types";

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/**
 * Parses a DOCX into one section per heading (h1-h6), using mammoth's
 * HTML conversion (which maps Word paragraph styles to heading tags) so
 * structure survives without depending on Word's raw XML schema.
 */
export async function parseDocx(buffer: Buffer, title: string): Promise<ParsedDocument> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const $ = cheerio.load(html);

  const sections: ParsedSection[] = [];
  let paragraphOrder = 0;
  let current: ParsedSection = { order: 0, paragraphs: [] };

  const pushCurrentIfNonEmpty = () => {
    if (current.title || current.paragraphs.length > 0) {
      sections.push({ ...current, order: sections.length });
    }
  };

  $("body")
    .children()
    .each((_, el) => {
      const tag = el.tagName?.toLowerCase();
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (!text) return;

      if (tag && HEADING_TAGS.has(tag)) {
        pushCurrentIfNonEmpty();
        paragraphOrder = 0;
        current = { order: sections.length, title: text, paragraphs: [] };
        return;
      }

      current.paragraphs.push({ order: paragraphOrder, text });
      paragraphOrder += 1;
    });

  pushCurrentIfNonEmpty();

  if (sections.length === 0) {
    sections.push({ order: 0, paragraphs: [] });
  }

  return { format: "docx", title, sections };
}
