# Conserxaría: rexistrar entradas no móbil

A conserxaría rexistra as entradas desde o móbil ou desde un ordenador, en `/c/<concello>/conserxeria`. Pode entrar o persoal de conserxaría e a administración do concello.

## Requisitos

1. **HTTPS:** a cámara só funciona nunha conexión segura.
2. **Sesión de conserxaría ou de administración** (Cl@ve, certificado ou código por correo).
3. **Permiso de cámara** no navegador. A aplicación xa envía `Permissions-Policy: camera=(self)` e unha CSP que permite o vídeo local.

## Xeito A: escanear o QR

1. Preme **Escanear** e acepta o permiso de cámara (úsase a traseira se o navegador a ofrece).
2. Enfoca o QR da reserva: a pantalla da veciña ou a reserva impresa.
3. O resultado ocupa a pantalla uns 3 segundos: entrada válida ou o motivo do rexeitamento.

A lectura usa `BarcodeDetector` se o navegador o ten e, se non, `jsQR`, no mesmo fluxo.

## Xeito B: código curto (sen cámara)

Cada reserva ten un código curto co formato `PA-XXXX`. Escríbeo no campo **Código curto** (vale con ou sen `PA-`) e preme **Validar entrada**.

## Xeito C: lista do día

Na lista de reservas do día, as confirmadas teñen o botón **Entrada manual**. Se ninguén chega, márcase **Non presentado** e a franxa ofrécese á lista de espera.

A lista pódese imprimir («Imprimir folla») para traballar sen móbil.

## Na demo

Na demo hai un botón **Simular escaneo do seguinte QR**, que rexistra a entrada da seguinte reserva confirmada do día sen necesidade de cámara.

## Problemas frecuentes

| Síntoma | Causa habitual |
|---|---|
| A cámara non abre ou sae en negro | Conexión sen HTTPS, permiso denegado ou navegador moi antigo |
| «Este QR é doutro día» | A reserva non é de hoxe (zona horaria Europe/Madrid) |
| «Fóra da ventá» | Fóra da marxe de entrada (±30 min por defecto, editable nas normas do concello) |
| Código non atopado | Só se buscan as reservas de hoxe dese concello |
