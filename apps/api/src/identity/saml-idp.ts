/**
 * IdP SAML mock: emite AuthnResponse SAML 2.0 con aserción asinada (RSA-SHA256).
 * Atributos eIDAS: PersonIdentifier, CurrentGivenName, CurrentFamilyName + role demo.
 */
import { randomUUID } from "node:crypto";
import { SignedXml } from "xml-crypto";
import { loadIdpCert, loadIdpKey } from "./saml-certs.js";
import { idpEntityId, spAcsUrl, spEntityId } from "./saml-config.js";
import { resolveDemoUser, type SamlDemoUser } from "./saml-users.js";

const EIDAS_PI =
  "http://eidas.europa.eu/attributes/naturalperson/PersonIdentifier";
const EIDAS_GIVEN =
  "http://eidas.europa.eu/attributes/naturalperson/CurrentGivenName";
const EIDAS_FAMILY =
  "http://eidas.europa.eu/attributes/naturalperson/CurrentFamilyName";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function signAssertion(assertionXml: string, assertionId: string): string {
  const privateKey = loadIdpKey();
  const publicCert = loadIdpCert();
  const sig = new SignedXml({ privateKey, publicCert });
  sig.signatureAlgorithm = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
  sig.canonicalizationAlgorithm = "http://www.w3.org/2001/10/xml-exc-c14n#";
  sig.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    uri: `#${assertionId}`,
  });
  sig.computeSignature(assertionXml, {
    location: { reference: "//*[local-name(.)='Issuer']", action: "after" },
    prefix: "ds",
  });
  return sig.getSignedXml();
}

export function buildSignedAuthnResponse(opts: {
  userKey: string;
  relayState?: string;
  inResponseTo?: string;
}): { xml: string; user: SamlDemoUser; base64: string } {
  const user = resolveDemoUser(opts.userKey, opts.relayState);
  const now = new Date();
  const notBefore = new Date(now.getTime() - 60_000).toISOString();
  const notOnOrAfter = new Date(now.getTime() + 5 * 60_000).toISOString();
  const issueInstant = now.toISOString();
  const responseId = `_${randomUUID()}`;
  const assertionId = `_${randomUUID()}`;
  const sessionIndex = `_${randomUUID()}`;
  const acs = spAcsUrl();
  const audience = spEntityId();
  const issuer = idpEntityId();
  const inResponseToAttr = opts.inResponseTo
    ? ` InResponseTo="${escapeXml(opts.inResponseTo)}"`
    : "";

  const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ID="${assertionId}" Version="2.0" IssueInstant="${issueInstant}">
  <saml:Issuer>${escapeXml(issuer)}</saml:Issuer>
  <saml:Subject>
    <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified">${escapeXml(user.personIdentifier!)}</saml:NameID>
    <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
      <saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}" Recipient="${escapeXml(acs)}"/>
    </saml:SubjectConfirmation>
  </saml:Subject>
  <saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}">
    <saml:AudienceRestriction>
      <saml:Audience>${escapeXml(audience)}</saml:Audience>
    </saml:AudienceRestriction>
  </saml:Conditions>
  <saml:AuthnStatement AuthnInstant="${issueInstant}" SessionIndex="${sessionIndex}">
    <saml:AuthnContext>
      <saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef>
    </saml:AuthnContext>
  </saml:AuthnStatement>
  <saml:AttributeStatement>
    <saml:Attribute Name="${EIDAS_PI}" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri">
      <saml:AttributeValue xsi:type="xs:string">${escapeXml(user.personIdentifier!)}</saml:AttributeValue>
    </saml:Attribute>
    <saml:Attribute Name="${EIDAS_GIVEN}" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri">
      <saml:AttributeValue xsi:type="xs:string">${escapeXml(user.givenName)}</saml:AttributeValue>
    </saml:Attribute>
    <saml:Attribute Name="${EIDAS_FAMILY}" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri">
      <saml:AttributeValue xsi:type="xs:string">${escapeXml(user.familyName)}</saml:AttributeValue>
    </saml:Attribute>
    <saml:Attribute Name="role" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:basic">
      <saml:AttributeValue xsi:type="xs:string">${escapeXml(user.role)}</saml:AttributeValue>
    </saml:Attribute>
    <saml:Attribute Name="demoUserKey" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:basic">
      <saml:AttributeValue xsi:type="xs:string">${escapeXml(user.key)}</saml:AttributeValue>
    </saml:Attribute>
  </saml:AttributeStatement>
