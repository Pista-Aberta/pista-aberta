# Avisos, correo e lista de espera

Pista Aberta usa só estándares abertos para comunicarse coa veciñanza: **SMTP** para o correo, **avisos dentro da app** e **iCalendar** para engadir as reservas ao calendario. Non depende de ningún servizo de pago nin de SDK propietarios.

O provedor de correo é **configuración**, non código: cada concello pon o seu servidor.

## 1. Correo (SMTP)

O envío fai `nodemailer` (MIT) desde un único módulo (`apps/api/src/notify/mail.ts`). Úsase para:

- os códigos de acceso por correo;
- as confirmacións, os cambios e as cancelacións de reserva;
- os avisos de praza liberada (lista de espera);
- os peches e as incidencias.

Os correos van en galego ou castelán segundo o idioma da persoa, sempre con versión de texto e co pé do concello. Os avisos pendentes gárdanse nunha cola na base de datos (`notification_outbox`): se o SMTP non responde, a reserva faise igual e o correo reintentarase máis tarde.

### Variables

```
SMTP_HOST=smtp.concello.gal
SMTP_PORT=587
SMTP_SECURE=0          # 1 para o porto 465
SMTP_USER=…
SMTP_PASS=…
SMTP_FROM="Deportes Concello <deportes@concello.gal>"
SMTP_REPLY_TO=deportes@concello.gal
```

Sen `SMTP_HOST` a aplicación funciona, pero só hai avisos dentro da app.

**Seguridade:** en produción o código de acceso nunca se escribe nos logs. Se o SMTP falla, a persoa ve unha mensaxe para tentalo de novo ou entrar con Cl@ve ou certificado.

### De onde sacar o SMTP

| Opción | Para quen | Notas |
|---|---|---|
| SMTP do concello ou da Deputación | Produción (recomendado) | Os correos saen de `@concello.gal`, que é o que a veciñanza recoñece. |
| Servidor propio libre (Stalwart, Postfix + OpenDKIM, Maddy) | Quen queira autonomía total | Require SPF, DKIM, DMARC, DNS inverso e porto 25 saínte. |
| Calquera relay SMTP (aloxamento, correo corporativo) | Alternativa | É SMTP estándar: cámbiase o relay e listo. |
| Mailpit (MIT) | Desenvolvemento e demo | Non envía nada fóra; garda os correos e móstraos nunha web. |

### Bandexa da demo

Na demo pública, os correos non saen a internet: recóllense en Mailpit e pódense ver en `https://demo.pistaaberta.com/correo/`. Así pódese probar o acceso por código e os avisos sen enviar correos reais.

En local, `docker compose up` levanta Mailpit en `http://127.0.0.1:8025`.

## 2. Avisos dentro da app

Cada persoa ten unha bandexa de avisos (icona da campá). En «Conta → Avisos» escolle, por tipo de aviso, se tamén os quere recibir por correo. Todos os correos levan unha ligazón para darse de baixa.

A app pódese instalar desde o navegador (`manifest.webmanifest` e service worker), e o QR da reserva funciona sen conexión.

## 3. «Avisarme se se libera» (lista de espera)

### Funcionamento

1. Nunha franxa ocupada, a persoa preme «Avisarme se se libera» e entra na cola desa franxa.
2. Máximo **3 colas activas** por persoa. Non se pode entrar se xa se ten reserva nesa franxa ou se se chegou ao límite de reservas.
3. Cando a franxa se libera (cancelación ou non presentado):
   - **Se faltan máis de 2 h para o inicio:** ofrécese á primeira persoa da cola e a franxa queda **apartada para ela 30 min**. Se non a acepta, pasa á seguinte.
   - **Se faltan menos de 2 h:** avísase a toda a cola á vez e a primeira que reserve, lévaa.
   - Cando a franxa comeza, a cola caduca soa.
4. O aviso leva o botón «Reservar agora», que abre a confirmación xa preenchida.
5. Ninguén pode ver quen está na cola.

En «As miñas reservas», a lapela «En espera» mostra as colas activas e permite saír delas. No panel do concello, os indicadores contan as peticións de aviso por franxa: é a demanda non atendida real.

### Datos

- `waitlist_entries`: persoa, franxa, estado (`waiting`, `offered`, `accepted`, `expired`, `cancelled`) e data límite da oferta.
- `time_slots.heldForUserId` e `heldUntil`: franxa apartada. Mentres dura, só a pode reservar esa persoa; para o resto sae ocupada.

O job horario caduca as ofertas vencidas, pasa a franxa á seguinte persoa e pecha as colas das franxas xa comezadas.
