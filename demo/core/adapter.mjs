export function createAdapter(doc) {
  const selectors = {
    project: '[data-app-action-sidebar-project-row][data-app-action-sidebar-project-id]',
    thread: '[data-app-action-sidebar-thread-row][data-app-action-sidebar-thread-id]',
    group: '[data-sidebar-project-container-id]',
    recentSection: 'section[data-app-action-sidebar-section-heading="Recents"]',
    recentRow: '[role="button"][data-sidebar-cycle-item]',
  };
  function isRendered(element) {
    try {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      for (let parent = element; parent; parent = parent.parentElement) {
        if (parent.getAttribute?.('aria-hidden') === 'true') return false;
        const style = doc.defaultView?.getComputedStyle?.(parent);
        if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || Number(style?.opacity) === 0) return false;
      }
      return true;
    } catch { return false; }
  }
  function inventory() {
    const rows = [...doc.querySelectorAll(selectors.project)].filter(isRendered);
    const counts = new Map();
    for (const row of rows) {
      const id = row.getAttribute('data-app-action-sidebar-project-id');
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const projects = [], unsupported = [];
    for (const row of rows) {
      const id = row.getAttribute('data-app-action-sidebar-project-id');
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id) || counts.get(id) !== 1) { unsupported.push(row); continue; }
      const candidates = [];
      for (let group = row.parentElement; group; group = group.parentElement) {
        if (group.getAttribute('data-sidebar-project-container-id') === `project:${id}` &&
            group.getAttribute('data-sidebar-project-kind') === 'local' &&
            isRendered(group) && [...group.querySelectorAll(selectors.project)].filter(isRendered).length === 1) candidates.push(group);
      }
      if (candidates.length !== 1) { unsupported.push(row); continue; }
      const group = candidates[0];
      const icons = [...row.querySelectorAll('.icon-leading-slot [data-sidebar-project-drop-zone="project-icon"] svg')].filter(icon => {
        const rect = icon.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
        .filter(icon => icon.closest(selectors.group)?.getAttribute('data-sidebar-project-container-id') === `project:${id}` &&
          icon.closest(selectors.group)?.getAttribute('data-sidebar-project-kind') === 'local');
      const trigger = row.querySelector('button[aria-haspopup="menu"][id]');
      if (icons.length !== 1 || !trigger) { unsupported.push(row); continue; }
      const threads = [...group.querySelectorAll(selectors.thread)].filter(thread => {
        const titles = thread.querySelectorAll('[data-thread-title="true"]');
        const titleTrigger = thread.querySelector('[data-thread-title-trigger="true"]');
        return isRendered(thread) && thread.closest(selectors.group) === group &&
          thread.getAttribute('data-app-action-sidebar-thread-kind') === 'local' &&
          thread.getAttribute('data-app-action-sidebar-thread-host-id') === 'local' &&
          thread.getAttribute('data-app-action-sidebar-thread-pinned') !== 'true' &&
          Boolean(thread.getAttribute('data-app-action-sidebar-thread-id')) &&
          titles.length === 1 && titleTrigger?.contains(titles[0]);
      });
      projects.push({ id, key: `local:${id}`, label: row.getAttribute('data-app-action-sidebar-project-label') ?? '项目', row, group, icon: icons[0], trigger, threads });
    }
    return { projects, ready: projects.length > 0, partial: unsupported.length > 0, projectRows: rows.length };
  }
  function menuOwner(menu, projects) {
    if (!menu) return null;
    const labelledBy = menu.getAttribute('aria-labelledby');
    const matches = projects.filter(project => project.trigger.id === labelledBy && project.trigger.getAttribute('aria-expanded') === 'true');
    return matches.length === 1 ? matches[0] : null;
  }
  function controlAnchor() {
    const rails = [...doc.querySelectorAll('[data-app-navigation-rail="true"]')];
    if (rails.length !== 1) return null;
    const rail = rails[0];
    const profiles = [...rail.querySelectorAll('button[aria-haspopup="menu"]')].filter(button =>
      ['打开个人资料菜单', 'Open profile menu', 'Open user menu'].includes(button.getAttribute('aria-label')));
    if (profiles.length !== 1) return null;
    let footer = profiles[0];
    while (footer.parentElement && footer.parentElement !== rail) footer = footer.parentElement;
    return footer.parentElement === rail ? { rail, footer, profile: profiles[0] } : null;
  }
  function recentRows() {
    const sections = [...doc.querySelectorAll(selectors.recentSection)].filter(isRendered);
    if (sections.length !== 1) return [];
    return [...sections[0].querySelectorAll(selectors.recentRow)]
      .filter(row => isRendered(row) && !row.closest(selectors.thread) && row.querySelector('[data-thread-title-trigger="true"]'));
  }
  function conversationIdentity(row) {
    for (let element = row, depth = 0; element && depth < 14; element = element.parentElement, depth++) {
      let keys;
      try { keys = Object.getOwnPropertyNames(element); } catch { continue; }
      for (const key of keys) {
        if (!/^__(?:reactFiber|reactProps)\$/.test(key)) continue;
        let fiber;
        try { fiber = element[key]; } catch { continue; }
        for (let step = 0; fiber && step < 12; step++, fiber = fiber.return) {
          try {
            const props = fiber.memoizedProps ?? fiber.pendingProps ?? (key.startsWith('__reactProps$') ? fiber : null);
            const conversationId = props?.conversationId;
            const conversation = props?.conversation;
            if (typeof conversationId === 'string' && conversationId.length > 0 && conversation && typeof conversation === 'object') {
              let chatgptSidebar = false;
              // In the current client, server-backed ChatGPT sidebar rows pass
              // through the `tnr` renderer. Require that renderer's own
              // conversation ID and complete ordinary-Chat metadata; if this
              // internal component shape changes, this evidence fails closed.
              for (let sourceFiber = fiber, sourceDepth = 0; sourceFiber && sourceDepth < 24; sourceFiber = sourceFiber.return, sourceDepth++) {
                try {
                  const sourceName = typeof sourceFiber.type === 'function'
                    ? sourceFiber.type.displayName || sourceFiber.type.name
                    : '';
                  if (sourceName !== 'tnr') continue;
                  const sourceProps = sourceFiber.memoizedProps ?? sourceFiber.pendingProps;
                  const sourceConversation = sourceProps?.conversation;
                  chatgptSidebar = sourceProps?.variant === 'sidebar' &&
                    sourceConversation?.id === conversationId &&
                    sourceConversation.conversation_origin === null &&
                    sourceConversation.trial_conversation_type === null &&
                    sourceConversation.is_temporary_chat === false &&
                    sourceConversation.is_automation_conversation === false;
                  if (chatgptSidebar) break;
                } catch { /* An inaccessible React node is not source evidence. */ }
              }
              return {
                conversationId,
                trialConversationType: conversation.trial_conversation_type,
                conversationOrigin: conversation.conversation_origin,
                temporary: conversation.is_temporary_chat,
                automation: conversation.is_automation_conversation,
                chatgptSidebar,
              };
            }
          } catch { /* Unknown client props must not interrupt the existing renderer. */ }
        }
      }
    }
    return null;
  }
  function classifyRecentRows(rows, catalogEntries) {
    if (!Array.isArray(rows) || !Array.isArray(catalogEntries)) return [];
    const byId = new Map(), duplicates = new Set();
    for (const entry of catalogEntries) {
      const id = entry?.threadId;
      if (typeof id !== 'string' || id.length === 0) continue;
      if (byId.has(id)) duplicates.add(id);
      else byId.set(id, entry);
    }
    const result = [];
    for (const record of rows) {
      const id = record?.conversationId;
      if (typeof id !== 'string' || duplicates.has(id)) continue;
      const entry = byId.get(id);
      if (entry?.sourceKind === 'vscode') {
        result.push({ row: record.row, type: 'work' });
        continue;
      }
      const verifiedChatSource = entry?.sourceKind === 'chatgpt' || (!entry && record.chatgptSidebar === true);
      if (verifiedChatSource && record.trialConversationType === null &&
          record.conversationOrigin === null && record.temporary === false && record.automation === false) {
        result.push({ row: record.row, type: 'chat' });
      }
    }
    return result;
  }
  function recentConversationRecords() {
    return recentRows().map(row => {
      const identity = conversationIdentity(row);
      return identity ? { row, ...identity } : { row };
    });
  }
  function findRecentCatalogPager(records) {
    const row = records.find(record => typeof record?.conversationId === 'string' && record.row)?.row;
    for (let element = row, depth = 0; element && depth < 14; element = element.parentElement, depth++) {
      let keys;
      try { keys = Object.getOwnPropertyNames(element); } catch { continue; }
      for (const key of keys) {
        if (!key.startsWith('__reactFiber$')) continue;
        let fiber;
        try { fiber = element[key]; } catch { continue; }
        for (let step = 0; fiber && step < 140; step++, fiber = fiber.return) {
          for (let hook = fiber.memoizedState, count = 0; hook && count < 180; hook = hook.next, count++) {
            try {
              const service = hook.memoizedState;
              if (service && Array.isArray(service.hostIds) &&
                  typeof service.readEntries === 'function' && typeof service.getPageState === 'function' &&
                  typeof service.ensurePage === 'function' && typeof service.loadMore === 'function') return service;
            } catch { /* Unknown client hooks are ignored. */ }
          }
        }
      }
    }
    return null;
  }
  async function readRecentCatalogEntries(records) {
    const ids = [...new Set((Array.isArray(records) ? records : [])
      .map(record => record?.conversationId)
      .filter(id => typeof id === 'string' && id.length > 0))];
    if (ids.length === 0) return null;
    const pager = findRecentCatalogPager(records);
    if (!pager || !Array.isArray(pager.hostIds) || pager.hostIds.length === 0 || pager.hostIds.length > 8) return null;
    const hostIds = pager.hostIds.filter(hostId => typeof hostId === 'string' && hostId.length > 0 && hostId.length <= 256);
    if (hostIds.length === 0) return null;
    const result = [];
    let readSucceeded = false;
    for (const hostId of hostIds) {
      for (let offset = 0; offset < ids.length; offset += 100) {
        const batch = ids.slice(offset, offset + 100);
        const batchIds = new Set(batch);
        let entries;
        try {
          entries = await pager.readEntries(batch.map(threadId => ({ hostId, threadId })));
          readSucceeded = true;
        } catch { continue; }
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          if (typeof entry?.threadId !== 'string' || !batchIds.has(entry.threadId)) continue;
          result.push({
            threadId: entry.threadId,
            sourceKind: entry.sourceKind === 'chatgpt' || entry.sourceKind === 'vscode' ? entry.sourceKind : null,
          });
        }
      }
    }
    return readSucceeded ? result : null;
  }
  return { selectors, inventory, menuOwner, controlAnchor, recentRows, conversationIdentity, classifyRecentRows, recentConversationRecords, readRecentCatalogEntries };
}
