# syntax=docker/dockerfile:1.6
#
# Multi-stage Next.js build.
# - Build with pnpm (frozen lockfile)
# - Final image keeps tsx + dev deps so scripts/import-fs-to-db.ts is runnable
#   inside the container (needed once on first deploy to seed characters).
#
# Container layout:
#   /app/web        ← Next.js working dir (this image)
#   /app/characters ← bind-mounted from host (parent skills/ directory)
#   /app/transcripts ← bind-mounted from host
#   /app/screenplays ← bind-mounted from host
# That layout lets lib/repo.ts compute REPO_ROOT = process.cwd() + ".."
# and still read/write the shared filesystem mirror.

FROM node:22-alpine AS deps
WORKDIR /app/web
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml* ./
# --ignore-scripts: pnpm 10 hard-fails install if any package has a
# postinstall script not on its approved list (sharp, esbuild, etc).
# We don't actually need sharp's native binary — Next.js falls back to
# the JS image optimizer when sharp isn't available.
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM node:22-alpine AS builder
WORKDIR /app/web
RUN corepack enable
COPY --from=deps /app/web/node_modules ./node_modules
COPY web/ ./
# Build needs OPENAI_BASE_URL etc loadable at import time — but our code
# reads env at runtime, so no build-time env required.
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app/web
RUN apk add --no-cache curl bash
RUN corepack enable
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Full app + node_modules so production runtime AND one-shot scripts work
COPY --from=builder /app/web/.next ./.next
COPY --from=builder /app/web/public ./public
COPY --from=builder /app/web/node_modules ./node_modules
COPY --from=builder /app/web/package.json ./package.json
COPY --from=builder /app/web/next.config.ts ./
COPY --from=builder /app/web/tsconfig.json ./
COPY --from=builder /app/web/middleware.ts ./
COPY --from=builder /app/web/tailwind.config.ts ./
COPY --from=builder /app/web/postcss.config.mjs ./
COPY --from=builder /app/web/app ./app
COPY --from=builder /app/web/components ./components
COPY --from=builder /app/web/lib ./lib
COPY --from=builder /app/web/scripts ./scripts

EXPOSE 3000
# Start Next.js directly (bypassing pnpm to avoid corepack/install re-check
# on container startup). The bin is in node_modules from the builder stage.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
CMD ["node", "node_modules/next/dist/bin/next", "start"]
