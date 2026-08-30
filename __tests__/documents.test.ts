import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import JSZip from "jszip";
import { parseDocument, chunkDocument, DocumentParseError } from "../lib/documents";

async function buildTestPdf(): Promise<Buffer> {
  const doc = new PDFDocument({ autoFirstPage: false });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  doc.addPage().fontSize(20).text("Chapter One");
  doc.fontSize(12).text("\nThis is the first paragraph of chapter one.\n\nThis is the second paragraph.");

  doc.addPage().fontSize(20).text("Chapter Two");
  doc.fontSize(12).text("\nThis is page two content.");

  doc.end();
  return done;
}

async function buildTestDocx(): Promise<Buffer> {
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Introduction", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: "This is the intro paragraph." }),
          new Paragraph({ text: "Background", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: "This is the background paragraph." }),
        ],
      },
    ],
  });
  return Packer.toBuffer(document);
}

async function buildTestPptx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0"?>
    <p:sld xmlns:a="a" xmlns:p="p">
      <p:cSld>
        <p:spTree>
          <p:sp>
            <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
            <p:txBody><a:p><a:r><a:t>Slide One Title</a:t></a:r></a:p></p:txBody>
          </p:sp>
          <p:sp>
            <p:txBody>
              <a:p><a:r><a:t>Bullet A</a:t></a:r></a:p>
              <a:p><a:r><a:t>Bullet B</a:t></a:r></a:p>
            </p:txBody>
          </p:sp>
        </p:spTree>
      </p:cSld>
    </p:sld>`,
  );
  zip.file(
    "ppt/slides/slide2.xml",
    `<?xml version="1.0"?>
    <p:sld xmlns:a="a" xmlns:p="p">
      <p:cSld>
        <p:spTree>
          <p:sp>
            <p:txBody><a:p><a:r><a:t>Second slide content</a:t></a:r></a:p></p:txBody>
          </p:sp>
        </p:spTree>
      </p:cSld>
    </p:sld>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("parseDocument", () => {
  it("parses a PDF into one section per page with citable page numbers", async () => {
    const pdf = await buildTestPdf();
    const result = await parseDocument(pdf, "textbook.pdf");

    expect(result.format).toBe("pdf");
    expect(result.pageCount).toBe(2);
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].page).toBe(1);
    expect(result.sections[0].paragraphs.length).toBeGreaterThan(0);
    expect(result.sections.map((s) => s.paragraphs.map((p) => p.text).join(" ")).join(" ")).toContain(
      "first paragraph",
    );
  });

  it("parses a DOCX into sections by heading", async () => {
    const docx = await buildTestDocx();
    const result = await parseDocument(docx, "notes.docx");

    expect(result.format).toBe("docx");
    expect(result.sections.map((s) => s.title)).toEqual(["Introduction", "Background"]);
    expect(result.sections[0].paragraphs[0].text).toContain("intro paragraph");
  });

  it("parses a PPTX into sections by slide, extracting the title placeholder", async () => {
    const pptx = await buildTestPptx();
    const result = await parseDocument(pptx, "deck.pptx");

    expect(result.format).toBe("pptx");
    expect(result.pageCount).toBe(2);
    expect(result.sections[0].title).toBe("Slide One Title");
    expect(result.sections[0].paragraphs.map((p) => p.text)).toEqual(["Bullet A", "Bullet B"]);
    expect(result.sections[1].paragraphs[0].text).toBe("Second slide content");
  });

  it("parses plain text into paragraphs split on blank lines", async () => {
    const result = await parseDocument(Buffer.from("Para one.\n\nPara two."), "notes.txt");
    expect(result.format).toBe("txt");
    expect(result.sections[0].paragraphs.map((p) => p.text)).toEqual(["Para one.", "Para two."]);
  });

  it("parses Markdown into sections by heading", async () => {
    const md = "# Title\n\nIntro text.\n\n## Sub\n\nSub text.";
    const result = await parseDocument(Buffer.from(md), "notes.md");
    expect(result.format).toBe("md");
    expect(result.sections.map((s) => s.title)).toEqual(["Title", "Sub"]);
  });

  it("rejects unsupported formats with a typed error", async () => {
    await expect(parseDocument(Buffer.from("hi"), "image.png")).rejects.toBeInstanceOf(DocumentParseError);
  });

  it("rejects empty files with a typed error", async () => {
    await expect(parseDocument(Buffer.alloc(0), "empty.txt")).rejects.toMatchObject({ kind: "empty-file" });
  });
});

describe("chunkDocument", () => {
  it("never spans a chunk across sections and keeps citation info", async () => {
    const docx = await buildTestDocx();
    const doc = await parseDocument(docx, "notes.docx");
    const chunks = chunkDocument(doc, 10_000);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].section).toBe("Introduction");
    expect(chunks[1].section).toBe("Background");
  });

  it("splits long sections into multiple chunks under the size limit", async () => {
    const pdf = await buildTestPdf();
    const doc = await parseDocument(pdf, "textbook.pdf");
    const chunks = chunkDocument(doc, 20);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(200);
    }
  });
});
