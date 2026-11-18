import { fetchPublicConfig } from "./public-config";

/** Cliente: VITE_PA_DEMO ou flag público da API. */
export function isDemoBuildFlag(): boolean {
  const v = import.meta.env.VITE_PA_DEMO;
  return v === "1" || v === "true";
}

let demoConfigPromise: Promise<boolean> | null = null;

/** Demo activa (build ou /api/config demo:true). */
export async function resolveDemoMode(): Promise<boolean> {
  if (isDemoBuildFlag()) return true;
  if (!demoConfigPromise) {
    demoConfigPromise = fetchPublicConfig().then((c) => !!c.demo);
  }
  return demoConfigPromise;
}
