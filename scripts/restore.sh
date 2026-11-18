#!/usr/bin/env bash
# TANDA-1 — restauración dun dump (proba ou recuperación).
# Uso:
#   ./scripts/restore.sh /ruta/pista-YYYYMMDD.dump
#   CONFIRM=1 ./scripts/restore.sh …   # obrigatorio para non abortar
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DUMP="${1:-}"
if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "Uso: CONFIRM=1 $0 <ficheiro.dump>" >&2
  exit 1
fi
if [[ "${CONFIRM:-}" != "1" ]]; then
  echo "Pon CONFIRM=1 para restaurar (sobreescribe a DB do compose)." >&2
  exit 2
fi

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.concello.yml}"
ENV_FILE="${ENV_FILE:-.env.install}"
TARGET_DB="${TARGET_DB:-pista_aberta}"

COMPOSE=(docker compose -f "$COMPOSE_FILE")
if [[ -f "$ENV_FILE" ]]; then
  COMPOSE+=(--env-file "$ENV_FILE")
fi

echo "[restore] $DUMP → $TARGET_DB"
"${COMPOSE[@]}" exec -T postgres \
  pg_restore -U pista -d "$TARGET_DB" --clean --if-exists < "$DUMP"

echo "[restore] OK"
