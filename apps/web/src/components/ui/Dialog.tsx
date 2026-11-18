import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

/**
 * Diálogo modal accesible: Esc pecha, foco inicial e trampa de foco,
 * e devolve o foco ao elemento que o abriu.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  labelledBy?: string;
}) {
  const autoId = useId();
  const titleId = labelledBy ?? autoId;
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () =>
      panel?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [];

    window.setTimeout(() => {
      const list = Array.from(focusables());
      (list[0] ?? panel)?.focus();
    }, 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const list = Array.from(focusables());
      if (list.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const onBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const onPanelKeyDown = (_e: ReactKeyboardEvent<HTMLDivElement>) => {
    /* Esc handled globally while open. */
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(0,43,74,0.45)] p-4 sm:items-center"
      role="presentation"
      onMouseDown={onBackdropClick}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : labelledBy}
        tabIndex={-1}
        className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-card bg-surface p-6 shadow-lg outline-none"
        onKeyDown={onPanelKeyDown}
      >
        {title ? (
          <h2 id={titleId} className="m-0 text-xl font-extrabold text-marino">
            {title}
          </h2>
        ) : null}
        {children}
      </div>
    </div>
  );
}
