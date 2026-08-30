import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getConceptProgressForLearner, getDocument, getDocumentChunks, getLearnerProfile, listLessonSessionsForLearner } from "@/lib/db";
import { LANGUAGE_CODES } from "@/lib/teach/profile";
import { createTaughtLessonSession } from "@/lib/teach/session";

export const runtime = "nodejs";

const CreateSessionSchema = z.object({
  learnerProfileId: z.string().min(1),
  topic: z.string().min(1).max(500),
  sourceDocumentId: z.string().min(1).optional(),
  sectionHint: z.string().max(200).optional(),
  totalMinutes: z.number().int().min(1).max(180),
  depth: z.enum(["overview", "standard", "deep"]),
  language: z.enum(LANGUAGE_CODES),
});

/**
 * "Plan -> Explain -> Demonstrate -> Question" — POST creates a full taught
 * lesson session (concepts, scenes, checkpoint questions) from either a bare
 * topic or an uploaded document (`sourceDocumentId`), personalised by any
 * prior progress this learner has on record. This is the slowest endpoint
 * in the engine (one LLM call per concept, plus planning/summary) since it
 * scripts the entire lesson up front rather than beat-by-beat.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => undefined);
  const parsed = CreateSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", issues: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;

  const learnerProfile = getLearnerProfile(input.learnerProfileId);
  if (!learnerProfile) {
    return NextResponse.json({ error: `Learner profile ${input.learnerProfileId} not found.` }, { status: 404 });
  }

  let documentChunks;
  if (input.sourceDocumentId) {
    const document = getDocument(input.sourceDocumentId);
    if (!document) {
      return NextResponse.json({ error: `Document ${input.sourceDocumentId} not found.` }, { status: 404 });
    }
    documentChunks = getDocumentChunks(input.sourceDocumentId);
  }

  try {
    const taught = await createTaughtLessonSession({
      learnerProfile,
      topic: input.topic,
      sourceDocumentId: input.sourceDocumentId,
      documentChunks,
      sectionHint: input.sectionHint,
      totalMinutes: input.totalMinutes,
      depth: input.depth,
      language: input.language,
      priorProgress: getConceptProgressForLearner(input.learnerProfileId),
    });
    return NextResponse.json(taught, { status: 201 });
  } catch (err) {
    console.error("Failed to create taught lesson session:", err);
    return NextResponse.json({ error: "Failed to plan and script the lesson." }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  const learnerProfileId = req.nextUrl.searchParams.get("learnerProfileId");
  if (!learnerProfileId) {
    return NextResponse.json({ error: "learnerProfileId query param is required." }, { status: 400 });
  }
  return NextResponse.json({ sessions: listLessonSessionsForLearner(learnerProfileId) });
}
