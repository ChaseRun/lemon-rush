import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Allow sharing the game through an ngrok tunnel (Vite rejects unknown Host headers by default).
  server: { allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.ngrok.io'] },
  preview: { allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.ngrok.io'] },
  test: {
    environment: 'node',
    passWithNoTests: true,
    // Agent worktrees live under .claude/; they're separate checkouts, not this project's tests.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
  },
});
