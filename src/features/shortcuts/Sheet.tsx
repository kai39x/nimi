import { useEffect, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { useT } from "@/i18n";

/** A glass sheet over the panel body (clipboard history, the app picker, the shortcut editor). */
export function SheetFrame({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const t = useT();
  useEffect(() => {
    // Esc closes the sheet, not the whole panel.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <>
      <div className="sc__scrim" onClick={onClose} />
      <div className="sc-sheet n-glass" role="dialog" aria-label={title}>
        <header className="sc-sheet__head">
          <span className="card__title">{title}</span>
          <span className="sc-sheet__actions">
            {actions}
            <button type="button" className="icon-btn icon-btn--round" aria-label={t("common.close")} onClick={onClose}>
              <Icon name="x" size={16} />
            </button>
          </span>
        </header>
        {children}
      </div>
    </>
  );
}
