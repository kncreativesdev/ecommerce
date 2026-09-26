import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, BellRing, Tag, X } from 'lucide-react';
import { toast } from 'sonner';
import { HeaderIconButton } from './HeaderIconButton.jsx';
import { dropdownVariants } from '../../../lib/menuMotion.js';
import { formatDate } from '../../../lib/format.js';
import { useSession } from '../../../hooks/useSession.js';
import { useNotificationsStore } from '../../../stores/useNotificationsStore.js';
import { resolveMarketingHref } from '../../../services/marketing.service.js';

/**
 * Notification center entry point (authenticated only).
 *
 * Bell badge = authoritative `unreadCount` from
 * `GET /notifications/unread-count` (never derived, never fabricated).
 * The dropdown lists order notifications (click → `/account/orders/:id`
 * via `Link` + mark-read) and active marketing broadcasts (click → mapped
 * internal route, or a plain row when there is no destination), with
 * timestamps, a 'Mark all read' action, and an honest empty state.
 * Single fetch per app-load (auth settle) + single fetch per dropdown open —
 * no polling, no N+1, no `location.reload`.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const { isAuthenticated } = useSession();
  const items = useNotificationsStore((state) => state.items);
  const marketingItems = useNotificationsStore((state) => state.marketingItems);
  const unreadCount = useNotificationsStore((state) => state.unreadCount);
  const status = useNotificationsStore((state) => state.status);
  const fetchAll = useNotificationsStore((state) => state.fetchAll);
  const markRead = useNotificationsStore((state) => state.markRead);
  const markAllRead = useNotificationsStore((state) => state.markAllRead);
  const clearNotification = useNotificationsStore((state) => state.clearNotification);

  // App-load fetch once the session settles.
  useEffect(() => {
    if (isAuthenticated) fetchAll();
  }, [isAuthenticated, fetchAll]);

  // Single refresh per dropdown open.
  useEffect(() => {
    if (open && isAuthenticated) fetchAll();
  }, [open, isAuthenticated, fetchAll]);

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
  }, [open]);

  const handleOpenOrder = async (id) => {
    const result = await markRead(id);
    if (!result.ok) {
      toast.error(result.error?.message ?? 'Couldn’t update notifications.');
    }
    setOpen(false);
  };

  const handleMarkAllRead = async () => {
    const result = await markAllRead();
    if (result.ok) {
      toast.success('All notifications marked as read.');
    } else {
      toast.error(result.error?.message ?? 'Couldn’t update notifications.');
    }
  };

  const handleClear = async (id) => {
    const result = await clearNotification(id);
    if (result.ok) {
      toast.success('Notification cleared.');
    } else {
      toast.error(result.error?.message ?? 'Couldn’t clear the notification.');
    }
  };

  const showList = status === 'success' || items.length > 0 || marketingItems.length > 0;

  return (
    <div ref={wrapRef} className="relative hidden sm:block">
      <HeaderIconButton
        label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative"
      >
        <Bell size={20} aria-hidden="true" />
        {unreadCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold leading-5 text-accent-foreground"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </HeaderIconButton>
      <AnimatePresence>
        {open ? (
          <motion.div
            variants={dropdownVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            style={{ transformOrigin: 'top right' }}
            className="absolute right-0 top-[calc(100%+10px)] z-50 max-h-[70vh] w-80 overflow-y-auto rounded-2xl border border-border bg-surface-elevated p-4 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">Notifications</p>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="cursor-pointer rounded-lg px-2 py-1 text-xs font-semibold text-accent-link"
                >
                  Mark all read
                </button>
              ) : null}
            </div>

            {status === 'loading' && items.length === 0 && marketingItems.length === 0 ? (
              <p className="mt-2 text-xs leading-5 text-muted-foreground">Loading notifications…</p>
            ) : status === 'error' && items.length === 0 && marketingItems.length === 0 ? (
              <div className="mt-2">
                <p className="text-xs leading-5 text-muted-foreground">Couldn’t load notifications.</p>
                <button
                  type="button"
                  onClick={() => fetchAll()}
                  className="mt-1 cursor-pointer rounded-lg px-2 py-1 text-xs font-semibold text-accent-link"
                >
                  Retry
                </button>
              </div>
            ) : showList && items.length === 0 && marketingItems.length === 0 ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                No notifications yet — order updates and offers will appear here.
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-1">
                {items.map((item) => (
                  <NotificationRow
                    key={item.id}
                    item={item}
                    onOpen={() => handleOpenOrder(item.id)}
                    onNavigate={() => setOpen(false)}
                    onClear={() => handleClear(item.id)}
                  />
                ))}
                {marketingItems.length > 0 ? (
                  <p className="mt-2 px-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    Offers &amp; updates
                  </p>
                ) : null}
                {marketingItems.map((promo) => {
                  const href = resolveMarketingHref(promo);
                  const body = (
                    <>
                      <span className="flex items-start gap-2">
                        <Tag size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold text-foreground">
                            {promo.title}
                          </span>
                          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                            {promo.message}
                          </span>
                        </span>
                      </span>
                    </>
                  );
                  return href ? (
                    <Link
                      key={promo.id}
                      to={href}
                      onClick={() => setOpen(false)}
                      className="rounded-xl px-2 py-2 transition-colors duration-200 hover:bg-surface-muted hover:no-underline"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div key={promo.id} className="rounded-xl px-2 py-2">
                      {body}
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function NotificationRow({ item, onOpen, onNavigate, onClear }) {
  const body = (
    <>
      <span className="flex items-start gap-2">
        {!item.isRead ? (
          <span aria-label="Unread" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
        ) : (
          <BellRing size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-foreground">{item.title}</span>
          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{item.message}</span>
          {item.createdAt ? (
            <time dateTime={item.createdAt} className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground">
              {formatDate(item.createdAt)}
            </time>
          ) : null}
        </span>
      </span>
    </>
  );
  const clearButton = (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClear?.();
      }}
      aria-label={`Clear notification: ${item.title}`}
      title="Clear notification"
      className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 hover:bg-surface-muted hover:text-foreground"
    >
      <X size={14} aria-hidden="true" />
    </button>
  );
  if (item.orderId) {
    return (
      <div className="flex items-start gap-1 rounded-xl transition-colors duration-200 hover:bg-surface-muted">
        <Link
          to={`/account/orders/${item.orderId}`}
          onClick={onOpen}
          className="min-w-0 flex-1 rounded-xl px-2 py-2 hover:no-underline"
        >
          {body}
        </Link>
        {clearButton}
      </div>
    );
  }
  return (
    <div className="flex items-start gap-1 rounded-xl px-2 py-2" onClick={onNavigate} role="presentation">
      <div className="min-w-0 flex-1">{body}</div>
      {clearButton}
    </div>
  );
}
