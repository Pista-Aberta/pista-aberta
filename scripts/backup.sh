#!/usr/bin/env bash
# TANDA-1 — copia de seguridade Postgres (concello / demo).
# Uso:
#   COMPOSE_FILE=docker-compose.concello.yml ENV_FILE=.env.install ./scripts/backup.sh
#   ./scripts/backup.sh   # por defecto docker-compose.yml + .env
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.concello.yml}"
ENV_FILE="${ENV_FILE:-.env.install}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/.data/backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/pista-$STAMP.dump"

mkdir -p "$BACKUP_DIR"

COMPOSE=(docker compose -f "$COMPOSE_FILE")
if [[ -f "$ENV_FILE" ]]; then
  COMPOSE+=(--env-file "$ENV_FILE")
fi

echo "[backup] dump → $OUT"
"${COMPOSE[@]}" exec -T postgres \
  pg_dump -U pista -d pista_aberta -Fc > "$OUT"

ls -lh "$OUT"
find "$BACKUP_DIR" -name 'pista-*.dump' -mtime "+$KEEP_DAYS" -delete 2>/dev/null || true
echo "[backup] OK"
echo "$OUT"
