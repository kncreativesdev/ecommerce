import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '../ui/Button.jsx';
import { Checkbox, Field, Input, Select, Textarea } from '../ui/Field.jsx';
import { applyServerErrors } from '../../utils/serverErrors.js';
import { DISCOUNT_TYPES, couponProductIds, fromLocalInputValue, toLocalInputValue } from '../../utils/coupons.js';

/**
 * Reusable coupon form (create + edit). Editable fields mirror the backend
 * contract EXACTLY (`createCouponSchema`/`updateCouponSchema`): code*,
 * description?, discountType*, discountValue*, minimumOrderAmount?,
 * maximumDiscountAmount?, usageLimit?, startsAt?, expiresAt?, isActive?,
 * productIds?. Deliberately ABSENT: `usedCount` (server-incremented,
 * never writable), per-customer limits, category/customer/first-order
 * rules, stacking — none exist server-side and are not invented here.
 *
 * Datetimes edit as local wall time (`datetime-local`) and submit as UTC
 * ISO strings; display elsewhere uses the shared local formatter, so the
 * round-trip is explicit. Product restriction is the backend's only
 * eligibility primitive: checked products restrict the coupon, unchecked
 * (empty) means all products. Obvious invalid input is caught here, but
 * backend validation stays authoritative (server errors map to fields).
 */

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

function amountError(field, value) {
  if (value === '' || value === undefined) return null;
  if (!AMOUNT_PATTERN.test(value.trim())) return `${field} must be a number with at most 2 decimals (e.g. 99.00).`;
  return null;
}

const couponFormSchema = z
  .object({
    code: z.string().trim().min(1, 'Code is required.').max(50, 'Code must be ≤ 50 characters.'),
    description: z.string().max(500, 'Description must be ≤ 500 characters.').optional(),
    discountType: z.enum(['PERCENTAGE', 'FIXED']),
    discountValue: z.string().trim().min(1, 'Discount value is required.'),
    minimumOrderAmount: z.string().trim().optional(),
    maximumDiscountAmount: z.string().trim().optional(),
    usageLimit: z.string().trim().optional(),
    startsAt: z.string().optional(),
    expiresAt: z.string().optional(),
    isActive: z.boolean(),
    productIds: z.array(z.string()).optional(),
  })
  .superRefine((values, ctx) => {
    const valueError = amountError('Discount value', values.discountValue);
    if (valueError) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['discountValue'], message: valueError });
    } else {
      const amount = Number(values.discountValue);
      if (!(amount > 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['discountValue'], message: 'Discount value must be above 0.' });
      } else if (values.discountType === 'PERCENTAGE' && amount > 100) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['discountValue'], message: 'Percentage discount must be at most 100.' });
      }
    }
    for (const field of ['minimumOrderAmount', 'maximumDiscountAmount']) {
      const error = amountError(field === 'minimumOrderAmount' ? 'Minimum order amount' : 'Maximum discount', values[field]);
      if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: error });
    }
    const usage = (values.usageLimit ?? '').trim();
    if (usage !== '' && (!/^\d+$/.test(usage) || Number(usage) < 1)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['usageLimit'], message: 'Usage limit must be a whole number ≥ 1.' });
    }
    const startsAt = values.startsAt ? new Date(values.startsAt) : null;
    const expiresAt = values.expiresAt ? new Date(values.expiresAt) : null;
    if (values.startsAt && startsAt && Number.isNaN(startsAt.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startsAt'], message: 'Start date is invalid.' });
    }
    if (values.expiresAt && expiresAt && Number.isNaN(expiresAt.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'Expiry date is invalid.' });
    }
    if (startsAt && expiresAt && !Number.isNaN(startsAt.getTime()) && !Number.isNaN(expiresAt.getTime()) && expiresAt <= startsAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'Expiry must be after the start date.' });
    }
  });

