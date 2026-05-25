---
name: 对话编排
description: 让多个已生成的角色 skill 在共享场景下，通过多 Agent 并行扮演进行多轮对话。每轮内所有角色同时发言（避免顺序偏置），输出标准 transcript JSON 供下游 `短剧生成` skill 渲染。当用户想让两个或更多角色对话、辩论、演一场戏时使用——例如"让乔布斯和马斯克聊聊"、"哈姆雷特和奥菲莉亚的告别戏"。
---

# 对话编排 — 多 Agent 并行扮演

## 何时使用

- 用户说"让 X 和 Y 聊聊 / 对话 / 辩论 / 演一场"。
- 用户已经选定 ≥ 2 个角色 id，且这些 id 必须在 `characters/index.json` 中存在（若不存在，先引导调用 `nuwa-skill` 或 `女娲-虚构` 生成）。

## 入口（两种）

### A. CLI（推荐，性能与可重现性最佳）

```bash
pnpm tsx scripts/run-dialogue.ts \
  --chars jobs,musk \
  --scene tests/scenes/mars-vs-iphone.yaml \
  --rounds 3
```

CLI 直接调用 `@anthropic-ai/sdk`，并行 fan-out 给每个角色，不经 Claude Code 的 Task 隧道。Phase 2 Web 后端会复用同一段核心逻辑（`scripts/run.ts`）。

### B. Claude Code 内手动编排（当 CLI 不可用时）

1. 读取并向用户展示 `characters/index.json`，让其选 2-N 个角色。
2. 起草场景 YAML（见下）。
3. 用 Task 工具**并行**spawn N 个子 Agent，每个：
   - 加载该角色 `SKILL.md` 作为 system 提示
   - 收到截至上一轮的 transcript + "你的回合"
   - 输出严格 JSON：`{"action": "...", "text": "..."}`
4. 收齐本轮所有发言后，写入 transcript，进入下一轮。
5. 达到 `rounds` 上限或检测到终止关键词时停止。
6. 保存到 `transcripts/<sessionId>.json`。

**关键**：每轮内的发言必须**并行**而不是顺序——顺序生成会让后发言的角色偏向附和先发言的角色，破坏对抗张力。

## 场景 YAML schema

```yaml
setting: 加州咖啡馆，黄昏
conflict: 火星殖民优先 vs iPhone 17 发布优先
goal: 一方承认对方主张的合理性，或两人接受不和而散
opener: 马斯克刚把一份火星建造图甩在桌上（可选）
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `setting` | ✅ | 时空 + 物理环境，越具体越能落镜头 |
| `conflict` | ✅ | 单句明确两边立场 |
| `goal` | ✅ | 戏剧目标（推进方向） |
| `opener` | ❌ | 开场触发动作，第一轮的诱因 |

## Transcript JSON 结构（落盘）

```json
{
  "sessionId": "abc12345",
  "startedAt": "2026-05-13T07:00:00.000Z",
  "scene": { "setting": "...", "conflict": "...", "goal": "...", "opener": "..." },
  "characters": [
    { "id": "jobs", "name": "Steve Jobs", "skillPath": "characters/real/jobs/SKILL.md" }
  ],
  "rounds": [
    {
      "round": 1,
      "turns": [
        { "speaker": "jobs", "action": "放下杯子", "text": "你以为火箭就是未来？" },
        { "speaker": "musk", "action": null, "text": "不是以为，是必然。" }
      ]
    }
  ]
}
```

## 规约

- 每个角色每轮**只发一段**对白和可选动作。
- 严格遵守角色 SKILL.md 中的 `Limitations` ——越界产物（讨论该角色不可能讨论的话题、用其禁忌词、使用错误时代知识）视为失败，重试。
- 终止关键词：任一角色对白包含 `落幕 / 对话结束 / conflict_resolved` 时立刻停。
- 不主动加旁白和环境描写——这些归 `短剧生成` skill 处理。

## 与下游对接

输出 transcript 路径打印在命令行（"transcript saved → …"）。接着：

```bash
pnpm tsx scripts/render-screenplay.ts --session <sessionId>
```

即得分镜。
