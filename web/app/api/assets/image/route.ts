/**
 * Image generation for character / scene / prop assets.
 *
 * Chain of providers, tried in order:
 *
 *   1. **Primary** — yunwu Gemini 3.1 Flash Image Preview (Google generateContent
 *      protocol). Sync request returning base64 inline image. Fast when it works.
 *      Env: IMAGE_GENERATE_URL, IMAGE_API_KEY
 *
 *   2. **Fallback** — toapis gpt-image-2 (async task model). POST creates a
 *      task, we poll until completed, then fetch the file URL and re-encode
 *      as a data URL so it survives the file's 24h expiry.
 *      Env: IMAGE_FALLBACK_BASE_URL, IMAGE_FALLBACK_API_KEY, IMAGE_FALLBACK_MODEL
 *
 *   3. **Last resort** — only when NEITHER provider is configured: a
 *      deterministic SVG placeholder. We never fall back to a placeholder
 *      after a real provider call failed; that would deceive the user.
 *
 * Returns:
 *   200 { imageUrl, source: "gemini" | "toapis" | "placeholder" }
 *   502 { error, retriable: true }   when all configured providers failed
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { withRetry } from "@/lib/retry";
import { readCharacter } from "@/lib/repo";

export const runtime = "nodejs";
export const maxDuration = 300;

interface AssetReq {
  sessionId: string;
  asset: {
    id: string;
    name: string;
    kind: "character" | "scene" | "prop";
    prompt: string;
  };
}

/**
 * For character assets where we have a canonical portrait on disk, load it
 * and return it as a base64 inline part suitable for Gemini's generateContent
 * multimodal input. The portrait acts as a visual reference so the model
 * doesn't reinvent the face every time we render the character.
 */
