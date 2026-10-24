require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { promisify } = require('util');
const cors = require('cors');
const Database = require('better-sqlite3');
const { AccessToken } = require('livekit-server-sdk');

const app = express();
const scryptAsync = promisify(crypto.scrypt);
const AUTH_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const PASSWORD_POLICY = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;
const EMAIL_POLICY = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_POLICY = /^[a-z0-9_]{3,24}$/;
const normalize = (value) => typeof value === 'string' ? value.trim() : '';
const RECAPTCHA_SITE_KEY = normalize(process.env.RECAPTCHA_SITE_KEY);
const RECAPTCHA_SECRET_KEY = normalize(process.env.RECAPTCHA_SECRET_KEY);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const publicDir = path.join(__dirname, '..', 'renderer');
const nodeModulesDir = path.join(__dirname, '..', 'node_modules');

app.use(cors({
  origin: (origin, callback) => {
    const isLocalDevelopmentOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin || '');
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin) || isLocalDevelopmentOrigin) {
      return callback(null, true);
    }
    return callback(new Error('Origin não autorizado'));
  }
  , credentials: true
}));
app.use(express.json());
app.use('/node_modules', express.static(nodeModulesDir));
app.use(express.static(publicDir));

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const PLACEHOLDER_LIVEKIT_KEY = 'coloque_sua_livekit_api_key';
const PLACEHOLDER_LIVEKIT_SECRET = 'coloque_sua_livekit_secret';
const DEV_LIVEKIT_KEY = 'devkey';
const DEV_LIVEKIT_SECRET = 'secret';
const REAL_LIVEKIT_WS_URL = 'wss://badiscord-hifeof9x.livekit.cloud';

const hasPlaceholderLiveKitUrl = (url) => /(?:seu-projeto|your-project)\.livekit\.cloud/i.test(normalize(url));
const isPlaceholderKey = (value) => normalize(value).toLowerCase() === PLACEHOLDER_LIVEKIT_KEY.toLowerCase();
const isPlaceholderSecret = (value) => normalize(value).toLowerCase() === PLACEHOLDER_LIVEKIT_SECRET.toLowerCase();

const livekitApiKey = normalize(process.env.LIVEKIT_API_KEY);
const livekitApiSecret = normalize(process.env.LIVEKIT_API_SECRET);
const livekitWsUrl = normalize(process.env.LIVEKIT_WS_URL || process.env.LIVEKIT_URL);

const isLiveKitConfigured = Boolean(
  livekitApiKey &&
  livekitApiSecret &&
  !isPlaceholderKey(livekitApiKey) &&
  !isPlaceholderSecret(livekitApiSecret) &&
  livekitWsUrl &&
  !hasPlaceholderLiveKitUrl(livekitWsUrl)
);

const LIVEKIT_API_KEY = isLiveKitConfigured ? livekitApiKey : DEV_LIVEKIT_KEY;
const LIVEKIT_API_SECRET = isLiveKitConfigured ? livekitApiSecret : DEV_LIVEKIT_SECRET;
const LIVEKIT_WS_URL = isLiveKitConfigured ? livekitWsUrl : (hasPlaceholderLiveKitUrl(livekitWsUrl) ? REAL_LIVEKIT_WS_URL : (livekitWsUrl || REAL_LIVEKIT_WS_URL));
const REMOTE_BACKEND_URL = process.env.REMOTE_BACKEND_URL || 'https://badiscord.onrender.com';
const PORT = Number(process.env.PORT || 3000);
const databasePath = process.env.DB_PATH || path.join(__dirname, 'data', 'badiscord.db');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    tag TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS recovery_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS friend_requests (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS friendships (
    user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_a, user_b)
  );
  CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS friend_requests_receiver_idx ON friend_requests(receiver_id, status);
`);

const normalizeEmail = (value) => normalize(value).toLowerCase();
const normalizeUsername = (value) => normalize(value).toLowerCase();
const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  username: user.username,
  displayName: user.display_name,
  tag: user.tag,
  createdAt: user.created_at
});
const hashSessionToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${Buffer.from(derivedKey).toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  const [, saltHex, hashHex] = String(storedHash || '').split('$');
  if (!saltHex || !hashHex) return false;
  const derivedKey = await scryptAsync(password, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === derivedKey.length && crypto.timingSafeEqual(expected, Buffer.from(derivedKey));
}

function parseCookies(req) {
  return normalize(req.headers.cookie).split(';').reduce((cookies, pair) => {
    const separator = pair.indexOf('=');
    if (separator < 0) return cookies;
    const key = pair.slice(0, separator).trim();
    cookies[key] = decodeURIComponent(pair.slice(separator + 1).trim());
    return cookies;
  }, {});
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', `badiscord_session=${encodeURIComponent(token)}; Max-Age=${AUTH_SESSION_MAX_AGE_MS / 1000}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'badiscord_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(hashSessionToken(token), userId, now + AUTH_SESSION_MAX_AGE_MS, new Date(now).toISOString());
  setSessionCookie(res, token);
}

