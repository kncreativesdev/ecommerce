import { useMemo, useState } from 'react';
import { Pencil, Plus, Ban, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Table } from '../ui/Table.jsx';
import { Badge } from '../ui/Badge.jsx';
import { Button } from '../ui/Button.jsx';
import { EmptyState } from '../ui/EmptyState.jsx';
import { Modal } from '../ui/Modal.jsx';
import { VariantForm } from './VariantForm.jsx';
import { VariantMediaSection } from './VariantMediaSection.jsx';
import { formatINR } from '../../lib/format.js';
import { cn } from '../../lib/cn.js';
import {
  createVariant,
  deactivateVariant,
  updateVariant,
} from '../../services/product.service.js';

/**
 * Variant management section for the product edit page. List (shared
 * Table) + Add/Edit modal (VariantForm) + deactivate confirm (Modal).
 *
 * Contract notes (verified `products.*` backend):
 * - `DELETE /products/:productId/variants/:variantId` SOFT-DEACTIVATES
 *   (`isActive=false`) — the UI says "Deactivate", never "Delete".
 * - The admin product detail payload (`GET /products/:id?status=all`)
 *   embeds ALL variants, so lifecycle filtering is client-side over this
 *   authoritative list — no separate variant endpoint exists or is needed.
 * - Reactivate is the documented partial update
 *   `PATCH .../variants/:variantId { isActive: true }` (single-field body
 *   is valid; SKU/price/MRP/inventory are untouched).
 * - No stock/inventory columns — inventory lives in `InventoryManager`.
 * - `onChanged` asks the parent to refetch the product (and sync the list
 *   mirror); this component keeps no duplicate product state.
 */
const SCOPES = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];
const VARIANT_COLUMNS = [
  { key: 'sku', label: 'SKU' },
  { key: 'name', label: 'Name' },
  { key: 'price', label: 'Price', numeric: true },
  { key: 'compareAtPrice', label: 'Compare-at', numeric: true },
  { key: 'barcode', label: 'Barcode' },
  { key: 'weight', label: 'Weight', numeric: true },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: 'Actions', numeric: true },
];

