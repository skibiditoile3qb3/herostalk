/**
 * relay-client.js
 * WebSocket relay client for the Forum frontend.
 * Connects to the Render-hosted relay server and exposes a clean promise-based API.
 */

const RELAY_URL = 'wss://relayfah2.onrender.com';

class RelayClient {
  constructor() {
    this.ws = null;
    this.pendingRequests = new Map(); // reqId -> { resolve, reject }
    this.listeners = new Map();       // event type -> [callbacks]
    this.reqCounter = 0;
    this.connected = false;
    this.connectPromise = null;
    this._reconnectDelay = 1000;
    this._reconnectTimer = null;
  }

  connect() {
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(RELAY_URL);
      } catch (e) {
        reject(e);
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 10000);

      this.ws.addEventListener('open', () => {
        clearTimeout(timeout);
        this.connected = true;
        this._reconnectDelay = 1000;
        console.log('[RelayClient] Connected');
        resolve();
      });

      this.ws.addEventListener('message', (event) => {
        this._handleMessage(event.data);
      });

      this.ws.addEventListener('close', () => {
        this.connected = false;
        this.connectPromise = null;
        console.log('[RelayClient] Disconnected, reconnecting...');
        this._scheduleReconnect();
        this._emit('disconnect', {});
      });

      this.ws.addEventListener('error', (err) => {
        clearTimeout(timeout);
        console.error('[RelayClient] Error', err);
        this._emit('error', err);
        reject(err);
      });
    });

    return this.connectPromise;
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      try {
        await this.connect();
        this._emit('reconnected', {});
      } catch {
        this._reconnectDelay = Math.min(this._reconnectDelay * 2, 30000);
        this._scheduleReconnect();
      }
    }, this._reconnectDelay);
  }

  _handleMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      console.error('[RelayClient] Invalid message:', data);
      return;
    }

    const { reqId, type } = msg;

    // Resolve pending request if applicable
    if (reqId && this.pendingRequests.has(reqId)) {
      const { resolve } = this.pendingRequests.get(reqId);
      this.pendingRequests.delete(reqId);
      resolve(msg);
    }

    // Also emit as event for broadcast messages
    this._emit(type, msg);
  }

  _emit(type, data) {
    const callbacks = this.listeners.get(type) || [];
    callbacks.forEach(cb => cb(data));
  }

  on(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
    return () => this.off(type, callback);
  }

  off(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    this.listeners.set(type, callbacks.filter(cb => cb !== callback));
  }

  /**
   * Send a message and await a response.
   * @param {string} type - message type
   * @param {object} payload - message payload
   * @param {number} timeout - ms before rejecting
   */
  send(type, payload = {}, timeout = 10000) {
    return new Promise(async (resolve, reject) => {
      if (!this.connected) {
        try { await this.connect(); } catch (e) { reject(e); return; }
      }

      const reqId = `req_${++this.reqCounter}_${Date.now()}`;

      const timer = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`Request timeout: ${type}`));
      }, timeout);

      this.pendingRequests.set(reqId, {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        }
      });

      try {
        this.ws.send(JSON.stringify({ type, payload, reqId }));
      } catch (e) {
        clearTimeout(timer);
        this.pendingRequests.delete(reqId);
        reject(e);
      }
    });
  }

  // ─── Convenience API ────────────────────────────────────────────────────────

  checkUsername(username) {
    return this.send('check_username', { username });
  }

  registerUser(username, permId) {
    return this.send('register_user', { username, permId });
  }

  verifyUser(username, permId) {
    return this.send('verify_user', { username, permId });
  }

  getPosts(sort = 'newest') {
    return this.send('get_posts', { sort });
  }

  getPost(postId) {
    return this.send('get_post', { postId });
  }

  createPost(title, content, authorUsername, authorPermId) {
    return this.send('create_post', { title, content, authorUsername, authorPermId });
  }

  likePost(postId, permId, username) {
    return this.send('like_post', { postId, permId, username });
  }

  addComment(postId, content, authorUsername, authorPermId) {
    return this.send('add_comment', { postId, content, authorUsername, authorPermId });
  }
}

// Export as singleton
const relay = new RelayClient();
window.relay = relay;
