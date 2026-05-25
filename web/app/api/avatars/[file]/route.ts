/**
 * Avatar file streamer.
 *
 * Why this isn't just `/public/avatars/<file>`:
 * Next.js production mode scans `public/` once at server startup and builds an
 * internal route table from that snapshot. Files written to public/avatars/
 * AFTER startup (which is exactly what `downloadAvatarLocally` does on every
 * new character) are invisible to the static handler until the container
 * restarts. This API route does a filesystem read at request time, so newly
 * downloaded avatars are immediately servable.
 *
 * Storage path is unchanged — files still live at /app/web/public/avatars on
 * disk (bind-mounted to ./avatars on host) so they survive container rebuilds.
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  // Lock down to safe characters — no traversal, no hidden files.
  if (!/^[a-zA-Z0-9_\-]+\.(jpg|jpeg|png|webp|gif|svg)$/i.test(file)) {
    return new NextResponse("bad name", { status: 400 });
  }
  const dir = process.env.AVATARS_DIR
    ? process.env.AVATARS_DIR
    : join(process.cwd(), "public", "avatars");
  try {
    const buf = await readFile(join(dir, file));
    const ext = file.split(".").pop()!.toLowerCase();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": MIME[ext] || "application/octet-stream",
        // 1 day cache — avatars rarely change for a given character
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}
