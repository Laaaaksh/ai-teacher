import { NextRequest, NextResponse } from "next/server";
import { chunkDocument, DocumentParseError, parseDocument } from "@/lib/documents";
import { listDocuments, saveDocument } from "@/lib/db";

export const runtime = "nodejs";

/** Course material well above this is not a real hackathon input, and buffering
 *  it whole (then parsing on top) is enough to OOM the single demo process. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");

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
    const chunks = chunkDocument(parsed);
    const { document, chunks: savedChunks } = saveDocument(parsed, chunks);

    return NextResponse.json({ document, chunkCount: savedChunks.length }, { status: 201 });
  } catch (err) {
    if (err instanceof DocumentParseError) {
      return NextResponse.json({ error: err.message, kind: err.kind }, { status: 422 });
    }
    return NextResponse.json({ error: `Failed to process ${file.name}.` }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ documents: listDocuments() });
}
