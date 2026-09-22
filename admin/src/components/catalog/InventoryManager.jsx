import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Table } from '../ui/Table.jsx';
import { Badge } from '../ui/Badge.jsx';
import { Button } from '../ui/Button.jsx';
import { EmptyState } from '../ui/EmptyState.jsx';
import { ErrorState } from '../ui/ErrorState.jsx';
import { Modal } from '../ui/Modal.jsx';
import { Field, Input, Textarea } from '../ui/Field.jsx';
import { applyServerErrors } from '../../utils/serverErrors.js';
import {
  adjustInventory,
  fetchVariantInventory,
  initializeInventory,
} from '../../services/inventory.service.js';

/**
 * Inventory management section for the product edit page. Variant-level
 * ONLY (no product-level inventory endpoint exists) — one row per variant
 * of the edited product.
 *
 * Data flow (verified `inventory.*` backend, ADMIN-only):
 * - `GET .../variants/:variantId/inventory` → `200 { inventory }`;
 *   `404 INVENTORY_NOT_FOUND` means "Not initialized" (honest row state,
 *   never rendered as zero).
 * - `POST` initialize-once `{ quantity: int 0..2147483647, note? ≤1000 }`
 *   → `201`; repeat → `409 INVENTORY_ALREADY_EXISTS`.
 * - `PATCH` adjust `{ quantity: <delta int ≠ 0>, note? }` (the field
 *   carries the DELTA, not the new total) → `200`; negative result →
 *   `409 INSUFFICIENT_STOCK`; overflow → `422 VALIDATION_ERROR`.
 * - Only `quantity` is displayed (`reservedQuantity`/`availableQuantity`
 *   exist in the payload but are intentionally not surfaced).
 *
 * No global store: entries live in this component, keyed by variant id,
 * refreshed from the server after every mutation (never optimistic).
 */

const MAX_INT32 = 2147483647;
const INT_RE = /^-?\d+$/;

const noteField = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().max(1000, 'Note must be ≤ 1000 characters.').optional(),
);

const initializeSchema = z.object({
  quantity: z
    .string()
    .trim()
    .min(1, 'Quantity is required.')
    .refine((value) => INT_RE.test(value), 'Enter a whole number.')
    .refine((value) => {
      const n = Number(value);
      return n >= 0 && n <= MAX_INT32;
    }, `Enter a quantity from 0 to ${MAX_INT32}.`),
  note: noteField,
});

const adjustSchema = z.object({
  quantity: z
    .string()
    .trim()
    .min(1, 'Adjustment is required.')
    .refine((value) => INT_RE.test(value), 'Enter a whole number (e.g. 10 or -5).')
    .refine((value) => {
      const n = Number(value);
      return Number.isInteger(n) && n !== 0 && Math.abs(n) <= MAX_INT32;
    }, 'Adjustment must be a non-zero whole number.'),
  note: noteField,
});

const INVENTORY_COLUMNS = [
  { key: 'variant', label: 'Variant' },
  { key: 'quantity', label: 'Current quantity', numeric: true },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: 'Actions', numeric: true },
];

