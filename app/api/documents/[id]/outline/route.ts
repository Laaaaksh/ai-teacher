import { NextRequest, NextResponse } from "next/server";
import { getDocument, getDocumentOutline, saveDocumentOutline } from "@/lib/db";
import { extractOutline } from "@/lib/rag";
import { parseDocument, readUploadedFile } from "@/lib/documents";

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

  let buffer: Buffer;
  try {
    buffer = await readUploadedFile(id, document.format);
  } catch {
    return NextResponse.json({ error: `The original upload for "${document.title}" is no longer available on disk.` }, { status: 409 });
  }

  const parsed = await parseDocument(buffer, `${document.title}.${document.format}`);
  const outline = await extractOutline(id, parsed);
  const saved = saveDocumentOutline(outline);

  return NextResponse.json({ outline: saved.outline, cached: false });
}
