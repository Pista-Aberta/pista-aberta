import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

/** Faixa «Vista Deputación · só lectura · Volver á Deputación» (REVISION-20 H4). */
export function DeputacionReadOnlyBanner({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div
      className={`pa-warn-banner flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`.trim()}
      role="status"
      data-testid="deputacion-readonly-banner"
    >
      <span className="inline-flex items-center gap-2">
        <span aria-hidden>ℹ</span>
        <span>
          {t("deputacion.headerTitle")} · {t("deputacion.readOnly")}
        </span>
      </span>
      <Link
        to="/deputacion"
        className="font-extrabold text-azul-700 underline underline-offset-2"
        data-testid="deputacion-back-link"
      >
        {t("admin.backToDeputacion")}
      </Link>
    </div>
  );
}
