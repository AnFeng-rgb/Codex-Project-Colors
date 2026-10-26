import fs from 'node:fs/promises';
import { discoverAll, Session } from '../demo/core/cdp.mjs';
import { createAdapter } from '../demo/core/adapter.mjs';

const targets = await discoverAll(39222, 'app://-/index.html');
const results = [];
for (const target of targets) {
  const session = new Session(target.webSocketDebuggerUrl);
  try {
    await session.connect();
    results.push(await session.evaluate(async adapterFactorySource => {
      const api = window.__codexColorLabelsDemo;
      const quota = window.__codexProjectQuota;
      if (!api || api.product !== 'color-labels.v1') return { connected: false, ready: false, quotaMounted: Boolean(quota?.status().mounted) };
      const state = api.status(), preferenceMap = api.getPreferences().projects;
      const projectKeys = api.getProjectKeys();
      const anchor = (0, eval)(`(${adapterFactorySource})`)(document).controlAnchor();
      const colorControl = document.querySelector('[data-ccld-owner="sidebar-control"]');
      const quotaButton = document.querySelector('#cclq-trigger');
      const card = colorControl?.parentElement;
      const cardRect = card?.getBoundingClientRect();
      const controlsInSharedCard = Boolean(card && card.contains(colorControl) && quotaButton && card.contains(quotaButton));
      const cardAboveProfile = Boolean(anchor && card?.parentElement === anchor.rail && card.nextElementSibling === anchor.footer);
      const cardVisible = Boolean(cardRect?.width > 0 && cardRect?.height > 0);
      let chatRows = 0, workRows = 0;
      const bridge = window.electronBridge;
      if (typeof bridge?.getInitialSidebarBootstrap === 'function') {
        try {
          const catalog = await bridge.getInitialSidebarBootstrap();
          const entries = Array.isArray(catalog?.catalogEntries) ? catalog.catalogEntries : [];
          const adapter = (0, eval)(`(${adapterFactorySource})`)(document);
          const classified = adapter.classifyRecentRows(adapter.recentConversationRecords(), entries);
          chatRows = classified.filter(item => item.type === 'chat').length;
          workRows = classified.filter(item => item.type === 'work').length;
        } catch {}
      }
      const dots = [...document.querySelectorAll('[data-ccld-chat-dot="true"]')];
      const chatDotsVisible = dots.every(node => {
        const style = getComputedStyle(node, '::before');
        return style.content !== 'none' && style.width === '5px' && style.height === '5px' &&
          style.borderRadius === '50%' && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
      });
      return {
        connected: state.connected === true, ready: state.ready === true, paused: state.paused === true,
        showQuota: state.showQuota === true, projectCount: projectKeys.length,
        coloredCount: projectKeys.filter(key => preferenceMap[key]).length,
        controlsInSharedCard, cardAboveProfile, cardVisible,
        chatDots: dots.length, chatDotsVisible,
        chatRows, workRows, quotaMounted: quota?.status().mounted === true,
        quotaVisible: quota?.status().visible === true,
        quotaVisibilityMatchesSetting: quota?.status().visible === state.showQuota,
        // Keep project keys only in this process long enough to compare windows;
        // never write them to the verification report.
        _colors: preferenceMap,
      };
    }, createAdapter.toString()));
  } finally { session.close(); }
}
const maps = results.map(result => JSON.stringify(result._colors ?? {}));
const windows = results.map(({ _colors, ...summary }) => summary);
const report = {
  passed: results.length >= 2 && results.every(result => result.connected && result.ready && result.quotaMounted && result.quotaVisibilityMatchesSetting && result.controlsInSharedCard && result.cardAboveProfile && result.cardVisible && result.chatDotsVisible && result.chatDots === result.chatRows) && maps.every(value => value === maps[0]),
  mainWindowCount: targets.length,
  distinctWindowIdentities: new Set(targets.map(target => target.id)).size === targets.length,
  sharedColorMaps: maps.every(value => value === maps[0]),
  windows,
  scope: '仅读取官方主窗口内的插件状态、项目键计数和会话类型计数；不读取标题或正文，不写配色。',
};
await fs.writeFile(new URL('./multi-window-live.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
