import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreferences } from '../demo/core/preferences.mjs';
import { applyPreferenceOperation, parsePreferenceRequest } from './shared-state.mjs';

const model = createPreferences(null);
const initial = model.empty();
const keys = ['local:one', 'local:two'];

test('操作式保存基于最新配置合并不同窗口的并发改色', () => {
  const first = applyPreferenceOperation(initial, { type: 'set-color', key: keys[0], color: 'blue' }, { sourceProjectKeys: [keys[0]] });
  const second = applyPreferenceOperation(first.preferences, { type: 'set-color', key: keys[1], color: 'purple' }, { sourceProjectKeys: [keys[1]] });
  assert.deepEqual(second.preferences.projects, { [keys[0]]: 'blue', [keys[1]]: 'purple' });
});

test('随机配色跨窗口项目并集去重，撤销只还原这批项目', () => {
  const batches = new Map();
  const random = applyPreferenceOperation(initial, { type: 'randomize', batchId: 'batch_12345678' }, {
    sourceProjectKeys: [keys[0]], allProjectKeys: [keys[0], keys[1], keys[0]], random: () => 0, randomBatches: batches, now: 100,
  });
  assert.deepEqual(Object.keys(random.preferences.projects), keys);
  assert.equal(random.randomUndo.expiresAt, 30_100);
  const undone = applyPreferenceOperation(random.preferences, { type: 'undo-randomize', batchId: 'batch_12345678' }, { randomBatches: batches, now: 101 });
  assert.deepEqual(undone.preferences, initial);
  assert.equal(batches.size, 0);
});

test('未确认磁盘保存时，随机批次变更不会消费已确认的撤销记录', () => {
  const batches = new Map();
  const random = applyPreferenceOperation(initial, { type: 'randomize', batchId: 'batch_stage123' }, {
    allProjectKeys: keys, random: () => 0, randomBatches: batches, now: 100,
  });
  const stagedBatches = new Map(batches);
  const undone = applyPreferenceOperation(random.preferences, { type: 'undo-randomize', batchId: 'batch_stage123' }, {
    randomBatches: stagedBatches, now: 101,
  });
  assert.deepEqual(undone.preferences, initial);
  assert.equal(stagedBatches.size, 0);
  assert.equal(batches.size, 1);
});

test('后续改色后拒绝随机批次撤销，不覆盖后续颜色', () => {
  const batches = new Map();
  const random = applyPreferenceOperation(initial, { type: 'randomize', batchId: 'batch_87654321' }, {
    allProjectKeys: keys, random: () => 0, randomBatches: batches, now: 100,
  });
  const changed = applyPreferenceOperation(random.preferences, { type: 'set-color', key: keys[0], color: 'green' }, { sourceProjectKeys: keys, randomBatches: batches });
  assert.throws(() => applyPreferenceOperation(changed.preferences, { type: 'undo-randomize', batchId: 'batch_87654321' }, { randomBatches: batches, now: 101 }), /已被改动/);
  assert.equal(changed.preferences.projects[keys[0]], 'green');
});

test('清除颜色保留暂停状态，超过撤销时限拒绝还原', () => {
  const paused = { version: 1, paused: true, projects: { [keys[0]]: 'red' } };
  const cleared = applyPreferenceOperation(paused, { type: 'clear-colors' });
  assert.deepEqual(cleared.preferences, { version: 1, paused: true, projects: {} });
  const batches = new Map();
  const random = applyPreferenceOperation(initial, { type: 'randomize', batchId: 'batch_expired1' }, { allProjectKeys: keys, random: () => 0, randomBatches: batches, now: 100 });
  assert.throws(() => applyPreferenceOperation(random.preferences, { type: 'undo-randomize', batchId: 'batch_expired1' }, { randomBatches: batches, now: 30_101 }), /撤销时间已过/);
});

test('配色桥拒绝重复序号、旧令牌、畸形 JSON 和整份配置写入', () => {
  const raw = JSON.stringify({ token: 'current', revision: 3, operation: { type: 'set-paused', paused: true } });
  assert.equal(parsePreferenceRequest(raw, 'current', 2).revision, 3);
  assert.equal(parsePreferenceRequest(raw, 'old', 2), null);
  assert.equal(parsePreferenceRequest(raw, 'current', 3), null);
  assert.equal(parsePreferenceRequest('{', 'current', 0), null);
  assert.equal(parsePreferenceRequest(JSON.stringify({ token: 'current', revision: 4, preferences: initial }), 'current', 0), null);
});
