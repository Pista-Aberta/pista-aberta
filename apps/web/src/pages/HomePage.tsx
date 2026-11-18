import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Municipality } from "@pista-aberta/shared";
import { api } from "../lib/api";
import { BrandMark } from "../components/BrandMark";
import { ReadingPrefsAaControl } from "../components/ReadingPrefsAaControl";
import { ShieldMark } from "../components/ShieldMark";
import { GaliciaOutlineMap } from "../components/GaliciaOutlineMap";
import { readLastMuni, writeLastMuni, type LastMuni } from "../lib/acceso";
import { muniBadgeMeta } from "../lib/muni-meta";
import { municipalityCrestSrc } from "../lib/muni-logo";
import { clearMunicipalityTheme } from "../lib/theme";
import { REPO_URL, repoBlobUrl } from "../lib/repo-url";

const LANDING_URL =
  (import.meta.env.VITE_LANDING_URL as string | undefined)?.trim() ||
  "https://pistaaberta.com";

type MuniCard = {
  muni: Municipality;
  chips: string[];
  freeTomorrow: number | null;
};

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function isoTomorrow() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function chipForFacility(f: { type: string; name: string }, t: (k: string) => string): string {
  const n = stripAccents(f.name);
  if (n.includes("padel")) return t("home.chip.padel");
  if (n.includes("tenis")) return t("home.chip.tenis");
  if (n.includes("futbol") || f.type === "campo") {
    return t("home.chip.futbol");
  }
  if (f.type === "pavillon") return t("facilities.type.pavillon");
  if (f.type === "sala") return t("facilities.type.sala");
  if (f.type === "pista") return t("facilities.type.pista");
  const key = `facilities.type.${f.type}`;
  const label = t(key);
  return label === key ? f.type : label;
}

