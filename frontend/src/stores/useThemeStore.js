import { create } from 'zustand';

/**
 * Theme state for Tech Pulse (Milestone 1 — complete theme foundation).
 *
 * - `preference`: the user's explicit choice (`light` | `dark`) or `system`.
 * - `resolved`: the effective theme applied to `<html>` (`light` | `dark`).
 * - Persistence key is EXACTLY `tp-theme` and stores ONLY the explicit
 *   choice (`light` | `dark`). Absent key (or `system`) follows the OS
 *   `prefers-color-scheme`. No other application state lives in this key.
 */

export const THEME_STORAGE_KEY = 'tp-theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function getSystemTheme() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

function readStoredPreference() {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null;
  }
}

function resolveTheme(preference) {
  return preference === 'system' ? getSystemTheme() : preference;
}

/** Single place that touches the document root — no duplicated theme logic. */
function applyResolvedTheme(resolved) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) {
    meta.setAttribute('content', resolved === 'dark' ? '#090909' : '#ffffff');
  }
}

function persistPreference(preference) {
  try {
    if (preference === 'system') {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    /* Storage unavailable (private mode etc.) — theme still applies in-memory. */
  }
}

let mediaListenerAttached = false;

function attachSystemListener() {
  if (
    mediaListenerAttached ||
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return;
  }
  mediaListenerAttached = true;
  const media = window.matchMedia(DARK_QUERY);
  const handleChange = () => {
    const { preference } = useThemeStore.getState();
    if (preference === 'system') {
      const resolved = getSystemTheme();
      applyResolvedTheme(resolved);
      useThemeStore.setState({ resolved });
    }
  };
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', handleChange);
  } else if (typeof media.addListener === 'function') {
    media.addListener(handleChange);
  }
}

const initialPreference = readStoredPreference() ?? 'system';

export const useThemeStore = create((set) => ({
  /** Explicit user choice; `system` means "follow the OS setting". */
  preference: initialPreference,
  /** Effective theme currently applied to the document root. */
  resolved: resolveTheme(initialPreference),

  setPreference: (preference) => {
    if (preference !== 'light' && preference !== 'dark' && preference !== 'system') {
      return;
    }
    persistPreference(preference);
    const resolved = resolveTheme(preference);
    applyResolvedTheme(resolved);
    set({ preference, resolved });
  },

  toggle: () => {
    const { resolved } = useThemeStore.getState();
    // Toggle the *effective* theme so the button always flips what the user sees.
    const next = resolved === 'dark' ? 'light' : 'dark';
    persistPreference(next);
    applyResolvedTheme(next);
    set({ preference: next, resolved: next });
    return next;
  },
}));

/**
 * Idempotent bootstrap: synchronizes the store with the document root and
 * starts listening for OS theme changes. Safe to call on every app mount;
 * the pre-paint inline script in index.html already handled first paint.
 */
export function initTheme() {
  attachSystemListener();
  const { preference } = useThemeStore.getState();
  const resolved = resolveTheme(preference);
  applyResolvedTheme(resolved);
  if (useThemeStore.getState().resolved !== resolved) {
    useThemeStore.setState({ resolved });
  }
  return resolved;
}

export { getSystemTheme };
