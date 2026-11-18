import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuthUser, Municipality } from "@pista-aberta/shared";
import { api } from "../lib/api";
import { applyMunicipalityTheme, clearMunicipalityTheme } from "../lib/theme";

interface SessionCtx {
  user: AuthUser | null;
  sessionExpiresAt: string | null;
  refreshUser: () => Promise<void>;
  renewSession: () => Promise<boolean>;
  logout: () => Promise<void>;
  municipality: Municipality | null;
  /** true cando /api/c/:slug/info devolveu 404 / erro. */
  municipalityMissing: boolean;
  setMunicipalitySlug: (slug: string | null) => void;
  loading: boolean;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);
  const [municipality, setMunicipality] = useState<Municipality | null>(null);
  const [municipalityMissing, setMunicipalityMissing] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const r = await api.me();
    setUser(r.user);
    setSessionExpiresAt(r.sessionExpiresAt ?? null);
  }, []);

  const renewSession = useCallback(async () => {
    try {
      const r = await api.renewSession();
      setUser(r.user);
      setSessionExpiresAt(r.sessionExpiresAt);
      return true;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    setSessionExpiresAt(null);
    /* REVISION-58 W12: limpar QR, borrador asistente e «Reservar en nome». */
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith("pa_qr_") || k === "pa_onboard_wizard_draft_v1")) {
          keys.push(k);
        }
      }
      for (const k of keys) localStorage.removeItem(k);
      const draftKeys: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (
          k &&
          (k.startsWith("pa_draft_book_for_") ||
            k === "pa_onboard_wizard_draft_v1")
        ) {
          draftKeys.push(k);
        }
      }
      for (const k of draftKeys) sessionStorage.removeItem(k);
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    void refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  useEffect(() => {
    if (!slug) {
      setMunicipality(null);
      setMunicipalityMissing(false);
      clearMunicipalityTheme();
      return;
    }
    /* Evita cabeceira/tema do concello anterior mentres carga o novo. */
    setMunicipality(null);
    setMunicipalityMissing(false);
    let cancelled = false;
    void api
      .info(slug)
      .then((r) => {
        if (cancelled) return;
        setMunicipality(r.data);
        setMunicipalityMissing(false);
        applyMunicipalityTheme(r.data);
      })
      .catch(() => {
        if (cancelled) return;
        setMunicipality(null);
        setMunicipalityMissing(true);
        clearMunicipalityTheme();
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const value = useMemo(
    () => ({
      user,
      sessionExpiresAt,
      refreshUser,
      renewSession,
      logout,
      municipality,
      municipalityMissing,
      setMunicipalitySlug: setSlug,
      loading,
    }),
    [
      user,
      sessionExpiresAt,
      refreshUser,
      renewSession,
      logout,
      municipality,
      municipalityMissing,
      loading,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession fora de SessionProvider");
  return ctx;
}
