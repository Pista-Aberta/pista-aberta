# Avisos, correo e «Avisarme se se libera» — todo con software libre

Instrucións para Cursor. **Regra:** ningún servizo de pago nin SDK propietario (nin Resend, nin SendGrid, nin Twilio). Só estándares abertos:
- **SMTP** (o envío de correo de toda a vida);
- **Web Push** (RFC 8030/8291/8292);
- **WebAuthn** (chaves de acceso);
- **iCalendar**.

O provedor de correo é **configuración**, non código: o concello pon o seu servidor e listo.

---

## 1. Correo: só SMTP con nodemailer (MIT)

Estado actual: `email-otp.ts` xa usa nodemailer + SMTP. **Non hai Resend no repo.** Se Cursor o engadiu nalgún momento, quitalo.

### 1.1 Módulo único `notify/mail.ts`

Un só sitio para enviar correo (OTP, confirmación de reserva, praza liberada, peches), en lugar de crear o transporte en cada función.

```ts
// env: SMTP_HOST, SMTP_PORT, SMTP_SECURE (0/1), SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_REPLY_TO
export async function sendMail(msg: { to: string; subject: string; text: string; html?: string }): Promise<boolean>
```

- **Transporte:**
  - Crealo unha vez, con `pool: true`.
  - Opcións `auth` (se hai usuario) e `secure`.
  - `requireTLS: true` se `SMTP_SECURE=0` e o porto é 587.
- **Plantillas:**
  - Sinxelas, en GL e ES segundo `user.locale`.
  - Sempre con versión de texto.
  - Pé co nome do concello e a ligazón a «Xestionar avisos».
- **Cola na BD** (`mail_outbox`: id, to, subject, body, attempts, nextAttemptAt, sentAt, error):
  - O job horario reenvía os fallidos con espera exponencial e un máximo de 5 intentos.
  - Así un SMTP caído non rompe a reserva.

### 1.2 Erro de seguridade a corrixir

**Problema:** se o SMTP falla, `deliverOtp()` **escribe o código nos logs**, tamén en produción.

**Arranxo:** mostrar o código nos logs **só** cando non hai `SMTP_HOST` **e** `NODE_ENV !== "production"`. Se o SMTP falla en produción, devolver o erro «Non se puido enviar o código; téntao de novo ou usa Cl@ve/certificado» e rexistralo **sen o código**.

**Test:** `NODE_ENV=production`, SMTP inaccesible → o log non contén o código.

### 1.3 De onde sae o SMTP (documentar en `docs/OPERACION.md`)

| Opción | Para quen | Notas |
|---|---|---|
| **SMTP do propio concello ou da Deputación** | Produción (recomendado) | Os correos saen de `@concello.gal`, que é o que a veciñanza recoñece. Só cambian 5 variables. |
| **Servidor propio libre:** Stalwart (AGPL), Postfix + OpenDKIM, Maddy (GPL) | Quen queira autonomía total | Require rexistros SPF, DKIM e DMARC, DNS inverso (PTR) na IP e porto 25 saínte aberto. Os primeiros días algúns correos poden ir a spam. |
| **Calquera relay SMTP** (o do aloxamento, o do correo corporativo…) | Alternativa | Como é SMTP estándar non hai dependencia: cámbiase o relay e listo. |
| **Mailpit (MIT)** | **Demo** | Non envía nada fóra; garda os correos e móstraos nunha web. Ver 1.4. |

### 1.4 Na demo: bandexa de correo visible para o xurado

- Publicar a interface de Mailpit en `https://demo.pistaaberta.com/correo/`, detrás do mesmo usuario e contrasinal da demo:
  - `MP_WEBROOT=/correo/` en Mailpit;
  - `location /correo/` en nginx cara a `mailpit:8025`;
  - mesmo `auth_basic`.
- Na pantalla de acceso, só con `PA_DEMO=1`: «Demo: os correos non saen á internet. Consulta o código en **Bandexa de correo da demo**».
- Así o xurado proba o acceso por código e ve os avisos de «praza liberada» sen correos reais.

---

## 2. Avisos dentro da app (xa existe) + Web Push (novo, gratuíto e estándar)

### 2.1 Canles por persoa

Na Conta, apartado «Como queres recibir os avisos»:
- **Na app** (sempre activa);
- **Notificacións do navegador ou do móbil** (Web Push);
- **Correo**, se hai enderezo.

Táboa `notification_prefs` (userId, push: bool, email: bool).

### 2.2 Web Push

- **Biblioteca:** `web-push` (MPL-2.0, software libre), sen contas nin custos.
- **Claves VAPID:** xéranse na instalación (`npx web-push generate-vapid-keys`) e van en `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT=mailto:soporte@concello.gal`.
- **Navegador:**
  - `public/sw.js` (service worker) con `push` → `showNotification(title, { body, icon, data: { url } })` e `notificationclick` → abrir a URL;
  - rexistrar o SW **só** cando a persoa activa as notificacións (non ao cargar a páxina).
- **API:**
  - `POST /api/me/push` (gardar `PushSubscription`) e `DELETE /api/me/push`;
  - táboa `push_subscriptions` (userId, endpoint, keys, createdAt, lastOkAt);
  - se o envío devolve 404/410, borrar a subscrición.
