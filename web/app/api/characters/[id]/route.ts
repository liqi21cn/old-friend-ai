import { NextRequest, NextResponse } from "next/server";
import { rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import {
  readCharacter,
  writeCharacterSkill,
  readIndex,
  REPO_ROOT,
  CHARACTERS_DIR,
} from "@/lib/repo";
import { writeFile } from "node:fs/promises";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const data = await readCharacter(id);
  if (!data) return new NextResponse("not found", { status: 404 });
  return NextResponse.json(data);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { skill } = await req.json();
  if (typeof skill !== "string") {
    return new NextResponse("skill must be string", { status: 400 });
  }
  try {
    await writeCharacterSkill(id, skill);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return new NextResponse(e.message || String(e), { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const data = await readCharacter(id);
  if (!data) return new NextResponse("not found", { status: 404 });

  const dir = dirname(join(REPO_ROOT, data.meta.skill_path));
  await rm(dir, { recursive: true, force: true });

  // Rebuild index without this id
  const remaining = (await readIndex()).filter((c) => c.id !== id);
  await writeFile(
    join(CHARACTERS_DIR, "index.json"),
    JSON.stringify(remaining, null, 2) + "\n",
    "utf8",
  );
  return NextResponse.json({ ok: true });
}
