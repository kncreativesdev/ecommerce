import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '../ui/Button.jsx';
import { Field, Input, Select } from '../ui/Field.jsx';
import { applyServerErrors } from '../../utils/serverErrors.js';

/**
 * Team-member create form. Mirrors the backend provisioning contract
 * EXACTLY (`createEmployeeSchema`: `email*`, `password*` 8–128,
 * `firstName*`, `lastName?`, `phone?`, `role: HEAD|MEMBER`, strict —
 * no companyId, never sent).
 *
 * Role safety: HEAD viewers get no role control at all — the payload
 * hardcodes `role: 'MEMBER'` (never a hidden field). ADMIN viewers
 * choose between `HEAD` and `MEMBER` only; ADMIN/SUPER_ADMIN/CUSTOMER
 * are not offerable (the backend rejects them outright).
 */

const emptyToUndefined = (value) => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' ? undefined : trimmed;
};

const memberCreateSchema = z
  .object({
    email: z.string().trim().min(1, 'Email is required.').max(255).email('Enter a valid email address.'),
    password: z.string().min(8, 'Password must be at least 8 characters.').max(128, 'Password must be ≤ 128 characters.'),
    confirmPassword: z.string().min(1, 'Confirm the password.'),
    firstName: z.string().trim().min(1, 'First name is required.').max(100, 'First name must be ≤ 100 characters.'),
    lastName: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(100, 'Last name must be ≤ 100 characters.').optional()),
    phone: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(30, 'Phone must be ≤ 30 characters.').optional()),
    role: z.enum(['HEAD', 'MEMBER']).optional(),
  })
  .superRefine((values, ctx) => {
    if (values.confirmPassword !== values.password) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmPassword'], message: 'Passwords do not match.' });
    }
  });

export function MemberCreateForm({ allowRoleChoice = false, onSubmit, submitting = false }) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(memberCreateSchema),
    defaultValues: {
      email: '',
      password: '',
      confirmPassword: '',
      firstName: '',
      lastName: '',
      phone: '',
      role: 'MEMBER',
    },
  });

  const submit = handleSubmit(async (values) => {
    // Strict payload: only documented provisioning fields. HEAD callers
    // hardcode MEMBER (no role input exists for them); ADMIN callers
    // send their explicit HEAD|MEMBER choice.
    const payload = {
      email: values.email.trim(),
      password: values.password,
      firstName: values.firstName.trim(),
      ...(values.lastName?.trim() ? { lastName: values.lastName.trim() } : {}),
      ...(values.phone?.trim() ? { phone: values.phone.trim() } : {}),
      role: allowRoleChoice ? values.role : 'MEMBER',
    };
    try {
      await onSubmit(payload);
    } catch (error) {
      const root = applyServerErrors(error?.details, setError);
      const code = error?.code;
      if (code === 'USER_EMAIL_EXISTS') {
        setError('email', { type: 'server', message: 'This email is already registered.' });
      } else if (code === 'USER_PROVISION_INVALID') {
        setError('root', { type: 'server', message: error?.message ?? 'Some details are invalid.' });
      } else {
        setError('root', { type: 'server', message: root ?? error?.message ?? 'Save failed. Please try again.' });
      }
    }
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label="Email" required error={errors.email?.message}>
        {({ errorId }) => (
          <Input type="email" placeholder="e.g. member@example.com" autoComplete="off" aria-invalid={Boolean(errors.email)} aria-describedby={errorId} {...register('email')} />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Password" required hint="8–128 characters." error={errors.password?.message}>
          {({ errorId }) => (
            <Input type="password" placeholder="••••••••" autoComplete="new-password" aria-invalid={Boolean(errors.password)} aria-describedby={errorId} {...register('password')} />
          )}
        </Field>
        <Field label="Confirm password" required error={errors.confirmPassword?.message}>
          {({ errorId }) => (
            <Input type="password" placeholder="••••••••" autoComplete="new-password" aria-invalid={Boolean(errors.confirmPassword)} aria-describedby={errorId} {...register('confirmPassword')} />
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" required error={errors.firstName?.message}>
          {({ errorId }) => (
            <Input placeholder="e.g. Ada" autoComplete="off" aria-invalid={Boolean(errors.firstName)} aria-describedby={errorId} {...register('firstName')} />
          )}
        </Field>
        <Field label="Last name" error={errors.lastName?.message}>
          {({ errorId }) => (
            <Input placeholder="Optional" autoComplete="off" aria-invalid={Boolean(errors.lastName)} aria-describedby={errorId} {...register('lastName')} />
          )}
        </Field>
      </div>

      <Field label="Phone" error={errors.phone?.message}>
        {({ errorId }) => (
          <Input placeholder="Optional" autoComplete="off" aria-invalid={Boolean(errors.phone)} aria-describedby={errorId} {...register('phone')} />
        )}
      </Field>

      {allowRoleChoice ? (
        <Field label="Role" required hint="HEADs can manage members; members have operational access only." error={errors.role?.message}>
          {({ errorId }) => (
            <Select aria-invalid={Boolean(errors.role)} aria-describedby={errorId} {...register('role')}>
              <option value="MEMBER">Member — operational access</option>
              <option value="HEAD">Head — manages members</option>
            </Select>
          )}
        </Field>
      ) : (
        <p className="rounded-lg bg-surface-muted px-3.5 py-2.5 text-xs leading-5 text-muted-foreground">
          New account joins as <span className="font-semibold text-foreground">Member</span> in your company.
          Only an ADMIN can create HEAD accounts.
        </p>
      )}

      {errors.root?.message ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm font-medium text-destructive">
          {errors.root.message}
        </p>
      ) : null}

      <Button type="submit" loading={submitting} className="w-full">
        Create team member
      </Button>
    </form>
  );
}
