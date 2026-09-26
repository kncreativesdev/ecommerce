import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LayoutGrid, Package, Search, X } from 'lucide-react';
import { CategoryImage } from '../../catalog/CategoryImage.jsx';
import { categoryRouteParam } from '../../../utils/categoryAdapter.js';
import { getSearchSuggestions } from '../../../utils/productAdapter.js';
import { useProducts } from '../../../hooks/useProducts.js';
import { panelDownVariants } from '../../../lib/menuMotion.js';
import { cn } from '../../../lib/cn.js';

/**
 * Expandable full-width search panel below the navbar (dark in both themes).
 * Mounted only while open, so query state is fresh on every open. Local
 * query state only — submit navigates to the canonical `/shop?q=…` listing
 * via React Router. Escape or outside click closes.
 *
 * Search-as-you-type suggestions come from the real catalog cache
 * (`GET /products` via `useProducts`, shared with the rest of the
 * storefront — no per-keystroke fetching) matched through
 * `getSearchSuggestions` (no backend search endpoint exists —
 * API_INTEGRATION §7 / GAP-04). Product rows navigate to
 * `/product/:id`, category rows to `/category/:id`, and the trailing row
 * (or Enter with no highlight) to `/shop?q=…`. The URL query stays the
 * source of truth for the results page.
 */
