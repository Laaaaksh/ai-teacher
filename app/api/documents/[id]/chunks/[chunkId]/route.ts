import { NextResponse } from "next/server";
import { getDocument, getDocumentChunks } from "@/lib/db";

export const runtime = "nodejs";

/**
 * The full text of one citable chunk, for "open the source passage" — a
 * Citation only carries a 240-char excerpt (lib/rag/retrieve.ts's
 * chunkToCitation), which is enough to verify a claim at a glance but not
 * enough to actually read the passage it came from.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; chunkId: string }> }) {
  const { id, chunkId } = await params;
  const document = getDocument(id);
  if (!document) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  const chunk = getDocumentChunks(id).find((c) => c.id === chunkId);
  if (!chunk) return NextResponse.json({ error: "Chunk not found." }, { status: 404 });

  return NextResponse.json({
    chunk: { id: chunk.id, documentId: chunk.documentId, text: chunk.text, page: chunk.page, section: chunk.section },
    document: { id: document.id, title: document.title, format: document.format },
  });
}
