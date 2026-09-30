import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormField, SelectInput, TextArea } from '../ui/FormField.jsx';
import { returnSchema } from '../../schemas/return.schema.js';
import { applyServerErrors, zodResolver } from '../../lib/formValidation.js';
import { RETURN_REASON_OPTIONS } from '../../lib/orderStatus.js';

/**
 * Return-request form: controlled reason select (required, human labels)
 * + details textarea (required only when reason is `OTHER`, else
 * optional ≤1000). Server errors map per-field via the shared bridge;
 * values are preserved on failure (the form stays mounted — only the
 * parent dialog closes on success).
 */
export function ReturnRequestForm({ submitting = false, submitLabel, onSubmit, onCancel }) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(returnSchema),
    defaultValues: { reason: '', details: '' },
  });

  // Local mirror of the reason select for the OTHER-details conditional UI.
  // Kept in sync through the select's onChange alongside RHF's own handler
  // (no `watch()`, which the React Compiler pass flags in this repo).
  const [selectedReason, setSelectedReason] = useState('');
  const reasonRegistration = register('reason');

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit({
        reason: values.reason,
        details: values.details?.trim() ? values.details.trim() : null,
      });
    } catch (error) {
      const rootMessage = applyServerErrors(setError, error?.details);
      setError('root', { type: 'server', message: rootMessage ?? error?.message ?? 'Could not submit the return request. Please try again.' });
    }
  });

  return (
    <form onSubmit={submit} noValidate aria-label="Request a return" className="flex flex-col gap-4">
      <FormField label="Reason" required error={errors.reason?.message}>
        {({ describedBy }) => (
          <SelectInput
            aria-invalid={Boolean(errors.reason)}
            aria-describedby={describedBy}
            defaultValue=""
            {...reasonRegistration}
            onChange={(event) => {
              reasonRegistration.onChange(event);
              setSelectedReason(event.target.value);
            }}
          >
            <option value="" disabled>
              Select a reason
            </option>
            {RETURN_REASON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectInput>
        )}
      </FormField>
      <FormField
        label="Details"
        required={selectedReason === 'OTHER'}
        hint={selectedReason === 'OTHER' ? 'Please describe the issue.' : 'Optional, up to 1000 characters.'}
        error={errors.details?.message}
      >
        {({ describedBy }) => (
          <TextArea
            placeholder={selectedReason === 'OTHER' ? 'Describe the issue' : 'Anything else we should know (optional)'}
            aria-invalid={Boolean(errors.details)}
            aria-describedby={describedBy}
            {...register('details')}
          />
        )}
      </FormField>
      {errors.root?.message ? (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive">
          {errors.root.message}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-border px-5 text-sm font-semibold disabled:opacity-60"
          >
            Cancel
          </button>
        ) : null}
        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          {submitting ? 'Submitting…' : (submitLabel ?? 'Submit return request')}
        </button>
      </div>
    </form>
  );
}
