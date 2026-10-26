import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function backendProxyTarget(): string {
  const statePath = process.env.WIR_BACKEND_STATE_PATH;
  if (!statePath) return 'http://127.0.0.1:8000';
  if (!existsSync(statePath)) {
    throw new Error(`Workforce360 development backend state is missing: ${statePath}`);
  }
  const state = JSON.parse(readFileSync(statePath, 'utf8')) as {
    project_root?: string;
    backend_url?: string;
  };
  if (resolve(state.project_root ?? '') !== projectRoot) {
    throw new Error(`Workforce360 frontend refused backend state from another project: ${statePath}`);
  }
  if (!state.backend_url || !/^http:\/\//.test(state.backend_url)) {
    throw new Error(`Workforce360 backend state has no valid backend_url: ${statePath}`);
  }
  return state.backend_url;
}

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: backendProxyTarget(),
        changeOrigin: true,
      },
    },
  },
  test: { environment: 'jsdom', restoreMocks: true },
});
