/**
 * Trigger or refresh portrait lookup for one character.
 * GET to lazy-resolve (only fetches if portrait is null).
 * POST to force a fresh lookup.
 */
import { NextRequest, NextResponse } from "next/server";
import { readCharacter, updateCharacterPortrait } from "@/lib/repo";
import { resolveAvatar, downloadAvatarLocally } from "@/lib/avatar";

export const runtime = "nodejs";
export const maxDuration = 60;

async function lookup(id: string, force: boolean) {
  const c = await readCharacter(id);
  if (!c) return new NextResponse("not found", { status: 404 });
  if (!force && c.meta.portrait) {
    return NextResponse.json({
      url: c.meta.portrait,
      source: c.meta.portrait_source,
      cached: true,
    });
  }
  const { url, source } = await resolveAvatar(c.meta.name);
  if (url && source) {
    // Persist the remote bytes locally so we no longer depend on the upstream
    // (Baidu hotlink blocks, wikipedia network from China, etc).
    const local = await downloadAvatarLocally(url, id);
    const finalUrl = local || url;
    const finalSource = local ? `${source}-local` : source;
    await updateCharacterPortrait(id, finalUrl, finalSource);
    return NextResponse.json({ url: finalUrl, source: finalSource, cached: false });
  }
  return NextResponse.json({ url, source, cached: false });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return lookup(id, false);
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return lookup(id, true);
}