export function HomePage() {
  const { t } = useTranslation();
  const [munis, setMunis] = useState<Municipality[]>([]);
  const [cards, setCards] = useState<MuniCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [lastMuni, setLastMuni] = useState<LastMuni | null>(() =>
    typeof window === "undefined" ? null : readLastMuni(),
  );

  useEffect(() => {
    /* Portada de plataforma: mariño neutro, non a cor dun concello demo. */
    clearMunicipalityTheme();
    void api
      .municipalities()
      .then((r) => setMunis(r.data))
      .catch(() => setError(t("common.error")));
  }, [t]);

  useEffect(() => {
    if (munis.length === 0) {
      setCards([]);
      return;
    }
    const tomorrow = isoTomorrow();
    let cancelled = false;
    void Promise.all(
      munis.map(async (muni) => {
        let chips: string[] = [];
        let freeTomorrow: number | null = null;
        try {
          const fac = await api.facilities(muni.slug);
          const seen = new Set<string>();
          for (const f of fac.data) {
            const chip = chipForFacility(f, t);
            if (!seen.has(chip)) {
              seen.add(chip);
              chips.push(chip);
            }
          }
        } catch {
          chips = [];
        }
        try {
          const av = await api.availability(muni.slug, { date: tomorrow });
          freeTomorrow = av.data.filter((s) => s.status === "free").length;
        } catch {
          freeTomorrow = null;
        }
        return { muni, chips, freeTomorrow };
      }),
    ).then((rows) => {
      if (!cancelled) setCards(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [munis, t]);

  const filtered = useMemo(() => {
    const q = stripAccents(query.trim());
    if (!q) return cards;
    return cards.filter(
      (c) =>
        stripAccents(c.muni.name).includes(q) ||
        stripAccents(c.muni.slug).includes(q),
    );
  }, [cards, query]);

  const showNoMatch = query.trim().length > 0 && filtered.length === 0;

  const rememberAndGo = (slug: string, name: string) => {
    writeLastMuni(slug, name);
    setLastMuni({ slug, name });
  };

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      {/* ── Hero claro v3 ── */}
      <section className="pa-hero-v3 relative overflow-hidden">
        <header className="relative z-[2]">
          <div className="mx-auto flex h-[60px] max-w-[1200px] items-center gap-3 px-4 md:h-[76px] md:gap-4 md:px-8">
            <span className="flex items-center gap-2.5 text-marino">
              <BrandMark size={32} />
              <strong className="text-[17px] font-extrabold md:text-[19px]">
                {t("brand")}
              </strong>
            </span>
            <div className="ml-auto">
              <ReadingPrefsAaControl variant="onLight" />
            </div>
          </div>
        </header>

        <div className="relative mx-auto grid max-w-[1200px] items-center gap-8 px-4 pb-24 pt-6 md:grid-cols-2 md:gap-10 md:px-8 md:pb-[150px] md:pt-8">
          <div className="flex flex-col gap-4 md:gap-5">
            <h1 className="m-0 font-display text-[32px] font-extrabold leading-[1.06] tracking-[-0.02em] text-marino md:text-[56px] md:leading-[1.04] md:tracking-[-0.025em]">
              {t("home.pickMuniV2")}
            </h1>
            <p className="m-0 max-w-[500px] text-[15px] leading-relaxed text-hero-ink md:text-[19px]">
              <span className="md:hidden">{t("home.leadMobile")}</span>
              <span className="hidden md:inline">{t("home.lead")}</span>
            </p>

            {/* Desktop search in hero */}
            <label className="relative hidden max-w-[520px] md:block">
              <span className="sr-only">{t("home.searchLabel")}</span>
              <svg
                aria-hidden
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#4A5B6B"
                strokeWidth="2.2"
                className="pointer-events-none absolute left-[18px] top-[19px]"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("home.searchPh")}
                className="h-[60px] w-full rounded-2xl border-0 bg-white py-0 pl-[52px] pr-[18px] text-[18px] text-ink shadow-[0_24px_48px_-28px_rgba(0,0,0,.6)] outline-none focus-visible:ring-2 focus-visible:ring-azul focus-visible:ring-offset-2"
              />
            </label>

            {showNoMatch && (
              <div className="hidden max-w-[520px] rounded-[14px] border border-hero-line bg-surface px-4 py-3.5 text-[15px] text-hero-ink md:block">
                {t("home.noMatch", { q: query.trim() })}{" "}
                <a
                  href={LANDING_URL}
                  className="font-extrabold text-azul-700 underline"
                >
                  {t("home.propose")}
                </a>
              </div>
            )}

            {lastMuni && (
              <div className="hidden items-center gap-2.5 text-[15px] text-hero-ink md:flex">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  aria-hidden
                >
                  <path d="M12 8v4l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />
                </svg>
                <span>
                  {t("home.lastVisit")}{" "}
                  <Link
                    to={`/c/${lastMuni.slug}`}
                    onClick={() => rememberAndGo(lastMuni.slug, lastMuni.name)}
                    className="font-extrabold text-azul-700 underline"
                  >
                    {lastMuni.name}
                  </Link>
                </span>
              </div>
            )}
          </div>

          <div className="hidden justify-self-center md:block">
            <GaliciaOutlineMap
              activeSlugs={munis.map((m) => m.slug)}
              onPickActive={rememberAndGo}
            />
          </div>
        </div>
      </section>

      {/* ── Cards + secondary ── */}
      <main className="relative z-[1] mx-auto -mt-[70px] flex w-full max-w-[1200px] flex-col gap-3.5 px-3.5 pb-14 md:-mt-[100px] md:gap-7 md:px-8 md:pb-14">
        {/* Mobile search */}
        <label className="relative block md:hidden">
          <span className="sr-only">{t("home.searchLabel")}</span>
          <svg
            aria-hidden
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#4A5B6B"
            strokeWidth="2.2"
            className="pointer-events-none absolute left-4 top-[17px]"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("home.searchPh")}
            className="h-[54px] w-full rounded-2xl border-0 bg-white py-0 pl-[46px] pr-4 text-[17px] text-ink shadow-[0_20px_40px_-26px_rgba(0,43,74,.7)] outline-none focus-visible:ring-2 focus-visible:ring-azul focus-visible:ring-offset-2"
          />
        </label>

        {lastMuni && (
          <Link
            to={`/c/${lastMuni.slug}`}
            onClick={() => rememberAndGo(lastMuni.slug, lastMuni.name)}
            className="flex items-center gap-2.5 rounded-[14px] bg-[#FFF4DF] px-3.5 py-3 text-sm font-bold text-[#6B4100] no-underline md:hidden"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              aria-hidden
            >
              <path d="M12 8v4l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />
            </svg>
            {t("home.lastVisitMobile", { name: lastMuni.name })}
          </Link>
        )}

        {showNoMatch && (
          <div className="rounded-[14px] border border-line bg-white px-4 py-3.5 text-[15px] text-graphite md:hidden">
            {t("home.noMatch", { q: query.trim() })}{" "}
            <a href={LANDING_URL} className="font-extrabold text-azul-700 underline">
              {t("home.propose")}
            </a>
          </div>
        )}

        {error && (
          <div className="pa-warn-banner" role="alert">
            <span aria-hidden>⚠</span>
            <span>{error}</span>
          </div>
        )}

        <ul className="m-0 grid list-none gap-3.5 p-0 md:grid-cols-2 md:gap-[22px]">
          {filtered.map(({ muni, chips, freeTomorrow }) => {
            const initial = muni.name.replace(/^Concello de\s+/i, "").charAt(0) || "?";
            const badge = muniBadgeMeta(muni.slug, t);
            return (
              <li key={muni.id}>
                {/* Desktop card */}
                <Link
                  to={`/c/${muni.slug}`}
                  onClick={() => rememberAndGo(muni.slug, muni.name)}
                  className="group hidden flex-col overflow-hidden rounded-[24px] border border-line bg-white text-ink no-underline transition hover:-translate-y-0.5 hover:shadow-[0_26px_50px_-30px_rgba(0,43,74,.6)] md:flex"
                >
                  <div className="relative h-24 bg-gradient-to-br from-azul-25 to-[#F0F6FB]">
                    <svg
                      aria-hidden
                      width="200"
                      height="96"
                      viewBox="0 0 200 96"
                      className="absolute right-0 top-0 opacity-50"
                    >
                      <g fill="none" stroke="#9CC6E4" strokeWidth="2">
                        <rect x="20" y="10" width="170" height="100" rx="4" />
                        <path d="M105 10v100" />
                        <circle cx="105" cy="60" r="18" />
                      </g>
                    </svg>
                    <span className="absolute bottom-[-28px] left-6">
                      <ShieldMark
                        initial={initial}
                        size={56}
                        variant="onLight"
                        brandColor={muni.accentColor}
                        src={municipalityCrestSrc(muni)}
                        eager
                      />
                    </span>
                    {badge.tag && (
                      <span
                        className="absolute right-[18px] top-4 rounded-full px-2.5 py-1 text-xs font-extrabold"
                        style={{ background: badge.tagBg, color: badge.tagFg }}
                      >
                        {badge.tag}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-3 px-6 pb-[22px] pt-10">
                    <div className="flex flex-col gap-0.5">
                      <strong className="text-2xl font-extrabold text-marino">
                        {muni.name}
                      </strong>
                      <span className="text-[15px] text-graphite">{badge.province}</span>
                    </div>
                    {chips.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {chips.map((ch) => (
                          <span
                            key={ch}
                            className="rounded-[10px] bg-[#F0F6FB] px-2.5 py-1.5 text-[13px] font-bold text-[#3B4D5E]"
                          >
                            {ch}
                          </span>
                        ))}
                      </div>
                    )}
                    <span className="mt-1.5 flex items-center justify-between border-t border-[#E3EAF1] pt-3.5">
                      <span className="text-sm font-extrabold text-libre">
                        {freeTomorrow != null
                          ? t("home.freeTomorrow", { count: freeTomorrow, n: freeTomorrow })
                          : "\u00a0"}
                      </span>
                      <span className="flex items-center gap-2 font-extrabold text-azul-700">
                        {t("home.enter")}
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          aria-hidden
                        >
                          <path d="M5 12h14M13 6l6 6-6 6" />
                        </svg>
                      </span>
                    </span>
                  </div>
                </Link>

                {/* Mobile card */}
                <Link
                  to={`/c/${muni.slug}`}
                  onClick={() => rememberAndGo(muni.slug, muni.name)}
                  className="flex flex-col gap-3 rounded-[20px] border border-line bg-white p-4 text-ink no-underline md:hidden"
                >
                  <span className="flex items-center gap-3.5">
                    <ShieldMark
                      initial={initial}
                      size={44}
                      variant="onLight"
                      brandColor={muni.accentColor}
                      src={municipalityCrestSrc(muni)}
                      eager
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <strong className="truncate text-[19px] text-marino">{muni.name}</strong>
                      <span className="truncate text-[13px] text-graphite">{badge.province}</span>
                    </span>
                    {badge.tag && (
                      <span
                        className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold"
                        style={{ background: badge.tagBg, color: badge.tagFg }}
                      >
                        {badge.tag}
                      </span>
                    )}
                  </span>
                  {chips.length > 0 && (
                    <span className="flex flex-wrap gap-1.5">
                      {chips.map((ch) => (
                        <span
                          key={ch}
                          className="rounded-[10px] bg-[#F0F6FB] px-2 py-1 text-xs font-bold text-[#3B4D5E]"
                        >
                          {ch}
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="flex items-center justify-between border-t border-[#E3EAF1] pt-2.5">
                    <span className="text-[13px] font-extrabold text-libre">
                      {freeTomorrow != null
                        ? t("home.freeTomorrow", { count: freeTomorrow, n: freeTomorrow })
                        : "\u00a0"}
                    </span>
                    <span className="text-[15px] font-extrabold text-azul-700">
                      {t("home.enterArrow")}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-1 grid gap-2 md:mt-0 md:grid-cols-3 md:gap-4">
          <Link
            to="/acceso?perfil=persoal"
            className="flex min-h-[60px] items-center gap-3 rounded-2xl border border-line bg-white px-3.5 text-marino no-underline md:min-h-[72px] md:gap-3.5 md:px-5"
          >
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-azul-25 text-azul-700 md:h-11 md:w-11 md:rounded-xl"
              aria-hidden
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-5h6v5" />
              </svg>
            </span>
            <span className="flex flex-col gap-0.5">
              <strong className="text-[15px] md:text-base">{t("home.staff")}</strong>
              <span className="hidden text-sm text-graphite md:inline">
                {t("home.staffDesc")}
              </span>
            </span>
          </Link>
          <Link
            to="/deputacion"
            className="flex min-h-[60px] items-center gap-3 rounded-2xl border border-line bg-white px-3.5 text-marino no-underline md:min-h-[72px] md:gap-3.5 md:px-5"
          >
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-azul-25 text-azul-700 md:h-11 md:w-11 md:rounded-xl"
              aria-hidden
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span className="flex flex-col gap-0.5">
              <strong className="text-[15px] md:text-base">{t("home.onboardV2")}</strong>
              <span className="hidden text-sm text-graphite md:inline">
                {t("home.onboardDesc")}
              </span>
            </span>
          </Link>
          <Link
            to="/demo"
            className="flex min-h-[60px] items-center gap-3 rounded-2xl border border-line bg-white px-3.5 text-marino no-underline md:min-h-[72px] md:gap-3.5 md:px-5"
          >
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-azul-25 text-azul-700 md:h-11 md:w-11 md:rounded-xl"
              aria-hidden
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM20 17v4H6.5" />
              </svg>
            </span>
            <span className="flex flex-col gap-0.5">
              <strong className="text-[15px] md:text-base">{t("home.juryGuide")}</strong>
              <span className="hidden text-sm text-graphite md:inline">
                {t("home.juryGuideDesc")}
              </span>
            </span>
          </Link>
        </div>
      </main>

      <footer className="mt-auto border-t border-line bg-white">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3.5 px-4 py-[22px] text-sm text-graphite md:px-8">
          <nav aria-label={t("home.footerNav")} className="flex flex-wrap gap-[18px]">
            <a href={LANDING_URL} className="text-azul-700 no-underline hover:underline">
              {t("home.whatIs")}
            </a>
            <Link to="/legal/accesibilidade" className="text-azul-700 no-underline hover:underline">
              {t("legal.a11y")}
            </Link>
            <Link to="/legal/privacidade" className="text-azul-700 no-underline hover:underline">
              {t("legal.privacy")}
            </Link>
            {REPO_URL ? (
              <a
                href={REPO_URL}
                className="text-azul-700 no-underline hover:underline"
                rel="noopener noreferrer"
                target="_blank"
              >
                {t("nav.sourceCode")}
              </a>
            ) : null}
            {repoBlobUrl("docs/INSTALACION.md") ? (
              <a
                href={repoBlobUrl("docs/INSTALACION.md")}
                className="text-azul-700 no-underline hover:underline"
                rel="noopener noreferrer"
                target="_blank"
              >
                {t("nav.installDocs")}
              </a>
            ) : null}
            {repoBlobUrl("docs/OPERACION.md") ? (
              <a
                href={repoBlobUrl("docs/OPERACION.md")}
                className="text-azul-700 no-underline hover:underline"
                rel="noopener noreferrer"
                target="_blank"
              >
                {t("nav.opsDocs")}
              </a>
            ) : null}
            {repoBlobUrl("LICENSE") ? (
              <a
                href={repoBlobUrl("LICENSE")}
                className="text-azul-700 no-underline hover:underline"
                rel="noopener noreferrer"
                target="_blank"
              >
                {t("nav.license")}
              </a>
            ) : null}
          </nav>
          <span>{t("home.eupl")}</span>
        </div>
      </footer>
    </div>
  );
}
