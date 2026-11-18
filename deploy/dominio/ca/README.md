# Paquete de AC de cliente (mTLS)

Ficheiro montado en nginx: `trusted-client-cas.pem` (PEM concatenados).

**Non descargar en tempo de build.** As AC oficiais están versionadas en `official/` (só certificados públicos).

| Emisor | Certificados | Fonte oficial |
|---|---|---|
| FNMT-RCM (G1) | `AC RAIZ FNMT-RCM`, `AC FNMT Usuarios`, `AC Representación` | [sede.fnmt.gob.es → certificados raíz](https://www.sede.fnmt.gob.es/descargas/certificados-raiz-de-la-fnmt) |
| FNMT-RCM (G2) | `AC RAIZ FNMT-RCM G2`, `AC USUARIOS G2`, `AC REPRESENTACIÓN G2` | mesma páxina FNMT |
| DNIe (DGP) | `AC RAIZ DNIE 2`, `AC RAIZ DNIE`, `AC DNIE 004/005/006` | [pki.policia.es/dnie/certs](http://pki.policia.es/dnie/certs/) · [dnielectronico.es](https://www.dnielectronico.es/) |
| Demo | `demo-ca.pem` | `scripts/demo-ca.sh` (só público no bundle; clave privada **nunca** no git) |

## URLs de descarga (2026-10-22)

Base FNMT: `https://www.sede.fnmt.gob.es/documents/10445900/10526749/`

| Ficheiro | URL |
|---|---|
| AC Raíz FNMT-RCM | `…/AC_Raiz_FNMT-RCM_SHA256.cer` |
| AC FNMT Usuarios | `…/AC_FNMT_Usuarios.cer` |
| AC Representación | `…/AC_Representacion.cer` |
| AC Raíz FNMT-RCM G2 | `…/AC_Raiz_FNMT-RCM_G2.cer` |
| AC Usuarios G2 | `…/AC_Usuarios_G2.cer` |
| AC Representación G2 | `…/AC_Representacion_G2.cer` |

Base DNIe: `http://pki.policia.es/dnie/certs/` → `ACRaiz2.crt`, `ACraiz.crt`, `AC004.crt`, `AC005.crt`, `AC006.crt`.

## Inventario no bundle (`trusted-client-cas.pem`)

Data descarga: **2026-10-22**. Pegadas SHA-256 do certificado (openssl `-fingerprint -sha256`). SHA-1 comprobado contra as publicadas pola FNMT / DGP.

| Ficheiro | Suxeito (CN) | SHA-256 | SHA-1 (oficial) |
|---|---|---|---|
| `official/fnmt/AC_Raiz_FNMT-RCM_SHA256.pem` | AC RAIZ FNMT-RCM | `EBC5570C…9B93FA` | `ec503507b215c4956219e2a89a5b42992c4c2c20` ✓ |
| `official/fnmt/AC_FNMT_Usuarios.pem` | AC FNMT Usuarios | `601293CA…E9A869` | `808b72e43b574cf5877cb841a8df88396d38ab94` ✓ |
| `official/fnmt/AC_Representacion.pem` | AC Representación | `8FD16A17…AF754B` | `eeebd3f6990b036d79d504ea7e4ec7c1ee2a8c13` ✓ |
| `official/fnmt/AC_Raiz_FNMT-RCM_G2.pem` | AC RAIZ FNMT-RCM G2 | `02078653…03FBE2` | `a4d6b770e765a9bf17ecd7b5e03b852d612fa71d` ✓ |
| `official/fnmt/AC_Usuarios_G2.pem` | AC USUARIOS G2 | `283A9F9F…C5AF89` | `e9f499a0efeff7a60e9fe6b52fa3a8febbbdba0a` ✓ |
| `official/fnmt/AC_Representacion_G2.pem` | AC REPRESENTACIÓN G2 | `0DF2883B…087D9D64` | `ea14f87a91b6a62c6d5f40b5642520380ec1c12a` ✓ |
| `official/dnie/ACRaiz2.pem` | AC RAIZ DNIE 2 | `C5C380EB…126C11` | `eb4d6902fd60ecd50ee58e2c9f20292c391027ce` ✓ |
| `official/dnie/ACraiz.pem` | AC RAIZ DNIE | `F5792110…879830F5` | `2229f056d34d1cb63e986f26b2d08ab94ff08e4d` ✓ |
| `official/dnie/AC004.pem` | AC DNIE 004 | `EBAE9930…046F6C` | `3f7a70b98273db7e026b95da49e9b6930d65829a` ✓ |
| `official/dnie/AC005.pem` | AC DNIE 005 | `828A22FF…8EE828` | `e70cf3b6c8567629b69be8c95d63d9040085c195` ✓ |
| `official/dnie/AC006.pem` | AC DNIE 006 | `EDA47E8A…103BBD` | `423bb49739ea4e1be6f47161eab8977bf655b7ee` ✓ |
| *(demo)* | Pista Aberta DEMO CA | *(xerada con `scripts/demo-ca.sh`)* | n/a |

## Como rexenerar o paquete

```bash
# Oficiais (xa en official/*.pem) + demo pública:
cat \
  official/fnmt/AC_Raiz_FNMT-RCM_SHA256.pem \
  official/fnmt/AC_FNMT_Usuarios.pem \
  official/fnmt/AC_Representacion.pem \
  official/fnmt/AC_Raiz_FNMT-RCM_G2.pem \
  official/fnmt/AC_Usuarios_G2.pem \
  official/fnmt/AC_Representacion_G2.pem \
  official/dnie/ACRaiz2.pem \
  official/dnie/ACraiz.pem \
  official/dnie/AC004.pem \
  official/dnie/AC005.pem \
  official/dnie/AC006.pem \
  > trusted-client-cas.official.pem

# Demo en paralelo (sen substituír oficiais):
cat trusted-client-cas.official.pem ../../demo-ca/demo-ca.pem > trusted-client-cas.pem

./scripts/check-ca-bundle.sh trusted-client-cas.pem
# Recarga só o gateway (non tocar proxy):
# docker compose … exec gateway nginx -s reload
```

> As claves privadas da AC de demo e `ocsp.key` **non** van a este cartafol no git.
