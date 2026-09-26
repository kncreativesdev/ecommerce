import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn.js';

/**
 * Accessible modal dialog: Escape closes, backdrop click closes (unless
 * `persistent` during pending mutations), labelled by `title`. Focus moves
 * to the dialog once on open; body scroll locks while mounted.
 *
 * The open/scroll/Escape setup runs exactly once per mount. It must NOT
 * depend on `onClose`: every call site passes an inline closure (a new
 * identity per render), so depending on it re-ran this effect — including
 * `dialog.focus()` — on every keystroke inside the dialog and yanked focus
 * out of form inputs. Latest values are read through refs instead.
 */
export function Modal({ title, onClose, persistent = false, className, children }) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const persistentRef = useRef(persistent);

  // Latest-callback refs (synced post-commit, never during render): the
  // Escape handler below needs fresh values without re-subscribing.
  useEffect(() => {
    onCloseRef.current = onClose;
    persistentRef.current = persistent;
  });

  useEffect(() => {
    dialogRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !persistentRef.current) onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        aria-hidden="true"
        onClick={() => {
          if (!persistent) onClose();
        }}
        className="absolute inset-0 bg-black/50"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[90svh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-surface-elevated shadow-lg sm:rounded-2xl',
          className,
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 className="text-base font-bold tracking-tight text-foreground">{title}</h2>
          {!persistent ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              <X size={18} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div className="overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
