import { useThemeStore } from '../stores/useThemeStore.js';

/**
 * Public theme hook for components. Wraps the Zustand store so UI code never
 * touches `localStorage` or `document.documentElement` directly.
 *
 * @returns {{ preference: 'light'|'dark'|'system', resolved: 'light'|'dark',
 *   isDark: boolean, setPreference: Function, toggle: Function }}
 */
export function useTheme() {
  const preference = useThemeStore((state) => state.preference);
  const resolved = useThemeStore((state) => state.resolved);
  const setPreference = useThemeStore((state) => state.setPreference);
  const toggle = useThemeStore((state) => state.toggle);

  return {
    preference,
    resolved,
    isDark: resolved === 'dark',
    setPreference,
    toggle,
  };
}
