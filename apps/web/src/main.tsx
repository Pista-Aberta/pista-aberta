import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/500.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "@fontsource/atkinson-hyperlegible-next/800.css";
import "@fontsource-variable/bricolage-grotesque/index.css";
import "@pista-aberta/shared/tokens.css";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  clearChunkReloadFlag,
  installChunkReloadOnce,
} from "./lib/chunk-reload";
import { applyReadingPrefsFromQuery } from "./lib/reading-prefs-boot";
import type { BeforeInstallPromptEventLike } from "./hooks/useInstallApp";
import "./i18n";
import "./index.css";
import "./components/ui/ui.css";

/* Rev24 axe: asegurar lang no documento (PrefsBar tamén o actualiza). */
if (typeof document !== "undefined" && !document.documentElement.lang) {
  document.documentElement.lang = "gl";
}

/* Tras deploy: index.html cacheado → chunks 404 → recarga unha vez. */
installChunkReloadOnce();
clearChunkReloadFlag();

/* PWA: capturar beforeinstallprompt antes de montar React. */
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  window.__paInstallPrompt = e as BeforeInstallPromptEventLike;
  window.dispatchEvent(new Event("pa:installable"));
});
window.addEventListener("appinstalled", () => {
  window.__paInstallPrompt = null;
  window.dispatchEvent(new Event("pa:installed"));
});

/* REVISION-54 E5: preferencias Aa desde a query antes do render. */
applyReadingPrefsFromQuery();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      /* optional */
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>,
);
