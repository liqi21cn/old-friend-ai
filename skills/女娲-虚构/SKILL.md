---
name: 女娲-虚构
description: 为虚构角色（小说/戏剧/IP 人物/原创角色）蒸馏出可加载的角色 SKILL.md。在原版 nuwa-skill 之外补一条不依赖真实研究材料的分支：以作品文本、台词样本、关系网为输入，输出结构与女娲一致（表达 DNA / Mental Models / Decision Heuristics / Limitations），可被对话编排器无差别加载。当用户要为虚构人物（哈姆雷特、孙悟空、原创主角、改编 IP 角色等）创建角色 skill 时使用。
---

# 女娲-虚构 — 虚构角色思维框架蒸馏

## 何时使用

- 用户提到"为虚构角色生成 skill"、"原创人物"、"小说角色"、"剧本角色"、"IP 改编"。
- 用户给出一部具体作品并要求提炼其中某个人物。
- 已确认是**虚构**人物（真实在世/历史人物请使用 `nuwa-skill`，由其多源研究流程驱动）。

## 与女娲原版的关系

| 维度 | nuwa-skill（真实人物） | 女娲-虚构（本 skill） |
| --- | --- | --- |
| 子 Agent | 6 个：books / podcasts / interviews / criticism / decisions / timelines | 5 个：见下"工作流" |
| 输入 | 人物姓名 + 时代 | YAML（作品 + voice_samples + relations） |
| 验证 | 三重交叉验证（跨域 + 预测 + 独特性） | 矛盾点核对（与 core_conflict 对齐） |
| 输出格式 | `SKILL.md`（表达 DNA / 模型 / 启发式 / 限制） | **完全相同** |

下游 `对话编排` skill 不区分两种来源——只要 `SKILL.md` 结构一致就能加载。

## 输入 schema

要求用户提供以下 YAML。**缺项必须逐项询问**，不要硬编默认值：

```yaml
name: <角色姓名>
source_work: <作品名（作者，年代）>
core_conflict: <核心矛盾，一句话>
voice_samples:                # 至少 10 条原文台词
  - "..."
  - "..."
relations:                    # 关系网
  - { target: <对方名>, type: <关系类型>, status: <现状> }
worldview: <世界观/时代/文化语境>
limitations: <明确禁止讨论或运用的领域>
mental_models_hints: |        # 可选
  <作者评注、学者论文摘录、同人评论等>
```

**硬约束**：

- `voice_samples` 必须 ≥ 10 条且为原文（或权威翻译）。少于 10 条直接拒绝并要求补齐——否则蒸馏会塌缩成"古风/侠客/学者"的通用刻板模板，下游对话毫无辨识度。
- `core_conflict` 必须一句话。展开成段落则要求用户先提炼。
- `limitations` 必须显式列出该角色不可能讨论的知识/时代/世界观。

## 工作流（5 个并行子 Agent）

收到完整输入后，用 Task 工具**并行**启动 5 个子 Agent：

1. **台词语言学分析**：对 `voice_samples` 做高频词、句式（陈述/反问/感叹比例）、节奏（长短句）、修辞偏好、文体定位。输出 ≥ 3 条带原文样例的对照。
2. **关系网解析**：基于 `relations`，推断该角色在不同对手前的"人格切片"（如：对父辈/对恋人/对敌人各自的语气与策略差异）。
3. **作者/评论汇总**：基于 `mental_models_hints` 加上对作品的常识，归纳 3-7 个 mental models。每个模型必须能引一句作品原文作锚。
4. **改编差异核对**：列出该角色在主要改编版本（电影/动画/续作/同人）中被加强或弱化的特质，明确"本 skill 锚定哪个版本"，写入 limitations。
5. **矛盾点核对**：用 `core_conflict` 校验前 4 个 Agent 的产出是否一致；不一致项**标红待用户裁决**，不可自动消解。

5 个子 Agent 全部返回后，由主 Claude 整合为最终 `SKILL.md`。

## 输出 `SKILL.md` 结构

```markdown
---
name: <id>
description: <一句话：何时调用这个角色 skill。例如"演绎/对话哈姆雷特（莎士比亚原作锚点）"。>
---

# <角色名> — 思维框架

## 表达 DNA
- 句式特征
- 高频词与禁忌词
- 节奏 / 语气
- 修辞偏好（≥ 3 条样例对比："原文 vs 错误模仿"）

## Mental Models（3-7 条）
每条含：模型名 / 当此角色面对 X 时如何看待 / 一句作品原文作锚点

## Decision Heuristics（5-10 条）
"若 ... 则 ..." 句式，引用作品中具体场景作为出处。

## 关系切换
- 与 <对手 A>：语气切片 + 策略切片
- 与 <对手 B>：...

## Limitations（必须显式）
- 时代 / 世界观禁区
- 知识盲区
- 性格 anti-patterns（角色绝不会做的事）
- 改编版本边界：本 skill 锚定 <具体版本>
```

## 落地

将 `SKILL.md` 写到 `characters/fictional/<id>/SKILL.md`，同目录写 `meta.json`：

```json
{
  "id": "<id>",
  "name": "<角色名>",
  "type": "fictional",
  "era": "<年代>",
  "tags": ["..."],
  "portrait": null,
  "source_work": "<作品名>",
  "relations": [{"target": "...", "type": "...", "status": "..."}],
  "skill_path": "characters/fictional/<id>/SKILL.md"
}
```

完成后**必须**调用：

```bash
pnpm tsx scripts/index-characters.ts
```

重建 `characters/index.json`，否则下游 `对话编排` 找不到这个角色。

## 边界

- **不为真实人物使用本 skill** —— 改用 `nuwa-skill`。混用会产出虚假研究痕迹。
- 不在 voice_samples 不足时硬编。
- 不擅自合并矛盾的改编版本——多版本人格应各起一个 id（如 `hamlet-shakespeare`、`hamlet-disney`）。
