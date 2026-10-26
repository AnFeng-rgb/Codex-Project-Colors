import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { VERSION } from './version.mjs';
import { discoverAll, Session } from '../demo/core/cdp.mjs';
import { createAdapter } from '../demo/core/adapter.mjs';
import { createPreferences } from '../demo/core/preferences.mjs';
import { installRenderer } from '../demo/core/renderer.mjs';
import { ensureApplication } from '../demo/platforms/macos/launch.mjs';
import { PreferenceStore, atomicWrite } from './preferences-store.mjs';
import { settings } from './settings.mjs';
import { parseCommand, revealPreferences } from './commands.mjs';
import { browserIdentity, preferencesForSession } from './browser-session.mjs';
import { FirstUsePalette } from './first-use.mjs';
import { installQuotaRenderer, quotaPresentation } from '../demo/core/quota-renderer.mjs';
import { QuotaClient, normalizeQuota, quotaUnavailable } from './quota.mjs';
import { UISettingsStore, parseUISettingsRequest } from './ui-settings.mjs';
import { applyPreferenceOperation, parsePreferenceRequest } from './shared-state.mjs';
import { boundedMap, WindowPool } from './window-pool.mjs';
import { SharedQuotaService } from './shared-quota.mjs';

const opts = await settings(), store = new PreferenceStore(opts.dataDir);
const firstPalette = new FirstUsePalette(opts.dataDir);
const uiStore = new UISettingsStore(opts.dataDir);
const preferenceModel = createPreferences(null);
let uiConfig = { version: 1, showQuota: true }, uiVersion = 0;
let preferences = null, stateVersion = 0, applicationIdentity = null;
let activeRandomUndo = null, stopping = false, ownsLock = false, lastStatus = '', fatal = '';
let lastTargetCount = 0, discoveryError = '';
const randomBatches = new Map();
let mutationQueue = Promise.resolve();
const PRODUCT = 'color-labels.v1', BINDING = '__colorLabelsSaveV1', CONTROL = '__colorLabelsCommandV1', STORAGE = 'codex-color-labels.v1';
const UI_BINDING = '__colorLabelsUISettingsV1';
const lock = path.join(opts.runtime, 'agent.lock'), stopFile = path.join(opts.runtime, 'stop-request');
const quota = new SharedQuotaService({
  createClient: () => new QuotaClient(opts.appPath), normalize: normalizeQuota, unavailable: quotaUnavailable,
});
let pool;

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };
async function publish(status, detail = '', renderer) {
  await atomicWrite(path.join(opts.runtime, 'status.json'), JSON.stringify({ product: PRODUCT, version: VERSION, status, detail, pid: process.pid, updatedAt: new Date().toISOString(), renderer }, null, 2));
  if (lastStatus !== `${status}:${detail}`) { console.log(`${status}${detail ? '：' + detail : ''}`); lastStatus = `${status}:${detail}`; }
}
async function acquire() {
  try { await fs.mkdir(lock); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const pid = Number(await fs.readFile(path.join(lock, 'pid'), 'utf8').catch(() => '0'));
    if (!pid || alive(pid)) return false;
    await fs.rm(lock, { recursive: true }); await fs.mkdir(lock);
  }
  ownsLock = true;
  await fs.writeFile(path.join(lock, 'pid'), String(process.pid));
  await fs.rm(stopFile, { force: true }); return true;
}
function isCurrent(context) {
  return !stopping && pool?.windows.get(context.target.id) === context && context.active;
}
function activeUndo() {
  if (activeRandomUndo && activeRandomUndo.expiresAt < Date.now()) activeRandomUndo = null;
  return activeRandomUndo ? { ...activeRandomUndo } : null;
}
function projectKeyUnion() {
  return [...new Set([...pool.windows.values()].filter(context => context.rendererStatus?.ready).flatMap(context => context.projectKeys ?? []))];
}
async function acknowledgePreferences(context, revision, ok, message = '') {
  if (!isCurrent(context)) return;
  try {
    await context.session.evaluate((token, value, success, reason, snapshot, version, undo) =>
      window.__codexColorLabelsDemo?.persistenceAck(token, value, success, reason, snapshot, version, undo),
    context.token, revision, ok, message, preferences, stateVersion, activeUndo());
  } catch {}
}
async function broadcastPreferences(sourceContext = null, revision = 0) {
  const contexts = [...pool.windows.values()];
  await boundedMap(contexts, 3, async context => {
    if (!isCurrent(context)) return;
    if (context === sourceContext) return acknowledgePreferences(context, revision, true);
    await context.session.evaluate((token, snapshot, version, undo) =>
      window.__codexColorLabelsDemo?.applySharedState(token, snapshot, version, undo),
    context.token, preferences, stateVersion, activeUndo());
  });
}
function enqueueMutation(action) {
  const task = mutationQueue.catch(() => {}).then(action);
  mutationQueue = task.catch(() => {});
  return task;
}
function handlePreferenceRequest(context, raw) {
  const request = parsePreferenceRequest(raw, context.token, context.lastPreferenceRevision);
  if (!request || !isCurrent(context)) return;
  context.lastPreferenceRevision = request.revision;
  void enqueueMutation(async () => {
    if (!isCurrent(context)) return;
    let result;
    try {
      const stagedRandomBatches = new Map(randomBatches);
      result = applyPreferenceOperation(preferences, request.operation, {
        sourceProjectKeys: context.projectKeys ?? [], allProjectKeys: projectKeyUnion(),
        random: Math.random, randomBatches: stagedRandomBatches, now: Date.now(),
      });
      if (JSON.stringify(result.preferences) !== JSON.stringify(preferences)) {
        await store.write(result.preferences);
        preferences = result.preferences;
        randomBatches.clear();
        for (const [batchId, batch] of stagedRandomBatches) randomBatches.set(batchId, batch);
        stateVersion++;
        if (result.randomUndo !== undefined) activeRandomUndo = result.randomUndo;
      }
      await broadcastPreferences(context, request.revision);
    } catch (error) {
      await acknowledgePreferences(context, request.revision, false, error.message);
    }
  });
}
async function acknowledgeUI(context, request, ok, message = '') {
  if (!isCurrent(context)) return;
  try {
    await context.session.evaluate((token, revision, success, reason, settings, version) =>
      window.__codexColorLabelsDemo?.uiSettingsAck(token, revision, success, reason, settings, version),
    context.token, request.revision, ok, message, uiConfig, uiVersion);
  } catch {}
}
async function broadcastUISettings(sourceContext = null, request = null) {
  const contexts = [...pool.windows.values()];
  await boundedMap(contexts, 3, async context => {
    if (!isCurrent(context)) return;
    if (context === sourceContext && request) return acknowledgeUI(context, request, true);
    await context.session.evaluate((token, value, version) =>
      window.__codexColorLabelsDemo?.applySharedUISettings(token, value, version), context.token, uiConfig, uiVersion);
  });
}
function handleUIRequest(context, raw) {
  const request = parseUISettingsRequest(raw, context.token, context.lastUIRevision);
  if (!request || !isCurrent(context)) return;
  context.lastUIRevision = request.revision;
  void enqueueMutation(async () => {
    if (!isCurrent(context)) return;
    try {
      await uiStore.write(request.settings);
      uiConfig = request.settings; uiVersion++;
      if (!uiConfig.showQuota) await quota.disable();
      await broadcastUISettings(context, request);
      if (uiConfig.showQuota) void refreshQuota();
    } catch (error) { await acknowledgeUI(context, request, false, error.message); }
  });
}
function handleBinding(context, message) {
  if (message.method !== 'Runtime.bindingCalled') return;
  const { name, payload } = message.params ?? {};
  if (name === BINDING) return handlePreferenceRequest(context, payload);
  if (name === UI_BINDING) return handleUIRequest(context, payload);
  if (name !== CONTROL) return;
  const command = parseCommand(payload, context.token, context.lastCommandId);
  if (!command || !isCurrent(context)) return;
  context.lastCommandId = command.id;
  void (async () => {
    let ok = true, reason = '';
    try { await store.queue; await revealPreferences(opts.dataDir); }
    catch (error) { ok = false; reason = error.message; }
    if (!isCurrent(context)) return;
    try { await context.session.evaluate((token, id, success, error) => window.__codexColorLabelsDemo?.commandAck(token, id, success, error), context.token, command.id, ok, reason); } catch {}
  })();
}
async function closeWindow(context) {
  context.active = false;
  try {
    await context.session.evaluate(() => {
      window.__codexProjectQuota?.destroy();
      if (window.__codexColorLabelsDemo?.product === 'color-labels.v1') window.__codexColorLabelsDemo.destroy();
      delete window.__codexColorLabelsStopRequested;
    });
    for (const name of [BINDING, CONTROL, UI_BINDING]) await context.session.request('Runtime.removeBinding', { name }).catch(() => {});
  } catch {}
  context.removeListener?.();
  context.session.close();
}
async function openWindow(target) {
  const session = new Session(target.webSocketDebuggerUrl);
  const context = {
    target, session, token: randomUUID(), active: true, lastPreferenceRevision: 0, lastUIRevision: 0,
    lastCommandId: 0, projectKeys: [], rendererStatus: null, lastError: '',
  };
  try {
    await session.connect();
    const hasMainShell = await session.evaluate(adapterSource => {
      const adapter = (0, eval)(`(${adapterSource})`)(document);
      return Boolean(adapter.controlAnchor());
    }, createAdapter.toString());
    if (!hasMainShell) throw new Error('窗口主界面结构未确认，未注入配色功能');
    context.removeListener = session.onEvent(message => handleBinding(context, message));
    await session.request('Runtime.enable');
    for (const name of [BINDING, CONTROL, UI_BINDING]) await session.request('Runtime.addBinding', { name });
    const options = {
      product: PRODUCT, storageKey: STORAGE, initialPreferences: preferences, stateVersion,
      persistenceBinding: BINDING, controlBinding: CONTROL, sessionToken: context.token,
      uiSettings: uiConfig, uiSettingsVersion: uiVersion, uiPersistenceBinding: UI_BINDING,
    };
    await session.expression(`(${installRenderer.toString()})(${createAdapter.toString()},${createPreferences.toString()},${JSON.stringify(options)})`);
    await session.expression(`(${installQuotaRenderer.toString()})(${createAdapter.toString()},${quotaPresentation.toString()},${JSON.stringify(quota.value ?? { windows: [], cards: { count: null, details: null }, updatedAt: null, stale: true, error: '正在读取额度…' })},${JSON.stringify({ visible: uiConfig.showQuota })})`);
    const state = await session.evaluate(() => {
      const api = window.__codexColorLabelsDemo;
      return api?.product === 'color-labels.v1' ? { status: api.status(), projectKeys: api.getProjectKeys() } : null;
    });
    if (!state) throw new Error('窗口没有返回可用状态');
    context.rendererStatus = state.status; context.projectKeys = state.projectKeys ?? [];
    return context;
  } catch (error) { await closeWindow(context); throw error; }
}
pool = new WindowPool({ open: openWindow, close: closeWindow, concurrency: 3 });
async function loadPreferencesFromTarget(target) {
  const session = new Session(target.webSocketDebuggerUrl);
  try {
    await session.connect();
    const raw = await session.evaluate((current, legacy) => {
      const value = localStorage.getItem(current) ?? localStorage.getItem(legacy);
      return value === null ? null : JSON.parse(value);
    }, STORAGE, 'codex-color-labels.demo.v1');
    return preferenceModel.validate(raw ?? preferenceModel.empty());
  } finally { session.close(); }
}
async function prepareApplication(identity, targets) {
  if (applicationIdentity !== identity) {
    await pool.closeAll();
    await quota.setIdentity(identity);
    applicationIdentity = identity; preferences = null; stateVersion = 0;
  }
  if (preferences) return;
  await store.queue.catch(() => {});
  preferences = await store.read();
  if (!preferences) {
    let initial, lastError;
    for (const target of targets) {
      try { initial = await loadPreferencesFromTarget(target); break; } catch (error) { lastError = error; }
    }
    if (!initial) throw lastError ?? new Error('找不到可迁移的配色记录');
    preferences = await store.write(initial); stateVersion = 1;
  }
  uiConfig = await uiStore.read();
  const before = JSON.stringify(preferences);
  preferences = await preferencesForSession(store, opts.runtime, identity);
  if (JSON.stringify(preferences) !== before) stateVersion++;
}
async function refreshQuota() {
  if (stopping) return;
  const value = await quota.refresh({ enabled: uiConfig.showQuota, hasWindows: pool.windows.size > 0 });
  if (!value || !uiConfig.showQuota) return;
  const contexts = [...pool.windows.values()];
  await boundedMap(contexts, 3, context => isCurrent(context)
    ? context.session.evaluate(payload => window.__codexProjectQuota?.update(payload), value)
    : Promise.resolve());
}
async function heartbeatWindow(context) {
  if (!isCurrent(context)) return null;
  const state = await context.session.evaluate(() => {
    window.__codexProjectQuota?.heartbeat();
    if (window.__codexColorLabelsStopRequested) return { stop: true };
    const api = window.__codexColorLabelsDemo;
    return api?.product === 'color-labels.v1' ? { status: api.heartbeat(), projectKeys: api.getProjectKeys() } : null;
  });
  if (state?.stop) { stopping = true; return state; }
  if (!state) return null;
  context.rendererStatus = state.status; context.projectKeys = state.projectKeys ?? [];
  return state;
}
async function establishFirstPalette() {
  const context = [...pool.windows.values()].find(entry => entry.rendererStatus?.connected && entry.rendererStatus?.ready);
  if (!context) return;
  const keys = projectKeyUnion();
  if (!keys.length) return;
  await firstPalette.apply(context.session, keys);
}
async function publishAggregate() {
  const contexts = [...pool.windows.values()];
  const ready = contexts.filter(context => context.rendererStatus?.connected && context.rendererStatus?.ready);
  const keys = projectKeyUnion();
  const renderer = {
    version: 1, connected: ready.length > 0, ready: ready.length > 0,
    paused: preferences?.paused ?? false, showQuota: uiConfig.showQuota,
    saving: false, error: contexts.find(context => context.rendererStatus?.error)?.rendererStatus?.error ?? '',
    projectCount: keys.length, coloredCount: keys.filter(key => preferences?.projects[key]).length,
    refreshCount: contexts.reduce((sum, context) => sum + (context.rendererStatus?.refreshCount ?? 0), 0),
    windowCount: contexts.length, connectedWindowCount: ready.length,
    pendingWindowCount: Math.max(0, lastTargetCount - ready.length), destroyed: false,
  };
  let status, detail;
  if (ready.length) {
    status = renderer.pendingWindowCount ? '部分窗口待适配或重连' : '已连接';
    detail = `已连接 ${ready.length} 个窗口${renderer.pendingWindowCount ? `，${renderer.pendingWindowCount} 个窗口待适配或重连` : ''}。配色和额度设置已同步。`;
    if (renderer.error) detail = `已连接 ${ready.length} 个窗口；部分窗口有待处理状态。`;
  } else if (discoveryError) {
    status = '等待应用启动'; detail = '正在等待官方应用的本机连接，已保存的配色保留。';
  } else if (lastTargetCount) {
    status = '当前界面需要适配'; detail = '发现了应用窗口，但当前界面暂不支持；其他功能不会被修改。';
  } else {
    status = '等待应用启动'; detail = '自动接入已就绪，等待官方应用主窗口。';
  }
  await publish(status, detail, renderer);
}
async function scanOnce() {
  let targets, identity;
  try {
    targets = await discoverAll(opts.port, opts.targetURL);
    identity = await browserIdentity(opts.port);
    discoveryError = '';
  } catch (error) {
    discoveryError = error.cause?.code === 'ECONNREFUSED' ? '接口不可用' : '暂时无法枚举';
    const contexts = [...pool.windows.values()];
    const results = await boundedMap(contexts, 3, heartbeatWindow);
    for (let i = 0; i < results.length; i++) if (results[i]?.status === 'rejected' || results[i]?.value === null) await pool.remove(contexts[i].target.id);
    await publishAggregate();
    if (!process.argv.includes('--passive') && pool.windows.size === 0) throw error;
    return;
  }
  lastTargetCount = targets.length;
  await prepareApplication(identity, targets);
  const summary = await pool.reconcile(targets);
  const contexts = [...pool.windows.values()];
  const results = await boundedMap(contexts, 3, heartbeatWindow);
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result?.status === 'rejected' || result?.value === null) await pool.remove(contexts[i].target.id);
  }
  if (summary.failed) discoveryError = '部分窗口连接失败';
  else discoveryError = '';
  if (!uiConfig.showQuota) await quota.disable();
  else if (pool.windows.size) void refreshQuota();
  await establishFirstPalette();
  await publishAggregate();
}
async function launchIfNeeded(error) {
  const occupied = await new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port: opts.port });
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(1500);
    socket.once('connect', () => done(true)); socket.once('timeout', () => done(true)); socket.once('error', e => done(e.code !== 'ECONNREFUSED'));
  });
  if (occupied) throw error;
  await ensureApplication(opts.appPath, opts.port, { entryLabel: '颜色标签管理窗口的“开启配色 / 重新连接”按钮', configurationHint: '配色文件夹中的 settings.json' });
  for (let i = 0; i < 30; i++) {
    await scanOnce();
    if (pool.windows.size) return;
    await delay(500);
  }
  throw new Error('没有发现受支持的官方应用主窗口');
}

