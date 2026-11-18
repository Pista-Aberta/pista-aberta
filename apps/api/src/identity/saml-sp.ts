/**
 * Service Provider SAML 2.0 con @node-saml/node-saml.
 * Valida firma da aserción, Audience e Destination; mapea perfil eIDAS → AuthUser.
 *
 * Seguridade (Pablo):
 * - Rol NUNCA do atributo SAML en prod — só BD / seed por PersonIdentifier.
 * - validateInResponseTo: never en demo; always en prod (env SAML_VALIDATE_IN_RESPONSE_TO).
 */
import { SAML, ValidateInResponseTo } from "@node-saml/node-saml";
import type { AuthUser, Role } from "@pista-aberta/shared";
import { eq } from "drizzle-orm";
import { loadIdpCert, loadSpCert, loadSpKey, pemBody } from "./saml-certs.js";
import {
  apiBase,
  idpSsoUrl,
  spAcsUrl,
  spEntityId,
} from "./saml-config.js";
import { resolveDemoUser, SAML_DEMO_USERS } from "./saml-users.js";
import {
  getDemoFileEntryByKey,
  getLoadedDemoFileUsers,
  hasDemoUsersFile,
} from "./demo-users-file.js";
import {
  provisionDemoFileUserOnLogin,
  type DemoLoginWarning,
} from "./demo-users-provision.js";
import {
  isDemoMode,
  isProduction,
  samlValidateInResponseToMode,
  trustSamRoleAttribute,
} from "../env.js";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { mapUser } from "../db/mappers.js";
import { resolveNewUserMunicipalityId } from "./resolve-muni.js";

const EIDAS_PI =
  "http://eidas.europa.eu/attributes/naturalperson/PersonIdentifier";
const EIDAS_GIVEN =
  "http://eidas.europa.eu/attributes/naturalperson/CurrentGivenName";
const EIDAS_FAMILY =
  "http://eidas.europa.eu/attributes/naturalperson/CurrentFamilyName";

let samlSingleton: SAML | null = null;

export function getSamlSp(): SAML {
  if (samlSingleton) return samlSingleton;
  const inResponseTo =
    samlValidateInResponseToMode() === "always"
      ? ValidateInResponseTo.always
      : ValidateInResponseTo.never;
  samlSingleton = new SAML({
    callbackUrl: spAcsUrl(),
    entryPoint: idpSsoUrl(),
    issuer: spEntityId(),
    idpCert: pemBody(loadIdpCert()),
    privateKey: loadSpKey(),
    publicCert: loadSpCert(),
    decryptionPvk: loadSpKey(),
    /* Cl@ve real esixe SHA-256 ou superior nas AuthnRequest / metadata. */
    signatureAlgorithm: "sha256",
    digestAlgorithm: "sha256",
    signMetadata: true,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    audience: spEntityId(),
    acceptedClockSkewMs: 5 * 60 * 1000,
    validateInResponseTo: inResponseTo,
    identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified",
  });
  return samlSingleton;
}

/** Reset singleton (tests / cambio de env). */
export function resetSamlSpForTests(): void {
  samlSingleton = null;
}

export async function getSpAuthorizeUrl(relayState: string): Promise<string> {
  const saml = getSamlSp();
  return saml.getAuthorizeUrlAsync(relayState, undefined, {});
}

export function getSpMetadataXml(): string {
  const saml = getSamlSp();
  return saml.generateServiceProviderMetadata(loadSpCert(), loadSpCert());
}

function attr(
  profile: Record<string, unknown>,
  name: string,
): string | undefined {
  const v = profile[name] ?? (profile.attributes as Record<string, unknown> | undefined)?.[name];
  if (Array.isArray(v)) return String(v[0]);
  if (v == null) return undefined;
  return String(v);
}

async function lookupUserByPersonIdentifier(
  personIdentifier: string,
): Promise<AuthUser | null> {
  try {
    const rows = await getDb()
      .select()
      .from(t.users)
      .where(eq(t.users.personIdentifier, personIdentifier))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mapUser(row);
  } catch {
    return null;
  }
}

/**
 * Mapea perfil SAML → AuthUser.
 * Privilexios: BD (personIdentifier) ou seed demo — NUNCA atributo `role` en prod.
 * REVISION-55 G1: SAML_DEMO_USERS («known») só en demo.
 * REVISION-55 G2: concello desde RelayState / PA_SINGLE_MUNI.
 */
export type ProfileResolutionExtras = {
  warning?: DemoLoginWarning;
  activateClubId?: string;
  activateMuniRole?: { role: Role; municipalityId: string };
};

