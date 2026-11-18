# Acceso con certificado dixital (FNMT, DNIe e outros cualificados)

Instrucións para Cursor. Engadir un **terceiro método de acceso** sen tocar os que xa hai:

| Método | Estado | Para que |
|---|---|---|
| SAML → Cl@ve | xa existe (mock na demo) | acceso estándar da AXE |
| Correo + código | xa existe | ponte operativa, móbil |
| **Certificado dixital / DNIe** | **NOVO** | acceso directo sen convenio con Cl@ve; funciona desde o día 1 |

> **Demo:** app en `demo.pistaaberta.com` e certificado en `cert.pistaaberta.com`. O despregamento (proxy, Let's Encrypt, OCSP de demo) descríbese en `OPERACION.md` e `INSTALACION.md`; facelo **antes** deste documento. Nos exemplos de abaixo úsanse `${APP_HOST}` e `${CERT_HOST}`.

Base legal: art. 9.2.a Lei 39/2015 (sistemas baseados en certificados cualificados). Non precisa Autofirma: o navegador presenta o certificado no saúdo TLS (mTLS).

> Regra de ouro: **a API nunca le un certificado directamente do navegador.** Quen valida é o proxy TLS (nginx). A API só se fía dun proxy que proba quen é cun segredo compartido, e sempre volve analizar o certificado ela mesma.

---

## 0. Requisito previo de despregamento (BLOQUEANTE)

O mTLS esixe que **o TLS remate no noso nginx**. Con **un proxy TLS externo non funciona** (o TLS remátao túnel VPN) e con Traefik/outro panel hai que configuralo á parte (ver §7).

- Subdominio dedicado: `cert.pistaaberta.com` (a app vai en `demo.pistaaberta.com`).
- Certificado de servidor Let's Encrypt para ese subdominio (certbot ou acme.sh).
- Porto 443 público cara ao contedor `gateway`.
- O resto da app segue en `pistaaberta.com` / `<slug>.pistaaberta.com` sen pedir certificado (para que o navegador non lle pregunte a todo o mundo).

---

## 1. Fluxo

```
[Navegador] --(1) clic «Certificado dixital»--> app: POST /auth/login {method:"certificate", municipalityId, returnTo}
            <-- {redirectUrl: "https://cert.pistaaberta.com/auth/cert/start?state=..."} 
[Navegador] --(2) TLS con certificado de cliente--> nginx cert.*  (valida cadea + OCSP)
nginx       --(3) proxy + cabeceiras + segredo--> API /auth/cert/callback
API         --(4) analiza cert, resolve persoa, crea TICKET dun só uso (60 s)
            <-- 302 https://<app>/auth/cert/finish?ticket=...
[Navegador] --(5) GET /auth/cert/finish (orixe da app)--> API troca ticket → cookie pa_sesion → 302 returnTo
```

Por que o ticket: a cookie de sesión debe crearse na **orixe da app**, non en `cert.*`. Non usar `Domain=.pistaaberta.com`.

`state`: valor aleatorio gardado en BD co `municipalityId` e o `returnTo` (validado coa mesma lista branca que xa usa `resolvePostLoginPath`). Caduca en 5 min e só se usa unha vez. Evita CSRF de login e que se inxecte un `returnTo` externo.

---

## 2. nginx (`deploy/vps/nginx-gateway.conf` → pasar a template)

Usar `/etc/nginx/templates/*.conf.template` da imaxe oficial (fai envsubst) para meter `${CERT_GATEWAY_SECRET}`.

```nginx
# ——— Servidor de certificado (só /auth/cert/*) ———
server {
  listen 443 ssl;
  http2 on;
  server_name ${CERT_HOST};

  ssl_certificate     /etc/letsencrypt/live/${CERT_HOST}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${CERT_HOST}/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;

  # Lista PECHADA de AC admitidas (raíces + intermedias). Ver §3.
  ssl_client_certificate /etc/nginx/ca/trusted-client-cas.pem;
  ssl_verify_client optional;          # NUNCA optional_no_ca
  ssl_verify_depth 3;

  # Revogación (nginx >= 1.19). Se o OCSP non responde → FAILED → denegar.
  ssl_ocsp leaf;
  ssl_ocsp_cache shared:ocsp:10m;
  resolver 127.0.0.11 9.9.9.9 valid=300s;
  resolver_timeout 5s;

  add_header Strict-Transport-Security "max-age=31536000" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;

  location = /auth/cert/start {
    if ($ssl_client_verify != SUCCESS) {
      return 302 ${APP_BASE_URL}/acceso?erro=cert&motivo=$ssl_client_verify;
    }
    proxy_pass http://pa_api/auth/cert/callback$is_args$args;
    proxy_set_header Host $host;
    # proxy_set_header SUBSTITÚE calquera cabeceira co mesmo nome enviada polo cliente
    proxy_set_header X-PA-Cert-Verify  $ssl_client_verify;
    proxy_set_header X-PA-Cert         $ssl_client_escaped_cert;
    proxy_set_header X-PA-Gateway-Auth "${CERT_GATEWAY_SECRET}";
  }

  location / { return 404; }
}
```

E no **servidor principal** (o actual), en `location /api/` e `location /auth/`, borrar estas cabeceiras sempre (valor baleiro = nginx non as envía):

```nginx
    proxy_set_header X-PA-Cert-Verify  "";
    proxy_set_header X-PA-Cert         "";
    proxy_set_header X-PA-Gateway-Auth "";
```

Engadir tamén `location = /auth/cert/callback { return 404; }` no servidor principal: o callback só se alcanza desde o servidor `cert.*`.

Se o usuario cancela o diálogo ou non ten certificado, `$ssl_client_verify` vale `NONE`, e nginx redirixe a `/acceso?erro=cert&motivo=NONE`. **Non** usar `ssl_verify_client on`, que daría unha páxina 400 fea de nginx.

---

## 3. Autoridades de certificación admitidas

Ficheiro `deploy/vps/ca/trusted-client-cas.pem` (PEM concatenados). **Descargar a man das webs oficiais e comprobar as pegadas SHA-256**; non descargar en tempo de build.

| Emisor | Certificados que entran | Fonte oficial |
|---|---|---|
| FNMT-RCM | `AC RAIZ FNMT-RCM`, `AC FNMT Usuarios`, `AC Representación` | sede.fnmt.gob.es → Descargas → certificados raíz |
| DNIe (DG Policía) | `AC RAIZ DNIE 2` + intermedias `AC DNIE 004/005/006` | dnielectronico.es → Zona de descargas |
| Outros cualificados (fase 2) | ACCV, Camerfirma, ANF, Izenpe… | TSL de España (lista de confianza do Ministerio) |

- Documentar en `deploy/vps/ca/README.md` cada ficheiro, a súa pegada SHA-256 e a data de descarga.
- Script `scripts/check-ca-bundle.sh`: lista sujeito, emisor e caducidade de cada AC do paquete (`openssl crl2pkcs7 -nocrl -certfile ... | openssl pkcs7 -print_certs -noout`).
- **AC de demo** (ver §8): vai **noutro ficheiro**, `ca/demo-ca.pem`. Só se concatena cando `PA_DEMO=1`.

---

## 4. API

### 4.1 Tipos (`identity/types.ts`)

```ts
export type LoginMethod = "saml" | "email_otp" | "certificate";
```

Engadir o caso en `CompositeIdentityProvider.pick()`. O `never` exhaustivo xa obriga a facelo.

### 4.2 Novo `identity/certificate.ts`

Dependencia: `@peculiar/x509` (TS puro, sen binarios). Analizar **por OID**, non co texto do DN.

```ts
import * as x509 from "@peculiar/x509";

const OID = {
  serialNumber: "2.5.4.5",          // IDCES-12345678Z | 12345678Z
  givenName: "2.5.4.42",
  surname: "2.5.4.4",
  commonName: "2.5.4.3",
  organizationIdentifier: "2.5.4.97", // VATES-B15000000 (representante)
  organization: "2.5.4.10",
};

export interface CertIdentity {
  nif: string;                 // normalizado e validado
  personIdentifier: string;    // "ES/ES/<NIF>" — mesmo formato que Cl@ve/eIDAS
  givenName: string;
  surname: string;
  displayName: string;
  issuerCN: string;
  serialHex: string;
  notAfter: Date;
  representative?: { cif: string; organization: string };
}

export function parseClientCert(pem: string, now = new Date()): CertIdentity { /* ... */ }
```

Regras de `parseClientCert`:
1. `pem = decodeURIComponent(header)` (`$ssl_client_escaped_cert` vén codificado).
2. Rexeitar se `now < notBefore` ou `now > notAfter` (dobre comprobación; nginx xa o fai).
3. O uso de clave (Key Usage) debe incluír `digitalSignature`. Se hai EKU, debe incluír `clientAuth` ou `emailProtection` (os do DNIe e da FNMT cumpren).
4. `serialNumber`: quitar o prefixo `IDCES-` (ou `IDCES` sen guión), pasar a maiúsculas e **validar a letra**:
   - DNI: `"TRWAGMYFPDXBNJZSQVHLCKE"[num % 23]`.
   - NIE: X/Y/Z → 0/1/2 antes do módulo.
   - Se non valida → erro `cert_sen_nif`.
5. Nome: `givenName` + `surname`. Se faltan (algúns DNIe antigos), usar o CN quitando ` - NIF`, `(AUTENTICACIÓN)` e espazos sobrantes.
6. Se hai `organizationIdentifier` (`VATES-B…`) → `representative = { cif, organization }`. A persoa segue sendo o NIF do representante.
7. **Prohibido** identificar pola persoa polo nome ou polo email do certificado.

### 4.3 Novo `identity/certificate-routes.ts`

```ts
// GET /auth/cert/callback  (só alcanzable desde nginx cert.*)
// 1. timingSafeEqual(header X-PA-Gateway-Auth, env CERT_GATEWAY_SECRET) || 401
// 2. header X-PA-Cert-Verify === "SUCCESS" || 401
// 3. state válido, non usado, non caducado (táboa cert_login_states) || 400
// 4. id = parseClientCert(header X-PA-Cert)
// 5. Se PA_DEMO != 1 e o emisor é a AC de demo → 401 (defensa en profundidade)
// 6. user = resolveUserByPersonIdentifier(id, state.municipalityId)
// 7. ticket = randomBytes(32).toString("base64url") → táboa cert_login_tickets (60 s, un uso)
// 8. audit("login_certificado", { issuerCN, serialHex, municipalityId })   ← SEN gardar o PEM
// 9. 302 → `${APP_BASE_URL}/auth/cert/finish?ticket=${ticket}`

// GET /auth/cert/finish  (orixe da app)
// 1. ticket existe, non caducado → BORRALO (un só uso) || 302 /acceso?erro=cert&motivo=ticket
// 2. createSession(user) → setCookie pa_sesion (httpOnly, Lax, secure)
// 3. 302 resolvePostLoginPath(role, slug, state.returnTo, clubId)
```

`resolveUserByPersonIdentifier`:
- Buscar en `users` por `personIdentifier = "ES/ES/<NIF>"`. É **o mesmo identificador que chega por Cl@ve**: a persoa que entra por Cl@ve ou por certificado é a mesma conta.
- Se existe e `active === false` → «Conta desactivada».
- Se existe → **o rol sae da BD, nunca do certificado** (admin, conserxe, club…).
- Se non existe → crear `citizen` no `municipalityId` do `state`, cun `displayName` do certificado e `email` nulo. Despois vai á pantalla de primeiro acceso e consentimento.
- `representative`: en fase 1 só se garda na sesión (`claims.representative`). En fase 2, ligar a un club se o concello rexistrou ese CIF no club (`clubs.cif`).

### 4.4 Esquema (`db/schema.ts` + migración)

```ts
export const certLoginStates = pgTable("cert_login_states", {
  id: text("id").primaryKey(),               // state aleatorio
  municipalityId: text("municipality_id").notNull(),
  returnTo: text("return_to"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const certLoginTickets = pgTable("cert_login_tickets", {
  id: text("id").primaryKey(),               // ticket aleatorio
  userId: text("user_id").notNull(),
  stateId: text("state_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
// users: índice único parcial sobre person_identifier (onde non sexa null)
```

**Os tickets gárdanse en BD, non en memoria**, para que funcionen se hai máis dunha instancia ou se a API se reinicia.

### 4.5 Variables de contorno (`.env.example`, `.env.vps.example`, `env.ts`)

```
CERT_LOGIN_ENABLED=1
CERT_HOST=cert.pistaaberta.com
CERT_ORIGIN=https://cert.pistaaberta.com
CERT_GATEWAY_SECRET=            # openssl rand -base64 32 ; distinto en cada instalación
```

Protección no arranque, en `env.ts`, cando `NODE_ENV=production`:
- `CERT_LOGIN_ENABLED=1` sen `CERT_GATEWAY_SECRET` (ou con menos de 32 caracteres) → a API non arranca.
- `PA_DEMO=1` e `NODE_ENV=production` á vez → a API non arranca.
- O paquete de AC montado contén a pegada da AC de demo → a API non arranca (ler `CERT_CA_BUNDLE_PATH`, se está montado).

---

## 5. Web

### 5.1 `LoginPage.tsx`

Botón novo, ao mesmo nivel que Cl@ve (mesmo estilo `pa-btn-secondary` grande, con icona de tarxeta e chip):

- **GL:** «Certificado dixital ou DNIe» · subtexto «FNMT, DNIe e outros certificados cualificados. Recomendado no ordenador.»
- **ES:** «Certificado digital o DNIe» · «FNMT, DNIe y otros certificados cualificados. Recomendado en el ordenador.»

Ao premer: `POST /auth/login {method:"certificate", municipalityId, returnTo}` → `window.location.assign(redirectUrl)`.

Mostrar o botón só se `GET /api/config` devolve `certLogin: true`. Se o concello o ten desactivado, non aparece.

### 5.2 Erros (`/acceso?erro=cert&motivo=…`)

Aviso en ocre con icona e texto, nunca só cor (DISENO §3):

| `motivo` | Texto GL |
|---|---|
| `NONE` | Non se seleccionou ningún certificado. Comproba que está instalado no navegador ou que o lector do DNIe está conectado. |
| `FAILED:certificate revoked` | Este certificado está revogado. |
| `FAILED:certificate has expired` | Este certificado caducou. |
| `FAILED:*` (resto) | Este certificado non é dunha entidade admitida. |
| `ticket` | O acceso caducou. Téntao de novo. |
| `cert_sen_nif` | O certificado non contén un DNI/NIE válido. |

Ligazón de axuda: «Como obter o certificado da FNMT» (sede.fnmt.gob.es) e «Como usar o DNIe».

Todas as claves van en `gl.json` e `es.json`, con paridade total.

### 5.3 Deseño

Engadir o botón nas pantallas `VAccesoPC` e `VAccesoM` (o asistente de deseño actualizarao). No móbil vai **despois** de Cl@ve e do correo, porque no teléfono case ninguén ten o certificado instalado.

---

## 6. Tests (obrigatorios, `apps/api/src/identity/certificate.test.ts`)

Os fixtures xéranse coa AC de demo (§8) en `test/fixtures/certs/`.

Unitarios (`parseClientCert`):
1. FNMT persoa física con `IDCES-88888888Y` → NIF `88888888Y`, `personIdentifier` `ES/ES/88888888Y`.
2. Formato antigo sen prefixo (`88888888Y`) → mesmo resultado.
3. NIE `X1234567L` → válido.
4. Letra incorrecta (`88888888A`) → `cert_sen_nif`.
5. Certificado caducado → erro.
6. Representante con `VATES-B15000000` → `representative.cif = "B15000000"`.
7. Sen `digitalSignature` no uso de clave → erro.

Integración (Hono `app.request`):
8. Callback **sen** `X-PA-Gateway-Auth` → 401.
9. Callback con segredo incorrecto → 401, comparado en tempo constante.
10. `X-PA-Cert-Verify: FAILED:…` → 401.
11. `state` reutilizado ou caducado → 400.
12. Ticket usado dúas veces → a segunda redirixe a `/acceso?erro=cert&motivo=ticket`.
13. Ticket caducado (máis de 60 s, con reloxo simulado) → rexeitado.
14. Persoa existente con rol `admin` → a sesión ten `admin`. Persoa nova → `citizen`.
15. Mesmo NIF por SAML mock e por certificado → **mesmo `user.id`**.
16. Conta `active=false` → rexeitada.
17. `PA_DEMO` sen definir e certificado emitido pola AC de demo → 401.
18. `returnTo` externo (`https://evil.example`) → ignorado; vai á ruta por defecto.

Proba de humo do proxy (`scripts/smoke-cert.sh`, con docker compose levantado):
19. `curl --cert cidada.pem --key cidada.key https://cert.../auth/cert/start?state=…` → 302 a `/auth/cert/finish`.
20. Sen certificado → 302 a `/acceso?erro=cert&motivo=NONE`.
21. Certificado autofirmado (fóra da lista) → `motivo=FAILED…`.
22. Contra o servidor **principal**: `curl -H "X-PA-Gateway-Auth: x" -H "X-PA-Cert-Verify: SUCCESS" …/auth/cert/callback` → 404.

---

## 7. Alternativa: Traefik / outro panel

Se o despregamento vai por outro panel (Traefik) en vez do nginx propio:
- `tls.options.clientcert.clientAuth.caFiles = [trusted-client-cas.pem]`, `clientAuthType = VerifyClientCertIfGiven`, só no router de `cert.*`.
- Middleware `passTLSClientCert` con `pem: true`. A cabeceira é `X-Forwarded-Tls-Client-Cert`: adaptar o nome na API mediante unha variable de contorno.
- **Traefik non comproba a revogación (OCSP) de serie.** Nese caso, a API debe facer a consulta OCSP ela mesma (paquete `pkijs` ou chamada HTTP ao respondedor que vén no AIA do certificado) e denegar se non hai resposta. Por iso, para este módulo **recoméndase nginx**.

---

## 8. Demo: AC de probas e certificados descargables

Script `scripts/demo-ca.sh` (openssl), que xera en `deploy/demo-ca/`:
- AC: `CN=Pista Aberta DEMO CA - NON VALIDA, O=Pista Aberta (probas)`.
- Catro `.p12` co contrasinal `demo` (o cuarto, `revogado-demo.p12`, está revogado na AC para probar o OCSP; ver `OPERACION.md`):
  - `cidada-demo.p12`: Ana Demo, `IDCES-88888888Y`.
  - `admin-demo.p12`: a mesma persoa que `admin.exemplo` do seed. Dálle o seu `personIdentifier` no seed.
  - `club-demo.p12`: representante, `IDCES-11111111H` + `VATES-B15000000`.
- Usar o perfil de certificado da FNMT (serialNumber, givenName, surname, KU `digitalSignature`, EKU `clientAuth`) para que os fixtures sexan realistas.

Na pantalla de acceso, **só con `PA_DEMO=1`**: aviso «Demo: descarga un certificado de probas e impórtao no navegador», con ligazón aos `.p12`.

Se o xurado ten o seu propio certificado da FNMT ou o DNIe, funciona igual: a AC de demo engádese á lista oficial, non a substitúe.

A AC de demo **non se commitea con clave privada**. O script xérase en local; no repo só van os `.p12` de proba e o `demo-ca.pem` público, marcados como de proba no README.

---

## 9. Privacidade e documentación

- **Política de privacidade** (`legal.privacy*`): engadir «Se accedes con certificado dixital, tratamos o teu DNI/NIE, nome e apelidos tal como figuran no certificado; non gardamos o certificado.»
- **Rexistro de actividade (ENS):** gardar o método, o emisor (CN), o número de serie e a data. **Nunca** o PEM completo.
- **`publiccode.yml`** → `features`: «Acceso con certificado dixital e DNIe (mTLS)».
- **`docs/OPERACION.md`:** sección «Activar o acceso con certificado» (DNS do subdominio, Let's Encrypt, paquete de AC, segredo compartido, proba con curl).
- **Memoria:**
  - En Viabilidade: «acceso con certificado dixital desde o primeiro día, sen esperar ao convenio Cl@ve».
  - En Soberanía: «validación propia contra as AC oficiais, sen intermediarios».

---

## 10. Criterios de aceptación

- [ ] Os tres métodos conviven: Cl@ve (mock), correo e certificado.
- [ ] O certificado da FNMT real e o DNIe entran na instalación de proba.
- [ ] Os 22 tests de §6 pasan; `npm test` e `tsc --noEmit` sen erros.
- [ ] O servidor principal ignora as cabeceiras `X-PA-*` (test 22).
- [ ] A API en produción non arranca con segredo débil, con `PA_DEMO` ou coa AC de demo.
- [ ] Os textos de erro e o botón están en GL e ES; pasa axe sen erros na pantalla de acceso.
- [ ] Privacidade, despregamento, publiccode e memoria actualizados.
