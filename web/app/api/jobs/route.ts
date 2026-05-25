import { NextResponse } from "next/server";
import { listJobs } from "@/lib/jobs";
import { requireUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await requireUserId();
  const rows = await listJobs(userId, { limit: 20 });
  return NextResponse.json(rows);
}
