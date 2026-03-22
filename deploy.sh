#!/usr/bin/env bash
# Deploy scrypted-mcp to home NUC
# Usage: ./deploy.sh [--build-only | --restart-only]

set -euo pipefail

REMOTE="admin@home"
REMOTE_PATH="/home/admin/docker/volumes/scrypted-mcp"
COMPOSE_FILE="/home/admin/docker/docker-compose.yml"
SERVICE="scrypted-mcp"

BUILD_ONLY=false
RESTART_ONLY=false

for arg in "$@"; do
  case $arg in
    --build-only)   BUILD_ONLY=true ;;
    --restart-only) RESTART_ONLY=true ;;
  esac
done

if [ "$RESTART_ONLY" = false ]; then
  echo "→ Syncing source files to $REMOTE:$REMOTE_PATH"
  rsync -avz --exclude='.git' --exclude='node_modules' \
    Dockerfile package.json server.mjs \
    "$REMOTE:$REMOTE_PATH/"
fi

if [ "$BUILD_ONLY" = false ]; then
  echo "→ Building and restarting $SERVICE on $REMOTE"
  ssh "$REMOTE" "docker compose -f $COMPOSE_FILE up -d --build $SERVICE"
  echo "→ Tailing logs (Ctrl+C to exit)"
  ssh "$REMOTE" "docker logs -f $SERVICE --tail 50"
fi

echo "✓ Done"