export function SearchPanel({ categories = [], onClose }) {
  const navigate = useNavigate();
  const { products } = useProducts();
  const [query, setQuery] = useState('');
  // Index into the flat suggestion rows below (-1 = no highlight).
  const [activeIndex, setActiveIndex] = useState(-1);
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Focus the input on mount (panel enter animation is transform-only, so
  // focus is valid immediately).
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (panelRef.current && !panelRef.current.contains(event.target)) onClose();
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [onClose]);

  const trimmed = query.trim();
  const showSuggestions = trimmed.length >= 2;

  const { categories: matchedCategories, products: matchedProducts } = useMemo(
    () => getSearchSuggestions(products, categories, query),
    [products, categories, query],
  );

  // Flat keyboard-navigable rows: products, then categories, then the
  // generic "see all results" row (always present for a non-empty query).
  const rows = useMemo(() => {
    if (!showSuggestions) return [];
    return [
      ...matchedProducts.map((product) => ({ type: 'product', key: product.id, product })),
      ...matchedCategories.map((category) => ({
        type: 'category',
        key: category.id ?? category.slug,
        category,
      })),
      { type: 'query', key: '__query', query: trimmed },
    ];
  }, [showSuggestions, matchedProducts, matchedCategories, trimmed]);

  // Reset the highlight whenever the row list changes (render-time
  // adjustment — the sanctioned derived-state pattern, same as
  // `useCatalogSearch`; avoids setState-in-effect cascading renders).
  const rowSignature = `${trimmed}::${rows.length}`;
  const [prevSignature, setPrevSignature] = useState(rowSignature);
  if (prevSignature !== rowSignature) {
    setPrevSignature(rowSignature);
    setActiveIndex(-1);
  }

  // Keep the highlighted row visible without smooth scrolling (instant =
  // reduced-motion safe by construction).
  useEffect(() => {
    if (activeIndex < 0) return;
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const goToSearch = (value) => {
    const params = new URLSearchParams();
    const text = value.trim();
    if (text) params.set('q', text);
    onClose();
    navigate(`/shop${params.toString() ? `?${params.toString()}` : ''}`);
  };

  const selectRow = (row) => {
    if (!row) return;
    if (row.type === 'product') {
      onClose();
      navigate(`/product/${row.product.id}`);
    } else if (row.type === 'category') {
      onClose();
      navigate(`/category/${categoryRouteParam(row.category)}`);
    } else {
      goToSearch(row.query);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    if (activeIndex >= 0 && rows[activeIndex]) {
      selectRow(rows[activeIndex]);
    } else {
      goToSearch(query);
    }
  };

  const handleInputKeyDown = (event) => {
    if (event.key === 'ArrowDown' && rows.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % rows.length);
    } else if (event.key === 'ArrowUp' && rows.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + rows.length) % rows.length);
    } else if (event.key === 'Escape') {
      // The header-level handler also closes on Escape; both call the
      // same idempotent `onClose`.
      onClose();
    }
  };

  const activeId = activeIndex >= 0 ? `header-search-option-${activeIndex}` : undefined;

  return (
    <motion.div
      ref={panelRef}
      variants={panelDownVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
      className="absolute inset-x-0 top-full z-40 border-t border-header-border bg-header shadow-2xl"
    >
      <div className="tp-container py-5">
        <form role="search" onSubmit={submit} className="mx-auto flex max-w-2xl items-center gap-2">
          <label htmlFor="header-search" className="sr-only">
            Search products
          </label>
          <div className="relative flex-1">
            <Search
              size={18}
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-header-muted"
            />
            <input
              ref={inputRef}
              id="header-search"
              type="search"
              role="combobox"
              aria-expanded={showSuggestions}
              aria-controls="header-search-listbox"
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Search gadgets, accessories, brands…"
              autoComplete="off"
              className="h-12 w-full rounded-full border border-header-border bg-header-foreground/5 pl-11 pr-11 text-sm text-header-foreground placeholder:text-header-muted focus:border-accent focus:outline-none"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-header-muted transition-colors duration-200 hover:bg-header-foreground/10 hover:text-header-foreground"
              >
                <X size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <button
            type="submit"
            className="inline-flex h-12 shrink-0 cursor-pointer items-center rounded-full bg-accent px-6 text-sm font-semibold text-accent-foreground transition-colors duration-200 hover:bg-accent-hover"
          >
            Search
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full text-header-muted transition-colors duration-200 hover:bg-header-foreground/10 hover:text-header-foreground"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </form>

        <div className="mx-auto mt-4 max-w-2xl">
          {showSuggestions ? (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-header-muted">
                Suggestions
              </p>
              {rows.length === 1 ? (
                <p className="mt-2 px-3 text-sm text-header-muted">
                  No suggestions for “{trimmed}” — press Enter to search anyway.
                </p>
              ) : null}
              <ul
                ref={listRef}
                id="header-search-listbox"
                role="listbox"
                aria-label="Search suggestions"
                className="mt-2 flex max-h-[40svh] flex-col gap-1 overflow-y-auto"
              >
                {rows.map((row, index) => (
                  <li
                    key={`${row.type}-${row.key}`}
                    id={`header-search-option-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    data-index={index}
                  >
                    <SuggestionRow
                      row={row}
                      active={index === activeIndex}
                      onSelect={() => selectRow(row)}
                      onHover={() => setActiveIndex(index)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-header-muted">
                Popular categories
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {categories.slice(0, 6).map((category) => (
                  <li key={category.slug}>
                    <Link
                      to={`/category/${categoryRouteParam(category)}`}
                      onClick={onClose}
                      className="inline-flex min-h-[36px] items-center rounded-full border border-header-border px-3.5 text-xs font-medium text-header-foreground transition-colors duration-200 hover:border-accent hover:text-accent hover:no-underline"
                    >
                      {category.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function SuggestionRow({ row, active, onSelect, onHover }) {
  if (row.type === 'product') {
    const context = row.product.category?.name ?? row.product.brand ?? '';
    return (
      <button
        type="button"
        onClick={onSelect}
        onMouseEnter={onHover}
        tabIndex={-1}
        className={cn(
          'flex min-h-[48px] w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left transition-colors duration-150',
          active ? 'bg-header-foreground/10' : 'bg-transparent',
        )}
      >
        <span
          aria-hidden="true"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-header-foreground/5 text-header-muted"
        >
          <Package size={17} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-header-foreground">
            {row.product.name}
          </span>
          {context ? (
            <span className="truncate text-xs text-header-muted">{context}</span>
          ) : null}
        </span>
      </button>
    );
  }

  if (row.type === 'category') {
    return (
      <button
        type="button"
        onClick={onSelect}
        onMouseEnter={onHover}
        tabIndex={-1}
        className={cn(
          'flex min-h-[48px] w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left transition-colors duration-150',
          active ? 'bg-header-foreground/10' : 'bg-transparent',
        )}
      >
        <CategoryImage
          image={row.category.image}
          name={row.category.name}
          icon={row.category.icon ?? LayoutGrid}
          className="h-9 w-9 rounded-lg [&_svg]:size-[17px]"
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-header-foreground">
            {row.category.name}
          </span>
          <span className="truncate text-xs text-header-muted">Category</span>
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={onHover}
      tabIndex={-1}
      className={cn(
        'flex min-h-[48px] w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left transition-colors duration-150',
        active ? 'bg-header-foreground/10' : 'bg-transparent',
      )}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"
      >
        <Search size={17} />
      </span>
      <span className="truncate text-sm font-medium text-header-foreground">
        See all results for “{row.query}”
      </span>
    </button>
  );
}
