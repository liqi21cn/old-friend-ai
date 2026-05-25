import { NextRequest, NextResponse } from "next/server";
import { writeNewCharacter, type CharacterMeta } from "@/lib/repo";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { meta, skill } = (await req.json()) as {
    meta: CharacterMeta;
    skill: string;
  };
  if (!meta?.id || !meta?.name || !meta?.type || !skill) {
    return new NextResponse("missing fields", { status: 400 });
  }
  try {
    await writeNewCharacter(meta, skill);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return new NextResponse(e.message || String(e), { status: 500 });
  }
}