function getAuthenticatedUser(req) {
  const token = parseCookies(req).badiscord_session;
  if (!token) return null;
  const session = db.prepare(`
    SELECT users.* FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashSessionToken(token), Date.now());
  return session || null;
}

function requireAuth(req, res, next) {
  const user = getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Faça login para continuar.' });
  req.user = user;
  return next();
}

function getRequestBaseUrl(req) {
  const forwardedProto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').toString();
  const host = (req.headers.host || `localhost:${PORT}`).toString();
  return `${forwardedProto}://${host}`;
}

async function getRemoteConfig() {
  try {
    const response = await fetch(`${REMOTE_BACKEND_URL}/api/config`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (err) {
    console.warn('Fallback do backend remoto indisponível:', err.message);
    return null;
  }
}

async function verifyRecaptcha(token, req) {
  if (!RECAPTCHA_SECRET_KEY) return process.env.NODE_ENV !== 'production';
  if (!token) return false;

  const body = new URLSearchParams({
    secret: RECAPTCHA_SECRET_KEY,
    response: token,
    remoteip: req.ip || ''
  });
  const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!response.ok) return false;
  const result = await response.json();
  return result.success === true;
}

app.get('/api/config', async (req, res) => {
  const baseUrl = getRequestBaseUrl(req);

  if (isLiveKitConfigured || process.env.LIVEKIT_WS_URL || process.env.LIVEKIT_URL || (process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET)) {
    return res.json({
      ok: true,
      livekitUrl: LIVEKIT_WS_URL,
      roomPrefix: 'badiscord',
      apiBaseUrl: baseUrl,
      demoMode: !isLiveKitConfigured,
      recaptchaEnabled: Boolean(RECAPTCHA_SITE_KEY && RECAPTCHA_SECRET_KEY),
      recaptchaSiteKey: RECAPTCHA_SITE_KEY || null
    });
  }

  const remote = await getRemoteConfig();
  if (remote) {
    return res.json({
      ok: true,
      livekitUrl: remote.livekitUrl || LIVEKIT_WS_URL,
      roomPrefix: 'badiscord',
      apiBaseUrl: baseUrl,
      demoMode: !isLiveKitConfigured,
      recaptchaEnabled: Boolean(RECAPTCHA_SITE_KEY && RECAPTCHA_SECRET_KEY),
      recaptchaSiteKey: RECAPTCHA_SITE_KEY || null
    });
  }

  return res.json({
    ok: true,
    livekitUrl: LIVEKIT_WS_URL,
    roomPrefix: 'badiscord',
    apiBaseUrl: baseUrl,
    demoMode: !isLiveKitConfigured,
    recaptchaEnabled: Boolean(RECAPTCHA_SITE_KEY && RECAPTCHA_SECRET_KEY),
    recaptchaSiteKey: RECAPTCHA_SITE_KEY || null
  });
});

app.post('/api/auth/register', async (req, res) => {
  if (!(await verifyRecaptcha(req.body?.recaptchaToken, req))) return res.status(400).json({ error: 'Confirme que você não é um robô.' });
  const email = normalizeEmail(req.body?.email);
  const username = normalizeUsername(req.body?.username);
  const displayName = normalize(req.body?.displayName) || username;
  const password = String(req.body?.password || '');

  if (!EMAIL_POLICY.test(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
  if (!USERNAME_POLICY.test(username)) return res.status(400).json({ error: 'O usuário deve ter de 3 a 24 caracteres: letras, números ou _.' });
  if (!PASSWORD_POLICY.test(password)) return res.status(400).json({ error: 'A senha precisa ter pelo menos 8 caracteres, uma letra, um número e um símbolo.' });
  if (displayName.length > 28) return res.status(400).json({ error: 'O nome de exibição deve ter no máximo 28 caracteres.' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
  if (existing) return res.status(409).json({ error: 'E-mail ou nome de usuário já cadastrado.' });

  const user = {
    id: `acc-${crypto.randomUUID()}`,
    email,
    username,
    displayName: displayName.slice(0, 28),
    tag: String(Math.floor(1000 + Math.random() * 9000)),
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString()
  };

  db.prepare(`INSERT INTO users (id, email, username, display_name, tag, password_hash, created_at)
    VALUES (@id, @email, @username, @displayName, @tag, @passwordHash, @createdAt)`).run(user);
  createSession(res, user.id);
  return res.status(201).json({ user: publicUser({ ...user, display_name: user.displayName, created_at: user.createdAt }) });
});

app.post('/api/auth/login', async (req, res) => {
  if (!(await verifyRecaptcha(req.body?.recaptchaToken, req))) return res.status(400).json({ error: 'Confirme que você não é um robô.' });
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (!EMAIL_POLICY.test(email) || !user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  }

  createSession(res, user.id);
  return res.json({ user: publicUser(user) });
});

app.get('/api/auth/me', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Sessão não encontrada.' });
  return res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req).badiscord_session;
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashSessionToken(token));
  clearSessionCookie(res);
  return res.json({ ok: true });
});

app.post('/api/auth/recovery/request', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!EMAIL_POLICY.test(email) || !user) return res.status(404).json({ error: 'Conta não encontrada.' });

  const code = String(crypto.randomInt(100000, 1000000));
  const recoveryId = crypto.randomUUID();
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(user.id);
  db.prepare('INSERT INTO recovery_codes (id, user_id, code_hash, expires_at) VALUES (?, ?, ?, ?)')
    .run(recoveryId, user.id, hashSessionToken(code), Date.now() + 10 * 60 * 1000);

  return res.json({ recoveryId, demoCode: process.env.NODE_ENV === 'production' ? undefined : code });
});

app.post('/api/auth/recovery/reset', async (req, res) => {
  const recoveryId = normalize(req.body?.recoveryId);
  const code = normalize(req.body?.code);
  const newPassword = String(req.body?.newPassword || '');
  const recovery = db.prepare(`SELECT recovery_codes.*, users.* FROM recovery_codes
    JOIN users ON users.id = recovery_codes.user_id
    WHERE recovery_codes.id = ? AND recovery_codes.used_at IS NULL AND recovery_codes.expires_at > ?`).get(recoveryId, Date.now());

  if (!recovery || hashSessionToken(code) !== recovery.code_hash) return res.status(400).json({ error: 'Código de recuperação inválido ou expirado.' });
  if (!PASSWORD_POLICY.test(newPassword)) return res.status(400).json({ error: 'A nova senha precisa ter pelo menos 8 caracteres, uma letra, um número e um símbolo.' });

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(newPassword), recovery.user_id);
  db.prepare('UPDATE recovery_codes SET used_at = ? WHERE id = ?').run(Date.now(), recoveryId);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(recovery.user_id);
  createSession(res, recovery.user_id);
  return res.json({ user: publicUser(recovery) });
});

