#!/usr/bin/env bash
# Comproba que cert.* anuncia as AC oficiais (FNMT + DNIe) no handshake TLS.
set -euo pipefail
HOST="${1:-cert.pistaaberta.com}"
echo "== Acceptable client certificate CA names ($HOST) =="
echo | openssl s_client -connect "${HOST}:443" -servername "$HOST" 2>/dev/null \
  | awk '/Acceptable client certificate CA names/,/^---$/'
echo
echo "Esperado: AC RAIZ FNMT-RCM, AC FNMT Usuarios / AC USUARIOS G2, AC RAIZ DNIE 2, AC DNIE 004/005/006."
echo "Proba mTLS demo (se tes o .p12 no VPS):"
echo "  curl -sk --cert-type P12 --cert deploy/demo-ca/cidada-demo.p12:demo https://${HOST}/proba"
