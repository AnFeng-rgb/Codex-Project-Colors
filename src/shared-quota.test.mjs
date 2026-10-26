import test from 'node:test';
import assert from 'node:assert/strict';
import { SharedQuotaService } from './shared-quota.mjs';

test('多个窗口共用一次额度读取和缓存刷新周期', async () => {
  let now = 100, starts = 0, reads = 0, stops = 0;
  const service = new SharedQuotaService({
    createClient: () => ({ closed: false, async start() { starts++; }, async read() { reads++; await new Promise(resolve => setTimeout(resolve, 5)); return { remaining: 70 }; }, async stop() { stops++; } }),
    normalize: value => value, unavailable: previous => previous ?? { error: true }, now: () => now,
  });
  await service.setIdentity('same-session');
  const [first, second] = await Promise.all([service.refresh({ hasWindows: true }), service.refresh({ hasWindows: true })]);
  assert.deepEqual(first, { remaining: 70 }); assert.deepEqual(second, first);
  assert.deepEqual({ starts, reads }, { starts: 1, reads: 1 });
  await service.refresh({ hasWindows: true }); assert.equal(reads, 1);
  now += 60_001; await service.refresh({ hasWindows: true }); assert.equal(reads, 2);
  await service.refresh({ hasWindows: false }); assert.equal(reads, 2);
  await service.disable(); assert.equal(stops, 1);
  await service.stop();
});

test('额度账号上下文改变时丢弃旧读数', async () => {
  let now = 1, account = 'first';
  const service = new SharedQuotaService({
    createClient: () => ({ closed: false, async start() {}, async read() { return { account }; }, async stop() {} }),
    normalize: value => value, unavailable: previous => previous, now: () => now,
  });
  await service.setIdentity('app-a'); await service.refresh(); assert.deepEqual(service.value, { account: 'first' });
  account = 'second'; await service.setIdentity('app-b'); assert.equal(service.value, null);
  now++; await service.refresh(); assert.deepEqual(service.value, { account: 'second' });
  await service.stop();
});
