import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Municipality } from "@pista-aberta/shared";
import { api } from "../lib/api";
import { accesoPath, readLastMuni, writeLastMuni } from "../lib/acceso";
import { formatDemoLoginNotice } from "../lib/demo-login-notice";
import { BrandMark } from "../components/BrandMark";
import { ReadingPrefsAaControl } from "../components/ReadingPrefsAaControl";
import { ShieldMark } from "../components/ShieldMark";
import { municipalityCrestSrc } from "../lib/muni-logo";

/**
 * «Onde queres entrar?» — /acceso sen concello (REVISION-15 L1).
 * perfil=persoal: lista concellos (último usado primeiro, marcado);
 * se só hai un, entra directo. Outros perfís: redirixe ao último se existe.
 */
export function AccesoPickPage({
  perfil,
}: {
  perfil?: "vecina" | "entidade" | "persoal";
}) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const perfilQ =
    perfil ??
    (params.get("perfil") === "entidade"
      ? "entidade"
      : params.get("perfil") === "persoal"
        ? "persoal"
        : undefined);
  const erroParam = params.get("erro");
  const last = readLastMuni();
  const [munis, setMunis] = useState<Municipality[] | null>(null);

  useEffect(() => {
    void api.municipalities().then((r) => setMunis(r.data));
  }, []);

  const ordered = useMemo(() => {
    if (!munis) return null;
    if (!last?.slug) return munis;
    const first = munis.find((m) => m.slug === last.slug);
    const rest = munis.filter((m) => m.slug !== last.slug);
    return first ? [first, ...rest] : munis;
  }, [munis, last?.slug]);

  /* persoal: só auto-entrar se hai exactamente un concello. */
  if (perfilQ === "persoal" && munis && munis.length === 1 && !erroParam) {
    const only = munis[0]!;
    return (
      <Navigate
        to={accesoPath(only.slug, {
          perfil: "persoal",
          returnTo: `/c/${only.slug}/admin`,
        })}
        replace
      />
    );
  }

  /* Outros perfís: último concello gardado (comportamento histórico). */
  if (perfilQ !== "persoal" && last?.slug && !erroParam) {
    return (
      <Navigate
        to={accesoPath(last.slug, {
          perfil: perfilQ,
        })}
        replace
      />
    );
  }

  const title =
    perfilQ === "persoal"
      ? t("login.whereTitlePersoal")
      : t("login.whereTitle");
  const lead =
    perfilQ === "persoal"
      ? t("login.whereLeadPersoal")
      : t("login.whereLead");

  return (
    <div className="flex min-h-screen flex-col bg-paper px-4 py-8 text-ink md:px-8">
      <div className="mx-auto flex w-full max-w-[480px] flex-col items-center gap-6 text-center">
        <div className="flex w-full items-center gap-3">
          <Link
            to="/"
            className="font-bold text-azul-700 no-underline hover:underline"
          >
            ← {t("nav.home")}
          </Link>
          <div className="ml-auto">
            <ReadingPrefsAaControl variant="onLight" />
          </div>
        </div>

        <Link
          to="/"
          className="flex flex-col items-center gap-2 text-marino no-underline"
          aria-label={t("brand")}
        >
          <BrandMark size={48} />
          <strong className="font-display text-xl font-extrabold tracking-[-0.02em]">
            {t("brand")}
          </strong>
        </Link>

        <h1 className="pa-h1 m-0" data-testid="acceso-pick-title">
          {title}
        </h1>
        <p className="m-0 text-base text-graphite">{lead}</p>

        {erroParam === "concello_non_creado" || erroParam === "concello" ? (
          <div
            className="pa-warn-banner w-full text-left"
            role="alert"
            data-testid="acceso-erro-banner"
          >
            <span aria-hidden>⚠</span>
            <span>
              {erroParam === "concello_non_creado"
                ? formatDemoLoginNotice(t, "concello_non_creado")
                : t("login.erroConcello")}
            </span>
          </div>
        ) : null}

        {!ordered ? (
          <p className="text-graphite">{t("common.loading")}</p>
        ) : (
          <ul className="m-0 flex w-full list-none flex-col gap-2 p-0 text-left">
            {ordered.map((m) => {
              const short = m.name.replace(/^Concello de\s+/i, "") || m.name;
              const initial = short.charAt(0) || "P";
              const isLast = last?.slug === m.slug;
              const to = accesoPath(m.slug, {
                perfil: perfilQ,
                returnTo:
                  perfilQ === "persoal" ? `/c/${m.slug}/admin` : undefined,
              });
              return (
                <li key={m.slug}>
                  <Link
                    to={to}
                    onClick={() => writeLastMuni(m.slug, m.name)}
                    className={`flex min-h-[64px] items-center gap-3 rounded-2xl border bg-white px-4 text-ink no-underline transition hover:border-azul ${
                      isLast
                        ? "border-azul ring-2 ring-azul/25"
                        : "border-line"
                    }`}
                    data-testid={`acceso-pick-${m.slug}`}
                    aria-current={isLast ? "true" : undefined}
                  >
                    <ShieldMark
                      initial={initial}
                      size={40}
                      src={municipalityCrestSrc(m)}
                      variant="onLight"
                      brandColor={m.accentColor}
                      eager
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <strong className="text-[17px]">{m.name}</strong>
                      {isLast ? (
                        <span className="text-[13px] font-bold text-azul-700">
                          {t("login.lastUsedMuni")}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
