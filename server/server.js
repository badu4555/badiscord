require('dotenv').config();

const express = require('express');
const path = require('path');
const cors = require('cors');
const { AccessToken } = require('livekit-server-sdk');

const app = express();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const publicDir = path.join(__dirname, '..', 'renderer');
const nodeModulesDir = path.join(__dirname, '..', 'node_modules');

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origin não autorizado'));
  }
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

const isLiveKitConfigured = Boolean(
  process.env.LIVEKIT_API_KEY &&
  process.env.LIVEKIT_API_SECRET &&
  process.env.LIVEKIT_API_KEY !== PLACEHOLDER_LIVEKIT_KEY &&
  process.env.LIVEKIT_API_SECRET !== PLACEHOLDER_LIVEKIT_SECRET &&
  process.env.LIVEKIT_WS_URL &&
  !process.env.LIVEKIT_WS_URL.includes('seu-projeto.livekit.cloud')
);

const LIVEKIT_API_KEY = isLiveKitConfigured ? process.env.LIVEKIT_API_KEY : DEV_LIVEKIT_KEY;
const LIVEKIT_API_SECRET = isLiveKitConfigured ? process.env.LIVEKIT_API_SECRET : DEV_LIVEKIT_SECRET;
const LIVEKIT_WS_URL = (isLiveKitConfigured ? process.env.LIVEKIT_WS_URL : process.env.LIVEKIT_WS_URL || process.env.LIVEKIT_URL || 'wss://your-project.livekit.cloud');
const REMOTE_BACKEND_URL = process.env.REMOTE_BACKEND_URL || 'https://badiscord.onrender.com';
const PORT = Number(process.env.PORT || 3000);

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

app.get('/api/config', async (req, res) => {
  const baseUrl = getRequestBaseUrl(req);

  if (isLiveKitConfigured || process.env.LIVEKIT_WS_URL || process.env.LIVEKIT_URL || (process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET)) {
    return res.json({
      ok: true,
      livekitUrl: LIVEKIT_WS_URL,
      roomPrefix: 'badiscord',
      apiBaseUrl: baseUrl,
      demoMode: !isLiveKitConfigured
    });
  }

  const remote = await getRemoteConfig();
  if (remote) {
    return res.json({
      ok: true,
      livekitUrl: remote.livekitUrl || LIVEKIT_WS_URL,
      roomPrefix: 'badiscord',
      apiBaseUrl: baseUrl,
      demoMode: !isLiveKitConfigured
    });
  }

  return res.json({
    ok: true,
    livekitUrl: LIVEKIT_WS_URL,
    roomPrefix: 'badiscord',
    apiBaseUrl: baseUrl,
    demoMode: !isLiveKitConfigured
  });
});

app.post('/api/token', async (req, res) => {
  const { roomName, participantName } = req.body;

  if (!roomName || !participantName) {
    return res.status(400).json({ error: 'roomName e participantName são obrigatórios' });
  }

  const usingDemoCredentials = !isLiveKitConfigured ||
    process.env.LIVEKIT_API_KEY === 'devkey' ||
    process.env.LIVEKIT_API_SECRET === 'secret' ||
    process.env.LIVEKIT_API_KEY === PLACEHOLDER_LIVEKIT_KEY ||
    process.env.LIVEKIT_API_SECRET === PLACEHOLDER_LIVEKIT_SECRET;

  if (usingDemoCredentials) {
    try {
      const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: participantName,
        name: participantName,
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
      identity: participantName,
      name: participantName,
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
