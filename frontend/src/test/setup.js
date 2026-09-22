import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Isolate rendered trees between tests (explicit setup file keeps test
// globals out of the linted source).
afterEach(() => {
  cleanup();
});
