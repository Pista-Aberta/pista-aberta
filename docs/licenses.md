# Licenzas das dependencias

**Produto:** Pista Aberta · **Licenza do código propio:** [EUPL-1.2](../LICENSE).

Todas as dependencias de produción revisadas son **software libre** e **compatibles coa EUPL-1.2** (permisivas MIT/Apache/BSD ou copyleft compatible).

## Runtime (apps/api + apps/web + packages/shared)

| Paquete | Licenza | Notas |
|---|---|---|
| hono | MIT | |
| @hono/node-server | MIT | |
| drizzle-orm | Apache-2.0 | |
| postgres | MIT | |
| zod | MIT | |
| nodemailer | MIT | |
| @node-saml/node-saml | MIT | |
| xml-crypto / @xmldom/xmldom | MIT | |
| @peculiar/x509 | MIT | validación de certificados |
| @peculiar/webcrypto | MIT | WebCrypto para OCSP/PKI |
| qrcode | MIT | QR de porta / partidos |
| sharp | Apache-2.0 | procesado de imaxes |
| react / react-dom / react-router-dom | MIT | |
| i18next / react-i18next | MIT | |
| lucide-react | ISC | iconas UI |
| d3-geo | ISC | mapa Galicia (landing) |
| @fontsource/atkinson-hyperlegible-next | OFL-1.1 | tipografía autoaloxada |
| @fontsource-variable/bricolage-grotesque | OFL-1.1 | tipografía autoaloxada |
| jsqr | Apache-2.0 | chunk lazy |
| vite / typescript (build) | MIT | |

## SBOM

Xerar CycloneDX:

```bash
npm run sbom
```

Saída: `sbom/cyclonedx.json` (non commitada por defecto se é moi grande; o CI pode publicala como artefacto).

## Política

- Non engadir dependencias privativas.
- Antes de unha dependencia nova: comprobar licenza en `npm view <pkg> license`.
- `npm audit --omit=dev` no CI.