function QuantityForm({ mode, submitting, onSubmit, onCancel }) {
  const isInit = mode === 'initialize';
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(isInit ? initializeSchema : adjustSchema),
    defaultValues: { quantity: '', note: '' },
  });

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit({
        quantity: Number(values.quantity),
        note: values.note?.trim() ? values.note.trim() : undefined,
      });
    } catch (error) {
      const root = applyServerErrors(error?.details, setError);
      const code = error?.code;
      if (code === 'INSUFFICIENT_STOCK') {
        setError('quantity', { type: 'server', message: 'Adjustment would reduce inventory below zero.' });
      } else if (code === 'VALIDATION_ERROR') {
        setError('quantity', { type: 'server', message: root ?? 'Adjustment exceeds the supported range.' });
      } else {
        setError('root', { type: 'server', message: root ?? error?.message ?? 'Save failed. Please try again.' });
      }
    }
  });

  return (
    <form onSubmit={submit} noValidate aria-label={isInit ? 'Initialize inventory' : 'Adjust inventory'} className="flex flex-col gap-4">
      {!isInit ? (
        <p className="-mb-1 text-xs leading-5 text-muted-foreground">
          Positive values add stock, negative values remove it. The backend applies and
          validates the change — the new total comes back from the server.
        </p>
      ) : null}
      <Field
        label={isInit ? 'Initial quantity' : 'Adjustment quantity'}
        required
        hint={isInit ? 'Whole number, 0 or higher.' : 'Whole number, never zero (e.g. 10 or -5).'}
        error={errors.quantity?.message}
      >
        {({ errorId }) => (
          <Input
            inputMode="numeric"
            placeholder={isInit ? 'e.g. 100' : 'e.g. 10 or -5'}
            aria-invalid={Boolean(errors.quantity)}
            aria-describedby={errorId}
            {...register('quantity')}
          />
        )}
      </Field>
      <Field label="Note" hint="Optional, ≤ 1000 characters." error={errors.note?.message}>
        {({ errorId }) => (
          <Textarea
            rows={2}
            placeholder="Optional ledger note…"
            aria-invalid={Boolean(errors.note)}
            aria-describedby={errorId}
            {...register('note')}
          />
        )}
      </Field>
      {errors.root?.message ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm font-medium text-destructive">
          {errors.root.message}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          {isInit ? 'Initialize stock' : 'Apply adjustment'}
        </Button>
      </div>
    </form>
  );
}

