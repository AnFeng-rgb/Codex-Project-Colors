export class SharedQuotaService {
  constructor({ createClient, normalize, unavailable, now = Date.now, refreshMs = 60_000, retryMs = 15_000 }) {
    this.createClient = createClient;
    this.normalize = normalize;
    this.unavailable = unavailable;
    this.now = now;
    this.refreshMs = refreshMs;
    this.retryMs = retryMs;
    this.client = null;
    this.value = null;
    this.busy = null;
    this.nextReadAt = 0;
    this.identity = null;
    this.generation = 0;
  }
  async setIdentity(identity) {
    if (this.identity === identity) return;
    const previous = this.busy;
    this.generation++;
    this.identity = identity;
    this.value = null;
    this.nextReadAt = 0;
    await this.stopClient();
    await previous?.catch(() => {});
  }
  async refresh({ enabled = true, hasWindows = true } = {}) {
    if (!enabled || !hasWindows) return this.value;
    if (this.busy) return this.busy;
    if (this.now() < this.nextReadAt) return this.value;
    const generation = this.generation;
    const task = (async () => {
      let client = this.client;
      try {
        if (!client || client.closed) {
          client = this.createClient();
          this.client = client;
          await client.start();
        }
        const result = await client.read();
        if (generation !== this.generation) return this.value;
        this.value = this.normalize(result);
        this.nextReadAt = this.now() + this.refreshMs;
      } catch {
        if (generation !== this.generation) return this.value;
        if (this.client === client) { this.client = null; await client?.stop(); }
        this.value = this.unavailable(this.value);
        this.nextReadAt = this.now() + this.retryMs;
      }
      return this.value;
    })();
    this.busy = task;
    try { return await task; } finally { if (this.busy === task) this.busy = null; }
  }
  async disable() {
    const previous = this.busy;
    this.generation++;
    await this.stopClient();
    this.nextReadAt = 0;
    await previous?.catch(() => {});
  }
  async stopClient() {
    const client = this.client;
    this.client = null;
    await client?.stop().catch(() => {});
  }
  async stop() {
    const previous = this.busy;
    this.generation++;
    await this.stopClient();
    await previous?.catch(() => {});
    this.value = null;
    this.busy = null;
    this.nextReadAt = 0;
    this.identity = null;
  }
}
