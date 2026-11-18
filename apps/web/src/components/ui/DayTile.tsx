export function DayTile({
  weekday,
  day,
  pressed,
  hasFree,
  past,
  onClick,
  disabled,
  className = "",
}: {
  weekday: string;
  day: number | string;
  pressed?: boolean;
  hasFree?: boolean;
  past?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed ? true : false}
      disabled={disabled || past}
      onClick={onClick}
      className={[
        "pa-ui-interactive flex flex-none flex-col items-center justify-center gap-0.5",
        "h-[76px] w-[60px] rounded-2xl border-[1.5px]",
        pressed
          ? "border-marino bg-marino text-on-dark pa-ui-interactive-on-dark"
          : "border-line bg-surface text-marino hover:border-marino",
        past || disabled ? "cursor-default opacity-45" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="text-xs font-bold">{weekday}</span>
      <strong className="text-[22px] leading-none font-extrabold">{day}</strong>
      <span
        className={`h-1.5 w-1.5 rounded-full ${hasFree ? "bg-libre-bd" : "bg-transparent"}`}
        aria-hidden
      />
    </button>
  );
}
