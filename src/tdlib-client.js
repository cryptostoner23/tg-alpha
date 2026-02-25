'use strict';

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

class TDLibClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.authState = 'idle';
    this.ready = false;
    this._pendingAuth = {};
    this._mode = 'demo';
    this.mtproto = null;
  }

  async init() {
    try {
      await this._initReal();
    } catch (err) {
      console.warn('[MTProto] Failed - DEMO mode. Error: ' + err.message);
      this._initDemo();
    }
  }

  async _initReal() {
    const MTProto = require('@mtproto/core');
    const { LocalStorage } = require('node-localstorage');
    const sessionPath = path.resolve('./mtproto_session');
    fs.mkdirSync(sessionPath, { recursive: true });
    const storage = new LocalStorage(sessionPath);
    this.mtproto = new MTProto({
      api_id: parseInt(this.config.apiId),
      api_hash: this.config.apiHash,
      storageOptions: { instance: storage },
    });
    this._mode = 'real';
    console.log('[MTProto] Ready - pure JS, no native libs');
    try {
      const result = await this.mtproto.call('users.getFullUser', { id: { _: 'inputUserSelf' } });
      this.ready = true;
      this.authState = 'authorizationStateReady';
      const u = result.users && result.users[0];
      if (u) {
        console.log('');
        console.log('================================================');
        console.log('  ALREADY LOGGED IN');
        console.log('  Name : ' + (u.first_name || '') + ' ' + (u.last_name || ''));
        console.log('  User : @' + (u.username || 'none'));
        console.log('  ID   : ' + u.id);
        console.log('================================================');
        console.log('');
      }
      this.emit('authStateChanged', { state: 'authorizationStateReady' });
      this.emit('ready', u);
    } catch (e) {
      this.authState = 'authorizationStateWaitPhoneNumber';
      this.emit('authStateChanged', { state: 'authorizationStateWaitPhoneNumber' });
    }
  }

  _initDemo() {
    this._mode = 'demo';
    this.authState = 'ready';
    this.ready = true;
    this.emit('authStateChanged', { state: 'ready', mode: 'demo' });
  }

  async setPhoneNumber(phone) {
    this._pendingAuth.phone = phone;
    if (this._mode === 'demo') return { ok: true };
    console.log('[MTProto] Sending OTP to ' + phone + '...');
    try {
      const result = await this.mtproto.call('auth.sendCode', {
        phone_number: phone,
        api_id: parseInt(this.config.apiId),
        api_hash: this.config.apiHash,
        settings: { _: 'codeSettings' },
      });
      this._pendingAuth.phone_code_hash = result.phone_code_hash;
      console.log('');
      console.log('================================================');
      console.log('  OTP CODE SENT');
      console.log('  Phone : ' + phone);
      console.log('  Check your Telegram app for the code');
      console.log('================================================');
      console.log('');
      this.authState = 'authorizationStateWaitCode';
      this.emit('authStateChanged', { state: 'authorizationStateWaitCode' });
      return { ok: true };
    } catch (err) {
      if (err.error_message === 'SESSION_PASSWORD_NEEDED') {
        this.authState = 'authorizationStateWaitPassword';
        this.emit('authStateChanged', { state: 'authorizationStateWaitPassword' });
        return { ok: true };
      }
      throw err;
    }
  }

  async submitCode(code) {
    if (this._mode === 'demo') return { ok: true };
    console.log('[MTProto] Submitting code: ' + code);
    try {
      const result = await this.mtproto.call('auth.signIn', {
        phone_number: this._pendingAuth.phone,
        phone_code_hash: this._pendingAuth.phone_code_hash,
        phone_code: String(code),
      });
      await this._onAuthSuccess(result.user);
      return { ok: true };
    } catch (err) {
      if (err.error_message === 'SESSION_PASSWORD_NEEDED') {
        console.log('');
        console.log('================================================');
        console.log('  2FA PASSWORD REQUIRED');
        console.log('================================================');
        console.log('');
        this.authState = 'authorizationStateWaitPassword';
        this.emit('authStateChanged', { state: 'authorizationStateWaitPassword' });
        return { ok: true };
      }
      throw err;
    }
  }

  async submitPassword(password) {
    if (this._mode === 'demo') return { ok: true };
    console.log('[MTProto] Submitting 2FA...');
    const { SRP } = require('@mtproto/core');
    const pwd = await this.mtproto.call('account.getPassword');
    const { g, p, salt1, salt2 } = pwd.current_algo;
    const { A, M1 } = await SRP.genKeys({ password, g, p, salt1, salt2, srp_B: pwd.srp_B });
    const result = await this.mtproto.call('auth.checkPassword', {
      password: { _: 'inputCheckPasswordSRP', srp_id: pwd.srp_id, A, M1 },
    });
    await this._onAuthSuccess(result.user);
    return { ok: true };
  }

  async _onAuthSuccess(user) {
    this.ready = true;
    this.authState = 'authorizationStateReady';
    const name = ((user.first_name || '') + ' ' + (user.last_name || '')).trim();
    console.log('');
    console.log('================================================');
    console.log('  TELEGRAM AUTH SUCCESSFUL');
    console.log('  Name : ' + name);
    console.log('  User : @' + (user.username || 'none'));
    console.log('  ID   : ' + user.id);
    console.log('================================================');
    console.log('');
    this.emit('authStateChanged', { state: 'authorizationStateReady' });
    this.emit('ready', user);
  }

  async logout() {
    if (this._mode === 'demo') return { ok: true };
    await this.mtproto.call('auth.logOut');
    this.ready = false;
    this.authState = 'authorizationStateWaitPhoneNumber';
    this.emit('closed');
    return { ok: true };
  }

  async send(method, params) {
    if (!params) params = {};
    if (this._mode === 'demo') return this._demo(method, params);
    if (!this.mtproto) throw new Error('Client not ready');
    try {
      return await this.mtproto.call(method, params);
    } catch (err) {
      console.error('[MTProto] ' + method + ' error: ' + (err.error_message || err.message));
      throw err;
    }
  }

  _demo(method, params) {
    const ts = function() { return Math.floor(Date.now() / 1000); };
    const map = {
      getMe: { id: 987654321, first_name: 'Demo', last_name: 'User', username: 'demo_user' },
      getChats: { total_count: 3, chat_ids: [1001, 1002, 1003] },
      getActiveSessions: { sessions: [{ id: '1', is_current: true, application_name: 'TG Alpha', device_model: 'Server', log_in_date: ts() - 3600, last_active_date: ts() }] },
      logOut: { ok: true },
    };
    return new Promise(function(resolve) {
      setTimeout(function() { resolve(map[method] || { ok: true, _demo: true, method: method }); }, 200);
    });
  }
}

module.exports = TDLibClient;
