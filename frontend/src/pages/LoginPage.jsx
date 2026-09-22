import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { Container } from '../components/ui/Container.jsx';
import { FormField, TextInput } from '../components/ui/FormField.jsx';
import { loginSchema } from '../schemas/auth.schema.js';
import { zodResolver, applyServerErrors } from '../lib/formValidation.js';
import { useAuthStore } from '../stores/useAuthStore.js';

function safeRedirect(value) {
  if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) {
    return value;
  }
  return '/account';
}

/**
 * Login (`/login?redirect=`, public, redirects away when authenticated).
 * Email normalized client-side; `401` → form-level error; `403` inactive
 * → support message; `429` → backoff. Success returns to `redirect`.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = safeRedirect(searchParams.get('redirect'));
  const login = useAuthStore((state) => state.login);
  const isAuthenticated = Boolean(useAuthStore((state) => state.accessToken));
  const status = useAuthStore((state) => state.status);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  useEffect(() => {
    document.title = 'Sign in — Tech Pulse';
  }, []);

  useEffect(() => {
    if (isAuthenticated && status === 'ready') {
      navigate(redirectTo, { replace: true });
    }
  }, [isAuthenticated, status, navigate, redirectTo]);

  const [showPassword, setShowPassword] = useState(false);

  const onSubmit = async (values) => {
    const result = await login(values);
    if (result.ok) {
      toast.success('Welcome back!');
      navigate(redirectTo, { replace: true });
      return;
    }
    const error = result.error;
    if (error?.code === 'AUTH_INVALID_CREDENTIALS' || error?.status === 401) {
      setError('root', { type: 'server', message: 'Incorrect email or password. Please try again.' });
    } else if (error?.code === 'AUTH_ACCOUNT_INACTIVE' || error?.status === 403) {
      setError('root', { type: 'server', message: 'This account is disabled. Please contact support.' });
    } else if (error?.status === 429) {
      setError('root', { type: 'server', message: 'Too many attempts. Please wait a moment and try again.' });
    } else {
      const rootMessage = applyServerErrors(setError, error?.details);
      setError('root', { type: 'server', message: rootMessage ?? error?.message ?? 'Sign-in failed. Please try again.' });
    }
  };

  return (
    <Container className="flex justify-center py-10 sm:py-14">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in to shop faster, track orders, and sync your cart.
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
          <FormField label="Password" required error={errors.password?.message}>
            {({ describedBy }) => (
              <div className="relative">
                <TextInput
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Your password"
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={describedBy}
                  className="pr-12"
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-1.5 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 hover:bg-surface-muted hover:text-foreground"
                >
                  {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                </button>
              </div>
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
            <LogIn size={17} aria-hidden="true" />
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="mt-5 text-center text-sm text-muted-foreground">
          New to Tech Pulse?{' '}
          <Link
            to={`/register${searchParams.get('redirect') ? `?redirect=${encodeURIComponent(searchParams.get('redirect'))}` : ''}`}
            className="font-semibold text-accent-link hover:no-underline"
          >
            Create an account
          </Link>
        </p>
      </div>
    </Container>
  );
}
