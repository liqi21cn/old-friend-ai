---
name: 短剧生成
description: 把多 Agent 对话 transcript 渲染为短剧/分镜脚本。输出对齐 AI 短剧制作平台 Sequence ID 规范（EP{2}_SC{2}_SH{3}），双产物 Markdown（给人读）+ JSON（给下游 import）。当用户拿到一份对话 transcript，要把它变成可拍摄的分镜稿时使用——典型触发："生成剧本"、"渲染分镜"、"出脚本"、"导出短剧"。
---

# 短剧生成 — 对白 → 分镜

## 何时使用

- 已经有一份 `transcripts/<sessionId>.json`（由 `对话编排` skill 或其 CLI 生成）。
- 用户要"分镜稿 / 剧本 / 可拍摄稿 / 短剧脚本"。

## 入口

```bash
pnpm tsx scripts/render-screenplay.ts \
  --session <sessionId> \
  --episode 1 \
  --scene-no 1
```

- `--episode` 缺省 1，`--scene-no` 缺省 1。
- 默认输出到 `screenplays/<sessionId>.{md,json}`。

## Sequence ID 规约

`EP{2位集数}_SC{2位场次}_SH{3位镜头号}`，例 `EP01_SC01_SH001`。镜头号自 001 起逐镜递增。完整规范见 `references/storyboard-spec.md`。

## 输出契约（模型必须严格遵守）

每次调用输出两段，顺序：

### 1. Markdown 分镜稿

```
# EP01_SC01 — <场次标题>
**场景头**：内/外 · <地点> · <时辰>
**人物**：<人物列表>

## SH001  <景别> · <机位运动>
（动作）<能拍到的具体行为>
<角色>：「<对白>」
节拍：<施压|退让|转折|揭示|沉默|爆发|落定> · <Ns>

## SH002  ...
...
```

### 2. JSON 块（fenced，语言标记必须为 `json`）

```json
[
  {
    "sequence_id": "EP01_SC01_SH001",
    "shot_type": "中景过肩",
    "characters": ["jobs", "musk"],
    "action": "乔布斯放下杯子，目光锁定马斯克",
    "dialogue": [
      { "speaker": "jobs", "text": "你以为火箭就是未来？" }
    ],
    "beat": "施压",
    "camera_hint": "缓推",
    "duration_est": 4
  }
]
```

**键名必须与上述完全一致**——`render-screenplay.ts` 通过正则 ` ```json...``` ` 抽取该块并直接写 `<sessionId>.json`，键名错位则下游 import 失败。

## 改写原则

1. 单段长对白拆为 2-3 个 SH（景别交错：中→特→中），避免静态画面。
2. 每 3-5 个 SH 出现一次反转/揭示节拍。
3. 开场 SH 必须建立空间，最后一个 SH 必须落定情绪。
4. 不要重写对白原文——可以拆句、加停顿（`……`）、加动作，但不可改变语义。
5. 若原 transcript 有 `action` 字段，必须保留并尽量放进对应 SH 的 `action` 字段。

## 边界

- 只接受已存在的 `transcripts/<sessionId>.json`，不自己造对白。
- 单次调用产出一个场次（SC）。若 transcript 跨多场，由用户分次调用并指定 `--scene-no`。
- Sequence ID 不可重复——同一 session 同一场次内严格递增。
