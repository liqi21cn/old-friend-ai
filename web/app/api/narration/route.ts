/**
 * Generate a closing narration that wraps up the dialogue's theme.
 * The narration replays the conflict + goal in a third-person voice-over
 * and lands on a thematic image. Returned as a single short paragraph.
 */
import { NextRequest, NextResponse } from "next/server";
import { getClient, LLM_MODEL, llmReasoningExtras } from "@/lib/llm";
import { requireUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  await requireUserId();
  const { transcript } = await req.json();
  if (!transcript?.rounds) {
    return new NextResponse("missing transcript", { status: 400 });
  }
  const client = getClient();

  const sceneText = [
    "场景：" + transcript.scene.setting,
    "冲突：" + transcript.scene.conflict,
    "目标：" + transcript.scene.goal,
  ].join("\n");

  const dialogueText = transcript.rounds
    .map((r: any) =>
      r.turns
        .map((t: any) => {
          const act = t.action ? `（${t.action}）` : "";
          return `${t.speaker}${act}: ${t.text}`;
        })
        .join("\n"),
    )
    .join("\n\n");

  const resp = await client.chat.completions.create({
    model: LLM_MODEL,
    ...llmReasoningExtras(600),
    messages: [
      {
        role: "system",
        content:
          "你是一位短剧旁白撰稿人。读完两个或多个角色的对话后，写一段不超过 4 句的画外音旁白，要求：\n- 第三人称\n- 呼应核心冲突和戏剧目标，但不要复述对白原文\n- 落在一个具体的物或意象上，画面感强\n- 节奏镇定，不煽情\n- 中文输出，不要英文，不要 markdown，不要引号，直接输出旁白正文。",
      },
      {
        role: "user",
        content: `${sceneText}\n\n对话原文：\n${dialogueText}\n\n请写收束旁白：`,
      },
    ],
  });

  const narration = (resp.choices?.[0]?.message?.content || "").trim();
  return NextResponse.json({ narration });
}
