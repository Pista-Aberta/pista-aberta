# Despregar Pista Aberta

Guía curta. Instalación detallada: `INSTALACION.md`. Operación: `OPERACION.md`. Certificado dixital: `CERTIFICADO-DIXITAL.md`.

## Instalación non interactiva

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

Sen `SINGLE` instálase en modo Deputación: convite para a xestora e alta de concellos desde o panel.

- **Demo:** `PA_DEMO=1` carga os concellos ficticios Exemplo e Proba. En produción non se pon `PA_DEMO`: a base de datos queda baleira e o concello dáse de alta co asistente.
- A imaxe da API inclúe o censo de instalacións deportivas de Galicia (OpenStreetMap) en `/app/data/`, que usa o asistente de alta.

## OCSP e revogación

A API consulta o OCSP ao validar o certificado de cliente (`CERT_OCSP_REQUIRED=1`).

**Caché de 10 minutos:** un resultado «válido» gárdase uns 10 minutos por certificado. Se un certificado se revoga na AC, pode seguir entrando ata que caduque esa caché.

**Para cortar un acceso ao momento,** usa «Retirar acceso» no panel. Desactiva a conta na aplicación sen esperar á revogación nin á caché. A revogación na AC segue sendo necesaria, pero o panel pecha o acceso xa.
