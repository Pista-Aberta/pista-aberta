/** Iconas via lucide-react (ISC). Deportes: SVG propias. */

import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Building2,
  Calendar,
  Check,
  ClipboardList,
  Home,
  MapPin,
  MoreHorizontal,
  Search,
  Trophy,
  Users,
} from "lucide-react";

type IconProps = { className?: string; size?: number; title?: string };

function LucideIcon(
  Icon: ComponentType<LucideProps>,
  { className, size = 20, title }: IconProps,
) {
  return (
    <Icon
      className={className}
      size={size}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
    />
  );
}

export function IconCalendar(p: IconProps) {
  return LucideIcon(Calendar, p);
}
export function IconUsers(p: IconProps) {
  return LucideIcon(Users, p);
}
export function IconBell(p: IconProps) {
  return LucideIcon(Bell, p);
}
export function IconTrophy(p: IconProps) {
  return LucideIcon(Trophy, p);
}
export function IconBuilding(p: IconProps) {
  return LucideIcon(Building2, p);
}
export function IconMapPin(p: IconProps) {
  return LucideIcon(MapPin, p);
}
export function IconClipboard(p: IconProps) {
  return LucideIcon(ClipboardList, p);
}
export function IconActivity(p: IconProps) {
  return LucideIcon(Activity, p);
}
export function IconCheck(p: IconProps) {
  return LucideIcon(Check, p);
}
export function IconAlert(p: IconProps) {
  return LucideIcon(AlertTriangle, p);
}
export function IconHome(p: IconProps) {
  return LucideIcon(Home, p);
}
export function IconMore(p: IconProps) {
  return LucideIcon(MoreHorizontal, p);
}
export function IconSearch(p: IconProps) {
  return LucideIcon(Search, p);
}

/** SVG propias por tipo de instalación (pádel / pavillón / campo / sala). */
export function FacilityTypeIcon({
  type,
  size = 48,
  className,
}: {
  type: string;
  size?: number;
  className?: string;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 64 64",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    className,
    "aria-hidden": true as const,
  };
  if (type === "pavillon") {
    return (
      <svg {...common}>
        <path d="M8 52V28l24-16 24 16v24" />
        <path d="M20 52V36h24v16" />
        <path d="M28 44h8" />
      </svg>
    );
  }
  if (type === "campo") {
    return (
      <svg {...common}>
        <rect x="8" y="16" width="48" height="32" rx="2" />
        <path d="M32 16v32M8 32h48" />
        <circle cx="32" cy="32" r="6" />
      </svg>
    );
  }
  if (type === "sala") {
    return (
      <svg {...common}>
        <rect x="12" y="14" width="40" height="36" rx="2" />
        <path d="M20 50V38h24v12M24 26h16M24 32h12" />
      </svg>
    );
  }
  /* pista (default) */
  return (
    <svg {...common}>
      <rect x="10" y="14" width="44" height="36" rx="2" />
      <path d="M32 14v36M10 32h44" />
      <circle cx="32" cy="32" r="5" />
    </svg>
  );
}
