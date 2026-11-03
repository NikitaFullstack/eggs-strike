import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

function readTimeoutEnv(name, fallback, maximum) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1000 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 1000 to ${maximum} milliseconds`);
  }
  return value;
}
const testTimeoutMs = readTimeoutEnv('EGG_TEST_TIMEOUT_MS', 120000, 3600000);
const startTimeoutMs = readTimeoutEnv('EGG_TEST_START_TIMEOUT_MS', 15000, 300000);
const root = fileURLToPath(new URL('..', import.meta.url));
const serverTests = [
  'test-client-lifecycle.mjs',
  'test-vertical-physics.mjs',
  'test-server-clock-hit.mjs',
  'test-pause-resume.mjs',
  'test-appearance.mjs',
  'test-map-layout.mjs',
  'test-map-navigation.mjs',
  'test-household-maps.mjs',
  'test-household-server.mjs',
  'test-coop-geometry.mjs',
  'test-mesh-world.mjs',
  'test-henhouse-level.mjs',
  'test-henhouse-spawns.mjs',
  'test-training-server.mjs',
  'test-shot-results.mjs',
  'test-hit-rewind.mjs',
  'test-grenades.mjs',
];
const browserTests = ['test-appearance-ui.mjs', 'test-ui-copy.mjs', 'test-training-map.mjs', 'test-grenade-ui.mjs', 'test-ramp-descent.mjs', 'test-household-ui.mjs'];
const args = process.argv.slice(2);
const requested = args.filter(arg => arg !== '--browser');
const tests = requested.length ? requested : (args.includes('--browser') ? browserTests : serverTests).map(name => `tests/${name}`);
let server, current;

async function freePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 2000);
  try { await exited; } finally { clearTimeout(force); }
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  await stop(current);
  await stop(server);
  process.exit(signal === 'SIGINT' ? 130 : 143);
});

try {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), MATCH_TIME: '300' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => done(new Error(`Test server did not start within ${startTimeoutMs} ms:\n${output}`)), startTimeoutMs);
    function done(error) {
      clearTimeout(timeout);
      server.stdout.off('data', onData);
      server.stderr.off('data', onData);
      server.off('exit', onExit);
      server.off('error', done);
      error ? reject(error) : resolve();
    }
    function onData(data) {
      output += data;
      if (output.includes('EGG STRIKE ready on')) done();
    }
    function onExit(code, signal) { done(new Error(`Test server exited (${signal || code}):\n${output}`)); }
    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.once('exit', onExit);
    server.once('error', done);
  });
  server.stderr.pipe(process.stderr);
  console.log(`Test server: ${base}`);
  for (const test of tests) {
    console.log(`\n${test}`);
    current = spawn(process.execPath, [test], {
      cwd: root,
      env: { ...process.env, BASE: base },
      stdio: 'inherit',
    });
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; current.kill('SIGKILL'); }, testTimeoutMs);
    try {
      const [code, signal] = await once(current, 'exit');
      if (code !== 0) throw new Error(`${test} ${timedOut ? 'timed out' : `failed (${signal || code})`}`);
    } finally { clearTimeout(timeout); }
    current = null;
  }
  console.log(`\nPASS: ${tests.length} test files`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await stop(current);
  await stop(server);
}
