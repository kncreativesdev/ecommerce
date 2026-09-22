import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, ChevronDown, Mail, MapPin, Phone, Zap } from 'lucide-react';
import { siteConfig } from '../../config/site.js';
import { env } from '../../config/env.js';
import { useTaxonomy } from '../../hooks/useTaxonomy.js';
import { categoryRouteParam } from '../../utils/categoryAdapter.js';
import { cn } from '../../lib/cn.js';

/**
 * Production Tech Pulse footer (DESIGN_SYSTEM.md §19).
 *
 * - Desktop: 4 columns (Shop / Help / About / Contact) + bottom bar with
 *   copyright and a cash-only COD note. No payment-brand icons, no fake
 *   social-proof widgets, no newsletter form (would be decorative without
 *   a backend — deliberately omitted).
 * - Mobile: the same columns as stacked accordions (buttons with
 *   `aria-expanded`, keyboard reachable, Esc collapses).
 * - Shop links are taxonomy-driven (live categories + static entries);
 *   contact details reuse the Support-page honesty convention (configured
 *   email, explicit "coming soon" placeholders — never invented data).
 */
const linkClass =
  'inline-flex min-h-[44px] items-center text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground hover:no-underline lg:min-h-0 lg:py-1';

function FooterColumn({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-border py-1 lg:border-0 lg:py-0">
      <h3 className="hidden text-sm font-bold tracking-tight text-foreground lg:block">
        {title}
      </h3>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        className="flex min-h-[48px] w-full cursor-pointer items-center justify-between rounded-lg text-sm font-bold text-foreground lg:hidden"
      >
        {title}
        <ChevronDown
          size={17}
          aria-hidden="true"
          className={cn(
            'shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>
      {/* Mobile accordion body: CSS grid-rows collapse (no unmount, no fixed
          max-height) so open and close both animate. `invisible` removes
          collapsed links from keyboard focus; `lg:visible` keeps the desktop
          columns always reachable. Matches --tp-duration-base. */}
      <div
        className={cn(
          'grid transition-[grid-template-rows,visibility] duration-200 ease-out lg:grid-rows-[1fr] lg:visible',
          open ? 'grid-rows-[1fr] visible' : 'grid-rows-[0fr] invisible',
        )}
      >
        <div className="min-h-0 overflow-hidden lg:overflow-visible">
          <div className="pb-3 lg:pb-0 lg:pt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  const { taxonomy } = useTaxonomy();
  const shopCategories = (taxonomy ?? []).slice(0, 4);

  return (
    <footer className="border-t border-border bg-surface">
      <div className="tp-container py-8 lg:py-12">
        <nav
          aria-label="Footer"
          className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8"
        >
          <FooterColumn title="Shop">
            <ul className="flex flex-col lg:gap-0.5">
              <li>
                <Link to="/shop" className={linkClass}>
                  All Products
                </Link>
              </li>
              <li>
                <Link to="/shop?sort=newest" className={linkClass}>
                  New Arrivals
                </Link>
              </li>
              {shopCategories.map((category) => (
                <li key={category.slug ?? category.id}>
                  <Link
                    to={`/category/${categoryRouteParam(category)}`}
                    className={linkClass}
                  >
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          </FooterColumn>

          <FooterColumn title="Help">
            <ul className="flex flex-col lg:gap-0.5">
              <li>
                <Link to="/support" className={linkClass}>
                  Customer Support
                </Link>
              </li>
              <li>
                <Link to="/account/orders" className={linkClass}>
                  My Orders
                </Link>
              </li>
              <li>
                <Link to="/wishlist" className={linkClass}>
                  My Wishlist
                </Link>
              </li>
              <li>
                <Link to="/account" className={linkClass}>
                  My Account
                </Link>
              </li>
            </ul>
          </FooterColumn>

          <FooterColumn title="About">
            <div className="flex flex-col items-start gap-3 py-1">
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-foreground"
                >
                  <Zap size={17} strokeWidth={2.5} fill="currentColor" />
                </span>
                <span className="text-sm font-extrabold tracking-tight text-foreground">
                  {siteConfig.brandShortName}
                </span>
              </span>
              <p className="max-w-xs text-sm leading-6 text-muted-foreground">
                {siteConfig.tagline} Original Tech Pulse gadgets with honest
                pricing and Cash on Delivery.
              </p>
              <Link
                to="/about"
                className="inline-flex min-h-[44px] items-center text-sm font-semibold text-accent-link hover:no-underline lg:min-h-0"
              >
                Our story
              </Link>
            </div>
          </FooterColumn>

          <FooterColumn title="Contact">
            <ul className="flex flex-col gap-1 py-1 text-sm">
              <li>
                <a
                  href={`mailto:${env.supportEmail}`}
                  className="inline-flex min-h-[44px] items-center gap-2.5 text-muted-foreground transition-colors duration-200 hover:text-foreground hover:no-underline lg:min-h-0 lg:py-1"
                >
                  <Mail size={15} aria-hidden="true" className="shrink-0" />
                  {env.supportEmail}
                </a>
              </li>
              <li className="inline-flex min-h-[44px] items-center gap-2.5 text-muted-foreground lg:min-h-0 lg:py-1">
                <Phone size={15} aria-hidden="true" className="shrink-0" />
                Phone line coming soon
              </li>
              <li className="inline-flex min-h-[44px] items-center gap-2.5 text-muted-foreground lg:min-h-0 lg:py-1">
                <MapPin size={15} aria-hidden="true" className="shrink-0" />
                Store address coming soon
              </li>
            </ul>
          </FooterColumn>
        </nav>

        <div className="mt-6 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            © {year} {siteConfig.brandName}. All rights reserved.
          </p>
          <p className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground">
            <Banknote size={14} aria-hidden="true" className="text-accent" />
            Cash on Delivery available
          </p>
        </div>
      </div>
    </footer>
  );
}
