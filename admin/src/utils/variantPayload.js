/**
 * Variant payload adapter (mirrors `utils/productPayload.js` for products):
 * the single place that shapes form values into strict backend bodies.
 * Only documented variant fields are ever sent (`sku`, `name`, `price`,
 * plus `compareAtPrice`/`barcode`/`weight` when filled). No stock,
 * inventory, media, or product fields — separate concerns.
 */
export function buildVariantPayload(values) {
  const body = {
    sku: values.sku.trim(),
    name: values.name.trim(),
    price: values.price.trim(),
  };
  if (values.compareAtPrice?.trim()) body.compareAtPrice = values.compareAtPrice.trim();
  if (values.barcode?.trim()) body.barcode = values.barcode.trim();
  if (values.weight?.trim()) body.weight = values.weight.trim();
  return body;
}
