/**
 * REVISION-54 E5 — ler ?contraste e ?texto unha vez no arranque (main.tsx),
 * antes do render, para que valga en calquera ruta (p.ex. /demo?texto=125).
 */
export function applyReadingPrefsFromQuery(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const contraste = url.searchParams.get("contraste");
  const texto = url.searchParams.get("texto");
  if (!contraste && !texto) return;

  if (contraste === "alto") {
    localStorage.setItem("pa_contrast", "high");
    document.documentElement.dataset.contrast = "high";
  } else if (contraste === "normal") {
    localStorage.setItem("pa_contrast", "normal");
    document.documentElement.dataset.contrast = "normal";
  }

  if (texto === "100" || texto === "125" || texto === "150") {
    localStorage.setItem("pa_text", texto);
    if (texto === "100") delete document.documentElement.dataset.text;
    else document.documentElement.dataset.text = texto;
  }

  url.searchParams.delete("contraste");
  url.searchParams.delete("texto");
  const qs = url.searchParams.toString();
  window.history.replaceState(
    null,
    "",
    `${url.pathname}${qs ? `?${qs}` : ""}${url.hash}`,
  );
}
