export function boundedMap(items, limit, action) {
  const output = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try { output[index] = { status: 'fulfilled', value: await action(items[index], index) }; }
      catch (reason) { output[index] = { status: 'rejected', reason }; }
    }
  };
  return Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker)).then(() => output);
}

export class WindowPool {
  constructor({ open, close, concurrency = 3 }) {
    this.open = open;
    this.close = close;
    this.concurrency = concurrency;
    this.windows = new Map();
  }
  async reconcile(targets) {
    const byId = new Map(targets.filter(target => typeof target?.id === 'string' && target.id).map(target => [target.id, target]));
    const removed = [];
    for (const [id, context] of this.windows) {
      const target = byId.get(id);
      if (!target || target.webSocketDebuggerUrl !== context.target.webSocketDebuggerUrl) {
        this.windows.delete(id);
        removed.push(context);
      } else context.target = target;
    }
    await boundedMap(removed, this.concurrency, context => this.close(context));
    const added = [...byId].filter(([id]) => !this.windows.has(id));
    const results = await boundedMap(added, this.concurrency, async ([id, target]) => {
      const context = await this.open(target);
      this.windows.set(id, context);
      return context;
    });
    return {
      connected: results.filter(result => result?.status === 'fulfilled').length,
      failed: results.filter(result => result?.status === 'rejected').length,
      removed: removed.length,
      targets: byId.size,
    };
  }
  async remove(id) {
    const context = this.windows.get(id);
    if (!context) return false;
    this.windows.delete(id);
    await this.close(context);
    return true;
  }
  async closeAll() {
    const contexts = [...this.windows.values()];
    this.windows.clear();
    await boundedMap(contexts, this.concurrency, context => this.close(context));
  }
}
