/**
 * Aeromorph Desktop Development Runner
 * 
 * Starts the Vite frontend development server and polls for readiness
 * before launching the Electron desktop window.
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const VITE_PORT = 3000;
const VITE_URL = `http://localhost:${VITE_PORT}`;
const MAX_WAIT_MS = 30000;
const POLL_INTERVAL_MS = 250;

console.log('[Aeromorph Dev] Starting Vite frontend server in ./frontend...');

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';
const npxCmd = isWindows ? 'npx.cmd' : 'npx';

const frontendProcess = spawn(npmCmd, ['run', 'dev'], {
  cwd: path.join(__dirname, '..', 'frontend'),
  stdio: 'inherit',
  shell: true,
});

let isShuttingDown = false;
let electronProcess = null;

function cleanup() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\n[Aeromorph Dev] Shutting down development processes...');

  if (electronProcess && !electronProcess.killed) {
    try {
      if (isWindows) {
        spawn('taskkill', ['/pid', electronProcess.pid, '/f', '/t']);
      } else {
        electronProcess.kill();
      }
    } catch {}
  }

  if (frontendProcess && !frontendProcess.killed) {
    try {
      if (isWindows) {
        spawn('taskkill', ['/pid', frontendProcess.pid, '/f', '/t']);
      } else {
        frontendProcess.kill();
      }
    } catch {}
  }

  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

frontendProcess.on('exit', (code) => {
  if (!isShuttingDown) {
    console.error(`[Aeromorph Dev] Vite dev server exited unexpectedly with code ${code}`);
    cleanup();
  }
});

/**
 * Check if the Vite dev server is responding
 */
function checkServerReady() {
  return new Promise((resolve) => {
    const req = http.get(VITE_URL, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('error', () => {
      resolve(false);
    });
    req.setTimeout(500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Wait for Vite server readiness via polling
 */
async function waitForServer() {
  const startTime = Date.now();
  process.stdout.write('[Aeromorph Dev] Waiting for Vite server readiness');

  while (Date.now() - startTime < MAX_WAIT_MS) {
    const isReady = await checkServerReady();
    if (isReady) {
      console.log(`\n[Aeromorph Dev] Vite server is ready at ${VITE_URL}!`);
      return true;
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  console.error('\n[Aeromorph Dev] Timed out waiting for Vite server.');
  return false;
}

/**
 * Launch Electron once server is confirmed ready
 */
async function launch() {
  const ready = await waitForServer();
  if (!ready) {
    cleanup();
    return;
  }

  console.log('[Aeromorph Dev] Launching Electron desktop window...');

  electronProcess = spawn(npxCmd, ['electron', '.', '--dev'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    shell: true,
  });

  electronProcess.on('exit', (code) => {
    console.log(`[Aeromorph Dev] Electron window closed (exit code ${code}).`);
    cleanup();
  });
}

launch();
