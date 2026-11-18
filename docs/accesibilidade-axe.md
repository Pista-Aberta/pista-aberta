# Accesibilidade con axe

**Data:** 2026-11-02  
**Base:** `https://demo.pistaaberta.com`  
**Ferramenta:** `@axe-core/playwright` (WCAG 2.0/2.1/2.2 A+AA)  
**Criterio CI:** falla con calquera infracción reportada por axe.

## Resultado

**PASS** — sen infraccións nas rutas probadas.

| Pantalla | Estado | Infraccións |
|----------|--------|-------------|
| desktop / | OK | 0 |
| desktop /c/exemplo | OK | 0 |
| desktop /c/exemplo/reservar | OK | 0 |
| desktop /acceso | OK | 0 |
| desktop /c/proba/acceso | OK | 0 |
| desktop /deputacion | OK | 0 |
| desktop /c/exemplo/reservar/fac-exemplo-padel (sesión) | OK | 0 |
| desktop /c/exemplo/reservar/fac-exemplo-padel · UserMenu | OK | 0 |
| desktop /c/exemplo/reservas (sesión) | OK | 0 |
| desktop /c/exemplo/reservas · UserMenu | OK | 0 |
| desktop /c/exemplo/admin (sesión) | OK | 0 |
| desktop /c/exemplo/admin · UserMenu | OK | 0 |
| desktop /c/exemplo/conserxeria (sesión) | OK | 0 |
| desktop /c/exemplo/conserxeria · UserMenu | OK | 0 |
| desktop /c/exemplo/clubs/club-basquet (sesión) | OK | 0 |
| desktop /c/exemplo/clubs/club-basquet · UserMenu | OK | 0 |
| desktop /c/proba/admin (sesión) | OK | 0 |
| desktop /c/proba/admin · UserMenu | OK | 0 |
| mobile / | OK | 0 |
| mobile /c/exemplo | OK | 0 |
| mobile /c/exemplo/reservar | OK | 0 |
| mobile /acceso | OK | 0 |
| mobile /c/proba/acceso | OK | 0 |
| mobile /deputacion | OK | 0 |
| mobile /c/exemplo/reservar/fac-exemplo-padel (sesión) | OK | 0 |
| mobile /c/exemplo/reservar/fac-exemplo-padel · UserMenu | OK | 0 |
| mobile /c/exemplo/reservas (sesión) | OK | 0 |
| mobile /c/exemplo/reservas · UserMenu | OK | 0 |
| mobile /c/exemplo/admin (sesión) | OK | 0 |
| mobile /c/exemplo/admin · UserMenu | OK | 0 |
| mobile /c/exemplo/conserxeria (sesión) | OK | 0 |
| mobile /c/exemplo/conserxeria · UserMenu | OK | 0 |
| mobile /c/exemplo/clubs/club-basquet (sesión) | OK | 0 |
| mobile /c/exemplo/clubs/club-basquet · UserMenu | OK | 0 |
| mobile /c/proba/admin (sesión) | OK | 0 |
| mobile /c/proba/admin · UserMenu | OK | 0 |

## Execución

```bash
# Servidor xa levantado
BASE_URL=http://127.0.0.1:3000 npm run axe

# CI / local: arranca API+web, escanea e pecha
AXE_START_LOCAL=1 AXE_WRITE_DOC=1 npm run axe
```

Script: `scripts/axe-ci.mjs` (REVISION-15: sesión + UserMenu + /c/proba/acceso).
