const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function validateEndpoint(value, protocol) {
  const url = new URL(value);
  if (url.protocol !== protocol || !loopback.has(url.hostname) || url.username || url.password) {
    throw new Error('拒绝连接非本机调试地址');
  }
  return url;
}

export function isMainTarget(target, targetURL = 'app://-/index.html') {
  try {
    const url = new URL(target.url), expected = new URL(targetURL);
    return target.type === 'page' && url.origin === expected.origin &&
      url.protocol === expected.protocol && url.host === expected.host && url.pathname === expected.pathname &&
      !/overlay|detached/i.test(decodeURIComponent(url.search + url.hash));
  } catch { return false; }
}

export async function discover(port = 39222, targetURL, { preferredURL = process.env.COLOR_LABELS_WINDOW_URL } = {}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('调试端口须为 1024–65535 的整数');
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
  if (!response.ok) throw new Error('本机调试接口不可用');
  const list = await response.json();
  if (!Array.isArray(list)) throw new Error('端口返回内容不是调试窗口列表');
  const targets = list.filter(target => isMainTarget(target, targetURL) && (!preferredURL || target.url === preferredURL));
  if (targets.length !== 1) throw new Error(targets.length ? '检测到多个主窗口，首版只支持单主窗口' : '未找到受支持的应用主窗口');
  const socket = validateEndpoint(targets[0].webSocketDebuggerUrl, 'ws:');
  if (Number(socket.port) !== port || !socket.pathname.startsWith('/devtools/page/')) throw new Error('调试接口返回了不匹配的连接地址');
  return targets[0];
}

export class Session {
  constructor(url) {
    validateEndpoint(url, 'ws:');
    this.socket = new WebSocket(url);
    this.serial = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.socket.addEventListener('message', ({ data }) => {
      let message;
      try { message = JSON.parse(data); } catch { return; }
      if (message.method) { for (const listener of this.listeners) listener(message); return; }
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error || message.result?.exceptionDetails) request.reject(new Error(message.error?.message ?? message.result.exceptionDetails.text));
      else request.resolve(message.result);
    });
    this.socket.addEventListener('close', () => this.rejectPending());
    this.socket.addEventListener('error', () => this.rejectPending());
  }
  rejectPending() {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('本机调试连接已断开')); }
    this.pending.clear();
  }
  async connect() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.close(); reject(new Error('调试连接超时')); }, 4000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('调试连接失败')); }, { once: true });
    });
  }
  request(method, params = {}) {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('未连接到应用'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('调试请求超时')); }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async expression(expression) {
    const value = await this.request('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return value.result.value;
  }
  evaluate(fn, ...args) { return this.expression(`(${fn.toString()})(${args.map(a => JSON.stringify(a)).join(',')})`); }
  onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  close() { this.listeners.clear(); this.rejectPending(); this.socket.close(); }
}
