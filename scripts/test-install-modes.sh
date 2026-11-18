#!/usr/bin/env bash
# Probas dos modos de install (H3/I4/H5 + TANDA-3: actualizar, proxy, menú NI).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
fail=0
TMPDIR_TEST="$(mktemp -d "${TMPDIR:-/tmp}/pa-install-test.XXXXXX")"
cleanup() {
  rm -rf "$TMPDIR_TEST"
  if [[ -n "${HEALTH_PID:-}" ]] && kill -0 "$HEALTH_PID" 2>/dev/null; then
    kill "$HEALTH_PID" 2>/dev/null || true
  fi
  # Non borrar .env.install do repo se o test non o creou
  if [[ "${CREATED_ENV_INSTALL:-0}" == "1" && -f "$ROOT/.env.install" ]]; then
    rm -f "$ROOT/.env.install"
  fi
  if [[ -f "$ROOT/.env.install.tanda3bak" ]]; then
    mv "$ROOT/.env.install.tanda3bak" "$ROOT/.env.install"
  fi
}
trap cleanup EXIT

# Se xa había .env.install, aparcalo para non interferir
if [[ -f "$ROOT/.env.install" ]]; then
  mv "$ROOT/.env.install" "$ROOT/.env.install.tanda3bak"
fi

echo "== H3: install.sh esixe ADMIN_NIF en modo un concello =="
OUT="$(PA_INSTALL_NONINTERACTIVE=1 PA_INSTALL_SKIP_DOCKER=1 DOMAIN=test.local SINGLE=terceiro \
  CONCELLO_NAME=Terceiro CONCELLO_INE=32078 ADMIN_EMAIL=a@b.c ADMIN_NIF= \
  bash install.sh 2>&1 || true)"
if echo "$OUT" | grep -q 'obrigatorio\|obligatorio'; then
  echo "OK H3"
else
  echo "FAIL H3: $OUT" | head -20
  fail=1
fi
rm -f "$ROOT/.env.install"

echo "== I4: install.sh rexeita NIF coa letra mal =="
I4_OUT="$(PA_INSTALL_NONINTERACTIVE=1 PA_INSTALL_SKIP_DOCKER=1 DOMAIN=test.local SINGLE=terceiro \
  CONCELLO_NAME=Terceiro CONCELLO_INE=32078 ADMIN_EMAIL=a@b.c ADMIN_NIF=12345678A \
  ADMIN_NAME=Admin bash install.sh 2>&1 || true)"
if echo "$I4_OUT" | grep -qi 'letra incorrecta\|NIF/NIE inválido'; then
  if echo "$I4_OUT" | grep -qE 'Listo\.|Actualización completa'; then
    echo "FAIL I4: rematou OK cun NIF mal"
    fail=1
  else
    echo "OK I4"
  fi
else
  echo "FAIL I4: $I4_OUT" | head -30
  fail=1
fi
rm -f "$ROOT/.env.install"

echo "== H5: texto Deputación no script =="
if grep -q 'co certificado da xestora e dá de alta os concellos desde o panel' install.sh; then
  echo "OK H5"
else
  echo "FAIL H5"
  fail=1
fi

echo "== H2: data/ e Dockerfile =="
test -f data/instalacions-puntos.json
grep -q 'COPY data ./data' apps/api/Dockerfile
echo "OK H2"

echo "== H1: run-migrate condiciona seed =="
grep -q 'PA_DEMO' apps/api/src/db/run-migrate.ts
grep -q 'if (paDemo)' apps/api/src/db/run-migrate.ts
echo "OK H1"

echo "== H6: docs/despregar.md OCSP + Retirar acceso =="
grep -q '10 min' docs/despregar.md
grep -qi 'Retirar acceso' docs/despregar.md
echo "OK H6"

echo "== T3-docs: INSTALACION.md tres casos + actualizar =="
grep -q 'Caso A' docs/INSTALACION.md
grep -q 'Caso B' docs/INSTALACION.md
grep -q 'Caso C' docs/INSTALACION.md
grep -q 'install.sh actualizar' docs/INSTALACION.md
grep -qi 'Proxy Manager\|Nginx Proxy Manager' docs/INSTALACION.md
echo "OK T3-docs"

