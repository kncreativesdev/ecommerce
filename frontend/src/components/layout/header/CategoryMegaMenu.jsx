import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, ChevronRight, LayoutGrid } from 'lucide-react';
import {
  categoryRouteParam,
  subcategoryShopLink,
} from '../../../utils/categoryAdapter.js';
import { SubcategoryThumb } from './SubcategoryThumb.jsx';
import { CategoryImage } from '../../catalog/CategoryImage.jsx';
import { cn } from '../../../lib/cn.js';
import { panelDownVariants } from '../../../lib/menuMotion.js';

/**
 * Desktop category mega menu: left top-level category list, right
 * sub-product-category grid for the active category. Mounted only while
 * open. Opens on hover/focus of the Categories trigger with a small close
 * delay; entering the panel cancels the close; switching categories updates
 * only the right side (the menu never closes/reopens). Escape closes.
 * Adapts to both themes via surface tokens; red accents mark active/hover.
 *
 * Pure presentational: renders the normalized `categories` prop supplied by
 * the header (taxonomy store). Never fetches, never imports taxonomy data.
 */
export function CategoryMegaMenu({ categories = [], activeSlug, onActiveChange, onNavigate, onEnter, onLeave }) {
  const [focusedSlug, setFocusedSlug] = useState(null);
  const current = categories.find((c) => c.slug === (focusedSlug ?? activeSlug)) ?? categories[0];

  if (!current) return null;

  return (
    <motion.div
      role="menu"
      aria-label="Categories"
      variants={panelDownVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="absolute inset-x-0 top-full z-40 hidden lg:block"
    >
      <div className="tp-container">
        <div className="grid grid-cols-[260px_1fr] gap-0 overflow-hidden rounded-b-2xl border border-border bg-surface-elevated shadow-2xl">
          {/* LEFT: top-level category list */}
          <ul className="border-r border-border py-2" aria-label="Category list">
            <li>
              <Link
                to="/shop"
                onClick={onNavigate}
                className="flex min-h-[44px] items-center gap-3 px-4 text-[13px] font-semibold text-foreground transition-colors duration-200 hover:bg-surface-muted hover:no-underline"
              >
                <LayoutGrid size={17} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                All Products
              </Link>
            </li>
            {categories.map((category) => {
              const isActive = category.slug === current.slug;
              return (
                <li key={category.slug}>
                  <Link
                    to={`/category/${categoryRouteParam(category)}`}
                    role="menuitem"
                    onClick={onNavigate}
                    onMouseEnter={() => {
                      onActiveChange(category.slug);
                      setFocusedSlug(null);
                    }}
                    onFocus={() => {
                      onActiveChange(category.slug);
                      setFocusedSlug(null);
                    }}
                    className={cn(
                      'group relative flex min-h-[44px] items-center gap-3 px-4 text-[13px] font-medium transition-colors duration-200 hover:no-underline',
                      isActive
                        ? 'bg-surface-muted font-semibold text-foreground'
                        : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-accent transition-opacity duration-200',
                        isActive ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <CategoryImage
                      image={category.image}
                      name={category.name}
                      icon={category.icon}
                      className="h-7 w-7 rounded-lg [&_svg]:size-4"
                    />
                    <span className="flex-1">{category.name}</span>
                    <ChevronRight
                      size={15}
                      aria-hidden="true"
                      className={cn(
                        'shrink-0 transition-all duration-200',
                        isActive
                          ? 'translate-x-0 text-accent opacity-100'
                          : '-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-60',
                      )}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* RIGHT: active category's sub-product-category grid */}
          <div key={current.slug} className="flex min-h-[320px] flex-col p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                {current.name}
              </p>
              <Link
                to={`/category/${categoryRouteParam(current)}`}
                onClick={onNavigate}
                onFocus={() => setFocusedSlug(current.slug)}
                className="inline-flex min-h-[32px] items-center gap-1 rounded-lg px-2 text-xs font-semibold text-accent transition-colors duration-200 hover:bg-accent hover:text-accent-foreground hover:no-underline"
              >
                View all {current.name}
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
            <ul
              aria-label={`${current.name} subcategories`}
              className="grid flex-1 grid-cols-2 content-start gap-2 xl:grid-cols-3"
            >
              {current.subcategories.map((subcategory) => (
                <li key={subcategory.slug}>
                  <Link
                    to={subcategoryShopLink(current.slug, subcategory.slug)}
                    onClick={onNavigate}
                    className="group flex min-h-[68px] items-center gap-3 rounded-xl border border-transparent p-2.5 transition-all duration-200 hover:translate-x-0.5 hover:border-border hover:bg-surface-muted hover:no-underline"
                  >
                    <SubcategoryThumb subcategory={subcategory} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] font-semibold text-foreground transition-colors duration-200 group-hover:text-accent">
                        {subcategory.name}
                      </span>
                      {subcategory.blurb ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {subcategory.blurb}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
