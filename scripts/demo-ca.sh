#!/usr/bin/env bash
# Xera AC de demo + .p12 de proba en deploy/demo-ca/ (local/VPS).
# NUNCA committear: *.key, ocsp.key, index.txt.attr con estado privado.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/deploy/demo-ca"
mkdir -p "$OUT"
cd "$OUT"

PASS=demo
DAYS=825

# AC
if [[ ! -f demo-ca.key ]]; then
  openssl genrsa -out demo-ca.key 2048
fi
openssl req -new -x509 -days "$DAYS" -key demo-ca.key -out demo-ca.pem \
  -subj "/CN=Pista Aberta DEMO CA - NON VALIDA/O=Pista Aberta (probas)/C=ES"

# OCSP signer
if [[ ! -f ocsp.key ]]; then
  openssl genrsa -out ocsp.key 2048
fi
openssl req -new -key ocsp.key -out ocsp.csr \
  -subj "/CN=Pista Aberta DEMO OCSP/O=Pista Aberta (probas)/C=ES"
openssl x509 -req -in ocsp.csr -CA demo-ca.pem -CAkey demo-ca.key -CAcreateserial \
  -out ocsp.pem -days "$DAYS" -extfile <(printf "basicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=OCSPSigning\n")
rm -f ocsp.csr

touch index.txt
echo "01" > serial

# Extensións cliente estilo FNMT + AIA OCSP
mk_client() {
  local name="$1" cn="$2" serial_attr="$3" given="$4" surname="$5" extra="${6:-}"
  local ext="$OUT/${name}.ext"
  cat > "$ext" <<EOF
basicConstraints=CA:FALSE
keyUsage=digitalSignature
extendedKeyUsage=clientAuth
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
authorityInfoAccess=OCSP;URI:http://pa-ocsp-demo:2560
subjectAltName=email:demo@pistaaberta.local
EOF
  openssl genrsa -out "${name}.key" 2048
  local subj="/CN=${cn}/serialNumber=${serial_attr}/GN=${given}/SN=${surname}/C=ES"
  if [[ -n "$extra" ]]; then
    subj="${subj}/${extra}"
  fi
  openssl req -new -key "${name}.key" -out "${name}.csr" -subj "$subj"
  openssl x509 -req -in "${name}.csr" -CA demo-ca.pem -CAkey demo-ca.key -CAcreateserial \
    -out "${name}.pem" -days "$DAYS" -extfile "$ext"
  openssl pkcs12 -export -out "${name}.p12" -inkey "${name}.key" -in "${name}.pem" \
    -certfile demo-ca.pem -passout "pass:${PASS}"
  # Index para OCSP (V = válido)
  local end
  end="$(openssl x509 -in "${name}.pem" -noout -enddate | cut -d= -f2)"
  local ser
  ser="$(openssl x509 -in "${name}.pem" -noout -serial | cut -d= -f2)"
  printf 'V\t%s\t\t%s\tunknown\t%s\n' "$(date -u -d "$end" +%y%m%d%H%M%SZ 2>/dev/null || date -u -j -f "%b %e %T %Y %Z" "$end" +%y%m%d%H%M%SZ 2>/dev/null || echo 991231235959Z)" "$ser" "$subj" >> index.txt
  rm -f "${name}.csr" "$ext"
}

rm -f index.txt
touch index.txt

mk_client "cidada-demo" "Ana Demo - 88888888Y" "IDCES-88888888Y" "Ana" "Riveira"
mk_client "admin-demo" "Admin Demo - 11223344B" "IDCES-11223344B" "Admin" "Admin"
mk_client "club-demo" "Representante Club" "IDCES-11111111H" "Representante" "Club" "organizationIdentifier=VATES-B15000000/O=Club Demo"

# Revogado
mk_client "revogado-demo" "Revogado Demo - 12345678Z" "IDCES-12345678Z" "Revogado" "Demo"
# Marcar última liña como R
if grep -q '12345678Z' index.txt; then
  # Substitúe V→R na liña do revogado (portable)
  awk '/12345678Z/ {sub(/^V/,"R")} {print}' index.txt > index.txt.tmp && mv index.txt.tmp index.txt
fi

# .gitignore local do cartafol
cat > .gitignore <<'GI'
*.key
ocsp.key
*.csr
index.txt
index.txt.attr
serial
*.srl
demo-ca.srl
GI

echo "[demo-ca] xerado en $OUT (contrasinal .p12: demo)"
echo "[demo-ca] Copiar demo-ca.pem ao paquete de AC só en demo:"
echo "  cat $OUT/demo-ca.pem >> deploy/dominio/ca/trusted-client-cas.pem"
