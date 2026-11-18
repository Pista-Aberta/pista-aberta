import { EmailOtpIdentityProvider } from "./email-otp.js";
import { SamlMockIdentityProvider } from "./saml-mock.js";
import { startCertificateLogin } from "./certificate-routes.js";
import type {
  CallbackInput,
  IdentityProvider,
  LoginMethod,
  LoginStartInput,
  LoginStartResult,
} from "./types.js";
import type { AuthUser } from "@pista-aberta/shared";
import {
  createSession,
  destroySession,
  getSession,
  getSessionMeta,
  renewSession,
  sessionTtlMs,
} from "./sessions.js";

/**
 * Fachada: elixe o adaptador segundo o método.
 * Produción futura: só SAML→Cl@ve; OTP permanece como ponte operativa.
 * Certificado: mTLS vía nginx (ver certificate-routes).
 */
export class CompositeIdentityProvider implements IdentityProvider {
  private saml = new SamlMockIdentityProvider();
  private otp = new EmailOtpIdentityProvider();

  private pick(method: Exclude<LoginMethod, "certificate">): IdentityProvider {
    switch (method) {
      case "saml":
        return this.saml;
      case "email_otp":
        return this.otp;
      default: {
        const _exhaustive: never = method;
        return _exhaustive;
      }
    }
  }

  async login(input: LoginStartInput): Promise<LoginStartResult> {
    if (input.method === "certificate") {
      return startCertificateLogin({
        municipalityId: input.municipalityId,
        returnTo: input.returnTo,
      });
    }
    return this.pick(input.method).login(input);
  }

  async callback(input: CallbackInput): Promise<AuthUser> {
    if (input.method === "certificate") {
      throw new Error("certificate_callback_via_routes");
    }
    return this.pick(input.method).callback(input);
  }

  logout(sessionId: string): Promise<void> {
    return destroySession(sessionId);
  }

  getUser(sessionId: string): Promise<AuthUser | null> {
    return getSession(sessionId);
  }
}

export {
  createSession,
  getSession,
  getSessionMeta,
  renewSession,
  sessionTtlMs,
};
export type { IdentityProvider, LoginMethod, LoginStartInput, CallbackInput };