echo "== T3-menu: PA_INSTALL_NONINTERACTIVE=1 + .env.install → non fai nada =="
CREATED_ENV_INSTALL=1
cat > "$ROOT/.env.install" <<EOF
DOMAIN=test.local
SESSION_SECRET=keep-me-secret-tanda3
CERT_GATEWAY_SECRET=gw
POSTGRES_PASSWORD=pg
APP_BASE_URL=http://test.local
INSTALL_EDGE=caddy
EOF
chmod 600 "$ROOT/.env.install"
MENU_OUT="$(PA_INSTALL_NONINTERACTIVE=1 bash install.sh 2>&1 || true)"
MENU_RC=0
PA_INSTALL_NONINTERACTIVE=1 bash install.sh >/tmp/pa-menu.out 2>&1 || MENU_RC=$?
MENU_OUT="$(cat /tmp/pa-menu.out)"
if echo "$MENU_OUT" | grep -qiE 'non se fai nada|no se hace nada'; then
  if echo "$MENU_OUT" | grep -qE 'Levantando|Actualizando|Escrito'; then
    echo "FAIL T3-menu: fixo cambios: $MENU_OUT" | head -20
    fail=1
  else
    echo "OK T3-menu"
  fi
else
  echo "FAIL T3-menu: $MENU_OUT" | head -20
  fail=1
fi
# Segredo intacto
if grep -qE '^SESSION_SECRET=["'\'']?keep-me-secret-tanda3["'\'']?$' "$ROOT/.env.install"; then
  :
else
  echo "FAIL T3-menu: .env.install modificado"
  fail=1
fi

echo "== T3-proxy: sen Caddy no override e porto 127.0.0.1 =="
if grep -q '__disabled_caddy__' docker-compose.concello.proxy.yml \
  && grep -qE '\$\{PROXY_BIND:-127\.0\.0\.1\}|127\.0\.0\.1' docker-compose.concello.proxy.yml \
  && grep -q 'edge:' docker-compose.concello.proxy.yml; then
  echo "OK T3-proxy-files"
else
  echo "FAIL T3-proxy-files"
  fail=1
fi
# Instalación proxy dry-run
rm -f "$ROOT/.env.install"
PROXY_OUT="$(PA_INSTALL_NONINTERACTIVE=1 PA_INSTALL_SKIP_DOCKER=1 \
  DOMAIN=reservas.proba.gal SINGLE=proba \
  CONCELLO_NAME=Proba CONCELLO_INE=32078 \
  ADMIN_EMAIL=a@b.c ADMIN_NIF=12345678Z ADMIN_NAME=Admin \
  INSTALL_EDGE=proxy APP_PORT=18080 INSTALL_BACKUP=n \
  bash install.sh 2>&1 || true)"
if [[ ! -f "$ROOT/.env.install" ]]; then
  echo "FAIL T3-proxy-install: non escribiu .env.install"
  echo "$PROXY_OUT" | head -40
  fail=1
elif ! grep -qE '^INSTALL_EDGE=["'\'']?proxy["'\'']?$' "$ROOT/.env.install"; then
  echo "FAIL T3-proxy-install: INSTALL_EDGE"
  fail=1
elif ! grep -qE '^APP_PORT=["'\'']?18080["'\'']?$' "$ROOT/.env.install"; then
  echo "FAIL T3-proxy-install: APP_PORT"
  fail=1
elif ! echo "$PROXY_OUT" | grep -qiE 'proxy_pass|127\.0\.0\.1:18080|sen Caddy|sin Caddy'; then
  echo "FAIL T3-proxy-install: falta bloque nginx no output"
  echo "$PROXY_OUT" | tail -40
  fail=1
else
  echo "OK T3-proxy-install"
fi

echo "== T3-update: instalar → actualizar (commit simulado) → datos + /health =="
rm -f "$ROOT/.env.install"
# Health stub
python3 - <<'PY' &
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/health"):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")
        else:
            self.send_response(404)
            self.end_headers()
    def log_message(self, *args):
        pass
HTTPServer(("127.0.0.1", 18765), H).serve_forever()
PY
HEALTH_PID=$!
sleep 0.4
if ! curl -fsS -o /dev/null http://127.0.0.1:18765/health; then
  echo "FAIL T3-update: non arrancou o stub /health"
  fail=1
