/**
 * Roundtrip SAML: IdP asina → SP node-saml valida → perfil eIDAS.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSignedAuthnResponse } from "./saml-idp.js";
import { validateAcsPost } from "./saml-sp.js";

describe("SAML 2.0 asinado (IdP mock → SP)", () => {
  it("valida AuthnResponse e mapea PersonIdentifier", async () => {
    const { base64 } = buildSignedAuthnResponse({ userKey: "admin" });
    const { user, relayState } = await validateAcsPost({
      SAMLResponse: base64,
      RelayState: "/c/exemplo/admin",
    });
    assert.equal(user.role, "admin");
    assert.equal(user.personIdentifier, "ES/ES/11223344B");
    assert.equal(user.displayName, "Admin Exemplo");
    assert.equal(relayState, "/c/exemplo/admin");
  });

  it("rexeita SAMLResponse basura", async () => {
    await assert.rejects(
      () =>
        validateAcsPost({
          SAMLResponse: Buffer.from("<xml>nope</xml>").toString("base64"),
        }),
      /./,
    );
  });
});
