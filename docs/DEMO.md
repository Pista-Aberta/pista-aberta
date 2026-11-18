# Demo (Concello de Exemplo)

A semente de desenvolvemento usa concellos ficticios:

- **Concello de Exemplo** (`exemplo`)
- **Concello de Proba** (`proba`) — illamento multi-concello

## Arranque local

```bash
cp .env.example .env
# PA_DEMO=1
npm ci
npm run dev
```

Para unha demo «baleira» (só plataforma + Deputación, sen concellos): `PA_DEMO_EMPTY=1`.

## Contas de proba

Copia `deploy/demo-users.example.json` a un ficheiro privado e apunta `DEMO_USERS_FILE`.
Non commits persoas reais nin NIF verdadeiros.

Ver tamén `docs/INSTALACION.md` e `docs/OPERACION.md`.
