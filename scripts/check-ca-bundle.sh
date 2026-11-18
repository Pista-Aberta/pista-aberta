#!/usr/bin/env bash
# Lista suxeito, emisor e caducidade de cada AC dun paquete PEM.
set -euo pipefail
FILE="${1:-deploy/dominio/ca/trusted-client-cas.pem}"
if [[ ! -f "$FILE" ]]; then
  echo "Falta $FILE — ver deploy/dominio/ca/README.md" >&2
  exit 1
fi
openssl crl2pkcs7 -nocrl -certfile "$FILE" 2>/dev/null \
  | openssl pkcs7 -print_certs -noout 2>/dev/null \
  || openssl storeutl -noout -text -certs "$FILE" 2>/dev/null \
  || { echo "Non se puido ler $FILE"; exit 1; }