export function InventoryManager({ productId, variants = [] }) {
  const [entries, setEntries] = useState({});
  const [modal, setModal] = useState(null); // null | { mode: 'initialize'|'adjust', variant }
  const [mutating, setMutating] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const variantKey = variants.map((variant) => variant.id).join(',');
  const [prevKey, setPrevKey] = useState(null);

  // Render-time reset on product/variant-set change (sanctioned
  // derived-state pattern); effects below only sync async fetches.
  const fetchKey = `${productId}::${variantKey}::${reloadToken}`;
  if (prevKey !== fetchKey) {
    setPrevKey(fetchKey);
    setEntries(Object.fromEntries(variants.map((variant) => [variant.id, { status: 'loading', record: null, error: null }])));
  }

  const fetchOne = useCallback(
    async (variantId) => {
      try {
        const record = await fetchVariantInventory(productId, variantId);
        setEntries((previous) => ({ ...previous, [variantId]: { status: 'ready', record, error: null } }));
        return { ok: true, record };
      } catch (error) {
        if (error?.status === 404 || error?.code === 'INVENTORY_NOT_FOUND' || error?.code === 'PRODUCT_VARIANT_NOT_FOUND') {
          // No record yet — the honest "Not initialized" row state.
          setEntries((previous) => ({ ...previous, [variantId]: { status: 'ready', record: null, error: null } }));
          return { ok: true, record: null };
        }
        setEntries((previous) => ({ ...previous, [variantId]: { status: 'error', record: null, error } }));
        return { ok: false, error };
      }
    },
    [productId],
  );

  useEffect(() => {
    if (!productId || variants.length === 0) return;
    // Bounded fan-out: one GET per variant of THIS product only.
    // fetchOne never rejects (failures become row state), so fire-and-forget
    // is safe here; `variants` keeps a stable identity unless the product
    // record itself changes.
    variants.forEach((variant) => {
      fetchOne(variant.id);
    });
  }, [productId, variants, fetchOne, reloadToken]);

  // Surface a section-level error only when EVERY row failed; partial
  // failures render inline per row with their own retry.
  const rows = variants.map((variant) => ({
    variant,
    entry: entries[variant.id] ?? { status: 'loading', record: null, error: null },
  }));
  const anyLoading = rows.some(({ entry }) => entry.status === 'loading');
  const allFailed = rows.length > 0 && rows.every(({ entry }) => entry.status === 'error');
  const firstError = rows.find(({ entry }) => entry.status === 'error')?.entry.error;
  const initializedCount = rows.filter(({ entry }) => entry.status === 'ready' && entry.record).length;

  const refresh = () => setReloadToken((token) => token + 1);
  const closeModal = () => {
    if (!mutating) setModal(null);
  };

  const handleSubmit = async ({ quantity, note }) => {
    if (!productId || !modal?.variant?.id) return;
    const variantId = modal.variant.id;
    const sku = modal.variant.sku;
    setMutating(true);
    try {
      if (modal.mode === 'initialize') {
        await initializeInventory(productId, variantId, { quantity, note });
        toast.success(`Stock initialized for “${sku}”.`);
      } else {
        await adjustInventory(productId, variantId, { quantity, note });
        toast.success(`Stock adjusted for “${sku}”.`);
      }
      setModal(null);
      await fetchOne(variantId);
    } catch (error) {
      if (error?.code === 'INVENTORY_ALREADY_EXISTS') {
        toast.error('Inventory already exists — showing the current record.');
        setModal(null);
        await fetchOne(variantId);
        return;
      }
      if (error?.status === 404 || error?.code === 'INVENTORY_NOT_FOUND' || error?.code === 'PRODUCT_VARIANT_NOT_FOUND') {
        toast.error('Inventory state changed — list refreshed.');
        setModal(null);
        await fetchOne(variantId);
        return;
      }
      throw error;
    } finally {
      setMutating(false);
    }
  };

  return (
    <section aria-label="Inventory" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">Inventory</h3>
        <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
          {variants.length === 0
            ? 'No variants to track yet.'
            : anyLoading
              ? 'Loading stock levels…'
              : `${initializedCount} of ${variants.length} ${variants.length === 1 ? 'variant' : 'variants'} initialized`}
        </p>
      </div>

      {variants.length === 0 ? (
        <EmptyState
          title="No variants yet"
          message="Add a variant first — inventory is tracked per variant, never per product."
        />
      ) : allFailed ? (
        <ErrorState
          title="Couldn’t load inventory"
          message={firstError?.message ?? 'Please try again.'}
          onRetry={refresh}
        />
      ) : (
        <Table caption="Per-variant inventory" columns={INVENTORY_COLUMNS} minWidth="min-w-[640px]">
          {rows.map(({ variant, entry }) => (
            <tr key={variant.id} className="transition-colors hover:bg-surface-muted/50">
              <td className="px-4 py-3">
                <p className="font-semibold text-foreground">{variant.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{variant.sku}</p>
              </td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                {entry.status === 'loading' ? (
                  <span aria-hidden="true" className="inline-block h-4 w-12 animate-pulse rounded bg-surface-muted" />
                ) : entry.status === 'error' ? (
                  <span className="text-sm font-medium text-destructive">Failed to load</span>
                ) : entry.record ? (
                  String(entry.record.quantity)
                ) : (
                  <span className="text-sm font-medium text-muted-foreground">Not initialized</span>
                )}
              </td>
              <td className="px-4 py-3">
                <Badge tone={variant.isActive === false ? 'neutral' : 'success'}>
                  {variant.isActive === false ? 'Inactive' : 'Active'}
                </Badge>
              </td>
              <td className="px-4 py-3 text-right">
                {entry.status === 'error' ? (
                  <Button size="sm" variant="secondary" onClick={() => fetchOne(variant.id)}>
                    Retry
                  </Button>
                ) : entry.status === 'ready' && !entry.record ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setModal({ mode: 'initialize', variant })}
                    aria-label={`Initialize stock for ${variant.sku}`}
                  >
                    <Plus size={15} aria-hidden="true" />
                    Initialize
                  </Button>
                ) : entry.status === 'ready' && entry.record ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setModal({ mode: 'adjust', variant })}
                    aria-label={`Adjust stock for ${variant.sku}`}
                  >
                    <Minus size={15} aria-hidden="true" />
                    Adjust
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      )}

      {modal ? (
        <Modal
          title={modal.mode === 'initialize' ? `Initialize stock — ${modal.variant.sku}` : `Adjust stock — ${modal.variant.sku}`}
          onClose={closeModal}
          persistent={mutating}
        >
          <QuantityForm
            key={`${modal.mode}-${modal.variant.id}`}
            mode={modal.mode}
            submitting={mutating}
            onCancel={closeModal}
            onSubmit={handleSubmit}
          />
        </Modal>
      ) : null}
    </section>
  );
}
