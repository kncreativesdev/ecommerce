import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { router } from './routes/router.jsx';
import { initTheme } from './stores/useThemeStore.js';
import { useAuthStore } from './stores/useAuthStore.js';

// Synchronize the theme store with the document root (pre-paint script in
// index.html already applied the correct class before first paint).
initTheme();

/**
 * Application root: route tree + session bootstrap (one silent refresh
 * attempt on load) + global toast host. No business logic.
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
