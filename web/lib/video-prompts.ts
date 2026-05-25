/**
 * Two-phase rendering prompts for the screenplay route.
 *
 * Phase A — Skeleton: take a transcript and emit a Sequence-ID-keyed shot
 *           array (NO video_segments). Cheap (~3k tokens out), one call.
 * Phase B — Video segments: for each shot, emit the △ 片段 array. Done in
 *           parallel, ~1k tokens each, controlled concurrency.
 *
 * Both phases share the same Sequence ID format (EP{2}_SC{2}_SH{3}) and the
 * same dramatic conventions distilled from doc/画面生成Agent提示词_v3.md.
 */

export const SKELETON_SYSTEM = `你是同时精通传统影视分镜与 AIGC 视频生产的资深视觉总监 / 编剧。任务：把多 Agent 对话 transcript 转为"短剧分镜表骨架"——只产出 SH 级元数据，不要 △ 片段。

## 输出（严格 JSON）

只输出一个 JSON 对象，**不要 markdown 围栏、不要任何前言或总结文字**：

{
  "shots": [
    {
      "sequence_id": "EP01_SC01_SH001",
      "shot_type": "中景 / 特写 / 过肩 / 大特写 等",
      "characters": ["角色 id"],
      "action": "可被拍到的物理动作描述（30-60 字）",
      "dialogue": [{ "speaker": "角色 id", "text": "对白原文" }],
      "beat": "施压 / 退让 / 转折 / 揭示 / 沉默 / 爆发 / 落定",
      "camera_hint": "缓推 / 拉出 / 横移 / 升降 / 固定 等",
      "duration_est": 8
    }
  ]
}

## SH 切分规则

- 每个 SH **duration_est 强制在 4-15 秒之间**（整数秒）。
- 同一场次（SC）SH 总数 **6-12 个**；超过则合并节奏相近的，少于则在节拍换挡处加空镜。
- 单段长对白拆为 2-3 个 SH（景别交错：中→特→中），避免静态。
- 开场 SH 须建立空间（建议远景或全景），末尾 SH 须落定情绪（建议特写或大特写）。
- 旁白角色 id 用 \`NARRATOR\`，characters 数组为空 \`[]\`。
- 若 transcript 末尾有 narration，**最后一个 SH 必须是 NARRATOR 镜头**。

## 写作铁律

- 全中文，不要英文。
- action 必须是「能拍到的画面」：动词 + 身体部位 / 物件，不要"思考"、"紧张"等抽象词。
- dialogue 保留对白原文字面，不要改写。
- 整体严格输出顶层只有 \`shots\` 一个键的 JSON。`;

