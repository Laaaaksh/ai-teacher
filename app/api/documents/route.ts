import { NextRequest, NextResponse } from "next/server";
import { DocumentParseError, parseDocument, saveUploadedFile } from "@/lib/documents";
import { listDocuments, saveDocument } from "@/lib/db";
import { chunkForRetrieval, indexDocument } from "@/lib/rag";

export const runtime = "nodejs";

/** Course material well above this is not a real hackathon input, and buffering
 *  it whole (then parsing on top) is enough to OOM the single demo process. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Multipart boundaries and part headers add a little on top of the file itself,
 *  so the header-level check needs slack or a file right at the cap is rejected. */
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;

export async function POST(req: NextRequest) {
  /* req.formData() buffers the whole body, so the cap has to be enforced from the
   * header first. A client that omits Content-Length (chunked transfer) slips past
   * this and is only caught by the file.size check below, after buffering — an
   * accepted limitation for a single-key demo, not worth streaming multipart for. */
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return NextResponse.json(
      { error: `Request body exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB upload limit.` },
      { status: 413 },
    );
  }

  const formData = await req.formData().catch(() => undefined);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Expected a multipart form with a 'file' field." }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `${file.name} is ${(file.size / (1024 * 1024)).toFixed(1)}MB; the limit is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`,
      },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const parsed = await parseDocument(buffer, file.name);
    const chunks = chunkForRetrieval(parsed);
    const { document, chunks: savedChunks } = saveDocument(parsed, chunks);
    await saveUploadedFile(document.id, document.format, buffer);

    // Fire-and-forget: embedding a 300-page book can take a while, so the
    // upload responds as soon as chunks are persisted. The client polls
    // /api/documents/[id]/index for progress (see lib/rag/embed.ts's
    // getIndexingProgress) rather than the request blocking on it.
    indexDocument(document.id).catch((err) => {
      console.error(`Background indexing failed for document ${document.id}:`, err);
    });

    return NextResponse.json({ document, chunkCount: savedChunks.length }, { status: 201 });
  } catch (err) {
    if (err instanceof DocumentParseError) {
      return NextResponse.json({ error: err.message, kind: err.kind }, { status: 422 });
    }
    console.error(`Failed to process upload ${file.name}:`, err);
    return NextResponse.json({ error: `Failed to process ${file.name}.` }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ documents: listDocuments() });
}
