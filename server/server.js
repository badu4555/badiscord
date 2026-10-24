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
const MAX_CUSTOM_SOUND_BYTES = 4 * 1024 * 1024;
const MAX_CUSTOM_SOUND_COUNT = 20;
const MAX_CUSTOM_SOUND_STORAGE_BYTES = 20 * 1024 * 1024;
const SERVER_ID_POLICY = /^[a-zA-Z0-9_-]{1,80}$/;
const ALLOWED_SOUND_TYPES = new Set([
  'audio/aac', 'audio/flac', 'audio/mp3', 'audio/mp4', 'audio/mpeg',
  'audio/ogg', 'audio/wav', 'audio/webm', 'audio/wave', 'audio/x-m4a',
  'audio/x-wav', 'audio/vnd.wave'
]);
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
app.use(express.json({ limit: '6mb' }));
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
const PUBLIC_APP_URL = normalize(process.env.PUBLIC_APP_URL).replace(/\/+$/, '');
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
  CREATE TABLE IF NOT EXISTS user_presence (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('online', 'idle', 'dnd', 'invisible')),
    detail TEXT NOT NULL DEFAULT '',
    game TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
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
  CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '🎮',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    text_channels_json TEXT NOT NULL DEFAULT '[]',
    voice_channels_json TEXT NOT NULL DEFAULT '[]',
    owner_id TEXT REFERENCES users(id),
    is_public INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS server_members (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TEXT NOT NULL,
    PRIMARY KEY (server_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS server_invites (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_id TEXT NOT NULL,
    server_name TEXT NOT NULL,
    invite_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS server_invite_links (
    token TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS channel_messages (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    channel_name TEXT NOT NULL,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_name TEXT NOT NULL,
    content_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS dm_messages (
    id TEXT PRIMARY KEY,
    user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_name TEXT NOT NULL,
    content_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS custom_sounds (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL DEFAULT 'legacy',
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    audio_data BLOB NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS friend_requests_receiver_idx ON friend_requests(receiver_id, status);
  CREATE INDEX IF NOT EXISTS friend_requests_sender_idx ON friend_requests(sender_id, status);
  CREATE INDEX IF NOT EXISTS server_members_user_id_idx ON server_members(user_id);
  CREATE INDEX IF NOT EXISTS channel_messages_channel_created_idx ON channel_messages(server_id, channel_name, created_at);
  CREATE INDEX IF NOT EXISTS channel_messages_updated_at_idx ON channel_messages(updated_at);
  CREATE INDEX IF NOT EXISTS dm_messages_conversation_created_idx ON dm_messages(user_a, user_b, created_at);
  CREATE INDEX IF NOT EXISTS dm_messages_updated_at_idx ON dm_messages(updated_at);
`);

const serverColumns = new Set(db.pragma('table_info(servers)').map((column) => column.name));
[
  ['metadata_json', "TEXT NOT NULL DEFAULT '{}'"],
  ['text_channels_json', "TEXT NOT NULL DEFAULT '[]'"],
  ['voice_channels_json', "TEXT NOT NULL DEFAULT '[]'"]
].forEach(([column, definition]) => {
  if (!serverColumns.has(column)) db.exec(`ALTER TABLE servers ADD COLUMN ${column} ${definition}`);
});

const customSoundColumns = db.pragma('table_info(custom_sounds)');
if (!customSoundColumns.some((column) => column.name === 'server_id')) {
  db.exec("ALTER TABLE custom_sounds ADD COLUMN server_id TEXT NOT NULL DEFAULT 'srv-1'");
}
db.exec('CREATE INDEX IF NOT EXISTS custom_sounds_server_id_idx ON custom_sounds(server_id, created_at)');

const sharedServerSeeds = [
  ['pub-1', 'Comunidade BADISCORD 🎮', '🎮'],
  ['pub-2', 'Espaço dos Devs 💻', '💻'],
  ['pub-3', 'Lounge de Músicas & Clipes 🎵', '🎧'],
  ['pub-4', 'Competitivo & Scrims 🏆', '🏆']
];
const seedSharedServer = db.prepare(`INSERT OR IGNORE INTO servers (id, name, icon, is_public, created_at)
  VALUES (?, ?, ?, 1, ?)`);
sharedServerSeeds.forEach(([id, name, icon]) => seedSharedServer.run(id, name, icon, new Date().toISOString()));

db.transaction(() => {
  for (const serverId of ['srv-1', 'srv-2']) {
    db.prepare('DELETE FROM custom_sounds WHERE server_id = ?').run(serverId);
    db.prepare('DELETE FROM server_invites WHERE server_id = ?').run(serverId);
    db.prepare('DELETE FROM server_members WHERE server_id = ?').run(serverId);
    db.prepare('DELETE FROM servers WHERE id = ?').run(serverId);
  }
})();

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
      recaptchaSiteKey: RECAPTCHA_SITE_KEY || null,
      recaptchaRequired: process.env.NODE_ENV === 'production'
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
      recaptchaSiteKey: RECAPTCHA_SITE_KEY || null,
      recaptchaRequired: process.env.NODE_ENV === 'production'
    });
  }

  return res.json({
    ok: true,
    livekitUrl: LIVEKIT_WS_URL,
    roomPrefix: 'badiscord',
    apiBaseUrl: baseUrl,
    demoMode: !isLiveKitConfigured,
    recaptchaEnabled: Boolean(RECAPTCHA_SITE_KEY && RECAPTCHA_SECRET_KEY),
    recaptchaSiteKey: RECAPTCHA_SITE_KEY || null,
    recaptchaRequired: process.env.NODE_ENV === 'production'
  });
});

app.post('/api/auth/register', async (req, res) => {
  if (!RECAPTCHA_SECRET_KEY && process.env.NODE_ENV === 'production') return res.status(503).json({ error: 'O reCAPTCHA ainda não foi configurado no servidor.' });
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

  const homeServerId = `home-${user.id}`;
  db.transaction(() => {
    db.prepare(`INSERT INTO users (id, email, username, display_name, tag, password_hash, created_at)
      VALUES (@id, @email, @username, @displayName, @tag, @passwordHash, @createdAt)`).run(user);
    db.prepare(`INSERT INTO servers (id, name, icon, owner_id, is_public, created_at)
      VALUES (?, ?, '🎮', ?, 0, ?)`).run(homeServerId, user.displayName, user.id, user.createdAt);
    db.prepare(`INSERT INTO server_members (server_id, user_id, role, joined_at)
      VALUES (?, ?, 'owner', ?)`).run(homeServerId, user.id, user.createdAt);
  })();
  createSession(res, user.id);
  return res.status(201).json({
    user: publicUser({ ...user, display_name: user.displayName, created_at: user.createdAt }),
    homeServerId
  });
});

app.post('/api/auth/login', async (req, res) => {
  if (!RECAPTCHA_SECRET_KEY && process.env.NODE_ENV === 'production') return res.status(503).json({ error: 'O reCAPTCHA ainda não foi configurado no servidor.' });
  if (!(await verifyRecaptcha(req.body?.recaptchaToken, req))) return res.status(400).json({ error: 'Confirme que você não é um robô.' });

  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');

  if (!EMAIL_POLICY.test(email)) {
    return res.status(401).json({ error: 'E-mail inválido.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    return res.status(401).json({ error: 'Conta não cadastrada.' });
  }

  if (!(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'Senha incorreta.' });
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
  if (token) {
    const tokenHash = hashSessionToken(token);
    const session = db.prepare('SELECT user_id FROM sessions WHERE token_hash = ?').get(tokenHash);
    if (session) {
      db.prepare(`INSERT INTO user_presence (user_id, status, detail, game, updated_at)
        VALUES (?, 'invisible', '', '', ?)
        ON CONFLICT(user_id) DO UPDATE SET status = 'invisible', detail = '', game = '', updated_at = excluded.updated_at`)
        .run(session.user_id, Date.now());
    }
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }
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

const PRESENCE_STALE_AFTER_MS = 45_000;

function formatFriend(user, relationshipStatus) {
  const presence = db.prepare(`SELECT status, detail, game, updated_at
    FROM user_presence WHERE user_id = ?`).get(user.id);
  const isStale = !presence || Date.now() - presence.updated_at > PRESENCE_STALE_AFTER_MS;
  const visibleStatus = isStale || presence.status === 'invisible' ? 'offline' : presence.status;
  return {
    id: user.id,
    name: user.display_name,
    username: user.username,
    tag: user.tag,
    fullTag: `${user.username}#${user.tag}`,
    status: visibleStatus,
    detail: visibleStatus === 'offline' ? 'Offline' : (presence.detail || 'Disponível'),
    game: visibleStatus === 'offline' ? '' : presence.game,
    relationshipStatus
  };
}

function canAccessServer(userId, serverId) {
  return Boolean(db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId));
}

function canMessageFriendship(userId, friendId) {
  return Boolean(db.prepare(`SELECT 1 FROM friendships
    WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)`)
    .get(userId, friendId, friendId, userId));
}

function getDmParticipants(userId, friendId) {
  const friend = db.prepare('SELECT id FROM users WHERE id = ?').get(friendId);
  if (!friend || friend.id === userId || !canMessageFriendship(userId, friend.id)) return null;
  return [userId, friend.id].sort();
}

function getAuthorizedTextChannel(req, res) {
  const serverId = normalize(req.params.serverId);
  const channelName = normalize(req.params.channelName).slice(0, 80);
  if (!serverId || !channelName || !canAccessServer(req.user.id, serverId)) {
    res.status(403).json({ error: 'Você não tem acesso a este servidor.' });
    return null;
  }
  const server = db.prepare('SELECT text_channels_json FROM servers WHERE id = ?').get(serverId);
  const textChannels = parseJsonValue(server?.text_channels_json, []);
  if (!Array.isArray(textChannels) || !textChannels.includes(channelName)) {
    res.status(404).json({ error: 'Canal de texto não encontrado.' });
    return null;
  }
  return { serverId, channelName };
}

function formatChannelMessage(row) {
  return {
    ...parseJsonValue(row.content_json, {}),
    id: row.id,
    author: row.author_name,
    authorId: row.author_id,
    time: `Hoje às ${new Date(row.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
    updatedAt: row.updated_at
  };
}

function normalizeChatMessageInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Mensagem inválida.' };
  }
  const text = typeof input.text === 'string' ? input.text.trim().slice(0, 4000) : '';
  if (input.attachments != null && !Array.isArray(input.attachments)) {
    return { error: 'Anexos inválidos.' };
  }
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  if (attachments.length > 5) return { error: 'Envie no máximo cinco anexos por mensagem.' };
  let attachmentBytes = 0;
  for (const attachment of attachments) {
    if (!attachment || typeof attachment.name !== 'string' || attachment.name.length > 255 ||
      typeof attachment.data !== 'string' ||
      !/^data:[^;,]+;base64,[a-z0-9+/]+=*$/i.test(attachment.data) || attachment.data.length > 1400000) {
      return { error: 'Um dos anexos é inválido ou excede o limite de tamanho.' };
    }
    attachmentBytes += attachment.data.length;
  }
  if (attachmentBytes > 1400000) return { error: 'O tamanho total dos anexos por mensagem não pode exceder 1 MB.' };

  let poll;
  if (input.poll && typeof input.poll === 'object') {
    const question = normalize(input.poll.question).slice(0, 200);
    const options = Array.isArray(input.poll.options)
      ? [...new Set(input.poll.options.map(normalize).filter(Boolean))].slice(0, 6)
      : [];
    if (!question || options.length < 2) return { error: 'A enquete precisa de uma pergunta e pelo menos duas opções.' };
    poll = { question, options, votes: {} };
  }

  let topic;
  if (input.topic && typeof input.topic === 'object') {
    const title = normalize(input.topic.title).slice(0, 120);
    if (!title) return { error: 'O tópico precisa de um título.' };
    topic = {
      title,
      description: normalize(input.topic.description).slice(0, 1000),
      replies: []
    };
  }

  if (!text && attachments.length === 0 && !poll && !topic) {
    return { error: 'A mensagem não pode estar vazia.' };
  }

  return {
    content: {
      text,
      avatar: normalize(input.avatar).slice(0, 500000),
      attachments,
      ...(poll ? { poll } : {}),
      ...(topic ? { topic } : {})
    }
  };
}

function nextChannelMessageTimestamp() {
  const latest = db.prepare('SELECT updated_at FROM channel_messages ORDER BY updated_at DESC LIMIT 1').get();
  const latestTime = latest ? Date.parse(latest.updated_at) : 0;
  return new Date(Math.max(Date.now(), (Number.isFinite(latestTime) ? latestTime : 0) + 1)).toISOString();
}

function fitMessageResponse(rows, newestFirst = false) {
  const messages = [];
  let responseBytes = 0;
  for (const row of rows) {
    const message = formatChannelMessage(row);
    const messageBytes = Buffer.byteLength(JSON.stringify(message));
    if (messages.length > 0 && responseBytes + messageBytes > 4 * 1024 * 1024) break;
    messages.push(message);
    responseBytes += messageBytes;
  }
  if (newestFirst) messages.reverse();
  return messages;
}

function liveKitRoomSlug(value, maxLength) {
  return normalize(value).toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, maxLength) || 'geral';
}

function parseJsonValue(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
}

function formatServer(server, userId) {
  const metadata = parseJsonValue(server.metadata_json, {});
  return {
    id: server.id,
    name: server.name,
    icon: server.icon,
    iconUrl: metadata.iconUrl || '',
    bannerColor: metadata.bannerColor || '#eab308',
    description: metadata.description || '',
    traits: Array.isArray(metadata.traits) ? metadata.traits : [],
    serverTag: metadata.serverTag || 'KBM!',
    serverTagBadge: metadata.serverTagBadge || '🗡️',
    serverTagColor: metadata.serverTagColor || '#eb459e',
    voiceSettings: metadata.voiceSettings && typeof metadata.voiceSettings === 'object' ? metadata.voiceSettings : {},
    textChannels: parseJsonValue(server.text_channels_json, ['geral']),
    voiceChannels: parseJsonValue(server.voice_channels_json, ['Geral 🔊']),
    isPublic: Boolean(server.is_public),
    isOwner: server.owner_id === userId,
    role: server.role || 'member'
  };
}

function listAccessibleServers(userId) {
  return db.prepare(`SELECT servers.*, server_members.role
    FROM servers JOIN server_members ON server_members.server_id = servers.id
    WHERE server_members.user_id = ? ORDER BY servers.name COLLATE NOCASE`).all(userId)
    .map((server) => formatServer(server, userId));
}

function listPublicServers() {
  return db.prepare('SELECT * FROM servers WHERE is_public = 1 ORDER BY name COLLATE NOCASE').all()
    .map((server) => formatServer(server, ''));
}

function ensurePersonalServer(user) {
  const serverId = `home-${user.id}`;
  const createdAt = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO servers
      (id, name, icon, text_channels_json, voice_channels_json, owner_id, is_public, created_at)
      VALUES (?, ?, '🎮', '["geral"]', '["Geral 🔊"]', ?, 0, ?)`)
      .run(serverId, user.display_name, user.id, createdAt);
    db.prepare(`UPDATE servers SET
      text_channels_json = CASE WHEN text_channels_json = '[]' THEN '["geral"]' ELSE text_channels_json END,
      voice_channels_json = CASE WHEN voice_channels_json = '[]' THEN '["Geral 🔊"]' ELSE voice_channels_json END
      WHERE id = ?`).run(serverId);
    db.prepare(`INSERT OR IGNORE INTO server_members (server_id, user_id, role, joined_at)
      VALUES (?, ?, 'owner', ?)`).run(serverId, user.id, createdAt);
  })();
  return serverId;
}

app.get('/api/servers', requireAuth, (req, res) => {
  return res.json({ servers: listAccessibleServers(req.user.id) });
});

app.get('/api/servers/:serverId/channels/:channelName/messages', requireAuth, (req, res) => {
  const channel = getAuthorizedTextChannel(req, res);
  if (!channel) return;
  const since = normalize(req.query.since);
  if (since && (since.length > 40 || !Number.isFinite(Date.parse(since)))) {
    return res.status(400).json({ error: 'Cursor de mensagens inválido.' });
  }
  const messages = since
    ? db.prepare(`SELECT * FROM channel_messages
      WHERE server_id = ? AND channel_name = ? AND updated_at > ?
      ORDER BY updated_at ASC LIMIT 100`).iterate(channel.serverId, channel.channelName, since)
    : db.prepare(`SELECT * FROM (
      SELECT * FROM channel_messages
      WHERE server_id = ? AND channel_name = ?
      ORDER BY created_at DESC
      LIMIT 100
    ) ORDER BY created_at DESC`).iterate(channel.serverId, channel.channelName);
  return res.json({ messages: fitMessageResponse(messages, !since), full: !since });
});

app.get('/api/dms/:friendId/messages', requireAuth, (req, res) => {
  const participants = getDmParticipants(req.user.id, normalize(req.params.friendId));
  if (!participants) return res.status(403).json({ error: 'Somente amigos podem trocar mensagens diretas.' });
  const since = normalize(req.query.since);
  if (since && (since.length > 40 || !Number.isFinite(Date.parse(since)))) {
    return res.status(400).json({ error: 'Cursor de mensagens inválido.' });
  }
  const messages = since
    ? db.prepare(`SELECT * FROM dm_messages
      WHERE user_a = ? AND user_b = ? AND updated_at > ?
      ORDER BY updated_at ASC LIMIT 100`).iterate(participants[0], participants[1], since)
    : db.prepare(`SELECT * FROM (
      SELECT * FROM dm_messages WHERE user_a = ? AND user_b = ?
      ORDER BY created_at DESC LIMIT 100
    ) ORDER BY created_at DESC`).iterate(participants[0], participants[1]);
  return res.json({ messages: fitMessageResponse(messages, !since), full: !since });
});

app.post('/api/dms/:friendId/messages', requireAuth, (req, res) => {
  const participants = getDmParticipants(req.user.id, normalize(req.params.friendId));
  if (!participants) return res.status(403).json({ error: 'Somente amigos podem trocar mensagens diretas.' });
  const { content, error } = normalizeChatMessageInput(req.body?.message);
  if (error) return res.status(400).json({ error });
  const id = crypto.randomUUID();
  const createdAt = nextChannelMessageTimestamp();
  db.prepare(`INSERT INTO dm_messages
    (id, user_a, user_b, author_id, author_name, content_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, participants[0], participants[1], req.user.id, req.user.display_name, JSON.stringify(content), createdAt, createdAt);
  const message = db.prepare('SELECT * FROM dm_messages WHERE id = ?').get(id);
  return res.status(201).json({ message: formatChannelMessage(message) });
});

app.post('/api/dms/:friendId/messages/:messageId/votes', requireAuth, (req, res) => {
  const participants = getDmParticipants(req.user.id, normalize(req.params.friendId));
  if (!participants) return res.status(403).json({ error: 'Somente amigos podem trocar mensagens diretas.' });
  const row = db.prepare(`SELECT * FROM dm_messages WHERE id = ? AND user_a = ? AND user_b = ?`)
    .get(req.params.messageId, participants[0], participants[1]);
  if (!row) return res.status(404).json({ error: 'Enquete não encontrada.' });
  const content = parseJsonValue(row.content_json, {});
  if (!content.poll || !Array.isArray(content.poll.options)) return res.status(400).json({ error: 'Esta mensagem não contém uma enquete.' });
  const optionIndex = Number(req.body?.optionIndex);
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= content.poll.options.length) {
    return res.status(400).json({ error: 'Opção de voto inválida.' });
  }
  content.poll.votes = { ...(content.poll.votes || {}), [req.user.id]: optionIndex };
  db.prepare('UPDATE dm_messages SET content_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(content), nextChannelMessageTimestamp(), row.id);
  const message = db.prepare('SELECT * FROM dm_messages WHERE id = ?').get(row.id);
  return res.json({ message: formatChannelMessage(message) });
});

app.post('/api/dms/:friendId/messages/:messageId/replies', requireAuth, (req, res) => {
  const participants = getDmParticipants(req.user.id, normalize(req.params.friendId));
  if (!participants) return res.status(403).json({ error: 'Somente amigos podem trocar mensagens diretas.' });
  const row = db.prepare(`SELECT * FROM dm_messages WHERE id = ? AND user_a = ? AND user_b = ?`)
    .get(req.params.messageId, participants[0], participants[1]);
  if (!row) return res.status(404).json({ error: 'Tópico não encontrado.' });
  const content = parseJsonValue(row.content_json, {});
  if (!content.topic) return res.status(400).json({ error: 'Esta mensagem não contém um tópico.' });
  const text = normalize(req.body?.text).slice(0, 500);
  if (!text) return res.status(400).json({ error: 'A resposta do tópico não pode estar vazia.' });
  content.topic.replies = Array.isArray(content.topic.replies) ? content.topic.replies : [];
  content.topic.replies.push({ author: req.user.display_name, authorId: req.user.id, text, time: Date.now() });
  db.prepare('UPDATE dm_messages SET content_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(content), nextChannelMessageTimestamp(), row.id);
  const message = db.prepare('SELECT * FROM dm_messages WHERE id = ?').get(row.id);
  return res.json({ message: formatChannelMessage(message) });
});

app.post('/api/servers/:serverId/channels/:channelName/messages', requireAuth, (req, res) => {
  const channel = getAuthorizedTextChannel(req, res);
  if (!channel) return;
  const { content, error } = normalizeChatMessageInput(req.body?.message);
  if (error) return res.status(400).json({ error });
  const id = crypto.randomUUID();
  const createdAt = nextChannelMessageTimestamp();
  db.prepare(`INSERT INTO channel_messages
    (id, server_id, channel_name, author_id, author_name, content_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, channel.serverId, channel.channelName, req.user.id, req.user.display_name, JSON.stringify(content), createdAt, createdAt);
  const row = db.prepare('SELECT * FROM channel_messages WHERE id = ?').get(id);
  return res.status(201).json({ message: formatChannelMessage(row) });
});

app.post('/api/servers/:serverId/channels/:channelName/messages/:messageId/votes', requireAuth, (req, res) => {
  const channel = getAuthorizedTextChannel(req, res);
  if (!channel) return;
  const row = db.prepare(`SELECT * FROM channel_messages
    WHERE id = ? AND server_id = ? AND channel_name = ?`).get(req.params.messageId, channel.serverId, channel.channelName);
  if (!row) return res.status(404).json({ error: 'Enquete não encontrada.' });
  const content = parseJsonValue(row.content_json, {});
  if (!content.poll || !Array.isArray(content.poll.options)) return res.status(400).json({ error: 'Esta mensagem não contém uma enquete.' });
  const optionIndex = Number(req.body?.optionIndex);
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= content.poll.options.length) {
    return res.status(400).json({ error: 'Opção de voto inválida.' });
  }
  content.poll.votes = { ...(content.poll.votes || {}), [req.user.id]: optionIndex };
  db.prepare('UPDATE channel_messages SET content_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(content), nextChannelMessageTimestamp(), row.id);
  const updated = db.prepare('SELECT * FROM channel_messages WHERE id = ?').get(row.id);
  return res.json({ message: formatChannelMessage(updated) });
});

app.post('/api/servers/:serverId/channels/:channelName/messages/:messageId/replies', requireAuth, (req, res) => {
  const channel = getAuthorizedTextChannel(req, res);
  if (!channel) return;
  const row = db.prepare(`SELECT * FROM channel_messages
    WHERE id = ? AND server_id = ? AND channel_name = ?`).get(req.params.messageId, channel.serverId, channel.channelName);
  if (!row) return res.status(404).json({ error: 'Tópico não encontrado.' });
  const content = parseJsonValue(row.content_json, {});
  if (!content.topic) return res.status(400).json({ error: 'Esta mensagem não contém um tópico.' });
  const text = normalize(req.body?.text).slice(0, 500);
  if (!text) return res.status(400).json({ error: 'A resposta do tópico não pode estar vazia.' });
  content.topic.replies = Array.isArray(content.topic.replies) ? content.topic.replies : [];
  content.topic.replies.push({
    author: req.user.display_name,
    authorId: req.user.id,
    text,
    time: Date.now()
  });
  db.prepare('UPDATE channel_messages SET content_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(content), nextChannelMessageTimestamp(), row.id);
  const updated = db.prepare('SELECT * FROM channel_messages WHERE id = ?').get(row.id);
  return res.json({ message: formatChannelMessage(updated) });
});

app.get('/api/servers/public', (req, res) => {
  return res.json({ servers: listPublicServers() });
});

app.post('/api/servers', requireAuth, (req, res) => {
  const name = normalize(req.body?.name).slice(0, 32);
  const icon = normalize(req.body?.icon).slice(0, 16) || '🎮';
  if (!name) return res.status(400).json({ error: 'Informe o nome do servidor.' });

  const id = `srv-${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const textChannels = ['geral', 'clipes', 'comandos'];
  const voiceChannels = ['Lounge 🔊', 'Call do Jogo'];
  db.transaction(() => {
    db.prepare(`INSERT INTO servers (id, name, icon, text_channels_json, voice_channels_json, owner_id, is_public, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)`).run(id, name, icon, JSON.stringify(textChannels), JSON.stringify(voiceChannels), req.user.id, createdAt);
    db.prepare(`INSERT INTO server_members (server_id, user_id, role, joined_at)
      VALUES (?, ?, 'owner', ?)`).run(id, req.user.id, createdAt);
  })();
  const server = db.prepare('SELECT servers.*, server_members.role FROM servers JOIN server_members ON server_members.server_id = servers.id WHERE servers.id = ? AND server_members.user_id = ?')
    .get(id, req.user.id);
  return res.status(201).json({ server: formatServer(server, req.user.id) });
});

app.patch('/api/servers/:id', requireAuth, (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id);
  if (!server) return res.status(404).json({ error: 'Servidor não encontrado ou você não é o proprietário.' });
  const name = normalize(req.body?.name).slice(0, 32);
  const icon = normalize(req.body?.icon).slice(0, 16) || '🎮';
  const iconUrl = typeof req.body?.iconUrl === 'string' ? req.body.iconUrl.slice(0, 5 * 1024 * 1024) : '';
  const bannerColor = /^#[0-9a-f]{6}$/i.test(req.body?.bannerColor) ? req.body.bannerColor : '#eab308';
  const description = normalize(req.body?.description).slice(0, 1000);
  const traits = Array.isArray(req.body?.traits) ? req.body.traits.slice(0, 5).map((trait) => normalize(trait).slice(0, 40)) : [];
  const serverTag = normalize(req.body?.serverTag).toUpperCase().slice(0, 16) || 'KBM!';
  const serverTagBadge = normalize(req.body?.serverTagBadge).slice(0, 8) || '🗡️';
  const serverTagColor = /^#[0-9a-f]{6}$/i.test(req.body?.serverTagColor) ? req.body.serverTagColor : '#eb459e';
  const currentMetadata = parseJsonValue(server.metadata_json, {});
  const rawVoiceSettings = req.body?.voiceSettings && typeof req.body.voiceSettings === 'object' && !Array.isArray(req.body.voiceSettings)
    ? req.body.voiceSettings
    : currentMetadata.voiceSettings || {};
  const voiceSettings = Object.fromEntries(Object.entries(rawVoiceSettings).slice(0, 100).map(([channel, settings]) => [
    normalize(channel).slice(0, 80),
    { bitrate: [64, 96, 128, 256].includes(Number(settings?.bitrate)) ? Number(settings.bitrate) : 96 }
  ]));
  const textChannels = Array.isArray(req.body?.textChannels) ? req.body.textChannels.slice(0, 100).map((channel) => normalize(channel).slice(0, 80)).filter(Boolean) : ['geral'];
  const voiceChannels = Array.isArray(req.body?.voiceChannels) ? req.body.voiceChannels.slice(0, 100).map((channel) => normalize(channel).slice(0, 80)).filter(Boolean) : ['Geral 🔊'];
  if (!name) return res.status(400).json({ error: 'Informe o nome do servidor.' });

  const isPublic = typeof req.body?.isPublic === 'boolean' ? Number(req.body.isPublic) : server.is_public;
  const metadata = JSON.stringify({ iconUrl, bannerColor, description, traits, serverTag, serverTagBadge, serverTagColor, voiceSettings });
  db.prepare(`UPDATE servers SET name = ?, icon = ?, metadata_json = ?, text_channels_json = ?,
    voice_channels_json = ?, is_public = ? WHERE id = ?`)
    .run(name, icon, metadata, JSON.stringify(textChannels), JSON.stringify(voiceChannels), isPublic, server.id);
  const updated = db.prepare('SELECT servers.*, server_members.role FROM servers JOIN server_members ON server_members.server_id = servers.id WHERE servers.id = ? AND server_members.user_id = ?')
    .get(server.id, req.user.id);
  return res.json({ server: formatServer(updated, req.user.id) });
});

app.delete('/api/servers/:id', requireAuth, (req, res) => {
  const server = db.prepare('SELECT id, owner_id FROM servers WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id);
  if (!server) return res.status(404).json({ error: 'Servidor não encontrado ou você não é o proprietário.' });
  if (server.id === `home-${req.user.id}`) return res.status(400).json({ error: 'O servidor pessoal da conta não pode ser excluído.' });

  db.transaction(() => {
    db.prepare('DELETE FROM custom_sounds WHERE server_id = ?').run(server.id);
    db.prepare('DELETE FROM server_invites WHERE server_id = ?').run(server.id);
    db.prepare('DELETE FROM server_members WHERE server_id = ?').run(server.id);
    db.prepare('DELETE FROM servers WHERE id = ?').run(server.id);
  })();
  return res.json({ ok: true });
});

app.post('/api/servers/sync', requireAuth, (req, res) => {
  const homeServerId = ensurePersonalServer(req.user);
  const clientServers = Array.isArray(req.body?.servers) ? req.body.servers.slice(0, 100) : [];
  const now = new Date().toISOString();
  const syncServer = db.transaction((server) => {
    const id = normalize(server?.id);
    const name = normalize(server?.name).slice(0, 32);
    const icon = normalize(server?.icon).slice(0, 16) || '🎮';
    if (!SERVER_ID_POLICY.test(id) || !name || id === 'srv-1' || id === 'srv-2') return;

    const existing = db.prepare('SELECT id, owner_id, is_public FROM servers WHERE id = ?').get(id);
    if (!existing) {
      const metadata = JSON.stringify({
        iconUrl: typeof server.iconUrl === 'string' ? server.iconUrl.slice(0, 5 * 1024 * 1024) : '',
        bannerColor: /^#[0-9a-f]{6}$/i.test(server.bannerColor) ? server.bannerColor : '#eab308',
        description: normalize(server.description).slice(0, 1000),
        traits: Array.isArray(server.traits) ? server.traits.slice(0, 5).map((trait) => normalize(trait).slice(0, 40)) : [],
        serverTag: normalize(server.serverTag).toUpperCase().slice(0, 16) || 'KBM!',
        serverTagBadge: normalize(server.serverTagBadge).slice(0, 8) || '🗡️',
        serverTagColor: /^#[0-9a-f]{6}$/i.test(server.serverTagColor) ? server.serverTagColor : '#eb459e',
        voiceSettings: server.voiceSettings && typeof server.voiceSettings === 'object' && !Array.isArray(server.voiceSettings)
          ? Object.fromEntries(Object.entries(server.voiceSettings).slice(0, 100).map(([channel, settings]) => [
            normalize(channel).slice(0, 80),
            { bitrate: [64, 96, 128, 256].includes(Number(settings?.bitrate)) ? Number(settings.bitrate) : 96 }
          ]))
          : {}
      });
      const textChannels = Array.isArray(server.textChannels) ? server.textChannels.slice(0, 100).map((channel) => normalize(channel).slice(0, 80)).filter(Boolean) : ['geral'];
      const voiceChannels = Array.isArray(server.voiceChannels) ? server.voiceChannels.slice(0, 100).map((channel) => normalize(channel).slice(0, 80)).filter(Boolean) : ['Geral 🔊'];
      db.prepare(`INSERT INTO servers (id, name, icon, metadata_json, text_channels_json, voice_channels_json, owner_id, is_public, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`)
        .run(id, name, icon, metadata, JSON.stringify(textChannels), JSON.stringify(voiceChannels), req.user.id, now);
      db.prepare('INSERT INTO server_members (server_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
        .run(id, req.user.id, 'owner', now);
      return;
    }

    if (existing.owner_id === req.user.id) {
      const metadata = JSON.stringify({
        iconUrl: typeof server.iconUrl === 'string' ? server.iconUrl.slice(0, 5 * 1024 * 1024) : '',
        bannerColor: /^#[0-9a-f]{6}$/i.test(server.bannerColor) ? server.bannerColor : '#eab308',
        description: normalize(server.description).slice(0, 1000),
        traits: Array.isArray(server.traits) ? server.traits.slice(0, 5).map((trait) => normalize(trait).slice(0, 40)) : [],
        serverTag: normalize(server.serverTag).toUpperCase().slice(0, 16) || 'KBM!',
        serverTagBadge: normalize(server.serverTagBadge).slice(0, 8) || '🗡️',
        serverTagColor: /^#[0-9a-f]{6}$/i.test(server.serverTagColor) ? server.serverTagColor : '#eb459e',
        voiceSettings: server.voiceSettings && typeof server.voiceSettings === 'object' && !Array.isArray(server.voiceSettings)
          ? Object.fromEntries(Object.entries(server.voiceSettings).slice(0, 100).map(([channel, settings]) => [
            normalize(channel).slice(0, 80),
            { bitrate: [64, 96, 128, 256].includes(Number(settings?.bitrate)) ? Number(settings.bitrate) : 96 }
          ]))
          : {}
      });
      const textChannels = Array.isArray(server.textChannels) ? server.textChannels.slice(0, 100).map((channel) => normalize(channel).slice(0, 80)).filter(Boolean) : ['geral'];
      const voiceChannels = Array.isArray(server.voiceChannels) ? server.voiceChannels.slice(0, 100).map((channel) => normalize(channel).slice(0, 80)).filter(Boolean) : ['Geral 🔊'];
      db.prepare(`UPDATE servers SET name = ?, icon = ?, metadata_json = ?, text_channels_json = ?, voice_channels_json = ? WHERE id = ?`)
        .run(name, icon, metadata, JSON.stringify(textChannels), JSON.stringify(voiceChannels), id);
    } else if (existing.is_public) {
      db.prepare('INSERT OR IGNORE INTO server_members (server_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
        .run(id, req.user.id, 'member', now);
    }
  });
  clientServers.forEach(syncServer);
  return res.json({ homeServerId, servers: listAccessibleServers(req.user.id) });
});

app.get('/api/soundboard', requireAuth, (req, res) => {
  const serverId = normalize(req.query.serverId);
  if (!SERVER_ID_POLICY.test(serverId)) return res.status(400).json({ error: 'Servidor inválido.' });
  if (!canAccessServer(req.user.id, serverId)) return res.status(403).json({ error: 'Você não faz parte deste servidor.' });
  const sounds = db.prepare(`SELECT custom_sounds.id, custom_sounds.server_id AS serverId, custom_sounds.name,
    custom_sounds.mime_type AS mimeType, custom_sounds.created_at AS createdAt,
    length(custom_sounds.audio_data) AS size, users.username AS ownerUsername,
    custom_sounds.user_id = ? AS isOwner
    FROM custom_sounds JOIN users ON users.id = custom_sounds.user_id
    WHERE custom_sounds.server_id = ? ORDER BY custom_sounds.created_at DESC`)
    .all(req.user.id, serverId);
  return res.json({ sounds });
});

app.post('/api/soundboard', requireAuth, (req, res) => {
  const serverId = normalize(req.body?.serverId);
  const name = normalize(req.body?.name).slice(0, 48);
  const mimeType = normalize(req.body?.mimeType).toLowerCase();
  const encodedAudio = typeof req.body?.audioBase64 === 'string' ? req.body.audioBase64 : '';
  if (!SERVER_ID_POLICY.test(serverId) || !name || !ALLOWED_SOUND_TYPES.has(mimeType) || !encodedAudio || !/^[A-Za-z0-9+/]*={0,2}$/.test(encodedAudio)) {
    return res.status(400).json({ error: 'Informe um nome e um arquivo de áudio válido.' });
  }
  if (!canAccessServer(req.user.id, serverId)) return res.status(403).json({ error: 'Você não faz parte deste servidor.' });

  const audioData = Buffer.from(encodedAudio, 'base64');
  if (!audioData.length || audioData.length > MAX_CUSTOM_SOUND_BYTES || audioData.toString('base64') !== encodedAudio) {
    return res.status(400).json({ error: 'O áudio deve ter no máximo 4 MB e estar em um formato compatível.' });
  }
  const usage = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(length(audio_data)), 0) AS total_bytes
    FROM custom_sounds WHERE user_id = ?`).get(req.user.id);
  if (usage.count >= MAX_CUSTOM_SOUND_COUNT || usage.total_bytes + audioData.length > MAX_CUSTOM_SOUND_STORAGE_BYTES) {
    return res.status(413).json({ error: 'Limite da conta atingido: até 20 áudios e 20 MB no total.' });
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare('INSERT INTO custom_sounds (id, server_id, user_id, name, mime_type, audio_data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, serverId, req.user.id, name, mimeType, audioData, createdAt);
  return res.status(201).json({ sound: { id, serverId, name, mimeType, createdAt, size: audioData.length, ownerUsername: req.user.username, isOwner: true } });
});

app.get('/api/soundboard/:id/audio', requireAuth, (req, res) => {
  const serverId = normalize(req.query.serverId);
  if (!SERVER_ID_POLICY.test(serverId)) return res.status(400).json({ error: 'Servidor inválido.' });
  if (!canAccessServer(req.user.id, serverId)) return res.status(403).json({ error: 'Você não faz parte deste servidor.' });
  const sound = db.prepare('SELECT mime_type, audio_data FROM custom_sounds WHERE id = ? AND server_id = ?')
    .get(req.params.id, serverId);
  if (!sound) return res.status(404).json({ error: 'Áudio não encontrado.' });
  res.setHeader('Content-Type', sound.mime_type);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.send(sound.audio_data);
});

app.delete('/api/soundboard/:id', requireAuth, (req, res) => {
  const sound = db.prepare('SELECT id, server_id, user_id FROM custom_sounds WHERE id = ?').get(req.params.id);
  if (!sound) return res.status(404).json({ error: 'Áudio não encontrado.' });
  if (!canAccessServer(req.user.id, sound.server_id)) return res.status(403).json({ error: 'Você não faz parte deste servidor.' });
  if (sound.user_id !== req.user.id) return res.status(403).json({ error: 'Somente quem enviou o áudio pode removê-lo.' });
  db.prepare('DELETE FROM custom_sounds WHERE id = ?').run(sound.id);
  return res.json({ ok: true });
});

app.post('/api/presence', requireAuth, (req, res) => {
  const status = normalize(req.body?.status);
  if (!['online', 'idle', 'dnd', 'invisible'].includes(status)) {
    return res.status(400).json({ error: 'Status de presença inválido.' });
  }
  const detail = normalize(req.body?.detail).slice(0, 80);
  const game = normalize(req.body?.game).slice(0, 100);
  db.prepare(`INSERT INTO user_presence (user_id, status, detail, game, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      status = excluded.status,
      detail = excluded.detail,
      game = excluded.game,
      updated_at = excluded.updated_at`)
    .run(req.user.id, status, detail, game, Date.now());
  return res.json({ ok: true });
});

app.get('/api/friends', requireAuth, (req, res) => {
  const friends = db.prepare(`SELECT users.* FROM friendships
    JOIN users ON users.id = CASE WHEN friendships.user_a = ? THEN friendships.user_b ELSE friendships.user_a END
    WHERE friendships.user_a = ? OR friendships.user_b = ?`).all(req.user.id, req.user.id, req.user.id)
    .map((user) => formatFriend(user, 'accepted'));
  const incomingRequests = db.prepare(`SELECT friend_requests.id AS request_id, friend_requests.created_at AS request_created_at, users.* FROM friend_requests
    JOIN users ON users.id = friend_requests.sender_id
    WHERE friend_requests.receiver_id = ? AND friend_requests.status = 'pending'
    ORDER BY friend_requests.created_at DESC`).all(req.user.id)
    .map((user) => ({ ...formatFriend(user, 'pending'), requestId: user.request_id, type: 'incoming', createdAt: user.request_created_at }));
  const outgoingRequests = db.prepare(`SELECT friend_requests.id AS request_id, friend_requests.created_at AS request_created_at, users.* FROM friend_requests
    JOIN users ON users.id = friend_requests.receiver_id
    WHERE friend_requests.sender_id = ? AND friend_requests.status = 'pending'
    ORDER BY friend_requests.created_at DESC`).all(req.user.id)
    .map((user) => ({ ...formatFriend(user, 'pending'), requestId: user.request_id, type: 'outgoing', createdAt: user.request_created_at }));
  const requests = [...incomingRequests, ...outgoingRequests]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return res.json({ friends, requests });
});

app.post('/api/friends/requests', requireAuth, (req, res) => {
  const raw = normalize(req.body?.handle).toLowerCase();
  const parts = raw.split('#');
  if (parts.length > 2 || !parts[0]) return res.status(400).json({ error: 'Informe um nome de usuário válido.' });
  const [username, tag] = parts;
  if (!USERNAME_POLICY.test(username)) {
    return res.status(400).json({ error: 'O nome de usuário deve ter de 3 a 24 caracteres: letras, números ou _.' });
  }
  if (tag !== undefined && !/^[a-z0-9]{4}$/.test(tag)) {
    return res.status(400).json({ error: 'A tag deve conter quatro letras ou números.' });
  }
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
  if (existingRequest) {
    const incomingRequest = db.prepare(`SELECT id FROM friend_requests
      WHERE sender_id = ? AND receiver_id = ? AND status = 'pending'`).get(target.id, req.user.id);
    return res.status(409).json({
      error: incomingRequest
        ? 'Essa pessoa já enviou uma solicitação para você. Confira a aba Pendente para aceitar.'
        : 'Você já enviou uma solicitação para essa pessoa.'
    });
  }

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

app.post('/api/server-invites', requireAuth, (req, res) => {
  const receiverId = normalize(req.body?.receiverId);
  const serverId = normalize(req.body?.serverId);
  const inviteUrl = normalize(req.body?.inviteUrl);
  const receiver = db.prepare('SELECT id FROM users WHERE id = ?').get(receiverId);
  const server = db.prepare('SELECT id, name FROM servers WHERE id = ?').get(serverId);
  if (!receiver || !server || !inviteUrl) return res.status(400).json({ error: 'Dados do convite inválidos.' });
  if (!canAccessServer(req.user.id, serverId)) return res.status(403).json({ error: 'Você não faz parte deste servidor.' });
  if (receiver.id === req.user.id) return res.status(400).json({ error: 'Você já faz parte deste servidor.' });
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO server_invites (id, sender_id, receiver_id, server_id, server_name, invite_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, req.user.id, receiverId, serverId, server.name, inviteUrl, new Date().toISOString());
  return res.status(201).json({ id, ok: true });
});

app.get('/api/server-invites', requireAuth, (req, res) => {
  const invites = db.prepare(`SELECT server_invites.*, users.display_name AS sender_name, users.username AS sender_username,
    servers.icon AS server_icon
    FROM server_invites JOIN users ON users.id = server_invites.sender_id
    JOIN servers ON servers.id = server_invites.server_id
    WHERE receiver_id = ? AND status = 'pending' ORDER BY created_at DESC`).all(req.user.id);
  return res.json({ invites });
});

app.post('/api/server-invites/:id/accept', requireAuth, (req, res) => {
  const invite = db.prepare(`SELECT server_invites.id, server_invites.server_id, servers.name, servers.icon
    FROM server_invites JOIN servers ON servers.id = server_invites.server_id
    WHERE server_invites.id = ? AND server_invites.receiver_id = ? AND server_invites.status = 'pending'`)
    .get(req.params.id, req.user.id);
  if (!invite) return res.status(404).json({ error: 'Convite não encontrado ou já utilizado.' });

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO server_members (server_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
      .run(invite.server_id, req.user.id, 'member', now);
    db.prepare("UPDATE server_invites SET status = 'accepted' WHERE id = ?").run(invite.id);
  })();
  const server = db.prepare(`SELECT servers.*, server_members.role FROM servers
    JOIN server_members ON server_members.server_id = servers.id
    WHERE servers.id = ? AND server_members.user_id = ?`).get(invite.server_id, req.user.id);
  return res.json({ server: formatServer(server, req.user.id) });
});

app.post('/api/server-invite-links', requireAuth, (req, res) => {
  const serverId = normalize(req.body?.serverId);
  const server = db.prepare('SELECT id FROM servers WHERE id = ?').get(serverId);
  if (!server) return res.status(404).json({ error: 'Servidor não encontrado.' });
  if (!canAccessServer(req.user.id, serverId)) return res.status(403).json({ error: 'Você não faz parte deste servidor.' });

  const token = crypto.randomBytes(24).toString('hex');
  const createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO server_invite_links (token, server_id, created_by, created_at)
    VALUES (?, ?, ?, ?)`).run(token, serverId, req.user.id, createdAt);
  const baseUrl = PUBLIC_APP_URL || getRequestBaseUrl(req).replace(/\/+$/, '');
  return res.status(201).json({ inviteUrl: `${baseUrl}/?invite=${encodeURIComponent(token)}` });
});

app.post('/api/server-invite-links/:token/accept', requireAuth, (req, res) => {
  const invite = db.prepare(`SELECT servers.id, servers.name, servers.icon
    FROM server_invite_links
    JOIN servers ON servers.id = server_invite_links.server_id
    WHERE server_invite_links.token = ?`).get(normalize(req.params.token));
  if (!invite) return res.status(404).json({ error: 'Este link de convite é inválido ou o servidor não existe mais.' });

  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO server_members (server_id, user_id, role, joined_at)
    VALUES (?, ?, 'member', ?)`).run(invite.id, req.user.id, now);
  const server = db.prepare(`SELECT servers.*, server_members.role FROM servers
    JOIN server_members ON server_members.server_id = servers.id
    WHERE servers.id = ? AND server_members.user_id = ?`).get(invite.id, req.user.id);
  return res.json({ server: formatServer(server, req.user.id) });
});

app.get('/api/token', (req, res) => {
  return res.status(405).json({
    error: 'Use POST /api/token com { roomName, participantName } para gerar um token do LiveKit.',
    expectedMethod: 'POST',
    requiredFields: ['roomName', 'participantName']
  });
});

app.post('/api/token', requireAuth, async (req, res) => {
  const roomName = normalize(req.body?.roomName);

  if (!roomName || roomName.length > 120) {
    return res.status(400).json({ error: 'Nome do canal de voz inválido.' });
  }

  const accessibleVoiceChannels = db.prepare(`SELECT servers.id, servers.voice_channels_json FROM servers
    JOIN server_members ON server_members.server_id = servers.id
    WHERE server_members.user_id = ?`).all(req.user.id);
  const canJoinRoom = accessibleVoiceChannels.some((server) => {
    const serverSlug = liveKitRoomSlug(server.id, 48);
    const channels = parseJsonValue(server.voice_channels_json, []);
    return Array.isArray(channels) && channels.some((channel) => (
      roomName === `badiscord-${serverSlug}-${liveKitRoomSlug(channel, 64)}`
    ));
  });
  if (!canJoinRoom) return res.status(403).json({ error: 'Você não tem acesso a este canal de voz.' });
  if (!isLiveKitConfigured) {
    return res.status(503).json({ error: 'As chamadas de voz não estão configuradas. Configure as credenciais do LiveKit no servidor.' });
  }

  try {
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: req.user.id,
      name: req.user.display_name,
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
