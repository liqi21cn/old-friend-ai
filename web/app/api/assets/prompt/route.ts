/**
 * Generate an AI image prompt for a single asset (character / scene / prop).
 *
 * Structure of the system + user prompts is distilled from
 * doc/分析提示词.docx and codified in lib/asset-prompts.ts. Variables that
 * the doc requires but our system doesn't store (年龄 / 体型 / 发色 / 材质 / ...)
 * are inferred by the LLM from the supplied SKILL.md + scene + shot actions.
 */
import { NextRequest, NextResponse } from "next/server";
import { getClient, LLM_MODEL, llmReasoningExtras } from "@/lib/llm";
import { readCharacter, readScreenplay, readTranscript } from "@/lib/repo";
import { requireUserId } from "@/lib/auth";
import {
  buildCharacterSystem,
  buildCharacterUser,
  buildSceneSystem,
  buildSceneUser,
  buildPropSystem,
  buildPropUser,
  DEFAULT_ART_STYLE,
  type ArtStyle,
} from "@/lib/asset-prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

interface IncomingAsset {
  id: string;
  name: string;
  kind: "character" | "scene" | "prop";
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    sessionId: string;
    asset: IncomingAsset;
    artStyle?: ArtStyle;
  };

  const userId = await requireUserId();
  const artStyle = (body.artStyle as ArtStyle) || DEFAULT_ART_STYLE;
  const screenplay = (await readScreenplay(body.sessionId, userId)) as Array<{
    characters?: string[];
    action?: string | null;
  }> | null;
  const transcript = await readTranscript(body.sessionId, userId);
  if (!transcript) {
    return new NextResponse("session not found", { status: 404 });
  }

  const { system, user } = await buildPrompts(
    body.asset,
    artStyle,
    transcript,
    screenplay || [],
  );

  const client = getClient();
  const resp = await client.chat.completions.create({
    model: LLM_MODEL,
    ...llmReasoningExtras(1200),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const raw = resp.choices?.[0]?.message?.content ?? "";
  const cleaned = raw
    .trim()
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .replace(/^["「『]/, "")
    .replace(/["」』]$/, "");

  return NextResponse.json({ prompt: cleaned, artStyle });
}

async function buildPrompts(
  asset: IncomingAsset,
  artStyle: ArtStyle,
  transcript: any,
  screenplay: Array<{ characters?: string[]; action?: string | null }>,
) {
  if (asset.kind === "character") {
    const charId = asset.id;
    const charData = await readCharacter(charId);
    const actionSamples = screenplay
      .filter((s) => s.characters?.includes(charId) && s.action)
      .map((s) => s.action!)
      .slice(0, 5);

    const system = buildCharacterSystem(artStyle);
    const user = buildCharacterUser({
      id: charId,
      name: charData?.meta.name || asset.name,
      type: charData?.meta.type || "real",
      era: charData?.meta.era,
      tags: charData?.meta.tags,
      sourceWork: charData?.meta.source_work,
      skill: charData?.skill || "（未找到该角色的 SKILL.md，请根据角色名推断）",
      actionSamples,
      hasCanonicalPortrait: !!charData?.meta.portrait,
    });
    return { system, user };
  }

  if (asset.kind === "scene") {
    const actionSamples = screenplay
      .filter((s) => s.action)
      .map((s) => s.action!)
      .slice(0, 6);
    const system = buildSceneSystem(artStyle);
    const user = buildSceneUser(
      {
        setting: transcript.scene?.setting || asset.name,
        conflict: transcript.scene?.conflict,
        goal: transcript.scene?.goal,
        opener: transcript.scene?.opener,
        actionSamples,
      },
      asset.name,
    );
    return { system, user };
  }

  // prop
  const actionSamples = screenplay
    .filter((s) => (s.action || "").includes(asset.name))
    .map((s) => s.action!)
    .slice(0, 4);
  const system = buildPropSystem(artStyle);
  const user = buildPropUser({
    name: asset.name,
    actionSamples,
    era: transcript.scene?.setting,
  });
  return { system, user };
}
