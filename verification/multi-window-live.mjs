import fs from 'node:fs/promises';
import path from 'node:path';
import { discoverAll, Session } from '../demo/core/cdp.mjs';
import { createAdapter } from '../demo/core/adapter.mjs';
import { assessChatMarkerLive } from './chat-marker-acceptance.mjs';

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
      let unknownRows = 0;
      const bridge = window.electronBridge;
      const adapter = (0, eval)(`(${adapterFactorySource})`)(document);
      const records = adapter.recentConversationRecords();
      let entries = [];
      if (typeof bridge?.getInitialSidebarBootstrap === 'function') {
        try {
          const catalog = await bridge.getInitialSidebarBootstrap();
          entries = Array.isArray(catalog?.catalogEntries) ? catalog.catalogEntries : [];
        } catch {}
      }
      try {
        const pointEntries = await adapter.readRecentCatalogEntries(records);
        entries = adapter.mergeRecentCatalogEntries(entries, pointEntries);
      } catch {}
      const classified = adapter.classifyRecentRows(records, entries);
      chatRows = classified.filter(item => item.type === 'chat').length;
      workRows = classified.filter(item => item.type === 'work').length;
      unknownRows = records.length - chatRows - workRows;
      const markers = [...document.querySelectorAll('[data-ccld-chat-marker="true"]')];
      const expectedChatMarkers = new Set(classified.filter(item => item.type === 'chat')
        .map(item => item.row.querySelector('[data-thread-title-trigger="true"]')).filter(Boolean));
      const chatMarkersMatchRows = markers.length === expectedChatMarkers.size && markers.every(node => expectedChatMarkers.has(node));
      const localWorkRows = [...document.querySelectorAll('[data-app-action-sidebar-thread-row][data-app-action-sidebar-thread-host-id="local"]')];
      const workRowsMarked = localWorkRows.filter(row => row.hasAttribute('data-ccld-chat-marker') || row.querySelector('[data-ccld-chat-marker="true"]')).length;
      const chatMarkersVisible = markers.every(node => {
        const style = getComputedStyle(node, '::before');
        return style.content !== 'none' && style.width === '4px' && style.height === '12px' &&
          style.borderRadius !== '0px' && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
      });
      return {
        connected: state.connected === true, ready: state.ready === true, paused: state.paused === true,
        showQuota: state.showQuota === true, projectCount: projectKeys.length,
        coloredCount: projectKeys.filter(key => preferenceMap[key]).length,
        controlsInSharedCard, cardAboveProfile, cardVisible,
        chatMarkers: markers.length, chatMarkersVisible, chatMarkersMatchRows,
        localWorkRows: localWorkRows.length, workRowsMarked,
        chatRows, workRows, unknownRows, quotaMounted: quota?.status().mounted === true,
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
  ...assessChatMarkerLive(results, maps),
  mainWindowCount: targets.length,
  distinctWindowIdentities: new Set(targets.map(target => target.id)).size === targets.length,
  sharedColorMaps: maps.every(value => value === maps[0]),
  windows,
  scope: '仅读取官方主窗口内的插件状态、项目键计数和会话类型计数；不读取标题或正文，不写配色。',
};
const reportPath = process.argv[2] ? path.resolve(process.argv[2]) : new URL('./multi-window-live.json', import.meta.url);
await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
