import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Star } from 'lucide-react';
import { FormField, TextArea, TextInput } from '../ui/FormField.jsx';
import { reviewSchema } from '../../schemas/review.schema.js';
import { applyServerErrors, zodResolver } from '../../lib/formValidation.js';
import { cn } from '../../lib/cn.js';

/**
 * Own-review form (create + edit): rating 1–5 (star buttons, keyboard
 * reachable), title ≤255, comment ≤5000. Text fields optional/nullable.
 * Never sends `productId`/`userId` — creation uses `orderItemId` only.
 */
export function ReviewForm({ initialValue = null, submitting = false, submitLabel, onSubmit, onCancel }) {
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(reviewSchema),
    defaultValues: {
      rating: initialValue?.rating ?? 0,
      title: initialValue?.title ?? '',
      comment: initialValue?.comment ?? '',
    },
  });

  const [rating, setRating] = useState(initialValue?.rating ?? 0);

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit({
        rating: values.rating,
        title: values.title?.trim() ? values.title.trim() : null,
        comment: values.comment?.trim() ? values.comment.trim() : null,
      });
    } catch (error) {
      const rootMessage = applyServerErrors(setError, error?.details);
      setError('root', { type: 'server', message: rootMessage ?? error?.message ?? 'Save failed. Please try again.' });
    }
  });

  return (
    <form onSubmit={submit} noValidate aria-label={initialValue ? 'Edit review' : 'Write a review'} className="flex flex-col gap-4">
      <FormField label="Rating" required error={errors.rating?.message}>
        {({ describedBy }) => (
          <div role="radiogroup" aria-describedby={describedBy} aria-label="Star rating" className="flex items-center gap-1">
            {/* Hidden input carries the RHF value; stars drive it + local visuals. */}
            <input type="hidden" {...register('rating', { valueAsNumber: true })} />
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rating === value}
                aria-label={`${value} star${value === 1 ? '' : 's'}`}
                onClick={() => {
                  setRating(value);
                  setValue('rating', value, { shouldValidate: true });
                }}
                className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg transition-transform duration-150 hover:scale-110"
              >
                <Star
                  size={24}
                  aria-hidden="true"
                  className={cn(rating >= value ? 'fill-warning text-warning' : 'text-border-strong')}
                />
              </button>
            ))}
          </div>
        )}
      </FormField>
      <FormField label="Title" hint="Optional, up to 255 characters." error={errors.title?.message}>
        {({ describedBy }) => (
          <TextInput
            type="text"
            placeholder="Sums it up in a line"
            aria-invalid={Boolean(errors.title)}
            aria-describedby={describedBy}
            {...register('title')}
          />
        )}
      </FormField>
      <FormField label="Review" hint="Optional, up to 5000 characters." error={errors.comment?.message}>
        {({ describedBy }) => (
          <TextArea
            placeholder="What did you like? How is the quality, battery, fit…"
            aria-invalid={Boolean(errors.comment)}
            aria-describedby={describedBy}
            {...register('comment')}
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
          {submitting ? 'Saving…' : (submitLabel ?? (initialValue ? 'Save changes' : 'Submit review'))}
        </button>
      </div>
    </form>
  );
}
