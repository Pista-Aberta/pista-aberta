# Retención e anonimización de reservas

As reservas caducadas consérvanse durante o prazo configurado por concello
(`anonymizeAfterDays`) para atención de incidencias. Ao vencer o prazo, o job de
privacidade conserva só os datos operativos da reserva (instalación, franxa,
estado e regras aplicadas) e elimina os datos que permiten atribuíla:

- `bookings.user_id` pasa a `NULL`;
- o nome pasa a `Anonimizado`;
- elimínanse a referencia e o nome de familiares.

`NULL` é intencionado: non se emprega un hash nin outro pseudónimo estable,
porque permitiría correlacionar o historial ou volver unilo cunha persoa.
`bookings.user_id` só pode ser nulo para historial anonimizado; toda reserva
activa créase cunha conta activa e un identificador de usuario.

O peche voluntario dunha conta aplica a mesma desvinculación inmediatamente.
Antes cancela todas as reservas futuras dentro da mesma transacción que
desactiva a conta. O bloqueo da fila de usuario compartido coa creación de
reservas evita que unha alta concorrente quede activa despois do peche.