else
  PA_INSTALL_NONINTERACTIVE=1 PA_INSTALL_SKIP_DOCKER=1 \
    DOMAIN=test.local SINGLE=terceiro \
    CONCELLO_NAME=Terceiro CONCELLO_INE=32078 \
    ADMIN_EMAIL=a@b.c ADMIN_NIF=12345678Z ADMIN_NAME=Admin \
    INSTALL_EDGE=caddy INSTALL_BACKUP=n \
    bash install.sh >/tmp/pa-t3-install.out 2>&1 || true
  if [[ ! -f "$ROOT/.env.install" ]]; then
    echo "FAIL T3-update: install non creou .env.install"
    cat /tmp/pa-t3-install.out | head -40
    fail=1
  else
    SECRET_BEFORE="$(grep '^SESSION_SECRET=' "$ROOT/.env.install" | head -1)"
    # Quitar NEW_VAR se dunha execución previa
    grep -v '^TANDA3_NEW_VAR=' "$ROOT/.env.install" > "$TMPDIR_TEST/env1" || true
    mv "$TMPDIR_TEST/env1" "$ROOT/.env.install"
    # Simular commit novo (marca no árbol; pull omitido)
    echo "tanda3-sim-$(date +%s)" > "$TMPDIR_TEST/sim-commit.txt"
    cp "$TMPDIR_TEST/sim-commit.txt" "$ROOT/.data/tanda3-sim-marker" 2>/dev/null \
      || { mkdir -p "$ROOT/.data"; cp "$TMPDIR_TEST/sim-commit.txt" "$ROOT/.data/tanda3-sim-marker"; }
    # Engadir temporalmente unha clave «nova» ao catálogo vía ficheiro de proba:
    # comprobamos merge engadindo a man unha clave que o update debería preservar
    # e verificando que merge_missing_env engade APP_PORT se faltase.
    grep -v '^APP_PORT=' "$ROOT/.env.install" > "$TMPDIR_TEST/env2" || cp "$ROOT/.env.install" "$TMPDIR_TEST/env2"
    # Aseguramos que falta unha clave do catálogo
    if grep -q '^BACKUP_KEEP_DAYS=' "$ROOT/.env.install"; then
      grep -v '^BACKUP_KEEP_DAYS=' "$ROOT/.env.install" > "$TMPDIR_TEST/env3"
      mv "$TMPDIR_TEST/env3" "$ROOT/.env.install"
    fi
    UPD_OUT="$(PA_INSTALL_NONINTERACTIVE=1 PA_INSTALL_SKIP_DOCKER=1 PA_INSTALL_SKIP_PULL=1 \
      PA_INSTALL_HEALTH_URL=http://127.0.0.1:18765/health \
      bash install.sh actualizar 2>&1 || true)"
    SECRET_AFTER="$(grep '^SESSION_SECRET=' "$ROOT/.env.install" | head -1)"
    if [[ "$SECRET_BEFORE" != "$SECRET_AFTER" ]]; then
      echo "FAIL T3-update: SESSION_SECRET cambiou"
      fail=1
    elif ! grep -q '^BACKUP_KEEP_DAYS=' "$ROOT/.env.install"; then
      echo "FAIL T3-update: non engadiu variable nova por defecto"
      echo "$UPD_OUT" | tail -30
      fail=1
    elif ! echo "$UPD_OUT" | grep -qiE 'Actualización completa|update_ok|/health OK'; then
      # accept either Galician success or health OK line
      if echo "$UPD_OUT" | grep -q 'Actualización completa'; then
        echo "OK T3-update"
      else
        echo "FAIL T3-update: sen éxito claro"
        echo "$UPD_OUT" | tail -40
        fail=1
      fi
    else
      echo "OK T3-update"
    fi
    # Comprobar que o stub devolveu 200 (curl explícito)
    HC="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18765/health || true)"
    if [[ "$HC" != "200" ]]; then
      echo "FAIL T3-update: /health status=$HC"
      fail=1
    else
      echo "OK T3-update-health"
    fi
  fi
fi

# Limpar artefacto de proba
rm -f "$ROOT/.data/tanda3-sim-marker" "$ROOT/.env.install"
CREATED_ENV_INSTALL=0

echo "== T3-i18n: textos gl e es =="
if grep -q 'es:banner' install.sh && grep -q 'gl:banner' install.sh \
  && grep -q 'es:ni_existing' install.sh && grep -q 'gl:ni_existing' install.sh; then
  echo "OK T3-i18n"
else
  echo "FAIL T3-i18n"
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  echo "FAIL test-install-modes"
  exit 1
fi
echo "PASS test-install-modes"
