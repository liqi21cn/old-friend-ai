import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  if (!s) return new NextResponse("not authenticated", { status: 401 });
  return NextResponse.json({ user: s.user, issuedAt: s.issuedAt });
}
