import { NextResponse } from "next/server";
import { getDocument, getIndexingProgress } from "@/lib/db";
import { indexDocument } from "@/lib/rag";

export const runtime = "nodejs";

/** Polled by the upload UI to show indexing progress (see lib/rag/embed.ts's getIndexingProgress) — computed live from document_chunks, so it's correct even across a server restart mid-index. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const document = getDocument(id);
  if (!document) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  const progress = getIndexingProgress(id);
  return NextResponse.json({ ...progress, done: progress.total > 0 && progress.embedded === progress.total });
}

/** Re-triggers indexing for any chunks still missing an embedding — idempotent, useful if background indexing was interrupted (e.g. a dev server restart). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const document = getDocument(id);
  if (!document) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  const result = await indexDocument(id);
  return NextResponse.json(result);
}
