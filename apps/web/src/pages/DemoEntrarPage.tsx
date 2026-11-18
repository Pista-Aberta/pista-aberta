import { useEffect, useRef } from "react";
import { Navigate, useParams } from "react-router-dom";
import { isDemoBuildFlag } from "../lib/demo-mode";
import { demoSamlLoginAs } from "../lib/demo-saml-login";
import {
  demoEntrarRelay,
  demoEntrarUserKey,
  normalizeDemoEntrarPerfil,
} from "../lib/demo-entrar";

/**
 * Atallo da landing: `/entrar/:slug/:perfil` → login SAML demo nun clic.
 * Mesmo switch de sesión que DemoProfileBar (forza SAML mock, RelayState co slug).
 * Acepta alias (`cidada`, `admin`, `staff`…) ademais dos perfís canónicos.
 * Só con VITE_PA_DEMO; fóra da demo → `/`.
 */
export function DemoEntrarPage() {
  const { slug = "", perfil = "" } = useParams<{
    slug: string;
    perfil: string;
  }>();
  const started = useRef(false);

  const demo = isDemoBuildFlag();
  const slugOk = /^[a-z0-9-]+$/.test(slug);
  const perfilNorm = normalizeDemoEntrarPerfil(perfil);

  useEffect(() => {
    if (!demo || !slugOk || !perfilNorm || started.current) return;
    const userKey = demoEntrarUserKey(slug, perfilNorm);
    if (!userKey) return;
    started.current = true;
    const relay = demoEntrarRelay(slug, perfilNorm);
    /* POST completo ao IdP (como a barra): substitúe a sesión actual. */
    demoSamlLoginAs(userKey, relay);
  }, [demo, slugOk, perfilNorm, slug]);

  if (!demo) return <Navigate to="/" replace />;
  if (!slugOk || !perfilNorm) return <Navigate to="/" replace />;

  const userKey = demoEntrarUserKey(slug, perfilNorm);
  if (!userKey) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="pa-page mx-auto max-w-lg px-4 py-16 text-center">
      <p className="text-graphite" role="status">
        Entrando na demo…
      </p>
    </main>
  );
}
