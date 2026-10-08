import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '../ui/Button.jsx';
import { Field, Input } from '../ui/Field.jsx';
import { applyServerErrors } from '../../utils/serverErrors.js';

/**
 * Team-member edit form. Mirrors the backend managed-profile contract
 * EXACTLY (`updateMemberProfileSchema`: `firstName?`, `lastName?`,
 * `phone?`, strict). Deliberately ABSENT: `email`, `password`, `role`,
 * `companyId`, `isActive` — identity moves through deferred/dedicated
 * flows, roles move only through provisioning, and active state keeps
 * the lifecycle endpoint. A HEAD can therefore never promote a MEMBER
 * through this form (no role control exists to abuse).
 */

const memberEditSchema = z.object({
  firstName: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1, 'First name must be at least 1 character.').max(100, 'First name must be ≤ 100 characters.').optional(),
  ),
  lastName: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1, 'Last name must be at least 1 character.').max(100, 'Last name must be ≤ 100 characters.').optional(),
  ),
  phone: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1, 'Phone must be at least 1 character.').max(30, 'Phone must be ≤ 30 characters.').optional(),
  ),
});

export function MemberEditForm({ initialValue = null, onSubmit, submitting = false }) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(memberEditSchema),
    defaultValues: {
      firstName: initialValue?.firstName ?? '',
      lastName: initialValue?.lastName ?? '',
      phone: initialValue?.phone ?? '',
    },
  });

  const submit = handleSubmit(async (values) => {
    // Strict payload: only provided profile fields. Blank inputs are
    // omitted (never nulled blindly); an untouched save is rejected
    // client-side like the backend's `USER_UPDATE_INVALID`.
    const payload = {};
    if (values.firstName?.trim()) payload.firstName = values.firstName.trim();
    if (values.lastName?.trim()) payload.lastName = values.lastName.trim();
    if (values.phone?.trim()) payload.phone = values.phone.trim();
    if (Object.keys(payload).length === 0) {
      setError('root', { type: 'validate', message: 'No changes to save.' });
      return;
    }
    try {
      await onSubmit(payload);
    } catch (error) {
      const root = applyServerErrors(error?.details, setError);
      const code = error?.code;
      if (code === 'USER_UPDATE_INVALID') {
        setError('root', { type: 'server', message: 'No changes to save.' });
      } else {
        setError('root', { type: 'server', message: root ?? error?.message ?? 'Save failed. Please try again.' });
      }
    }
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label="First name" error={errors.firstName?.message}>
        {({ errorId }) => (
          <Input placeholder="e.g. Ada" autoComplete="off" aria-invalid={Boolean(errors.firstName)} aria-describedby={errorId} {...register('firstName')} />
        )}
      </Field>

      <Field label="Last name" error={errors.lastName?.message}>
        {({ errorId }) => (
          <Input placeholder="e.g. Lovelace" autoComplete="off" aria-invalid={Boolean(errors.lastName)} aria-describedby={errorId} {...register('lastName')} />
        )}
      </Field>

      <Field label="Phone" error={errors.phone?.message}>
        {({ errorId }) => (
          <Input placeholder="e.g. 9876543210" autoComplete="off" aria-invalid={Boolean(errors.phone)} aria-describedby={errorId} {...register('phone')} />
        )}
      </Field>

      {errors.root?.message ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm font-medium text-destructive">
          {errors.root.message}
        </p>
      ) : null}

      <Button type="submit" loading={submitting} className="w-full">
        Save changes
      </Button>
    </form>
  );
}
