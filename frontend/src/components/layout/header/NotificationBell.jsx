import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell } from 'lucide-react';
import { HeaderIconButton } from './HeaderIconButton.jsx';
import { dropdownVariants } from '../../../lib/menuMotion.js';

/**
 * Notification entry point (authenticated only). No notification backend
 * exists yet (BACKEND_REQUIREMENTS_GAP), so this renders the bell with an
 * honest empty panel — never fabricated items. The `notifications.service`
 * + store seam plugs in here when the API lands.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open ]);

  return (
    <div ref={wrapRef} className="relative hidden sm:block">
      <HeaderIconButton
        label="Notifications"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={20} aria-hidden="true" />
      </HeaderIconButton>
      <AnimatePresence>
        {open ? (
          <motion.div
            role="status"
            variants={dropdownVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            style={{ transformOrigin: 'top right' }}
            className="absolute right-0 top-[calc(100%+10px)] z-50 w-72 rounded-2xl border border-border bg-surface-elevated p-4 shadow-2xl"
          >
            <p className="text-sm font-semibold text-foreground">Notifications</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              No notifications yet — this section lights up when order updates arrive.
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
