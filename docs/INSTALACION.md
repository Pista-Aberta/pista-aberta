# Instalación · Pista Aberta

Guía para poñer en marcha a aplicación nun **concello** (produción) ou en local/demo.

Idioma do instalador: ao inicio pregunta **galego** ou **castelán** (`PA_LANG=gl|es` en non-interactivo).

## 1. Requisitos

- Docker e Docker Compose
- Dominio co DNS apuntando ao servidor (rexistro A) — se usas Caddy en 80/443
- SMTP do concello (recomendado; sen el só hai avisos na app)

## 2. Tres casos de implantación

### Caso A — Concello único (Caddy en 80/443)

```bash
./install.sh
# → Galego/Castelán → «Directamente 80/443» → dominio + slug + SMTP…
```

- Un concello (`PA_SINGLE_MUNI`), convite da admin.
- Compose: `docker-compose.concello.yml` con **Caddy** (Let's Encrypt) e subdominio `cert.` para mTLS.
- Segredos en `.env.install` (`chmod 600`).

### Caso B — Deputación (multiconcello)

Igual que A, pero **sen slug** no instalador: pregunta nome da Deputación e convite da primeira xestora (`/convite/…`); alta de concellos dende `/deputacion`.

Chave de emerxencia Deputación (**NIF obrigatorio**):

```bash
docker compose -f docker-compose.concello.yml --env-file .env.install exec api \
  npm run admin -- --deputacion --invite --email … --nif 12345678Z [--org-name "Deputación …"]

# Listar persoas da Deputación:
docker compose -f docker-compose.concello.yml --env-file .env.install exec api \
  npm run admin -- --deputacion --list
```

### Caso C — Detrás dun servidor web existente (sen Caddy)

No instalador escolle a opción **2** («detrás de nginx / Nginx Proxy Manager / outro»):

1. **nginx no mesmo host** — a app escoita só en `127.0.0.1:<porto>` (`docker-compose.concello.proxy.yml`). O instalador imprime un bloque `server { … proxy_pass … }` e notas para `cert.`.
2. **Nginx Proxy Manager** — sen porto no host; o servizo `edge` únese á rede Docker de NPM (`docker-compose.concello.proxy-npm.yml`, var `PROXY_NETWORK`).

**IP real con proxy diante (`X-Forwarded-For`):** cando colocas outro proxy inverso diante do contedor `edge` / `gateway`, ese proxy **debe enviar a cabeceira `X-Forwarded-For`** coa IP do cliente (en nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`; NPM e Traefik envíana por defecto). O nginx interno descarta os saltos de redes privadas (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.1`) mediante `real_ip_header X-Forwarded-For` (`real_ip_recursive on`) e entrega á API `X-Forwarded-For: $remote_addr` para que os límites de intentos por IP sexan individuais por persoa.

**Certificado dixital (`cert.`):** neste modo Caddy non está. NPM non fai ben mTLS de cliente. Ou configuras un nginx á parte con `ssl_verify_client` (ver `deploy/dominio/nginx/cert-tls.conf.template`), ou o login con certificado **non está dispoñible** (usa Cl@ve / correo).

## 3. Instalación xa existente

Se existe `.env.install`, `./install.sh` sen argumentos amosa:

1. **Actualizar** — `bash install.sh actualizar` (alias `update`)
2. **Cambiar configuración** — dominio, correo, SMTP → reescribe esas chaves e reinicia
3. **Saír**

Con `PA_INSTALL_NONINTERACTIVE=1` e `.env.install` presente **sen** argumento `actualizar`: non fai nada e explícao.

### Actualizar

```bash
bash install.sh actualizar
# ou: bash install.sh update
```

1. Copia con `scripts/backup.sh`
2. Descarga versión nova (`git pull --ff-only`, ou `docker compose pull` se non hai `.git`)
3. Engade a `.env.install` só as variables **novas** que falten (valores por defecto; non toca as existentes)
4. `docker compose … up -d --build`
5. Agarda `/health` (máx. 2 min)

Se falla, o script indica como volver atrás: `CONFIRM=1 ./scripts/restore.sh <dump>` + `git checkout <versión-anterior>` + compose up.

### Non-interactivo (CI / e2e)

```bash
PA_INSTALL_NONINTERACTIVE=1 \
  DOMAIN=reservas.proba.gal SINGLE=proba \
  SMTP_HOST=smtp.proba.gal SMTP_USER=… SMTP_PASS=… \
  INSTALL_EDGE=caddy \
  ./install.sh
```

Modo proxy non-interactivo: `INSTALL_EDGE=proxy APP_PORT=8080` ou `INSTALL_EDGE=proxy-npm PROXY_NETWORK=nginxproxymanager_default`.

## 4. Primeiro arranque (sempre no contedor da API)

```bash
docker compose -f docker-compose.concello.yml --env-file .env.install exec api \
  npm run setup -- --concello "Concello de Exemplo" --slug exemplo --ine 32078

docker compose -f docker-compose.concello.yml --env-file .env.install exec api \
  npm run admin -- --email persoa@concello.gal --slug exemplo --nif … --invite
```

Non executes `npm run setup` / `admin` no host sen `DATABASE_URL`: crearían unha PGlite local e non tocarían o Postgres do Docker.

A API **non arranca** se `NODE_ENV=production` e `PA_DEMO=1`.

## 5. Arranque local / demo

```bash
cp .env.example .env
docker compose up --build
```

| Servizo | URL |
|---------|-----|
| Web | http://localhost:3000 |
| API | http://localhost:3001 |
| Mailpit | http://127.0.0.1:8025 |

Para unha demo pública con dominio propio pódense usar `docker-compose.vps.yml` e `docker-compose.dominio.yml` (ver `.env.vps.example` e `.env.dominio.example`).

## 6. Cl@ve / certificado

- Demo: IdP SAML mock en `/auth/saml/mock-idp`.
- Produción: IdP real (Cl@ve) + opcionalmente `CERT_LOGIN_ENABLED=1` (ver `docs/CERTIFICADO-DIXITAL.md`).
- Con Caddy (caso A/B): `cert.<dominio>` vai no propio Caddyfile.
- En modo proxy (caso C): ver sección de arriba.

## 7. Operación

- Manual de persoal: `docs/manual-persoal.md`
- Avisos e correo: `docs/AVISOS-E-CORREO.md`
- Operación diaria: `docs/OPERACION.md`
- Copias: `install.sh` suxire cron ou perfil `backup`; actualización usa `scripts/backup.sh`.
