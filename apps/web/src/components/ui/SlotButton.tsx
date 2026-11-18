import { useTranslation } from "react-i18next";

export type SlotState = "libre" | "escollida" | "ocupada" | "tua" | "pechada";

const STATE_CLASS: Record<SlotState, string> = {
  libre: "border-libre-bd bg-libre-bg text-libre hover:bg-libre hover:text-on-dark",
  escollida: "border-azul bg-azul text-on-dark pa-ui-interactive-on-dark",
  ocupada: "border-ocupada bg-ocupada-bg text-ocupada hover:border-ocupada",
  tua: "border-[var(--pa-ambar)] bg-[var(--pa-ambar-bg)] text-[var(--pa-ambar-ink)]",
  pechada: "border-ocupada bg-ocupada-bg text-ocupada line-through cursor-default",
};

export function SlotButton({
  hour,
  state,
  onClick,
  onOpenQr,
  size = "mobile",
  sublabel,
  title,
  className = "",
  disabled = false,
}: {
  hour: string;
  state: SlotState;
  onClick?: () => void;
  /** Estado «tua»: abre o QR da reserva (non desactivado). */
  onOpenQr?: () => void;
  size?: "mobile" | "compact";
  sublabel?: string;
  /** Detalle extra (p.ex. hora de fin) só no atributo title. */
  title?: string;
  className?: string;
  /** Vista só lectura (Deputación): amosa o estado sen acción. */
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const defaultSub: Record<SlotState, string> = {
    libre: t("ui.slot.libre"),
    escollida: t("ui.slot.escollida"),
    ocupada: disabled ? t("reserve.occupied") : t("ui.slot.avisarme"),
    tua: t("ui.slot.tua"),
    pechada: "",
  };
  const sub = sublabel ?? defaultSub[state];
  const compact = size === "compact";

  const handleClick = () => {
    if (state === "tua") {
      onOpenQr?.();
      return;
    }
    if (state === "pechada") return;
    onClick?.();
  };

  const isDisabled =
    disabled || state === "pechada" || (state === "tua" && !onOpenQr);
  const interactive = !isDisabled;

  // Nome accesíbel = texto visible (WCAG 2.5.3). Detalle extra no title.
  const titleHint =
    title ??
    (state === "ocupada"
      ? t("ui.slot.ariaOcupada", { hour })
      : state === "tua"
        ? t("ui.slot.ariaTua", { hour })
        : undefined);

  return (
    <button
      type="button"
      aria-pressed={state === "escollida"}
      data-slot-state={state}
      title={titleHint}
      disabled={isDisabled}
      onClick={interactive ? handleClick : undefined}
      className={[
        "pa-ui-interactive flex w-auto flex-col items-center justify-center gap-px",
        "border-[1.5px] font-extrabold",
        compact
          ? "min-h-[46px] min-w-[4.5rem] rounded-xl px-2.5 py-1.5 text-[15px]"
          : "min-h-14 rounded-btn px-3 py-1.5 text-base",
        "whitespace-nowrap",
        STATE_CLASS[state],
        isDisabled ? "cursor-default pointer-events-none" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="whitespace-nowrap tabular-nums leading-tight">{hour}</span>
      {sub ? (
        <span className="max-w-full whitespace-nowrap text-[11px] font-bold leading-tight no-underline">
          {sub}
        </span>
      ) : null}
    </button>
  );
}
