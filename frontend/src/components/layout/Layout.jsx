import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './header/Header.jsx';
import { SiteFooter } from './SiteFooter.jsx';
import { WhatsAppFloat } from './WhatsAppFloat.jsx';
import { OfflineBanner } from './OfflineBanner.jsx';

/**
 * Root application layout: skip link + ecommerce header + main outlet +
 * temporary footer. Provides the semantic landmarks and responsive page
 * surface every later milestone builds on.
 */
export function Layout() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname ]);

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <Header />
      <main id="main-content" className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
      <WhatsAppFloat />
      <OfflineBanner />
    </div>
  );
}
