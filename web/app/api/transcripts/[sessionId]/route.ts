import { NextRequest, NextResponse } from "next/server";
import { readTranscript, writeTranscript } from "@/lib/repo";
import { requireUserId } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const userId = await requireUserId();
  const t = await readTranscript(sessionId, userId);
  if (!t) return new NextResponse("not found", { status: 404 });
  return NextResponse.json(t);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const userId = await requireUserId();
  // 404-style guard: only update if the user already owns this session.
  const existing = await readTranscript(sessionId, userId);
  if (!existing) return new NextResponse("not found", { status: 404 });
  const body = await req.json();
  await writeTranscript(sessionId, userId, body);
  return NextResponse.json({ ok: true });
}
