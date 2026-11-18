import type { ReactNode } from "react";

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  hint?: ReactNode;
};

type Tone = "pill" | "bar";

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  tone = "pill",
  "aria-label": ariaLabel,
  className = "",
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  tone?: Tone;
  "aria-label"?: string;
  className?: string;
}) {
  if (tone === "bar") {
    return (
      <div
        role="group"
        data-pa-segmented=""
        aria-label={ariaLabel}
        className={`flex overflow-hidden rounded-btn border-[1.5px] border-border2 ${className}`}
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.value)}
              className={[
                "pa-ui-interactive flex flex-1 flex-col items-center justify-center",
                "h-[52px] border-0 font-extrabold text-[15px] leading-tight",
                on
                  ? "bg-marino text-on-dark pa-ui-interactive-on-dark"
                  : "bg-surface text-marino hover:bg-azul-25",
              ].join(" ")}
            >
              {o.label}
              {o.hint != null ? (
                <span className="text-xs font-medium opacity-80">{o.hint}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="group"
      data-pa-segmented=""
      aria-label={ariaLabel}
      className={`flex rounded-btn bg-seg-track p-1 ${className}`}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={[
              "pa-ui-interactive min-w-0 flex-1 h-[46px] rounded-[11px] border-2 px-1",
              "font-extrabold text-[12px] leading-tight sm:text-[15px]",
              on
                ? "border-marino bg-surface text-marino shadow-pa-seg"
                : "border-transparent bg-transparent text-muted-2 hover:text-marino",
            ].join(" ")}
          >
            <span className="block truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
