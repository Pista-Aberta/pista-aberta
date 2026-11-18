import type { Context, Next } from "hono";
import { getMunicipalityBySlug } from "./store/db.js";
import { getSingleMuniSlug } from "./env.js";

/** Resolve municipalityId por ruta `/c/:slug` ou header. */
export async function municipalityMiddleware(c: Context, next: Next) {
  const slug =
    c.req.param("slug") ??
    c.req.header("x-municipality-slug") ??
    getSingleMuniSlug() ??
    null;
  if (!slug) {
    return c.json({ error: "municipality_required" }, 400);
  }
  const muni = await getMunicipalityBySlug(slug);
  if (!muni) {
    return c.json({ error: "municipality_not_found", slug }, 404);
  }
  c.set("municipalityId", muni.id);
  c.set("municipalitySlug", muni.slug);
  await next();
}

declare module "hono" {
  interface ContextVariableMap {
    municipalityId: string;
    municipalitySlug: string;
    sessionId: string | undefined;
  }
}
