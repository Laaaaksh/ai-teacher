import { z } from "zod";
import { json } from "../sarvam";
import type { ParsedDocument, ParsedSection } from "../documents/types";

/**
 * Chapter/concept extraction: what the lesson planner reads to answer
 * "teach me Chapter 4" without re-parsing the document itself. Chapter
 * boundaries are found structurally (heading levels for DOCX/Markdown,
 * "Chapter N"-style markers for PDF/PPTX — both free, no model call); the
 * concepts/definitions/worked-examples inside each chapter need real
 * understanding of prose, so that part is a single sarvam-105b call per
 * chapter with a validated JSON schema.
 */

export interface OutlineConcept {
  title: string;
  summary: string;
}

export interface OutlineDefinition {
  term: string;
  definition: string;
}

export interface OutlineExample {
  title: string;
  description: string;
}

export interface OutlineChapter {
  title: string;
  order: number;
  startPage?: number;
  endPage?: number;
  concepts: OutlineConcept[];
  definitions: OutlineDefinition[];
  examples: OutlineExample[];
}

export interface DocumentOutline {
  documentId: string;
  title: string;
  chapters: OutlineChapter[];
  generatedAt: string;
}

const CHAPTER_PATTERN = /^\s*(chapter|unit|part|module)\s+([ivxlcdm]+|\d+)\b/i;
const MAX_TITLE_LEN = 80;

/** Cuts at the last whitespace inside the window rather than mid-word — same approach as lib/rag/chunk.ts's splitOversized. */
function truncateAtWordBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const window = text.slice(0, maxLen + 1);
  const cut = window.lastIndexOf(" ");
  return (cut > 0 ? text.slice(0, cut) : text.slice(0, maxLen)).trim();
}

/**
 * A real heading is a short line. A PDF parser that doesn't detect a blank
 * line between a heading and the body paragraph right after it (pdf-parse
 * can do this depending on the source PDF's internal layout) hands back a
 * "first line" that runs on for the whole page — bounding the length here
 * keeps that degenerate case from turning the extracted chapter title into
 * a paragraph, at the cost of a truncated (not exact) title in that case.
 */
function chapterMarkerIn(text: string | undefined): string | undefined {
  const firstLine = text?.split("\n")[0]?.trim();
  if (!firstLine || !CHAPTER_PATTERN.test(firstLine)) return undefined;
  return truncateAtWordBoundary(firstLine, MAX_TITLE_LEN);
}

interface ChapterGroup {
  title: string;
  sections: ParsedSection[];
}

/**
 * Groups a parsed document's flat section list into chapters. DOCX/Markdown
 * carry real heading levels (lib/documents/types.ts's ParsedSection.level),
 * so a level-1 heading is unambiguously a chapter start. PDF and PPTX have
 * no heading levels, so chapters are detected by an explicit "Chapter N" /
 * "Unit N" marker in a section's title or opening line — a document with no
 * such markers (a single-topic PDF, a slide deck with no chapter dividers)
 * falls back to one chapter covering the whole document, which is still
 * correct, just coarse.
 */
function groupIntoChapters(doc: ParsedDocument): ChapterGroup[] {
  const groups: ChapterGroup[] = [];
  const hierarchical = doc.format === "docx" || doc.format === "md";

  for (const section of doc.sections) {
    const marker = hierarchical
      ? section.level === 1
        ? section.title
        : undefined
      : chapterMarkerIn(section.title) ?? chapterMarkerIn(section.paragraphs[0]?.text);

    if (marker) {
      groups.push({ title: marker, sections: [section] });
    } else if (groups.length > 0) {
      groups[groups.length - 1].sections.push(section);
    } else {
      groups.push({ title: doc.title, sections: [section] });
    }
  }

  return groups.length > 0 ? groups : [{ title: doc.title, sections: doc.sections }];
}

function pageRange(sections: ParsedSection[]): { startPage?: number; endPage?: number } {
  const pages = sections.map((s) => s.page).filter((p): p is number => p !== undefined);
  if (pages.length === 0) return {};
  return { startPage: Math.min(...pages), endPage: Math.max(...pages) };
}

/** Concatenates a chapter's paragraph text up to a char budget that comfortably fits one chat call. */
function chapterText(sections: ParsedSection[], maxChars = 8000): string {
  const parts: string[] = [];
  let length = 0;
  for (const section of sections) {
    for (const paragraph of section.paragraphs) {
      if (length + paragraph.text.length > maxChars) return parts.join("\n\n");
      parts.push(paragraph.text);
      length += paragraph.text.length;
    }
  }
  return parts.join("\n\n");
}

const ChapterExtractionSchema = z.object({
  concepts: z.array(z.object({ title: z.string(), summary: z.string() })).default([]),
  definitions: z.array(z.object({ term: z.string(), definition: z.string() })).default([]),
  examples: z.array(z.object({ title: z.string(), description: z.string() })).default([]),
});

async function extractChapterContent(chapterTitle: string, text: string): Promise<z.infer<typeof ChapterExtractionSchema>> {
  if (text.trim().length === 0) return { concepts: [], definitions: [], examples: [] };

  return json(ChapterExtractionSchema, {
    messages: [
      {
        role: "system",
        content:
          "You extract structure from a textbook chapter for a lesson planner. Read the chapter text and identify: " +
          "the key concepts taught (title + one-sentence summary), any explicit definitions (term + definition), " +
          "and any worked examples or solved problems (title + one-sentence description of what it demonstrates). " +
          "Only include what the text actually contains — do not invent concepts, definitions, or examples that aren't there. " +
          'Reply as JSON: {"concepts":[{"title":"","summary":""}],"definitions":[{"term":"","definition":""}],"examples":[{"title":"","description":""}]}',
      },
      { role: "user", content: `Chapter: ${chapterTitle}\n\n${text}` },
    ],
    temperature: 0.1,
  });
}

/**
 * Builds the full outline for a document. Chapter extraction runs
 * sequentially (not Promise.all) — deliberately, to stay within whatever
 * rate limit sarvam-105b holds for a single API key shared across the demo,
 * rather than firing N concurrent chat calls for an N-chapter book. One
 * chapter's extraction failing doesn't fail the whole outline: it falls
 * back to an empty concept list for that chapter and the rest still runs.
 */
export async function extractOutline(documentId: string, doc: ParsedDocument): Promise<DocumentOutline> {
  const groups = groupIntoChapters(doc);
  const chapters: OutlineChapter[] = [];

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const { startPage, endPage } = pageRange(group.sections);

    let extracted: z.infer<typeof ChapterExtractionSchema>;
    try {
      extracted = await extractChapterContent(group.title, chapterText(group.sections));
    } catch (err) {
      console.error(`Outline extraction failed for chapter "${group.title}" of document ${documentId}:`, err);
      extracted = { concepts: [], definitions: [], examples: [] };
    }

    chapters.push({
      title: group.title,
      order: i,
      startPage,
      endPage,
      concepts: extracted.concepts,
      definitions: extracted.definitions,
      examples: extracted.examples,
    });
  }

  return { documentId, title: doc.title, chapters, generatedAt: new Date().toISOString() };
}
