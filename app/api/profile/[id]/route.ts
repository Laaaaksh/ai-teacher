import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getLearnerProfile, updateLearnerProfile } from "@/lib/db";
import { LANGUAGE_CODES } from "@/lib/teach/profile";

export const runtime = "nodejs";

const PatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  level: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  priorKnowledge: z.string().max(2000).optional(),
  goal: z.string().max(2000).optional(),
  style: z.string().max(500).optional(),
  language: z.enum(LANGUAGE_CODES).optional(),
  minutesAvailable: z.number().int().min(1).max(10080).optional(),
  depth: z.enum(["overview", "standard", "deep"]).optional(),
});

/** Returns the stored learner profile the entry screen falls back to when parsing a new instruction. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = getLearnerProfile(id);
  if (!profile) return NextResponse.json({ error: `Learner profile ${id} not found.` }, { status: 404 });
  return NextResponse.json({ profile });
}

/** Keeps the persisted profile current with whatever the learner most recently confirmed, so the next session's defaults reflect it. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getLearnerProfile(id)) return NextResponse.json({ error: `Learner profile ${id} not found.` }, { status: 404 });

  const body = await req.json().catch(() => undefined);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid patch.", issues: parsed.error.issues }, { status: 400 });
  }

  const profile = updateLearnerProfile(id, parsed.data);
  return NextResponse.json({ profile });
}
