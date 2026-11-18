/** URLs e emisores SAML (demo local). Override con env. */

export function appBase(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Base pública do SP/IdP.
 * En desenvolvemento, por defecto = APP_BASE_URL (Vite proxy /auth)
 * para que form-action 'self' no auto-POST SAML non falle.
 */
export function apiBase(): string {
  if (process.env.API_BASE_URL?.trim()) {
    return process.env.API_BASE_URL.replace(/\/$/, "");
  }
  if (process.env.NODE_ENV !== "production") {
    return appBase();
  }
  return "http://localhost:3001";
}

export function spEntityId(): string {
  return (
    process.env.SAML_SP_ENTITY_ID?.trim() || `${apiBase()}/auth/saml/metadata`
  );
}

export function spAcsUrl(): string {
  return (
    process.env.SAML_CALLBACK_URL?.trim() || `${apiBase()}/auth/saml/acs`
  );
}

export function idpEntityId(): string {
  return (
    process.env.SAML_IDP_ENTITY_ID?.trim() || `${apiBase()}/auth/saml/mock-idp`
  );
}

export function idpSsoUrl(): string {
  return (
    process.env.SAML_IDP_SSO_URL?.trim() || `${apiBase()}/auth/saml/mock-idp`
  );
}
