<div align="center">

# Old Friend AI · 旧识

**Character-skill-driven AI mini-drama generator**

Distill the cognitive DNA of any real or fictional figure → orchestrate multi-agent dialogue → render shoot-ready storyboards.

[中文](./README.md) · English

</div>

---

## What is this

This project compresses any real or fictional character's "cognitive DNA" into a loadable `SKILL.md` (expression DNA, mental models, decision heuristics, relationship modes, hard limits). It then lets multiple characters play out a multi-round dialogue via parallel agent calls, and finally renders the transcript into an industry-aligned storyboard (Sequence ID `EP{2}_SC{2}_SH{3}`) with auto-generated character/scene/prop visual prompts and images.

Inspired by [nuwa-skill](https://github.com/alchaincyf/nuwa-skill) (real-person distillation skill). This project adds a fictional-character branch, wraps multi-agent orchestration in a web app, and ties storyboard rendering and asset generation into one full loop.

## Features

### 🎭 Character library

- Real persons: distilled via `nuwa-skill` (from public speech, decisions, writings)
- Fictional characters: distilled via the bundled `女娲-虚构` skill (from canonical text, dialogue samples, relationship graph)
- Single or batch ingestion; auto-fetches portraits from Baidu Baike / Wikipedia / Wikidata / Bing and persists locally

### 💬 Multi-agent dialogue

- Pick 2+ characters + a scene (setting / conflict / goal / opener)
- "Auto-generate" finds the sharpest dramatic friction from the SKILL.md set and proposes 3-6 dialogue stages
- Built-in three-act rhythm: **challenge → exposition → resonance**
- All characters fire LLM calls in parallel within a round, emitted in deterministic order so two adjacent turns are never from the same speaker
- Hard cap: 80 Chinese chars per utterance (sized for short-form video pacing)
- Characters occasionally quote from their own canonical work — quote bolded, source tag inlined right after
- Anti-repeat: previously spoken lines and previously quoted passages cannot resurface
- Optional "narrator outro": a separate LLM call writes a closing line after the last turn

### 🎬 Storyboard generation

- Two-phase rendering: extract shot skeleton first, then generate per-shot video micro-segments
- Output aligned to film-industry Sequence IDs (`EP{2}_SC{2}_SH{3}`)
- Each segment carries an image prompt, dialogue subtitle, camera hint, duration estimate

### 🖼️ Asset image generation

- Structured extraction of characters / scenes / props from the storyboard
- Per-asset AI image prompts auto-generated; characters anchored to their canonical appearance via the SKILL.md expression DNA
- Multi-provider chain: yunwu Gemini Flash Image (with portrait as visual reference) → toapis gpt-image-2 fallback
- Everything persisted to DB, never regenerated on revisit

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | Next.js 15 App Router + TypeScript + Tailwind + shadcn/ui |
| Database | MySQL 8.4 (Drizzle ORM + mysql2) |
| LLM | OpenAI-compatible protocol (default: yunwu.ai; swap to any compatible provider) |
| Images | Gemini 3.1 Flash Image Preview (primary) + gpt-image-2 (fallback) |
| Auth | External login API (POST /api/external/login) + HttpOnly encrypted cookie |
| Deploy | Docker Compose (web + mysql + bind-mounted avatars / characters) |
| Build | Multi-stage Dockerfile (pnpm 10 frozen-lockfile) |

## Quick start (local dev)

### Prerequisites

- Node 22+
- pnpm 10+
- MySQL 5.7+ or 8.x
- An OpenAI-compatible API key

### Install

```bash
cd web
pnpm install
```

### Configure

```bash
cp web/.env.example web/.env
# edit web/.env with your API key and DB url
```

Minimal config:

```env
# LLM — any OpenAI-compatible provider
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://yunwu.ai/v1
OPENAI_MODEL=gemini-3.1-pro-preview

# Reasoning headroom (Claude / o-series / gemini-pro-preview need thinking budget)
OPENAI_REASONING_BUFFER=3000
OPENAI_REASONING_EFFORT=none

# MySQL
DATABASE_URL=mysql://root:123456@127.0.0.1:3306/person_skills

# Cookie — turn Secure off when deploying over plain HTTP
AUTH_COOKIE_NAME=ps_session
COOKIE_SECURE=false

# External auth (optional — without it, any login is denied)
EXTERNAL_LOGIN_URL=https://your-auth-server/api/external/login
EXTERNAL_LOGIN_API_KEY=...
```

### Run

```bash
cd web
pnpm dev
# open http://localhost:3000
```

Drizzle auto-creates tables on first boot (characters / jobs / job_items / transcripts / screenplays / screenplay_assets).

### Seed sample characters (optional)

```bash
cd web
pnpm tsx scripts/import-fs-to-db.ts
```

This loads the 40+ example characters (Confucius, Da Vinci, Steve Jobs, Elon Musk, Hamlet, etc.) bundled under `characters/`.

## Production deploy

### Docker Compose, single host

The repo ships with `docker-compose.yml` (web + mysql) and `deploy.sh` (rsync + remote `docker compose up`).

```bash
PROD_HOST=your-server-ip \
PROJECT_KEY=./your-ssh-key.pem \
./deploy.sh
```

`deploy.sh` performs:

1. rsync project files to remote `/opt/person-skills/`
2. scp `web/.env` separately (sensitive — not under git)
3. remote `docker compose up -d --build`
4. wait for MySQL to be healthy, then run `import-fs-to-db.ts` once to seed `characters/`

### Key environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | ✔ | Provider API key |
| `OPENAI_BASE_URL` | | Defaults to yunwu.ai; swap for OpenAI, Zhipu, Moonshot, etc. |
| `OPENAI_MODEL` | | Defaults to `gemini-3.1-pro-preview` |
| `OPENAI_REASONING_BUFFER` | | Hidden-thinking token headroom (default 3000) |
| `OPENAI_REASONING_EFFORT` | | `none` / `minimal` / `low` / `medium` / `high`, default `none` |
| `DATABASE_URL` | ✔ | MySQL connection string |
| `AUTH_COOKIE_NAME` | | Defaults to `ps_session` |
| `COOKIE_SECURE` | | `true` for HTTPS deployment, `false` for plain HTTP |
| `EXTERNAL_LOGIN_URL` | | External auth endpoint |
| `EXTERNAL_LOGIN_API_KEY` | | External auth API key |
| `IMAGE_GENERATE_URL` | | Primary image endpoint (Gemini Flash Image Preview) |
| `IMAGE_API_KEY` | | Primary image key |
| `IMAGE_FALLBACK_BASE_URL` | | Fallback image endpoint (gpt-image-2) |
| `IMAGE_FALLBACK_API_KEY` | | Fallback image key |

Full list lives in [`web/.env.example`](./web/.env.example).

## Directory layout

```
.
├── web/                          Next.js app (production entry)
│   ├── app/
│   │   ├── api/
│   │   │   ├── dialogue/         Multi-agent dialogue (NDJSON stream)
│   │   │   ├── screenplay/       Two-phase skeleton + segments
│   │   │   ├── assets/           Asset extraction + prompts + image gen
│   │   │   ├── characters/       Character CRUD + portraits + batch import
│   │   │   └── auth/             External auth login
│   │   ├── characters/           Character gallery
│   │   ├── dialogue/             Dialogue workbench
│   │   ├── screenplay/[id]/      Storyboard reviewer
│   │   ├── assets/[id]/          Asset grid
│   │   └── storyboard/[id]/      Shot table
│   ├── lib/
│   │   ├── llm.ts                LLM client + reasoning-budget helper
│   │   ├── repo.ts               DB access layer
│   │   ├── avatar.ts             Multi-source avatar lookup + local persist
│   │   ├── video-prompts.ts      Skeleton + segments prompts
│   │   ├── asset-prompts.ts      Character / scene / prop image prompts
│   │   └── jobs.ts               DB-backed job queue
│   ├── scripts/
│   │   └── import-fs-to-db.ts    One-shot filesystem → DB importer
│   ├── public/                   Static assets (logo + placeholders)
│   └── Dockerfile                Multi-stage build (deps → builder → runner)
├── characters/                   Sample character library
│   ├── real/<id>/SKILL.md        Real-person skills
│   └── fictional/<id>/SKILL.md   Fictional-character skills
├── skills/                       Claude Code plugin (SKILL.md generators)
│   ├── 女娲-虚构/                Fictional skill generator
│   ├── 对话编排/                 Multi-agent orchestration
│   ├── 短剧生成/                 Dialogue → storyboard
│   └── 角色库/                   Library navigation
├── scripts/                      CLI entrypoints (Phase 1 loop)
│   ├── index-characters.ts       Rebuild characters/index.json
│   ├── run-dialogue.ts           CLI dialogue driver
│   └── render-screenplay.ts      CLI storyboard renderer
├── docker-compose.yml            Production orchestration
├── deploy.sh                     Single-host deploy script
├── transcripts/                  Raw dialogue records (gitignored)
├── screenplays/                  Rendered storyboards (gitignored)
└── avatars/                      Local portrait cache (gitignored)
```

## Development guide

### Switch LLM providers

All LLM calls go through OpenAI-compatible protocol. Switching providers is a `web/.env` edit:

```env
OPENAI_BASE_URL=https://api.openai.com/v1     # official OpenAI
OPENAI_MODEL=gpt-4.1

# or:
OPENAI_BASE_URL=https://api.anthropic.com/v1  # Anthropic Claude (via compatible proxy)
OPENAI_MODEL=claude-sonnet-4-6

# or:
OPENAI_BASE_URL=https://api.deepseek.com/v1   # DeepSeek
OPENAI_MODEL=deepseek-chat
```

### Reasoning-model accommodation

Models like Gemini Pro Preview and Claude Sonnet do hidden "thinking" before producing visible output. The default config reserves 3000 tokens of reasoning headroom and sets `reasoning_effort: none`. If output still gets truncated, bump `OPENAI_REASONING_BUFFER`.

### Add a new character

Two paths:

1. **Web UI** — `/characters/new` → single entry or CSV batch
2. **Claude Code** — invoke `skills/女娲-虚构` or `nuwa-skill`, output lands in `characters/<type>/<id>/SKILL.md`, then `pnpm tsx scripts/import-fs-to-db.ts` syncs into DB

### CLI loop (no web required)

```bash
pnpm dialogue --chars jobs,musk --scene tests/scenes/mars-vs-iphone.yaml --rounds 3
pnpm screenplay --session <sessionId>
```

## Design principles

- **Character consistency first** — full SKILL.md goes into the system prompt; every line is constrained by Expression DNA / Mental Models / Decision Heuristics / Limitations
- **Anti-AI-flavor** — ≤80 char per utterance, anti-rebuttal phrasing, force-new-tension-per-round, bold-inline quotes, multi-layer dedupe
- **Dramatic rhythm** — challenge → exposition → resonance baked into prompts; rounds map proportionally to the act
- **Film-industry alignment** — Sequence ID convention, shot types, duration estimation, sync audio+visual dialogue, drop-in compatible with downstream video pipelines

## Acknowledgements

- [nuwa-skill](https://github.com/alchaincyf/nuwa-skill) — the open-source real-person distillation skill that inspired this project; the core ideas for character generation come from it

## License

MIT
