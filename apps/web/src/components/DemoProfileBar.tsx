import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import type { Municipality } from "@pista-aberta/shared";
import { resolveDemoMode } from "../lib/demo-mode";
import { demoSamlLoginAs } from "../lib/demo-saml-login";
import { demoPersonaKey } from "../lib/demo-defaults";
import { resolveDemoClubRelayPath } from "../lib/demo-club-relay";
import { homePathForRole } from "../lib/roles";
import { resolveSingleMuni, singleMuniSyncHint } from "../lib/single-muni";
import { fetchPublicConfig } from "../lib/public-config";
import { api } from "../lib/api";
import { writeLastMuni } from "../lib/acceso";

const PERSONAS: {
  key: "cidada" | "admin" | "club" | "staff" | "deputacion";
  labelKey: string;
}[] = [
  { key: "cidada", labelKey: "demo.bar.vecina" },
  { key: "admin", labelKey: "demo.bar.concello" },
  { key: "club", labelKey: "demo.bar.club" },
  { key: "staff", labelKey: "demo.bar.staff" },
  { key: "deputacion", labelKey: "demo.bar.deputacion" },
];

const API = import.meta.env.VITE_API_URL ?? "";

async function resolveClubRelay(slug: string): Promise<string> {
  const cfg = await fetchPublicConfig();
  const clubName = cfg.demoClub?.clubName ?? null;
  const targetSlug = cfg.demoClub?.municipalitySlug || slug;
  try {
    const r = await fetch(`${API}/api/c/${targetSlug}/pavillon`, {
      credentials: "include",
    });
    if (!r.ok) {
      return resolveDemoClubRelayPath(targetSlug, clubName, []);
    }
    const json = (await r.json()) as {
      data?: { clubs?: Array<{ id: string; name: string; shortName?: string }> };
    };
    return resolveDemoClubRelayPath(
      targetSlug,
      clubName,
      json.data?.clubs ?? [],
    );
  } catch {
    return resolveDemoClubRelayPath(targetSlug, clubName, []);
  }
}

function shortMuniName(name: string): string {
  return name.replace(/^Concello de\s+/i, "") || name;
}

/** Perfil activo estimado a partir da URL. */
function profileFromPath(
  pathname: string,
): "cidada" | "admin" | "club" | "staff" | "deputacion" {
  if (pathname.startsWith("/deputacion")) return "deputacion";
  if (/\/admin(\/|$)/.test(pathname)) return "admin";
  if (/\/clubs(\/|$)/.test(pathname)) return "club";
  if (/\/conserxeria(\/|$)/.test(pathname)) return "staff";
  return "cidada";
}

