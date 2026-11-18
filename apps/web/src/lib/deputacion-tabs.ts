export const DEPUTACION_TABS = [
  "resumo",
  "concellos",
  "persoas",
  "config",
] as const;

export type DeputacionTab = (typeof DEPUTACION_TABS)[number];

export function parseDeputacionTab(raw: string | null): DeputacionTab {
  if (raw && (DEPUTACION_TABS as readonly string[]).includes(raw)) {
    return raw as DeputacionTab;
  }
  return "resumo";
}

export function deputacionTabHref(tab: DeputacionTab): string {
  return tab === "resumo" ? "/deputacion" : `/deputacion?tab=${tab}`;
}
