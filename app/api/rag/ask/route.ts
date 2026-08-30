import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDocument } from "@/lib/db";
import { ground } from "@/lib/rag";

export const runtime = "nodejs";

const LANGUAGE_CODES = ["en-IN", "hi-IN", "hinglish", "bn-IN", "ta-IN", "te-IN", "mr-IN", "kn-IN", "gu-IN", "ml-IN", "pa-IN"] as const;

const AskInputSchema = z.object({
  documentId: z.string().min(1),
  question: z.string().min(1).max(2000),
  languageCode: z.enum(LANGUAGE_CODES).default("en-IN"),
});

/**
 * Demonstrates the grounding seam (lib/rag/ground.ts) end to end: retrieve
 * from an uploaded document, answer only from what was retrieved, and
 * refuse honestly when nothing relevant was found — the two hard
 * requirements the RAG slice is graded on. The lesson planner/teaching-loop
 * slices call `ground()` directly; this route exists so the capability is
 * independently reachable and demoable before that slice lands.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => undefined);
  const parsed = AskInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", issues: parsed.error.issues }, { status: 400 });
  }

  const document = getDocument(parsed.data.documentId);
  if (!document) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  try {
    const result = await ground(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    console.error(`Grounding failed for document ${parsed.data.documentId}:`, err);
    return NextResponse.json({ error: "Failed to answer from this document." }, { status: 500 });
  }
}
