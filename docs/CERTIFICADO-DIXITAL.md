# Acceso con certificado dixital (FNMT, DNIe e outros cualificados)

Pista Aberta ofrece tres xeitos de entrar, que conviven:

| Método | Para que |
|---|---|
| Cl@ve (SAML 2.0) | Acceso estándar da Administración. Require o convenio co Ministerio. |
| Certificado dixital / DNIe (mTLS) | Acceso directo desde o primeiro día, sen convenio. |
| Correo + código | Para quen non ten certificado nin Cl@ve. |

Base legal: art. 9.2.a da Lei 39/2015 (sistemas baseados en certificados cualificados). Non fai falta Autofirma: o navegador presenta o certificado no saúdo TLS.

> Principio de deseño: **a API nunca le un certificado directamente do navegador.** Quen valida o certificado é o proxy TLS (Caddy ou nginx). A API só acepta datos dun proxy que se identifica cun segredo compartido e volve analizar o certificado ela mesma.

## 1. Requisitos de despregamento

- O TLS do subdominio do certificado debe rematar no proxy da instalación (Caddy ou nginx), non nun proxy ou túnel externo.
- Subdominio dedicado: `cert.<dominio>` (por exemplo `cert.reservas.concello.gal`). A aplicación segue no dominio principal, que nunca pide certificado, para que o navegador non llo pregunte a todo o mundo.
- Certificado de servidor (Let's Encrypt) para ese subdominio e porto 443 público.

Con `install.sh` en modo Caddy (casos A e B de `INSTALACION.md`), o subdominio `cert.` vai xa configurado. Detrás doutro proxy, ver o caso C e `deploy/dominio/nginx/cert-tls.conf.template`.

## 2. Fluxo

```
[Navegador] --(1) «Certificado dixital»--> app: POST /auth/login {method:"certificate"}
            <-- redirectUrl: https://cert.<dominio>/auth/cert/start?state=…
[Navegador] --(2) TLS con certificado de cliente--> proxy cert.* (valida cadea e OCSP)
proxy       --(3) cabeceiras + segredo--> API /auth/cert/callback
API         --(4) analiza o certificado, resolve a persoa, crea un ticket dun só uso (60 s)
            <-- 302 https://<dominio>/auth/cert/finish?ticket=…
[Navegador] --(5) /auth/cert/finish--> API troca o ticket por cookie de sesión → 302 á páxina de orixe
```

- O **ticket** existe porque a cookie de sesión debe crearse na orixe da app, non en `cert.*`.
- O **`state`** é aleatorio, gárdase en BD co concello e a páxina de retorno, caduca en 5 min e só se usa unha vez. Evita CSRF de login e redireccións externas.
- States e tickets gárdanse en BD (`cert_login_states`, `cert_login_tickets`), así funcionan con varias instancias ou tras un reinicio.

## 3. Proxy

O proxy:

- pide o certificado só en `cert.*` e en modo opcional (se a persoa cancela, redirixe a `/acceso` cun aviso, non a unha páxina de erro);
- valida a cadea contra a lista pechada de AC e consulta a revogación (OCSP); se o OCSP non responde, deniega;
- envía á API o resultado, o certificado e o segredo `CERT_GATEWAY_SECRET`;
- no dominio principal, borra sempre esas cabeceiras e bloquea `/auth/cert/callback`, para que ninguén as poida falsificar.

Configuracións incluídas: `deploy/concello/Caddyfile` e `deploy/dominio/nginx/cert-tls.conf.template`.

## 4. Autoridades de certificación admitidas

O paquete `deploy/dominio/ca/trusted-client-cas.pem` contén só AC oficiais, descargadas a man das webs oficiais e coas pegadas SHA-256 comprobadas (inventario en `deploy/dominio/ca/README.md`):

| Emisor | Certificados |
|---|---|
| FNMT-RCM | AC Raíz FNMT-RCM (G1 e G2), AC Usuarios, AC Representación |
| DNIe (Dirección Xeral da Policía) | AC Raíz DNIE e DNIE 2, AC DNIE 004/005/006 |

Outros prestadores cualificados (ACCV, Camerfirma, Izenpe…) pódense engadir desde a lista de confianza do Ministerio. `scripts/check-ca-bundle.sh` lista o suxeito, o emisor e a caducidade de cada AC do paquete.

## 5. Que fai a API co certificado

- Analiza o certificado por OID (`@peculiar/x509`), non polo texto do nome.
- Comproba as datas de validez e o uso de clave (`digitalSignature`).
- Extrae o DNI/NIE do `serialNumber` (con ou sen prefixo `IDCES-`) e **valida a letra**. Se non hai un DNI/NIE válido, rexeita o acceso.
- Nome: `givenName` + `surname`, ou o CN limpo se faltan.
- Certificados de representante: garda o CIF e a entidade (`organizationIdentifier`), pero a persoa segue sendo o NIF do representante.
- Nunca identifica a persoa polo nome nin polo correo do certificado.

Resolución da conta:

- O identificador é `ES/ES/<NIF>`, o mesmo que chega por Cl@ve: quen entra por Cl@ve ou por certificado é a mesma conta.
- O rol (admin, conserxaría, club) sae sempre da base de datos, nunca do certificado.
- Se a persoa non existe, créase como veciña do concello e pasa pola pantalla de primeiro acceso e consentimento.
- As contas desactivadas non poden entrar.

No rexistro de actividade gárdase o método, o emisor, o número de serie e a data, **nunca o certificado completo**.

## 6. Configuración

```
CERT_LOGIN_ENABLED=1
CERT_HOST=cert.reservas.concello.gal
CERT_ORIGIN=https://cert.reservas.concello.gal
CERT_GATEWAY_SECRET=          # openssl rand -base64 32 ; distinto en cada instalación
CERT_OCSP_REQUIRED=1
```

Proteccións no arranque en produción (`NODE_ENV=production`):

- Coa entrada por certificado activada e sen `CERT_GATEWAY_SECRET` (ou con menos de 32 caracteres), a API non arranca.
- Con `PA_DEMO=1`, a API non arranca.

Ademais, fóra do modo demo a API rexeita calquera certificado emitido pola AC de probas, aínda que o proxy o deixase pasar (só se admite en laboratorio con `CERT_ALLOW_DEMO_CA=1`).

Revogación: o resultado OCSP gárdase en caché uns minutos. Para cortar o acceso dunha persoa ao momento, usa «Retirar acceso» no panel (ver `despregar.md`).

## 7. Mensaxes de erro

Se o acceso falla, a persoa volve a `/acceso` cun aviso claro, en galego e castelán:

| Motivo | Mensaxe |
|---|---|
| Sen certificado | Non se seleccionou ningún certificado. Comproba que está instalado no navegador ou que o lector do DNIe está conectado. |
| Revogado | Este certificado está revogado. |
| Caducado | Este certificado caducou. |
| AC non admitida | Este certificado non é dunha entidade admitida. |
| Ticket caducado | O acceso caducou. Téntao de novo. |
| Sen DNI/NIE | O certificado non contén un DNI/NIE válido. |

## 8. Demo e probas

- `scripts/demo-ca.sh` xera unha AC de probas («Pista Aberta DEMO CA - NON VALIDA») e certificados `.p12` co perfil da FNMT: cidadá, administración, club (representante) e un revogado para probar o OCSP. Os certificados de proba están en `deploy/demo-ca/`; a clave privada da AC nunca vai no repositorio.
- Na demo, a AC de probas engádese á lista oficial; non a substitúe. Quen teña un certificado da FNMT ou o DNIe pode entrar igual.
- Tests: `apps/api/src/identity/certificate.test.ts` (análise do certificado, segredo do proxy, state, tickets dun só uso, roles, mesma conta por Cl@ve e certificado, redireccións externas) e `npm run test:cert-e2e` contra o proxy.

## 9. Traefik ou outros proxies

Con Traefik: `clientAuthType = VerifyClientCertIfGiven` só no router de `cert.*` e o middleware `passTLSClientCert`. **Traefik non comproba o OCSP de serie**, así que para este módulo recoméndase Caddy ou nginx.
