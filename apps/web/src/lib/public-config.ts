const API = import.meta.env.VITE_API_URL ?? "";

export type PublicConfig = {
  certLogin?: boolean;
  samlLogin?: boolean;
  certOrigin?: string | null;
  appBaseUrl?: string | null;
  demo?: boolean;
  /** PA_DEMO_EMPTY=1 — sen reservas/listas de espera da semente. */
  demoEmpty?: boolean;
  /** Conta club de DEMO_USERS_FILE (se existe). */
  demoClub?: { municipalitySlug: string; clubName: string } | null;
  /** REVISION-22 A8 — slug do único concello, ou null/ausente. */
  singleMuni?: string | null;
};

let cached: PublicConfig | null = null;

export async function fetchPublicConfig(): Promise<PublicConfig> {
  if (cached) return cached;
  try {
    const r = await fetch(`${API}/api/config`, { credentials: "include" });
    if (!r.ok) return {};
    cached = (await r.json()) as PublicConfig;
    return cached;
  } catch {
    return {};
  }
}

/** Host público para cartel QR / marca (sen protocolo). */
export function displayHost(cfg: PublicConfig): string {
  const base = cfg.appBaseUrl?.trim();
  if (base) {
    try {
      return new URL(base).host;
    } catch {
      /* fallthrough */
    }
  }
  if (typeof window !== "undefined" && window.location?.host) {
    return window.location.host;
  }
  return "demo.pistaaberta.com";
}
