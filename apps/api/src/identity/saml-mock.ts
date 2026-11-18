/**
 * Adaptador IdentityProvider → IdP SAML mock asinado + SP node-saml.
 * Demo: simula Cl@ve (eIDAS). Produción: mesmo adaptador con IdP real.
 */
import type { AuthUser } from "@pista-aberta/shared";
import type {
  CallbackInput,
  IdentityProvider,
  LoginStartInput,
  LoginStartResult,
} from "./types.js";
import { createSession, destroySession, getSession } from "./sessions.js";
import { getSpAuthorizeUrl } from "./saml-sp.js";
import { MOCK_USERS, resolveDemoUser } from "./saml-users.js";
import { getSingleMuniSlug } from "../env.js";
import { getMunicipalityById } from "../store/db.js";

export { MOCK_USERS, createSession };

export class SamlMockIdentityProvider implements IdentityProvider {
  async login(input: LoginStartInput): Promise<LoginStartResult> {
    let relayState = input.returnTo?.trim() || "";
    if (!relayState) {
      if (input.municipalityId) {
        const muni = await getMunicipalityById(input.municipalityId);
        if (muni) relayState = `/c/${muni.slug}`;
      }
      if (!relayState) {
        const single = getSingleMuniSlug();
        if (single) relayState = `/c/${single}`;
      }
      if (!relayState) relayState = "/";
    }
    const redirectUrl = await getSpAuthorizeUrl(relayState);
    return {
      redirectUrl,
      message: "Redirixindo á identificación de demo (simula Cl@ve)",
    };
  }

  /**
   * Callback legado (query user=) — preferir ACS POST validado.
   * Mantense por compat se alguén chama identity.callback con payload.user.
   */
  async callback(input: CallbackInput): Promise<AuthUser> {
    const key = input.payload.user ?? "cidada";
    const relay =
      input.payload.RelayState ??
      input.payload.returnTo ??
      input.payload.relayState;
    const u = resolveDemoUser(key, relay);
    const {
      key: _k,
      givenName: _g,
      familyName: _f,
      clubName: _cn,
      demoFileRole: _dfr,
      ...rest
    } = u;
    return { ...rest };
  }

  async logout(sessionId: string): Promise<void> {
    await destroySession(sessionId);
  }

  async getUser(sessionId: string): Promise<AuthUser | null> {
    return getSession(sessionId);
  }
}
