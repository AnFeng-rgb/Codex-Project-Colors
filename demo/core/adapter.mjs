export function createAdapter(doc) {
  const selectors = {
    project: '[data-app-action-sidebar-project-row][data-app-action-sidebar-project-id]',
    thread: '[data-app-action-sidebar-thread-row][data-app-action-sidebar-thread-id]',
    group: '[data-sidebar-project-container-id]',
  };
  function inventory() {
    const rows = [...doc.querySelectorAll(selectors.project)];
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
            group.querySelectorAll(selectors.project).length === 1) candidates.push(group);
      }
      if (candidates.length !== 1) { unsupported.push(row); continue; }
      const group = candidates[0];
      const icons = [...row.querySelectorAll('.icon-leading-slot [data-sidebar-project-drop-zone="project-icon"] svg')]
        .filter(icon => icon.closest(selectors.group)?.getAttribute('data-sidebar-project-container-id') === `project:${id}` &&
          icon.closest(selectors.group)?.getAttribute('data-sidebar-project-kind') === 'local');
      const trigger = row.querySelector('button[aria-haspopup="menu"][id]');
      if (icons.length !== 1 || !trigger) { unsupported.push(row); continue; }
      const threads = [...group.querySelectorAll(selectors.thread)].filter(thread => {
        const titles = thread.querySelectorAll('[data-thread-title="true"]');
        const titleTrigger = thread.querySelector('[data-thread-title-trigger="true"]');
        return thread.closest(selectors.group) === group &&
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
  return { selectors, inventory, menuOwner, controlAnchor };
}