function formatFriend(user, status) {
  return {
    id: user.id,
    name: user.display_name,
    username: user.username,
    tag: user.tag,
    fullTag: `${user.username}#${user.tag}`,
    status: 'online',
    detail: 'Disponível',
    relationshipStatus: status
  };
}

app.get('/api/friends', requireAuth, (req, res) => {
  const friends = db.prepare(`SELECT users.* FROM friendships
    JOIN users ON users.id = CASE WHEN friendships.user_a = ? THEN friendships.user_b ELSE friendships.user_a END
    WHERE friendships.user_a = ? OR friendships.user_b = ?`).all(req.user.id, req.user.id, req.user.id)
    .map((user) => formatFriend(user, 'accepted'));
  const requests = db.prepare(`SELECT friend_requests.id AS request_id, friend_requests.created_at, users.* FROM friend_requests
    JOIN users ON users.id = friend_requests.sender_id
    WHERE friend_requests.receiver_id = ? AND friend_requests.status = 'pending'
    ORDER BY friend_requests.created_at DESC`).all(req.user.id)
    .map((user) => ({ ...formatFriend(user, 'pending'), requestId: user.request_id }));
  return res.json({ friends, requests });
});

app.post('/api/friends/requests', requireAuth, (req, res) => {
  const raw = normalize(req.body?.handle).toLowerCase();
  const [username, tag] = raw.split('#');
  const target = tag
    ? db.prepare('SELECT * FROM users WHERE username = ? AND tag = ?').get(username, tag)
    : db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Você não pode adicionar a si mesmo.' });

  const existingFriendship = db.prepare(`SELECT 1 FROM friendships WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)`)
    .get(req.user.id, target.id, target.id, req.user.id);
  if (existingFriendship) return res.status(409).json({ error: 'Vocês já são amigos.' });
  const existingRequest = db.prepare(`SELECT 1 FROM friend_requests WHERE status = 'pending' AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))`)
    .get(req.user.id, target.id, target.id, req.user.id);
  if (existingRequest) return res.status(409).json({ error: 'Já existe uma solicitação pendente.' });

  const requestId = crypto.randomUUID();
  db.prepare('INSERT INTO friend_requests (id, sender_id, receiver_id, created_at) VALUES (?, ?, ?, ?)')
    .run(requestId, req.user.id, target.id, new Date().toISOString());
  return res.status(201).json({ requestId, user: formatFriend(target, 'pending') });
});

