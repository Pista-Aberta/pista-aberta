import type { ReactNode } from "react";

type BadgeTone = "libre" | "aviso" | "info" | "erro";

const TONE: Record<BadgeTone, string> = {
  libre: "bg-libre-bg text-libre",
  aviso: "bg-aviso-bg text-aviso",
  info: "bg-azul-50 text-azul-700",
  erro: "bg-erro-bg text-erro",
};

export function Badge({
  tone = "info",
  children,
  className = "",
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2.5 py-1 text-[13px] font-extrabold",
        TONE[tone],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}
