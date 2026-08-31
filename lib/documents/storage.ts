import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { DocumentFormat } from "./types";

/**
 * Where an uploaded file's original bytes live on disk, keyed by the
 * document id already assigned in SQLite — deterministic, so no extra
 * column is needed to look it up later. .gitignore already excludes
 * data/uploads/ (present since the foundation slice); this is what
 * populates it. Needed by lib/rag/outline.ts, which re-parses the original
 * document rather than reconstructing it from already-chunked text.
 */
function uploadPath(documentId: string, format: DocumentFormat): string {
  return path.join(process.cwd(), "data", "uploads", `${documentId}.${format}`);
}

export async function saveUploadedFile(documentId: string, format: DocumentFormat, buffer: Buffer): Promise<void> {
  const filePath = uploadPath(documentId, format);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
}

export async function readUploadedFile(documentId: string, format: DocumentFormat): Promise<Buffer> {
  return readFile(uploadPath(documentId, format));
}

/** Whether an uploaded file's original bytes are still on disk — used to flag a document as unavailable before the user picks it, rather than only failing later at outline time. */
export function uploadedFileExists(documentId: string, format: DocumentFormat): boolean {
  return existsSync(uploadPath(documentId, format));
}
