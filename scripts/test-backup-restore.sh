#!/usr/bin/env bash
# TANDA-1 — proba backup → restore nunha DB temporal (docker compose concello).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/.data/backups-test}"
mkdir -p "$BACKUP_DIR"

COMPOSE=(docker compose -f "$COMPOSE_FILE")
if [[ -f "$ENV_FILE" ]]; then
  COMPOSE+=(--env-file "$ENV_FILE")
fi

if ! "${COMPOSE[@]}" ps postgres 2>/dev/null | grep -q Up; then
  echo "[skip] postgres non está en marcha ($COMPOSE_FILE)" >&2
  exit 0
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$BACKUP_DIR/pista-test-$STAMP.dump"

echo "[test] dump"
"${COMPOSE[@]}" exec -T postgres \
  pg_dump -U pista -d pista_aberta -Fc > "$DUMP"
test -s "$DUMP"

echo "[test] crear DB temporal e restaurar"
"${COMPOSE[@]}" exec -T postgres \
  psql -U pista -d postgres -c "DROP DATABASE IF EXISTS pista_aberta_restore;"
"${COMPOSE[@]}" exec -T postgres \
  psql -U pista -d postgres -c "CREATE DATABASE pista_aberta_restore OWNER pista;"
"${COMPOSE[@]}" exec -T postgres \
  pg_restore -U pista -d pista_aberta_restore --clean --if-exists < "$DUMP"

COUNT="$("${COMPOSE[@]}" exec -T postgres \
  psql -U pista -d pista_aberta_restore -tAc "SELECT count(*) FROM municipalities;")"
echo "[test] municipalities na restore: $COUNT"
test "${COUNT// /}" -ge 1

"${COMPOSE[@]}" exec -T postgres \
  psql -U pista -d postgres -c "DROP DATABASE IF EXISTS pista_aberta_restore;"

echo "[test] backup→restore OK"
echo "$DUMP"
