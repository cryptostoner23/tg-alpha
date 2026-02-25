'use strict';

class AuthRouter {
  constructor(tdlib, broadcast) {
    this.tdlib = tdlib;
    this.broadcast = broadcast;

    tdlib.on('authStateChanged', (data) => broadcast({ type: 'AUTH_STATE', payload: data }));
    tdlib.on('ready', (user) => broadcast({ type: 'AUTH_READY', payload: { user } }));
    tdlib.on('update', (update) => broadcast({ type: 'TDLIB_UPDATE', payload: update }));
  }

  async getStatus(req, res) {
    try {
      const base = { ok: true, state: this.tdlib.authState, mode: this.tdlib._mode };
      if (this.tdlib.ready) {
        const user = await this.tdlib.send('getMe');
        return res.json({ ...base, state: 'ready', user });
      }
      res.json(base);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }

  async submitPhone(req, res) {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ ok: false, error: 'phone required' });
    try {
      const result = await this.tdlib.setPhoneNumber(phone);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }

  async submitCode(req, res) {
    const { code } = req.body;
    if (!code) return res.status(400).json({ ok: false, error: 'code required' });
    try {
      const result = await this.tdlib.submitCode(code);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }

  async submitPassword(req, res) {
    const { password } = req.body;
    if (!password) return res.status(400).json({ ok: false, error: 'password required' });
    try {
      const result = await this.tdlib.submitPassword(password);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }

  async requestQR(req, res) {
    try {
      const result = await this.tdlib.requestQRCode();
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }

  async logout(req, res) {
    try {
      await this.tdlib.logout();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }

  attach(router) {
    router.get( '/auth/status',     this.getStatus.bind(this));
    router.post('/auth/phone',      this.submitPhone.bind(this));
    router.post('/auth/code',       this.submitCode.bind(this));
    router.post('/auth/password',   this.submitPassword.bind(this));
    router.post('/auth/qr',         this.requestQR.bind(this));
    router.post('/auth/logout',     this.logout.bind(this));
  }
}

module.exports = AuthRouter;
