import {
  resolveTheme,
  themeToCssVars,
  type Municipality,
  type MunicipalityTheme,
} from "@pista-aberta/shared";

export function themeFromMunicipality(m: Municipality | null | undefined): MunicipalityTheme {
  if (!m) return resolveTheme();
  return resolveTheme({
    accentColor: m.accentColor,
    theme: m.settings.theme,
  });
}

/** Aplica --pa-brand / --pa-accent no documento (todos os paneles do concello). */
export function applyMunicipalityTheme(m: Municipality | null | undefined): MunicipalityTheme {
  const theme = themeFromMunicipality(m);
  const vars = themeToCssVars(theme);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
  return theme;
}

export function clearMunicipalityTheme(): void {
  const theme = resolveTheme();
  const vars = themeToCssVars(theme);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
}
