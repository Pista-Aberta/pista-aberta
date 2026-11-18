import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import paths from "../data/galicia-outline-paths.json";
import meta from "../data/galicia-outline-meta.json";

type PathMeta = {
  ine: string;
  name: string;
  slug: string | null;
  facilityCount: number;
};

const META = meta as PathMeta[];

const FILL_IDLE = "#FFFFFF";
const FILL_HOVER = "#CFE6F7";
const FILL_ACTIVE = "#F2B33D";
const STROKE = "#9BB8D0";

const LANDING_URL =
  (import.meta.env.VITE_LANDING_URL as string | undefined)?.trim() ||
  "https://pistaaberta.com";

/** Mapa claro v3: concellos activos en ámbar, o resto branco, tarxeta Propóñello. */
export function GaliciaOutlineMap({
  className = "",
  activeSlugs = ["exemplo"],
  onPickActive,
}: {
  className?: string;
  activeSlugs?: string[];
  onPickActive?: (slug: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);

  const activeIdx = useMemo(() => {
    const set = new Set(activeSlugs);
    const idx = new Set<number>();
    META.forEach((m, i) => {
      if (m.slug && set.has(m.slug)) idx.add(i);
    });
    return idx;
  }, [activeSlugs]);

  const activeNames = useMemo(() => {
    const names: string[] = [];
    for (const slug of activeSlugs) {
      const m = META.find((row) => row.slug === slug);
      const raw = m?.name?.trim() || slug;
      names.push(raw.replace(/^Concello de\s+/i, "") || raw);
    }
    return names;
  }, [activeSlugs]);

  const activeNamesLabel = useMemo(() => {
    if (activeNames.length === 0) return "";
    if (activeNames.length === 1) return activeNames[0]!;
    if (activeNames.length === 2) {
      return `${activeNames[0]} e ${activeNames[1]}`;
    }
    return `${activeNames.slice(0, -1).join(", ")} e ${activeNames[activeNames.length - 1]}`;
  }, [activeNames]);

  const selected = sel != null ? META[sel] : null;
  const selectedActive =
    selected?.slug != null && activeSlugs.includes(selected.slug);

  const hoverLabel =
    hover != null
      ? `${META[hover]?.name ?? ""} · ${META[hover]?.facilityCount ?? 0}`
      : null;

  return (
    <div className={`relative w-full max-w-[470px] ${className}`}>
      {hoverLabel ? (
        <div className="absolute left-2.5 top-1.5 z-[2] rounded-[10px] bg-white px-3 py-2 text-sm font-bold text-marino shadow-[0_12px_24px_-16px_rgba(0,43,74,.5)]">
          {hoverLabel} {t("home.mapInstSuffix")}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[20px]">
        <svg
          viewBox="0 0 600 632"
          className="block w-full"
          role="img"
          aria-label={t("home.mapAria", {
            names: activeNamesLabel || "…",
            defaultValue: `Mapa dos concellos de Galicia; ${activeNamesLabel || "…"} usa Pista Aberta na demo`,
          })}
        >
          {(paths as string[]).map((d, i) => {
            const isActive = activeIdx.has(i);
            const isHover = hover === i;
            const isSel = sel === i;
            let fill = FILL_IDLE;
            if (isActive) fill = FILL_ACTIVE;
            else if (isSel || isHover) fill = FILL_HOVER;
            return (
              <path
                key={i}
                d={d}
                fill={fill}
                stroke={STROKE}
                strokeWidth={isActive ? 1.2 : 0.6}
                vectorEffect="non-scaling-stroke"
                className="cursor-pointer transition-[fill] duration-200"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setSel(i)}
              />
            );
          })}
          {/* Pin Exemplo */}
          <circle
            className="pa-map-pulse origin-center pointer-events-none"
            cx={101}
            cy={316}
            r={6}
            fill="none"
            stroke="#F2B33D"
            strokeWidth={3}
          />
          <circle
            cx={101}
            cy={316}
            r={8}
            fill="#F2B33D"
            stroke="#FFFFFF"
            strokeWidth={2.5}
            className="cursor-pointer"
            onClick={() => {
              const i = META.findIndex((m) => m.slug === (activeNames[0] ?? "exemplo"));
              if (i >= 0) setSel(i);
            }}
          />
        </svg>
      </div>

      <div className="relative mt-[-10px] flex items-center gap-3.5 rounded-[18px] border border-[#CFE3F2] bg-white px-[18px] py-4 shadow-[0_18px_36px_-26px_rgba(0,43,74,.55)]">
        {!selected ? (
          <span className="flex items-center gap-3 text-[15px] text-hero-ink">
            <span
              aria-hidden
              className="h-3 w-3 flex-none rounded-full bg-[#F2B33D]"
            />
            <span>
              <strong className="text-marino">
                {activeNamesLabel || "…"}
              </strong>{" "}
              {t(
                activeNames.length === 1
                  ? "home.mapIdleHint"
                  : "home.mapIdleHint_other",
                {
                  count: activeNames.length,
                  defaultValue:
                    activeNames.length === 1
                      ? "usa Pista Aberta nesta demo. Toca calquera concello para ver as súas instalacións."
                      : "usan Pista Aberta nesta demo. Toca calquera concello para ver as súas instalacións.",
                },
              )}
            </span>
          </span>
        ) : selectedActive && selected.slug ? (
          <>
            <span className="flex flex-1 flex-col gap-0.5">
              <strong className="text-lg text-marino">{selected.name}</strong>
              <span className="text-sm font-bold text-[#0E6B4D]">
                {t("home.mapActiveHint", {
                  count: selected.facilityCount,
                  n: selected.facilityCount,
                })}
              </span>
            </span>
            <Link
              to={`/c/${selected.slug}`}
              onClick={() => onPickActive?.(selected.slug!, selected.name)}
              className="flex h-12 items-center rounded-xl bg-azul px-[18px] font-extrabold text-white no-underline hover:bg-azul-700"
            >
              {t("home.mapEnter")}
            </Link>
          </>
        ) : (
          <>
            <span className="flex flex-1 flex-col gap-0.5">
              <strong className="text-lg text-marino">{selected.name}</strong>
              <span className="text-sm text-hero-ink">
                {t("home.mapOtherHint", {
                  count: selected.facilityCount,
                  n: selected.facilityCount,
                })}
              </span>
            </span>
            <a
              href={`${LANDING_URL}#mapa`}
              className="flex h-12 shrink-0 items-center whitespace-nowrap rounded-xl border-[1.5px] border-[#F2B33D] bg-[#FFF4DF] px-4 font-extrabold text-[#6B4100] no-underline"
            >
              {t("home.propose")}
            </a>
          </>
        )}
      </div>
    </div>
  );
}
