#!/usr/bin/env bash
# Instalación dun concello (Docker + HTTPS ou detrás de nginx/NPM).
# Nunca usa docker-compose.vps.yml (ese é só a demo).
#
# Clonar antes (URL real do repositorio, a mesma que amosa a landing):
#   git clone https://github.com/Pista-Aberta/pista-aberta.git
#   cd pista-aberta
#   sudo ./install.sh --dominio reservas.concello.gal
#
# Uso:
#   ./install.sh                  # instalación nova (ou menú se xa hai .env.install)
#   ./install.sh --dominio reservas.concello.gal
#   ./install.sh --domain reservas.concello.gal   # alias EN
#   ./install.sh actualizar       # actualizar (alias: update)
#   PA_INSTALL_NONINTERACTIVE=1 … # CI / automatización
#
# Idiomas: gl (galego) / es (castelán) — pregunta ao inicio.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

ENV_FILE=".env.install"
DOTENV_HELPER="$ROOT/scripts/dotenv-safe.sh"
COMPOSE_BASE="docker-compose.concello.yml"
COMPOSE_PROXY="docker-compose.concello.proxy.yml"
COMPOSE_PROXY_NPM="docker-compose.concello.proxy-npm.yml"
PREV_VERSION_FILE=".data/previous-install-version"
NONINTERACTIVE="${PA_INSTALL_NONINTERACTIVE:-0}"
SKIP_DOCKER="${PA_INSTALL_SKIP_DOCKER:-0}"
SKIP_PULL="${PA_INSTALL_SKIP_PULL:-0}"
# REVISION-42 Q7: sen copia só se se pide explicitamente.
ALLOW_NO_BACKUP=0
CMD=""
CLI_DOMAIN=""
_args=("$@")
_i=0
while [[ $_i -lt ${#_args[@]} ]]; do
  _arg="${_args[$_i]}"
  case "$_arg" in
    --sen-copia|--sin-copia) ALLOW_NO_BACKUP=1 ;;
    --dominio|--domain)
      _i=$((_i + 1))
      if [[ $_i -ge ${#_args[@]} || -z "${_args[$_i]:-}" || "${_args[$_i]}" == -* ]]; then
        echo "ERRO: $_arg require un dominio (p.ex. reservas.concello.gal)" >&2
        exit 1
      fi
      CLI_DOMAIN="${_args[$_i]}"
      ;;
    --dominio=*|--domain=*)
      CLI_DOMAIN="${_arg#*=}"
      if [[ -z "$CLI_DOMAIN" ]]; then
        echo "ERRO: --dominio/--domain non pode ir baleiro" >&2
        exit 1
      fi
      ;;
    actualizar|update|reconfig|reconfigure|cambiar|-h|--help|help)
      CMD="$_arg"
      ;;
    "")
      ;;
    -*)
      echo "Argumento descoñecido: $_arg" >&2
      exit 1
      ;;
    *)
      if [[ -z "$CMD" ]]; then CMD="$_arg"; fi
      ;;
  esac
  _i=$((_i + 1))
done
if [[ -n "$CLI_DOMAIN" ]]; then
  DOMAIN="$CLI_DOMAIN"
  export DOMAIN
fi

# ---------------------------------------------------------------------------
# i18n (gl / es)
# ---------------------------------------------------------------------------
PA_LANG="${PA_LANG:-}"

msg() {
  local key="$1"
  case "${PA_LANG:-gl}:${key}" in
    gl:banner) echo "=== Pista Aberta · instalación dun concello ===" ;;
    es:banner) echo "=== Pista Aberta · instalación de un concello ===" ;;
    gl:lang_prompt) echo "Idioma / Idioma: 1) Galego  2) Castellano" ;;
    es:lang_prompt) echo "Idioma / Idioma: 1) Galego  2) Castellano" ;;
    gl:existing_menu)
      echo "Atopouse unha instalación (.env.install)."
      echo "  1) Actualizar"
      echo "  2) Cambiar configuración (dominio, correo, SMTP)"
      echo "  3) Saír"
      ;;
    es:existing_menu)
      echo "Se encontró una instalación (.env.install)."
      echo "  1) Actualizar"
      echo "  2) Cambiar configuración (dominio, correo, SMTP)"
      echo "  3) Salir"
      ;;
    gl:existing_choice) echo "Escolle" ;;
    es:existing_choice) echo "Elige" ;;
    gl:ni_existing)
      echo "Hai unha instalación (.env.install) e PA_INSTALL_NONINTERACTIVE=1:"
      echo "non se fai nada. Usa: bash install.sh actualizar"
      ;;
    es:ni_existing)
      echo "Hay una instalación (.env.install) y PA_INSTALL_NONINTERACTIVE=1:"
      echo "no se hace nada. Usa: bash install.sh actualizar"
      ;;
    gl:edge_prompt)
      echo "Como queres expoñer a app?"
      echo "  1) Directamente nos portos 80/443 (Caddy + Let's Encrypt)"
      echo "  2) Detrás dun servidor web existente (nginx / Nginx Proxy Manager / outro)"
      ;;
    es:edge_prompt)
      echo "¿Cómo quieres exponer la app?"
      echo "  1) Directamente en los puertos 80/443 (Caddy + Let's Encrypt)"
      echo "  2) Detrás de un servidor web existente (nginx / Nginx Proxy Manager / otro)"
      ;;
    gl:edge_choice) echo "Opción" ;;
    es:edge_choice) echo "Opción" ;;
    gl:proxy_kind_prompt)
      echo "Modo proxy:"
      echo "  1) nginx no mesmo host → app en 127.0.0.1:<porto>"
      echo "  2) Nginx Proxy Manager (rede Docker)"
      ;;
    es:proxy_kind_prompt)
      echo "Modo proxy:"
      echo "  1) nginx en el mismo host → app en 127.0.0.1:<puerto>"
      echo "  2) Nginx Proxy Manager (red Docker)"
      ;;
    gl:update_start) echo "=== Actualizando Pista Aberta ===" ;;
    es:update_start) echo "=== Actualizando Pista Aberta ===" ;;
    gl:update_backup) echo "Facendo copia de seguridade…" ;;
    es:update_backup) echo "Haciendo copia de seguridad…" ;;
    gl:update_pull) echo "Descargando versión nova…" ;;
    es:update_pull) echo "Descargando versión nueva…" ;;
    gl:update_env) echo "Engadindo variables novas a .env.install (sen tocar as existentes)…" ;;
    es:update_env) echo "Añadiendo variables nuevas a .env.install (sin tocar las existentes)…" ;;
    gl:update_up) echo "Reconstruíndo e levantando servizos…" ;;
    es:update_up) echo "Reconstruyendo y levantando servicios…" ;;
    gl:update_wait) echo "Agardando /health…" ;;
    es:update_wait) echo "Esperando /health…" ;;
    gl:update_ok) echo "Actualización completa." ;;
    es:update_ok) echo "Actualización completa." ;;
    gl:update_fail) echo "ERRO: a actualización fallou." ;;
    es:update_fail) echo "ERROR: la actualización falló." ;;
    gl:reconfig_start) echo "=== Cambiar configuración ===" ;;
    es:reconfig_start) echo "=== Cambiar configuración ===" ;;
    gl:reconfig_done) echo "Configuración actualizada. Reiniciando…" ;;
    es:reconfig_done) echo "Configuración actualizada. Reiniciando…" ;;
    gl:done) echo "Listo." ;;
    es:done) echo "Listo." ;;
    gl:docker_missing) echo "Docker non está instalado. Instáao e volve executar este script." ;;
    es:docker_missing) echo "Docker no está instalado. Instálalo y vuelve a ejecutar este script." ;;
    gl:bye) echo "Saíndo sen cambios." ;;
    es:bye) echo "Saliendo sin cambios." ;;
    *) echo "$key" ;;
  esac
}

