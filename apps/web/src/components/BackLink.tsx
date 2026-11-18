import { Link } from "react-router-dom";

/** Ligazón «‹ Nome» unificada (REVISION-8 B8). */
export function BackLink({
  to,
  children,
  className = "",
}: {
  to: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={`inline-flex min-h-11 items-center gap-1 font-bold text-azul-700 no-underline hover:underline ${className}`}
    >
      <span aria-hidden>‹</span>
      {children}
    </Link>
  );
}
