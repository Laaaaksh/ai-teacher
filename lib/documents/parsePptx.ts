import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import type { ParsedDocument, ParsedParagraph, ParsedSection } from "./types";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

interface SlideShapeText {
  isTitle: boolean;
  text: string;
}

/** Extracts each shape's paragraph text and whether it sits in a title placeholder. */
function extractShapes(slideXml: unknown): SlideShapeText[] {
  const shapes: SlideShapeText[] = [];
  const sld = (slideXml as Record<string, unknown>)?.["p:sld"] as Record<string, unknown> | undefined;
  const spTree = (sld?.["p:cSld"] as Record<string, unknown> | undefined)?.["p:spTree"] as
    | Record<string, unknown>
    | undefined;
  if (!spTree) return shapes;

  for (const sp of asArray(spTree["p:sp"] as unknown)) {
    const shape = sp as Record<string, unknown>;
    const nvPr = (shape["p:nvSpPr"] as Record<string, unknown> | undefined)?.["p:nvPr"] as
      | Record<string, unknown>
      | undefined;
    const ph = nvPr?.["p:ph"] as Record<string, unknown> | undefined;
    const phType = ph?.["@_type"] as string | undefined;
    const isTitle = phType === "title" || phType === "ctrTitle";

    const txBody = shape["p:txBody"] as Record<string, unknown> | undefined;
    if (!txBody) continue;

    const paragraphTexts: string[] = [];
    for (const para of asArray(txBody["a:p"] as unknown)) {
      const p = para as Record<string, unknown>;
      const runs = asArray(p["a:r"] as unknown).map((run) => {
        const r = run as Record<string, unknown>;
        const t = r["a:t"];
        return typeof t === "string" ? t : "";
      });
      const text = runs.join("").trim();
      if (text) paragraphTexts.push(text);
    }

    const combined = paragraphTexts.join("\n").trim();
    if (combined) shapes.push({ isTitle, text: combined });
  }

  return shapes;
}

/**
 * Parses a PPTX into one section per slide. Slide order is taken from the
 * numeric suffix of `ppt/slides/slideN.xml`, which matches presentation
 * order for the overwhelming majority of exporters; a presentation whose
 * relationship order diverges from that numbering (rare, hand-edited decks)
 * would be ordered incorrectly — a known limitation, not silently wrong data.
 */
export async function parsePptx(buffer: Buffer, title: string): Promise<ParsedDocument> {
  const zip = await JSZip.loadAsync(buffer);

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      return na - nb;
    });

  const sections: ParsedSection[] = [];

  for (let i = 0; i < slideFiles.length; i++) {
    const xmlText = await zip.files[slideFiles[i]].async("text");
    const parsed = parser.parse(xmlText);
    const shapes = extractShapes(parsed);

    const titleShape = shapes.find((s) => s.isTitle);
    const bodyShapes = shapes.filter((s) => s !== titleShape);

    const paragraphs: ParsedParagraph[] = bodyShapes.flatMap((shape) =>
      shape.text
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean),
    ).map((text, order) => ({ order, text }));

    sections.push({
      order: i,
      page: i + 1,
      title: titleShape?.text,
      paragraphs,
    });
  }

  return { format: "pptx", title, sections, pageCount: slideFiles.length };
}
