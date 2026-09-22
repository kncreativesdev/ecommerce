import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { Heart, Menu, Search, ShoppingCart, User, X } from 'lucide-react';
import { AnnouncementBar } from './AnnouncementBar.jsx';
import { BrandMark } from './BrandMark.jsx';
import { DesktopNav } from './DesktopNav.jsx';
import { CategoryMegaMenu } from './CategoryMegaMenu.jsx';
import { SearchPanel } from './SearchPanel.jsx';
import { AccountMenu } from './AccountMenu.jsx';
import { MobileMenu } from './MobileMenu.jsx';
import { HeaderIconButton } from './HeaderIconButton.jsx';
import { NotificationBell } from './NotificationBell.jsx';
import { ThemeToggle } from '../ThemeToggle.jsx';
import { useTaxonomy } from '../../../hooks/useTaxonomy.js';
import { useAuthStore } from '../../../stores/useAuthStore.js';
import { useCartStore } from '../../../stores/useCartStore.js';
import { useWishlistStore } from '../../../stores/useWishlistStore.js';

/**
 * Production Tech Pulse ecommerce header.
 *
 * Hierarchy: announcement bar → dark main navbar → desktop category
 * mega menu → expandable search panel → account dropdown → mobile menu +
 * backdrop. The `<header>` is sticky (`z-40`); overlays layer inside its
 * stacking context (backdrop 30 < panels 40 < account dropdown 50).
 *
 * Data flow (no fetch in presentation components):
 * `useTaxonomy()` → normalized taxonomy (+ active category) → passed as
 * props to CategoryMegaMenu / MobileMenu / SearchPanel. Auth comes from
 * `useSession`, suggestions from `services/search.service.js`.
 * Wishlist/cart render as plain icon links — counts and badges arrive with
 * their store milestones.
 */
