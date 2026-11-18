# Operación · Pista Aberta

Guía para manter unha instalación en produción: seguridade de acceso, copias, actualizacións e vixilancia.

## Seguridade de acceso

| Control | Detalle |
|----------|---------|
| Código por correo | Máximo **5 envíos cada 10 min** por enderezo (`otp_rate_limits`). |
| Verificación do código | Máximo **5 intentos** por código; ao quinto bórrase e hai que pedir outro. |
| Inicio de sesión (correo, Cl@ve, certificado) | Máximo **10 intentos cada 10 min** por correo ou IP. Resposta `429 rate_limited`. |
| Persoal municipal | En produción entra con Cl@ve ou certificado, non con código por correo (salvo que o concello desactive `staffStrongAuth`). |
| CSP e HSTS | Cabeceiras de seguridade no proxy (Caddy ou nginx) incluídas na configuración. |

Os certificados de `deploy/demo-ca/` son só material de proba. En produción úsanse as AC oficiais (ver `CERTIFICADO-DIXITAL.md`) e os certificados SAML que entregue Cl@ve no alta administrativa.

## Copias de seguridade (PostgreSQL)

| Script | Uso |
|--------|-----|
| `scripts/backup.sh` | `pg_dump -Fc` da base de datos do compose |
| `scripts/restore.sh` | Restaura unha copia (`CONFIRM=1` obrigatorio) |
| `scripts/test-backup-restore.sh` | Proba completa: copia e restauración nunha base de datos temporal |

```bash
# Copia
COMPOSE_FILE=docker-compose.concello.yml ENV_FILE=.env.install \
  BACKUP_DIR=/var/backups/pista-aberta ./scripts/backup.sh

# Restaurar (só con confirmación explícita)
CONFIRM=1 COMPOSE_FILE=docker-compose.concello.yml ENV_FILE=.env.install \
  ./scripts/restore.sh /var/backups/pista-aberta/pista-AAAAMMDDTHHMMSSZ.dump

# Proba automática (co compose en marcha)
./scripts/test-backup-restore.sh
```

Copias diarias: `install.sh` pregunta se instalar unha tarefa `cron` no servidor ou o servizo `backup` do compose (`--profile backup`). En modo non interactivo: `INSTALL_BACKUP=cron|compose|n`.

Equivalente manual:

```bash
set -euo pipefail
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DIR=/var/backups/pista-aberta
mkdir -p "$DIR"
docker compose -f docker-compose.concello.yml --env-file .env.install \
  exec -T postgres pg_dump -U pista -d pista_aberta -Fc > "$DIR/pista-$STAMP.dump"
find "$DIR" -name 'pista-*.dump' -mtime +7 -delete
```

Recomendacións:
- gardar unha copia fóra do servidor (outro servidor do concello ou almacenamento de obxectos);
- facer unha restauración de proba periodicamente e anotar a data.

## Actualizacións

```bash
bash install.sh actualizar
```

Fai unha copia de seguridade, descarga a versión nova, engade as variables novas que falten, reconstrúe os contedores e agarda a que `/health` responda. Se algo falla, indica como volver á versión anterior. Detalle en `INSTALACION.md`.

## Vixilancia

| Comprobación | Como |
|--------------|------|
| API | `curl -fsS https://<dominio>/api/health` |
| Web | `curl -fsSI https://<dominio>/` → 200 |
| Acceso con certificado | `npm run test:cert-e2e` contra `cert.<dominio>` |

Convén alertar se a API non responde en `/health` ou se `cert.<dominio>` devolve erros 502 de forma continuada.

## Logs útiles

- API: envío de códigos (`[email-otp]`, sen o código en produción), retorno de Cl@ve (SAML ACS) e erros de certificado.
- Proxy: saúdo mTLS e bloqueos de CSP.
- PostgreSQL: tamaño e duración das copias.
