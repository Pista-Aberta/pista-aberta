/**
 * Baixa de avisos sen login · REVISION-22 A4 / RFC 8058 + REVISION-23 R6.
 * GET amosa confirmación; POST aplica a baixa (One-Click e formulario).
 */
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import * as schema from "../db/schema.js";
import {
  disableAllEmail,
  derivedNotifyFlags,
  normalizeNotifyPrefs,
} from "../notify/prefs.js";
import { verifyUnsubscribeToken } from "../notify/unsubscribe.js";

export const avisosBaixaRoutes = new Hono();

async function applyUnsubscribe(userId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!rows[0]) return false;
  const next = disableAllEmail(normalizeNotifyPrefs(rows[0].notifyPrefs));
  const flags = derivedNotifyFlags(next);
  await db
    .update(schema.users)
    .set({
      notifyPrefs: next,
      notifyEmail: flags.notifyEmail,
      notifyReminders: flags.notifyReminders,
    })
    .where(eq(schema.users.id, userId));
  return true;
}

function successHtml(): string {
  return `<!DOCTYPE html><html lang="gl"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Avisos · Pista Aberta</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem"><h1>Baixa de avisos</h1><p>Xa non recibirás avisos por correo. Podes volver activalos en Conta › Avisos cando inicies sesión.</p></body></html>`;
}

function errorHtml(msg: string): string {
  return `<!DOCTYPE html><html lang="gl"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Avisos · Pista Aberta</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem"><h1>Ligazón non válida</h1><p>${msg}</p></body></html>`;
}

function confirmHtml(token: string): string {
  const safe = token
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
  return `<!DOCTYPE html><html lang="gl"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Avisos · Pista Aberta</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem"><h1>Baixa de avisos</h1><p>Se confirmas, deixarás de recibir avisos por correo desta instalación.</p><form method="post" action="/api/avisos/baixa?token=${safe}"><button type="submit" style="font-size:1rem;padding:0.75rem 1.25rem;cursor:pointer">Non quero recibir estes avisos</button></form></body></html>`;
}

/** GET: páxina de confirmación (non muda o estado — antivirus/Safe Links). */
avisosBaixaRoutes.get("/api/avisos/baixa", async (c) => {
  const token = c.req.query("token") ?? "";
  const userId = verifyUnsubscribeToken(token);
  if (!userId) {
    return c.html(errorHtml("O enlace de baixa non é válido ou caducou."), 400);
  }
  return c.html(confirmHtml(token));
});

/** POST: aplica a baixa (formulario + RFC 8058 One-Click). */
avisosBaixaRoutes.post("/api/avisos/baixa", async (c) => {
  const token = c.req.query("token") ?? "";
  const userId = verifyUnsubscribeToken(token);
  if (!userId) {
    const accept = c.req.header("accept") ?? "";
    if (accept.includes("text/html")) {
      return c.html(errorHtml("O enlace de baixa non é válido ou caducou."), 400);
    }
    return c.json({ error: "invalid_token" }, 400);
  }
  const ok = await applyUnsubscribe(userId);
  if (!ok) {
    const accept = c.req.header("accept") ?? "";
    if (accept.includes("text/html")) {
      return c.html(errorHtml("Non se atopou a conta."), 404);
    }
    return c.json({ error: "not_found" }, 404);
  }
  const accept = c.req.header("accept") ?? "";
  if (accept.includes("text/html") || c.req.header("content-type")?.includes("form")) {
    return c.html(successHtml());
  }
  return c.json({ ok: true });
});
