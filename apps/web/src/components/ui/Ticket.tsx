import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";

export function Ticket({
  weekday,
  day,
  title,
  subtitle,
  eyebrow,
  onQr,
  onCalendar,
  compact,
  qrLabel,
  calendarLabel,
  body,
  className = "",
  /** Franxa ámbar (portada) vs azul (confirmación). */
  accent = "ambar",
}: {
  weekday: string;
  day: number | string;
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: string;
  onQr?: () => void;
  onCalendar?: () => void;
  compact?: boolean;
  qrLabel?: string;
  calendarLabel?: string;
  /** Contido baixo a cabeceira (p.ex. QR grande na confirmación). */
  body?: ReactNode;
  className?: string;
  accent?: "ambar" | "azul";
}) {
  const { t } = useTranslation();
  const eye = eyebrow ?? t("ui.ticket.eyebrow");
  const qr = qrLabel ?? t("ui.ticket.qr");
  const cal = calendarLabel ?? t("ui.ticket.calendar");
  const showFooter = Boolean(onQr || onCalendar);
  const stripe = accent === "ambar" ? "bg-[var(--pa-ambar)]" : "bg-azul";
  const eyeColor =
    accent === "ambar" ? "text-[var(--pa-ambar-texto)]" : "text-azul-700";

  if (compact) {
    return (
      <section
        aria-label={typeof title === "string" ? title : eye}
        className={[
          "overflow-hidden rounded-[20px] border border-line bg-surface text-marino",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className={`h-1.5 ${stripe}`} aria-hidden />
        <div className="flex items-center gap-3.5 p-4">
          <DateBlock weekday={weekday} day={day} size="sm" />
          <span className="flex flex-1 flex-col gap-0.5">
            <span className={`text-[11px] font-extrabold tracking-[0.1em] ${eyeColor}`}>
              {eye}
            </span>
            <strong className="text-[17px] font-extrabold text-marino">{title}</strong>
          </span>
          {onQr ? (
            <button
              type="button"
              onClick={onQr}
              className="pa-ui-interactive h-11 rounded-xl bg-azul px-4 font-extrabold text-on-dark"
            >
              {t("ui.ticket.qrShort")}
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label={typeof title === "string" ? title : eye}
      className={[
        "overflow-hidden rounded-[22px] border border-line bg-surface text-marino",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={`h-2 ${stripe}`} aria-hidden />
      <div className="flex items-center gap-4 px-[22px] py-5">
        <DateBlock weekday={weekday} day={day} size="lg" />
        <span className="flex flex-col gap-1">
          <span className={`text-xs font-extrabold tracking-[0.1em] ${eyeColor}`}>{eye}</span>
          <strong className="text-[19px] font-extrabold text-marino">{title}</strong>
          {subtitle != null ? (
            <span className="text-[15px] text-graphite">{subtitle}</span>
          ) : null}
        </span>
      </div>
      {body != null ? (
        <div className="border-t border-dashed border-line px-[22px] py-5">{body}</div>
      ) : null}
      {showFooter ? (
        <div className="flex gap-2.5 border-t border-dashed border-line px-[22px] py-3.5">
          {onQr ? (
            <Button
              variant="primary"
              onClick={onQr}
              className="h-[46px] min-h-[46px] flex-1"
            >
              {qr}
            </Button>
          ) : null}
          {onCalendar ? (
            <button
              type="button"
              onClick={onCalendar}
              className="pa-ui-interactive flex h-[46px] flex-1 items-center justify-center rounded-xl border-[1.5px] border-line bg-transparent font-bold text-marino"
            >
              {cal}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function DateBlock({
  weekday,
  day,
  size,
}: {
  weekday: string;
  day: number | string;
  size: "sm" | "lg";
}) {
  return (
    <span
      className={[
        "flex flex-none flex-col items-center justify-center bg-marino font-extrabold text-on-dark",
        size === "lg" ? "h-[72px] w-16 rounded-[14px] text-xs" : "h-[62px] w-14 rounded-xl text-[11px]",
      ].join(" ")}
    >
      {weekday}
      <span className={size === "lg" ? "text-[28px] leading-none" : "text-2xl leading-none"}>
        {day}
      </span>
    </span>
  );
}
