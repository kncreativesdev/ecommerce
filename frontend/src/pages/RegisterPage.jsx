import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { Container } from '../components/ui/Container.jsx';
import { FormField, TextInput } from '../components/ui/FormField.jsx';
import { registerSchema } from '../schemas/auth.schema.js';
import { zodResolver, applyServerErrors } from '../lib/formValidation.js';
import { useAuthStore } from '../stores/useAuthStore.js';

function safeRedirect(value) {
  if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) {
    return value;
  }
  return '/account';
}

/**
 * Register (`/register?redirect=`, public): creates a CUSTOMER account,
 * then auto-logs in (backend register returns no token). `409` maps to
 * the email field; `422 details[]` map to fields.
 */
export function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = safeRedirect(searchParams.get('redirect'));
  const registerThenLogin = useAuthStore((state) => state.registerThenLogin);
  const isAuthenticated = Boolean(useAuthStore((state) => state.accessToken));
  const status = useAuthStore((state) => state.status);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', password: '', firstName: '', lastName: '', phone: '' },
  });

  useEffect(() => {
    document.title = 'Create account — Tech Pulse';
  }, []);

  useEffect(() => {
    if (isAuthenticated && status === 'ready') {
      navigate(redirectTo, { replace: true });
    }
  }, [isAuthenticated, status, navigate, redirectTo]);

  const onSubmit = async (values) => {
    const result = await registerThenLogin(values);
    if (result.ok) {
      toast.success('Account created — welcome to Tech Pulse!');
      navigate(redirectTo, { replace: true });
      return;
    }
    const error = result.error;
    if (error?.code === 'AUTH_EMAIL_ALREADY_EXISTS' || error?.status === 409) {
      setError('email', { type: 'server', message: 'An account with this email already exists.' });
    } else if (error?.status === 429) {
      setError('root', { type: 'server', message: 'Too many attempts. Please wait a moment and try again.' });
    } else {
      const rootMessage = applyServerErrors(setError, error?.details);
      setError('root', { type: 'server', message: rootMessage ?? error?.message ?? 'Registration failed. Please try again.' });
    }
  };

  return (
    <Container className="flex justify-center py-10 sm:py-14">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight">Create account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One account for cart, wishlist, orders, and COD checkout.
        </p>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6 flex flex-col gap-4">
          <FormField label="Email" required error={errors.email?.message}>
            {({ describedBy }) => (
              <TextInput
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                aria-invalid={Boolean(errors.email)}
                aria-describedby={describedBy}
                {...register('email')}
              />
            )}
          </FormField>
          <FormField label="Password" required hint="8–128 characters." error={errors.password?.message}>
            {({ describedBy }) => (
              <TextInput
                type="password"
                autoComplete="new-password"
                placeholder="Choose a strong password"
                aria-invalid={Boolean(errors.password)}
                aria-describedby={describedBy}
                {...register('password')}
              />
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="First name" error={errors.firstName?.message}>
              {({ describedBy }) => (
                <TextInput
                  type="text"
                  autoComplete="given-name"
                  placeholder="Optional"
                  aria-invalid={Boolean(errors.firstName)}
                  aria-describedby={describedBy}
                  {...register('firstName')}
                />
              )}
            </FormField>
            <FormField label="Last name" error={errors.lastName?.message}>
              {({ describedBy }) => (
                <TextInput
                  type="text"
                  autoComplete="family-name"
                  placeholder="Optional"
                  aria-invalid={Boolean(errors.lastName)}
                  aria-describedby={describedBy}
                  {...register('lastName')}
                />
              )}
            </FormField>
          </div>
          <FormField label="Phone" error={errors.phone?.message}>
            {({ describedBy }) => (
              <TextInput
                type="tel"
                autoComplete="tel"
                placeholder="Optional"
                aria-invalid={Boolean(errors.phone)}
                aria-describedby={describedBy}
                {...register('phone')}
              />
            )}
          </FormField>
          {errors.root?.message ? (
            <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive">
              {errors.root.message}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            className="inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            <UserPlus size={17} aria-hidden="true" />
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="mt-5 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link
            to={`/login${searchParams.get('redirect') ? `?redirect=${encodeURIComponent(searchParams.get('redirect'))}` : ''}`}
            className="font-semibold text-accent-link hover:no-underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </Container>
  );
}
