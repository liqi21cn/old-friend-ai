---
name: 角色库
description: 角色资产库的导航与维护规约。说明 characters/ 目录结构、meta.json schema、索引重建。当用户问"有哪些角色"、"怎么添加角色"、"如何整理 character"、"角色库结构"时使用。
---

# 角色库

## 目录结构

```
characters/
├── real/<id>/
│   ├── SKILL.md          # nuwa-skill 产出
│   └── meta.json
├── fictional/<id>/
│   ├── SKILL.md          # 女娲-虚构 产出
│   └── meta.json
└── index.json            # 由脚本生成，勿手编
```

## id 规则

- 小写、ASCII、连字符 `-` 分隔。
- 中文人物用拼音：`sun-wukong`、`zhuang-zi`。
- 同人物多版本要分 id：`hamlet-shakespeare` / `hamlet-disney` / `hamlet-modern`。
- 不要与已有 id 冲突——先 `cat characters/index.json | grep '"id"'` 检查。

## meta.json schema

```json
{
  "id": "jobs",
  "name": "Steve Jobs",
  "type": "real",
  "era": "1955-2011",
  "tags": ["产品", "极简", "现实扭曲力场"],
  "portrait": null,
  "source_work": null,
  "relations": [],
  "skill_path": "characters/real/jobs/SKILL.md"
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 见上方 id 规则 |
| `name` | ✅ | 展示名（可中文） |
| `type` | ✅ | `real` 或 `fictional` |
| `era` | ✅ | 时代标签，自由文本 |
| `tags` | ✅ | 用于画廊筛选 |
| `portrait` | ❌ | 头像 URL 或本地路径 |
| `source_work` | fictional 必填 | 作品名 |
| `relations` | fictional 推荐 | 关系网 |
| `skill_path` | ✅ | 相对仓库根的 SKILL.md 路径 |

## 维护流程

### 添加角色

1. 调用 `nuwa-skill`（真人）或 `女娲-虚构`（虚构）生成 `SKILL.md`。
2. 在同目录写 `meta.json`。
3. 重建索引：
   ```bash
   pnpm tsx scripts/index-characters.ts
   ```
4. 在 `transcripts/` 跑一场轻量对话验证 SKILL.md 是否能被加载且语气可识别。

### 修改/删除

修改 `meta.json` 或 `SKILL.md` 后**必须**重建索引——否则 `run-dialogue.ts` 仍按旧 index 查找路径。

删除时整个 `<id>/` 目录移走，再重建索引。

## 浏览

- 命令行：`cat characters/index.json | jq` 或 `jq 'map(.name)' characters/index.json`
- Phase 2 Web 画廊：`/` 路由

## 当前角色数

读 `characters/index.json` 的数组长度即可。空索引代表尚未生成任何角色——引导用户先用 `nuwa-skill` 或 `女娲-虚构`。
