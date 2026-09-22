import { create } from 'zustand';

/**
 * Admin theme state. Own persistence key (`tp-admin-theme`) — the admin is
 * a separate origin from the storefront, so preferences never collide.
 * Only explicit `light`/`dark` is stored; absence follows the OS setting.
 */

export const ADMIN_THEME_STORAGE_KEY = 'tp-admin-theme';

function getSystemTheme() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStoredPreference() {
  try {
    const stored = window.localStorage.getItem(ADMIN_THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null;
  }
}

function resolveTheme(preference) {
  return preference === 'system' ? getSystemTheme() : preference;
}

function applyResolvedTheme(resolved) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
}

function persistPreference(preference) {
  try {
    if (preference === 'system') {
      window.localStorage.removeItem(ADMIN_THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, preference);
    }
  } catch {
    /* Storage unavailable — theme still applies in-memory. */
  }
}

let mediaListenerAttached = false;

function attachSystemListener() {
  if (mediaListenerAttached || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return;
  }
  mediaListenerAttached = true;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const handleChange = () => {
    if (useThemeStore.getState().preference === 'system') {
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
  preference: initialPreference,
  resolved: resolveTheme(initialPreference),

  setPreference: (preference) => {
    if (preference !== 'light' && preference !== 'dark' && preference !== 'system') return;
    persistPreference(preference);
    const resolved = resolveTheme(preference);
    applyResolvedTheme(resolved);
    set({ preference, resolved });
  },

  toggle: () => {
    const { resolved } = useThemeStore.getState();
    const next = resolved === 'dark' ? 'light' : 'dark';
    persistPreference(next);
    applyResolvedTheme(next);
    set({ preference: next, resolved: next });
  },
}));

/** Idempotent bootstrap: sync store with document root + OS listener. */
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
