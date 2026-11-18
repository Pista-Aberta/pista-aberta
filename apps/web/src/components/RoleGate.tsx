import type { ReactNode } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Role } from "@pista-aberta/shared";
import { useSession } from "../context/SessionContext";
import {
  elevatedBelongsToSlug,
  homePathForRole,
  isElevatedRole,
} from "../lib/roles";
import { EmptyState } from "./EmptyState";

export function RoleGate({
  allow,
  children,
  title,
}: {
  allow: Role[];
  children: ReactNode;
  title?: string;
}) {
  const { user, loading } = useSession();
  const { slug } = useParams();
  const loc = useLocation();
  const { t } = useTranslation();

  if (loading) {
    return (
      <main className="pa-page">
        <p className="text-graphite">{t("common.loading")}</p>
      </main>
    );
  }

  if (!slug) {
    return <Navigate to="/" replace />;
  }

  if (!user) {
    const pageTitle = title ?? t("nav.login");
    return (
      <main className="pa-page">
        <h1 className="pa-h1">{pageTitle}</h1>
        <EmptyState
          body={t("auth.needLogin")}
          actionLabel={t("nav.login")}
          actionTo={`/c/${slug}/acceso?returnTo=${encodeURIComponent(loc.pathname)}`}
        />
      </main>
    );
  }

  const userSlug = user.municipalitySlug ?? slug;

  if (!allow.includes(user.role)) {
    return (
      <Navigate
        to={homePathForRole(user.role, userSlug, user.clubId)}
        replace
      />
    );
  }

  /* REVISION-19 B5: persoal doutro concello → o seu panel, sen barra allea. */
  if (
    isElevatedRole(user.role) &&
    !elevatedBelongsToSlug(userSlug, slug, user.role)
  ) {
    return (
      <Navigate
        to={homePathForRole(user.role, userSlug, user.clubId)}
        replace
      />
    );
  }

  return <>{children}</>;
}