select_language() {
  if [[ -n "$PA_LANG" ]]; then
    return
  fi
  if [[ "$NONINTERACTIVE" == "1" ]]; then
    PA_LANG="${PA_LANG:-gl}"
    return
  fi
  local in=""
  echo
  msg lang_prompt
  read -r -p "[1]: " in || true
  case "${in:-1}" in
    2|es|ES|castellano|español|espanol) PA_LANG=es ;;
    *) PA_LANG=gl ;;
  esac
}

prompt() {
  local var="$1" msg_txt="$2" def="${3:-}"
  if [[ "$NONINTERACTIVE" == "1" ]]; then
    printf -v "$var" '%s' "${!var:-$def}"
    return
  fi
  local in=""
  if [[ -n "$def" ]]; then
    read -r -p "$msg_txt [$def]: " in || true
    printf -v "$var" '%s' "${in:-$def}"
  else
    read -r -p "$msg_txt: " in || true
    printf -v "$var" '%s' "${in:-}"
  fi
}

prompt_secret() {
  local var="$1" msg_txt="$2"
  if [[ "$NONINTERACTIVE" == "1" ]]; then
    printf -v "$var" '%s' "${!var:-}"
    return
  fi
  local in=""
  read -r -s -p "$msg_txt: " in || true
  echo
  printf -v "$var" '%s' "${in:-}"
}

