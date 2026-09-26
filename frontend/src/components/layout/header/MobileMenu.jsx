import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Bell, ChevronDown, Heart, LayoutGrid, LogOut, Sparkles, UserRound } from 'lucide-react';
import {
  categoryRouteParam,
  subcategoryShopLink,
} from '../../../utils/categoryAdapter.js';
import { SubcategoryThumb } from './SubcategoryThumb.jsx';
import { CategoryImage } from '../../catalog/CategoryImage.jsx';
import { ThemeToggle } from '../ThemeToggle.jsx';
import { useSession } from '../../../hooks/useSession.js';
import { useNotificationsStore } from '../../../stores/useNotificationsStore.js';
import { cn } from '../../../lib/cn.js';
import { backdropVariants, drawerVariants } from '../../../lib/menuMotion.js';

/**
 * Mobile/tablet navigation: slide-down panel below the header + backdrop.
 * Uncrowded by rule — All Products, expandable Categories (each top-level
 * category expands to its sub-product-category list from the normalized
 * taxonomy prop), New Arrivals, About Us, Support, account section, theme
 * row. Backdrop click, Escape (handled by parent), or any navigation closes
 * the menu; the menu unmounts on close so expanded state resets.
 *
 * Pure presentational: renders the `categories` prop supplied by the header
 * (taxonomy store). Never fetches, never imports taxonomy data.
 *
 * Close semantics: `onClose` dismisses (backdrop) and returns focus to the
 * header trigger; `onNavigate` plain-closes for route changes so focus is
 * never yanked back after navigation.
 */
