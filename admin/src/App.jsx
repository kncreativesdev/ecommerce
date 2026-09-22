import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { router } from './routes/router.jsx';
import { initTheme } from './stores/useThemeStore.js';
import { useAuthStore } from './stores/useAuthStore.js';

initTheme();

/**
 * Admin application root: route tree only — no business logic.
 * Kicks off the session bootstrap once (silent refresh → me → ADMIN
 * check); route guards render loading gates until it resolves. Sonner
 * `Toaster` is mounted once for mutation feedback.
 */
export default function App() {
  useEffect(() => {
    useAuthStore.getState().bootstrap();
  }, []);

  return (
    <>
      <RouterProvider router={router} />
      <Toaster position="top-center" richColors closeButton />
    </>
  );
}
