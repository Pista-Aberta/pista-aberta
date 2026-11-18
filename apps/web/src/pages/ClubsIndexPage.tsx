import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiX } from "../lib/api-complete";
import { useSession } from "../context/SessionContext";
import { homePathForRole } from "../lib/roles";

export function ClubsIndexPage() {
  const { slug: slugParam } = useParams();
  const slug = slugParam!;
  const { t } = useTranslation();
  const { user } = useSession();
  const [clubs, setClubs] = useState<Awaited<ReturnType<typeof apiX.clubs>>["data"]>([]);

  useEffect(() => {
    if (user?.role === "club_manager" && user.clubId) return;
    void apiX.clubs(slug).then((r) => setClubs(r.data)).catch(() => setClubs([]));
  }, [slug, user?.role, user?.clubId]);

  if (user?.role === "club_manager" && user.clubId) {
    return <Navigate to={homePathForRole("club_manager", slug, user.clubId)} replace />;
  }

  return (
    <main className="pa-page">
      <h1 className="pa-h1">{t("clubs.portal")}</h1>
      <p className="mt-2 text-sm text-graphite">{t("clubs.indexHint")}</p>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {clubs.map((c) => (
          <li key={c.id}>
            <Link to={`/c/${slug}/clubs/${c.id}`} className="pa-card block p-5 hover:border-ink">
              <strong className="text-lg">{c.name}</strong>
              <span className="mt-1 block text-sm text-graphite">{c.shortName}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
