#!/usr/bin/env bash
# Deploy person-skills to a remote production server.
#
# Steps:
#   1. rsync the project (excluding node_modules / .next / etc) to $DEST
#   2. scp web/.env separately (sensitive, gitignored)
#   3. docker compose up -d --build
#   4. wait for mysql healthy, then run import-fs-to-db.ts to seed characters
#
# Re-runnable. Subsequent runs do incremental rsync + rebuild.
#
# Configuration (env vars):
#   PROD_HOST     — target server IP or hostname (required)
#   PROD_USER     — SSH user (default: root)
#   PROD_DEST     — remote project dir (default: /opt/person-skills)
#   PROJECT_KEY   — path to SSH private key (default: ./deploy-key.pem)
#   MYSQL_ROOT_PASSWORD — optional; auto-managed if unset
#
# Usage:
#   PROD_HOST=1.2.3.4 ./deploy.sh                       # full deploy
#   PROD_HOST=1.2.3.4 ./deploy.sh --no-import           # skip seed step
set -euo pipefail

SERVER="${PROD_HOST:-}"
SSH_USER="${PROD_USER:-root}"
KEY="${PROJECT_KEY:-$(dirname "$0")/deploy-key.pem}"
DEST="${PROD_DEST:-/opt/person-skills}"

if [[ -z "$SERVER" ]]; then
  echo "❌ PROD_HOST not set. Usage: PROD_HOST=<ip-or-hostname> ./deploy.sh" >&2
  exit 1
fi

# MYSQL_ROOT_PASSWORD strategy:
#   1. If user exported it before calling, use that
#   2. Else if remote /opt/person-skills/.env already has one, reuse it (idempotent re-deploys)
#   3. Else generate a fresh one
SERVER_MYSQL_PASSWORD="${MYSQL_ROOT_PASSWORD:-}"

NO_IMPORT=0
for arg in "$@"; do
  case "$arg" in
    --no-import) NO_IMPORT=1 ;;
  esac
done

if [[ ! -f "$KEY" ]]; then
  echo "❌ SSH key not found: $KEY" >&2
  exit 1
fi
chmod 600 "$KEY"

SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new $SSH_USER@$SERVER"
SCP="scp -i $KEY -o StrictHostKeyChecking=accept-new"

echo "▶ 1/5  prepare remote dir"
$SSH "mkdir -p $DEST $DEST/characters $DEST/transcripts $DEST/screenplays"

# Resolve MYSQL_ROOT_PASSWORD: reuse existing, else generate
if [[ -z "$SERVER_MYSQL_PASSWORD" ]]; then
  EXISTING=$($SSH "grep -E '^MYSQL_ROOT_PASSWORD=' $DEST/.env 2>/dev/null | head -1 | cut -d= -f2-")
  if [[ -n "$EXISTING" ]]; then
    SERVER_MYSQL_PASSWORD="$EXISTING"
    echo "  (re-using existing MYSQL_ROOT_PASSWORD on server)"
  else
    SERVER_MYSQL_PASSWORD="person-skills-$(openssl rand -hex 12 2>/dev/null || date +%s | sha256sum | head -c 24)"
    echo "  (generated fresh MYSQL_ROOT_PASSWORD)"
  fi
fi

echo "▶ 2/5  rsync project files"
rsync -avz --delete \
  -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '.DS_Store' \
  --exclude '*.log' \
  --exclude '/.env' \
  --exclude '/.env.local' \
  --exclude 'web/.env' \
  --exclude 'web/.env.local' \
  --exclude 'transcripts/*.json' \
  --exclude 'screenplays/*.json' \
  --exclude 'screenplays/*.md' \
  --exclude '/avatars' \
  --exclude '/characters/real' \
  --exclude '/characters/fictional' \
  --exclude 'design-system' \
  --exclude '*.pem' \
  ./ "$SSH_USER@$SERVER:$DEST/"

echo "▶ 3/5  push web/.env"
if [[ -f web/.env ]]; then
  $SCP web/.env "$SSH_USER@$SERVER:$DEST/web/.env"
else
  echo "❌ web/.env not found locally — cannot deploy without env" >&2
  exit 1
fi

# Append/update MYSQL_ROOT_PASSWORD into the project root .env (for compose)
echo "▶ 4/5  write compose-level .env (MYSQL_ROOT_PASSWORD)"
$SSH "cat > $DEST/.env <<EOF
MYSQL_ROOT_PASSWORD=$SERVER_MYSQL_PASSWORD
EOF
chmod 600 $DEST/.env"

echo "▶ 5/5  build + start containers"
$SSH "cd $DEST && docker compose up -d --build"

echo
echo "⏳ waiting for mysql to be healthy..."
for i in $(seq 1 60); do
  status=$($SSH "docker inspect --format '{{.State.Health.Status}}' person-skills-mysql-1 2>/dev/null || echo missing")
  if [[ "$status" == "healthy" ]]; then
    echo "✓ mysql healthy after ${i}s"
    break
  fi
  if [[ $i -eq 60 ]]; then
    echo "❌ mysql never became healthy"
    $SSH "docker compose -f $DEST/docker-compose.yml logs --tail=50 mysql"
    exit 1
  fi
  sleep 2
done

if [[ $NO_IMPORT -eq 0 ]]; then
  echo
  echo "▶ seed: import-fs-to-db.ts (one-shot)"
  $SSH "cd $DEST && docker compose exec -T web npx tsx scripts/import-fs-to-db.ts" || \
    echo "⚠ seed import failed — characters/ may already be empty or already seeded. Check logs."
fi

echo
echo "✅ deployed."
echo "   http://$SERVER:3000/login"
echo
echo "   logs:  $SSH 'cd $DEST && docker compose logs -f web'"
echo "   stop:  $SSH 'cd $DEST && docker compose down'"
echo "   start: $SSH 'cd $DEST && docker compose up -d'"
