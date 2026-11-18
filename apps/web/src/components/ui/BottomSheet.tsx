import type { HTMLAttributes, ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * Móbil: barra inferior por riba da MobileTabBar.
 * PC (`aside`): panel sticky na columna dereita.
 * REVISION-42 Q2: sticky top 16px + max-height viewport.
 */
export function BottomSheet({
  children,
  layout = "auto",
  className = "",
  ...rest
}: {
  children: ReactNode;
  layout?: "auto" | "sheet" | "aside";
  className?: string;
} & HTMLAttributes<HTMLDivElement>) {
  const { t } = useTranslation();
  const sheet =
    layout === "aside"
      ? false
      : layout === "sheet"
        ? true
        : undefined;

  const stickyAside =
    "sticky top-4 max-h-[calc(100vh-32px)] overflow-y-auto rounded-[22px] p-4 shadow-pa";

  return (
    <div
      role="region"
      aria-label={t("ui.sheet.confirmRegion")}
      className={[
        "flex flex-col gap-3 border border-line bg-surface",
        sheet === true
          ? "pa-ui-sheet-mobile fixed inset-x-0 z-40 rounded-t-[22px] border-b-0 px-4 pt-3.5 shadow-pa-sheet"
          : sheet === false
            ? stickyAside
            : [
                "pa-ui-sheet-mobile fixed inset-x-0 z-40 rounded-t-[22px] border-b-0 px-4 pt-3.5 shadow-pa-sheet",
                "lg:static lg:inset-auto lg:z-auto lg:rounded-[22px] lg:border lg:p-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-32px)] lg:overflow-y-auto",
              ].join(" "),
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <span
        aria-hidden
        className="mx-auto h-1 w-10 rounded-sm bg-border2 lg:hidden"
      />
      {children}
    </div>
  );
}