async function loadCharacterReference(
  asset: AssetReq["asset"],
): Promise<{ data: string; mimeType: string } | null> {
  if (asset.kind !== "character") return null;
  try {
    const c = await readCharacter(asset.id);
    const portrait = c?.meta.portrait;
    if (!portrait) return null;
    // Only handle locally-persisted portraits (post-migration). External
    // URLs would need a separate fetch + we don't want to leak referer.
    // Accept either the legacy /avatars/ prefix or the current /api/avatars/
    // one — both point at the same on-disk location.
    let relName: string | null = null;
    if (portrait.startsWith("/api/avatars/")) {
      relName = portrait.slice("/api/avatars/".length);
    } else if (portrait.startsWith("/avatars/")) {
      relName = portrait.slice("/avatars/".length);
    }
    if (!relName) return null;
    const file = join(process.cwd(), "public", "avatars", relName);
    const buf = await readFile(file);
    const ext = portrait.split(".").pop()?.toLowerCase() || "jpg";
    const mimeType =
      ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : ext === "gif"
            ? "image/gif"
            : "image/jpeg";
    return { data: buf.toString("base64"), mimeType };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const { asset } = (await req.json()) as AssetReq;

  const errors: string[] = [];

  // Pull the character's canonical portrait once — used as a visual reference
  // for the image model so the generated asset face matches our DB portrait.
  const reference = await loadCharacterReference(asset);

  // ----- Primary: Gemini -----
  const geminiUrl = process.env.IMAGE_GENERATE_URL;
  const geminiKey = process.env.IMAGE_API_KEY;
  if (geminiUrl && geminiKey) {
    try {
      const dataUrl = await withRetry(
        () => callGemini(geminiUrl, geminiKey, asset.prompt, reference),
        {
          attempts: 2,
          baseDelayMs: 3000,
          onRetry: (n, e) =>
            console.warn(
              `[image gen] gemini retry ${n}/2 for ${asset.id}: ${e.message}`,
            ),
        },
      );
      return NextResponse.json({
        imageUrl: dataUrl,
        source: reference ? "gemini+ref" : "gemini",
      });
    } catch (e: any) {
      const msg = e?.message || String(e);
      errors.push(`gemini: ${msg}`);
      console.warn(`[image gen] gemini failed for ${asset.id}: ${msg}`);
      // fall through to fallback
    }
  }

  // ----- Fallback: toapis gpt-image-2 -----
  const toapisBase = process.env.IMAGE_FALLBACK_BASE_URL;
  const toapisKey = process.env.IMAGE_FALLBACK_API_KEY;
  const toapisModel = process.env.IMAGE_FALLBACK_MODEL || "gpt-image-2";
  if (toapisBase && toapisKey) {
    try {
      const dataUrl = await withRetry(
        () => callToapis(toapisBase, toapisKey, toapisModel, asset.prompt),
        {
          attempts: 2,
          baseDelayMs: 5000,
          onRetry: (n, e) =>
            console.warn(
              `[image gen] toapis retry ${n}/2 for ${asset.id}: ${e.message}`,
            ),
        },
      );
      return NextResponse.json({ imageUrl: dataUrl, source: "toapis" });
    } catch (e: any) {
      const msg = e?.message || String(e);
      errors.push(`toapis: ${msg}`);
      console.error(
        `[image gen] toapis fallback failed for ${asset.id}: ${msg}`,
      );
    }
  }

  // ----- All real providers failed (or only placeholder configured) -----
  if (errors.length > 0) {
    return NextResponse.json(
      {
        error: `所有图像服务都失败：${errors.join(" | ").slice(0, 280)}`,
        retriable: true,
      },
      { status: 502 },
    );
  }

  // No providers configured at all → placeholder
  const dataUrl = makePlaceholderSvg(asset);
  return NextResponse.json({ imageUrl: dataUrl, source: "placeholder" });
}

/* ===== Gemini (yunwu) — synchronous generateContent ===== */

async function callGemini(
  url: string,
  key: string,
  prompt: string,
  reference: { data: string; mimeType: string } | null,
): Promise<string> {
  // Multimodal contents: reference image (if any) goes first, then the text
  // prompt. Gemini Flash Image Preview accepts this combo for "use this face
  // as the canonical look while applying the requested style/pose" workflows.
  const parts: Array<
    { text: string } | { inlineData: { data: string; mimeType: string } }
  > = [];
  if (reference) {
    parts.push({ inlineData: reference });
    parts.push({
      text: "上图是该角色的固定外貌参考。请严格保留参考图中的发型、面部特征、眼型、脸型与气质识别度；下面的描述用于控制画风、构图与服装/光影，但角色面容必须与参考图一致。",
    });
  }
  parts.push({ text: prompt });

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "x-goog-api-key": key,
    },
    body: JSON.stringify({
      contents: [{ parts }],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(
      `${resp.status}: ${errText.slice(0, 100).replace(/\s+/g, " ")}`,
    );
  }
  const data = await resp.json();
  const respParts: Array<{
    inlineData?: { mimeType?: string; data?: string };
    text?: string;
  }> = data?.candidates?.[0]?.content?.parts || [];
  for (const part of respParts) {
    const b64 = part?.inlineData?.data;
    if (b64) {
      const mime = part.inlineData?.mimeType || "image/png";
      return `data:${mime};base64,${b64}`;
    }
  }
  const firstText = respParts.find((p) => p.text)?.text;
  throw new Error(
    firstText
      ? `text-only response: ${firstText.slice(0, 120)}`
      : "no inlineData image",
  );
}

/* ===== toapis gpt-image-2 — async task with polling ===== */

async function callToapis(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
): Promise<string> {
  // 1. Start task
  const startResp = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: "1:1",
      resolution: "1K",
      response_format: "url",
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!startResp.ok) {
    const t = await startResp.text().catch(() => "");
    throw new Error(`start ${startResp.status}: ${t.slice(0, 120)}`);
  }
  const startData = await startResp.json();
  const taskId: string | undefined = startData?.id;
  if (!taskId) throw new Error("start: no task id");

  // 2. Poll — completed jobs typically in 20-40s, give 3min budget
  const pollUrl = `${baseUrl}/images/generations/${taskId}`;
  const deadline = Date.now() + 180_000;
  let imageUrl: string | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const pollResp = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!pollResp.ok) continue; // transient — keep polling
    const pollData = await pollResp.json();
    const status = pollData?.status;
    if (status === "completed") {
      imageUrl = pollData?.result?.data?.[0]?.url || null;
      break;
    }
    if (status === "failed") {
      throw new Error(
        `task failed: ${JSON.stringify(pollData?.error || pollData).slice(0, 120)}`,
      );
    }
    // pending / in_progress → keep polling
  }
  if (!imageUrl) throw new Error("poll timed out after 3 min");

  // 3. Download + base64-encode — the file URL expires in 24h, so we
  //    materialize it locally to keep DB persistence valid long-term.
  const imgResp = await fetch(imageUrl, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!imgResp.ok) {
    throw new Error(`image download ${imgResp.status}`);
  }
  const buf = Buffer.from(await imgResp.arrayBuffer());
  const mime = imgResp.headers.get("content-type") || "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/* ===== Placeholder SVG ===== */

function makePlaceholderSvg(asset: AssetReq["asset"]): string {
  const hash = Array.from(asset.id).reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue1 = hash % 360;
  const hue2 = (hash * 13) % 360;
  const kindIcon =
    asset.kind === "character" ? "◉" : asset.kind === "scene" ? "▣" : "◆";
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue1} 65% 38%)"/>
      <stop offset="100%" stop-color="hsl(${hue2} 60% 22%)"/>
    </linearGradient>
    <pattern id="n" width="3" height="3" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="0.5" fill="rgba(255,255,255,0.07)"/>
    </pattern>
  </defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <rect width="512" height="512" fill="url(#n)"/>
  <text x="50%" y="42%" text-anchor="middle" font-family="-apple-system, sans-serif"
        font-size="120" fill="rgba(255,255,255,0.92)" font-weight="700">${kindIcon}</text>
  <text x="50%" y="62%" text-anchor="middle" font-family="-apple-system, sans-serif"
        font-size="22" fill="rgba(255,255,255,0.92)" font-weight="600">${escapeXml(asset.name)}</text>
  <text x="50%" y="73%" text-anchor="middle" font-family="ui-monospace, monospace"
        font-size="11" fill="rgba(255,255,255,0.55)" letter-spacing="0.1em">${asset.kind.toUpperCase()} · PLACEHOLDER</text>
</svg>`.trim();
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
