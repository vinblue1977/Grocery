import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

// base './' lets the same build work under GitHub Pages' /Grocery/ path.
export default defineConfig({
  base: './',
  plugins: [preact()],
  test: { environment: 'jsdom', coverage: { enabled: false } },
});