# ---------------------------------------------------------------------------
# NIF (REVISION-37 I4)
# ---------------------------------------------------------------------------
validate_nif_letter() {
  local raw nif prefix digits letter num_str n letters idx
  raw="$(echo "$1" | tr '[:lower:]' '[:upper:]' | tr -d '[:space:]')"
  raw="${raw#IDCES-}"
  raw="${raw#IDCES}"
  if [[ ! "$raw" =~ ^([XYZ]?)([0-9]{7,8})([A-Z])$ ]]; then
    return 1
  fi
  prefix="${BASH_REMATCH[1]}"
  digits="${BASH_REMATCH[2]}"
  letter="${BASH_REMATCH[3]}"
  if [[ "$prefix" == "X" ]]; then
    num_str="0${digits: -7}"
  elif [[ "$prefix" == "Y" ]]; then
    num_str="1${digits: -7}"
  elif [[ "$prefix" == "Z" ]]; then
    num_str="2${digits: -7}"
  else
    num_str="$(printf '%08d' "$((10#$digits))" 2>/dev/null || echo "$digits")"
    while [[ ${#num_str} -lt 8 ]]; do num_str="0$num_str"; done
  fi
  n=$((10#$num_str))
  letters="TRWAGMYFPDXBNJZSQVHLCKE"
  idx=$((n % 23))
  [[ "${letters:$idx:1}" == "$letter" ]]
}

require_valid_nif() {
  local label="$1" value="$2"
  if [[ -z "$value" ]]; then
    if [[ "${PA_LANG:-gl}" == "es" ]]; then
      echo "ERROR: el $label es obligatorio." >&2
    else
      echo "ERRO: o $label é obrigatorio." >&2
    fi
    exit 1
  fi
  if ! validate_nif_letter "$value"; then
    if [[ "${PA_LANG:-gl}" == "es" ]]; then
      echo "ERROR: NIF/NIE inválido (letra incorrecta): $value" >&2
    else
      echo "ERRO: NIF/NIE inválido (letra incorrecta): $value" >&2
    fi
    echo "Corrixe o NIF e volve executar install.sh (ou npm run admin -- … --invite)." >&2
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Compose / env helpers
# ---------------------------------------------------------------------------
env_get() {
  local key="$1" file="${2:-$ENV_FILE}"
  bash "$DOTENV_HELPER" get "$file" "$key"
}

# Catálogo de claves novas (só se engaden se faltan; nunca sobrescriben).
env_defaults_catalog() {
  cat <<'EOF'
INSTALL_EDGE=caddy
APP_PORT=8080
PROXY_BIND=127.0.0.1
PROXY_NETWORK=
CERT_LOGIN_ENABLED=1
COOKIE_SECURE=1
TRUST_PROXY=1
PA_DEMO=0
VITE_PA_DEMO=0
NODE_ENV=production
SMTP_PORT=587
SAML_CERTS_HOST_DIR=./deploy/concello/saml-certs
BACKUP_KEEP_DAYS=7
EOF
}

merge_missing_env() {
  local file="$1"
  local line key val
  msg update_env
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    if ! grep -qE "^${key}=" "$file" 2>/dev/null; then
      echo "${key}=${val}" >> "$file"
      echo "  + ${key}=${val}"
    fi
  done < <(env_defaults_catalog)
}

compose_files_args() {
  local edge="${1:-$(env_get INSTALL_EDGE)}"
  edge="${edge:-caddy}"
  COMPOSE_FILES=("-f" "$COMPOSE_BASE")
  case "$edge" in
    proxy|proxy-local|nginx)
      COMPOSE_FILES+=("-f" "$COMPOSE_PROXY")
      ;;
    proxy-npm|npm)
      COMPOSE_FILES+=("-f" "$COMPOSE_PROXY_NPM")
      ;;
    caddy|direct|*)
      ;;
  esac
}

run_compose() {
  compose_files_args "${INSTALL_EDGE:-$(env_get INSTALL_EDGE)}"
  local cmd=(docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE")
  case "${INSTALL_BACKUP:-$(env_get INSTALL_BACKUP)}" in
    compose|servizo|service|s|2) cmd+=(--profile backup) ;;
  esac
  "${cmd[@]}" "$@"
}

require_docker() {
  if [[ "$SKIP_DOCKER" == "1" ]]; then
    return 0
  fi
  if ! command -v docker >/dev/null 2>&1; then
    msg docker_missing
    exit 1
  fi
  if [[ ! -f "$COMPOSE_BASE" ]]; then
    echo "Falta ${COMPOSE_BASE}."
    exit 1
  fi
}

health_url() {
  if [[ -n "${PA_INSTALL_HEALTH_URL:-}" ]]; then
    echo "$PA_INSTALL_HEALTH_URL"
    return
  fi
  local edge port bind
  edge="$(env_get INSTALL_EDGE)"
  edge="${edge:-caddy}"
  case "$edge" in
    proxy|proxy-local|nginx)
      port="$(env_get APP_PORT)"
      port="${port:-8080}"
      bind="$(env_get PROXY_BIND)"
      bind="${bind:-127.0.0.1}"
      echo "http://${bind}:${port}/health"
      ;;
    proxy-npm|npm)
      # Sen porto publicado: health vía exec ao edge/api se hai Docker;
      # en CI o test define PA_INSTALL_HEALTH_URL.
      echo "http://127.0.0.1:${APP_PORT:-8080}/health"
      ;;
    *)
      local base
      base="$(env_get APP_BASE_URL)"
      base="${base:-http://127.0.0.1}"
      echo "${base}/health"
      ;;
  esac
}

wait_health() {
  local url tries i
  url="$(health_url)"
  tries=60 # 60 × 2s = 2 min
  msg update_wait
  echo "  → $url (máx. 2 min)"
  if [[ "$SKIP_DOCKER" == "1" && -z "${PA_INSTALL_HEALTH_URL:-}" ]]; then
    echo "  (SKIP_DOCKER: omitindo espera real)"
    return 0
  fi
  for ((i = 1; i <= tries; i++)); do
    if curl -fsS -o /dev/null --max-time 3 "$url" 2>/dev/null; then
      echo "  /health OK (${i}s×2)"
      return 0
    fi
    sleep 2
  done
  return 1
}

print_rollback_help() {
  local prev="${1:-unknown}"
  local dump="${2:-}"
  local edge compose_cli
  edge="$(env_get INSTALL_EDGE)"
  edge="${edge:-caddy}"
  compose_files_args "$edge"
  compose_cli="docker compose"
  local f
  for f in "${COMPOSE_FILES[@]}"; do
    compose_cli+=" ${f}"
  done
  compose_cli+=" --env-file ${ENV_FILE}"
  msg update_fail
  echo
  if [[ "${PA_LANG:-gl}" == "es" ]]; then
    echo "Para volver atrás:"
    echo "  1) Restaurar la base de datos (si hay copia):"
    echo "       CONFIRM=1 COMPOSE_FILE=${COMPOSE_BASE} ENV_FILE=${ENV_FILE} ./scripts/restore.sh ${dump:-/ruta/ao/backup.dump}"
    echo "  2) Volver al código anterior:"
    echo "       git checkout ${prev}"
    echo "  3) Levantar de nuevo:"
    echo "       ${compose_cli} up -d --build"
  else
    echo "Para volver atrás:"
    echo "  1) Restaurar a base de datos (se hai copia):"
    echo "       CONFIRM=1 COMPOSE_FILE=${COMPOSE_BASE} ENV_FILE=${ENV_FILE} ./scripts/restore.sh ${dump:-/ruta/ao/backup.dump}"
    echo "  2) Volver ao código anterior:"
    echo "       git checkout ${prev}"
    echo "  3) Levantar de novo:"
    echo "       ${compose_cli} up -d --build"
  fi
}

save_previous_version() {
  mkdir -p "$(dirname "$PREV_VERSION_FILE")"
  local sha="unknown"
  if [[ -d .git ]] && command -v git >/dev/null 2>&1; then
    sha="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  fi
  echo "$sha" > "$PREV_VERSION_FILE"
  echo "$sha"
}

pull_new_version() {
  msg update_pull
  if [[ "$SKIP_PULL" == "1" ]]; then
    echo "  (SKIP_PULL=1)"
    return 0
  fi
  if [[ -d .git ]] && command -v git >/dev/null 2>&1; then
    if ! git pull --ff-only; then
      return 1
    fi
  else
    echo "  Sen .git — tentando docker compose pull…"
    if [[ "$SKIP_DOCKER" != "1" ]]; then
      run_compose pull || return 1
    fi
  fi
  return 0
}

compose_up_build() {
  msg update_up
  if [[ "$SKIP_DOCKER" == "1" ]]; then
    echo "  (SKIP_DOCKER=1: non se executa docker compose)"
    return 0
  fi
  run_compose up -d --build
}

run_backup() {
  msg update_backup
  local out=""
  if [[ "$SKIP_DOCKER" == "1" ]]; then
    mkdir -p .data/backups
    out=".data/backups/pista-skip-docker.dump"
    echo "fake-backup" > "$out"
    echo "$out"
    return 0
  fi
  set +e
  out="$(COMPOSE_FILE="$COMPOSE_BASE" ENV_FILE="$ENV_FILE" BACKUP_DIR="${BACKUP_DIR:-$ROOT/.data/backups}" \
    ./scripts/backup.sh 2>&1)"
  local rc=$?
  set -e
  echo "$out"
  if [[ "$rc" -ne 0 ]]; then
    if [[ "$ALLOW_NO_BACKUP" == "1" ]]; then
      if [[ "${PA_LANG:-gl}" == "es" ]]; then
        echo "AVISO: la copia falló; continúas con --sen-copia / --sin-copia." >&2
      else
        echo "AVISO: a copia fallou; continúas con --sen-copia." >&2
      fi
      echo ""
      return 0
    fi
    if [[ "${PA_LANG:-gl}" == "es" ]]; then
      echo "ERROR: no se actualiza sin copia; usa --sen-copia si lo tienes claro." >&2
    else
      echo "ERRO: non se actualiza sen copia; usa --sen-copia se o tes claro." >&2
    fi
    return 1
  fi
  echo "$out" | tail -1
}

# ---------------------------------------------------------------------------
# Actualizar
# ---------------------------------------------------------------------------
do_update() {
  if [[ ! -f "$ENV_FILE" ]]; then
    if [[ "${PA_LANG:-gl}" == "es" ]]; then
      echo "ERROR: no hay .env.install — ejecuta primero ./install.sh" >&2
    else
      echo "ERRO: non hai .env.install — executa primeiro ./install.sh" >&2
    fi
    exit 1
  fi
  require_docker
  msg update_start
  local prev dump
  prev="$(save_previous_version)"
  echo "  versión actual: $prev"
  # REVISION-42 Q7: sen source .env (contrasinais con $ / espazos / `).
  INSTALL_EDGE="$(env_get INSTALL_EDGE)"
  INSTALL_EDGE="${INSTALL_EDGE:-caddy}"
  INSTALL_BACKUP="$(env_get INSTALL_BACKUP)"
  if ! dump="$(run_backup | tail -1)"; then
    exit 1
  fi
  if ! pull_new_version; then
    print_rollback_help "$prev" "$dump"
    exit 1
  fi
  merge_missing_env "$ENV_FILE"
  INSTALL_EDGE="$(env_get INSTALL_EDGE)"
  INSTALL_EDGE="${INSTALL_EDGE:-caddy}"
  INSTALL_BACKUP="$(env_get INSTALL_BACKUP)"
  if ! compose_up_build; then
    print_rollback_help "$prev" "$dump"
    exit 1
  fi
  if ! wait_health; then
    print_rollback_help "$prev" "$dump"
    exit 1
  fi
  msg update_ok
}

# ---------------------------------------------------------------------------
# Cambiar configuración (dominio / correo / SMTP)
# ---------------------------------------------------------------------------
env_set_key() {
  local file="$1" key="$2" val="$3"
  bash "$DOTENV_HELPER" set "$file" "$key" "$val"
}

do_reconfig() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Falta $ENV_FILE" >&2
    exit 1
  fi
  require_docker
  msg reconfig_start
  DOMAIN="$(env_get DOMAIN)"
  ACME_EMAIL="$(env_get ACME_EMAIL)"
  SMTP_HOST="$(env_get SMTP_HOST)"
  SMTP_PORT="$(env_get SMTP_PORT)"
  SMTP_USER="$(env_get SMTP_USER)"
  SMTP_PASS="$(env_get SMTP_PASS)"
  SMTP_FROM="$(env_get SMTP_FROM)"

  prompt DOMAIN "Dominio" "${DOMAIN:-localhost}"
  prompt ACME_EMAIL "Correo ACME / contacto" "${ACME_EMAIL:-admin@${DOMAIN}}"
  prompt SMTP_HOST "SMTP host (baleiro = sen cambio de SMTP se xa había)" "${SMTP_HOST:-}"
  if [[ -n "$SMTP_HOST" ]]; then
    prompt SMTP_PORT "SMTP porto" "${SMTP_PORT:-587}"
    prompt SMTP_USER "SMTP usuario" "${SMTP_USER:-}"
    prompt_secret SMTP_PASS "SMTP contrasinal"
    prompt SMTP_FROM "SMTP From" "${SMTP_FROM:-reservas@${DOMAIN}}"
  fi

  local app_base="https://${DOMAIN}"
  if [[ "$DOMAIN" == "localhost" || "$DOMAIN" == "127.0.0.1" ]]; then
    app_base="http://${DOMAIN}"
  fi
  env_set_key "$ENV_FILE" DOMAIN "$DOMAIN"
  env_set_key "$ENV_FILE" APP_BASE_URL "$app_base"
  env_set_key "$ENV_FILE" API_BASE_URL "$app_base"
  env_set_key "$ENV_FILE" CERT_ORIGIN "https://cert.${DOMAIN}"
  env_set_key "$ENV_FILE" ACME_EMAIL "$ACME_EMAIL"
  if [[ -n "$SMTP_HOST" ]]; then
    env_set_key "$ENV_FILE" SMTP_HOST "$SMTP_HOST"
    env_set_key "$ENV_FILE" SMTP_PORT "$SMTP_PORT"
    env_set_key "$ENV_FILE" SMTP_USER "$SMTP_USER"
    env_set_key "$ENV_FILE" SMTP_PASS "$SMTP_PASS"
    env_set_key "$ENV_FILE" SMTP_FROM "$SMTP_FROM"
  fi
  chmod 600 "$ENV_FILE"
  msg reconfig_done
  compose_up_build
  wait_health || true
  msg done
}

# ---------------------------------------------------------------------------
# Documentación final modo proxy
# ---------------------------------------------------------------------------
print_proxy_docs() {
  local domain="$1" port="$2" kind="$3"
  echo
  if [[ "${PA_LANG:-gl}" == "es" ]]; then
    echo "── Configuración del proxy (sin Caddy) ──"
    echo "La app escucha en el contenedor «edge» (HTTP)."
  else
    echo "── Configuración do proxy (sen Caddy) ──"
    echo "A app escoita no contedor «edge» (HTTP)."
  fi
  echo
  if [[ "$kind" == "npm" ]]; then
    echo "Nginx Proxy Manager:"
    echo "  1. Engade un Proxy Host → Domain Names: ${domain}"
    echo "     Forward Hostname/IP: edge   Forward Port: 80"
    echo "     (o nome do contedor do servizo edge na rede ${PROXY_NETWORK:-<PROXY_NETWORK>})"
    echo "  2. SSL: Let's Encrypt no propio NPM."
    echo "  3. Subdominio cert.${domain} (certificado dixital / mTLS):"
    echo "     NPM non fai ben a verificación de cliente TLS (mTLS)."
    echo "     Opcións: (a) un nginx á parte con ssl_verify_client para cert.${domain}"
    echo "     apuntando a edge/api; (b) neste modo o login con certificado"
    echo "     pode non estar dispoñible — usa Cl@ve / correo."
    echo "  Ver tamén: docs/CERTIFICADO-DIXITAL.md e deploy/dominio/nginx/cert-tls.conf.template"
  else
    echo "Fragmento nginx (mesmo host, proxy_pass a 127.0.0.1:${port}):"
    cat <<NGINX
server {
  listen 443 ssl http2;
  server_name ${domain};
  # ssl_certificate …; ssl_certificate_key …;

  location / {
    proxy_pass http://127.0.0.1:${port};
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}

# Subdominio cert.${domain} — mTLS (certificado dixital).
# NPM/nginx simple sen ssl_verify_client: o cert. NON está dispoñible
# neste modo a non ser que configures mTLS (ver cert-tls.conf.template).
# server {
#   listen 443 ssl;
#   server_name cert.${domain};
#   ssl_verify_client on;
#   ssl_client_certificate /ruta/trusted-client-cas.official.pem;
#   location /auth/cert/start {
#     proxy_pass http://127.0.0.1:${port};
#     … cabeceiras X-PA-Cert-* …
#   }
# }
NGINX
    echo
    echo "Nginx Proxy Manager (se o usas noutro host/VM): crea un Proxy Host"
    echo "cara a este servidor:${port}, e para cert.${domain} mira a nota mTLS de arriba."
  fi
  echo
}

# ---------------------------------------------------------------------------
# Instalación nova
# ---------------------------------------------------------------------------
do_fresh_install() {
  msg banner
  echo

  DOMAIN="${DOMAIN:-}"
  SINGLE="${SINGLE:-${PA_SINGLE_MUNI:-}}"
  SMTP_HOST="${SMTP_HOST:-}"
  SMTP_PORT="${SMTP_PORT:-587}"
  SMTP_USER="${SMTP_USER:-}"
  SMTP_PASS="${SMTP_PASS:-}"
  SMTP_FROM="${SMTP_FROM:-}"
  WANT_CERT="${WANT_CERT:-s}"
  HAVE_CLAVE="${HAVE_CLAVE:-n}"
  ACME_EMAIL="${ACME_EMAIL:-}"
  SAML_IDP_SSO_URL="${SAML_IDP_SSO_URL:-}"
  SAML_CERTS_HOST_DIR="${SAML_CERTS_HOST_DIR:-./deploy/concello/saml-certs}"
  INSTALL_BACKUP="${INSTALL_BACKUP:-}"
  INSTALL_EDGE="${INSTALL_EDGE:-}"
  APP_PORT="${APP_PORT:-8080}"
  PROXY_BIND="${PROXY_BIND:-127.0.0.1}"
  PROXY_NETWORK="${PROXY_NETWORK:-}"
  PROXY_KIND="${PROXY_KIND:-}"

  # Modo de exposición
  if [[ -z "$INSTALL_EDGE" ]]; then
    if [[ "$NONINTERACTIVE" == "1" ]]; then
      INSTALL_EDGE="${INSTALL_EDGE:-caddy}"
    else
      msg edge_prompt
      local edge_in=""
      read -r -p "$(msg edge_choice) [1]: " edge_in || true
      case "${edge_in:-1}" in
        2|proxy|nginx|npm)
          INSTALL_EDGE=proxy
          msg proxy_kind_prompt
          local pk=""
          read -r -p "$(msg edge_choice) [1]: " pk || true
          case "${pk:-1}" in
            2|npm) PROXY_KIND=npm; INSTALL_EDGE=proxy-npm ;;
            *) PROXY_KIND=local; INSTALL_EDGE=proxy ;;
          esac
          ;;
        *) INSTALL_EDGE=caddy ;;
      esac
    fi
  fi
  case "$INSTALL_EDGE" in
    proxy|proxy-local|nginx)
      INSTALL_EDGE=proxy
      prompt APP_PORT "Porto local da app (127.0.0.1:N)" "${APP_PORT:-8080}"
      PROXY_BIND="${PROXY_BIND:-127.0.0.1}"
      ;;
    proxy-npm|npm)
      INSTALL_EDGE=proxy-npm
      prompt PROXY_NETWORK "Nome da rede Docker de NPM" "${PROXY_NETWORK:-nginxproxymanager_default}"
      ;;
    *) INSTALL_EDGE=caddy ;;
  esac

  # --dominio/--domain preenche o valor por defecto; non permitir baleiro.
  prompt DOMAIN "Dominio (p.ex. reservas.exemplo.gal)" "${DOMAIN:-localhost}"
  DOMAIN="$(echo "${DOMAIN:-}" | tr -d '[:space:]')"
  if [[ -z "$DOMAIN" ]]; then
    echo "ERRO: o dominio non pode ir baleiro (usa --dominio <dominio>)." >&2
    exit 1
  fi

  prompt SINGLE "Slug do concello (p.ex. exemplo) [baleiro = multiconcello]" ""
  SINGLE="$(echo "${SINGLE:-}" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')"

  CONCELLO_NAME="${CONCELLO_NAME:-}"
  CONCELLO_INE="${CONCELLO_INE:-}"
  ADMIN_EMAIL="${ADMIN_EMAIL:-}"
  ADMIN_NIF="${ADMIN_NIF:-}"
  ADMIN_NAME="${ADMIN_NAME:-}"
  DEPUTACION_NAME="${DEPUTACION_NAME:-}"
  DEP_MANAGER_NAME="${DEP_MANAGER_NAME:-}"
  DEP_MANAGER_EMAIL="${DEP_MANAGER_EMAIL:-}"
  DEP_MANAGER_NIF="${DEP_MANAGER_NIF:-}"
  prompt CONCELLO_NAME "Nome do concello (censo)" ""
  prompt CONCELLO_INE "Código INE do concello" ""
  if [[ -n "$SINGLE" && -n "$CONCELLO_NAME" && -n "$CONCELLO_INE" ]]; then
    prompt ADMIN_EMAIL "Correo da persoa administradora" ""
    prompt ADMIN_NIF "NIF/NIE da administradora (obrigatorio)" ""
    prompt ADMIN_NAME "Nome da administradora" "Admin"
    require_valid_nif "NIF/NIE da administradora" "$ADMIN_NIF"
  fi

  if [[ -z "$SINGLE" ]]; then
    prompt DEPUTACION_NAME "Nome da Deputación (multiconcello)" "Deputación Provincial"
    DEPUTACION_EMAIL="${DEPUTACION_EMAIL:-}"
    prompt DEPUTACION_EMAIL "Correo de contacto da Deputación (obrigatorio, privacidade)" ""
    if [[ -z "${DEPUTACION_EMAIL:-}" || "$DEPUTACION_EMAIL" != *"@"* ]]; then
      echo "ERRO: DEPUTACION_EMAIL é obrigatorio (p.ex. contacto@deputacion.gal)." >&2
      exit 1
    fi
    prompt DEP_MANAGER_NAME "Nome da primeira xestora da Deputación" "Xestora Deputación"
    prompt DEP_MANAGER_EMAIL "Correo da xestora" ""
    prompt DEP_MANAGER_NIF "NIF/NIE da xestora (obrigatorio)" ""
    require_valid_nif "NIF/NIE da xestora da Deputación" "$DEP_MANAGER_NIF"
  fi

  prompt SMTP_HOST "SMTP host (baleiro = só avisos na app)" ""
  if [[ -n "$SMTP_HOST" ]]; then
    prompt SMTP_PORT "SMTP porto" "587"
    prompt SMTP_USER "SMTP usuario" ""
    prompt_secret SMTP_PASS "SMTP contrasinal"
    prompt SMTP_FROM "SMTP From" "reservas@${DOMAIN}"
  fi

  if [[ "$INSTALL_EDGE" == "caddy" ]]; then
    prompt WANT_CERT "Activar certificado HTTPS (Let's Encrypt) agora? [S/n]" "s"
    WANT_CERT="$(echo "${WANT_CERT:-s}" | tr '[:upper:]' '[:lower:]')"
    if [[ "$WANT_CERT" == "s" || "$WANT_CERT" == "y" || "$WANT_CERT" == "si" || "$WANT_CERT" == "sí" ]]; then
      prompt ACME_EMAIL "Correo ACME (Let's Encrypt)" "admin@${DOMAIN}"
    fi
  else
    WANT_CERT=n
    prompt ACME_EMAIL "Correo de contacto (avisos / Let's Encrypt no teu proxy)" "admin@${DOMAIN}"
  fi

  prompt HAVE_CLAVE "Tes xa o alta en Cl@ve? [s/N]" "n"
  HAVE_CLAVE="$(echo "${HAVE_CLAVE:-n}" | tr '[:upper:]' '[:lower:]')"
  if [[ "$HAVE_CLAVE" == "s" || "$HAVE_CLAVE" == "y" || "$HAVE_CLAVE" == "si" || "$HAVE_CLAVE" == "sí" ]]; then
    prompt SAML_IDP_SSO_URL "URL SSO do IdP Cl@ve" ""
    if [[ -z "${SAML_IDP_SSO_URL:-}" ]]; then
      echo "Falta a URL SSO de Cl@ve."
      exit 1
    fi
    SAML_DIR="${ROOT}/deploy/concello/saml-certs"
    mkdir -p "$SAML_DIR"
    chmod 700 "$SAML_DIR"
    IDP_CERT=""
    IDP_KEY=""
    SP_CERT=""
    SP_KEY=""
    prompt IDP_CERT "Ruta ao idp-cert.pem" ""
    prompt IDP_KEY "Ruta ao idp-key.pem" ""
    prompt SP_CERT "Ruta ao sp-cert.pem" ""
    prompt SP_KEY "Ruta ao sp-key.pem" ""
    for f in "$IDP_CERT" "$IDP_KEY" "$SP_CERT" "$SP_KEY"; do
      if [[ ! -f "$f" ]]; then
        echo "Non existe: $f"
        exit 1
      fi
    done
    cp "$IDP_CERT" "$SAML_DIR/idp-cert.pem"
    cp "$IDP_KEY" "$SAML_DIR/idp-key.pem"
    cp "$SP_CERT" "$SAML_DIR/sp-cert.pem"
    cp "$SP_KEY" "$SAML_DIR/sp-key.pem"
    chmod 600 "$SAML_DIR"/*.pem
  fi

  mkdir -p "${ROOT}/deploy/concello/saml-certs"
  # PEM SAML de demo se faltan (tamén en apps/api/certs para arranque local)
  ensure_demo_saml_pair() {
    local dir="$1" key="$2" cert="$3" cn="$4"
    mkdir -p "$dir"
    if [[ -f "$dir/$key" && -f "$dir/$cert" ]]; then
      return 0
    fi
    openssl req -x509 -newkey rsa:2048 -nodes \
      -keyout "$dir/$key" -out "$dir/$cert" -days 825 \
      -subj "/CN=${cn}/O=Demo/C=ES" >/dev/null 2>&1 || true
    chmod 600 "$dir/$key" 2>/dev/null || true
  }
  ensure_demo_saml_pair "${ROOT}/apps/api/certs" idp-key.pem idp-cert.pem "Pista Aberta IdP Mock"
  ensure_demo_saml_pair "${ROOT}/apps/api/certs" sp-key.pem sp-cert.pem "Pista Aberta SP Demo"
  ensure_demo_saml_pair "${ROOT}/deploy/concello/saml-certs" idp-key.pem idp-cert.pem "Pista Aberta IdP Mock"
  ensure_demo_saml_pair "${ROOT}/deploy/concello/saml-certs" sp-key.pem sp-cert.pem "Pista Aberta SP Demo"

  SESSION_SECRET="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 32)"
  CERT_GATEWAY_SECRET="$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | xxd -p -c 24)"
  POSTGRES_PASSWORD="$(openssl rand -hex 18 2>/dev/null || head -c 18 /dev/urandom | xxd -p -c 18)"

  CERT_ORIGIN="https://cert.${DOMAIN}"
  APP_BASE_URL="https://${DOMAIN}"
  if [[ "$DOMAIN" == "localhost" || "$DOMAIN" == "127.0.0.1" ]]; then
    APP_BASE_URL="http://${DOMAIN}"
  fi
  if [[ "$INSTALL_EDGE" == "proxy" ]]; then
    APP_BASE_URL="http://${PROXY_BIND:-127.0.0.1}:${APP_PORT}"
    # O operador porá https://DOMAIN no seu proxy; gardamos o dominio público se non é localhost
    if [[ "$DOMAIN" != "localhost" && "$DOMAIN" != "127.0.0.1" ]]; then
      APP_BASE_URL="https://${DOMAIN}"
    fi
  fi

  printf '# Xerado por install.sh — %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$ENV_FILE"
  env_set_key "$ENV_FILE" DOMAIN "$DOMAIN"
  env_set_key "$ENV_FILE" APP_BASE_URL "$APP_BASE_URL"
  env_set_key "$ENV_FILE" API_BASE_URL "$APP_BASE_URL"
  env_set_key "$ENV_FILE" SESSION_SECRET "$SESSION_SECRET"
  env_set_key "$ENV_FILE" CERT_GATEWAY_SECRET "$CERT_GATEWAY_SECRET"
  env_set_key "$ENV_FILE" CERT_LOGIN_ENABLED "1"
  env_set_key "$ENV_FILE" CERT_ORIGIN "$CERT_ORIGIN"
  env_set_key "$ENV_FILE" POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
  env_set_key "$ENV_FILE" PA_DEMO "0"
  env_set_key "$ENV_FILE" VITE_PA_DEMO "0"
  env_set_key "$ENV_FILE" NODE_ENV "production"
  env_set_key "$ENV_FILE" COOKIE_SECURE "1"
  env_set_key "$ENV_FILE" TRUST_PROXY "1"
  env_set_key "$ENV_FILE" ACME_EMAIL "${ACME_EMAIL:-admin@${DOMAIN}}"
  env_set_key "$ENV_FILE" INSTALL_EDGE "$INSTALL_EDGE"
  env_set_key "$ENV_FILE" APP_PORT "$APP_PORT"
  env_set_key "$ENV_FILE" PROXY_BIND "${PROXY_BIND:-127.0.0.1}"
  env_set_key "$ENV_FILE" PROXY_NETWORK "${PROXY_NETWORK:-}"

  if [[ -n "$SINGLE" ]]; then
    env_set_key "$ENV_FILE" PA_SINGLE_MUNI "$SINGLE"
    env_set_key "$ENV_FILE" VITE_PA_SINGLE_MUNI "$SINGLE"
  fi

  if [[ -n "$SMTP_HOST" ]]; then
    env_set_key "$ENV_FILE" SMTP_HOST "$SMTP_HOST"
    env_set_key "$ENV_FILE" SMTP_PORT "$SMTP_PORT"
    env_set_key "$ENV_FILE" SMTP_USER "$SMTP_USER"
    env_set_key "$ENV_FILE" SMTP_PASS "$SMTP_PASS"
    env_set_key "$ENV_FILE" SMTP_FROM "$SMTP_FROM"
  fi

  if [[ "$HAVE_CLAVE" == "s" || "$HAVE_CLAVE" == "y" || "$HAVE_CLAVE" == "si" || "$HAVE_CLAVE" == "sí" ]]; then
    env_set_key "$ENV_FILE" SAML_IDP_SSO_URL "$SAML_IDP_SSO_URL"
    env_set_key "$ENV_FILE" SAML_CERTS_DIR "/app/apps/api/certs"
    env_set_key "$ENV_FILE" SAML_CERTS_HOST_DIR "./deploy/concello/saml-certs"
  else
    env_set_key "$ENV_FILE" SAML_CERTS_HOST_DIR "./deploy/concello/saml-certs"
  fi

  chmod 600 "$ENV_FILE"

  echo
  echo "Escrito ${ENV_FILE} (chmod 600)."
  echo "Segredos xerados. Non o subas ao git."
  echo

  require_docker

  if [[ -z "$INSTALL_BACKUP" ]]; then
    prompt INSTALL_BACKUP "Copias diarias: cron (host) / compose (servizo) / n (agora non)" "n"
  fi
  INSTALL_BACKUP="$(echo "${INSTALL_BACKUP:-n}" | tr '[:upper:]' '[:lower:]')"
  case "$INSTALL_BACKUP" in
    compose|servizo|service|s|2) INSTALL_BACKUP="compose" ;;
    cron|c|1) INSTALL_BACKUP="cron" ;;
    *) INSTALL_BACKUP="n" ;;
  esac
  env_set_key "$ENV_FILE" INSTALL_BACKUP "$INSTALL_BACKUP"

  echo "Levantando stack…"

  compose_up_build

  echo
  echo "Servizos en marcha."
  echo

  if [[ -n "$SINGLE" ]]; then
    echo "Primeiro arranque do concello (vía o contedor da API):"
    echo "  docker compose -f ${COMPOSE_BASE} --env-file ${ENV_FILE} exec api npm run setup -- --concello \"Concello de …\" --slug ${SINGLE} --ine …"
    echo "  docker compose -f ${COMPOSE_BASE} --env-file ${ENV_FILE} exec api npm run admin -- --email persoa@concello.gal --slug ${SINGLE} --nif … --invite"
  else
    echo "Modo Deputación: tras o convite da xestora, dá de alta os concellos desde o panel."
  fi
  echo

  BACKUP_CRON="15 3 * * * cd ${ROOT} && COMPOSE_FILE=${COMPOSE_BASE} ENV_FILE=${ENV_FILE} BACKUP_DIR=/var/backups/pista-aberta ./scripts/backup.sh >>/var/log/pista-backup.log 2>&1"
  if [[ "$INSTALL_BACKUP" == "cron" ]]; then
    mkdir -p /var/backups/pista-aberta 2>/dev/null || mkdir -p "${ROOT}/.data/backups"
    if command -v crontab >/dev/null 2>&1; then
      EXISTING="$(crontab -l 2>/dev/null || true)"
      if echo "$EXISTING" | grep -Fq "scripts/backup.sh"; then
        echo "Cron de copia xa presente; non se duplica."
      else
        { echo "$EXISTING"; echo "$BACKUP_CRON"; } | crontab -
        echo "Cron de copia instalado (03:15): scripts/backup.sh"
      fi
    else
      echo "AVISO: non hai «crontab» neste host. Engade a man:"
      echo "  $BACKUP_CRON"
    fi
  elif [[ "$INSTALL_BACKUP" == "compose" ]]; then
    echo "Servizo backup activo (perfil compose). Volume: pista_concello_backups."
  else
    echo "Copias diarias (opcional):"
    echo "  cron:  $BACKUP_CRON"
    echo "  ou:    docker compose -f ${COMPOSE_BASE} --env-file ${ENV_FILE} --profile backup up -d backup"
  fi
  echo

  if [[ "$INSTALL_EDGE" == "caddy" ]]; then
    echo "DNS: crea os rexistros A para «${DOMAIN}» e «cert.${DOMAIN}»."
  else
    print_proxy_docs "$DOMAIN" "${APP_PORT}" "$([[ "$INSTALL_EDGE" == "proxy-npm" ]] && echo npm || echo local)"
  fi
  echo "OCSP: a API comproba revogación (CERT_OCSP_REQUIRED=1). Proba demo: npm run demo-ca && docker compose -f ${COMPOSE_BASE} --profile demo-ocsp exec api npm run test:ocsp"

  if [[ "$SKIP_DOCKER" == "1" ]]; then
    msg done
    return 0
  fi

  if [[ -n "$SINGLE" && -n "$CONCELLO_NAME" && -n "$CONCELLO_INE" ]]; then
    require_valid_nif "ADMIN_NIF" "$ADMIN_NIF"
    echo
    echo "Configurando concello ${CONCELLO_NAME} (/${SINGLE})…"
    docker compose -f "$COMPOSE_BASE" --env-file "$ENV_FILE" exec -T api npm run setup -- \
      --concello "$CONCELLO_NAME" --slug "$SINGLE" --ine "$CONCELLO_INE"
    if [[ -n "$ADMIN_EMAIL" ]]; then
      set +e
      INVITE_OUT="$(docker compose -f "$COMPOSE_BASE" --env-file "$ENV_FILE" exec -T api npm run admin -- \
        --slug "$SINGLE" --email "$ADMIN_EMAIL" --nif "$ADMIN_NIF" ${ADMIN_NAME:+--name "$ADMIN_NAME"} --invite 2>&1)"
      INVITE_RC=$?
      set -e
      echo "$INVITE_OUT"
      if [[ "$INVITE_RC" -ne 0 ]]; then
        echo "ERRO: non se puido crear o convite da administradora (admin --invite fallou)." >&2
        exit 1
      fi
      echo "→ Convite admin (válido 7 días). Abre a ligazón no correo ou arriba."
    fi
    echo "✔ Concello creado coas instalacións do censo en borrador."
  fi

  if [[ -z "$SINGLE" && -n "$DEPUTACION_NAME" && -n "$DEP_MANAGER_EMAIL" ]]; then
    require_valid_nif "DEP_MANAGER_NIF" "$DEP_MANAGER_NIF"
    echo
    echo "Configurando entidade Deputación e convite da xestora…"
    set +e
    DEP_INVITE_OUT="$(docker compose -f "$COMPOSE_BASE" --env-file "$ENV_FILE" exec -T api npm run admin -- \
      --deputacion --invite \
      --email "$DEP_MANAGER_EMAIL" \
      --org-name "$DEPUTACION_NAME" \
      --org-email "$DEPUTACION_EMAIL" \
      --nif "$DEP_MANAGER_NIF" \
      ${DEP_MANAGER_NAME:+--name "$DEP_MANAGER_NAME"} 2>&1)"
    DEP_INVITE_RC=$?
    set -e
    echo "$DEP_INVITE_OUT"
    if [[ "$DEP_INVITE_RC" -ne 0 ]]; then
      echo "ERRO: non se puido crear o convite da xestora (admin --deputacion --invite fallou)." >&2
      exit 1
    fi
    DEP_URL="$(echo "$DEP_INVITE_OUT" | grep -Eo 'https?://[^ ]+/convite/[^ ]+' | head -1 || true)"
    if [[ -z "$DEP_URL" ]]; then
      DEP_TOK="$(echo "$DEP_INVITE_OUT" | grep -Eo 'Token: [^ ]+' | head -1 | awk '{print $2}' || true)"
      if [[ -n "$DEP_TOK" ]]; then
        DEP_URL="https://${DOMAIN}/convite/${DEP_TOK}"
      fi
    fi
    if [[ -n "$DEP_URL" ]]; then
      echo "→ Entra en ${DEP_URL} co certificado da xestora e dá de alta os concellos desde o panel."
    else
      echo "→ Entra en https://${DOMAIN}/convite/<token> co certificado da xestora e dá de alta os concellos desde o panel."
    fi
  fi

  if [[ "$INSTALL_EDGE" != "caddy" ]] || [[ "$SKIP_DOCKER" == "1" ]]; then
    :
  else
    wait_health || echo "AVISO: /health aínda non responde; revisa os contedores."
  fi

  msg done
}

# ---------------------------------------------------------------------------
# Menú instalación existente
# ---------------------------------------------------------------------------
existing_install_menu() {
  if [[ "$NONINTERACTIVE" == "1" ]]; then
    msg ni_existing
    exit 0
  fi
  msg existing_menu
  local choice=""
  read -r -p "$(msg existing_choice) [3]: " choice || true
  case "${choice:-3}" in
    1) do_update ;;
    2) do_reconfig ;;
    *) msg bye; exit 0 ;;
  esac
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
select_language

case "$CMD" in
  actualizar|update)
    do_update
    ;;
  reconfig|reconfigure|cambiar)
    do_reconfig
    ;;
  "" )
    if [[ -f "$ENV_FILE" ]]; then
      existing_install_menu
    else
      do_fresh_install
    fi
    ;;
  -h|--help|help)
    echo "Uso: $0 [actualizar|update|reconfig] [--dominio DOMINIO] [--sen-copia]"
    echo "  sen args              instalación nova ou menú se xa existe .env.install"
    echo "  --dominio|--domain X  dominio público (preenche o prompt; p.ex. reservas.concello.gal)"
    echo "  actualizar|update     backup → pull → env novas → compose up → /health"
    echo "  --sen-copia           continuar a actualización se falla a copia (perigo)"
    echo "  reconfig              dominio / correo / SMTP e reinicio"
    ;;
  *)
    echo "Argumento descoñecido: $CMD (proba: actualizar | update | reconfig)" >&2
    exit 1
    ;;
esac
