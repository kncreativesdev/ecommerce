import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '../ui/Button.jsx';
import { Field, Input } from '../ui/Field.jsx';
import { applyServerErrors } from '../../utils/serverErrors.js';
import { buildVariantPayload } from '../../utils/variantPayload.js';

/**
 * Variant create/edit form (React Hook Form + Zod). Mirrors the backend
 * variant contract (`createVariantSchema` / `updateVariantSchema`):
 * required `sku` (≤100) / `name` (≤150) / `price` (non-negative decimal,
 * ≤8 integer digits, ≤2 decimals); optional `compareAtPrice` (same money
 * shape), `barcode` (≤100), `weight` (non-negative decimal, ≤3 decimals).
 * No stock/inventory fields — separate milestone. The server stays
 * authoritative; client checks only fail fast on shape.
 */

const DECIMAL_RE = /^\d+(\.\d+)?$/;
const MONEY_RE = /^\d{1,8}(\.\d{1,2})?$/;
const WEIGHT_RE = /^\d{1,7}(\.\d{1,3})?$/;

const blankToUndefined = (value) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const variantSchema = z.object({
  sku: z.string().trim().min(1, 'SKU is required.').max(100, 'SKU must be ≤ 100 characters.'),
  name: z.string().trim().min(1, 'Variant name is required.').max(150, 'Variant name must be ≤ 150 characters.'),
  price: z
    .string()
    .trim()
    .min(1, 'Price is required.')
    .refine((value) => DECIMAL_RE.test(value), 'Price must be a non-negative number.')
    .refine((value) => MONEY_RE.test(value), 'Price supports ≤ 8 digits with ≤ 2 decimals.'),
  compareAtPrice: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .refine((value) => DECIMAL_RE.test(value), 'MRP must be a non-negative number.')
      .refine((value) => MONEY_RE.test(value), 'MRP supports ≤ 8 digits with ≤ 2 decimals.')
      .optional(),
  ),
  barcode: z.preprocess(
    blankToUndefined,
    z.string().trim().min(1).max(100, 'Barcode must be ≤ 100 characters.').optional(),
  ),
  weight: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .refine((value) => DECIMAL_RE.test(value), 'Weight must be a non-negative number.')
      .refine((value) => WEIGHT_RE.test(value), 'Weight supports ≤ 7 digits with ≤ 3 decimals.')
      .optional(),
  ),
});

export function VariantForm({ initialValue = null, submitting = false, submitLabel, onSubmit, onCancel }) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(variantSchema),
    defaultValues: {
      sku: initialValue?.sku ?? '',
      name: initialValue?.name ?? '',
      price: initialValue?.price ?? '',
      compareAtPrice: initialValue?.compareAtPrice ?? '',
      barcode: initialValue?.barcode ?? '',
      weight: initialValue?.weight != null ? String(initialValue.weight) : '',
    },
  });

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(buildVariantPayload(values));
    } catch (error) {
      const root = applyServerErrors(error?.details, setError);
      const code = error?.code;
      if (code === 'PRODUCT_VARIANT_SKU_EXISTS') {
        setError('sku', { type: 'server', message: 'This SKU is already taken.' });
      } else if (code === 'PRODUCT_VARIANT_BARCODE_EXISTS') {
        setError('barcode', { type: 'server', message: 'This barcode is already taken.' });
      } else {
        setError('root', { type: 'server', message: root ?? error?.message ?? 'Save failed. Please try again.' });
      }
    }
  });

  return (
    <form onSubmit={submit} noValidate aria-label={initialValue ? 'Edit variant' : 'Add variant'} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="SKU" required error={errors.sku?.message}>
          {({ errorId }) => (
            <Input placeholder="e.g. TP-DC38-BLK" aria-invalid={Boolean(errors.sku)} aria-describedby={errorId} {...register('sku')} />
          )}
        </Field>
        <Field label="Variant name" required error={errors.name?.message}>
          {({ errorId }) => (
            <Input placeholder="e.g. Onyx Black" aria-invalid={Boolean(errors.name)} aria-describedby={errorId} {...register('name')} />
          )}
        </Field>
        <Field label="Price (INR)" required error={errors.price?.message}>
          {({ errorId }) => (
            <Input inputMode="decimal" placeholder="e.g. 1299.00" aria-invalid={Boolean(errors.price)} aria-describedby={errorId} {...register('price')} />
          )}
        </Field>
        <Field label="MRP / Compare-at (INR)" error={errors.compareAtPrice?.message}>
          {({ errorId }) => (
            <Input inputMode="decimal" placeholder="Optional" aria-invalid={Boolean(errors.compareAtPrice)} aria-describedby={errorId} {...register('compareAtPrice')} />
          )}
        </Field>
        <Field label="Barcode" error={errors.barcode?.message}>
          {({ errorId }) => (
            <Input placeholder="Optional" aria-invalid={Boolean(errors.barcode)} aria-describedby={errorId} {...register('barcode')} />
          )}
        </Field>
        <Field label="Weight" error={errors.weight?.message}>
          {({ errorId }) => (
            <Input inputMode="decimal" placeholder="Optional" aria-invalid={Boolean(errors.weight)} aria-describedby={errorId} {...register('weight')} />
          )}
        </Field>
      </div>
      {errors.root?.message ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm font-medium text-destructive">
          {errors.root.message}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" loading={submitting}>
          {submitLabel ?? (initialValue ? 'Save changes' : 'Add variant')}
        </Button>
      </div>
    </form>
  );
}