export async function resolveProfileWithMeta(
  profile: Record<string, unknown>,
  opts?: { relayState?: string; municipalityId?: string | null },
): Promise<{ user: AuthUser } & ProfileResolutionExtras> {
  const demoKey = attr(profile, "demoUserKey");
  if (isDemoMode() && hasDemoUsersFile()) {
    const fileEntry =
      (demoKey ? getDemoFileEntryByKey(demoKey) : null) ??
      (() => {
        const piAttr =
          attr(profile, EIDAS_PI) ??
          (typeof profile.nameID === "string" ? profile.nameID : undefined);
        if (!piAttr) return null;
        return (
          getLoadedDemoFileUsers()?.find((u) => u.personIdentifier === piAttr) ??
          null
        );
      })();
    if (fileEntry) {
      return provisionDemoFileUserOnLogin(fileEntry);
    }
  }

  if (demoKey && isDemoMode() && !hasDemoUsersFile() && SAML_DEMO_USERS[demoKey]) {
    const u = resolveDemoUser(demoKey, opts?.relayState);
    const {
      key: _k,
      givenName: _g,
      familyName: _f,
      clubName: _cn,
      demoFileRole: _dfr,
      ...rest
    } = u;
    const fromDb = await lookupUserByPersonIdentifier(rest.personIdentifier!);
    return { user: fromDb ?? { ...rest } };
  }

  const personIdentifier =
    attr(profile, EIDAS_PI) ??
    (typeof profile.nameID === "string" ? profile.nameID : undefined);

  if (!personIdentifier) {
    if (isProduction()) {
      throw new Error("SAML sen PersonIdentifier");
    }
  }

  const pi = personIdentifier ?? (isDemoMode() ? "ES/ES/unknown" : "");
  if (!pi) throw new Error("SAML sen PersonIdentifier");

  const fromDb = await lookupUserByPersonIdentifier(pi);
  if (fromDb) return { user: fromDb };

  /* REVISION-55 G1: roles da demo só se isDemoMode() e sen DEMO_USERS_FILE. */
  if (isDemoMode() && !hasDemoUsersFile()) {
    const known = Object.values(SAML_DEMO_USERS).find(
      (u) => u.personIdentifier === pi,
    );
    if (known) {
      const {
        key: _k,
        givenName: _g,
        familyName: _f,
        clubName: _cn,
        demoFileRole: _dfr,
        ...rest
      } = known;
      return { user: { ...rest } };
    }
  }

  const given = attr(profile, EIDAS_GIVEN) ?? "";
  const family = attr(profile, EIDAS_FAMILY) ?? "";
  const displayName =
    [given, family].filter(Boolean).join(" ") || pi;

  // Prod / default: sempre cidadán; rol do assertion só se PA_TRUST_SAML_ROLE=1 (demo)
  let role: Role = "citizen";
  if (trustSamRoleAttribute()) {
    const roleRaw = attr(profile, "role") ?? "citizen";
    if (
      ["citizen", "staff", "monitor", "club_manager", "admin", "superadmin"].includes(
        roleRaw,
      )
    ) {
      role = roleRaw as Role;
    }
  }

  const municipalityId = await resolveNewUserMunicipalityId({
    municipalityId: opts?.municipalityId,
    returnTo: opts?.relayState,
  });

  return {
    user: {
      id: `saml-${pi.replace(/\W+/g, "-")}`,
      municipalityId,
      role,
      displayName,
      personIdentifier: pi,
      locale: "gl",
    },
  };
}

export async function profileToAuthUser(
  profile: Record<string, unknown>,
  opts?: { relayState?: string; municipalityId?: string | null },
): Promise<AuthUser> {
  const res = await resolveProfileWithMeta(profile, opts);
  return res.user;
}

export async function validateAcsPost(body: {
  SAMLResponse?: string;
  RelayState?: string;
  municipalityId?: string | null;
}): Promise<{ user: AuthUser; relayState: string } & ProfileResolutionExtras> {
  if (!body.SAMLResponse) {
    throw new Error("SAMLResponse ausente");
  }
  const saml = getSamlSp();
  const result = await saml.validatePostResponseAsync({
    SAMLResponse: body.SAMLResponse,
    ...(body.RelayState ? { RelayState: body.RelayState } : {}),
  });
  const profile = result.profile;
  if (!profile) throw new Error("perfil SAML baleiro");
  const relayState =
    (typeof body.RelayState === "string" && body.RelayState) || "/";
  const resolved = await resolveProfileWithMeta(
    profile as unknown as Record<string, unknown>,
    { relayState, municipalityId: body.municipalityId },
  );
  return { ...resolved, relayState };
}

export function describeSamlEndpoints() {
  return {
    spEntityId: spEntityId(),
    acs: spAcsUrl(),
    metadata: `${apiBase()}/auth/saml/metadata`,
    idpSso: idpSsoUrl(),
    demo: isDemoMode(),
    validateInResponseTo: samlValidateInResponseToMode(),
    trustSamRoleAttribute: trustSamRoleAttribute(),
    note:
      "IdP mock asinado — non é Cl@ve real. En prod: validateInResponseTo=always; rol só desde BD.",
  };
}
