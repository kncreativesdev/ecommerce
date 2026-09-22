import { FormField, SelectInput, TextInput } from '../ui/FormField.jsx';
import { SHOP_SORT_OPTIONS } from '../../utils/productAdapter.js';

/**
 * Shop filter/sort controls (frontend-only).
 *
 * Presentational: every control is a controlled input whose value comes
 * from the page's URL state — this component never touches search params,
 * never fetches, and never filters. All derivation (brands, bounds,
 * thresholds) is computed by the page from the loaded catalog cache.
 */
export function ShopFilters({
  taxonomy = [],
  categorySlug,
  brands = [],
  brand,
  priceBounds = { min: null, max: null },
  minPrice,
  maxPrice,
  discountOptions = [],
  discount,
  featured,
  sort,
  onCategoryChange,
  onBrandChange,
  onMinPriceChange,
  onMaxPriceChange,
  onDiscountChange,
  onFeaturedChange,
  onSortChange,
}) {
  const showBrand = brands.length > 1;
  const showDiscount = discountOptions.length > 0;

  return (
    <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3 xl:grid-cols-6">
      <FormField label="Category">
        <SelectInput
          aria-label="Filter by category"
          value={categorySlug ?? ''}
          onChange={(event) => onCategoryChange(event.target.value)}
        >
          <option value="">All categories</option>
          {taxonomy.map((category) => (
            <option key={category.slug ?? category.id} value={category.slug}>
              {category.name}
            </option>
          ))}
        </SelectInput>
      </FormField>

      {showBrand ? (
        <FormField label="Brand">
          <SelectInput
            aria-label="Filter by brand"
            value={brand ?? ''}
            onChange={(event) => onBrandChange(event.target.value)}
          >
            <option value="">All brands</option>
            {brands.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </SelectInput>
        </FormField>
      ) : null}

      <FormField
        label="Price (₹)"
        hint={
          priceBounds.min !== null && priceBounds.max !== null
            ? `Catalog spans ₹${priceBounds.min} – ₹${priceBounds.max}`
            : undefined
        }
      >
        <div className="flex items-center gap-2">
          <TextInput
            type="number"
            min="0"
            inputMode="numeric"
            aria-label="Minimum price in rupees"
            placeholder={priceBounds.min !== null ? String(priceBounds.min) : 'Min'}
            value={minPrice ?? ''}
            onChange={(event) => onMinPriceChange(event.target.value)}
          />
          <span aria-hidden="true" className="shrink-0 text-muted-foreground">
            –
          </span>
          <TextInput
            type="number"
            min="0"
            inputMode="numeric"
            aria-label="Maximum price in rupees"
            placeholder={priceBounds.max !== null ? String(priceBounds.max) : 'Max'}
            value={maxPrice ?? ''}
            onChange={(event) => onMaxPriceChange(event.target.value)}
          />
        </div>
      </FormField>

      {showDiscount ? (
        <FormField label="Discount">
          <SelectInput
            aria-label="Filter by minimum discount"
            value={discount !== null && discount !== undefined ? String(discount) : ''}
            onChange={(event) => onDiscountChange(event.target.value)}
          >
            <option value="">Any discount</option>
            {discountOptions.map((threshold) => (
              <option key={threshold} value={String(threshold)}>
                {threshold}% and above
              </option>
            ))}
          </SelectInput>
        </FormField>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <span id="shop-featured-label" className="text-[13px] font-semibold text-foreground">
          Curation
        </span>
        <label
          htmlFor="shop-featured-only"
          className="inline-flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm text-foreground"
        >
          <input
            id="shop-featured-only"
            type="checkbox"
            aria-labelledby="shop-featured-label"
            checked={featured}
            onChange={(event) => onFeaturedChange(event.target.checked)}
            className="h-5 w-5 shrink-0 cursor-pointer accent-accent"
          />
          Featured only
        </label>
      </div>

      <FormField label="Sort by">
        <SelectInput
          aria-label="Sort products"
          value={sort ?? ''}
          onChange={(event) => onSortChange(event.target.value)}
        >
          <option value="">Recommended</option>
          {SHOP_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectInput>
      </FormField>
    </div>
  );
}
