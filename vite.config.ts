import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  // three.js is most of the bundle; one chunk loads fine for a single-page toy.
  build: { chunkSizeWarningLimit: 900 },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
} as never);
