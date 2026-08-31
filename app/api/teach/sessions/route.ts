import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getConceptProgressForLearner,
  getDocument,
  getDocumentChunks,
  getLearnerProfile,
  listLessonSessionsForLearner,
  updateLessonSessionScriptingStatus,
} from "@/lib/db";
import { LANGUAGE_CODES } from "@/lib/teach/profile";
import { persistPlannedSession, planLessonConcepts, scriptTaughtLessonSession } from "@/lib/teach/session";
import { runLlm } from "../llmErrors";
import type { DocumentChunkRow } from "@/lib/db/types";

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
 * "Plan" — POST plans the lesson (one LLM call — verified live: ~50s for a
 * 3-concept lesson, still one request, not several minutes) and returns as
 * soon as the plan is persisted; `scriptingStatus: "pending"`
 * on the returned session means scenes/questions aren't there yet. Scripting
 * every concept (the slow, multi-LLM-call part) then runs in the background
 * — this relies on the Node process staying alive after the response is
 * sent, true for `next dev`/`next start` but not a serverless/edge
 * deployment (see docs/ARCHITECTURE.md Known limitations). Poll
 * GET /api/teach/sessions/[id] until `scriptingStatus` is
 * "ready"/"partial"/"failed"; scenes for concepts that finish scripting
 * appear incrementally, not all at once.
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

  let documentChunks: DocumentChunkRow[] | undefined;
  if (input.sourceDocumentId) {
    const document = getDocument(input.sourceDocumentId);
    if (!document) {
      return NextResponse.json({ error: `Document ${input.sourceDocumentId} not found.` }, { status: 404 });
    }
    documentChunks = getDocumentChunks(input.sourceDocumentId);
  }

  const planInput = {
    learnerProfile,
    topic: input.topic,
    sourceDocumentId: input.sourceDocumentId,
    documentChunks,
    sectionHint: input.sectionHint,
    totalMinutes: input.totalMinutes,
    depth: input.depth,
    language: input.language,
    priorProgress: getConceptProgressForLearner(input.learnerProfileId),
  };

  /* Only the model call is raced against runLlm's deadline. Persisting is a
   * separate synchronous step so an abandoned slow plan can't commit a
   * session nobody holds the id for once it finally resolves. */
  const planned = await runLlm("Planning the lesson", () => planLessonConcepts(planInput));
  if (!planned.ok) return planned.response;

  const { session, plan } = persistPlannedSession(planInput, planned.value);

  // Fire-and-forget: scripting happens after the response is sent. A failure
  // here must still land in a terminal, pollable status rather than leaving
  // scriptingStatus stuck at "in_progress" forever.
  void scriptTaughtLessonSession(session, plan, learnerProfile, input.language).catch((err) => {
    console.error(`Background scripting failed for session ${session.id}:`, err);
    updateLessonSessionScriptingStatus(session.id, "failed", (err as Error).message);
  });

  return NextResponse.json({ session, plan }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const learnerProfileId = req.nextUrl.searchParams.get("learnerProfileId");
  if (!learnerProfileId) {
    return NextResponse.json({ error: "learnerProfileId query param is required." }, { status: 400 });
  }
  return NextResponse.json({ sessions: listLessonSessionsForLearner(learnerProfileId) });
}
