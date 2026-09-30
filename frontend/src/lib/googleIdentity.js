/**
 * Google Identity Services (GIS) loader + credential request.
 *
 * The GIS script is loaded lazily (singleton promise) only when a Google
 * button mounts — never on unrelated pages. The credential flow uses
 * Google's `initialize` + `prompt` (account chooser) with the app's
 * `VITE_GOOGLE_CLIENT_ID`: the credential callback hands the ID token to
 * the caller, which signs in through the existing `POST /auth/google`
 * session flow. No tokens are stored here.
 */

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

let scriptPromise = null;

export function loadGoogleIdentity() {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return Promise.reject(new Error('Google sign-in is unavailable in this environment.'));
  }
  if (window.google?.accounts?.id) {
    return Promise.resolve(window.google.accounts.id);
  }
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GIS_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        if (window.google?.accounts?.id) {
          resolve(window.google.accounts.id);
        } else {
          reject(new Error('Google sign-in failed to load.'));
        }
      };
      script.onerror = () => {
        reject(new Error('Google sign-in failed to load.'));
      };
      document.head.appendChild(script);
    }).catch((error) => {
      // A failed load must not poison later attempts (e.g. transient
      // network blip before retry).
      scriptPromise = null;
      throw error;
    });
  }
  return scriptPromise;
}

export async function requestGoogleCredential(clientId, { onCredential } = {}) {
  if (typeof clientId !== 'string' || clientId.trim() === '') {
    throw googleError('GOOGLE_NOT_CONFIGURED', 'Google sign-in needs a client ID.');
  }
  const id = await loadGoogleIdentity();
  return new Promise((resolve, reject) => {
    let settled = false;
    const settleResolve = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const settleReject = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    id.initialize({
      client_id: clientId,
      callback: (response) => {
        if (response?.credential) {
          onCredential?.(response.credential);
          settleResolve(response.credential);
        } else {
          settleReject(googleError('GOOGLE_NO_CREDENTIAL', 'Google sign-in did not return a credential.'));
        }
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    try {
      // The prompt moment listener distinguishes a user dismiss (quiet
      // reset) from an environment where One Tap cannot display at all.
      id.prompt((moment) => {
        if (!moment) return;
        if (typeof moment.isDismissedMoment === 'function' && moment.isDismissedMoment()) {
          settleReject(googleError('GOOGLE_DISMISSED', 'Google sign-in was dismissed.'));
        } else if (
          (typeof moment.isNotDisplayedMoment === 'function' && moment.isNotDisplayedMoment()) ||
          (typeof moment.isSkippedMoment === 'function' && moment.isSkippedMoment())
        ) {
          settleReject(googleError('GOOGLE_UNAVAILABLE', 'Google sign-in is unavailable right now. Please use email sign-in.'));
        }
      });
    } catch {
      settleReject(googleError('GOOGLE_UNAVAILABLE', 'Google sign-in is unavailable right now. Please use email sign-in.'));
    }
  });
}

function googleError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function resetGoogleIdentityForTests() {
  scriptPromise = null;
}
