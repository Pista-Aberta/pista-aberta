import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { ReadingPrefsAaControl } from "../components/ReadingPrefsAaControl";

export function OnboardPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [color, setColor] = useState("#3D4A3A");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const { data } = await api.createMunicipality({
        name,
        slug: slug || name.toLowerCase().replace(/\s+/g, "-"),
        accentColor: color,
      });
      nav(`/c/${data.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    }
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-4">
          <Link to="/" className="font-bold">
            {t("brand")}
          </Link>
          <ReadingPrefsAaControl variant="onLight" />
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-10">
        <h1 className="pa-h1">{t("onboard.title")}</h1>
        <p className="mt-2 text-graphite">{t("onboard.hint")}</p>
        <form onSubmit={(e) => void submit(e)} className="mt-8 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("onboard.name")}
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="pa-input min-h-12"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("onboard.slug")}
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="o-meu-concello"
              className="pa-input min-h-12"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-bold">
            {t("onboard.color")}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-12 w-24"
            />
          </label>
          <button type="submit" className="pa-btn-primary h-14">
            {t("onboard.submit")}
          </button>
        </form>
        {error && (
          <div className="pa-warn-banner mt-4" role="alert">
            <span aria-hidden>⚠</span>
            <span>{error}</span>
          </div>
        )}
      </main>
    </div>
  );
}