export function MobileMenu({ categories = [], onClose, onNavigate }) {
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState(null);
  const { isAuthenticated, signOut } = useSession();
  const navigate = useNavigate();
  // Read-only badge mirror (populated by the bell's auth fetch) — this menu
  // stays presentational and never fetches.
  const unreadCount = useNotificationsStore((state) => state.unreadCount);

  const linkClass =
    'flex min-h-[48px] items-center rounded-xl px-3 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-surface-muted hover:no-underline';

  return (
    <>
      {/* Scrim: raw black/50 is intentional — no semantic token expresses a
          theme-invariant dimming overlay, and it must read identically in
          both themes. */}
      <motion.div
        aria-hidden="true"
        onClick={onClose}
        variants={backdropVariants}
        initial="hidden"
        animate="visible"
        exit="hidden"
        className="fixed inset-0 z-30 bg-black/50 lg:hidden"
      />
      <motion.nav
        aria-label="Mobile"
        variants={drawerVariants}
        initial="hidden"
        animate="visible"
        exit="hidden"
        className="absolute inset-x-0 top-full z-40 max-h-[70svh] overflow-y-auto border-t border-border bg-surface shadow-2xl lg:hidden"
      >
        <ul className="tp-container flex flex-col gap-0.5 py-3">
          <li>
            <Link to="/shop" onClick={onNavigate} className={linkClass}>
              <LayoutGrid size={18} aria-hidden="true" className="mr-3 shrink-0 text-muted-foreground" />
              All Products
            </Link>
          </li>
          <li>
            <button
              type="button"
              onClick={() => setCategoriesExpanded((value) => !value)}
              aria-expanded={categoriesExpanded}
              className={cn(linkClass, 'w-full cursor-pointer text-left')}
            >
              <Sparkles size={18} aria-hidden="true" className="mr-3 shrink-0 text-muted-foreground" />
              <span className="flex-1">Categories</span>
              <ChevronDown
                size={17}
                aria-hidden="true"
                className={cn(
                  'shrink-0 text-muted-foreground transition-transform duration-200',
                  categoriesExpanded && 'rotate-180',
                )}
              />
            </button>
            {/* Category accordion: CSS grid-rows collapse (no unmount) so both
                open and close animate; `invisible` removes collapsed links
                from keyboard focus. Matches --tp-duration-base. */}
            <div
              className={cn(
                'grid transition-[grid-template-rows,visibility] duration-200 ease-out',
                categoriesExpanded ? 'grid-rows-[1fr] visible' : 'grid-rows-[0fr] invisible',
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <ul aria-label="Categories" className="mb-1 flex flex-col gap-0.5">
                {categories.map((category) => {
                  const isOpen = expandedCategory === category.slug;
                  return (
                    <li key={category.slug} className="rounded-xl">
                      <button
                        type="button"
                        onClick={() => setExpandedCategory(isOpen ? null : category.slug)}
                        aria-expanded={isOpen}
                        className="flex min-h-[44px] w-full cursor-pointer items-center gap-2.5 rounded-xl px-2 text-left text-sm text-muted-foreground transition-colors duration-200 hover:text-accent"
                      >
                        <CategoryImage
                          image={category.image}
                          name={category.name}
                          icon={category.icon}
                          className="h-8 w-8 rounded-lg [&_svg]:size-4"
                        />
                        <span className="flex-1 font-medium">{category.name}</span>
                        <ChevronDown
                          size={16}
                          aria-hidden="true"
                          className={cn(
                            'shrink-0 transition-transform duration-200',
                            isOpen && 'rotate-180',
                          )}
                        />
                      </button>
                      {/* Subcategory accordion: same grid-rows collapse pattern. */}
                      <div
                        className={cn(
                          'grid transition-[grid-template-rows,visibility] duration-200 ease-out',
                          isOpen ? 'grid-rows-[1fr] visible' : 'grid-rows-[0fr] invisible',
                        )}
                      >
                        <div className="min-h-0 overflow-hidden">
                          <ul
                            aria-label={`${category.name} subcategories`}
                            className="mb-1 ml-4 flex flex-col gap-0.5 border-l-2 border-accent pl-2"
                          >
                            <li>
                              <Link
                                to={`/category/${categoryRouteParam(category)}`}
                                onClick={onNavigate}
                                className="flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-accent hover:no-underline"
                              >
                                View all {category.name}
                                <ArrowRight size={14} aria-hidden="true" />
                              </Link>
                            </li>
                            {category.subcategories.map((subcategory) => (
                              <li key={subcategory.slug}>
                                <Link
                                  to={subcategoryShopLink(category.slug, subcategory.slug)}
                                  onClick={onNavigate}
                                  className="group flex min-h-[44px] items-center gap-2.5 rounded-lg px-2 text-sm text-muted-foreground transition-colors duration-200 hover:text-accent hover:no-underline"
                                >
                                  <SubcategoryThumb subcategory={subcategory} size="sm" />
                                  {subcategory.name}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </li>
                  );
                })}
                </ul>
              </div>
            </div>
          </li>
          <li>
            <Link to="/shop?sort=newest" onClick={onNavigate} className={linkClass}>
              <Sparkles size={18} aria-hidden="true" className="mr-3 shrink-0 text-muted-foreground" />
              New Arrivals
            </Link>
          </li>
          <li>
            <Link to="/about" onClick={onNavigate} className={linkClass}>
              About Us
            </Link>
          </li>
          <li>
            <Link to="/support" onClick={onNavigate} className={linkClass}>
              Support
            </Link>
          </li>
          <li>
            <Link to="/wishlist" onClick={onNavigate} className={linkClass}>
              <Heart size={18} aria-hidden="true" className="mr-3 shrink-0 text-muted-foreground" />
              Wishlist
            </Link>
          </li>
          {isAuthenticated ? (
            <li
              aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications — no notifications yet'}
              className="flex min-h-[48px] items-center rounded-xl px-3"
            >
              <Bell size={18} aria-hidden="true" className="mr-3 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-foreground">Notifications</span>
                <span className="truncate text-xs text-muted-foreground">
                  {unreadCount > 0
                    ? `${unreadCount} unread update${unreadCount === 1 ? '' : 's'} — order updates will appear here.`
                    : 'No notifications yet — order updates will appear here.'}
                </span>
              </span>
              {unreadCount > 0 ? (
                <span
                  aria-hidden="true"
                  className="ml-2 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold leading-5 text-accent-foreground"
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              ) : null}
            </li>
          ) : null}
          <li className="mt-1 border-t border-border pt-2">
            {isAuthenticated ? (
              <>
                <Link to="/account" onClick={onNavigate} className={linkClass}>
                  <UserRound size={18} aria-hidden="true" className="mr-3 shrink-0 text-muted-foreground" />
                  My Account
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    signOut();
                    onNavigate();
                    navigate('/');
                  }}
                  className={cn(linkClass, 'w-full cursor-pointer text-left')}
                >
                  <LogOut size={18} aria-hidden="true" className="mr-3 shrink-0 text-muted-foreground" />
                  Sign Out
                </button>
              </>
            ) : (
              <Link to="/login" onClick={onNavigate} className={linkClass}>
                <UserRound size={18} aria-hidden="true" className="mr-3 shrink-0 text-muted-foreground" />
                Login / Register
              </Link>
            )}
          </li>
          <li className="flex min-h-[48px] items-center justify-between rounded-xl px-3">
            <span className="text-sm font-medium text-foreground">Theme</span>
            <ThemeToggle />
          </li>
        </ul>
      </motion.nav>
    </>
  );
}
