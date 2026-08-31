import { NextResponse } from "next/server";
import { getQuestion } from "@/lib/db";

export const runtime = "nodejs";

/** A checkpoint question's prompt/options for the lesson player — never referenceAnswer, which stays server-side until evaluation. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const question = getQuestion(id);
  if (!question) return NextResponse.json({ error: `Question ${id} not found.` }, { status: 404 });

  return NextResponse.json({
    question: {
      id: question.id,
      conceptId: question.conceptId,
      sceneId: question.sceneId,
      type: question.type,
      prompt: question.prompt,
      options: question.options,
      difficulty: question.difficulty,
    },
  });
}