export function CouponForm({ initialValue = null, products = [], productsLoading = false, onSubmit, submitting = false }) {
  const isEdit = Boolean(initialValue?.id);
  const initialProductIds = isEdit ? couponProductIds(initialValue) : [];

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(couponFormSchema),
    defaultValues: {
      code: initialValue?.code ?? '',
      description: initialValue?.description ?? '',
      discountType: initialValue?.discountType ?? 'PERCENTAGE',
      discountValue: initialValue?.discountValue ?? '',
      minimumOrderAmount: initialValue?.minimumOrderAmount ?? '',
      maximumDiscountAmount: initialValue?.maximumDiscountAmount ?? '',
      usageLimit: initialValue?.usageLimit === null || initialValue?.usageLimit === undefined ? '' : String(initialValue.usageLimit),
      startsAt: toLocalInputValue(initialValue?.startsAt),
      expiresAt: toLocalInputValue(initialValue?.expiresAt),
      isActive: initialValue?.isActive ?? true,
      productIds: initialProductIds,
    },
  });

  const submit = handleSubmit(async (values) => {
    // Strict payload: only documented fields. Empty optionals become
    // explicit null (backend-nullable); datetimes convert local → UTC ISO.
    const payload = {
      code: values.code.trim(),
      description: values.description?.trim() ? values.description.trim() : null,
      discountType: values.discountType,
      discountValue: values.discountValue.trim(),
      minimumOrderAmount: values.minimumOrderAmount?.trim() ? values.minimumOrderAmount.trim() : null,
      maximumDiscountAmount: values.maximumDiscountAmount?.trim() ? values.maximumDiscountAmount.trim() : null,
      usageLimit: values.usageLimit?.trim() ? Number(values.usageLimit.trim()) : null,
      startsAt: fromLocalInputValue(values.startsAt),
      expiresAt: fromLocalInputValue(values.expiresAt),
      isActive: values.isActive,
      productIds: Array.isArray(values.productIds) ? values.productIds : [],
    };
    try {
      await onSubmit(payload);
    } catch (error) {
      const root = applyServerErrors(error?.details, setError);
      const code = error?.code;
      if (code === 'COUPON_CODE_EXISTS') {
        setError('code', { type: 'server', message: 'This code is already taken.' });
      } else if (code === 'PRODUCT_NOT_FOUND') {
        setError('productIds', { type: 'server', message: error?.message ?? 'A selected product no longer exists. Refresh and retry.' });
      } else if (code === 'COUPON_INVALID_DISCOUNT') {
        setError('discountValue', { type: 'server', message: error?.message ?? 'Invalid discount value.' });
      } else if (code === 'COUPON_UPDATE_INVALID') {
        setError('root', { type: 'server', message: 'No changes to save.' });
      } else {
        setError('root', { type: 'server', message: root ?? error?.message ?? 'Save failed. Please try again.' });
      }
    }
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label="Code" required hint="Stored uppercase; must be unique." error={errors.code?.message}>
        {({ errorId }) => (
          <Input placeholder="e.g. FESTIVE10" autoComplete="off" aria-invalid={Boolean(errors.code)} aria-describedby={errorId} {...register('code')} />
        )}
      </Field>

      <Field label="Description" error={errors.description?.message}>
        {({ errorId }) => (
          <Textarea placeholder="Optional internal note…" aria-invalid={Boolean(errors.description)} aria-describedby={errorId} {...register('description')} />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Discount type" required error={errors.discountType?.message}>
          {({ errorId }) => (
            <Select aria-invalid={Boolean(errors.discountType)} aria-describedby={errorId} {...register('discountType')}>
              {DISCOUNT_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Discount value"
          required
          hint="Percentage: above 0 and at most 100 (of the eligible subtotal). Fixed: flat ₹ amount above 0, capped at the eligible subtotal."
          error={errors.discountValue?.message}
        >
          {({ errorId }) => (
            <Input
              placeholder="e.g. 10 or 200.00"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={Boolean(errors.discountValue)}
              aria-describedby={errorId}
              {...register('discountValue')}
            />
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Minimum order amount (₹)" hint="Optional — tested against the full order subtotal." error={errors.minimumOrderAmount?.message}>
          {({ errorId }) => (
            <Input placeholder="e.g. 999.00" inputMode="decimal" autoComplete="off" aria-invalid={Boolean(errors.minimumOrderAmount)} aria-describedby={errorId} {...register('minimumOrderAmount')} />
          )}
        </Field>

        <Field label="Maximum discount (₹)" hint="Optional — caps the computed discount." error={errors.maximumDiscountAmount?.message}>
          {({ errorId }) => (
            <Input placeholder="e.g. 500.00" inputMode="decimal" autoComplete="off" aria-invalid={Boolean(errors.maximumDiscountAmount)} aria-describedby={errorId} {...register('maximumDiscountAmount')} />
          )}
        </Field>
      </div>

      <Field label="Total usage limit" hint="Optional — blank means unlimited." error={errors.usageLimit?.message}>
        {({ errorId }) => (
          <Input placeholder="e.g. 100" inputMode="numeric" autoComplete="off" aria-invalid={Boolean(errors.usageLimit)} aria-describedby={errorId} {...register('usageLimit')} />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts at" hint="Local time; stored as UTC. Blank = immediately." error={errors.startsAt?.message}>
          {({ errorId }) => (
            <Input type="datetime-local" aria-invalid={Boolean(errors.startsAt)} aria-describedby={errorId} {...register('startsAt')} />
          )}
        </Field>

        <Field label="Expires at" hint="Local time; stored as UTC. Blank = never." error={errors.expiresAt?.message}>
          {({ errorId }) => (
            <Input type="datetime-local" aria-invalid={Boolean(errors.expiresAt)} aria-describedby={errorId} {...register('expiresAt')} />
          )}
        </Field>
      </div>

      <Field
        label="Eligible products"
        hint="Optional — checked products restrict the coupon; unchecked (empty) means all products. Discounts apply to eligible items only."
        error={errors.productIds?.message}
      >
        {productsLoading ? (
          <p className="text-sm text-muted-foreground" role="status">Loading products…</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-muted-foreground">No products available — the coupon will apply to all products.</p>
        ) : (
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border border-input bg-surface p-2">
            {products.map((product) => (
              <Checkbox
                key={product.id}
                label={`${product.name}${product.isActive === false ? ' (inactive)' : ''}`}
                value={product.id}
                {...register('productIds')}
              />
            ))}
          </div>
        )}
      </Field>

      <Checkbox label="Active (available for validation)" {...register('isActive')} />

      {errors.root?.message ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {errors.root.message}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="submit" variant="primary" loading={submitting}>
          {isEdit ? 'Save coupon' : 'Create coupon'}
        </Button>
      </div>
    </form>
  );
}
