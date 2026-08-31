import { NextRequest, NextResponse } from "next/server";
import {
  getAssessmentReportForSession,
  getConceptProgressForLearner,
  getLearnerProfile,
  getLearningPathsForLearner,
  listLessonSessionsForLearner,
} from "@/lib/db";

export const runtime = "nodejs";

/**
 * The learner-profile dashboard: every session this learner has taken, its
 * report (when completed), per-concept mastery, and any learning paths —
 * everything a second session needs to be personalized by what happened in
 * the first. Read-only; each piece is already tracked by an existing
 * accessor (lib/db/accessors/*), this just fans out to all of them for one
 * learner rather than making the client make four round trips.
 */
export async function GET(req: NextRequest) {
  const learnerProfileId = req.nextUrl.searchParams.get("learnerProfileId");
  if (!learnerProfileId) {
    return NextResponse.json({ error: "learnerProfileId query param is required." }, { status: 400 });
  }

  const profile = getLearnerProfile(learnerProfileId);
  if (!profile) {
    return NextResponse.json({ error: `Learner profile ${learnerProfileId} not found.` }, { status: 404 });
  }

  const sessions = listLessonSessionsForLearner(learnerProfileId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((session) => ({ session, report: getAssessmentReportForSession(session.id) ?? null }));

  const conceptProgress = getConceptProgressForLearner(learnerProfileId).sort((a, b) => b.lastAssessedAt.localeCompare(a.lastAssessedAt));

  const learningPaths = getLearningPathsForLearner(learnerProfileId);

  return NextResponse.json({ profile, sessions, conceptProgress, learningPaths });
}
