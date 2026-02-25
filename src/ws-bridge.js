'use strict';

const WebSocket = require('ws');

class WSBridge {
  constructor(server, tdlib, secret) {
    this.tdlib = tdlib;
    this.secret = secret;
    this.clients = new Set();

    this.wss = new WebSocket.Server({ server, path: '/ws' });
    this._setup();

    tdlib.on('update',          (u) => this.broadcast({ type: 'TDLIB_UPDATE', payload: u }));
    tdlib.on('authStateChanged',(d) => this.broadcast({ type: 'AUTH_STATE',   payload: d }));
    tdlib.on('ready',           (u) => this.broadcast({ type: 'AUTH_READY',   payload: { user: u } }));

    console.log('[WS] Bridge ready at /ws');
  }

  _setup() {
    this.wss.on('connection', (ws, req) => {
      ws.isAlive = true;
      ws.authenticated = false;

      this._send(ws, {
        type: 'CONNECTED',
        payload: {
          mode: this.tdlib._mode,
          authState: this.tdlib.authState,
          ready: this.tdlib.ready,
          timestamp: Date.now(),
        },
      });

      ws.on('message', async (raw) => {
        try {
          await this._handle(ws, JSON.parse(raw.toString()));
        } catch (err) {
          this._send(ws, { type: 'ERROR', error: 'Bad JSON: ' + err.message });
        }
      });

      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));

      this.clients.add(ws);
    });

    this._ping = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (!ws.isAlive) { this.clients.delete(ws); return ws.terminate(); }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  async _handle(ws, msg) {
    const { id, method, params = {}, secret } = msg;

    if (!ws.authenticated) {
      if (this.secret && secret !== this.secret) {
        this._send(ws, { id, type: 'ERROR', error: 'Unauthorized' });
        return ws.close(4001, 'Unauthorized');
      }
      ws.authenticated = true;
    }

    if (method === 'PING') return this._send(ws, { id, type: 'PONG', ts: Date.now() });

    if (method === 'GET_STATUS') return this._send(ws, {
      id, type: 'STATUS',
      payload: { authState: this.tdlib.authState, ready: this.tdlib.ready, mode: this.tdlib._mode }
    });

    if (!method) return this._send(ws, { id, type: 'ERROR', error: 'method required' });

    try {
      const result = await this.tdlib.send(method, params);
      this._send(ws, { id, type: 'RESULT', method, result });
    } catch (err) {
      this._send(ws, { id, type: 'ERROR', method, error: err.message });
    }
  }

  _send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }

  broadcast(data) {
    const str = JSON.stringify(data);
    this.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(str);
    });
  }

  get clientCount() { return this.clients.size; }
}

module.exports = WSBridge;
