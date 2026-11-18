import type { ReactNode } from "react";

export function SportTile({
  label,
  icon,
  pressed,
  onClick,
  size = "pc",
  className = "",
}: {
  label: string;
  icon: ReactNode;
  pressed?: boolean;
  onClick?: () => void;
  size?: "pc" | "mobile";
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed ? true : false}
      onClick={onClick}
      className={[
        "pa-ui-interactive flex w-full flex-col items-center justify-center",
        "border-[1.5px] font-extrabold",
        size === "mobile"
          ? "h-[72px] gap-1.5 rounded-btn text-xs"
          : "h-[84px] gap-2 rounded-2xl text-[15px]",
        pressed
          ? "border-marino bg-marino text-on-dark pa-ui-interactive-on-dark"
          : "border-line bg-surface text-marino hover:border-marino",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}
