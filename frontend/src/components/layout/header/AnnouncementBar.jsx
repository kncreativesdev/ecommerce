import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { useAnnouncementStore } from '../../../stores/useAnnouncementStore.js';

/**
 * Compact promotional strip above the main navigation. Content is the PUBLIC
 * backend announcement (`GET /announcements/current`) — the rendered message
 * never falls back to hardcoded copy. `null` (or a failed load) hides the bar
 * cleanly. Dismissal is session-local UI state only.
 *
 * NOTE: `siteConfig.announcement` is intentionally NOT read here (kept in
 * `config/site.js` for compat only).
 */
export function AnnouncementBar() {
  const [dismissed, setDismissed] = useState(false);
  const announcement = useAnnouncementStore((state) => state.announcement);
  const status = useAnnouncementStore((state) => state.status);
  const ensure = useAnnouncementStore((state) => state.ensure);

  useEffect(() => {
    ensure();
  }, [ensure]);

  if (dismissed) return null;
  // Loading / error / no active announcement → render nothing (no fallback text).
  if (status !== 'success' || !announcement) return null;

  const linkTarget =
    typeof announcement.linkTarget === 'string' && announcement.linkTarget.startsWith('/')
      ? announcement.linkTarget
      : null;

  return (
    <div className="bg-accent text-header-foreground">
      <div className="tp-container relative flex min-h-8 items-center justify-center gap-2 py-1 pr-10 text-center">
        <p className="text-xs font-medium text-accent-foreground">
          {announcement.message}
          {linkTarget ? (
            <>
              {' '}
              <Link
                to={linkTarget}
                className="font-semibold underline underline-offset-2 hover:no-underline"
              >
                {announcement.linkLabel || 'Learn more'}
              </Link>
            </>
          ) : null}
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss announcement"
          className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-header-muted transition-colors duration-200 hover:bg-header-foreground/10 hover:text-header-foreground"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
