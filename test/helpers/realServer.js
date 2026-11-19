// Starts the REAL server (server/index.js) as a child process against a throwaway
// in-memory MongoDB, for end-to-end tests. The child runs from an empty temp
// directory, so server/.env is never loaded and production can't be reached.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const serverDir = path.join(here, '..', '..', 'server');
// require() that resolves from server/ — models, libs and server/node_modules.
export const serverRequire = createRequire(path.join(serverDir, 'index.js'));

export const SECRET = 'test-hub-secret-' + 'x'.repeat(40);

// Bind :0, read what the OS assigned, release it. There is still a window between
// release and the child binding, but it is a race against other processes on this
// machine rather than a 1-in-90 collision with our own siblings.
async function freePort() {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

export function sessionCookie(user, secret = SECRET) {
  const jwt = serverRequire('jsonwebtoken');
  return `dm3a_session=${jwt.sign({ uid: String(user._id), email: user.email }, secret, { expiresIn: '1h' })}`;
}

// Returns { base, uri, stop }. `env` adds/overrides child environment variables.
export async function startRealServer(env = {}) {
  const { MongoMemoryServer } = serverRequire('mongodb-memory-server');
  const mongoose = serverRequire('mongoose');
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('dm3a_test');
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:/, 'tests must only ever use the in-memory database');
  await mongoose.connect(uri);

  // A free port, asked of the OS rather than guessed. Six test files start a real
  // server, and node --test runs them in parallel, so a random pick from a 90-wide
  // range collided often enough to hang a whole run: the second server failed to bind,
  // its before() waited for a startup line that never came, and the file timed out.
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(serverDir, 'index.js')], {
    cwd: mkdtempSync(path.join(tmpdir(), 'dm3a-test-')),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'test',
      PORT: String(port),
      MONGODB_URI: uri,
      HUB_JWT_SECRET: SECRET,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const deadline = Date.now() + 20000;
  while (!(log.includes('DM3A Server running') && log.includes('MongoDB connected'))) {
    if (Date.now() > deadline || child.exitCode !== null) throw new Error(`server did not start on port ${port} (exit ${child.exitCode}):\n` + log);
    await new Promise((r) => setTimeout(r, 100));
  }

  return {
    base: `http://127.0.0.1:${port}`,
    uri,
    log: () => log,
    async stop() {
      child.kill();
      await mongoose.disconnect();
      await mongod.stop();
    },
  };
}