export function VariantManager({ product, onChanged }) {
  const [modal, setModal] = useState(null); // null | { mode: 'create' } | { mode: 'edit', variant }
  const [deactivating, setDeactivating] = useState(null); // variant | null
  const [mutating, setMutating] = useState(false);
  const [activatingId, setActivatingId] = useState(null);
  const [scope, setScope] = useState('active');
  const productId = product?.id;

  const closeModal = () => {
    if (!mutating) setModal(null);
  };

  const handleSubmit = async (payload) => {
    if (!productId) throw new Error('Product is not loaded yet.');
    setMutating(true);
    try {
      if (modal?.mode === 'edit' && modal.variant?.id) {
        await updateVariant(productId, modal.variant.id, payload);
        toast.success(`Variant “${payload.name}” saved.`);
      } else {
        await createVariant(productId, payload);
        toast.success(`Variant “${payload.name}” added.`);
      }
      setModal(null);
      await onChanged();
    } catch (error) {
      if (error?.status === 404 || error?.code === 'PRODUCT_VARIANT_NOT_FOUND' || error?.code === 'PRODUCT_NOT_FOUND') {
        toast.error('This variant no longer exists — list refreshed.');
        setModal(null);
        await onChanged();
        return;
      }
      throw error;
    } finally {
      setMutating(false);
    }
  };

  const handleDeactivate = async () => {
    if (!productId || !deactivating?.id) return;
    setMutating(true);
    try {
      await deactivateVariant(productId, deactivating.id);
      toast.success(`Variant “${deactivating.sku}” deactivated — hidden from the storefront.`);
      setDeactivating(null);
      await onChanged();
    } catch (error) {
      if (error?.status === 404 || error?.code === 'PRODUCT_VARIANT_NOT_FOUND') {
        toast.success('Variant already deactivated.');
        setDeactivating(null);
        await onChanged();
      } else {
        toast.error(error?.message ?? 'Deactivate failed. Please try again.');
      }
    } finally {
      setMutating(false);
    }
  };

  const handleActivate = async (variant) => {
    if (!productId || !variant?.id || activatingId) return;
    setActivatingId(variant.id);
    try {
      // Lifecycle-only mutation: the backend copies just the provided
      // field, so SKU/price/MRP/barcode/weight/inventory are preserved.
      await updateVariant(productId, variant.id, { isActive: true });
      toast.success(`Variant “${variant.sku}” reactivated — purchasable again.`);
      await onChanged();
    } catch (error) {
      if (error?.status === 404 || error?.code === 'PRODUCT_VARIANT_NOT_FOUND') {
        toast.error('This variant no longer exists — list refreshed.');
        await onChanged();
      } else {
        toast.error(error?.message ?? 'Reactivation failed. Please try again.');
      }
    } finally {
      setActivatingId(null);
    }
  };

  const allVariants = useMemo(
    () => (Array.isArray(product?.variants) ? product.variants : []),
    [product],
  );
  const editingVariant = modal?.mode === 'edit' ? modal.variant : null;

  // Lifecycle filter over the authoritative detail payload (the backend
  // exposes no variant list endpoint — client-side is the only correct
  // place). Counts are cheap shards of the same array, same language as
  // the category/product scope controls.
  const { visible, activeCount, inactiveCount } = useMemo(() => {
    const active = allVariants.filter((variant) => variant.isActive !== false);
    const inactive = allVariants.filter((variant) => variant.isActive === false);
    return {
      visible: scope === 'active' ? active : scope === 'inactive' ? inactive : allVariants,
      activeCount: active.length,
      inactiveCount: inactive.length,
    };
  }, [allVariants, scope]);

  return (
    <div className="flex flex-col gap-4">
    <section aria-label="Variants" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">Variants</h3>
          <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
            {activeCount} active · {inactiveCount} inactive · purchasable units of this product
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Variant status filter" className="inline-flex rounded-lg border border-border bg-surface p-0.5">
            {SCOPES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setScope(option.value)}
                aria-pressed={scope === option.value}
                className={cn(
                  'inline-flex min-h-[32px] cursor-pointer items-center rounded-md px-3 text-[13px] font-medium transition-colors',
                  scope === option.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => setModal({ mode: 'create' })} disabled={!productId}>
            <Plus size={15} aria-hidden="true" />
            Add variant
          </Button>
        </div>
      </div>

      {allVariants.length === 0 ? (
        <div className="flex flex-col items-center gap-4">
          <EmptyState
            title="No variants yet"
            message="Add the first purchasable unit (SKU, name, price). The product becomes buyable once it has an active variant."
          />
          <Button size="sm" onClick={() => setModal({ mode: 'create' })} disabled={!productId}>
            <Plus size={15} aria-hidden="true" />
            Add variant
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          title={scope === 'inactive' ? 'No inactive variants' : 'No active variants'}
          message={
            scope === 'inactive'
              ? 'Every variant of this product is currently active.'
              : 'Every variant of this product is currently inactive — switch scope to review and reactivate them.'
          }
        />
      ) : (
        <Table caption={`Variants of ${product?.name ?? 'this product'}`} columns={VARIANT_COLUMNS} minWidth="min-w-[820px]">
          {visible.map((variant) => (
            <tr key={variant.id} className="transition-colors hover:bg-surface-muted/50">
              <td className="px-4 py-3 font-mono text-[13px] font-semibold text-foreground">{variant.sku}</td>
              <td className="px-4 py-3 font-medium text-foreground">{variant.name}</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">{formatINR(variant.price)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                {variant.compareAtPrice ? formatINR(variant.compareAtPrice) : '—'}
              </td>
              <td className="px-4 py-3 font-mono text-[13px] text-muted-foreground">{variant.barcode ?? '—'}</td>
              <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                {variant.weight != null ? String(variant.weight) : '—'}
              </td>
              <td className="px-4 py-3">
                <Badge tone={variant.isActive === false ? 'neutral' : 'success'}>
                  {variant.isActive === false ? 'Inactive' : 'Active'}
                </Badge>
              </td>
              <td className="px-4 py-3 text-right">
                <span className="inline-flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => setModal({ mode: 'edit', variant })}
                    aria-label={`Edit variant ${variant.sku}`}
                    title={`Edit variant ${variant.sku}`}
                    className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground hover:no-underline"
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </button>
                  {variant.isActive !== false ? (
                    <button
                      type="button"
                      onClick={() => setDeactivating(variant)}
                      aria-label={`Deactivate variant ${variant.sku}`}
                      title={`Deactivate variant ${variant.sku}`}
                      className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive hover:no-underline"
                    >
                      <Ban size={16} aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleActivate(variant)}
                      disabled={activatingId === variant.id}
                      aria-label={`Reactivate variant ${variant.sku}`}
                      title={`Reactivate variant ${variant.sku}`}
                      className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-success/10 hover:text-success hover:no-underline disabled:cursor-wait disabled:opacity-60"
                    >
                      <RotateCcw size={16} aria-hidden="true" />
                    </button>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {modal ? (
        <Modal
          title={modal.mode === 'edit' ? `Edit variant ${editingVariant?.sku ?? ''}` : 'Add variant'}
          onClose={closeModal}
          persistent={mutating}
        >
          <VariantForm
            key={editingVariant?.id ?? 'new'}
            initialValue={editingVariant}
            submitting={mutating}
            onCancel={closeModal}
            onSubmit={handleSubmit}
          />
        </Modal>
      ) : null}

      {deactivating ? (
        <Modal
          title={`Deactivate variant “${deactivating.sku}”?`}
          onClose={() => !mutating && setDeactivating(null)}
          persistent={mutating}
        >
          <p className="text-sm leading-6 text-muted-foreground">
            This soft-deactivates the variant: it disappears from the storefront and can no
            longer be purchased, but its record (and order history) is kept.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setDeactivating(null)} disabled={mutating}>
              Keep variant
            </Button>
            <Button variant="destructive" loading={mutating} onClick={handleDeactivate}>
              Yes, deactivate
            </Button>
          </div>
        </Modal>
      ) : null}
    </section>

      {allVariants.length > 0 ? (
        <VariantMediaSection productId={productId} variants={allVariants} />
      ) : null}
    </div>
  );
}
