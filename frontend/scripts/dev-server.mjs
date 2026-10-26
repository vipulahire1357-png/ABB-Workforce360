import { createServer } from 'vite';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(frontendRoot, '..');
const runtimeHome = resolve(process.env.WIR_RUNTIME_HOME || resolve(projectRoot, 'data', 'run', 'development'));
const backendStatePath = resolve(process.env.WIR_BACKEND_STATE_PATH || resolve(runtimeHome, 'backend.json'));
const frontendStatePath = resolve(process.env.WIR_FRONTEND_STATE_PATH || resolve(runtimeHome, 'frontend.json'));
const runId = process.env.WIR_RUN_ID || 'manual-vite';
const preferredPort = Number(process.env.WIR_FRONTEND_PREFERRED_PORT || 5173);

function readBackendState() {
  if (!existsSync(backendStatePath)) {
    return { backend_url: 'http://127.0.0.1:8000' };
  }
  const state = JSON.parse(readFileSync(backendStatePath, 'utf8'));
  if (resolve(state.project_root || '') !== projectRoot) {
    throw new Error(`Backend runtime state does not belong to this checkout: ${backendStatePath}`);
  }
  if (typeof state.backend_url !== 'string' || !/^http:\/\//.test(state.backend_url)) {
    throw new Error(`Backend runtime state has no valid backend_url: ${backendStatePath}`);
  }
  return state;
}

function saveFrontendState(state) {
  mkdirSync(dirname(frontendStatePath), { recursive: true });
  const temporary = `${frontendStatePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(temporary, frontendStatePath);
}

let server;
let writtenRunId;
try {
  const backendState = readBackendState();
  server = await createServer({
    root: frontendRoot,
    server: {
      host: '0.0.0.0',
      port: preferredPort,
      strictPort: false,
      clearScreen: false,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not expose its bound TCP port.');
  const frontendPort = address.port;
  const state = {
    mode: 'development-frontend',
    project_root: projectRoot,
    runtime_home: runtimeHome,
    run_id: runId,
    frontend_port: frontendPort,
    frontend_url: `http://127.0.0.1:${frontendPort}`,
    process: {
      pid: process.pid,
      executable: process.execPath,
      started_at: new Date().toISOString(),
    },
    backend_url: backendState.backend_url,
  };
  saveFrontendState(state);
  writtenRunId = runId;
  console.log(`Workforce360 Vite server ready: ${state.frontend_url}`);

  await new Promise((resolveStop) => {
    let stopping = false;
    const finish = () => {
      if (stopping) return;
      stopping = true;
      resolveStop();
    };
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      if (chunk.includes('STOP')) finish();
    });
    process.stdin.resume();
  });
} catch (error) {
  console.error(`Workforce360 Vite startup failed: ${error?.stack || error}`);
  process.exitCode = 1;
} finally {
  if (server) await server.close();
  if (writtenRunId && existsSync(frontendStatePath)) {
    try {
      const state = JSON.parse(readFileSync(frontendStatePath, 'utf8'));
      if (state.run_id === writtenRunId && state.process?.pid === process.pid) unlinkSync(frontendStatePath);
    } catch {
      // Leave an unreadable state record for inspection instead of deleting unknown data.
    }
  }
}
