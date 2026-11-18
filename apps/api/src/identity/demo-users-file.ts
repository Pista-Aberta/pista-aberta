import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AuthUser, Role } from "@pista-aberta/shared";
import { normalizeNif, toPersonIdentifier } from "../lib/nif.js";

export const DEMO_FILE_ROLES = [
  "vecino",
  "admin",
  "conserxe",
  "deputacion",
  "club",
] as const;

export type DemoFileRole = (typeof DEMO_FILE_ROLES)[number];

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const demoUserFileEntrySchema = z
  .object({
    nif: z.string().trim().min(1, "nif obrigatorio"),
    nombre: z.string().trim().min(1, "nombre obrigatorio"),
    apellidos: z.string().trim().min(1, "apellidos obrigatorios"),
    email: z.string().trim().email("email inválido"),
    role: z.enum(DEMO_FILE_ROLES),
    municipalitySlug: z.string().trim().nullable(),
    clubName: z.string().trim().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    try {
      toPersonIdentifier(val.nif);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nif"],
        message: "NIF/NIE inválido",
      });
    }

    if (val.role === "deputacion") {
      if (val.municipalitySlug !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["municipalitySlug"],
          message: "municipalitySlug debe ser null para role 'deputacion'",
        });
      }
    } else {
      if (val.municipalitySlug === null || val.municipalitySlug.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["municipalitySlug"],
          message:
            "municipalitySlug é obrigatorio para roles distintos de 'deputacion'",
        });
      } else if (!SLUG_RE.test(val.municipalitySlug)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["municipalitySlug"],
          message:
            "municipalitySlug só pode conter minúsculas, números e guións",
        });
      }
    }

    if (val.role === "club") {
      if (!val.clubName || val.clubName.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["clubName"],
          message: "clubName é obrigatorio cando role é 'club'",
        });
      }
    } else if (val.clubName !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clubName"],
        message: "clubName só se permite cando role é 'club'",
      });
    }
  });

export const demoUsersFileSchema = z
  .array(demoUserFileEntrySchema)
  .min(1, "DEMO_USERS_FILE debe conter polo menos unha conta");

export type DemoUserFileEntry = z.infer<typeof demoUserFileEntrySchema>;

export type LoadedDemoFileUser = DemoUserFileEntry & {
  key: string;
  id: string;
  normalizedNif: string;
  personIdentifier: string;
  displayName: string;
  appRole: Role;
};

export function mapDemoFileRoleToAppRole(role: DemoFileRole): Role {
  switch (role) {
    case "vecino":
      return "citizen";
    case "admin":
      return "admin";
    case "conserxe":
      return "staff";
    case "deputacion":
      return "superadmin";
    case "club":
      return "club_manager";
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

export function parseDemoUsersJson(rawContent: string): LoadedDemoFileUser[] {
  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(rawContent);
  } catch (e) {
    throw new Error(
      `JSON mal formado en DEMO_USERS_FILE: ${(e as Error).message}`,
    );
  }

  const result = demoUsersFileSchema.safeParse(rawParsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Validación fallida en DEMO_USERS_FILE: ${detail}`);
  }

  return result.data.map((entry, idx) => {
    const normalizedNif = normalizeNif(entry.nif);
    const personIdentifier = toPersonIdentifier(entry.nif);
    const displayName = `${entry.nombre} ${entry.apellidos}`.trim();
    const appRole = mapDemoFileRoleToAppRole(entry.role);
    return {
      ...entry,
      email: entry.email.toLowerCase(),
      key: `demo-file-${idx}`,
      id: `user-demo-${normalizedNif.toLowerCase()}`,
      normalizedNif,
      personIdentifier,
      displayName,
      appRole,
    };
  });
}

let cachedFilePath: string | null = null;
let cachedUsers: LoadedDemoFileUser[] | null = null;

export function getDemoUsersFilePath(): string | null {
  const raw = process.env.DEMO_USERS_FILE?.trim();
  if (!raw) return null;
  return path.resolve(raw);
}

/**
 * Carga e valida DEMO_USERS_FILE ao arrancar (ou cando cambia o env nos tests).
 * Se DEMO_USERS_FILE está definido e o ficheiro falta ou non valida, rexistra
 * erro claro e lanza excepción para impedir que a API arranque.
 */
export function initDemoUsersFromEnv(): LoadedDemoFileUser[] | null {
  const filePath = getDemoUsersFilePath();
  if (!filePath) {
    cachedFilePath = null;
    cachedUsers = null;
    return null;
  }

  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`O ficheiro DEMO_USERS_FILE non existe: ${filePath}`);
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = parseDemoUsersJson(raw);
    cachedFilePath = filePath;
    cachedUsers = parsed;
    return parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[boot] Erro crítico en DEMO_USERS_FILE (${filePath}): ${message}`);
    cachedFilePath = null;
    cachedUsers = null;
    throw err instanceof Error ? err : new Error(message);
  }
}

