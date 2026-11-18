import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const demoSetupClubSchema = z
  .object({
    name: z.string().trim().min(1, "name do club obrigatorio"),
    shortName: z.string().trim().min(1, "shortName do club obrigatorio"),
  })
  .strict();

export const demoSetupConcelloSchema = z
  .object({
    name: z.string().trim().min(1, "name obrigatorio"),
    slug: z
      .string()
      .trim()
      .min(1)
      .regex(SLUG_RE, "slug só pode conter minúsculas, números e guións"),
    ineCode: z
      .string()
      .trim()
      .regex(/^\d{5}$/, "ineCode debe ser un código INE de 5 díxitos"),
    colors: z
      .object({
        brand: z.string().trim().min(1),
        accent: z.string().trim().min(1).optional(),
      })
      .strict()
      .optional(),
    clubs: z.array(demoSetupClubSchema).default([]),
  })
  .strict();

export const demoSetupFileSchema = z
  .array(demoSetupConcelloSchema)
  .min(1, "DEMO_SETUP_FILE debe conter polo menos un concello");

export type DemoSetupClub = z.infer<typeof demoSetupClubSchema>;
export type DemoSetupConcello = z.infer<typeof demoSetupConcelloSchema>;

let cachedFilePath: string | null = null;
let cachedSetup: DemoSetupConcello[] | null = null;

export function getDemoSetupFilePath(): string | null {
  const raw = process.env.DEMO_SETUP_FILE?.trim();
  if (!raw) return null;
  return path.resolve(raw);
}

export function parseDemoSetupJson(rawContent: string): DemoSetupConcello[] {
  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(rawContent);
  } catch (e) {
    throw new Error(
      `JSON mal formado en DEMO_SETUP_FILE: ${(e as Error).message}`,
    );
  }

  const result = demoSetupFileSchema.safeParse(rawParsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Validación fallida en DEMO_SETUP_FILE: ${detail}`);
  }
  return result.data;
}

/**
 * Carga e valida DEMO_SETUP_FILE. Se o env está definido e o ficheiro falla,
 * lanza para deter o arranque (mesmo patrón que DEMO_USERS_FILE).
 */
export function initDemoSetupFromEnv(): DemoSetupConcello[] | null {
  const filePath = getDemoSetupFilePath();
  if (!filePath) {
    cachedFilePath = null;
    cachedSetup = null;
    return null;
  }

  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`O ficheiro DEMO_SETUP_FILE non existe: ${filePath}`);
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = parseDemoSetupJson(raw);
    cachedFilePath = filePath;
    cachedSetup = parsed;
    return parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[boot] Erro crítico en DEMO_SETUP_FILE (${filePath}): ${message}`,
    );
    cachedFilePath = null;
    cachedSetup = null;
    throw err instanceof Error ? err : new Error(message);
  }
}

export function getLoadedDemoSetup(): DemoSetupConcello[] | null {
  const envPath = getDemoSetupFilePath();
  if (!envPath) {
    cachedFilePath = null;
    cachedSetup = null;
    return null;
  }
  if (cachedSetup && cachedFilePath === envPath) {
    return cachedSetup;
  }
  return initDemoSetupFromEnv();
}

export function hasDemoSetupFile(): boolean {
  return getDemoSetupFilePath() !== null;
}
