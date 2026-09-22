import { useEffect } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { LogIn, Zap } from 'lucide-react';
import { useAuthStore } from '../stores/useAuthStore.js';
import { Button } from '../components/ui/Button.jsx';
import { Field, Input } from '../components/ui/Field.jsx';

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required.').max(255).email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.').max(256),
});

function safeRedirect(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/dashboard';
}

/**
 * Admin sign-in. Documented `POST /auth/login` only; the store enforces
 * the ADMIN role post-login (non-admin accounts are signed straight back
 * out — backend `authorize("ADMIN")` remains authoritative). Rate-limit
 * friendly: submit disables while pending; `429` surfaces as backoff copy.
 */
export function LoginPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const login = useAuthStore((state) => state.login);

  const isAdmin = Array.isArray(user?.roles) && user.roles.includes('ADMIN');
  const redirectTo = safeRedirect(searchParams.get('redirect'));

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
    document.title = 'Sign in — Tech Pulse Admin';
  }, []);

  if (status === 'ready' && isAdmin) {
    return <Navigate to={redirectTo} replace />;
  }

  const onSubmit = handleSubmit(async (values) => {
    const { ok } = await login(values);
    if (!ok) {
      const { error } = useAuthStore.getState();
      const code = error?.code;
      const message =
        code === 'NOT_ADMIN'
          ? error.message
          : code === 'AUTH_INVALID_CREDENTIALS' || code === 'HTTP_401'
            ? 'Incorrect email or password.'
            : code === 'AUTH_ACCOUNT_INACTIVE' || code === 'HTTP_403'
              ? 'This account is disabled. Contact support.'
              : code === 'HTTP_429'
                ? 'Too many attempts. Please wait a minute and try again.'
                : (error?.message ?? 'Sign in failed. Please try again.');
      setError('root', { message });
      return;
    }
    navigate(redirectTo, { replace: true });
  });

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-destructive text-destructive-foreground"
          >
            <Zap size={22} strokeWidth={2.5} fill="currentColor" />
          </span>
          <div>
            <p className="text-lg font-extrabold tracking-tight text-foreground">TECH PULSE</p>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Admin
            </p>
          </div>
        </div>

        <h1 className="mb-1 text-xl font-bold tracking-tight text-foreground">Sign in</h1>
        <p className="mb-5 text-sm text-muted-foreground">
          Admin accounts only. Customer accounts cannot access this panel.
        </p>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <Field label="Email" required error={errors.email?.message}>
            {({ errorId }) => (
              <Input
                type="email"
                autoComplete="username"
                placeholder="admin@example.com"
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errorId}
                {...register('email')}
              />
            )}
          </Field>
          <Field label="Password" required error={errors.password?.message}>
            {({ errorId }) => (
              <Input
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errorId}
                {...register('password')}
              />
            )}
          </Field>

          {errors.root?.message ? (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm font-medium text-destructive">
              {errors.root.message}
            </p>
          ) : null}

          <Button type="submit" loading={isSubmitting} className="mt-1 w-full">
            <LogIn size={17} aria-hidden="true" />
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
