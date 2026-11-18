/** Etiquetas traducidas para servizos de instalación (REVISION-40 T4). */

export function normalizeServiceKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, "_");
}

export function serviceLabel(
  raw: string,
  t: (key: string, opts?: { defaultValue?: string }) => string,
): string {
  const key = normalizeServiceKey(raw);
  if (!key) return raw;
  return t(`admin.svc.${key}`, { defaultValue: raw });
}

export function servicesLine(
  services: string[] | undefined,
  t: (key: string, opts?: { defaultValue?: string }) => string,
  limit = 4,
): string | undefined {
  if (!services || services.length === 0) return undefined;
  return services
    .slice(0, limit)
    .map((s) => serviceLabel(s, t))
    .join(" · ");
}
