import { NextResponse } from "next/server";
import { getLearningPath } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const path = getLearningPath(id);
  if (!path) return NextResponse.json({ error: `Learning path ${id} not found.` }, { status: 404 });
  return NextResponse.json({ path });
}
