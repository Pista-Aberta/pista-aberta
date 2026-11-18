import type { AuthUser, Role } from "@pista-aberta/shared";
import {
  findDemoFileUser,
  getLoadedDemoFileUsers,
  hasDemoUsersFile,
  toDemoFileSamlPersona,
  type DemoFileRole,
} from "./demo-users-file.js";

export type SamlDemoUser = Omit<AuthUser, "id"> & {
  id: string;
  /** Chave curta do selector IdP. */
  key: string;
  givenName: string;
  familyName: string;
  clubName?: string;
  demoFileRole?: DemoFileRole;
};

/** Usuarios de proba do IdP SAML mock (simula Cl@ve / eIDAS). */
export const SAML_DEMO_USERS: Record<string, SamlDemoUser> = {
  cidada: {
    key: "cidada",
    id: "user-cidada",
    municipalityId: "muni-exemplo",
    municipalitySlug: "exemplo",
    role: "citizen",
    displayName: "Ana Demo",
    givenName: "Ana",
    familyName: "Demo",
    personIdentifier: "ES/ES/12345678Z",
    email: "ana.demo@demo.pistaaberta.com",
    locale: "gl",
  },
  /** Segunda veciña demo — fluxo lista de espera (Ana cancela → Luis). */
  brais: {
    key: "brais",
    id: "user-brais",
    municipalityId: "muni-exemplo",
    municipalitySlug: "exemplo",
    role: "citizen",
    displayName: "Luis Demo",
    givenName: "Luis",
    familyName: "Costa",
    personIdentifier: "ES/ES/23456789D",
    email: "luis.demo@demo.pistaaberta.com",
    locale: "gl",
  },
  admin: {
    key: "admin",
    id: "user-admin",
    municipalityId: "muni-exemplo",
    municipalitySlug: "exemplo",
    role: "admin",
    displayName: "Admin Exemplo",
    givenName: "Admin",
    familyName: "Exemplo",
    personIdentifier: "ES/ES/11223344B",
    email: "admin.exemplo@demo.pistaaberta.com",
    locale: "gl",
  },
  club: {
    key: "club",
    id: "user-club",
    municipalityId: "muni-exemplo",
    municipalitySlug: "exemplo",
    role: "club_manager" satisfies Role,
    displayName: "Club Deportivo Exemplo",
    givenName: "CB",
    familyName: "Exemplo",
    personIdentifier: "ES/ES/55667788Z",
    email: "club.xestor@demo.pistaaberta.com",
    clubId: "club-basquet",
    locale: "gl",
  },
  /** REVISION-39 L3 — segunda xestora do mesmo club. */
  club2: {
    key: "club2",
    id: "user-club-2",
    municipalityId: "muni-exemplo",
    municipalitySlug: "exemplo",
    role: "club_manager" satisfies Role,
    displayName: "Xestora Club",
    givenName: "Xestora",
    familyName: "Club",
    personIdentifier: "ES/ES/66778899D",
    email: "xestora.club@demo.pistaaberta.com",
    clubId: "club-basquet",
    locale: "gl",
  },
  staff: {
    key: "staff",
    id: "user-staff",
    municipalityId: "muni-exemplo",
    municipalitySlug: "exemplo",
    role: "staff",
    displayName: "Conserxe Demo",
    givenName: "Pedro",
    familyName: "Conserxe",
    personIdentifier: "ES/ES/87654321X",
    email: "conserxe.demo@demo.pistaaberta.com",
    locale: "gl",
  },
  /** Admin demo só de Proba (nunca de Exemplo). */
  "admin-proba": {
    key: "admin-proba",
    id: "user-admin-proba",
    municipalityId: "muni-proba",
    municipalitySlug: "proba",
    role: "admin",
    displayName: "Persoal do Concello de Proba",
    givenName: "Persoal",
    familyName: "Proba",
    personIdentifier: "ES/ES/99887766P",
    email: "admin.proba@demo.pistaaberta.com",
    locale: "gl",
  },
  "cidada-proba": {
    key: "cidada-proba",
    id: "user-cidada-proba",
    municipalityId: "muni-proba",
    municipalitySlug: "proba",
    role: "citizen",
    displayName: "Veciña de Proba",
    givenName: "Veciña",
    familyName: "Proba",
    personIdentifier: "ES/ES/44556677L",
    email: "cidada.proba@demo.pistaaberta.com",
    locale: "gl",
  },
  /** Vista Deputación — ve Exemplo e Proba (superadmin). */
  deputacion: {
    key: "deputacion",
    id: "user-deputacion",
    municipalityId: "muni-deputacion-platform",
    municipalitySlug: undefined,
    role: "superadmin",
    displayName: "Deputación",
    givenName: "Persoa",
    familyName: "Deputación",
    personIdentifier: "ES/ES/33445566R",
    email: "deputacion@demo.pistaaberta.com",
    locale: "gl",
  },
};

export function resolveDemoUser(
  key: string,
  relayState?: string,
): SamlDemoUser {
  if (hasDemoUsersFile()) {
    const matched = findDemoFileUser(key, relayState);
    if (matched) return toDemoFileSamlPersona(matched);
    /* Nunca caia no primeiro do ficheiro (p.ex. Exemplo): iso provocaba
     * «Entraches desde Exemplo» ao entrar noutro concello co alias cidada/admin. */
    throw new Error(`demo_user_not_found:${key}`);
  }
  return SAML_DEMO_USERS[key] ?? SAML_DEMO_USERS.cidada!;
}

/**
 * Usuarios do IdP.
 * Con DEMO_USERS_FILE: TODAS as contas (o UI agrupa por concello; RelayState
 * só ordena o grupo prioritario). Sen ficheiro: filtro por slug + Ana (`cidada`).
 */
export function demoUsersForSlug(slug: string | null | undefined): SamlDemoUser[] {
  if (hasDemoUsersFile()) {
    /* slug só ordena no HTML do IdP; aquí devolvemos todas. */
    void slug;
    const loaded = getLoadedDemoFileUsers() ?? [];
    return loaded.map(toDemoFileSamlPersona);
  }
  if (!slug) {
    return Object.values(SAML_DEMO_USERS);
  }
  const muniId = `muni-${slug}`;
  const matched = Object.values(SAML_DEMO_USERS).filter(
    (u) =>
      u.role === "superadmin" ||
      u.municipalityId === muniId ||
      u.municipalitySlug === slug ||
      u.key === "cidada",
  );
  if (matched.length) return matched;
  /* Concello novo sen seed: lista baleira (o UI avisa). */
  return [];
}

/** Compat: chave antiga MOCK_USERS. */
export const MOCK_USERS = Object.fromEntries(
  Object.entries(SAML_DEMO_USERS).map(([k, u]) => {
    const { key: _k, givenName: _g, familyName: _f, ...rest } = u;
    return [k, rest];
  }),
);
