import type { AuthUser } from "@pista-aberta/shared";

export type LoginMethod = "saml" | "email_otp" | "certificate";

export interface LoginStartInput {
  method: LoginMethod;
  /** Para SAML mock: id do usuario de proba. Para OTP: email. */
  identifier?: string;
  municipalityId?: string;
  returnTo?: string;
}

export interface LoginStartResult {
  /** URL á que redirixir o navegador (SAML IdP) ou null se o fluxo continúa por API (OTP). */
  redirectUrl?: string;
  /** Token de desafío OTP (non é o código). */
  challengeId?: string;
  message?: string;
  /**
   * REVISION-22 A9: só con PA_DEMO=1 — código OTP real para amosar en pantalla.
   * Con PA_DEMO=0 isto non existe (nin na resposta nin nos logs).
   */
  demoCode?: string;
  /** REVISION-50 S5 — state do certificado (cookie no navegador). */
  state?: string;
}

export interface CallbackInput {
  method: LoginMethod;
  /** Payload SAML (stub) ou challengeId+código OTP. */
  payload: Record<string, string>;
}

/**
 * Capa desacoplada de identidade.
 * Produción: adaptador SAML → Cl@ve eIDAS.
 * Demo: SAML mock + correo+OTP. Sen OIDC nin Chave365.
 */
export interface IdentityProvider {
  login(input: LoginStartInput): Promise<LoginStartResult>;
  callback(input: CallbackInput): Promise<AuthUser>;
  logout(sessionId: string): Promise<void>;
  getUser(sessionId: string): Promise<AuthUser | null>;
}
