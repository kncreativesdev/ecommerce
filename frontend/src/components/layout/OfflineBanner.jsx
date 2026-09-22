import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

/**
 * Offline detection banner: fixed bottom strip (above content, below
 * toasts) whenever the browser reports no connectivity. Purely
 * informational — cached pages keep working where possible.
 */
export function OfflineBanner() {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="alert"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface-elevated px-4 py-3 shadow-2xl"
    >
      <p className="tp-container flex items-center justify-center gap-2 text-center text-sm font-medium text-foreground">
        <WifiOff size={17} aria-hidden="true" className="shrink-0 text-warning" />
        You’re offline. Browsing still works where cached; checkout needs a connection.
      </p>
    </div>
  );
}
