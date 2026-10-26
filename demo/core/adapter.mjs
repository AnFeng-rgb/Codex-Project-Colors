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
              return {
                conversationId,
                trialConversationType: conversation.trial_conversation_type,
                conversationOrigin: conversation.conversation_origin,
                temporary: conversation.is_temporary_chat,
                automation: conversation.is_automation_conversation,
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
      if (!entry) continue;
      if (entry.sourceKind === 'chatgpt' && record.trialConversationType === null &&
          record.conversationOrigin === null && record.temporary === false && record.automation === false) {
        result.push({ row: record.row, type: 'chat' });
      } else if (entry.sourceKind === 'vscode') {
        result.push({ row: record.row, type: 'work' });
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
  return { selectors, inventory, menuOwner, controlAnchor, recentRows, conversationIdentity, classifyRecentRows, recentConversationRecords };
}
