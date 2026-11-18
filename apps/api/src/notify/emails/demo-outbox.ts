/**
 * Bandexa en memoria dos últimos correos da demo (PA_DEMO=1).
 */
import type { EmailKind, RenderedEmail } from "./types.js";

export type DemoOutboxEntry = {
  id: string;
  at: string;
  to: string;
  kind: EmailKind;
  subject: string;
  preheader: string;
  html: string;
  text: string;
  fromName: string;
  userId?: string;
  municipalitySlug?: string;
};

const MAX = 80;
const box: DemoOutboxEntry[] = [];

export function recordDemoEmail(entry: Omit<DemoOutboxEntry, "id" | "at"> & { id?: string }): void {
  if (process.env.PA_DEMO !== "1" && process.env.PA_DEMO !== "true") return;
  box.unshift({
    id: entry.id ?? `demo-mail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    to: entry.to,
    kind: entry.kind,
    subject: entry.subject,
    preheader: entry.preheader,
    html: entry.html,
    text: entry.text,
    fromName: entry.fromName,
    userId: entry.userId,
    municipalitySlug: entry.municipalitySlug,
  });
  if (box.length > MAX) box.length = MAX;
}

export function listDemoEmails(opts?: {
  to?: string;
  userId?: string;
  limit?: number;
}): DemoOutboxEntry[] {
  let rows = box.slice();
  if (opts?.to) {
    const to = opts.to.toLowerCase();
    rows = rows.filter((r) => r.to.toLowerCase() === to);
  }
  if (opts?.userId) {
    rows = rows.filter((r) => r.userId === opts.userId);
  }
  const limit = opts?.limit ?? 40;
  return rows.slice(0, limit);
}

export function clearDemoOutbox(): void {
  box.length = 0;
}

export function renderedToDemo(
  to: string,
  kind: EmailKind,
  rendered: RenderedEmail,
  extra?: { userId?: string; municipalitySlug?: string },
): void {
  recordDemoEmail({
    to,
    kind,
    subject: rendered.subject,
    preheader: rendered.preheader,
    html: rendered.html,
    text: rendered.text,
    fromName: rendered.fromName,
    userId: extra?.userId,
    municipalitySlug: extra?.municipalitySlug,
  });
}
