import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import { resolveSingleMuni, singleMuniSyncHint } from "../lib/single-muni";

/** Vista Deputación: require sesión con rol superadmin (persoa demo «Deputación»). */
export function DeputacionGate({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const [singleMuni, setSingleMuni] = useState<string | null>(singleMuniSyncHint());

  useEffect(() => {
    void resolveSingleMuni().then(setSingleMuni);
  }, []);

  /* REVISION-22 A8 — sen Deputación en instalación dun só concello. */
  if (singleMuni) {
    return <Navigate to={`/c/${singleMuni}`} replace />;
  }

  if (loading) {
    return (
      <main className="pa-page">
        <p className="text-graphite">…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="pa-page max-w-lg">
        <h1 className="pa-h1">Vista Deputación</h1>
        <p className="mt-2 text-graphite">
          Esta vista compara concellos adheridos e permite dar de alta un concello novo.
          Precisas entrar co perfil «Deputación».
        </p>
        <Link
          to={`/acceso?returnTo=${encodeURIComponent("/deputacion")}`}
          className="pa-btn-primary mt-6 inline-flex"
        >
          Acceder
        </Link>
        <Link to="/" className="pa-btn-secondary mt-3 inline-flex">
          Inicio
        </Link>
      </main>
    );
  }

  if (user.role !== "superadmin") {
    return (
      <main className="pa-page max-w-lg">
        <h1 className="pa-h1">Vista Deputación</h1>
        <p className="mt-2 text-graphite">
          O teu perfil non ten acceso a esta vista. En demo, escolle «Deputación» na
          barra amarela.
        </p>
        <Link to="/" className="pa-btn-primary mt-6 inline-flex">
          Inicio
        </Link>
      </main>
    );
  }

  return <>{children}</>;
}
