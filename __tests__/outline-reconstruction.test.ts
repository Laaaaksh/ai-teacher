import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DB_PATH = ":memory:";

import { stubChatSequence } from "./support/sarvamMock";
import { resetDbForTests } from "../lib/db/connection";
import { saveDocument, getDocument, getDocumentChunks } from "../lib/db/accessors/documents";
import { extractOutline, reconstructParsedDocument } from "../lib/rag/outline";
import type { ParsedDocument } from "../lib/documents/types";

/**
 * Regression test for a real dead end: an indexed document (chunks embedded,
 * app reports it ready) whose original upload has been deleted from
 * data/uploads/ used to make GET /api/documents/[id]/outline return a
 * permanent 409 — readUploadedFile fails, and there was no fallback. This
 * covers the fix's reconstruction path directly at the lib level (the route
 * itself is a thin wrapper: try readUploadedFile, fall back to this on
 * failure) rather than through Next's route machinery, matching this repo's
 * convention of testing the real logic directly (see
 * lesson-player-segment.test.ts).
 */

const ORIGINAL_KEY = process.env.SARVAM_API_KEY;

beforeEach(() => {
  resetDbForTests();
  process.env.SARVAM_API_KEY = "test-key";
});

afterEach(() => {
  process.env.SARVAM_API_KEY = ORIGINAL_KEY;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const PARSED: ParsedDocument = {
  format: "pdf",
  title: "Electricity Basics",
  pageCount: 2,
  sections: [
    {
      order: 0,
      page: 1,
      paragraphs: [
        { order: 0, text: "Chapter 1: Current" },
        { order: 1, text: "Electric current is the flow of charge." },
      ],
    },
    {
      order: 1,
      page: 2,
      paragraphs: [{ order: 2, text: "Ohm's law relates voltage, current and resistance." }],
    },
  ],
};

describe("outline reconstruction from chunks (regression: missing upload no longer a dead end)", () => {
  it("produces a real outline for a document with chunks but no file on disk", async () => {
    const { document, chunks: savedChunks } = saveDocument(PARSED, [
      { order: 0, text: "Chapter 1: Current\nElectric current is the flow of charge.", page: 1, section: undefined },
      { order: 1, text: "Ohm's law relates voltage, current and resistance.", page: 2, section: undefined },
    ]);

    // No saveUploadedFile call was ever made for this document — the upload
    // file for `document.id` genuinely does not exist on disk, exactly as
    // if it had been deleted after indexing completed.

    const reconstructed = reconstructParsedDocument(document, getDocumentChunks(document.id));
    expect(reconstructed.sections.length).toBeGreaterThan(0);
    expect(reconstructed.sections.flatMap((s) => s.paragraphs).map((p) => p.text)).toEqual(
      savedChunks.map((c) => c.text),
    );

    stubChatSequence(
      { concepts: [{ title: "Electric current", summary: "Flow of charge." }], definitions: [], examples: [] },
      { concepts: [{ title: "Ohm's law", summary: "V = IR." }], definitions: [], examples: [] },
    );

    const outline = await extractOutline(document.id, reconstructed);

    expect(outline.chapters.length).toBeGreaterThan(0);
    expect(outline.chapters.some((c) => c.concepts.length > 0)).toBe(true);
    expect(getDocument(document.id)).toBeDefined();
  });

  it("keeps chunk order and location metadata when grouping into sections", () => {
    const { document } = saveDocument(PARSED, [
      { order: 0, text: "first", page: 1, section: "Intro" },
      { order: 1, text: "second", page: 1, section: "Intro" },
      { order: 2, text: "third", page: 2, section: "Methods" },
    ]);

    const reconstructed = reconstructParsedDocument(document, getDocumentChunks(document.id));

    expect(reconstructed.sections).toHaveLength(2);
    expect(reconstructed.sections[0]).toMatchObject({ title: "Intro", page: 1 });
    expect(reconstructed.sections[0].paragraphs.map((p) => p.text)).toEqual(["first", "second"]);
    expect(reconstructed.sections[1]).toMatchObject({ title: "Methods", page: 2 });
    expect(reconstructed.sections[1].paragraphs.map((p) => p.text)).toEqual(["third"]);
  });

  it("recovers DOCX heading levels from the stored breadcrumb so chapters don't collapse into one", async () => {
    const docx: ParsedDocument = { format: "docx", title: "Physics", sections: [] };
    const { document } = saveDocument(docx, [
      { order: 0, text: "Chapter 1", section: "Chapter 1" },
      { order: 1, text: "Current is the flow of charge.", section: "Chapter 1 > 1.1 Current" },
      { order: 2, text: "Chapter 2", section: "Chapter 2" },
      { order: 3, text: "Resistance opposes current.", section: "Chapter 2 > 2.1 Resistance" },
    ]);

    const reconstructed = reconstructParsedDocument(document, getDocumentChunks(document.id));

    expect(reconstructed.sections.map((s) => ({ title: s.title, level: s.level }))).toEqual([
      { title: "Chapter 1", level: 1 },
      { title: "1.1 Current", level: 2 },
      { title: "Chapter 2", level: 1 },
      { title: "2.1 Resistance", level: 2 },
    ]);

    stubChatSequence(
      { concepts: [{ title: "Current", summary: "Flow of charge." }], definitions: [], examples: [] },
      { concepts: [{ title: "Resistance", summary: "Opposition to current." }], definitions: [], examples: [] },
    );

    const outline = await extractOutline(document.id, reconstructed);
    expect(outline.chapters.map((c) => c.title)).toEqual(["Chapter 1", "Chapter 2"]);
  });

  it("leaves a PDF section breadcrumb intact rather than splitting it into heading levels", () => {
    const { document } = saveDocument(PARSED, [{ order: 0, text: "body", page: 1, section: "A > B" }]);

    const reconstructed = reconstructParsedDocument(document, getDocumentChunks(document.id));

    expect(reconstructed.sections[0]).toMatchObject({ title: "A > B", level: undefined });
  });
});
