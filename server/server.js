const express = require('express');
const cors = require('cors');
const { AccessToken } = require('livekit-server-sdk');

const app = express();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origin não autorizado'));
  }
}));
app.use(express.json());

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';
const PORT = process.env.PORT || 3000;

app.post('/api/token', async (req, res) => {
  const { roomName, participantName } = req.body;

  if (!roomName || !participantName) {
    return res.status(400).json({ error: 'roomName e participantName são obrigatórios' });
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
    res.json({ token });
  } catch (err) {
    console.error('Erro ao gerar token:', err);
    res.status(500).json({ error: 'Erro ao gerar token' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`🚀 Servidor de Sinalização PC rodando em http://localhost:${PORT}`);
});
