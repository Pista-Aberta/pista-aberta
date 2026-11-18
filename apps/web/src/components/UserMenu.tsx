import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { AuthUser, Role } from "@pista-aberta/shared";
import { useSession } from "../context/SessionContext";
import { accesoPath } from "../lib/acceso";
import { homePathForRole } from "../lib/roles";
import { api } from "../lib/api";

export type UserMenuTone = "light" | "brand";

function roleLabelKey(role: Role): string {
  switch (role) {
    case "citizen":
      return "userMenu.role.citizen";
    case "admin":
      return "userMenu.role.admin";
    case "staff":
    case "monitor":
      return "userMenu.role.staff";
    case "club_manager":
      return "userMenu.role.club";
    case "superadmin":
      return "userMenu.role.deputacion";
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

function accountPath(user: AuthUser, slug: string): string {
  switch (user.role) {
    case "club_manager":
      return user.clubId
        ? `/c/${slug}/clubs/${user.clubId}/datos`
        : `/c/${slug}/clubs`;
    case "superadmin":
      return `/deputacion`;
    case "admin":
      return `/c/${slug}/admin/conta`;
    case "staff":
    case "monitor":
      return `/c/${slug}/conserxeria/conta`;
    case "citizen":
      return `/c/${slug}/conta`;
    default: {
      const _exhaustive: never = user.role;
      return _exhaustive;
    }
  }
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Menú de usuario común (REVISION-15 L3).
 * Premer o avatar abre o menú; NUNCA pecha a sesión.
 * REVISION-42 Q4: só iniciais no disparador; «Saír» só dentro do menú.
 */
export function UserMenu({
  tone = "light",
  forceSlug,
}: {
  tone?: UserMenuTone;
  /** Deputación ou forzados sen slug na URL. */
  forceSlug?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout, municipality, refreshUser } = useSession();
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{
    mobile: boolean;
    top: number;
    left?: number;
    right?: number;
  }>({ mobile: false, top: 64 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const slug =
    forceSlug ||
    user?.municipalitySlug ||
    municipality?.slug ||
    null;

  const close = useCallback(() => {
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // REVISION-21 L3: no móbil o menú é fixed a ancho completo; no PC nunca sae do ecrán.
  useEffect(() => {
    const sync = () => {
      const mobile = window.matchMedia("(max-width: 767px)").matches;
      const trigger = triggerRef.current;
      const top = trigger
        ? Math.round(trigger.getBoundingClientRect().bottom + 8)
        : 64;
      if (mobile) {
        setMenuPos({ mobile: true, top, left: 16, right: 16 });
        return;
      }
      const r = trigger?.getBoundingClientRect();
      const menuWidth = 260;
      let left = r ? Math.round(r.right - menuWidth) : 16;
      if (left < 16) left = 16;
      if (left + menuWidth > window.innerWidth - 16) {
        left = Math.max(16, window.innerWidth - 16 - menuWidth);
      }
      setMenuPos({ mobile: false, top, left });
    };
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [open]);

  // REVISION-16 N7: ao abrir, foco no primeiro menuitem.
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      const first = rootRef.current?.querySelector<HTMLElement>(
        '[role="menuitem"]',
      );
      first?.focus();
    });
  }, [open]);

  if (!user) return null;

  const muniName =
    municipality?.name ??
    (slug ? `Concello` : t("brand"));
  // Deputación non é dun concello: «Deputación · só lectura».
  const roleLine =
    user.role === "superadmin"
      ? `${t(roleLabelKey(user.role))} · ${t("deputacion.readOnly")}`
      : `${t(roleLabelKey(user.role))} · ${muniName}`;
  const initials = initialsOf(user.displayName || "?");
  const light = tone === "light";

  const doLogout = async () => {
    setOpen(false);
    await logout();
    // Deputación: /acceso sen concello («Onde queres entrar?»).
    const dest =
      user.role === "superadmin" || !slug
        ? "/acceso?aviso=saida"
        : accesoPath(slug, { aviso: "saida" });
    window.location.href = dest;
  };

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
    } else if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      const items = rootRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]',
      );
      items?.[items.length - 1]?.focus();
    }
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = rootRef.current?.querySelectorAll<HTMLElement>(
      '[role="menuitem"]',
    );
    if (!items || items.length === 0) return;
    const list = Array.from(items);
    const idx = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(idx + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(idx - 1 + list.length) % list.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      list[list.length - 1]?.focus();
    }
  };

  const pillClass = light
    ? "bg-area text-ink"
    : "bg-white/15 text-white";
  const avatarClass = light
    ? "bg-azul text-white"
    : "bg-white text-ink";

  return (
    <div ref={rootRef} className="relative flex items-center gap-1.5">
      <button
        ref={triggerRef}
        type="button"
        className={`flex h-11 w-11 items-center justify-center rounded-full font-bold ${pillClass}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${initials}. ${user.displayName}`}
        data-testid="user-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full text-xs ${avatarClass}`}
          aria-hidden
        >
          {initials}
        </span>
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={t("userMenu.aria")}
          data-testid="user-menu"
          tabIndex={-1}
          onKeyDown={onMenuKeyDown}
          className="fixed z-[80] min-w-[240px] rounded-2xl border border-line bg-white py-2 text-ink shadow-[0_18px_40px_-24px_rgba(0,43,74,.55)]"
          style={
            menuPos.mobile
              ? { left: 16, right: 16, top: menuPos.top }
              : { left: menuPos.left, top: menuPos.top, width: 260 }
          }
        >
          <div className="border-b border-line px-4 pb-2.5 pt-1">
            <p className="m-0 text-sm font-extrabold text-marino">
              {user.displayName}
            </p>
            <p className="m-0 text-xs text-graphite">{roleLine}</p>
          </div>

          {user.role !== "superadmin" && slug ? (
            <Link
              role="menuitem"
              tabIndex={0}
              to={accountPath(user, slug)}
              className="flex min-h-11 items-center px-4 text-sm font-bold text-ink no-underline hover:bg-area"
              onClick={() => close()}
            >
              {user.role === "club_manager"
                ? t("userMenu.clubAccount")
                : t("userMenu.myAccount")}
            </Link>
          ) : null}

          {user.role === "citizen" && slug ? (
            <Link
              role="menuitem"
              tabIndex={0}
              to={`/c/${slug}/reservas`}
              className="flex min-h-11 items-center px-4 text-sm font-bold text-ink no-underline hover:bg-area"
              onClick={() => close()}
            >
              {t("nav.myBookings")}
            </Link>
          ) : null}

          {user.role === "citizen" && slug ? (
            <Link
              role="menuitem"
              tabIndex={0}
              to={`/c/${slug}/contacto`}
              className="flex min-h-11 items-center px-4 text-sm font-bold text-ink no-underline hover:bg-area min-[1360px]:hidden"
              onClick={() => close()}
            >
              {t("nav.contact")}
            </Link>
          ) : null}

          {user.role === "citizen" && slug ? (
            <Link
              role="menuitem"
              tabIndex={0}
              to={`/c/${slug}/incidencia`}
              className="flex min-h-11 items-center px-4 text-sm font-bold text-ink no-underline hover:bg-area"
              onClick={() => close()}
            >
              {t("muni.reportIncident")}
            </Link>
          ) : null}

          {slug || user.role === "superadmin" || user.role === "admin" ? (
            <Link
              role="menuitem"
              tabIndex={0}
              to="/"
              className="flex min-h-11 items-center px-4 text-sm font-bold text-ink no-underline hover:bg-area"
              onClick={() => close()}
              data-testid="user-menu-change-muni"
            >
              {t("nav.changeMuni")}
            </Link>
          ) : null}

          {user.role === "superadmin" ? (
            <button
              type="button"
              role="menuitem"
              className="flex min-h-11 w-full items-center border-0 bg-transparent px-4 text-left text-sm font-bold text-ink hover:bg-area"
              onClick={() => {
                close();
                navigate("/deputacion");
              }}
            >
              {t("userMenu.deputacionHome")}
            </button>
          ) : null}

          {/* REVISION-22 B3 — Entrar como club */}
          {user.linkedClubs && user.linkedClubs.length > 0 && slug
            ? [
                <div key="sw-sep" className="my-1 border-t border-line" role="separator" />,
                <button
                  key="sw-personal"
                  type="button"
                  role="menuitem"
                  className="flex min-h-11 w-full items-center border-0 bg-transparent px-4 text-left text-sm font-bold text-ink hover:bg-area"
                  onClick={() => {
                    close();
                    void api.setActiveClub(null).then(() => refreshUser());
                  }}
                >
                  {t("account.switchPersonal")}
                </button>,
                ...user.linkedClubs.map((cl) => (
                  <button
                    key={cl.id}
                    type="button"
                    role="menuitem"
                    className="flex min-h-11 w-full items-center border-0 bg-transparent px-4 text-left text-sm font-bold text-ink hover:bg-area"
                    onClick={() => {
                      close();
                      void api.setActiveClub(cl.id).then(() => {
                        void refreshUser();
                        navigate(`/c/${slug}/clubs/${cl.id}`);
                      });
                    }}
                  >
                    {t("account.switchAs")}: {cl.shortName || cl.name}
                  </button>
                )),
              ]
            : null}

          {user.linkedMuniRoles && user.linkedMuniRoles.length > 0 && slug ? (
            <>
              <div className="my-1 border-t border-line" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="flex min-h-11 w-full items-center border-0 bg-transparent px-4 text-left text-sm font-bold text-ink hover:bg-area"
                onClick={() => {
                  close();
                  void api.setActiveMuniRole(null).then(() => refreshUser());
                }}
              >
                {t("account.switchPersonal")}
              </button>
              {user.linkedMuniRoles.map((mr) => (
                <button
                  key={`${mr.municipalityId}:${mr.role}`}
                  type="button"
                  role="menuitem"
                  className="flex min-h-11 w-full items-center border-0 bg-transparent px-4 text-left text-sm font-bold text-ink hover:bg-area"
                  onClick={() => {
                    close();
                    void api.setActiveMuniRole(mr.role).then(() => {
                      void refreshUser();
                      const destSlug = mr.municipalitySlug ?? slug;
                      navigate(homePathForRole(mr.role, destSlug));
                    });
                  }}
                >
                  {t("account.switchAs")}: {mr.label}
                </button>
              ))}
            </>
          ) : null}

          <div className="my-1 border-t border-line" role="separator" />

          <button
            type="button"
            role="menuitem"
            data-testid="user-menu-exit"
            className="flex min-h-11 w-full items-center gap-2 border-0 bg-transparent px-4 text-left text-sm font-bold text-erro hover:bg-area"
            onClick={() => void doLogout()}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            {t("nav.logout")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Destino de conta segundo rol (exportado para tests / Account). */
export function userHomeAfterLogin(user: AuthUser): string {
  return homePathForRole(
    user.role,
    user.municipalitySlug ?? "",
    user.clubId,
  );
}
