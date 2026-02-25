'use strict';

require('dotenv').config();

const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const TDLibClient = require('./tdlib-client');
const AuthRouter = require('./auth-router');
const WSBridge = require('./ws-bridge');

const PORT = parseInt(process.env.PORT || '8080');
const HOST = '0.0.0.0';
const SECRET = process.env.SERVER_SECRET || '';
const API_ID = process.env.TELEGRAM_API_ID || '';
const API_HASH = process.env.TELEGRAM_API_HASH || '';

if (!API_ID || !API_HASH) {
  console.error('❌  Set TELEGRAM_API_ID and TELEGRAM_API_HASH in Railway Variables');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// ── Serve iPhone app from /public ──────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ── TDLib client ───────────────────────────────────────────
const tdlib = new TDLibClient({
  apiId: API_ID,
  apiHash: API_HASH,
  dbPath: process.env.TDLIB_DB_PATH || './tdlib_db',
  filesPath: process.env.TDLIB_FILES_PATH || './tdlib_files',
});

let wsBridge;
const broadcast = (data) => wsBridge?.broadcast(data);

// ── Auth routes ────────────────────────────────────────────
const authRouter = new AuthRouter(tdlib, broadcast);
const apiRouter = express.Router();
authRouter.attach(apiRouter);

// ── TDLib method proxy ─────────────────────────────────────
apiRouter.post('/tdlib/:method', async (req, res) => {
  if (SECRET && req.headers['x-server-secret'] !== SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  try {
    const result = await tdlib.send(req.params.method, req.body || {});
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.use('/api', apiRouter);

// ── Health check ───────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    mode: tdlib._mode,
    authState: tdlib.authState,
    ready: tdlib.ready,
    wsClients: wsBridge?.clientCount || 0,
    node: process.version,
  });
});

// ── Catch-all: return the app ──────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Start ──────────────────────────────────────────────────
server.listen(PORT, HOST, async () => {
  console.log('');
  console.log('  ✈  TG Alpha Bridge');
  console.log('  ──────────────────────────────');
  console.log(`  HTTP  →  http://${HOST}:${PORT}`);
  console.log(`  WS    →  ws://${HOST}:${PORT}/ws`);
  console.log(`  APP   →  http://${HOST}:${PORT}/`);
  console.log('  ──────────────────────────────');
  console.log(`  API ID : ${API_ID}`);
  console.log(`  Secret : ${SECRET ? '✅ set' : '⚠️  not set'}`);
  console.log('');
  console.log('[TDLib] Initializing...');
  await tdlib.init();
  wsBridge = new WSBridge(server, tdlib, SECRET);
  console.log('[Server] ✅ Ready — open your Railway URL in Safari');
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT',  () => server.close(() => process.exit(0)));
process.on('uncaughtException',  (e) => console.error('[Uncaught]', e));
process.on('unhandledRejection', (r) => console.error('[Unhandled]', r));
