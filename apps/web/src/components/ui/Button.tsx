import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "dangerSolid";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-azul text-on-dark hover:bg-azul-700 border-0 pa-ui-interactive-on-dark",
  secondary:
    "bg-surface text-marino border-[1.5px] border-line hover:border-marino",
  ghost: "bg-transparent text-marino border-0 hover:bg-azul-25",
  danger: "bg-surface text-erro border-[1.5px] border-erro hover:bg-erro-bg",
  dangerSolid: "bg-erro text-on-dark border-0 hover:opacity-90 pa-ui-interactive-on-dark",
};

export function Button({
  variant = "primary",
  children,
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      className={[
        "pa-ui-interactive inline-flex items-center justify-center gap-2.5",
        "min-h-11 h-12 px-[18px] rounded-btn",
        "font-extrabold text-base disabled:cursor-not-allowed disabled:opacity-55",
        VARIANT[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
