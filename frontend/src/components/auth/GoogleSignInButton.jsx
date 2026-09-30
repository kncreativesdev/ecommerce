import { useEffect, useRef, useState } from 'react';
import { env } from '../../config/env.js';
import { loadGoogleIdentity, requestGoogleCredential } from '../../lib/googleIdentity.js';

/**
 * Official Google "G" mark (brand colors) for the first-party Continue
 * with Google button. Decorative — the button text carries the name.
 */
function GoogleMark() {
  return (
    <svg width={18} height={18} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#4285F4"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#FBBC05"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#34A853"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

/**
 * Continue with Google button (Google Identity Services credential flow).
 *
 * This is a real first-party button — always rendered with visible text,
 * keyboard-focusable, and named "Continue with Google". Clicking starts
 * the GIS account chooser; the credential callback yields an ID token,
 * which the caller signs in with through the existing
 * `POST /auth/google` session flow (`onCredential(idToken)`). No tokens
 * are stored here.
 *
 * When no `VITE_GOOGLE_CLIENT_ID` is configured the button stays visible
 * but explains the missing setup on click instead of failing silently. A
 * user-dismissed chooser resets quietly; genuine GIS failures surface as
 * a small inline message.
 */
export function GoogleSignInButton({ onCredential }) {
  const clientId = env.googleClientId;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const callbackRef = useRef(onCredential);

  // Keep the latest credential callback without re-running effects
  // (assigned in an effect, never during render).
  useEffect(() => {
    callbackRef.current = onCredential;
  });

  // Warm up the GIS script while the form is visible so the click starts
  // instantly. Load failures stay silent here — the click path reports.
  useEffect(() => {
    if (!clientId) return;
    loadGoogleIdentity().catch(() => {});
  }, [clientId]);

  const handleClick = async () => {
    if (pending) return;
    if (!clientId) {
      setError('Google sign-in needs a client ID — set VITE_GOOGLE_CLIENT_ID to enable it.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await requestGoogleCredential(clientId, {
        onCredential: (idToken) => callbackRef.current?.(idToken),
      });
    } catch (requestError) {
      if (requestError?.code !== 'GOOGLE_DISMISSED') {
        setError(requestError?.message ?? 'Google sign-in is unavailable right now. Please use email sign-in.');
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-busy={pending}
        className="inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-3 rounded-xl border border-border bg-card px-6 text-sm font-semibold text-foreground transition-colors duration-200 hover:bg-surface-muted disabled:cursor-wait disabled:opacity-70"
      >
        <GoogleMark />
        {pending ? 'Connecting to Google…' : 'Continue with Google'}
      </button>
      {error ? (
        <p role="alert" className="text-center text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
