import type { HTMLAttributes, ReactNode } from "react";

/** SIMPLIFICACION §6: borde OU sombra — `lift` engade sombra ao hover; por defecto só borde. */
export function Card({
  children,
  lift = false,
  className = "",
  ...rest
}: HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  lift?: boolean;
}) {
  return (
    <article
      className={[
        "rounded-card border border-line bg-surface",
        lift ? "pa-ui-lift" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </article>
  );
}
