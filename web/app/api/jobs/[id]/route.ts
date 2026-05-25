import { NextRequest, NextResponse } from "next/server";
import { getJob, cancelJob } from "@/lib/jobs";
import { requireUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await requireUserId();
  const job = await getJob(id, userId);
  if (!job) return new NextResponse("not found", { status: 404 });
  return NextResponse.json(job);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await requireUserId();
  await cancelJob(id, userId);
  return NextResponse.json({ ok: true });
}
