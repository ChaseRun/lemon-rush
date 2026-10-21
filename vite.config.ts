import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    passWithNoTests: true,
    // Agent worktrees live under .claude/; they're separate checkouts, not this project's tests.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
  },
});
