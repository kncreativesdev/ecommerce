import { useState } from 'react';
import { X } from 'lucide-react';
import { siteConfig } from '../../../config/site.js';

/**
 * Compact promotional strip above the main navigation. Content is centralized
 * in `siteConfig.announcement` (original Tech Pulse wording). Dismissible
 * per FRONTEND_SPEC §4.1; dismissal is session-local UI state only.
 */
export function AnnouncementBar() {
  const [dismissed, setDismissed] = useState(false);
  const { message } = siteConfig.announcement;

  if (dismissed) return null;

  return (
    <div className="bg-accent text-header-foreground">
      <div className="tp-container relative flex min-h-8 items-center justify-center gap-2 py-1 pr-10 text-center">
        <p className="text-xs font-medium text-accent-foreground">{message}</p>
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
