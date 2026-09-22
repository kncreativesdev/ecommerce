import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import { cn } from '../../lib/cn.js';

/**
 * Global light/dark theme toggle. Always rendered with an accessible label
 * and pressed state; keyboard reachable by virtue of being a native button.
 */
export function ThemeToggle({ className }) {
  const { resolved, toggle } = useTheme();
  const isDark = resolved === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={isDark}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={cn(
        'inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl',
        'border border-border bg-surface text-foreground',
        'transition-colors duration-200 hover:bg-surface-muted',
        className,
      )}
    >
      {isDark ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
    </button>
  );
}