app.post('/api/friends/requests/:id/accept', requireAuth, (req, res) => {
  const request = db.prepare("SELECT * FROM friend_requests WHERE id = ? AND receiver_id = ? AND status = 'pending'")
    .get(req.params.id, req.user.id);
  if (!request) return res.status(404).json({ error: 'Solicitação não encontrada.' });
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare("UPDATE friend_requests SET status = 'accepted' WHERE id = ?").run(request.id);
    db.prepare('INSERT OR IGNORE INTO friendships (user_a, user_b, created_at) VALUES (?, ?, ?)').run(request.sender_id, request.receiver_id, now);
  })();
  return res.json({ ok: true });
});

app.delete('/api/friends/requests/:id', requireAuth, (req, res) => {
  const result = db.prepare("DELETE FROM friend_requests WHERE id = ? AND (sender_id = ? OR receiver_id = ?)")
    .run(req.params.id, req.user.id, req.user.id);
  return result.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Solicitação não encontrada.' });
});

app.delete('/api/friends/:id', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM friendships WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)')
    .run(req.user.id, req.params.id, req.params.id, req.user.id);
  return result.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Amizade não encontrada.' });
});

app.get('/api/token', (req, res) => {
  return res.status(405).json({
    error: 'Use POST /api/token com { roomName, participantName } para gerar um token do LiveKit.',
    expectedMethod: 'POST',
    requiredFields: ['roomName', 'participantName']
  });
});

app.post('/api/token', requireAuth, async (req, res) => {
  const { roomName, participantName } = req.body;

  if (!roomName) {
    return res.status(400).json({ error: 'roomName e participantName são obrigatórios' });
  }

  const authenticatedParticipantName = req.user.display_name;

  const usingDemoCredentials = !isLiveKitConfigured ||
    normalize(process.env.LIVEKIT_API_KEY) === 'devkey' ||
    normalize(process.env.LIVEKIT_API_SECRET) === 'secret' ||
    isPlaceholderKey(process.env.LIVEKIT_API_KEY) ||
    isPlaceholderSecret(process.env.LIVEKIT_API_SECRET) ||
    hasPlaceholderLiveKitUrl(process.env.LIVEKIT_WS_URL || process.env.LIVEKIT_URL || '');

  if (usingDemoCredentials) {
    try {
      const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: req.user.id,
        name: authenticatedParticipantName,
        ttl: '24h'
      });

      at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true
      });

      const token = await at.toJwt();
      return res.json({ token, livekitUrl: LIVEKIT_WS_URL, demoMode: true });
    } catch (err) {
      console.error('Erro ao gerar token em modo demo:', err);
      return res.status(503).json({
        error: 'Modo demo do LiveKit ativo. Configure LIVEKIT_API_KEY, LIVEKIT_API_SECRET e LIVEKIT_WS_URL para usar uma sala real.'
      });
    }
  }

  try {
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: req.user.id,
      name: authenticatedParticipantName,
      ttl: '24h'
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    });

    const token = await at.toJwt();
    res.json({ token, livekitUrl: LIVEKIT_WS_URL });
  } catch (err) {
    console.error('Erro ao gerar token:', err);
    res.status(500).json({ error: 'Erro ao gerar token' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`🚀 Servidor de Sinalização PC rodando em http://localhost:${PORT}`);
});
