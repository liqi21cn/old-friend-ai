/**
 * Persistence for assets generated on the /assets/[sessionId] board.
 *
 *   GET  → list all assets stored for this session+user
 *   PUT  → upsert one asset by (kind, name) — patch semantics:
 *          fields omitted in the body are left unchanged
 *   DELETE → remove one asset (e.g. user clicked × on a card)
 */
import { NextRequest, NextResponse } from "next/server";
import {
  readSessionAssets,
  upsertSessionAsset,
  deleteSessionAsset,
} from "@/lib/repo";
import { requireUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Kind = "character" | "scene" | "prop";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const userId = await requireUserId();
  const assets = await readSessionAssets(sessionId, userId);
  return NextResponse.json({ assets });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const userId = await requireUserId();
  const body = (await req.json()) as {
    kind?: Kind;
    name?: string;
    prompt?: string | null;
    imageUrl?: string | null;
    imageSource?: string | null;
  };
  if (
    !body.kind ||
    !["character", "scene", "prop"].includes(body.kind) ||
    !body.name?.trim()
  ) {
    return new NextResponse("kind and non-empty name are required", {
      status: 400,
    });
  }
  await upsertSessionAsset(sessionId, userId, {
    kind: body.kind,
    name: body.name.trim(),
    prompt: body.prompt,
    imageUrl: body.imageUrl,
    imageSource: body.imageSource,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const userId = await requireUserId();
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") as Kind | null;
  const name = url.searchParams.get("name");
  if (
    !kind ||
    !["character", "scene", "prop"].includes(kind) ||
    !name?.trim()
  ) {
    return new NextResponse("kind and name query params required", {
      status: 400,
    });
  }
  await deleteSessionAsset(sessionId, userId, kind, name.trim());
  return NextResponse.json({ ok: true });
}
