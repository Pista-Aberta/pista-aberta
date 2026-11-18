# Conserxería: verificar check-in no móbil

Para a proba de 10 minutos (paso 6) e o xurado.

## Requisitos

1. **HTTPS** — a cámara só funciona en contexto seguro. Usa `https://demo.pistaaberta.com` (non `http://`).
2. **Basic auth** da demo (`pista` / ver `internal/demo-basic-auth.txt`).
3. **Sesión de conserxe ou admin** — SAML mock → Staff (`xoan.conserxe@…`) ou Admin.
4. **Permisos** — o gateway envía `Permissions-Policy: camera=(self)` e CSP con `media-src 'self' blob:`.

## Camiño A — cámara (recomendado)

1. No móbil: abre `/c/exemplo/conserxeria`.
2. Premé **Escanear** e acepta o permiso de cámara (traseira se o navegador a ofrece).
3. Enfoca o QR da reserva (cartel ou pantalla da veciña).
4. Resultado a pantalla completa ~3 s (válido / non válido cos motivos traducidos).
5. Se o navegador non ten `BarcodeDetector`, úsase **jsQR** no mesmo fluxo (`inversionAttempts: attemptBoth`).

### Que arranxamos (22/10/2026)

**Causa:** o `<video>` só se montaba despois de `setScanning(true)`, e `getUserMedia` engadía o stream a `videoRef.current` **antes** do paint → stream sen UI (pantalla negra / «non funciona»).

**Fix:** o `<video>` está sempre no DOM (oculto cando non se escanea); `playsinline` + `webkit-playsinline`; erros claros (permiso / sen cámara / ocupada).

Evidencia: `media/melloras-ux/14-conserxeria-camera-fake.png` + `scripts/verify-clave-camera.mjs` (fake `getUserMedia`, `videoBefore=1`, `hasStream=true`).

## Camiño B — código curto (sen cámara)

1. Na reserva, o código curto ten forma `PA-XXXX`.
2. Na conserxería, campo **Código curto**: podes escribir `PA-7K2M` ou só `7K2M`.
3. Premé **Validar e check-in**.

## Camiño C — lista do día

Nas reservas do día cun estado «Confirmada», botón **Check-in manual** (rexistra o mesmo endpoint).

## Demo sen móbil

Se `PA_DEMO` / entorno de proba: botón **Simular escaneo do seguinte QR** (reserva confirmada do día).

## Problemas frecuentes

| Síntoma | Causas |
|---|---|
| Cámara non abre / negra | Sen HTTPS; permiso denegado; iOS Safari antigo; (antes) race do `videoRef` — xa arranxado |
| «Este QR é doutro día» | A reserva non é de hoxe (zona Europe/Madrid) |
| «Fóra da ventá» | Fóra de ±30 min (norma editable no panel) |
| Código non atopado | Só busca reservas **de hoxe** dese concello |
