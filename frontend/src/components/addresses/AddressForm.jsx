import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { FormField, SelectInput, TextInput } from '../ui/FormField.jsx';
import { addressSchema } from '../../schemas/address.schema.js';
import { applyServerErrors, zodResolver } from '../../lib/formValidation.js';
import { createAddress, updateAddress } from '../../services/addresses.service.js';

const EMPTY_ADDRESS_FORM = {
  label: '',
  fullName: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'India',
  isDefault: false,
};

/**
 * Shared address add/edit form (single implementation used by both the
 * address book and the inline checkout panel — one schema, one service,
 * one validation path). Server is authoritative: create/update go through
 * `POST|PATCH /addresses`, and `onSaved(record)` receives the saved
 * record (or null) so callers can refetch + select without a reload.
 */
export function AddressForm({ initialValue, mutating, setMutating, onSaved, onCancel }) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(addressSchema),
    defaultValues: initialValue
      ? {
          label: initialValue.label ?? '',
          fullName: initialValue.fullName ?? '',
          phone: initialValue.phone ?? '',
          addressLine1: initialValue.addressLine1 ?? '',
          addressLine2: initialValue.addressLine2 ?? '',
          city: initialValue.city ?? '',
          state: initialValue.state ?? '',
          postalCode: initialValue.postalCode ?? '',
          country: initialValue.country ?? 'India',
          isDefault: Boolean(initialValue.isDefault),
        }
      : { ...EMPTY_ADDRESS_FORM },
  });

  const busy = isSubmitting || mutating;

  const onSubmit = async (values) => {
    setMutating(true);
    try {
      let saved = null;
      if (initialValue?.id) {
        saved = await updateAddress(initialValue.id, values);
        toast.success('Address updated.');
      } else {
        saved = await createAddress(values);
        toast.success('Address added.');
      }
      await onSaved(saved ?? null);
    } catch (error) {
      const rootMessage = applyServerErrors(setError, error?.details);
      if (error?.code === 'ADDRESS_UPDATE_INVALID' || error?.status === 422) {
        setError('root', { type: 'server', message: rootMessage ?? 'No valid changes to save.' });
      } else {
        setError('root', { type: 'server', message: rootMessage ?? error?.message ?? 'Save failed. Please try again.' });
      }
    } finally {
      setMutating(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-label={initialValue ? 'Edit address' : 'Add address'}
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-foreground">{initialValue ? 'Edit address' : 'Add address'}</h2>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close address form"
          className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Full name" required error={errors.fullName?.message}>
          {({ describedBy }) => (
            <TextInput autoComplete="name" aria-invalid={Boolean(errors.fullName)} aria-describedby={describedBy} {...register('fullName')} />
          )}
        </FormField>
        <FormField label="Phone" required error={errors.phone?.message}>
          {({ describedBy }) => (
            <TextInput type="tel" autoComplete="tel" aria-invalid={Boolean(errors.phone)} aria-describedby={describedBy} {...register('phone')} />
          )}
        </FormField>
      </div>
      <FormField label="Address line 1" required error={errors.addressLine1?.message}>
        {({ describedBy }) => (
          <TextInput autoComplete="address-line1" aria-invalid={Boolean(errors.addressLine1)} aria-describedby={describedBy} {...register('addressLine1')} />
        )}
      </FormField>
      <FormField label="Address line 2" error={errors.addressLine2?.message}>
        {({ describedBy }) => (
          <TextInput autoComplete="address-line2" aria-invalid={Boolean(errors.addressLine2)} aria-describedby={describedBy} {...register('addressLine2')} />
        )}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="City" required error={errors.city?.message}>
          {({ describedBy }) => (
            <TextInput autoComplete="address-level2" aria-invalid={Boolean(errors.city)} aria-describedby={describedBy} {...register('city')} />
          )}
        </FormField>
        <FormField label="State" required error={errors.state?.message}>
          {({ describedBy }) => (
            <TextInput autoComplete="address-level1" aria-invalid={Boolean(errors.state)} aria-describedby={describedBy} {...register('state')} />
          )}
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Postal code" required error={errors.postalCode?.message}>
          {({ describedBy }) => (
            <TextInput inputMode="numeric" autoComplete="postal-code" aria-invalid={Boolean(errors.postalCode)} aria-describedby={describedBy} {...register('postalCode')} />
          )}
        </FormField>
        <FormField label="Country" required error={errors.country?.message}>
          {({ describedBy }) => (
            <TextInput autoComplete="country-name" aria-invalid={Boolean(errors.country)} aria-describedby={describedBy} {...register('country')} />
          )}
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Label" hint="e.g. Home, Office." error={errors.label?.message}>
          {({ describedBy }) => (
            <TextInput aria-invalid={Boolean(errors.label)} aria-describedby={describedBy} {...register('label')} />
          )}
        </FormField>
        <FormField label="Address type" error={errors.isDefault?.message}>
          {({ describedBy }) => (
            <SelectInput aria-describedby={describedBy} {...register('isDefault', { setValueAs: (value) => value === 'true' })}>
              <option value="false">Use as regular address</option>
              <option value="true">Set as default address</option>
            </SelectInput>
          )}
        </FormField>
      </div>
      {errors.root?.message ? (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive">
          {errors.root.message}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-border px-5 text-sm font-semibold disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          aria-busy={busy}
          className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? 'Saving…' : initialValue ? 'Save changes' : 'Add address'}
        </button>
      </div>
    </form>
  );
}
