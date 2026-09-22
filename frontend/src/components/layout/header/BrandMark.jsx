import { Link } from 'react-router-dom';
import { Zap } from 'lucide-react';
import { siteConfig } from '../../../config/site.js';
import { cn } from '../../../lib/cn.js';

/**
 * Tech Pulse brand mark: red icon tile + wordmark + tagline.
 * Textual treatment only — replaceable by a real logo asset later.
 * Always links to Home (`/`).
 */
export function BrandMark({ compact = false, className }) {
  return (
    <Link
      to="/"
      aria-label="Tech Pulse — home"
      className={cn(
        'inline-flex shrink-0 items-center gap-2.5 rounded-lg px-1 py-1 hover:no-underline transition-transform duration-200 ease-in-out hover:scale-105',
        className,
      )}>
      <span
        aria-hidden="true"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground"
      >
        <Zap size={20} strokeWidth={2.5} fill="currentColor" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[17px] font-extrabold tracking-tight text-header-foreground">
          {siteConfig.brandShortName}
        </span>
        {compact ? null : (
          <span className="mt-1 hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-header-muted min-[420px]:block">
            {siteConfig.brandTagline}
          </span>
        )}
      </span>
    </Link>
  );
}
