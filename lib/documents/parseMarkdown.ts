import type { ParsedDocument, ParsedSection } from "./types";

const HEADING_RE = /^(#{1,6})\s+(.+)$/;

function splitParagraphs(body: string) {
  return body
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0)
    .map((text, order) => ({ order, text }));
}

/** Parses Markdown into one section per heading (any level), paragraphs split on blank lines within each section. */
export function parseMarkdown(text: string, title: string): ParsedDocument {
  const lines = text.split(/\r?\n/);
  const sections: ParsedSection[] = [];
  let sectionOrder = 0;
  let currentTitle: string | undefined;
  let currentLevel: number | undefined;
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join("\n").trim();
    if (currentTitle || body) {
      sections.push({ order: sectionOrder, title: currentTitle, level: currentLevel, paragraphs: splitParagraphs(body) });
      sectionOrder += 1;
    }
    buffer = [];
  };

  for (const line of lines) {
    const match = line.match(HEADING_RE);
    if (match) {
      flush();
      currentTitle = match[2].trim();
      currentLevel = match[1].length;
    } else {
      buffer.push(line);
    }
  }
  flush();

  if (sections.length === 0) {
    sections.push({ order: 0, paragraphs: [] });
  }

  return { format: "md", title, sections };
}
