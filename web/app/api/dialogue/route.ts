/**
 * Stream a multi-Agent dialogue as NDJSON.
 *
 * For each round:
 *   - All characters' Claude calls fire in parallel (Promise.all)
 *   - As each turn settles we emit {"kind":"turn","round":N,"turn":...}
 *   - Round boundary is implicit by the round number
 * When all rounds done:
 *   - {"kind":"done","sessionId":"..."}
 *
 * The transcript is persisted to ../transcripts/<sessionId>.json on completion.
 */
import { NextRequest } from "next/server";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { getClient, LLM_MODEL, llmReasoningExtras } from "@/lib/llm";
import { REPO_ROOT, readIndex, writeTranscript } from "@/lib/repo";
import { requireUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

interface DialogueStage {
  /** e.g. "痛苦根源" */
  title: string;
  /** e.g. "「欲望钟摆」 VS 「心外无物」" — typically one short clash line. */
  description: string;
}

interface RequestBody {
  characters: string[]; // ids
  scene: {
    setting: string;
    conflict: string;
    goal: string;
    opener?: string;
  };
  rounds: number;
  /** When true, append a narrator's closing line after the last dialogue turn. */
  narrator_outro?: boolean;
  /** Optional dramatic stages. If provided, each round is mapped to a stage
   *  index proportionally and the stage's title + description is injected
   *  into the per-turn brief so characters know which beat they're playing. */
  stages?: DialogueStage[];
}

// Soft cap on each utterance — short and punchy works better for short-form
// video (≈5-7s of spoken line per turn). We trim the tail at parse time as a
// hard guarantee in case the model overshoots.
const MAX_UTTERANCE_CHARS = 80;

interface Turn {
  speaker: string;
  /** Full spoken line. The quoted passage IS included inline (as the
   *  character actually says it out loud), but the source attribution is
   *  NOT — that lives in `citation.source` and is only rendered in the
   *  transcript UI, never spoken / subtitled. */
  text: string;
  action: string | null;
  /** Optional self-quote. `quote` is an exact substring of `text` that the
   *  UI bolds; `source` is rendered right after the quote like 【出自《xxx》】.
   *  Video / screenplay pipelines strip this field so the source never
   *  leaks into spoken dialogue. */
  citation?: { quote: string; source: string } | null;
}

// (No more early-stop pattern check. Round count is user-chosen — respect it.
//  Earlier versions broke out of the loop when the LLM said "落幕"; that was
//  fragile because the model would converge by round 2 even when the user
//  asked for 5 rounds.)

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RequestBody;
  if (!body.characters || body.characters.length < 2) {
    return new Response("at least 2 characters required", { status: 400 });
  }
  const userId = await requireUserId();
  console.log(
    `[dialogue] ${userId} chars=${body.characters.join(",")} rounds=${body.rounds} narrator=${body.narrator_outro ?? false}`,
  );

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const emit = (obj: any) =>
        controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));

      try {
        const index = await readIndex();
        const chars = body.characters.map((id) => {
          const m = index.find((c) => c.id === id);
          if (!m) throw new Error(`character not found: ${id}`);
          return m;
        });

        const skills = await Promise.all(
          chars.map(async (c) => ({
            id: c.id,
            name: c.name,
            skill: await readFile(join(REPO_ROOT, c.skill_path), "utf8"),
          })),
        );

        const sessionId = randomUUID().slice(0, 8);
        const client = getClient();

        const transcript: any = {
          sessionId,
          startedAt: new Date().toISOString(),
          scene: body.scene,
          characters: chars.map((c) => ({
            id: c.id,
            name: c.name,
            skillPath: c.skill_path,
          })),
          rounds: [],
        };

        const allIds = chars.map((c) => c.id);

        // Persist the stages onto the transcript so screenplay rendering can
        // see the dramatic arc (each stage maps to a markdown section header).
        const stages =
          Array.isArray(body.stages) && body.stages.length > 0
            ? body.stages.filter(
                (s) => s && typeof s.title === "string" && s.title.trim(),
              )
            : [];
        if (stages.length > 0) {
          transcript.stages = stages;
        }
        const currentStage = (round: number): DialogueStage | null => {
          if (stages.length === 0) return null;
          // Distribute rounds evenly across stages: round r (1-indexed) →
          // stages[floor((r-1) * N / R)]. e.g. 5 rounds + 4 stages → stages
          // 1,1,2,3,4. With fewer rounds than stages, some stages are skipped.
          const idx = Math.min(
            stages.length - 1,
            Math.floor(((round - 1) * stages.length) / body.rounds),
          );
          return stages[idx];
        };

        // Map a round to its position in the three-act arc:
        //   front third → "质疑期" (mutual challenge, mild disdain)
        //   middle third → "阐发期" (deep exposition from own classics)
        //   back third → "共鸣期" (mutual respect / fated split)
        // Tonal guidance is injected into the per-turn brief so even when
        // stages are absent or hand-edited, characters still hit the arc.
        const arcPhase = (round: number): {
          name: string;
          guidance: string;
        } => {
          const t = (round - 0.5) / body.rounds; // round 1's midpoint
          if (t < 1 / 3) {
            return {
              name: "质疑期（前 1/3）",
              guidance:
                "本段的情绪基调是『互相质疑、带一点轻蔑或不以为然』。以自身价值体系为绝对前提，直指对方根本预设的漏洞；可以显出『你这点子东西也敢登大雅之堂』的姿态，但不要流于人身攻击。**不要**在这一段就互相承认对方的体系有价值。",
            };
          }
          if (t < 2 / 3) {
            return {
              name: "阐发期（中 1/3）",
              guidance:
                "本段放下针对对方，**深入阐发自己经典著作中的核心命题**，把本派系的体用、心法、推演逻辑展开。引用频率可适当提高到 1/2，**优先引用自己最有代表性的著作**。这一段是思想厚度的高潮。",
            };
          }
          return {
            name: "共鸣期（后 1/3）",
            guidance:
              "本段进入『惺惺相惜』或『各自坚守』的层面。经过前面的阐发，你已看到对方体系的内在自洽与崇高，可以承认对方是真正的对手 / 知己，但你**仍坚守你自己的道**。语气从对峙转向沉静，可以带一丝惋惜或敬意；但不要『达成共识』，必须保留各自的本色。",
          };
        };

        for (let r = 1; r <= body.rounds; r++) {
          console.log(`[dialogue ${sessionId}] round ${r}/${body.rounds} starting`);
          const roundT0 = Date.now();
          const history = renderHistory(transcript);
          const stage = currentStage(r);
          const arc = arcPhase(r);
          // Collect every citation quote already used so far, per speaker.
          // Injected into each character's prompt as a do-not-repeat list.
          const usedBySpeaker = new Map<string, string[]>();
          for (const round of transcript.rounds) {
            for (const t of round.turns) {
              const q = t.citation?.quote?.trim();
              if (!q) continue;
              const arr = usedBySpeaker.get(t.speaker) || [];
              arr.push(q);
              usedBySpeaker.set(t.speaker, arr);
            }
          }
          const turns = await Promise.all(
            skills.map(async (c) => {
              const t0 = Date.now();
              const myUsedQuotes = usedBySpeaker.get(c.id) || [];
              const noRepeatBlock =
                myUsedQuotes.length > 0
                  ? [
                      "",
                      "【你已经引用过的原文（本轮及此后绝对不可再引用 / 复述）】",
                      ...myUsedQuotes.map((q, i) => `${i + 1}. ${q}`),
                      "本轮如果要再引用，请挑你著作中的另一句不同的原文；若没有合适的新引文，则 citation 填 null，把张力留在白话台词里。",
                    ].join("\n")
                  : "";
              const sys = [
                c.skill,
                "",
                "---",
                "你正在参与一场多 Agent 戏剧对话。每轮你只能发一段话和可选动作，严格遵守你自己的 SKILL 文档（包括 Limitations）。",
                `每段对白严格控制在 ${MAX_UTTERANCE_CHARS} 个汉字以内（含标点），台词必须凝练，不许铺陈背景或重复信息。`,
              ].join("\n");
              const userPrompt = [
                history,
                "",
                stageBrief(body.scene, allIds, c.id, r, stage, stages, arc),
                noRepeatBlock,
                "",
                `严格输出 JSON：{"action": string | null, "text": string, "citation": null | {"quote": string, "source": string}}。不要任何其他文字，不要 markdown 围栏。`,
                `- text：你要说的话，长度 ≤ ${MAX_UTTERANCE_CHARS} 个汉字（含标点）。**台词要短促有力**，最多 1-2 句即可，宁可点到即止也不要长段铺陈。可以在里面直接说出引用的原文（如"故曰，治大国若烹小鲜"），但**不要**把书名/出处塞进 text，出处只放 citation.source。`,
                `- citation：若本段引用了你自己的著作/言论原文，则填 {"quote": "...引用原文...", "source": "《xxx·yy》"}。要求：`,
                `  · quote **必须是 text 中的一个完全相同的子串**（连续字符一致），且最好出现在 text 的**中段**而不是结尾（让出处标记自然嵌在句子中间，引文后还有少量后续）。`,
                `  · source 为书名/篇章（如《道德经·第十章》《作为意志和表象的世界》），不要瞎编不存在的著作；不要引用别人的著作；SKILL.md 没给可考著作就保持 null。`,
                `  · 引用频率 ≤ 1/3（不要每轮都引）。`,
              ].join("\n");

              const resp = await client.chat.completions.create({
                model: LLM_MODEL,
                ...llmReasoningExtras(1024),
                response_format: { type: "json_object" } as any,
                messages: [
                  { role: "system", content: sys },
                  { role: "user", content: userPrompt },
                ],
              });
              const raw = resp.choices?.[0]?.message?.content ?? "";
              const parsed = parseTurn(raw);
              let text = clampUtterance(parsed.text || raw.trim());
              let citation = parsed.citation ?? null;

              // Defensive 1 — model occasionally leaves "——《xxx》" or "【出自《xxx》】"
              // inside text. Lift it out so video pipeline gets clean text.
              const inlineSourceMatch =
                text.match(/【出自[《〈]([^》〉]+)[》〉][^】]*】/u) ||
                text.match(/\s*[（(]\s*出自[《〈]([^》〉]+)[》〉]\s*[)）]/u) ||
                text.match(/\s*(?:—{1,2}|--+|出自)\s*[《〈]([^》〉]+)[》〉]/u);
              if (inlineSourceMatch) {
                const sourceName = `《${inlineSourceMatch[1]}》`;
                text =
                  text.slice(0, inlineSourceMatch.index) +
                  text.slice(
                    inlineSourceMatch.index! + inlineSourceMatch[0].length,
                  );
                text = text.replace(/\s+/g, " ").trim();
                if (!citation) citation = { quote: "", source: sourceName };
                else if (!citation.source) citation.source = sourceName;
              }

              // Defensive 2 — if citation present but quote isn't an exact
              // substring of text, fall back to "no inline highlight" mode.
              // We do NOT drop the citation entirely; the UI then renders the
              // source as a small footer tag rather than an inline bold span.
              if (citation && citation.quote && !text.includes(citation.quote)) {
                citation = { quote: "", source: citation.source };
              }

              // Defensive 3 — backstop the no-repeat rule. If the LLM still
              // returned a quote we've already used for this speaker, drop
              // the citation entirely; better no citation than a duplicate.
              if (citation && citation.quote) {
                const dupQuote = (usedBySpeaker.get(c.id) || []).some(
                  (q) => q && (q === citation!.quote || citation!.quote.includes(q) || q.includes(citation!.quote)),
                );
                if (dupQuote) citation = null;
              }

              const turn: Turn = {
                speaker: c.id,
                text,
                action: parsed.action ?? null,
                citation: citation && citation.source ? citation : null,
              };
              console.log(
                `[dialogue ${sessionId}] r${r} ${c.id} done in ${Date.now() - t0}ms`,
              );
              return turn;
            }),
          );
          console.log(
            `[dialogue ${sessionId}] round ${r} settled in ${Date.now() - roundT0}ms`,
          );

          // Emit turns in deterministic speaker order (matches the `skills`
          // / `body.characters` ordering) so the rendered transcript
          // alternates A→B→A→B without ever putting two adjacent turns from
          // the same speaker.
          for (const turn of turns) {
            emit({ kind: "turn", round: r, turn });
          }

          transcript.rounds.push({ round: r, turns });
        }

        // Optional: narrator's closing line appended as a final synthetic
        // turn with speaker="__narrator". Saved into transcript.narration
        // so downstream screenplay rendering can reuse it.
        if (body.narrator_outro) {
          try {
            const narration = await generateNarration(
              client,
              body.scene,
              transcript.rounds,
              chars,
            );
            transcript.narration = narration;
            const outroTurn: Turn = {
              speaker: "__narrator",
              text: narration,
              action: null,
            };
            emit({
              kind: "turn",
              round: (transcript.rounds.at(-1)?.round || body.rounds) + 1,
              turn: outroTurn,
            });
          } catch (e: any) {
            // Don't fail the whole session if the narrator call fails.
            console.warn("[dialogue] narrator outro failed:", e?.message);
          }
        }

        await writeTranscript(sessionId, userId, transcript);
        emit({ kind: "done", sessionId });
        controller.close();
      } catch (e: any) {
        emit({ kind: "error", message: e.message || String(e) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function renderHistory(t: any): string {
  const head = [
    "【场景】 " + t.scene.setting,
    "【核心冲突】 " + t.scene.conflict,
    "【戏剧目标】 " + t.scene.goal,
  ];
  if (t.scene.opener) head.push("【开场】 " + t.scene.opener);

  if (t.rounds.length === 0) return head.join("\n");

  const body: string[] = [...head, "", "【已发生的对话】"];
  for (const round of t.rounds) {
    body.push(`-- 第 ${round.round} 轮 --`);
    for (const turn of round.turns) {
      const act = turn.action ? `（${turn.action}）` : "";
      // For LLM context, append source as a footnote so subsequent rounds
      // know which work was quoted; the UI uses the structured citation
      // field separately to render an inline bold quote + source tag.
      const cite = turn.citation?.source ? ` 〔出自${turn.citation.source}〕` : "";
      body.push(`${turn.speaker}${act}: ${turn.text}${cite}`);
    }
  }
  return body.join("\n");
}

function stageBrief(
  scene: any,
  ids: string[],
  myId: string,
  round: number,
  stage: DialogueStage | null,
  allStages: DialogueStage[],
  arc: { name: string; guidance: string },
) {
  const others = ids.filter((x) => x !== myId).join("、");
  const arcLines = [
    "",
    "【三段式中的位置】",
    `本轮处于：${arc.name}`,
    arc.guidance,
  ];
  const stageLines: string[] = [];
  if (stage) {
    stageLines.push(
      "",
      "【本轮所处阶段】",
      `阶段名：${stage.title}`,
      `阶段描述：${stage.description}`,
      "本轮的对白必须围绕该阶段的张力点展开，推进该阶段对应的戏剧节拍；不要跳到后续阶段，也不要回到前序阶段。",
    );
    if (allStages.length > 1) {
      stageLines.push(
        `（本剧完整阶段次序：${allStages
          .map((s, i) => `${i + 1}.${s.title}`)
          .join(" → ")}）`,
      );
    }
  }
  return [
    "# 你的回合",
    `当前是第 ${round} 轮。`,
    `你的角色 id：${myId}`,
    `同台对手：${others}`,
    ...arcLines,
    ...stageLines,
    "",
    "规则：",
    "- 严格遵守你的 SKILL 文档中的『表达 DNA』、『Decision Heuristics』、『Limitations』。",
    "- 必须推动冲突或暴露立场，不可空泛附和。",
    "- 一段对白 + 可选的一个动作。动作必须能被镜头拍到。",
    "- 【说服方式】各持己见、用你自己的逻辑/经验/价值观去『陈述自己的主张』来说服对方，避免连续使用『你怎么…』『难道你不觉得…』『你看不到吗…』这种针对对方的反诘句。请多用『我认为』『以我之见』『按我多年的体会』『根据我观察到的事实』等自陈句式来推动你的立场；只有在揭穿对方明显错误的关键节点才偶尔用反问。",
    "- 【绝不重复】本场对话中，已经被你或对方说过的整句台词、已经引用过的著作原文，**绝对不可再次出现**。每一轮你必须说新的话、引新的句。复述对方的话需要用自己的转述并明显推进语义；不可只是把对方的话换几个字。",
    "- 不要试图过早收束戏剧目标 —— 每一轮都要抛出新的信息、立场或张力点，给对手新的反应空间。最终收束由调度层在所有轮次跑完后处理，本轮不要出现『落幕』『对话结束』『结束』之类的收场词。",
  ].join("\n");
}

/**
 * Hard-cap per-utterance length. Counts code points (1 per emoji / Chinese
 * character) so the MAX_UTTERANCE_CHARS rule reads naturally to users.
 */
function clampUtterance(s: string): string {
  if (!s) return s;
  const chars = Array.from(s);
  if (chars.length <= MAX_UTTERANCE_CHARS) return s;
  return chars.slice(0, MAX_UTTERANCE_CHARS - 1).join("") + "…";
}

/**
 * One-shot narrator wrap-up. Reads the full transcript, emits a 1-2 sentence
 * closing line in the voice of an off-screen narrator. Stored in
 * transcript.narration and also emitted as a final synthetic turn.
 */
async function generateNarration(
  client: ReturnType<typeof getClient>,
  scene: RequestBody["scene"],
  rounds: any[],
  chars: any[],
): Promise<string> {
  const dialogue = rounds
    .flatMap((r: any) =>
      r.turns.map((t: any) => {
        const name = chars.find((c) => c.id === t.speaker)?.name || t.speaker;
        return `${name}：${t.text}`;
      }),
    )
    .join("\n");
  const sys = [
    "你是一位短剧旁白，文字凝练、留白克制。",
    "用一段不超过 80 字的中文写出全剧收束：点出冲突结局或情绪余韵，不要复述对白原文，不要使用引号。",
  ].join("\n");
  const user = [
    `【场景】${scene.setting}`,
    `【核心冲突】${scene.conflict}`,
    `【戏剧目标】${scene.goal}`,
    "",
    "【对白】",
    dialogue,
    "",
    "直接输出旁白一段（不要前缀、不要标题、不要『旁白：』字样）。",
  ].join("\n");
  const resp = await client.chat.completions.create({
    model: LLM_MODEL,
    ...llmReasoningExtras(400),
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  });
  return (resp.choices?.[0]?.message?.content || "").trim();
}

function parseTurn(raw: string): {
  text?: string;
  action?: string | null;
  citation?: { quote: string; source: string } | null;
} {
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const direct = tryParse(raw.trim());
  const obj =
    (direct && typeof direct === "object" ? direct : null) ||
    (() => {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        const p = tryParse(m[0]);
        if (p && typeof p === "object") return p;
      }
      return null;
    })();
  if (!obj) return {};
  // Normalize citation — LLM sometimes returns just a string (source only),
  // sometimes the new {quote, source} shape, sometimes the legacy {source}.
  let citation: { quote: string; source: string } | null = null;
  const raw_c = (obj as any).citation;
  if (raw_c && typeof raw_c === "object" && typeof raw_c.source === "string") {
    citation = {
      quote:
        typeof raw_c.quote === "string" ? raw_c.quote.trim() : "",
      source: raw_c.source.trim(),
    };
  } else if (typeof raw_c === "string" && raw_c.trim()) {
    citation = { quote: "", source: raw_c.trim() };
  }
  return {
    text: typeof (obj as any).text === "string" ? (obj as any).text : undefined,
    action: (obj as any).action ?? null,
    citation,
  };
}
