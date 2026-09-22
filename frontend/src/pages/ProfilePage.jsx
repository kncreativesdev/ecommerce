import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Container } from '../components/ui/Container.jsx';
import { Breadcrumbs } from '../components/layout/Breadcrumbs.jsx';
import { FormField, TextInput } from '../components/ui/FormField.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { ErrorState } from '../components/ui/ErrorState.jsx';
import { useSession } from '../hooks/useSession.js';
import { fetchProfile, updateProfile } from '../services/users.service.js';
import { applyServerErrors } from '../lib/formValidation.js';

/**
 * Profile (`/account/profile`, protected): view/edit own profile. Email is
 * read-only (no email-change endpoint). Save disables when untouched —
 * an empty PATCH body yields `422`.
 */
export function ProfilePage() {
  const { user } = useSession();
  const [profile, setProfile] = useState(user ?? null);
  const [status, setStatus] = useState('loading');
  const [loadError, setLoadError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    defaultValues: {
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
      phone: user?.phone ?? '',
    },
  });

  useEffect(() => {
    document.title = 'Profile — Tech Pulse';
  }, []);

  // Mount + retry fetching. State updates happen only in the async
  // continuations below (never synchronously in the effect body).
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    fetchProfile()
      .then((data) => {
        if (signal.aborted) return;
        setProfile(data);
        reset({
          firstName: data?.firstName ?? '',
          lastName: data?.lastName ?? '',
          phone: data?.phone ?? '',
        });
        setStatus('success');
      })
      .catch((error) => {
        if (signal.aborted) return;
        setLoadError(error);
        setStatus('error');
      });
    return () => controller.abort();
  }, [reset, reloadToken]);

  const retry = () => {
    setStatus('loading');
    setLoadError(null);
    setReloadToken((token) => token + 1);
  };

  const onSubmit = async (values) => {
    try {
      const updated = await updateProfile({
        firstName: values.firstName,
        lastName: values.lastName,
        phone: values.phone,
      });
      setProfile(updated);
      reset({
        firstName: updated?.firstName ?? '',
        lastName: updated?.lastName ?? '',
        phone: updated?.phone ?? '',
      });
      toast.success('Profile updated.');
    } catch (error) {
      const rootMessage = applyServerErrors(setError, error?.details);
      if (error?.code === 'USER_UPDATE_INVALID' || error?.status === 422) {
        setError('root', { type: 'server', message: rootMessage ?? 'No changes to save.' });
      } else {
        setError('root', { type: 'server', message: rootMessage ?? error?.message ?? 'Update failed. Please try again.' });
      }
    }
  };

  return (
    <Container className="flex max-w-2xl flex-col gap-6 py-10 sm:py-14">
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'My Account', to: '/account' }, { label: 'Profile' }]} />
      <h1 className="text-2xl font-bold tracking-tight">Profile</h1>

      {status === 'loading' ? (
        <div role="status" aria-label="Loading profile" className="flex flex-col gap-3">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </div>
      ) : status === 'error' ? (
        <ErrorState
          title="Couldn’t load your profile"
          message={loadError?.message ?? 'Please try again.'}
          onRetry={retry}
        />
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <FormField label="Email" hint="Email changes aren’t supported — contact support for help.">
            {() => (
              <TextInput type="email" value={profile?.email ?? ''} readOnly disabled aria-readonly="true" />
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="First name" error={errors.firstName?.message}>
              {({ describedBy }) => (
                <TextInput
                  type="text"
                  autoComplete="given-name"
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
            disabled={isSubmitting || !isDirty}
            aria-busy={isSubmitting}
            title={!isDirty ? 'Make a change to enable saving' : undefined}
            className="inline-flex min-h-[48px] cursor-pointer items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      )}
    </Container>
  );
}
