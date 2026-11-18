import { Link } from "react-router-dom";
import { Card } from "./ui/Card";
import { CourtArt, type CourtArtType } from "./ui/CourtArt";
import { SlotButton } from "./ui/SlotButton";

export type FacilityFreeHour = {
  /** Hora visible («20:00»). */
  label: string;
  /** REVISION-41 O1: «2 pistas» debaixo da hora (evita overflow nunha liña). */
  sublabel?: string;
  primary: { id: string; date: string; start: string };
};

type FacilityLike = {
  id: string;
  name: string;
  address?: string;
  services?: string[];
  imageUrl?: string | null;
  imageAlt?: string | null;
};

/** Tarxeta instalación + chips verdes (Rev24 C7 — patrón portada). */
export function FacilityFreeCard({
  facility,
  courtType,
  hours,
  freeBadge,
  servicesLine,
  emptyHours,
  closureNotice,
  seeAllLabel,
  seeAllHref,
  nameHref,
  onHourClick,
  className = "",
}: {
  facility: FacilityLike;
  courtType: CourtArtType;
  hours: FacilityFreeHour[];
  freeBadge?: string;
  servicesLine?: string;
  emptyHours?: string;
  /** REVISION-51 C2 — aviso de peche na portada. */
  closureNotice?: string;
  /** REVISION-26 M5 — á dereita dos chips, non debaixo do bloque. */
  seeAllLabel?: string;
  /** REVISION-42 Q1 — ligazón real «Ver todas». */
  seeAllHref?: string;
  /** REVISION-42 Q1 — ligazón no nome (hub sen envolver toda a tarxeta). */
  nameHref?: string;
  onHourClick: (primary: FacilityFreeHour["primary"]) => void;
  className?: string;
}) {
  const nameEl = nameHref ? (
    <Link
      to={nameHref}
      className="text-base font-extrabold text-marino no-underline hover:underline md:text-lg"
    >
      {facility.name}
    </Link>
  ) : (
    <strong className="text-base font-extrabold text-marino md:text-lg">
      {facility.name}
    </strong>
  );

  /* REVISION-46 D3: foto real se hai; se non, CourtArt centrado. */
  const thumb = facility.imageUrl ? (
    <img
      src={facility.imageUrl}
      alt={facility.imageAlt?.trim() || facility.name}
      className="h-[54px] w-[54px] flex-none rounded-[14px] object-cover md:h-auto md:min-h-full md:w-[110px] md:rounded-none"
    />
  ) : (
    <CourtArt
      type={courtType}
      width={54}
      height={54}
      className="flex-none rounded-[14px] md:h-auto md:min-h-full md:w-[110px] md:rounded-none"
    />
  );

  return (
    <Card
      className={`overflow-hidden md:grid md:grid-cols-[110px_minmax(0,1fr)] ${className}`}
    >
      <div className="flex items-center gap-3 p-3 md:contents">
        {thumb}
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-0 md:gap-2.5 md:p-[14px_16px]">
          <div className="flex flex-wrap items-center gap-3">
            {nameEl}
            {freeBadge ? (
              <span className="rounded-full border border-libre-bd bg-libre-bg px-2.5 py-0.5 text-xs font-extrabold text-libre">
                {freeBadge}
              </span>
            ) : null}
            {facility.address ? (
              <span className="ml-auto hidden text-sm text-graphite md:inline">
                {facility.address}
              </span>
            ) : null}
          </div>
          {servicesLine ? (
            <p className="m-0 text-xs text-graphite md:hidden">{servicesLine}</p>
          ) : null}
          {facility.address ? (
            <p className="m-0 text-sm text-graphite md:hidden">{facility.address}</p>
          ) : null}
          {closureNotice ? (
            <p className="m-0 text-xs font-bold text-aviso" role="status">
              {closureNotice}
            </p>
          ) : null}
          {hours.length === 0 && emptyHours ? (
            <p className="m-0 text-sm text-graphite">{emptyHours}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-2">
                {hours.map((h) => (
                  <SlotButton
                    key={`${h.primary.start}-${h.primary.id}`}
                    hour={h.label}
                    state="libre"
                    size="compact"
                    sublabel={h.sublabel ?? ""}
                    title={
                      h.sublabel
                        ? `${h.label} · ${h.sublabel}`
                        : h.label
                    }
                    onClick={() => onHourClick(h.primary)}
                  />
                ))}
              </div>
              {seeAllLabel && seeAllHref ? (
                <Link
                  to={seeAllHref}
                  className="text-sm font-extrabold text-azul-700 whitespace-nowrap no-underline hover:underline"
                >
                  {seeAllLabel}
                </Link>
              ) : seeAllLabel ? (
                <span className="text-sm font-extrabold text-azul-700 whitespace-nowrap">
                  {seeAllLabel}
                </span>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
