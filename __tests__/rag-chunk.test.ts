import { describe, expect, it } from "vitest";
import { chunkForRetrieval } from "../lib/rag/chunk";
import type { ParsedDocument } from "../lib/documents/types";

function doc(overrides: Partial<ParsedDocument>): ParsedDocument {
  return { format: "md", title: "Doc", sections: [], ...overrides };
}

describe("chunkForRetrieval", () => {
  it("never spans a chunk across sections", () => {
    const d = doc({
      sections: [
        { order: 0, title: "Introduction", level: 1, paragraphs: [{ order: 0, text: "Intro text." }] },
        { order: 1, title: "Background", level: 1, paragraphs: [{ order: 0, text: "Background text." }] },
      ],
    });

    const chunks = chunkForRetrieval(d, { maxChars: 10_000 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toBe("Intro text.");
    expect(chunks[1].text).toBe("Background text.");
  });

  it("builds a breadcrumb section path from nested headings", () => {
    const d = doc({
      format: "docx",
      sections: [
        { order: 0, title: "Chapter 4", level: 1, paragraphs: [] },
        { order: 1, title: "Ohm's Law", level: 2, paragraphs: [{ order: 0, text: "V = IR." }] },
      ],
    });

    const chunks = chunkForRetrieval(d);
    const ohmsChunk = chunks.find((c) => c.text.includes("V = IR"));
    expect(ohmsChunk?.section).toBe("Chapter 4 > Ohm's Law");
  });

  it("resets the breadcrumb when a sibling heading follows a deeper one", () => {
    const d = doc({
      format: "docx",
      sections: [
        { order: 0, title: "Chapter 1", level: 1, paragraphs: [] },
        { order: 1, title: "Section 1.1", level: 2, paragraphs: [] },
        { order: 2, title: "Chapter 2", level: 1, paragraphs: [{ order: 0, text: "Chapter two body." }] },
      ],
    });

    const chunks = chunkForRetrieval(d);
    const ch2 = chunks.find((c) => c.text.includes("Chapter two body"));
    expect(ch2?.section).toBe("Chapter 2");
  });

  it("splits a long section into multiple chunks under the size limit", () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) => ({ order: i, text: `Paragraph number ${i} has some real content in it.` }));
    const d = doc({ sections: [{ order: 0, title: "Long", paragraphs }] });

    const chunks = chunkForRetrieval(d, { maxChars: 80, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(80);
  });

  it("carries trailing paragraphs forward as overlap between adjacent chunks", () => {
    const paragraphs = [
      { order: 0, text: "First paragraph with enough text to matter here." },
      { order: 1, text: "Second paragraph also has a reasonable amount of text." },
      { order: 2, text: "Third paragraph continues the section further along." },
    ];
    const d = doc({ sections: [{ order: 0, paragraphs }] });

    const chunks = chunkForRetrieval(d, { maxChars: 90, overlapChars: 60 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // The overlap piece carried into chunk 2 should also appear at the tail of chunk 1.
    const overlapCandidate = paragraphs.find((p) => chunks[1].text.includes(p.text));
    expect(overlapCandidate).toBeDefined();
    expect(chunks[0].text).toContain(overlapCandidate!.text);
  });

  it("hard-splits a single paragraph longer than maxChars at a word boundary", () => {
    const longText = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const d = doc({ sections: [{ order: 0, paragraphs: [{ order: 0, text: longText }] }] });

    const chunks = chunkForRetrieval(d, { maxChars: 30, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(30);
      expect(chunk.text.endsWith("word")).toBe(false); // never cut mid-word
    }
  });

  it("keeps a bare heading with no body as its own citable chunk", () => {
    const d = doc({ sections: [{ order: 0, title: "Divider", paragraphs: [] }] });
    const chunks = chunkForRetrieval(d);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe("Divider");
  });

  it("keeps page numbers from PDF-style sections with no heading levels", () => {
    const d = doc({
      format: "pdf",
      sections: [{ order: 0, page: 42, paragraphs: [{ order: 0, text: "Page forty-two content." }] }],
    });
    const chunks = chunkForRetrieval(d);
    expect(chunks[0].page).toBe(42);
  });
});
