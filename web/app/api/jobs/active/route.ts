import { NextResponse } from "next/server";
import { listActiveJobs } from "@/lib/jobs";
import { requireUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await requireUserId();
  const rows = await listActiveJobs(userId);
  return NextResponse.json(rows);
}
