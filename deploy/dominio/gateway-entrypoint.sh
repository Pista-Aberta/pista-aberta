#!/bin/sh
set -e
LIVE=/etc/letsencrypt/live/${CERT_HOST}
if [ ! -f "$LIVE/fullchain.pem" ]; then
  mkdir -p "$LIVE"
  if ! command -v openssl >/dev/null 2>&1; then
    # nginx:alpine non trae openssl; provisional só no primeiro arranque
    apk add --no-cache openssl >/dev/null
  fi
  openssl req -x509 -nodes -newkey rsa:2048 -days 2 -subj "/CN=${CERT_HOST}" \
    -keyout "$LIVE/privkey.pem" -out "$LIVE/fullchain.pem"
  echo "[gateway] certificado PROVISIONAL autofirmado para ${CERT_HOST}"
fi
# Recarga cada 12 h para coller as renovacións de certbot
( while true; do sleep 43200; nginx -s reload; done ) &
exec /docker-entrypoint.sh nginx -g 'daemon off;'
