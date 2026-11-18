/**
 * Tras un deploy, un `index.html` cacheado pode pedir chunks que xa non existen.
 * Recarga a páxina unha sola vez por pestana (sessionStorage).
 */
const FLAG = "pa-chunk-reload";

function isChunkLoadError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? `${err.name} ${err.message}`
      : typeof err === "string"
        ? err
        : String(err ?? "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk [\d]+ failed/i.test(
    msg,
  );
}

function reloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(FLAG) === "1") return false;
    sessionStorage.setItem(FLAG, "1");
  } catch {
    /* private mode — still try one reload via memory flag below */
  }
  window.location.reload();
  return true;
}

/** Hook global: unhandledrejection + error de script. */
export function installChunkReloadOnce(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("unhandledrejection", (ev) => {
    if (!isChunkLoadError(ev.reason)) return;
    if (reloadOnce()) {
      ev.preventDefault();
    }
  });

  window.addEventListener(
    "error",
    (ev) => {
      const target = ev.target;
      if (
        target instanceof HTMLScriptElement &&
        typeof target.src === "string" &&
        target.src.includes("/assets/")
      ) {
        reloadOnce();
        return;
      }
      if (isChunkLoadError(ev.error ?? ev.message)) {
        reloadOnce();
      }
    },
    true,
  );
}

/** Limpar a bandeira tras unha carga sa (o bundle actual funciona). */
export function clearChunkReloadFlag(): void {
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    /* ignore */
  }
}
