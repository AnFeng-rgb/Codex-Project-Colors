import { createPreferences } from '../demo/core/preferences.mjs';

const preferences = createPreferences(null);

export function parsePreferenceRequest(raw, token, previousRevision) {
  if (typeof raw !== 'string' || raw.length > 16_384) return null;
  let value;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || Array.isArray(value) || value.token !== token || !Number.isSafeInteger(value.revision) ||
      value.revision <= previousRevision || !value.operation || Array.isArray(value.operation) ||
      Object.keys(value).some(key => !['token', 'revision', 'operation'].includes(key))) return null;
  return { token, revision: value.revision, operation: value.operation };
}

export function applyPreferenceOperation(current, operation, {
  sourceProjectKeys = [], allProjectKeys = sourceProjectKeys, random = Math.random,
  randomBatches = new Map(), now = Date.now(), model = preferences,
} = {}) {
  const next = model.validate(current);
  if (!operation || Array.isArray(operation) || typeof operation !== 'object') throw new Error('配色操作格式无效');
  const fields = Object.keys(operation);
  const allowed = (keys) => fields.every(key => keys.includes(key));
  if (operation.type === 'set-color' && allowed(['type', 'key', 'color'])) {
    if (typeof operation.key !== 'string' || !sourceProjectKeys.includes(operation.key)) throw new Error('当前窗口已没有这个项目，未修改配色');
    if (operation.color !== null && !model.isColor(operation.color)) throw new Error('颜色格式无效');
    const projects = { ...next.projects };
    if (operation.color === null) delete projects[operation.key]; else projects[operation.key] = operation.color;
    return { preferences: model.validate({ ...next, projects }), randomUndo: undefined };
  }
  if (operation.type === 'set-paused' && allowed(['type', 'paused']) && typeof operation.paused === 'boolean') {
    return { preferences: { ...next, paused: operation.paused }, randomUndo: undefined };
  }
  if (operation.type === 'clear-colors' && allowed(['type'])) {
    return { preferences: { ...next, projects: {} }, randomUndo: undefined };
  }
  if (operation.type === 'randomize' && allowed(['type', 'batchId', 'undo', 'keys'])) {
    if (typeof operation.batchId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(operation.batchId) ||
        (operation.undo !== undefined && typeof operation.undo !== 'boolean')) throw new Error('随机配色请求无效');
    const union = [...new Set(allProjectKeys.filter(key => typeof key === 'string' && /^local:[a-zA-Z0-9_-]{1,128}$/.test(key)))];
    const keys = operation.keys === undefined ? union : operation.keys;
    if (!Array.isArray(keys) || keys.length > 2000 || keys.some(key => !union.includes(key)) || new Set(keys).size !== keys.length) throw new Error('项目列表已变化，请重试随机配色');
    if (!keys.length) throw new Error('没有可配色的本地项目');
    const colors = model.colors, assigned = [];
    let previous = null;
    while (assigned.length < keys.length) {
      const bag = [...colors];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (bag[0] === previous) [bag[0], bag[1]] = [bag[1], bag[0]];
      const batch = bag.slice(0, keys.length - assigned.length); assigned.push(...batch); previous = batch.at(-1);
    }
    if (keys.every((key, index) => next.projects[key] === assigned[index])) {
      for (let i = 0; i < assigned.length; i++) assigned[i] = colors[(colors.indexOf(assigned[i]) + 1) % colors.length];
    }
    const projects = { ...next.projects }, changes = {};
    keys.forEach((key, index) => { changes[key] = { before: projects[key] ?? null, after: assigned[index] }; projects[key] = assigned[index]; });
    if (operation.undo !== false) randomBatches.set(operation.batchId, { changes, expiresAt: now + 30_000 });
    return { preferences: model.validate({ ...next, projects }), randomUndo: operation.undo === false ? undefined : { batchId: operation.batchId, expiresAt: now + 30_000 } };
  }
  if (operation.type === 'undo-randomize' && allowed(['type', 'batchId'])) {
    const batch = randomBatches.get(operation.batchId);
    if (!batch) throw new Error('这批随机配色已无法撤销');
    if (now > batch.expiresAt) { randomBatches.delete(operation.batchId); throw new Error('撤销时间已过，请重新配色'); }
    for (const [key, change] of Object.entries(batch.changes)) {
      if ((next.projects[key] ?? null) !== change.after) throw new Error('这批随机配色中有项目已被改动，无法撤销');
    }
    const projects = { ...next.projects };
    for (const [key, change] of Object.entries(batch.changes)) {
      if (change.before === null) delete projects[key]; else projects[key] = change.before;
    }
    randomBatches.delete(operation.batchId);
    return { preferences: model.validate({ ...next, projects }), randomUndo: null };
  }
  throw new Error('配色操作不受支持');
}
