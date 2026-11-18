# Operación · Pista Aberta

Guía breve para manter a demo e un concello en produción. Outros servizos do VPS alleos non se tocan dende este repo.

## Seguridade de acceso

| Controis | Detalle |
|----------|---------|
| OTP por correo | Máx. **5 envíos / 10 min** por enderezo (`otp_rate_limits`). |
| Verificación OTP | Máx. **5 intentos** por desafío; ao 5.º bórrase e hai que pedir código novo. |
| Login (correo / Cl@ve / cert start) | Máx. **10 intentos / 10 min** por clave (`login:<email>` ou IP). Resposta `429 rate_limited`. |
| Persoal elevado | En produción: Cl@ve ou certificado (non OTP), salvo `staffStrongAuth: false` no concello. |
| CSP / HSTS | CSP no nginx do dominio; a demo debe levar a mesma política no gateway + HSTS. |

Certificados de proba: `deploy/demo-ca/*.p12` e `*.pem`. **Son material de demo** (Cl@ve/cert mTLS de laboratorio). **Non hai contrasinais no repositorio.** En produción: AC oficial do organismo + alta administrativa.

## Copias de seguridade (Postgres)

Scripts no repo (TANDA-1):

| Script | Uso |
|--------|-----|
| `scripts/backup.sh` | `pg_dump -Fc` co `docker-compose.concello.yml` (ou `COMPOSE_FILE=…`) |
| `scripts/restore.sh` | Restaura un `.dump` (`CONFIRM=1` obrigatorio) |
| `scripts/test-backup-restore.sh` | Proba backup → restore nunha DB temporal |

```bash
# Concello (produción)
COMPOSE_FILE=docker-compose.concello.yml ENV_FILE=.env.install \
  BACKUP_DIR=/var/backups/pista-aberta ./scripts/backup.sh

# Restaurar (só con confirmación explícita)
CONFIRM=1 COMPOSE_FILE=docker-compose.concello.yml ENV_FILE=.env.install \
  ./scripts/restore.sh /var/backups/pista-aberta/pista-YYYYMMDDT….dump

# Proba automática (se o compose está en marcha)
./scripts/test-backup-restore.sh
```

**REVISION-40 N6:** `install.sh` pregunta se instala o **cron** no host ou o servizo **backup** do compose (`--profile backup` en `docker-compose.concello.yml`). Non interactivo: `INSTALL_BACKUP=cron|compose|n`.

Diarias no host (crontab ou timer) — equivalente manual:

```bash
set -euo pipefail
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DIR=/var/backups/pista-aberta
mkdir -p "$DIR"
docker compose -f docker-compose.concello.yml --env-file .env.install \
  exec -T postgres pg_dump -U pista -d pista_aberta -Fc > "$DIR/pista-$STAMP.dump"
find "$DIR" -name 'pista-*.dump' -mtime +7 -delete
```

Comprobar o ficheiro (`ls -lh`) e gardar fóra do VPS (obxecto S3/minio ou copia scp).

Documentar a data da última restauración de proba na memoria técnica.

## Actualizacións

1. `git fetch` + `git checkout <tag-ou-sha>` no host da demo.
2. `bash scripts/deploy-demo.sh` (recompila `api`/`web`/`landing` e reinicia o `gateway` tras `api`).
3. Verificar `/health`, login OTP/Cl@ve e `cert.*` (ver monitor).
4. Anotar o SHA en `.deployed-sha`.

Non reiniciar stacks alleos do VPS.

## Monitor

| Comprobación | Como |
|--------------|------|
| API | `curl -fsS https://demo.pistaaberta.com/api/health` (ou `/health`) |
| Web | `curl -fsSI https://demo.pistaaberta.com/` → 200 |
| Cert mTLS | `bash scripts/monitor-cert-502.sh` · e2e: `npm run test:cert-e2e` |
| Landing | `curl -fsSI https://pistaaberta.com/` → 200 |

Alertar se `cert.*` devolve 502 persistente ou a API non responde 2xx en `/health`.

## Logs útiles

- API: OTP (`[email-otp]`), SAML ACS, erros de certificado.
- Gateway/nginx: handshake mTLS e CSP.
- Postgres: tamaño do dump e tempo de `pg_dump`.
