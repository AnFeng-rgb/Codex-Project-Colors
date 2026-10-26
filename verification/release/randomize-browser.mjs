import fs from 'node:fs/promises';
import { discoverAll, Session } from '../../demo/core/cdp.mjs';
import { createAdapter } from '../../demo/core/adapter.mjs';
import { createPreferences } from '../../demo/core/preferences.mjs';
import { installRenderer } from '../../demo/core/renderer.mjs';
import { applyPreferenceOperation } from '../../src/shared-state.mjs';

const session = new Session((await discoverAll(39222, 'app://-/index.html'))[0].webSocketDebuggerUrl);
await session.connect();
try {
  const run = async (adapter, preferences, install, applyOperation) => {
    const iframe = document.createElement('iframe'); iframe.style.cssText = 'position:fixed;left:-10000px;width:800px;height:600px'; document.body.append(iframe);
    const win = iframe.contentWindow, doc = win.document, checks = [], payloads = [], cache = new Map();
    const check = (name, ok, detail = '') => { checks.push({ name, passed: !!ok, ...(detail ? { detail } : {}) }); if (!ok) throw Error(name + (detail ? `: ${detail}` : '')); };
    Object.defineProperty(win, 'localStorage', { value: { getItem: key => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value), removeItem: key => cache.delete(key) } });
    win.Math.random = () => 0;
    win.saveFixture = raw => payloads.push(JSON.parse(raw));
    const originalTimeout = win.setTimeout.bind(win); let expireUndo;
    win.setTimeout = (callback, ms, ...args) => { if (ms === 30000) expireUndo = callback; return originalTimeout(callback, ms, ...args); };
    const nav = doc.createElement('nav'); nav.setAttribute('data-app-navigation-rail', 'true'); nav.innerHTML = '<div>导航</div><div><button aria-haspopup="menu" aria-label="打开个人资料菜单">我的</button></div>'; doc.body.append(nav);
    const group = (id, kind = 'local') => {
      const element = doc.createElement('div'); element.setAttribute('data-sidebar-project-container-id', `project:${id}`); element.setAttribute('data-sidebar-project-kind', kind);
      element.innerHTML = `<div data-app-action-sidebar-project-row data-app-action-sidebar-project-id="${id}"><span class="icon-leading-slot"><span data-sidebar-project-drop-zone="project-icon" data-sidebar-project-kind="${kind}" data-sidebar-project-container-id="project:${id}"><svg></svg></span></span><button id="menu-${id}" aria-haspopup="menu"></button></div><div data-app-action-sidebar-thread-row data-app-action-sidebar-thread-id="thread-${id}" data-app-action-sidebar-thread-kind="local" data-app-action-sidebar-thread-host-id="local" data-app-action-sidebar-thread-pinned="false"><span data-thread-title-trigger="true"><span data-thread-title="true">对话</span></span></div>`;
      doc.body.append(element); return element;
    };
    const groups = Array.from({ length: 14 }, (_, i) => group(`p${i}`)), remote = group('remote', 'remote');
    const initial = { version: 1, paused: false, projects: { 'local:absent': 'purple', 'local:p0': '#123abc', 'local:p1': 'green' } };
    let canonical = initial, stateVersion = 0, randomBatches = new Map(), randomUndo = null, api, applyFailure = '';
    const applyLatest = (success = true, reason = '模拟磁盘写入失败') => {
      const payload = payloads.at(-1), keys = api.getProjectKeys();
      if (success) {
        try {
          const result = applyOperation(canonical, payload.operation, { sourceProjectKeys: keys, allProjectKeys: keys, random: () => 0, randomBatches, now: Date.now(), model: preferences(null) });
          canonical = result.preferences; stateVersion++;
          if (result.randomUndo !== undefined) randomUndo = result.randomUndo;
        } catch (error) { success = false; reason = error.message; applyFailure = reason; }
      }
      api.persistenceAck(payload.token, payload.revision, success, success ? '' : reason, canonical, stateVersion, randomUndo);
      return success;
    };
    try {
      install(adapter, preferences, { product: 'color-labels.v1', storageKey: 'random-fixture', initialPreferences: initial, persistenceBinding: 'saveFixture', sessionToken: 'random-token' }, win);
      api = win.__codexColorLabelsDemo;
      const button = doc.querySelector('[data-ccld-action="randomize"]'), undo = doc.querySelector('[data-ccld-action="undo-randomize"]');
      check('弹窗存在可操作的全部项目随机配色按钮', button?.textContent === '全部项目随机配色' && !button.disabled);
      button.click();
      check('等待后台确认时只提交操作、不覆盖整份配置', payloads.length === 1 && payloads[0].operation.type === 'randomize' && api.status().saving && button.disabled);
      button.click(); check('保存未确认时不重复随机请求', payloads.length === 1);
      applyLatest();
      const first = api.getPreferences(), assignment = groups.map((_, i) => first.projects[`local:p${i}`]);
      check('后台按所有可见本地项目分配颜色，保留未挂载配色', assignment.every(color => preferences(null).colors.includes(color)) && Object.keys(first.projects).length === 15 && first.projects['local:absent'] === 'purple', JSON.stringify({ discovered: api.getProjectKeys().length, colored: assignment.filter(Boolean).length, totalSaved: Object.keys(first.projects).length, preservedDetached: first.projects['local:absent'] === 'purple', fixedPalette: preferences(null).colors.length, applyFailure }));
      const counts = preferences(null).colors.map(color => assignment.filter(value => value === color).length);
      check('六色分布均衡且相邻项目不重复', Math.max(...counts) - Math.min(...counts) <= 1 && assignment.every((color, i) => i === 0 || color !== assignment[i - 1]));
      check('远程项目不赋色且项目对话跟随项目颜色', !first.projects['local:remote'] && !remote.querySelector('[data-ccld-color]') && groups.every((element, i) => element.querySelector('[data-app-action-sidebar-thread-row]').getAttribute('data-ccld-color') === assignment[i]));
      undo.click(); check('撤销请求等待后台确认', api.status().saving && payloads.at(-1).operation.type === 'undo-randomize'); applyLatest();
      check('撤销恢复原自选色、无配色项目和未挂载项目', JSON.stringify(api.getPreferences().projects) === JSON.stringify(initial.projects) && undo.parentElement.hidden);

      button.click(); applyLatest(); const beforeSecond = api.getPreferences();
      button.click(); applyLatest(); const second = api.getPreferences();
      check('重复随机即使随机源相同也产生不同配色', JSON.stringify(second.projects) !== JSON.stringify(beforeSecond.projects));
      undo.click(); applyLatest(); check('撤销只还原最近一批', JSON.stringify(api.getPreferences().projects) === JSON.stringify(beforeSecond.projects));

      api.pause(); applyLatest(); const pausedBefore = api.getPreferences();
      button.click(); check('随机保存期间撤销按钮禁用', undo.disabled); applyLatest(); undo.click(); applyLatest();
      check('暂停状态下随机和撤销保留暂停且不绘制项目颜色', api.status().paused && JSON.stringify(api.getPreferences().projects) === JSON.stringify(pausedBefore.projects) && !doc.querySelector('[data-ccld-color]'));
      api.resume(); applyLatest();

      button.click(); applyLatest(); api.setColor('local:p0', 'blue'); applyLatest();
      check('改色后保留随机撤销入口供后台检查冲突', !undo.parentElement.hidden);
      undo.click(); check('冲突撤销不乐观覆盖后续改色', applyLatest() === false && api.getPreferences().projects['local:p0'] === 'blue' && api.status().error.includes('已被改动'));

      button.click(); applyLatest(); const expired = api.getPreferences(); expireUndo();
      check('撤销提示到期后移除，颜色保留', undo.parentElement.hidden && !api.undoRandomize() && JSON.stringify(expired) === JSON.stringify(api.getPreferences()));
      button.click(); const beforeFailure = api.getPreferences(); applyLatest(false);
      check('磁盘保存失败恢复为后台确认状态并说明原因', api.status().error.includes('模拟磁盘写入失败') && JSON.stringify(api.getPreferences()) === JSON.stringify(beforeFailure));
      api.destroy(); groups.slice(1).forEach(element => element.remove()); remote.remove();

      const singleInitial = { version: 1, paused: false, projects: {} };
      canonical = singleInitial; stateVersion = 0; randomBatches = new Map(); randomUndo = null;
      install(adapter, preferences, { product: 'color-labels.v1', storageKey: 'single-fixture', initialPreferences: singleInitial, persistenceBinding: 'saveFixture', sessionToken: 'single-token' }, win);
      api = win.__codexColorLabelsDemo; api.randomizeColors(); applyLatest(); const old = api.getPreferences().projects['local:p0'];
      api.randomizeColors(); applyLatest();
      check('仅一个项目时再次点击也会换色', api.getPreferences().projects['local:p0'] !== old);
      api.destroy(); check('清理不残留界面或颜色标记', !doc.querySelector('[data-ccld-owner],[data-ccld-color],#ccld-style'));
      return { passed: true, checks, scope: '受控浏览器中的 14 个本地项目和 1 个远程项目，模拟后台操作确认，不接触用户配色' };
    } catch (error) { return { passed: false, error: error.message, checks }; }
    finally { win.__codexColorLabelsDemo?.destroy(); iframe.remove(); }
  };
  const report = await session.expression(`(${run.toString()})(${createAdapter.toString()},${createPreferences.toString()},${installRenderer.toString()},${applyPreferenceOperation.toString()})`);
  await fs.writeFile(new URL('./randomize-browser.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 1;
} finally { session.close(); }