- **Contido mínimo:** «Liberouse unha praza: Pádel 1 · sáb 24 · 18:00». Nada de datos persoais.
- **Para a memoria (soberanía):**
  - O protocolo é aberto e a mensaxe vai **cifrada de extremo a extremo**: o servizo de push do navegador (Mozilla, Google, Apple) non pode lela.
  - Non hai conta, API key nin custo.
- **iPhone:** só funciona se a persoa instalou a web na pantalla de inicio (iOS 16.4+). Comprobar que o `manifest.webmanifest` existe e é instalable. Mostrar a axuda «Para recibir avisos no iPhone, engade Pista Aberta á pantalla de inicio».

---

## 3. «Avisarme se se libera»

### 3.1 Comportamento

1. Na grella de horas, unha franxa **ocupada** pódese premer e mostra «Ocupada · **Avisarme se se libera**».
2. A persoa queda na **cola desa franxa**:
   - Máximo 3 colas activas por persoa (configurable en Normas).
   - Non se pode entrar na cola se xa se ten unha reserva nesa franxa, nin se a persoa chegou ao límite de reservas.
3. Cando a franxa se libera (cancelación ou liberación por non presentarse):
   - **Se faltan máis de 2 h para o inicio:** ofrécese á **primeira da cola**, coa franxa **apartada para ela 30 min** (configurable). Se non a acepta, pasa á seguinte.
   - **Se faltan menos de 2 h:** avísase a **toda a cola á vez** e quen primeiro reserve, lévaa.
   - Cando a franxa comeza, a cola caduca soa.
4. O aviso leva o botón **«Reservar agora»**, que abre a confirmación xa preenchida.
5. Nada mostra quen está na cola (privacidade).

### 3.2 Modelo e API

```
slot_watches: id, municipalityId, slotId, userId, createdAt, status (waiting|offered|accepted|expired|cancelled), offeredUntil
time_slots: + heldForUserId, heldUntil   (franxa apartada)
```

- `POST /api/c/:slug/franxas/:slotId/avisarme` → 201, ou 409 se xa está na cola ou chegou ao límite.
- `DELETE /api/c/:slug/franxas/:slotId/avisarme`.
- `GET /api/me/avisarme` → as súas colas activas.
- **Liberación:** usar o `cancelHooks` que xa existe. Unha función `offerFreedSlot(slotId)` nunha transacción:
  - con `SELECT … FOR UPDATE` na franxa;
  - en PGlite, serializar cun mutex en memoria.
- **No job horario:**
  - caducar as ofertas vencidas (`offeredUntil < now`) e pasar á seguinte;
  - caducar as colas de franxas xa comezadas.
- **Cando hai unha franxa apartada:** `createBooking` só deixa reservar á persoa para quen está apartada. Para o resto da veciñanza a franxa sae como «ocupada» ata que caduque.
- **Corrixir:** o texto actual do aviso di «Tes 48 h para aceptala». Pasar a «Apartámosche a praza ata as 18:42».

### 3.3 Interface

- Na grella: as franxas ocupadas son botóns cun texto accesible («18:00, ocupada. Avisarme se se libera»).
- En «As miñas reservas», nova lapela **«En espera (2)»** con «Deixar de esperar».
- No panel, en Indicadores: «Peticións de aviso» por franxa. É a **demanda non atendida real**, un dato moi bo para a memoria.

### 3.4 Tests

1. A ten reserva, B entra na cola → A cancela → B recibe aviso e a franxa queda apartada 30 min para B; C non pode reservala.
2. B non acepta en 30 min → o job pásalla a C.
3. Menos de 2 h para o inicio → avísase a todos; reserva o primeiro e o resto recibe un 409 claro.
4. Límite de 3 colas por persoa.
5. A franxa comeza → as colas caducan.
6. Nada na API pública revela quen está na cola.

---

## 4. Acceso sen depender do correo: chaves de acceso (passkeys)

O código por correo funciona con SMTP (ver 1), pero hai unha opción mellor para as persoas que volven:

- **WebAuthn / passkeys** con `@simplewebauthn/server` e `@simplewebauthn/browser` (MIT).
- **Fluxo:**
  - A primeira vez entra con Cl@ve, certificado ou código.
  - Despois, en Conta: «**Crear unha chave de acceso neste dispositivo**» (Face ID, pegada, PIN do móbil ou do ordenador).
  - As seguintes veces, «Entrar coa chave de acceso»: sen correo, sen contrasinal e sen custo.
- É un estándar aberto (W3C/FIDO). A chave privada nunca sae do dispositivo, e é resistente ao *phishing*.
- **Táboa:** `webauthn_credentials` (userId, credentialId, publicKey, counter, transports, createdAt, lastUsedAt, nome do dispositivo).
- **Persoal municipal:** con `staffStrongAuth`, a passkey **non** substitúe a Cl@ve ou o certificado. Só vale para veciñanza e clubs.
- **SMS:** non. Custa diñeiro e depende de operadoras.

---

## 5. Orde e esforzo

| Paso | Esforzo |
|---|---|
| 1.1–1.2: módulo de correo, cola e arranxo do log | ½ día |
| 1.4: bandexa Mailpit na demo | 1 h |
| 3: «Avisarme se se libera», con avisos na app e correo | 1 día |
| 2: Web Push | ½–1 día |
| 4: passkeys | 1 día (P3, se sobra tempo) |

**Criterio de aceptación da demo:** o xurado cancela unha reserva con Ana, a outra persoa recibe o aviso na app, ve o correo na bandexa da demo, e preme «Reservar agora».
