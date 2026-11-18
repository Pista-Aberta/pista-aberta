# Despregar Pista Aberta

Guía corta para instalación e operación. Certificados: `CERTIFICADO-DIXITAL.md`. Instalación detallada: `INSTALACION.md` e `OPERACION.md`.

## Arranque

```bash
PA_INSTALL_NONINTERACTIVE=1 \
  DOMAIN=reservas.proba.gal \
  SINGLE=exemplo \
  CONCELLO_NAME="Concello de Exemplo" \
  CONCELLO_INE=32078 \
  ADMIN_EMAIL=admin@proba.gal \
  ADMIN_NIF=12345678Z \
  ADMIN_NAME="María López" \
  bash install.sh
```

Sen `SINGLE` → modo Deputación (convite da xestora; alta de concellos desde o panel).

- **Demo:** `PA_DEMO=1` (semente Exemplo/Proba). En produción **non** poñas `PA_DEMO`: a migración non carga a demo (REVISION-36 H1).
- A imaxe da API leva o censo en `/app/data/` (REVISION-36 H2).

## OCSP e revogación

A API consulta OCSP ao validar o certificado de cliente (`CERT_OCSP_REQUIRED=1`).

**Caché de 10 minutos:** un resultado «válido» gárdase ~10 min por certificado (`OCSP_CACHE_TTL_MS` en `cert-ocsp.ts`). Se un certificado se **revoga** na AC, pode seguir entrando ata que caduque esa caché.

**Retirar acceso é a vía inmediata:** se hai que cortar o acceso dunha persoa xa (admin, xestora, persoal), usa «Retirar acceso» no panel. Iso desactiva a conta na app **sen esperar** á revogación OCSP nin á caché. A revogación na AC segue sendo necesaria a medio prazo; o panel pecha o acceso ao momento.
