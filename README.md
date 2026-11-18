# Pista Aberta

Plataforma libre de xestión e reserva de instalacións deportivas municipais.
Os concellos ofrecen pistas e pavillóns en liña; a veciñanza reserva con QR; os clubs xestionan o fin de semana; a Deputación ve o conxunto.
Software autoaloxable (Docker Compose), con identidade soberana: certificado dixital / DNIe, Cl@ve (SAML) e código por correo.

**Para quen:** concellos, Deputación, clubs deportivos e veciñanza.

**Funcións principais**
- Reserva cidadá con franxas, lista de espera e QR
- Panel municipal (instalacións, peches, persoal, personalización)
- Módulo de pavillóns e clubs (tempada e partidos)
- Partidos abertos («busco xente») e datos abertos
- Multi-concello con illamento de datos

Demo pública: [https://demo.pistaaberta.com](https://demo.pistaaberta.com) · guía do xurado en `/demo`.

## Inicio rápido

Requisitos: Docker + Docker Compose, ou Node.js 22+ e PostgreSQL 16 para desenvolvemento.

```bash
git clone https://github.com/Pista-Aberta/pista-aberta.git
cd pista-aberta
./install.sh
```

`install.sh` soporta modos interactivos e non interactivos (dominio, proxy, un só concello). Ver `docs/INSTALACION.md`.

Desenvolvemento:

```bash
cp .env.example .env
npm ci
npm run dev
```

Tests: `npm test` (API + web).

## Arquitectura

- API: **Hono** + **Drizzle** + **PostgreSQL**
- Web: **React** + **Vite**
- Despregamento: **Docker Compose** (API, web, Postgres, gateway opcional)
- Identidade: certificado / DNIe (mTLS), Cl@ve SAML 2.0 e correo + OTP
- Licenza: **EUPL-1.2**

## Seguridade e privacidade

Ver `docs/PRIVACY-BOOKING-RETENTION.md`, `docs/OPERACION.md` e `docs/CERTIFICADO-DIXITAL.md`.
Non commits de `.env`, chaves nin contas de demo reais.

## Contribuír e contacto

Ver `CONTRIBUTING.md`. Contacto: [info@saci.gal](mailto:info@saci.gal).

---

## Pista Aberta (castellano)

Plataforma libre de gestión y reserva de instalaciones deportivas municipales para concellos, Diputación, clubs y vecindario. Demo: [https://demo.pistaaberta.com](https://demo.pistaaberta.com).

```bash
git clone https://github.com/Pista-Aberta/pista-aberta.git
cd pista-aberta
./install.sh
```

Licencia EUPL-1.2 · info@saci.gal