</saml:Assertion>`;

  const signedAssertion = signAssertion(assertion, assertionId);

  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${responseId}" Version="2.0" IssueInstant="${issueInstant}" Destination="${escapeXml(acs)}"${inResponseToAttr}>
  <saml:Issuer>${escapeXml(issuer)}</saml:Issuer>
  <samlp:Status>
    <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
  </samlp:Status>
  ${signedAssertion}
</samlp:Response>`;

  return {
    xml,
    user,
    base64: Buffer.from(xml, "utf8").toString("base64"),
  };
}

/** HTML auto-POST (HTTP-POST binding) cara ao ACS do SP. */
export function idpAutoPostHtml(opts: {
  userKey: string;
  relayState: string;
  inResponseTo?: string;
}): string {
  const { base64, user } = buildSignedAuthnResponse({
    userKey: opts.userKey,
    relayState: opts.relayState,
    inResponseTo: opts.inResponseTo,
  });
  const acs = spAcsUrl();
  return `<!doctype html>
<html lang="gl"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Iniciando sesión — Pista Aberta</title>
<style>
  @font-face{font-family:"Atkinson Hyperlegible";src:url("/fonts/AtkinsonHyperlegible-Regular.woff2") format("woff2");font-weight:400;font-display:swap}
  @font-face{font-family:"Atkinson Hyperlegible";src:url("/fonts/AtkinsonHyperlegible-Bold.woff2") format("woff2");font-weight:700;font-display:swap}
  :root{--pa-bg:#F4F7FA;--pa-ink:#0F1E2C;--pa-graphite:#4A5B6B;--pa-azul:#007BC4;--pa-marino:#002B4A}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:1.5rem;
    font-family:"Atkinson Hyperlegible",system-ui,sans-serif;background:var(--pa-bg);color:var(--pa-ink)}
  .box{max-width:22rem;text-align:center}
  .brand{font-weight:700;font-size:1.25rem;color:var(--pa-marino);margin:0 0 0.65rem;letter-spacing:-0.02em}
  .banner{margin:0 0 1rem;padding:0.65rem 0.8rem;border:1.5px solid #D8E3EC;border-radius:12px;background:#fff;
    font-size:0.82rem;line-height:1.4;color:var(--pa-graphite);text-align:left}
  .banner strong{color:var(--pa-marino)}
  p{margin:0 0 1rem;color:var(--pa-graphite);font-size:1.05rem;line-height:1.4}
  strong{color:var(--pa-marino)}
  .spin{width:1.5rem;height:1.5rem;margin:0 auto 1rem;border:2.5px solid #D8E3EC;border-top-color:var(--pa-azul);
    border-radius:50%;animation:pa-spin .7s linear infinite}
  @keyframes pa-spin{to{transform:rotate(360deg)}}
  @media (prefers-reduced-motion:reduce){.spin{animation:none;border-top-color:var(--pa-azul)}}
  button{font:inherit;font-weight:700;cursor:pointer;border:0;border-radius:12px;
    background:var(--pa-azul);color:#fff;padding:0.85rem 1.25rem;width:100%}
  button:hover{filter:brightness(1.05)}
  .hint{margin-top:0.85rem;font-size:0.82rem;color:var(--pa-graphite)}
</style></head>
<body>
<div class="box">
  <p class="brand">Pista Aberta</p>
  <p class="banner"><strong>Cl@ve de proba (só demo).</strong> Nun concello real aquí abriríase a páxina oficial de Cl@ve.</p>
  <div class="spin" aria-hidden="true"></div>
  <p>Iniciando sesión como <strong>${escapeXml(user.displayName)}</strong>…</p>
  <form id="saml" method="post" action="${escapeXml(acs)}">
    <input type="hidden" name="SAMLResponse" value="${base64}"/>
    <input type="hidden" name="RelayState" value="${escapeXml(opts.relayState)}"/>
    <button type="submit">Continuar</button>
  </form>
  <p class="hint">Se non avanza automaticamente, preme Continuar.</p>
</div>
<script>
document.addEventListener("DOMContentLoaded", function () {
  document.getElementById("saml").submit();
});
</script>
</body></html>`;
}