export function Header() {
  const { pathname } = useLocation();
  const { taxonomy, activeSlug, setActiveSlug } = useTaxonomy();
  const isAuthenticated = Boolean(useAuthStore((state) => state.accessToken));
  const cartCount = useCartStore((state) => state.cart.totalQuantity);
  const wishlistCount = useWishlistStore((state) => state.wishlist.itemCount);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [megaOpen, setMegaOpen] = useState(false);

  const megaCloseTimer = useRef(null);
  const megaTriggerRef = useRef(null);
  const menuButtonRef = useRef(null);
  const accountWrapRef = useRef(null);
  const [prevPathname, setPrevPathname] = useState(pathname);

  // Overlays close on navigation (link clicks, submit redirects, back/forward).
  // Render-time state adjustment (the sanctioned pattern for derived resets):
  // all overlay state is local, so this converges after a single re-render.
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setMobileOpen(false);
    setSearchOpen(false);
    setAccountOpen(false);
    setMegaOpen(false);
  }

  const cancelMegaClose = useCallback(() => {
    if (megaCloseTimer.current) {
      clearTimeout(megaCloseTimer.current);
      megaCloseTimer.current = null;
    }
  }, []);

  const scheduleMegaClose = useCallback(() => {
    cancelMegaClose();
    megaCloseTimer.current = setTimeout(() => setMegaOpen(false), 180);
  }, [cancelMegaClose]);

  const openMega = useCallback(() => {
    cancelMegaClose();
    setMegaOpen(true);
  }, [cancelMegaClose]);

  // Dismiss the mobile menu, optionally returning focus to the hamburger
  // trigger (Escape/backdrop dismissal). Route navigation uses the plain
  // close path so focus is never yanked back after a page change, and the
  // trigger lives in the persistent header so it cannot be unmounted.
  const closeMobileMenu = useCallback((returnFocus = false) => {
    setMobileOpen(false);
    if (returnFocus) {
      requestAnimationFrame(() => {
        menuButtonRef.current?.focus({ preventScroll: true });
      });
    }
  }, []);

  // Outside-click for the account dropdown.
  useEffect(() => {
    if (!accountOpen) return;
    const handlePointerDown = (event) => {
      if (accountWrapRef.current && !accountWrapRef.current.contains(event.target)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [accountOpen]);

  // Escape closes the topmost overlay; `/` opens search from anywhere sensible.
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (accountOpen) {
          setAccountOpen(false);
        } else if (searchOpen) {
          setSearchOpen(false);
        } else if (megaOpen) {
          setMegaOpen(false);
          megaTriggerRef.current?.focus();
        } else if (mobileOpen) {
          closeMobileMenu(true);
        }
        return;
      }
      if (event.key === '/' && !searchOpen && !mobileOpen) {
        const target = event.target;
        const typing =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          (target instanceof HTMLElement && target.isContentEditable);
        if (!typing) {
          event.preventDefault();
          setSearchOpen(true);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [accountOpen, searchOpen, megaOpen, mobileOpen, closeMobileMenu]);

  // Lock body scroll while the mobile menu is open.
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  // Clear the pending mega-menu close on unmount.
  useEffect(() => () => cancelMegaClose(), [cancelMegaClose]);

  const closeOverlaysForNavigate = useCallback(() => {
    setMegaOpen(false);
    setSearchOpen(false);
    setMobileOpen(false);
    setAccountOpen(false);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <header className="sticky top-0 z-40">
      <AnnouncementBar />

      <div className="relative border-b border-header-border bg-header text-header-foreground">
        <div className="tp-container flex h-16 items-center gap-1 sm:gap-2">
          {/* LEFT: hamburger (mobile/tablet) + brand */}
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMobileOpen((value) => !value)}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-header-foreground transition-colors duration-200 hover:bg-header-foreground/10 hover:text-accent lg:hidden"
          >
            {mobileOpen ? (
              <X size={22} aria-hidden="true" />
            ) : (
              <Menu size={22} aria-hidden="true" />
            )}
          </button>
          <BrandMark className="mr-1 sm:mr-3" />

          {/* CENTER: desktop primary nav */}
          <div className="min-w-0 flex-1">
            <DesktopNav
              megaOpen={megaOpen}
              onCategoriesEnter={openMega}
              onCategoriesLeave={scheduleMegaClose}
              onCategoriesToggle={() => setMegaOpen((value) => !value)}
              triggerRef={megaTriggerRef}
            />
          </div>

          {/* RIGHT: icon cluster — Search | Wishlist | Cart | Account | Theme */}
          <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
            <HeaderIconButton
              label={searchOpen ? 'Close search' : 'Open search'}
              aria-expanded={searchOpen}
              onClick={() => {
                setSearchOpen((value) => !value);
                setMegaOpen(false);
              }}
            >
              {searchOpen ? (
                <X size={20} aria-hidden="true" />
              ) : (
                <Search size={20} aria-hidden="true" />
              )}
            </HeaderIconButton>

            <Link
              to="/wishlist"
              aria-label={wishlistCount > 0 ? `Wishlist, ${wishlistCount} saved` : 'Wishlist'}
              title="Wishlist"
              className="relative hidden h-10 w-10 items-center justify-center rounded-lg text-header-foreground transition-colors duration-200 hover:bg-header-foreground/10 hover:text-accent hover:no-underline sm:inline-flex"
            >
              <Heart size={20} aria-hidden="true" />
              {wishlistCount > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-0.5 -top-0.5 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold leading-5 text-accent-foreground"
                >
                  {wishlistCount > 99 ? '99+' : wishlistCount}
                </span>
              ) : null}
            </Link>

            <Link
              to="/cart"
              aria-label={cartCount > 0 ? `Cart, ${cartCount} items` : 'Cart'}
              title="Cart"
              className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg text-header-foreground transition-colors duration-200 hover:bg-header-foreground/10 hover:text-accent hover:no-underline"
            >
              <ShoppingCart size={20} aria-hidden="true" />
              {cartCount > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-0.5 -top-0.5 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold leading-5 text-accent-foreground"
                >
                  {cartCount > 99 ? '99+' : cartCount}
                </span>
              ) : null}
            </Link>
            <span aria-live="polite" className="sr-only">
              {cartCount > 0 ? `${cartCount} items in cart` : 'Cart is empty'}
            </span>

            {isAuthenticated ? <NotificationBell /> : null}

            <div ref={accountWrapRef} className="relative hidden sm:block">
              <HeaderIconButton
                label="Account"
                aria-haspopup="true"
                aria-expanded={accountOpen}
                onClick={() => setAccountOpen((value) => !value)}
              >
                <User size={20} aria-hidden="true" />
              </HeaderIconButton>
              <AnimatePresence>
                {accountOpen ? (
                  <AccountMenu onClose={() => setAccountOpen(false)} onNavigate={closeOverlaysForNavigate} />
                ) : null}
              </AnimatePresence>
            </div>

            <ThemeToggle className="hidden h-10 w-10 border-header-border bg-transparent text-header-foreground hover:bg-header-foreground/10 hover:text-accent md:inline-flex" />
          </div>
        </div>

        {/* Overlays (positioned against the navbar, above page content).
            Each AnimatePresence stays mounted so exit animations can play;
            state ownership and close behavior are unchanged. */}
        <AnimatePresence>
          {megaOpen ? (
            <CategoryMegaMenu
              categories={taxonomy}
              activeSlug={activeSlug}
              onActiveChange={setActiveSlug}
              onNavigate={closeOverlaysForNavigate}
              onEnter={cancelMegaClose}
              onLeave={scheduleMegaClose}
            />
          ) : null}
        </AnimatePresence>
        <AnimatePresence>
          {searchOpen ? <SearchPanel categories={taxonomy} onClose={() => setSearchOpen(false)} /> : null}
        </AnimatePresence>
        <AnimatePresence>
          {mobileOpen ? (
            <MobileMenu
              categories={taxonomy}
              onClose={() => closeMobileMenu(true)}
              onNavigate={closeOverlaysForNavigate}
            />
          ) : null}
        </AnimatePresence>
      </div>
      </header>
    </MotionConfig>
  );
}
