import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import {
  resolveSingleMuni,
  singleMuniSyncHint,
} from "../lib/single-muni";

/**
 * REVISION-22 A8 — con PA_SINGLE_MUNI, `/` → `/c/{slug}` e `/acceso` → `/c/{slug}/acceso`.
 */
export function SingleMuniRedirect({
  children,
  kind,
}: {
  children: ReactNode;
  kind: "home" | "acceso";
}) {
  const loc = useLocation();
  const hint = singleMuniSyncHint();
  const [slug, setSlug] = useState<string | null>(hint);

  useEffect(() => {
    let cancelled = false;
    void resolveSingleMuni().then((s) => {
      if (!cancelled) setSlug(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (slug) {
    const target =
      kind === "acceso"
        ? `/c/${slug}/acceso${loc.search || ""}`
        : `/c/${slug}${loc.search || ""}`;
    return <Navigate to={target} replace />;
  }

  return <>{children}</>;
}
