<div align="center">

# 旧识 · Old Friend AI

**角色技能驱动的 AI 短剧生成器**

蒸馏古今人物的思维框架 → 多 Agent 并行对话 → 渲染为可拍摄的短剧分镜。

[English](./README.en.md) · 中文

</div>

---

## 这是什么

把任意真实人物或虚构角色的"思维 DNA"压缩成一份可加载的 `SKILL.md`（表达 DNA、心智模型、决策启发、关系切换、边界约束），然后让多个角色通过多 Agent 并行扮演展开对话，最后渲染为对齐影视工业 Sequence ID（`EP{2}_SC{2}_SH{3}`）规范的分镜脚本、自动生成角色 / 场景 / 道具的画面提示词与图像。

灵感来自 [nuwa-skill](https://github.com/alchaincyf/nuwa-skill)（真实人物蒸馏 skill），本项目补了一条虚构角色分支、把多 Agent 对话编排做成 Web 应用、并把分镜稿和资产生成串成完整闭环。

## 核心特性

### 🎭 角色资产库

- 真实人物：调用 `nuwa-skill` 蒸馏（从公开言论、决策、写作中提炼）
- 虚构角色：调用本仓库 `女娲-虚构` skill（从作品原文、台词、关系网提炼）
- 单条 / 批量录入；自动从百度百科 / Wikipedia / Wikidata / Bing 拉头像，下载到本地存储

### 💬 多 Agent 并行对话

- 选 2+ 角色 + 自定义场景（设定 / 冲突 / 目标 / 开场）
- 「自动生成」按钮基于角色 SKILL.md 找出最大戏剧冲突 + 自动设计 3-6 个对话阶段
- 内置**质疑 → 阐发 → 共鸣**三段式戏剧节奏
- 每轮所有角色并行调用 LLM、按确定顺序交替发言，无连续同一人讲两句
- 单段对白 ≤80 字硬约束（适配短视频节奏）
- 偶尔引用角色自己的著作原文，引文加粗 + 内嵌出处标记
- 防重复：已说过的台词、已引用的原文不会再次出现
- 可选「旁白收尾」：全剧落幕由独立 LLM 调用生成

### 🎬 分镜稿生成

- 自动两阶段渲染：先抽出 shot 骨架，再为每个 shot 生成视频 △ 片段
- 输出对齐影视工业 Sequence ID（`EP{2}_SC{2}_SH{3}`）
- 每个 △ 片段附带画面提示词 + 对白字幕 + 镜头建议 + 时长估算

### 🖼️ 资产图像生成

- 自动从剧本结构化抽取角色 / 场景 / 道具清单
- 为每个资产自动生成 AI 绘图提示词（角色按 SKILL.md 气质 + 经典外貌锚定）
- 多 provider 出图：yunwu Gemini Flash Image（带角色肖像作视觉参考） → toapis gpt-image-2 兜底
- 所有结果落库持久化，重访不再触发重新生成

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | Next.js 15 App Router + TypeScript + Tailwind + shadcn/ui |
| 数据库 | MySQL 8.4（Drizzle ORM + mysql2） |
| LLM | OpenAI 兼容协议（默认 yunwu.ai 通道，可切到任何 OpenAI-compatible 厂商） |
| 图像 | Gemini 3.1 Flash Image Preview（主） + gpt-image-2（备） |
| 鉴权 | 外部认证 API（POST /api/external/login） + HttpOnly 加密 cookie |
| 部署 | Docker Compose（web + mysql + bind mount avatars / characters） |
| 容器化 | 多阶段 Dockerfile（pnpm 10 frozen-lockfile） |

## 快速开始（本地开发）

### 前置

- Node 22+
- pnpm 10+
- MySQL 5.7+ 或 8.x
- 一个 OpenAI 兼容的 API key

### 装依赖

```bash
cd web
pnpm install
```

### 配置环境变量

```bash
cp web/.env.example web/.env
# 编辑 web/.env 填上你的 API key 与数据库连接
```

最小配置：

```env
# LLM —— 任何 OpenAI 兼容厂商都行
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://yunwu.ai/v1
OPENAI_MODEL=gemini-3.1-pro-preview

# 推理模型预算（Claude / o-series / gemini-pro-preview 自带 thinking，需要预留 token）
OPENAI_REASONING_BUFFER=3000
OPENAI_REASONING_EFFORT=none

# MySQL
DATABASE_URL=mysql://root:123456@127.0.0.1:3306/person_skills

# Cookie 名 + HTTP 部署关掉 Secure
AUTH_COOKIE_NAME=ps_session
COOKIE_SECURE=false

# 外部认证（可选 —— 不配则任何登录都被拒）
EXTERNAL_LOGIN_URL=https://your-auth-server/api/external/login
EXTERNAL_LOGIN_API_KEY=...
```

### 起开发服务器

```bash
cd web
pnpm dev
# 浏览器打开 http://localhost:3000
```

第一次启动时，Drizzle 会自动建表（characters / jobs / job_items / transcripts / screenplays / screenplay_assets）。

### 导入示例角色（可选）

```bash
cd web
pnpm tsx scripts/import-fs-to-db.ts
```

会把仓库 `characters/` 下的 40+ 个示例角色（包含孔子、达芬奇、乔布斯、马斯克、哈姆雷特等）导入数据库。

## 部署到生产

### Docker Compose 单机部署

仓库自带 `docker-compose.yml`（web + mysql 双容器）和 `deploy.sh`（rsync + 远端 docker compose up）。

```bash
PROD_HOST=your-server-ip \
PROJECT_KEY=./your-ssh-key.pem \
./deploy.sh
```

`deploy.sh` 会：

1. rsync 项目文件到远端 `/opt/person-skills/`
2. scp `web/.env` 到远端（敏感文件，不走 git）
3. 远端执行 `docker compose up -d --build`
4. 等 MySQL healthy 后，运行一次性 `import-fs-to-db.ts` 把 `characters/` 导入 DB

### 关键环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `OPENAI_API_KEY` | ✔ | OpenAI 兼容厂商的 API key |
| `OPENAI_BASE_URL` | | 默认走 yunwu.ai；可换 OpenAI、智谱、Moonshot 等 |
| `OPENAI_MODEL` | | 默认 `gemini-3.1-pro-preview` |
| `OPENAI_REASONING_BUFFER` | | 推理模型的 thinking token 预算（默认 3000） |
| `OPENAI_REASONING_EFFORT` | | `none` / `minimal` / `low` / `medium` / `high`，默认 `none` |
| `DATABASE_URL` | ✔ | MySQL 连接串 |
| `AUTH_COOKIE_NAME` | | 默认 `ps_session` |
| `COOKIE_SECURE` | | HTTPS 部署设 `true`，HTTP 必须 `false` |
| `EXTERNAL_LOGIN_URL` | | 外部认证服务地址 |
| `EXTERNAL_LOGIN_API_KEY` | | 外部认证的 API key |
| `IMAGE_GENERATE_URL` | | 主出图 endpoint（Gemini Flash Image Preview） |
| `IMAGE_API_KEY` | | 主出图的 key |
| `IMAGE_FALLBACK_BASE_URL` | | 备用出图 endpoint（gpt-image-2） |
| `IMAGE_FALLBACK_API_KEY` | | 备用出图的 key |

完整列表见 [`web/.env.example`](./web/.env.example)。

## 目录结构

```
.
├── web/                          Next.js 应用（生产入口）
│   ├── app/
│   │   ├── api/
│   │   │   ├── dialogue/         多 Agent 对话生成（NDJSON 流）
│   │   │   ├── screenplay/       两阶段分镜骨架 + segments
│   │   │   ├── assets/           资产清单抽取 + 提示词 + 出图
│   │   │   ├── characters/       角色 CRUD + 头像 + 批量导入
│   │   │   └── auth/             外部认证登录
│   │   ├── characters/           角色画廊页
│   │   ├── dialogue/             对话工作台
│   │   ├── screenplay/[id]/      分镜稿审阅
│   │   ├── assets/[id]/          资产网格
│   │   └── storyboard/[id]/      分镜表
│   ├── lib/
│   │   ├── llm.ts                LLM 客户端 + 推理预算辅助
│   │   ├── repo.ts               DB 访问层
│   │   ├── avatar.ts             多源头像抓取 + 本地落盘
│   │   ├── video-prompts.ts      分镜骨架 + segments prompts
│   │   ├── asset-prompts.ts      角色 / 场景 / 道具图像 prompts
│   │   └── jobs.ts               DB 后端的 job 队列
│   ├── scripts/
│   │   └── import-fs-to-db.ts    一次性从 filesystem 导入 DB
│   ├── public/                   静态资源（logo + 占位）
│   └── Dockerfile                多阶段构建（deps → builder → runner）
├── characters/                   示例角色资产
│   ├── real/<id>/SKILL.md        真实人物 skill
│   └── fictional/<id>/SKILL.md   虚构角色 skill
├── skills/                       Claude Code plugin（产生 SKILL.md 的 skill）
│   ├── 女娲-虚构/                虚构角色 skill 生成器
│   ├── 对话编排/                 多 Agent 对话编排
│   ├── 短剧生成/                 对白 → 分镜稿
│   └── 角色库/                   角色资产库导航
├── scripts/                      CLI 入口（Phase 1 闭环）
│   ├── index-characters.ts       重建 characters/index.json
│   ├── run-dialogue.ts           命令行驱动对话
│   └── render-screenplay.ts      命令行渲染分镜
├── docker-compose.yml            生产编排
├── deploy.sh                     单机部署脚本
├── transcripts/                  对话原始记录（gitignored）
├── screenplays/                  分镜稿（gitignored）
└── avatars/                      头像本地缓存（gitignored）
```

## 开发指南

### 切换 LLM 厂商

所有 LLM 调用都走 OpenAI 兼容协议。换厂商只需改 `web/.env`：

```env
OPENAI_BASE_URL=https://api.openai.com/v1     # 官方 OpenAI
OPENAI_MODEL=gpt-4.1

# 或：
OPENAI_BASE_URL=https://api.anthropic.com/v1  # Anthropic Claude（通过兼容代理）
OPENAI_MODEL=claude-sonnet-4-6

# 或：
OPENAI_BASE_URL=https://api.deepseek.com/v1   # DeepSeek
OPENAI_MODEL=deepseek-chat
```

### 推理模型适配

像 Gemini Pro Preview / Claude Sonnet 等模型自带 thinking，会先消耗一批"推理 token"才输出可见内容。默认配置已经预留 3000 个推理 token 的 buffer 并设置 `reasoning_effort: none`。如果输出仍被截断，调高 `OPENAI_REASONING_BUFFER`。

### 添加新角色

两种方式：

1. **Web UI**：`/characters/new` → 单条录入 或 CSV 批量导入
2. **Claude Code**：调用 `skills/女娲-虚构` 或 `nuwa-skill`，产物落到 `characters/<type>/<id>/SKILL.md`，再 `pnpm tsx scripts/import-fs-to-db.ts` 同步进 DB

### CLI 闭环（无 web 也能跑）

```bash
# 跑一场对话
pnpm dialogue --chars jobs,musk --scene tests/scenes/mars-vs-iphone.yaml --rounds 3
# 渲染分镜
pnpm screenplay --session <sessionId>
```

## 设计原则

- **角色一致性优先**：每个角色加载完整 SKILL.md 进入 LLM 系统提示，台词由 SKILL 的「表达 DNA / Mental Models / Decision Heuristics / Limitations」反向约束
- **去 AI 味**：单段对白 ≤80 字 + 防反诘句式 + 强制每轮抛新张力 + 引文加粗 + 多 prompt 防重复
- **戏剧节奏**：「质疑 → 阐发 → 共鸣」三段式硬编码到 prompt，每轮按比例映射到当前 act
- **影视工业对齐**：Sequence ID 命名、shot 类型、duration 估算、对白音画同出，可直接喂给后续视频生成 pipeline

## 致谢

- [nuwa-skill](https://github.com/alchaincyf/nuwa-skill) —— 真实人物思维框架蒸馏的开源 skill，本项目的灵感与角色生成的核心思路均源于它

## 协议

MIT
