import { NextRequest, NextResponse } from "next/server";
import { getDocument, getDocumentChunks, getDocumentOutline, saveDocumentOutline } from "@/lib/db";
import { extractOutline, reconstructParsedDocument } from "@/lib/rag";
import { parseDocument, readUploadedFile, type ParsedDocument } from "@/lib/documents";

export const runtime = "nodejs";

/**
 * Returns the chapter/concept outline for a document (lib/rag/outline.ts),
 * generating and caching it (document_outlines) on first request rather
 * than at upload time — outline extraction makes one LLM call per chapter,
 * and most uploads are inspected via RAG search long before any lesson
 * planner asks "teach me Chapter 4", so paying that cost eagerly would slow
 * every upload down for a feature not every session uses. Pass
 * ?regenerate=true to force a fresh extraction.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const document = getDocument(id);
  if (!document) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  const cached = getDocumentOutline(id);
  const force = req.nextUrl.searchParams.get("regenerate") === "true";
  if (cached && !force) return NextResponse.json({ outline: cached.outline, cached: true });

  let buffer: Buffer | undefined;
  try {
    buffer = await readUploadedFile(id, document.format);
  } catch (err) {
    // Upload gone from disk (moved checkout, cleared cache dir, restored DB without
    // data/uploads/). Only a read failure gets the fallback — a file that IS present
    // but fails to parse must surface as the real parse error below, not be masked
    // by a lossy reconstruction.
    console.warn(`Uploaded file for document ${id} is unreadable; falling back to chunk reconstruction:`, err);
  }

  let parsed: ParsedDocument;
  let reconstructed = false;
  if (buffer) {
    parsed = await parseDocument(buffer, `${document.title}.${document.format}`);
  } else {
    const chunks = getDocumentChunks(id);
    if (chunks.length === 0) {
      return NextResponse.json({ error: `The original upload for "${document.title}" is no longer available on disk.` }, { status: 409 });
    }
    // See reconstructParsedDocument for what's lost doing this.
    parsed = reconstructParsedDocument(document, chunks);
    reconstructed = true;
  }

  const outline = await extractOutline(id, parsed);
  // A chunk-reconstructed outline is deliberately not cached: it is the degraded
  // form, and caching it would permanently shadow the exact on-disk extraction if
  // the file comes back.
  if (reconstructed) return NextResponse.json({ outline, cached: false });

  const saved = saveDocumentOutline(outline);
  return NextResponse.json({ outline: saved.outline, cached: false });
}