await fs.mkdir(opts.runtime, { recursive: true });
if (await acquire()) {
  process.on('SIGTERM', () => { stopping = true; }); process.on('SIGINT', () => { stopping = true; });
  try {
    await store.read(); await publish('等待应用启动', '正在检查本机官方应用窗口');
    try { await scanOnce(); }
    catch (error) {
      if (process.argv.includes('--passive')) await publish('等待应用启动', '自动接入已就绪；等待官方应用主窗口，配色已保留。');
      else await launchIfNeeded(error);
    }
    while (!stopping) {
      if (await fs.access(stopFile).then(() => true).catch(() => false)) break;
      try { await scanOnce(); }
      catch (error) {
        discoveryError = error.cause?.code === 'ECONNREFUSED' ? '接口不可用' : '暂时无法枚举';
        await publishAggregate();
      }
      await delay(2000);
    }
  } catch (error) { fatal = error.message; process.exitCode = 1; }
  finally {
    stopping = true;
    await pool.closeAll();
    await quota.stop();
    await mutationQueue.catch(() => {});
    await store.queue.catch(() => {});
    await uiStore.queue.catch(() => {});
    await publish(fatal ? '未连接' : '已停止', fatal || '已停止所有窗口接入，配色保留。');
    if (ownsLock) { await fs.rm(lock, { recursive: true, force: true }); await fs.rm(stopFile, { force: true }); }
    process.exit(process.exitCode ?? 0);
  }
}