export function DemoProfileBar() {
  const loc = useLocation();
  const { t } = useTranslation();
  const [visible, setVisible] = useState(isDemoBuildSync());
  const [singleMuni, setSingleMuni] = useState<string | null>(singleMuniSyncHint());
  const [munis, setMunis] = useState<Municipality[]>([]);
  const slug = loc.pathname.match(/^\/c\/([^/]+)/)?.[1] ?? null;
  const activeProfile = profileFromPath(loc.pathname);

  function isDemoBuildSync(): boolean {
    const v = import.meta.env.VITE_PA_DEMO;
    return v === "1" || v === "true";
  }

  useEffect(() => {
    void resolveSingleMuni().then(setSingleMuni);
  }, []);

  useEffect(() => {
    void api
      .municipalities()
      .then((r) => setMunis(r.data.filter((m) => !m.settings?.sandbox)))
      .catch(() => setMunis([]));
  }, []);

  useEffect(() => {
    /* REVISION-22 A8 — sen barra demo en modo un só concello. */
    if (singleMuni) {
      setVisible(false);
      return;
    }
    if (isDemoBuildSync()) {
      setVisible(true);
      return;
    }
    void resolveDemoMode().then(setVisible);
  }, [singleMuni]);

  if (!visible || singleMuni) return null;

  const demoMunis = munis.filter(
    (m) => !m.slug.startsWith("_") && m.slug !== "deputacion" && (munis.length <= 3 || true),
  );
  const switcherMunis =
    demoMunis.length >= 2
      ? demoMunis
      : munis.slice(0, 2);

  function loginAs(
    persona: "cidada" | "admin" | "club" | "staff" | "deputacion",
    targetSlug: string | null,
  ) {
    void (async () => {
      let key = demoPersonaKey(persona, targetSlug);
      /* Sen conta nese concello (ex. club en Porto) → veciña. */
      if (key == null && persona !== "deputacion" && targetSlug) {
        key = demoPersonaKey("cidada", targetSlug);
        persona = "cidada";
      }
      if (!key) return;

      let relay: string;
      if (persona === "deputacion") {
        relay = "/deputacion";
      } else if (persona === "club") {
        const clubSlug =
          targetSlug ??
          (await fetchPublicConfig()).demoClub?.municipalitySlug ??
          null;
        relay = clubSlug ? await resolveClubRelay(clubSlug) : "/deputacion";
      } else if (targetSlug) {
        relay = homePathForRole(
          persona === "cidada"
            ? "citizen"
            : persona === "admin"
              ? "admin"
              : persona === "staff"
                ? "staff"
                : "superadmin",
          targetSlug,
        );
      } else {
        relay = loc.pathname;
      }
      if (targetSlug) {
        const m = munis.find((x) => x.slug === targetSlug);
        writeLastMuni(targetSlug, m?.name ?? targetSlug);
      }
      demoSamlLoginAs(key, relay);
    })();
  }

  return (
    <div
      className="relative z-[90] max-w-full overflow-x-clip border-b border-[#E8C56A] bg-[#FFF4DF] px-3 py-2 text-[13px] text-[#3B2A0F] md:text-sm"
      role="region"
      aria-label={t("demo.bar.aria")}
    >
      <div className="mx-auto flex max-w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-1">
        <span className="font-extrabold">{t("demo.bar.title")}</span>
        <span className="text-[#8A5300]" aria-hidden>
          ·
        </span>
        <a
          href="/correo/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-6 min-w-0 max-w-full items-center break-words font-extrabold text-azul-700 underline decoration-azul-700/40 underline-offset-2"
        >
          {t("demo.mailLink")}
        </a>

        {switcherMunis.length >= 2 ? (
          <>
            <span className="text-[#8A5300]" aria-hidden>
              ·
            </span>
            <span className="shrink-0 font-extrabold">
              {t("demo.bar.concelloLabel")}
            </span>
            <span className="inline-flex max-w-full flex-wrap items-center justify-center gap-1">
              {switcherMunis.map((m, i) => {
                const active = slug === m.slug;
                const label = shortMuniName(m.name);
                return (
                  <span key={m.slug} className="inline-flex items-center gap-1">
                    {i > 0 ? (
                      <span className="text-[#8A5300]/70" aria-hidden>
                        |
                      </span>
                    ) : null}
                    <button
                      type="button"
                      aria-current={active ? "true" : undefined}
                      className={
                        active
                          ? "inline-flex min-h-6 items-center font-extrabold text-[#3B2A0F]"
                          : "inline-flex min-h-6 items-center font-extrabold text-azul-700 underline decoration-azul-700/40 underline-offset-2 hover:decoration-azul-700"
                      }
                      onClick={() => {
                        if (active) return;
                        loginAs(activeProfile, m.slug);
                      }}
                    >
                      {label}
                    </button>
                  </span>
                );
              })}
            </span>
          </>
        ) : null}

        <span className="text-[#8A5300]" aria-hidden>
          ·
        </span>
        <span className="shrink-0">{t("demo.bar.change")}</span>
        <span className="inline-flex max-w-full flex-wrap items-center justify-center gap-1">
          {PERSONAS.map((p, i) => {
            const persona = demoPersonaKey(p.key, slug);
            const disabled = persona == null && p.key !== "club";

            return (
              <span key={p.key} className="inline-flex items-center gap-1">
                {i > 0 ? (
                  <span className="text-[#8A5300]/70" aria-hidden>
                    /
                  </span>
                ) : null}
                <button
                  type="button"
                  disabled={disabled && p.key !== "club"}
                  title={
                    disabled && p.key !== "club"
                      ? t("demo.bar.noPersona")
                      : undefined
                  }
                  className={
                    disabled && p.key !== "club"
                      ? "inline-flex min-h-6 min-w-6 cursor-not-allowed items-center font-extrabold text-graphite line-through opacity-50"
                      : "inline-flex min-h-6 min-w-6 items-center font-extrabold text-azul-700 underline decoration-azul-700/40 underline-offset-2 hover:decoration-azul-700"
                  }
                  onClick={() => loginAs(p.key, slug)}
                >
                  {t(p.labelKey)}
                </button>
              </span>
            );
          })}
        </span>
      </div>
    </div>
  );
}
