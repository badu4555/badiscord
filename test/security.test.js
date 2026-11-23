const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function startServer() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'badiscord-test-'));
  const dbPath = path.join(tempDir, 'test.db');
  const port = 31000 + Math.floor(Math.random() * 1000);
  const server = spawn(process.execPath, [path.join(process.cwd(), 'server', 'server.js')], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DB_PATH: dbPath,
      PORT: String(port),
      NODE_ENV: 'development',
      SMTP_HOST: '',
      SMTP_PORT: '',
      SMTP_USER: '',
      SMTP_PASS: '',
      SMTP_FROM: '',
      ALLOWED_ORIGINS: '*'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  server.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return { server, tempDir, dbPath, port, getStderr: () => stderr };
    } catch (_) {}
    await wait(50);
  }

  server.kill();
  throw new Error(`Server did not start:\n${stderr}`);
}

async function stopServer(started) {
  if (started.server.exitCode !== null) return;
  await new Promise((resolve) => {
    started.server.once('exit', resolve);
    started.server.kill();
  });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(started.tempDir, { recursive: true, force: true });
      return;
    } catch (_) {
      await wait(50);
    }
  }
  fs.rmSync(started.tempDir, { recursive: true, force: true });
}

function getSessionCookie(response) {
  const match = /badiscord_session=[^;,]+/.exec(response.headers.get('set-cookie') || '');
  assert.ok(match, 'The response must set a session cookie');
  return match[0];
}

async function post(baseUrl, route, body, cookie) {
  return fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(body)
  });
}

async function put(baseUrl, route, body, cookie) {
  return fetch(`${baseUrl}${route}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body)
  });
}

async function del(baseUrl, route, cookie) {
  return fetch(`${baseUrl}${route}`, {
    method: 'DELETE',
    headers: { Cookie: cookie }
  });
}

test('profile, login and E2EE revocation protections', async (t) => {
  const started = await startServer();
  t.after(() => stopServer(started));

  const baseUrl = `http://127.0.0.1:${started.port}`;
  const suffix = crypto.randomUUID();
  const owner = await post(baseUrl, '/api/auth/register', {
    email: `owner-${suffix}@example.com`,
    username: `owner_${suffix.slice(0, 8)}`,
    password: 'Original!234',
    displayName: 'Owner'
  });
  const ownerData = await owner.json();
  assert.equal(owner.status, 201, JSON.stringify(ownerData));
  const ownerCookie = getSessionCookie(owner);

  const member = await post(baseUrl, '/api/auth/register', {
    email: `member-${suffix}@example.com`,
    username: `member_${suffix.slice(0, 8)}`,
    password: 'Original!234',
    displayName: 'Member'
  });
  const memberData = await member.json();
  assert.equal(member.status, 201, JSON.stringify(memberData));
  const memberCookie = getSessionCookie(member);

  assert.equal((await put(baseUrl, '/api/profile', {
    displayName: '<svg/onload=alert(1)>',
    avatarUrl: ''
  }, ownerCookie)).status, 400);

  assert.equal((await put(baseUrl, '/api/profile', {
    displayName: 'OwnerSafe',
    avatarUrl: 'https://example.com/x" onerror=alert(1)'
  }, ownerCookie)).status, 400);

  const missingLogin = await post(baseUrl, '/api/auth/login', {
    email: `missing-${suffix}@example.com`,
    password: 'Wrong!234'
  });
  const wrongLogin = await post(baseUrl, '/api/auth/login', {
    email: `owner-${suffix}@example.com`,
    password: 'Wrong!234'
  });
  assert.equal((await missingLogin.json()).error, (await wrongLogin.json()).error);

  const serverResponse = await post(baseUrl, '/api/servers', {
    name: 'Security Test',
    icon: 'Shield'
  }, ownerCookie);
  const serverData = await serverResponse.json();
  assert.equal(serverResponse.status, 201, JSON.stringify(serverData));
  const serverId = serverData.server.id;

  const db = new Database(started.dbPath);
  db.prepare('UPDATE servers SET is_public = 1 WHERE id = ?').run(serverId);
  db.close();

  const join = await post(baseUrl, `/api/servers/${serverId}/join`, {}, memberCookie);
  assert.equal(join.status, 200);

  const conversationId = `server:${serverId}:geral`;
  const wraps = await put(
    baseUrl,
    `/api/e2ee/conversations/${encodeURIComponent(conversationId)}/key`,
    {
      wraps: [
        { userId: ownerData.user.id, wrappedKey: { ciphertext: 'owner' } },
        { userId: memberData.user.id, wrappedKey: { ciphertext: 'member' } }
      ]
    },
    ownerCookie
  );
  assert.equal(wraps.status, 200);

  const beforeKick = await fetch(
    `${baseUrl}/api/e2ee/conversations/${encodeURIComponent(conversationId)}/key`,
    { headers: { Cookie: memberCookie } }
  );
  assert.equal(beforeKick.status, 200);

  const kicked = await del(baseUrl, `/api/servers/${serverId}/members/${memberData.user.id}`, ownerCookie);
  assert.equal(kicked.status, 200);

  const afterKick = await fetch(
    `${baseUrl}/api/e2ee/conversations/${encodeURIComponent(conversationId)}/key`,
    { headers: { Cookie: memberCookie } }
  );
  assert.equal(afterKick.status, 403);
});

test('password recovery is single use and has five-attempt lockout', async (t) => {
  const started = await startServer();
  t.after(() => stopServer(started));

  const baseUrl = `http://127.0.0.1:${started.port}`;
  const suffix = crypto.randomUUID();
  const registered = await post(baseUrl, '/api/auth/register', {
    email: `recovery-${suffix}@example.com`,
    username: `recover_${suffix.slice(0, 8)}`,
    password: 'Original!234',
    displayName: 'Recovery'
  });
  const registeredData = await registered.json();
  assert.equal(registered.status, 201, JSON.stringify(registeredData));

  const unavailable = await post(baseUrl, '/api/auth/recovery/request', {
    email: `recovery-${suffix}@example.com`
  });
  assert.equal(unavailable.status, 503);
  assert.equal(Object.prototype.hasOwnProperty.call(await unavailable.json(), 'demoCode'), false);

  const code = '12345678';
  const recoveryId = `test-recovery-${suffix}`;
  const db = new Database(started.dbPath);
  db.prepare(`INSERT INTO recovery_codes
    (id, user_id, code_hash, expires_at, used_at, failed_attempts)
    VALUES (?, ?, ?, ?, NULL, 0)`).run(
      recoveryId,
      registeredData.user.id,
      crypto.createHash('sha256').update(code).digest('hex'),
      Date.now() + 600_000
    );
  db.close();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failed = await post(baseUrl, '/api/auth/recovery/reset', {
      recoveryId,
      code: '00000000',
      newPassword: 'Changed!234'
    });
    assert.equal(failed.status, 400);
  }

  const locked = await post(baseUrl, '/api/auth/recovery/reset', {
    recoveryId,
    code,
    newPassword: 'Changed!234'
  });
  assert.equal(locked.status, 400);

  const lockedDb = new Database(started.dbPath, { readonly: true });
  const lockedRow = lockedDb.prepare(
    'SELECT failed_attempts, used_at FROM recovery_codes WHERE id = ?'
  ).get(recoveryId);
  lockedDb.close();
  assert.equal(lockedRow.failed_attempts, 5);
  assert.ok(lockedRow.used_at);
});
