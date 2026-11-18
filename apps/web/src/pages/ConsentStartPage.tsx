import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { apiX } from "../lib/api-complete";
import { useSession } from "../context/SessionContext";

/**
 * «Antes de comezar» (RXPD) — 3 viñetas + un só botón (REDESENO B3).
 */
export function ConsentStartPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") || `/c/${slug}`;
  const { t } = useTranslation();
  const { refreshUser } = useSession();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const accept = async () => {
    setBusy(true);
    setErr(null);
    try {
      await apiX.consent();
      await refreshUser();
      nav(returnTo.startsWith("/") ? returnTo : `/c/${slug}`, { replace: true });
    } catch {
      setErr(t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const bullets = [
    { title: t("consent.whatTitle"), body: t("consent.whatBody") },
    { title: t("consent.whyTitle"), body: t("consent.whyBody") },
    { title: t("consent.howLongTitle"), body: t("consent.howLongBody") },
  ] as const;

  return (
    <main className="pa-page mx-auto max-w-xl">
      <p className="text-sm font-bold uppercase tracking-wide text-graphite">
        {t("consent.eyebrow")}
      </p>
      <h1 className="pa-h1 mt-2">{t("consent.title")}</h1>
      <p className="mt-4 text-graphite">{t("consent.body")}</p>
      <ul className="mt-6 space-y-4">
        {bullets.map((b) => (
          <li key={b.title} className="rounded-card border border-line bg-white p-4">
            <strong className="block text-base">{b.title}</strong>
            <span className="mt-1 block text-sm text-graphite">{b.body}</span>
          </li>
        ))}
      </ul>
      {err && (
        <p className="mt-4 text-sm font-bold text-[var(--pa-danger)]" role="alert">
          {err}
        </p>
      )}
      <div className="mt-8">
        <button
          type="button"
          className="pa-btn-primary w-full sm:w-auto"
          disabled={busy}
          onClick={() => void accept()}
        >
          {t("consent.acceptContinue")}
        </button>
      </div>
    </main>
  );
}
