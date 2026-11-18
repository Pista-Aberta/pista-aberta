/**
 * CSP para HTML do IdP mock (selector + auto-POST ao ACS).
 * A política global da API é `default-src 'none'` (JSON-safe), pero o
 * auto-submit SAML necesita script/estilo inline — sen isto o navegador
 * queda en «Iniciando sesión…» e nunca fai POST ao ACS.
 */
export const IDP_HTML_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  // 'self' + unsafe-inline: edge nginx tamén envía CSP; a intersección
  // ten que permitir o <script>…submit()</script> do auto-POST.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "font-src 'self'",
  "form-action 'self'",
  "img-src 'self' data:",
].join("; ");
