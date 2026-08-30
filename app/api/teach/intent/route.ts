import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getLearnerProfile } from "@/lib/db";
import { parseTeachingInstruction } from "@/lib/teach/profile";
import { runLlm } from "../llmErrors";

export const runtime = "nodejs";

const IntentRequestSchema = z.object({
  instruction: z.string().min(1).max(4000),
  learnerProfileId: z.string().uuid().optional(),
});

/**
 * "Understand" — POST { instruction, learnerProfileId? } -> { intent }.
 * Turns a free-text instruction ("I am a beginner, teach me Chapter 4 in
 * 20 minutes in Hindi with simple examples, ask me questions") into a
 * structured TeachingIntent, filling in anything unstated from the saved
 * learner profile when one is given.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => undefined);
  const parsed = IntentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", issues: parsed.error.issues }, { status: 400 });
  }

  const profile = parsed.data.learnerProfileId ? getLearnerProfile(parsed.data.learnerProfileId) : undefined;
  if (parsed.data.learnerProfileId && !profile) {
    return NextResponse.json({ error: `Learner profile ${parsed.data.learnerProfileId} not found.` }, { status: 404 });
  }

  const intent = await runLlm("Parsing the teaching instruction", () =>
    parseTeachingInstruction({
      instruction: parsed.data.instruction,
      fallback: profile
        ? { level: profile.level, language: profile.language, minutesAvailable: profile.minutesAvailable, depth: profile.depth, style: profile.style }
        : undefined,
    }),
  );
  if (!intent.ok) return intent.response;

  return NextResponse.json({ intent: intent.value });
}
