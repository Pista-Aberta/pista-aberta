import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import gl from "./gl.json";

const saved =
  (typeof localStorage !== "undefined" && localStorage.getItem("pa_locale")) ||
  "gl";

void i18n.use(initReactI18next).init({
  resources: {
    gl: { translation: gl },
  },
  lng: saved.startsWith("es") ? "gl" : saved,
  fallbackLng: "gl",
  interpolation: { escapeValue: false },
  partialBundledLanguages: true,
});

/** Carga es.json só cando fai falta (bundle cidadán máis lixeiro). */
export async function ensureLocale(lng: string): Promise<void> {
  const code = lng.toLowerCase().startsWith("es") ? "es" : "gl";
  if (code === "es" && !i18n.hasResourceBundle("es", "translation")) {
    const mod = await import("./es.json");
    i18n.addResourceBundle("es", "translation", mod.default ?? mod, true, true);
  }
  await i18n.changeLanguage(code);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("pa_locale", code);
  }
}

if (saved.startsWith("es")) {
  void ensureLocale("es");
}

export default i18n;