export function buildSkeletonUserPrompt(
  idPrefix: string,
  transcript: {
    scene?: { setting?: string; conflict?: string; goal?: string };
    characters?: Array<{ id: string; name?: string }>;
    rounds?: Array<{
      round: number;
      turns: Array<{ speaker: string; text: string; action?: string | null }>;
    }>;
    narration?: string;
  },
): string {
  return [
    `请将以下对话渲染为分镜骨架。本场次 Sequence ID 前缀：${idPrefix}_SH###`,
    "",
    "## 场景元数据",
    "```json",
    JSON.stringify(transcript.scene || {}, null, 2),
    "```",
    "",
    "## 角色",
    (transcript.characters || [])
      .map(
        (c) =>
          `- ${c.id}${c.name && c.name !== c.id ? `（${c.name}）` : ""}`,
      )
      .join("\n"),
    "",
    "## 对话原文",
    "```json",
    // Strip the `citation` field — it's UI-only annotation. If we leave it
    // in, the skeleton LLM will sometimes echo the "——《source》" suffix into
    // shot.dialogue.text, which is wrong (source belongs in transcript view,
    // not in the spoken line that the video generator turns into audio).
    JSON.stringify(
      transcript.rounds || [],
      (k, v) => (k === "citation" ? undefined : v),
      2,
    ),
    "```",
    transcript.narration
      ? `\n## 收束旁白（必须作为最后一个 NARRATOR SH 出现）\n${transcript.narration}`
      : "",
    "",
    "立即输出顶层只含 `shots` 键的 JSON 对象（不要 video_segments 字段，不要 markdown 围栏）。",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Render a human-readable markdown storyboard from the skeleton shots.
 * Used both for the FS mirror (screenplays/<id>.md) and the on-screen preview.
 * Pure, no LLM call — cheap and deterministic.
 */
export function renderSkeletonMarkdown(
  prefix: string,
  shots: Array<any>,
  transcript: {
    scene?: { setting?: string };
    characters?: Array<{ id: string; name?: string }>;
  },
): string {
  const dirName = new Map<string, string>();
  for (const c of transcript.characters || []) {
    if (c.id) dirName.set(c.id, c.name || c.id);
  }
  const displayName = (id: string) =>
    id === "NARRATOR" ? "旁白" : dirName.get(id) || id;

  const lines: string[] = [];
  lines.push(`# ${prefix} 分镜稿`);
  if (transcript.scene?.setting) {
    lines.push("");
    lines.push(`**场景头**：${transcript.scene.setting}`);
  }
  const speakers = Array.from(
    new Set(
      shots.flatMap((s) => (s.characters || []).filter((id: string) => id)),
    ),
  );
  if (speakers.length > 0) {
    lines.push(
      `**人物**：${speakers.map(displayName).join("、")}`,
    );
  }
  lines.push("");

  for (const s of shots) {
    lines.push(
      `## ${s.sequence_id || ""}  ${s.shot_type || ""} · ${s.camera_hint || ""}`.trim(),
    );
    if (s.action) lines.push(`（动作）${s.action}`);
    for (const d of s.dialogue || []) {
      const speaker = displayName(d.speaker || "");
      lines.push(`${speaker}：「${d.text || ""}」`);
    }
    const beat = s.beat ? `节拍：${s.beat}` : "";
    const dur = typeof s.duration_est === "number" ? `${s.duration_est}s` : "";
    if (beat || dur) {
      lines.push([beat, dur].filter(Boolean).join(" · "));
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ===== Phase B: per-shot video segments =====

export const SEGMENTS_SYSTEM = `你是同时精通传统影视分镜与 AIGC 视频生产的资深视觉总监。任务：为单个 SH 镜头生成 △ 视频片段（time-anchored 视频生成提示词）。

## 输入

用户会给你一个 shot 对象（含 duration_est / shot_type / action / dialogue / beat 等）和上下文（场景、出场角色）。

## 输出（严格 JSON 对象，**顶层必须是对象，不要直接返回数组**）

{
  "segments": [
    {
      "time_range": "0-2s",
      "desc": "[景别] [主体] [动作过程] [运镜] [光影] [情绪技法] [风格画质]，可直接给视频模型的视觉描述，80 字以内",
      "kling_prompt": "可灵 3.0 风格中文 prompt，≤150 字，运镜词书面化",
      "seedance_prompt": "即梦 Seedance 2.0 风格中文 prompt，≤150 字，运镜词口语化",
      "image_refs": ["该 △ 出现的角色/道具 id 数组，不含场景"],
      "beat_emotion": "情绪关键词，如：紧张 / 浪漫 / 决绝",
      "dialogue": [
        { "speaker": "角色 id", "text": "该 △ 时间窗口内说出的对白原文" }
      ]
    }
  ]
}

## 对白分配规则（dialogue 字段）

- 现在的视频生成大模型支持**音画同出**，所以每个 △ 片段必须把它**时间窗口内**应该播出的对白带上。
- 输入 shot 含 \`dialogue: [{ speaker, text }]\`，**全部对白必须分配到 segments 中**——不可漏；同一句对白也不要拆成多个 △。
- 分配原则：
  - 短对白（一两句）放到「正在说话的角色被镜头聚焦」的那个 △
  - 长段对白可以从某个 △ 开始持续到下一个 △（重复 dialogue 行表示连续说话）
  - 沉默 / 动作镜头的 △ → dialogue 数组为空 \`[]\`
  - 旁白用 \`speaker: "NARRATOR"\`
- 对白原文不要改写，只决定分配到哪个 △。

**关键约束**：返回必须是 \`{ "segments": [...] }\` 这种顶层为对象的结构，不能直接返回 JSON 数组（这会让下游解析失败）。

## 时间锚定算法

对该 shot：
- N_raw = round(duration_est / 1.5)
- N_max = ceil(duration_est / 0.8)
- N = clamp(N_raw, 1, N_max)            // △ 片段个数

约束：
- 上一片段的结束秒 = 下一片段的起始秒，**无间隙**
- 所有 △ time_range 时长之和严格等于 duration_est
- 单个 △ ≥ 0.8 秒
- time_range 格式：起始-结束s，如 \`0-2s\`、\`2-3.5s\`

## 选镜映射（按情绪推断运镜）

| 情绪 | 推荐运镜 |
|---|---|
| 紧张 / 恐惧 | 快速推入、荷兰角、颤抖特写、低角度仰拍、急停定帧、底光阴影向上 |
| 愤怒 / 爆发 | 快速拉出、急停定帧、强硬侧光、瞳孔放大、暖红色调 |
| 悲伤 / 孤独 | 缓慢拉出、上帝视角、长镜压抑、阴天散射冷光、低饱和偏灰蓝 |
| 浪漫 / 温柔 | 推进亲密、弧形绕摄、回忆叠化、柔焦暖光、微光粒子 |
| 悬疑 / 揭示 | 微距缓推、窥视角度、模糊转清 |
| 决绝 / 壮烈 | 爬升仰视、子弹时间、硬朗逆光、燃烧般光晕 |
| 沉思 / 凝视 | 凝视长镜、焦点游移、阴影爬升 |

## 表演物理化（铁律）

严禁使用抽象情绪词，必须转译为可被 AI 模型捕捉的肌肉/肢体描述：
- 悲伤 → 眉头紧锁，眼眶泛红，嘴角向下拉，下颌微颤
- 愤怒 → 眉毛向内挤压，鼻翼张开，牙关紧咬，颈部青筋微现
- 惊讶 → 眉毛高扬，眼睛睁大到看见完整虹膜，嘴唇微张
- 恐惧 → 眉毛上扬内收，眼白暴露增多，嘴唇微颤
- 坚定 → 眉头微压，双眼平视不眨，嘴唇紧闭，下颌微收，脊柱挺直
- 疲惫 → 眼皮沉重半闭，肩膀塌陷脊柱前弯，呼吸缓慢沉重

## 写作铁律

1. **全中文**，不要英文。
2. **可视化**：每一个词必须能拍到画面；情绪要落到光影/肌肉/构图。
3. **一镜一焦点**：一个 △ 只描述一个主要视觉焦点 + 一个主要动作。
4. **优先级**：景别 → 主体 → 动作 → 光影 → 运镜 → 风格。
5. **负面 prompt**：每个 kling_prompt 与 seedance_prompt 末尾追加 \`【负面】模糊，低画质，畸形，多余手指，水印，文字叠加，恐怖谷效应，过度饱和，动作抽搐，面部变形\`。

## 输出约束

- 严格输出 \`{ "segments": [ ... ] }\` JSON 对象，不要 markdown 围栏，不要前言。
- segments 数组内每个对象的字段名必须与本规范严格一致（下游程序按字段名抽取）。`;

export function buildSegmentsUserPrompt(
  shot: any,
  sceneSummary: { setting?: string; conflict?: string },
  characterDirectory: Array<{ id: string; name?: string }>,
): string {
  return [
    `请为下面的 SH 镜头生成视频片段（△ 数组）。`,
    "",
    "## 场景",
    `setting: ${sceneSummary.setting || "未提供"}`,
    `conflict: ${sceneSummary.conflict || "未提供"}`,
    "",
    "## 出场角色（id → 名）",
    characterDirectory
      .filter((c) => (shot.characters || []).includes(c.id))
      .map((c) => `- ${c.id}${c.name && c.name !== c.id ? `（${c.name}）` : ""}`)
      .join("\n") || "（旁白镜头，无角色）",
    "",
    "## 镜头数据",
    "```json",
    JSON.stringify(shot, null, 2),
    "```",
    "",
    `立即输出 \`{ "segments": [...] }\` JSON 对象，segments 数组长度 = clamp(round(${shot.duration_est}/1.5), 1, ceil(${shot.duration_est}/0.8))。**所有 shot.dialogue 中的对白必须被分配到 segments[i].dialogue（不可漏、不要改写）**。不要顶层数组、不要 markdown 围栏。`,
  ].join("\n");
}
