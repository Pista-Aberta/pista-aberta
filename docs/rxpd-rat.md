# RXPD — Rexistro de Actividades de Tratamento (modelo)

Documento modelo para o concello responsable. Adaptar titular, NIF e DPD.

## 1. Responsable

- **Responsable do tratamento:** Concello de [NOME], NIF [ ], enderezo [ ].
- **Contacto DPD (se procede):** [correo].
- **Encargado (se o concello aloxa fóra):** proveedor do hosting / SaaS segundo contrato.

## 2. Actividades

| Id | Denominación | Finalidade | Base xurídica | Categorías de interesados | Datos | Conservación |
|---|---|---|---|---|---|---|
| A1 | Contas e identificación | Acceso á reserva e paneles | Misión pública / consentimento (OTP) | Veciñanza, persoal, clubs | Nome, correo, identificador eIDAS, rol | Mentres a conta estea activa + prazos legais |
| A2 | Reservas e check-in | Xestión de franxas | Misión pública | Veciñanza | Reserva, código QR, estado | Anonimización automática tras N días (configurable) |
| A3 | Lista de espera | Oferta de prazas liberadas | Misión pública / interese lexítimo | Veciñanza | Cola, avisos | Ata oferta ou baixa |
| A4 | Incidencias | Mantemento instalacións | Misión pública | Veciñanza | Texto, foto opcional | Ata resolución + arquivo |
| A5 | Clubs e tempada | Uso federado de pavillón | Convenio / misión pública | Clubs | Solicitudes, partidos | Tempada en curso |
| A6 | Auditoría | Seguridade e trazabilidade | Obrigación legal / misión | Persoal | Eventos de auditoría | Segundo política municipal |
| A7 | Actividades e menores a cargo | Inscrición en actividades municipais e xestión de familiares (`family_members`) | Misión pública / consentimento do titular | Veciñanza, menores representados | Nome, ano de nacemento, relación, inscrición | Mentres a conta estea activa + prazos da actividade |
| A8 | Partidos abertos | Emparellamento «busco xente» e lista de participantes | Consentimento explícito (art. 6.1.a RGPD) para amosar «Nome A.» | Veciñanza | Título, deporte, franxas, participantes, convites | Ata o partido + anonimización / baixa |
| A9 | Validación de certificado dixital / OCSP | Autenticación con FNMT/DNIe (mTLS) e consulta de revogación | Misión pública / obrigación legal de identificación | Veciñanza, persoal | Certificado cliente, resultado OCSP (sen almacenar o certificado completo) | Só en tránsito / logs técnicos mínimos |

## 3. Destinatarios

- Persoal autorizado do concello e conserxería.
- Encargado de aloxamento (cifrado en tránsito; sen cesión comercial).
- Sen cesións a terceiros de publicidade.

## 4. Transferencias internacionais

Non previstas. Almacenamento na UE.

## 5. Medidas de seguridade (resumo)

- Sesións con cookie `HttpOnly` / `Secure`.
- Illamento multi-concello (tenant).
- OTP sen loguear códigos en produción.
- Anonimización de reservas pasadas (job).

## 6. Cláusula informativa (para pantallas / cartel)

> O Concello de [NOME] trata os seus datos para xestionar a reserva de instalacións deportivas (misión pública). Pode exercer acceso, rectificación, supresión e demais dereitos en [correo] ou na súa conta. Máis información na [política de privacidade](/c/[slug]/legal/privacidade).

Na app: pantalla «Antes de comezar» + ligazóns legais no pé.