export function getLoadedDemoFileUsers(): LoadedDemoFileUser[] | null {
  const envPath = getDemoUsersFilePath();
  if (!envPath) {
    cachedFilePath = null;
    cachedUsers = null;
    return null;
  }
  if (cachedUsers && cachedFilePath === envPath) {
    return cachedUsers;
  }
  return initDemoUsersFromEnv();
}

export function hasDemoUsersFile(): boolean {
  return getDemoUsersFilePath() !== null;
}

export type DemoFileSamlPersona = Omit<AuthUser, "id"> & {
  id: string;
  key: string;
  givenName: string;
  familyName: string;
  clubName?: string;
  demoFileRole?: DemoFileRole;
};

export function toDemoFileSamlPersona(
  u: LoadedDemoFileUser,
): DemoFileSamlPersona {
  return {
    key: u.key,
    id: u.id,
    municipalityId: u.municipalitySlug
      ? `muni-${u.municipalitySlug}`
      : "muni-deputacion-platform",
    municipalitySlug: u.municipalitySlug ?? undefined,
    role: u.appRole,
    displayName: u.displayName,
    givenName: u.nombre,
    familyName: u.apellidos,
    personIdentifier: u.personIdentifier,
    email: u.email,
    locale: "gl",
    clubName: u.clubName,
    demoFileRole: u.role,
  };
}

function aliasToDemoFileRole(alias: string): DemoFileRole | null {
  switch (alias) {
    case "cidada":
    case "vecino":
      return "vecino";
    case "admin":
      return "admin";
    case "staff":
    case "conserxe":
      return "conserxe";
    case "club":
      return "club";
    case "deputacion":
      return "deputacion";
    default:
      return null;
  }
}

export function findDemoFileUser(
  userKey: string,
  relayState?: string,
): LoadedDemoFileUser | null {
  const list = getLoadedDemoFileUsers();
  if (!list || list.length === 0) return null;

  const exact = list.find(
    (u) =>
      u.key === userKey ||
      u.normalizedNif.toLowerCase() === userKey.trim().toLowerCase() ||
      u.personIdentifier.toLowerCase() === userKey.trim().toLowerCase(),
  );
  if (exact) return exact;

  const mappedRole = aliasToDemoFileRole(userKey);
  if (!mappedRole) return null;

  if (mappedRole === "deputacion") {
    return list.find((u) => u.role === "deputacion") ?? null;
  }

  const slug = relayState?.match(/^\/c\/([^/?#]+)/)?.[1] ?? null;
  if (slug) {
    return (
      list.find(
        (u) => u.role === mappedRole && u.municipalitySlug === slug,
      ) ?? null
    );
  }
  return list.find((u) => u.role === mappedRole) ?? null;
}

export function getDemoFileEntryByKey(key: string): LoadedDemoFileUser | null {
  const list = getLoadedDemoFileUsers();
  if (!list) return null;
  return list.find((u) => u.key === key) ?? null;
}
