import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createLearnerProfile, listLearnerProfiles } from "@/lib/db";

export const runtime = "nodejs";

const LANGUAGE_CODES = [
  "en-IN",
  "hi-IN",
  "hinglish",
  "bn-IN",
  "ta-IN",
  "te-IN",
  "mr-IN",
  "kn-IN",
  "gu-IN",
  "ml-IN",
  "pa-IN",
] as const;

const ProfileInputSchema = z.object({
  name: z.string().min(1).max(200),
  level: z.enum(["beginner", "intermediate", "advanced"]),
  priorKnowledge: z.string().max(2000).default(""),
  goal: z.string().max(2000).default(""),
  style: z.string().max(500).default(""),
  language: z.enum(LANGUAGE_CODES),
  minutesAvailable: z.number().int().min(1).max(10080),
  depth: z.enum(["overview", "standard", "deep"]),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => undefined);
  const parsed = ProfileInputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid learner profile.", issues: parsed.error.issues }, { status: 400 });
  }

  const profile = createLearnerProfile(parsed.data);
  return NextResponse.json({ profile }, { status: 201 });
}

export async function GET() {
  return NextResponse.json({ profiles: listLearnerProfiles() });
}
