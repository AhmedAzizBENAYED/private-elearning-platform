import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Explicit imports from 'vitest' instead of ambient globals, so a test file
    // reads the same as any other module and needs no extra type entry.
    globals: false,
    css: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
