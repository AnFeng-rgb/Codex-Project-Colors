import test from 'node:test';
import assert from 'node:assert/strict';
import { WindowPool, boundedMap } from './window-pool.mjs';

test('新增和移除窗口互相隔离，连接失败不阻塞其他窗口', async () => {
  const closed = [];
  const pool = new WindowPool({
    open: async target => { if (target.id === 'broken') throw new Error('test failure'); return { target, active: true }; },
    close: async context => { closed.push(context.target.id); },
  });
  const first = await pool.reconcile([
    { id: 'chat', webSocketDebuggerUrl: 'ws://127.0.0.1:39222/devtools/page/chat' },
    { id: 'work', webSocketDebuggerUrl: 'ws://127.0.0.1:39222/devtools/page/work' },
    { id: 'broken', webSocketDebuggerUrl: 'ws://127.0.0.1:39222/devtools/page/broken' },
  ]);
  assert.deepEqual(first, { connected: 2, failed: 1, removed: 0, targets: 3 });
  const second = await pool.reconcile([{ id: 'work', webSocketDebuggerUrl: 'ws://127.0.0.1:39222/devtools/page/work' }]);
  assert.deepEqual(second, { connected: 0, failed: 0, removed: 1, targets: 1 });
  assert.deepEqual(closed, ['chat']);
  assert.deepEqual([...pool.windows.keys()], ['work']);
  await pool.closeAll();
  assert.deepEqual(closed, ['chat', 'work']);
});

test('有界并发逐项报告失败', async () => {
  let active = 0, maximum = 0;
  const results = await boundedMap([1, 2, 3, 4, 5], 2, async value => {
    active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 2)); active--;
    if (value === 3) throw new Error('isolated'); return value * 2;
  });
  assert.equal(maximum, 2);
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
});
