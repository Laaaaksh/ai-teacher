import { DocumentParseError } from "./errors";
import { parseDocx } from "./parseDocx";
import { parseMarkdown } from "./parseMarkdown";
import { parsePdf } from "./parsePdf";
import { parsePptx } from "./parsePptx";
import { parseText } from "./parseText";
import type { ParsedDocument } from "./types";

export { chunkDocument } from "./chunk";
export { DocumentParseError } from "./errors";
export type { DocumentErrorKind } from "./errors";
export { saveUploadedFile, readUploadedFile } from "./storage";
export * from "./types";

function extensionOf(filename: string): string {
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

/**
 * Parses an uploaded file into a structure-preserving ParsedDocument,
 * dispatching by file extension. Throws DocumentParseError for anything
 * this module cannot handle or an empty upload.
 */
export async function parseDocument(buffer: Buffer, filename: string): Promise<ParsedDocument> {
  if (buffer.length === 0) {
    throw new DocumentParseError("empty-file", `${filename} is empty.`);
  }

  const ext = extensionOf(filename);
  const title = filename.replace(/\.[a-z0-9]+$/i, "");

  try {
    switch (ext) {
      case "pdf":
        return await parsePdf(buffer, title);
      case "docx":
        return await parseDocx(buffer, title);
      case "pptx":
        return await parsePptx(buffer, title);
      case "txt":
        return parseText(buffer.toString("utf-8"), title);
      case "md":
      case "markdown":
        return parseMarkdown(buffer.toString("utf-8"), title);
      default:
        throw new DocumentParseError(
          "unsupported-format",
          `Unsupported file type ".${ext}". Supported: pdf, docx, pptx, txt, md.`,
        );
    }
  } catch (err) {
    if (err instanceof DocumentParseError) throw err;
    throw new DocumentParseError("parse-failed", `Failed to parse ${filename}: ${(err as Error).message}`, err);
  }
}
