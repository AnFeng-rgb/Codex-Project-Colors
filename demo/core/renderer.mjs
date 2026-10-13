export function installRenderer(createAdapter, createPreferences, options = {}, environment = globalThis) {
  const window = environment;
  const { document, localStorage, MutationObserver, AbortController } = environment;
  const requestAnimationFrame = environment.requestAnimationFrame.bind(environment);
  const cancelAnimationFrame = environment.cancelAnimationFrame.bind(environment);
  const setInterval = environment.setInterval.bind(environment);
  const clearInterval = environment.clearInterval.bind(environment);
  const clearTimeout = environment.clearTimeout.bind(environment);
  const confirm = environment.confirm.bind(environment);
  const globalKey = '__codexColorLabelsDemo';
  window[globalKey]?.destroy();
  delete window.__codexColorLabelsStopRequested;
  const adapter = createAdapter(document);
  const preferences = createPreferences(localStorage, options.storageKey);
  const prefix = 'ccld';
  const mark = 'data-ccld-color', owner = 'data-ccld-owner';
  const palette = preferences.palette;
  let config = preferences.empty(), error = '', storageHealthy = true, connected = true;
  try {
    config = options.initialPreferences ? preferences.save(options.initialPreferences) : preferences.load();
  } catch (e) { error = e.message; storageHealthy = false; }
  let revision = 0, persistenceError = '', pendingSave = null;
  const durable = Boolean(options.persistenceBinding && options.sessionToken);
  const inlineControls = options.product === 'color-labels.v1';
  let commandId = 0, pendingCommand = null, commandError = '', panel, launcher;
  let quotaToggle, uiRevision=0, pendingUI=null, uiError=options.uiSettingsError??'';
  const uiSettings={version:1,showQuota:options.uiSettings?.showQuota!==false};
  let projectSelect, projectGrid, projectReset, projectIcon, selectedProjectKey = null, lastActiveProjectKey = null, projectSignature = '';
  let wheel, wheelHandle, colorSample, colorDrag = null, colorPreview = null;
  let fixedPalette, customToggle, customRegion;
  let projectTrigger, projectTriggerLabel, projectList, randomUndo = null, undoTimer = null;
  const colorPaintCache = new Map();
  let destroyed = false, frame = 0, heartbeat = Date.now(), refreshCount = 0;
  let current = adapter.inventory();
  const controller = new AbortController();
  const menuControllers = new Map();
  const ownedNodes = new Set();
  const style = document.createElement('style');
  style.id = `${prefix}-style`;
  style.textContent = Object.entries(palette).map(([color, values]) => {
    const targets = [`[${mark}="${color}"]`, `[${owner}] [data-ccld-choice="${color}"]`, `[${owner}] [data-ccld-preview="${color}"]`];
    const theme = name => targets.flatMap(target => [`html.${name} ${target}`, `html[data-theme="${name}"] ${target}`]).join(', ');
    return `
      ${targets.join(', ')} { --ccld-rgb: ${values.light}; }
      @media(prefers-color-scheme:dark) { ${targets.join(', ')} { --ccld-rgb: ${values.dark}; } }
      ${theme('dark')} { --ccld-rgb: ${values.dark}; }
      ${theme('light')} { --ccld-rgb: ${values.light}; }
    `;
  }).join('') + `
    [${mark}^="#"], [${owner}] [data-ccld-preview^="#"] { --ccld-rgb:var(--ccld-custom-light); }
    @media(prefers-color-scheme:dark) { [${mark}^="#"], [${owner}] [data-ccld-preview^="#"] { --ccld-rgb:var(--ccld-custom-dark); } }
    html.dark [${mark}^="#"], html[data-theme="dark"] [${mark}^="#"], html.dark [${owner}] [data-ccld-preview^="#"], html[data-theme="dark"] [${owner}] [data-ccld-preview^="#"] { --ccld-rgb:var(--ccld-custom-dark); }
    html.light [${mark}^="#"], html[data-theme="light"] [${mark}^="#"], html.light [${owner}] [data-ccld-preview^="#"], html[data-theme="light"] [${owner}] [data-ccld-preview^="#"] { --ccld-rgb:var(--ccld-custom-light); }
    svg[${mark}] { color: rgb(var(--ccld-rgb)) !important; }
    [data-app-action-sidebar-project-row][${mark}] {
      box-shadow: inset 5px 0 rgb(var(--ccld-rgb)) !important;
    }
    [data-app-action-sidebar-thread-row][${mark}][data-app-action-sidebar-thread-selected="true"] {
      background-color: transparent !important;
      background-image: none !important;
    }
    [data-app-action-sidebar-thread-row][${mark}][data-app-action-sidebar-thread-selected="true"] [data-thread-title="true"] {
      color: rgb(var(--ccld-rgb)) !important;
    }
    [data-app-action-sidebar-thread-row][${mark}][data-app-action-sidebar-thread-selected="true"] [data-thread-title-trigger="true"] {
      position: relative;
    }
    [data-app-action-sidebar-thread-row][${mark}][data-app-action-sidebar-thread-selected="true"] [data-thread-title-trigger="true"]::before {
      content: "";
      position: absolute;
      inset-inline-start: -6px;
      top: 50%;
      transform: translateY(-50%);
      width: 4px;
      height: 14px;
      border-radius: 999px;
      background-color: rgb(var(--ccld-rgb));
      background-image: none;
      box-shadow: none;
      pointer-events: none;
    }
    [${owner}], [${owner}] button { color: inherit; -webkit-app-region: no-drag; }
    [${owner}] button { font-family: inherit; }
    .ccld-menu { padding: 8px; border-top: 1px solid var(--color-border, #8884); min-width: 208px; }
    .ccld-title { font-size: 12px; opacity: 0.8; padding: 0 2px 6px; }
    .ccld-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; }
    .ccld-swatch { background: transparent; border: 1px solid transparent; border-radius: 8px; padding: 5px 3px; cursor: pointer; font-size: 11px; }
    .ccld-swatch span { display: block; border-radius: 50%; width: 18px; height: 18px; margin: 0 auto 4px; background: rgb(var(--ccld-rgb)); }
    .ccld-swatch:hover, .ccld-action:hover { background: #8882; }
    .ccld-swatch[aria-checked="true"], .ccld-swatch[aria-pressed="true"] { border-color: currentColor; background: #8882; }
    [${owner}] button:focus-visible, [${owner}] summary:focus-visible, [${owner}] select:focus-visible, [${owner}] canvas:focus-visible { outline: 2px solid var(--color-ring, #528bdf); outline-offset: 2px; }
    .ccld-action { background: transparent; border: 0; border-radius: 6px; cursor: pointer; padding: 7px 8px; text-align: left; width: 100%; font-size: 12px; }
    .ccld-status { position: fixed; left: 9px; bottom: 7px; z-index: 60; max-width: 270px; border: 1px solid #8884; border-radius: 10px; background: var(--color-surface-elevated-secondary, Canvas); color: var(--color-text-default, CanvasText); box-shadow: 0 2px 10px #0001; font-size: 11px; }
    .ccld-status summary { cursor: pointer; padding: 6px 9px; }
    .ccld-status-content { padding: 0 6px 6px; }
    .ccld-note { padding: 5px 7px; max-width: 248px; line-height: 1.5; opacity: .8; white-space: normal; }
    .ccld-error { color: var(--color-text-danger, #c74949); }
    .ccld-rail-slot { display:flex; align-items:center; justify-content:center; width:36px; height:36px; flex-shrink:0; }
    .ccld-rail-button { display:flex; align-items:center; justify-content:center; width:36px; height:36px; padding:0; border:0; border-radius:12px; background:transparent; color:var(--color-text-tertiary, #888); cursor:pointer; }
    .ccld-rail-button:hover, .ccld-rail-button[aria-expanded="true"] { background:var(--color-bg-primary-ghost-hover, #8882); color:var(--color-text-default, CanvasText); }
    .ccld-rail-button svg { width:22px; height:22px; }
    .ccld-rail-button { position:relative; }
    .ccld-rail-button[data-enabled="true"] { color:var(--ccld-active, #258347); }
    .ccld-rail-button::after { content:""; position:absolute; right:2px; bottom:2px; width:8px; height:8px; border-radius:50%; background:var(--ccld-active, #258347); border:2px solid var(--color-surface-elevated-secondary, Canvas); }
    .ccld-rail-button[data-state="off"]::after { content:"Ⅱ"; display:grid; place-items:center; width:11px; height:11px; font:700 8px/1 sans-serif; background:var(--color-text-secondary, #777); color:var(--color-surface-elevated-secondary, Canvas); }
    .ccld-rail-button[data-state="error"]::after, .ccld-rail-button[data-state="disconnected"]::after { content:"!"; display:grid; place-items:center; width:11px; height:11px; font:700 9px/1 sans-serif; background:#bb7400; color:white; }
    html.dark [${owner}], html[data-theme="dark"] [${owner}] { --ccld-active:#63d389; }
    .ccld-panel { position:fixed; box-sizing:border-box; width:200px; max-width:calc(100vw - 16px); max-height:calc(100vh - 16px); overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain; z-index:80; padding:12px; border:1px solid var(--color-border, #8884); border-radius:16px; background:var(--color-surface-elevated-secondary, Canvas); color:var(--color-text-default, CanvasText); box-shadow:0 8px 30px #0002; font-size:13px; line-height:1.35; }
    .ccld-panel[hidden] { display:none; }
    .ccld-panel [hidden] { display:none !important; }
    .ccld-panel-header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
    .ccld-panel .ccld-panel-title { font-weight:600; font-size:14px; padding:0; }
    .ccld-panel .ccld-note { font-size:11px; margin-top:4px; padding:6px 8px; }
    .ccld-panel .ccld-status-content { padding:0; display:grid; gap:2px; }
    .ccld-panel .ccld-action-row { display:flex; box-sizing:border-box; align-items:center; justify-content:center; gap:8px; padding:8px; font-size:12px; line-height:16px; min-height:32px; background:var(--color-bg-primary-ghost-hover, #8881); border-radius:9px; }
    .ccld-panel .ccld-action-row:hover:not(:disabled) { background:var(--color-bg-primary-ghost-hover, #8882); }
    .ccld-action-row svg { width:16px; height:16px; flex-shrink:0; opacity:.65; }
    .ccld-project-controls { margin:12px 0 8px; padding:0 0 12px; border-bottom:1px solid var(--color-border, #8884); }
    .ccld-project-picker { position:relative; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid var(--color-border, #8884); }
    .ccld-project-select { appearance:none; width:100%; box-sizing:border-box; height:32px; border:0; border-radius:7px; padding:6px 24px 6px 26px; background:var(--color-surface-elevated-secondary, Canvas); color:var(--color-text-default, CanvasText); font:inherit; cursor:pointer; -webkit-app-region:no-drag; }
    .ccld-project-select option { background:var(--color-surface-elevated-secondary, Canvas); color:var(--color-text-default, CanvasText); }
    .ccld-panel .ccld-project-trigger { display:flex; align-items:center; height:32px; padding:6px 24px 6px 26px; border-radius:7px; font-size:13px; }
    .ccld-project-trigger-label, .ccld-project-option-label { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ccld-project-list { position:absolute; box-sizing:border-box; top:35px; left:0; right:0; z-index:4; max-height:160px; overflow-y:auto; padding:4px; border:1px solid var(--color-border, #8884); border-radius:9px; background:var(--color-surface-elevated-secondary, Canvas); color:var(--color-text-default, CanvasText); box-shadow:0 6px 18px #0003; }
    .ccld-panel .ccld-project-option { display:flex; align-items:center; gap:6px; min-height:30px; padding:6px; font-size:12px; }
    .ccld-project-option-check { flex:0 0 12px; visibility:hidden; }
    .ccld-project-option[aria-selected="true"] .ccld-project-option-check { visibility:visible; }
    .ccld-project-option[aria-selected="true"] { background:var(--color-bg-primary-ghost-hover, #8882); }
    .ccld-random-feedback { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:11px; padding:3px 4px; }
    .ccld-panel .ccld-undo { width:auto; padding:4px; font-size:11px; text-decoration:underline; }
    .ccld-project-select:hover:not(:disabled) { background:var(--color-bg-primary-ghost-hover, #8881); }
    .ccld-project-picker-icon { position:absolute; left:2px; top:8px; width:16px; height:16px; opacity:.85; pointer-events:none; }
    .ccld-project-picker-icon[data-ccld-preview] { color:rgb(var(--ccld-rgb)); opacity:1; }
    .ccld-project-picker-chevron { position:absolute; right:4px; top:10px; width:12px; height:12px; opacity:.5; pointer-events:none; }
    .ccld-color-heading { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
    .ccld-color-label { font-size:11px; opacity:.65; }
    .ccld-panel .ccld-reset-link { width:auto; padding:2px 0; border-radius:4px; font-size:11px; line-height:16px; opacity:.7; }
    .ccld-reset-link:disabled { opacity:.3; cursor:default; }
    .ccld-project-controls .ccld-grid { gap:6px; }
    .ccld-project-controls .ccld-swatch { display:grid; place-items:center; position:relative; height:36px; padding:3px; border:1.5px solid transparent; border-radius:50%; font-size:0; }
    .ccld-project-controls .ccld-swatch > span { position:relative; width:24px; height:24px; margin:0; }
    .ccld-project-controls .ccld-swatch[aria-pressed="true"] { border-color:rgb(var(--ccld-rgb)); background:transparent; }
    .ccld-project-controls .ccld-swatch[aria-pressed="true"] > span::after { content:"✓"; position:absolute; inset:0; display:grid; place-items:center; font:600 12px/1 sans-serif; color:white; }
    html.dark .ccld-project-controls .ccld-swatch > span::after, html[data-theme="dark"] .ccld-project-controls .ccld-swatch > span::after { color:#151515; }
    .ccld-panel .ccld-power { position:relative; flex-shrink:0; width:34px; height:20px; padding:0; border:0; border-radius:999px; background:#8885; font-size:0; }
    .ccld-panel .ccld-power[aria-checked="true"] { background:var(--ccld-active, #258347); }
    .ccld-quota-setting { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:10px; padding-top:10px; border-top:1px solid var(--color-border, #8884); font-size:12px; }
    .ccld-power::before { content:""; position:absolute; top:3px; left:3px; width:14px; height:14px; border-radius:50%; background:white; box-shadow:0 1px 3px #0002; }
    .ccld-power[aria-checked="true"]::before { transform:translateX(14px); }
    .ccld-panel button:disabled { cursor:default; }
    .ccld-project-controls .ccld-swatch:disabled, .ccld-project-select:disabled, .ccld-action-row:disabled, .ccld-power:disabled { opacity:.45; }
    .ccld-sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    .ccld-wheel-row { display:flex; flex-direction:column; align-items:center; gap:10px; }
    .ccld-wheel-wrap { position:relative; flex-shrink:0; width:108px; height:108px; }
    .ccld-color-wheel { display:block; width:108px; height:108px; border-radius:50%; cursor:crosshair; touch-action:none; -webkit-app-region:no-drag; }
    .ccld-color-wheel[aria-disabled="true"] { opacity:.4; cursor:default; }
    .ccld-wheel-handle { position:absolute; box-sizing:border-box; width:10px; height:10px; border:2px solid white; border-radius:50%; box-shadow:0 0 0 1px #0005; transform:translate(-50%,-50%); pointer-events:none; }
    .ccld-wheel-info { display:flex; align-items:center; justify-content:center; gap:12px; }
    .ccld-wheel-divider { width:1px; height:10px; background:var(--color-border, #8884); }
    .ccld-color-sample { width:16px; height:16px; border:1px solid #8883; border-radius:50%; background:rgb(var(--ccld-rgb, 150, 150, 150)); }
    .ccld-fixed-palette { display:grid; grid-template-columns:repeat(6,minmax(0,26px)); justify-content:center; width:100%; gap:3px; }
    .ccld-panel .ccld-fixed-swatch { display:grid; place-items:center; box-sizing:border-box; width:100%; max-width:26px; height:auto; aspect-ratio:1; padding:1px; border:1.5px solid transparent; border-radius:50%; background:transparent; }
    .ccld-fixed-swatch > span { position:relative; width:100%; max-width:20px; height:auto; aspect-ratio:1; border-radius:50%; background:rgb(var(--ccld-rgb)); }
    .ccld-fixed-swatch[aria-pressed="true"] { border-color:rgb(var(--ccld-rgb)); }
    .ccld-fixed-swatch[aria-pressed="true"] > span::after { content:"✓"; position:absolute; inset:0; display:grid; place-items:center; font:600 11px/1 sans-serif; color:white; }
    html.dark .ccld-fixed-swatch > span::after, html[data-theme="dark"] .ccld-fixed-swatch > span::after { color:#151515; }
    .ccld-fixed-swatch:disabled { opacity:.45; }
    .ccld-color-tools { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:10px; }
    .ccld-panel .ccld-custom-toggle { display:flex; align-items:center; gap:5px; width:auto; padding:2px 0; font-size:11px; line-height:16px; opacity:.7; }
    .ccld-custom-toggle svg { width:10px; height:10px; }
    .ccld-custom-toggle[aria-expanded="true"] svg { transform:rotate(90deg); }
    .ccld-custom-toggle .ccld-color-sample { width:9px; height:9px; }
    .ccld-custom-region { margin-top:12px; display:flex; justify-content:center; }
  `;
  document.head.append(style);
  const widget = document.createElement(inlineControls ? 'div' : 'details');
  widget.className = 'ccld-status'; widget.setAttribute(owner, 'status');
  const summary = document.createElement(inlineControls ? 'div' : 'summary');
  summary.setAttribute('aria-live', 'polite');
  const controls = document.createElement('div'); controls.className = 'ccld-status-content';
  const note = document.createElement('div'); note.className = 'ccld-note';
  const failure = document.createElement('div'); failure.className = 'ccld-note ccld-error'; failure.setAttribute('role', 'status');
  const toggle = button('暂停上色', () => config.paused ? resume() : pause());
  const clear = button('清除全部配色…', () => {
    if (confirm('清除本工具保存的全部项目配色？暂停上色可以保留设置。')) clearColors();
  });
  const randomize = button('全部项目随机配色', () => randomizeColors());
  randomize.setAttribute('data-ccld-action', 'randomize');
  randomize.title = '为当前窗口全部本地项目重新配色，包括已有颜色的项目';
  const undo = button('撤销', () => undoRandomize()); undo.classList.add('ccld-undo'); undo.setAttribute('data-ccld-action', 'undo-randomize');
  const randomFeedback = document.createElement('div'); randomFeedback.className = 'ccld-random-feedback'; randomFeedback.hidden = true;
  const randomMessage = document.createElement('span'); randomMessage.textContent = '已随机配色'; randomMessage.setAttribute('role', 'status');
  randomFeedback.append(randomMessage, undo);
  toggle.setAttribute('data-ccld-action', 'toggle');
  if (inlineControls) {
    widget.className = 'ccld-rail-slot'; widget.setAttribute(owner, 'sidebar-control');
    launcher = button('', () => panel.hidden ? openPanel() : closePanel());
    launcher.className = 'ccld-rail-button';
    launcher.setAttribute('aria-label', '项目配色'); launcher.title = '项目配色';
    launcher.setAttribute('aria-haspopup', 'dialog'); launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-controls', 'ccld-panel');
    launcher.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1.3a2.2 2.2 0 0 0 1.5-3.8 1.4 1.4 0 0 1 1-2.4H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z"/><circle cx="7.3" cy="11" r=".7"/><circle cx="9" cy="7.4" r=".7"/><circle cx="13" cy="6.7" r=".7"/><circle cx="16.6" cy="9.2" r=".7"/></svg>';
    summary.id = 'ccld-rail-status'; summary.className = 'ccld-sr-only';
    launcher.setAttribute('aria-describedby', summary.id);
    widget.append(launcher, summary);
    panel = document.createElement('div'); panel.className = 'ccld-panel'; panel.id = 'ccld-panel'; panel.hidden = true;
    panel.setAttribute(owner, 'control-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '项目配色');
    const heading = document.createElement('div'); heading.className = 'ccld-panel-title'; heading.textContent = '项目配色';
    const header = document.createElement('div'); header.className = 'ccld-panel-header';
    toggle.className = 'ccld-action ccld-power'; toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-label', '启用项目配色');
    header.append(heading, toggle);
    const projectControls = document.createElement('div'); projectControls.className = 'ccld-project-controls';
    projectControls.setAttribute(owner, 'project-controls');
    const projectLabel = document.createElement('label'); projectLabel.className = 'ccld-sr-only'; projectLabel.htmlFor = 'ccld-project-trigger'; projectLabel.textContent = '项目';
    projectSelect = document.createElement('select'); projectSelect.id = 'ccld-project-select'; projectSelect.className = 'ccld-project-select'; projectSelect.setAttribute('aria-label', '选择配色项目');
    projectSelect.hidden = true; projectSelect.tabIndex = -1; projectSelect.setAttribute('aria-hidden', 'true');
    projectSelect.addEventListener('change', () => { selectedProjectKey = projectSelect.value; current = adapter.inventory(); updateProjectControls(); }, { signal: controller.signal });
    const picker = document.createElement('div'); picker.className = 'ccld-project-picker';
    projectTrigger = button('', () => projectList.hidden ? openProjectList() : closeProjectList());
    projectTrigger.id = 'ccld-project-trigger'; projectTrigger.classList.add('ccld-project-trigger');
    projectTrigger.setAttribute('aria-label', '选择配色项目'); projectTrigger.setAttribute('aria-haspopup', 'listbox'); projectTrigger.setAttribute('aria-expanded', 'false'); projectTrigger.setAttribute('aria-controls', 'ccld-project-list');
    projectTriggerLabel = document.createElement('span'); projectTriggerLabel.className = 'ccld-project-trigger-label'; projectTrigger.append(projectTriggerLabel);
    projectList = document.createElement('div'); projectList.id = 'ccld-project-list'; projectList.className = 'ccld-project-list'; projectList.hidden = true; projectList.setAttribute('role', 'listbox'); projectList.setAttribute('aria-label', '项目');
    projectTrigger.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); openProjectList(event.key); }
    }, { signal: controller.signal });
    projectList.addEventListener('keydown', event => {
      const items = [...projectList.querySelectorAll('[role="option"]')], index = items.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length-1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus();
      } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeProjectList(); }
      else if (event.key === 'Tab') closeProjectList(false);
    }, { signal: controller.signal });
    projectIcon = svg('<path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h3l1.5 2h4.5A1.5 1.5 0 0 1 14 7.5v4A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5Z"/>'); projectIcon.classList.add('ccld-project-picker-icon');
    const chevron = svg('<path d="m4 6 4 4 4-4"/>'); chevron.classList.add('ccld-project-picker-chevron');
    picker.append(projectSelect, projectTrigger, projectIcon, chevron, projectList);
    projectGrid = document.createElement('div'); projectGrid.setAttribute('role', 'group'); projectGrid.setAttribute('aria-label', '项目颜色');
    fixedPalette = document.createElement('div'); fixedPalette.className = 'ccld-fixed-palette'; fixedPalette.setAttribute('role', 'group'); fixedPalette.setAttribute('aria-label', '固定项目颜色');
    for (const [color, value] of Object.entries(palette)) {
      const swatch = button('', () => setColor(selectedProjectKey, color)); swatch.classList.add('ccld-fixed-swatch');
      swatch.setAttribute('data-ccld-choice', color); swatch.setAttribute('aria-label', value.name); swatch.title = value.name;
      paintElement(swatch, color, 'data-ccld-preview');
      const dot = document.createElement('span'); dot.setAttribute('aria-hidden', 'true'); swatch.append(dot); fixedPalette.append(swatch);
    }
    customRegion = document.createElement('div'); customRegion.className = 'ccld-custom-region'; customRegion.id = 'ccld-custom-region'; customRegion.hidden = true;
    customToggle = button('', () => {
      if (colorDrag) return;
      customRegion.hidden = !customRegion.hidden; customToggle.setAttribute('aria-expanded', String(!customRegion.hidden)); updateProjectControls(); positionPanel();
    }); customToggle.classList.add('ccld-custom-toggle'); customToggle.setAttribute('data-ccld-action', 'custom-color'); customToggle.setAttribute('aria-controls', customRegion.id); customToggle.setAttribute('aria-expanded', 'false');
    const customLabel = document.createElement('span'); customLabel.textContent = '自定义';
    colorSample = document.createElement('span'); colorSample.className = 'ccld-color-sample'; colorSample.setAttribute('aria-hidden','true'); colorSample.hidden = true;
    customToggle.append(customLabel, colorSample, svg('<path d="m6 3 5 5-5 5"/>'));
    const wheelWrap = document.createElement('div'); wheelWrap.className = 'ccld-wheel-wrap';
    wheel = document.createElement('canvas'); wheel.className = 'ccld-color-wheel'; wheel.width = 216; wheel.height = 216; wheel.tabIndex = 0;
    wheel.setAttribute('role', 'slider'); wheel.setAttribute('aria-label', '项目颜色色轮'); wheel.setAttribute('aria-valuemin', '0'); wheel.setAttribute('aria-valuemax', '359'); wheel.title = '拖动调整颜色';
    wheelHandle = document.createElement('span'); wheelHandle.className = 'ccld-wheel-handle'; wheelHandle.setAttribute('aria-hidden', 'true');
    wheelWrap.append(wheel, wheelHandle);
    const context = wheel.getContext('2d'), image = context.createImageData(wheel.width,wheel.height), radius = wheel.width/2;
    for (let y=0;y<wheel.height;y++) for(let x=0;x<wheel.width;x++) {
      const dx=x+.5-radius,dy=y+.5-radius,distance=Math.hypot(dx,dy),index=(y*wheel.width+x)*4;
      if(distance>radius)continue;
      const hue=(Math.atan2(dy,dx)*180/Math.PI+360)%360,channels=preferences.hsvToRGB(hue,distance/radius);
      image.data.set([...channels,Math.round(Math.min(1,radius-distance)*255)],index);
    }
    context.putImageData(image,0,0);
    wheel.addEventListener('pointerdown', event => {
      if(event.button!==0 || colorDrag || !canUseWheel())return;
      event.preventDefault(); wheel.focus(); colorDrag={pointerId:event.pointerId,key:selectedProjectKey};
      try{wheel.setPointerCapture(event.pointerId);}catch{}
      previewWheel(event); updateProjectControls();
    }, { signal: controller.signal });
    document.addEventListener('pointermove', event => { if(colorDrag?.pointerId===event.pointerId){event.preventDefault();previewWheel(event);} }, { signal: controller.signal });
    document.addEventListener('pointerup', event => {
      if(colorDrag?.pointerId!==event.pointerId)return;
      previewWheel(event); const key=colorDrag.key,color=colorPreview?.color;
      colorDrag=null;colorPreview=null;
      if(!color||!connected||!storageHealthy||!setColor(key,color))refresh();
    }, { signal: controller.signal });
    document.addEventListener('pointercancel', event => { if(colorDrag?.pointerId===event.pointerId)cancelColorDrag(); }, { signal: controller.signal });
    wheel.addEventListener('lostpointercapture', event => { if(colorDrag?.pointerId===event.pointerId)cancelColorDrag(); }, { signal: controller.signal });
    wheel.addEventListener('keydown', event => {
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
      event.preventDefault();event.stopPropagation();if(!canUseWheel())return;
      const value=preferences.toHSV(config.projects[selectedProjectKey]??'red');
      if(event.key==='ArrowLeft')value.hue-=5;if(event.key==='ArrowRight')value.hue+=5;
      if(event.key==='ArrowUp')value.saturation+=.05;if(event.key==='ArrowDown')value.saturation-=.05;
      if(event.key==='Home')value.hue=0;if(event.key==='End')value.hue=359;
      setColor(selectedProjectKey,preferences.hsvToHex(value.hue,value.saturation));
    }, { signal: controller.signal });
    projectReset = button('恢复默认', () => setColor(selectedProjectKey, null));
    projectReset.className = 'ccld-action ccld-reset-link'; projectReset.title = '恢复所选项目的默认颜色';
    projectReset.setAttribute('data-ccld-action', 'reset-project');
    const colorTools = document.createElement('div'); colorTools.className = 'ccld-color-tools'; colorTools.append(customToggle, projectReset);
    customRegion.append(wheelWrap); projectGrid.append(fixedPalette, colorTools, customRegion);
    projectControls.append(projectLabel, picker, projectGrid);
    decorateAction(randomize, '<rect x="2" y="2" width="12" height="12" rx="3"/><circle cx="5" cy="5" r=".6"/><circle cx="11" cy="5" r=".6"/><circle cx="8" cy="8" r=".6"/><circle cx="5" cy="11" r=".6"/><circle cx="11" cy="11" r=".6"/>');
    controls.append(randomize, randomFeedback);
    const quotaSetting=document.createElement('div');quotaSetting.className='ccld-quota-setting';
    const quotaLabel=document.createElement('span');quotaLabel.id='ccld-quota-setting-label';quotaLabel.textContent='显示账号额度';
    quotaToggle=button('',()=>setQuotaVisible(!uiSettings.showQuota));quotaToggle.className='ccld-action ccld-power';quotaToggle.setAttribute('role','switch');quotaToggle.setAttribute('aria-labelledby',quotaLabel.id);quotaToggle.setAttribute('data-ccld-action','show-quota');
    quotaSetting.append(quotaLabel,quotaToggle);controls.append(quotaSetting,note,failure);panel.append(header, projectControls, controls);document.body.append(panel);
    document.addEventListener('pointerdown', event => {
      if (!picker.contains(event.target)) closeProjectList(false);
      if (!panel.hidden && !panel.contains(event.target) && !widget.contains(event.target)) closePanel(false);
    }, { signal: controller.signal });
    document.addEventListener('keydown', event => {
      if (panel.hidden) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if(colorDrag)cancelColorDrag();else closePanel(); }
      if (event.target !== projectSelect && event.target !== wheel && panel.contains(event.target) && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const items = [...panel.querySelectorAll('button:not(:disabled), select:not(:disabled), canvas[aria-disabled="false"]')].filter(item => item.getClientRects().length), index = items.indexOf(document.activeElement);
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length-1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus();
      }
    }, { signal: controller.signal });
    window.addEventListener('resize', () => { if (!panel.hidden) positionPanel(); }, { signal: controller.signal });
  } else {
    controls.append(toggle, clear, button('停止本次上色', async () => { if (!await api.flushPersistence()) return; window.__codexColorLabelsStopRequested = true; destroy(); }), note, failure);
    widget.append(summary, controls); document.body.append(widget);
  }
  function mountControls() {
    if (!inlineControls) return;
    const anchor = adapter.controlAnchor?.();
    if (!anchor) { widget.remove(); closePanel(false); return; }
    const card = window.__codexProjectQuota?.controlContainer?.(anchor);
    const parent = card ?? anchor.rail, before = card ? null : anchor.footer;
    if (widget.parentElement !== parent || widget.nextElementSibling !== before) parent.insertBefore(widget, before);
    if (!panel.hidden) positionPanel();
  }
  function positionPanel() {
    const rect = launcher.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.right + 10, window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - panel.offsetHeight - 8))}px`;
    if (projectList && !projectList.hidden) positionProjectList();
  }
  function openPanel() {
    current = adapter.inventory();
    const activeKey = current.projects.find(project => project.threads.some(thread => thread.getAttribute('data-app-action-sidebar-thread-selected') === 'true'))?.key ?? null;
    if (activeKey && activeKey !== lastActiveProjectKey) selectedProjectKey = activeKey;
    lastActiveProjectKey = activeKey;
    updateProjectControls(); panel.hidden = false; launcher.setAttribute('aria-expanded', 'true'); positionPanel(); toggle.focus();
  }
  function closePanel(focus = true) { if (!panel) return; closeProjectList(false); if(colorDrag)cancelColorDrag();panel.hidden = true; launcher.setAttribute('aria-expanded', 'false'); if (focus && widget.isConnected) launcher.focus(); }
  function openProjectList(key) {
    if (projectTrigger.disabled) return;
    projectList.hidden = false; projectTrigger.setAttribute('aria-expanded', 'true');
    positionProjectList();
    const items = [...projectList.querySelectorAll('[role="option"]')];
    (key === 'Home' ? items[0] : key === 'End' ? items.at(-1) : items.find(item => item.getAttribute('aria-selected') === 'true') ?? items[0])?.focus();
  }
  function closeProjectList(focus = true) {
    if (!projectList || projectList.hidden) return;
    projectList.hidden = true; projectTrigger.setAttribute('aria-expanded', 'false'); if (focus && !projectTrigger.disabled) projectTrigger.focus();
  }
  function positionProjectList() {
    projectList.style.maxHeight = `${Math.max(30, Math.min(160, panel.getBoundingClientRect().bottom - projectList.getBoundingClientRect().top - 12))}px`;
  }
  function canUseWheel() { return !customRegion.hidden && selectedProjectKey && connected && storageHealthy && !pendingSave && !colorDrag && current.projects.some(project=>project.key===selectedProjectKey); }
  function previewWheel(event) {
    const rect=wheel.getBoundingClientRect(),dx=(event.clientX-rect.left-rect.width/2)/(rect.width/2),dy=(event.clientY-rect.top-rect.height/2)/(rect.height/2);
    const hue=(Math.atan2(dy,dx)*180/Math.PI+360)%360,saturation=Math.min(1,Math.hypot(dx,dy));
    colorPreview={key:colorDrag.key,color:preferences.hsvToHex(hue,saturation)};schedule();updateWheel();
  }
  function cancelColorDrag() { colorDrag=null;colorPreview=null;refresh(); }
  function projectColor(key) { return colorPreview?.key===key?colorPreview.color:config.projects[key]; }
  function updateWheel() {
    if(!wheel)return;
    const color=projectColor(selectedProjectKey),value=preferences.toHSV(color??'red'),radians=value.hue*Math.PI/180;
    wheelHandle.hidden=!color;wheelHandle.style.left=`${50+Math.cos(radians)*value.saturation*50}%`;wheelHandle.style.top=`${50+Math.sin(radians)*value.saturation*50}%`;wheelHandle.style.background=color?preferences.toHex(color):'transparent';
    wheel.setAttribute('aria-valuenow',String(Math.round(value.hue)%360));wheel.setAttribute('aria-valuetext',color?`${preferences.toHex(color)}，饱和度 ${Math.round(value.saturation*100)}%`:'默认颜色');
    wheel.setAttribute('aria-disabled',String(customRegion.hidden||!selectedProjectKey||!connected||!storageHealthy||Boolean(pendingSave)));wheel.tabIndex=wheel.getAttribute('aria-disabled')==='true'?-1:0;
    if(color){paintElement(projectIcon,color,'data-ccld-preview');paintElement(colorSample,color,'data-ccld-preview');}
    else{clearMark(projectIcon,'data-ccld-preview');clearMark(colorSample,'data-ccld-preview');}
  }
  function runCommand(action) {
    if (pendingCommand || !connected) return;
    commandError = '';
    const id = ++commandId;
    pendingCommand = { id, timer: window.setTimeout(() => { pendingCommand = null; commandError = '打开文件未得到确认，请重试。'; updateText(); }, 8000) };
    try { window[options.controlBinding](JSON.stringify({token:options.sessionToken,id,action})); }
    catch { clearTimeout(pendingCommand.timer); pendingCommand = null; commandError = '无法连接本机文件服务，请重新连接。'; }
    updateText();
  }
  function button(text, action, signal = controller.signal) {
    const element = document.createElement('button'); element.type = 'button'; element.textContent = text; element.className = 'ccld-action';
    element.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); action(); }, { signal });
    return element;
  }
  function svg(paths) {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key,value] of Object.entries({viewBox:'0 0 16 16',fill:'none',stroke:'currentColor','stroke-width':'1.4','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'})) icon.setAttribute(key,value);
    icon.innerHTML = paths; return icon;
  }
  function decorateAction(element, paths) {
    const label = document.createElement('span'); label.textContent = element.textContent;
    element.className = 'ccld-action ccld-action-row'; element.replaceChildren(svg(paths), label);
  }
  function setQuotaVisible(show){
    if(typeof show!=='boolean'||!connected||pendingUI||options.uiSettingsError)return false;
    uiSettings.showQuota=show;uiError='';window.__codexProjectQuota?.setVisible(show);
    if(options.uiPersistenceBinding&&options.sessionToken){
      const revision=++uiRevision;
      const timer=window.setTimeout(()=>{if(pendingUI?.revision!==revision)return;pendingUI=null;uiError='显示设置保存未确认，请重试';updateText();},8000);
      pendingUI={revision,timer};
      try{window[options.uiPersistenceBinding](JSON.stringify({token:options.sessionToken,revision,settings:{...uiSettings}}));}
      catch{clearTimeout(timer);pendingUI=null;uiError='显示设置保存接口不可用';}
    }
    updateText();return true;
  }
  function updateText() {
    const message = !connected ? '未连接' : !current.ready ? '当前界面需要适配' : !storageHealthy ? '配色记录需要处理' : config.paused ? (inlineControls ? '上色已停止' : '上色已暂停') : (inlineControls ? '上色已开启' : '已连接');
    const text = inlineControls ? message : `项目颜色 · ${message}`;
    if (summary.textContent !== text) summary.textContent = text;
    const toggleText = config.paused ? '恢复上色' : inlineControls ? '停止上色' : '暂停上色';
    if (toggle.textContent !== toggleText) toggle.textContent = toggleText;
    const details = current.partial ? '部分项目暂无法识别。' : inlineControls ? '' : '本地项目分组生效。暂停保留设置；停止移除界面，调试端口仍开启。';
    if (note.textContent !== details) note.textContent = details;
    const problem = error || persistenceError || commandError || uiError;
    if (failure.textContent !== problem) failure.textContent = problem;
    failure.hidden = !problem;
    if (inlineControls) {
      const enabled = connected && current.ready && storageHealthy && !config.paused;
      const state = !connected ? 'disconnected' : !current.ready || !storageHealthy || problem ? 'error' : config.paused ? 'off' : 'on';
      launcher.setAttribute('data-enabled', String(enabled)); launcher.setAttribute('data-state', state);
      launcher.title = `项目配色 · ${!connected ? '未连接' : config.paused ? '已停止' : '已开启'}${problem ? ' · 需要处理' : ''}`;
      toggle.setAttribute('aria-checked', String(enabled)); toggle.title = toggleText;
      note.hidden = !current.partial && !pendingSave;
    }
    toggle.disabled = !connected || !storageHealthy;
    if(quotaToggle){quotaToggle.setAttribute('aria-checked',String(uiSettings.showQuota));quotaToggle.disabled=!connected||!!pendingUI||!!options.uiSettingsError;quotaToggle.title=pendingUI?'正在保存…':uiSettings.showQuota?'隐藏账号额度':'显示账号额度';}
    randomize.disabled = !connected || !storageHealthy || !current.ready || Boolean(pendingSave);
    randomFeedback.hidden = !randomUndo;
    undo.disabled = !randomUndo || !connected || !storageHealthy || Boolean(pendingSave) || Boolean(colorDrag);
    randomMessage.textContent = pendingSave ? '正在保存…' : persistenceError ? '可撤销此次配色' : '已随机配色';
    updateProjectControls();
    if (durable && pendingSave && !problem) note.textContent = inlineControls ? '正在保存…' : '正在保存配色到本机…';
    if (inlineControls && !panel.hidden && widget.isConnected) positionPanel();
  }
  function updateProjectControls() {
    if (!inlineControls) return;
    if (!current.projects.some(project => project.key === selectedProjectKey)) {
      selectedProjectKey = current.projects.find(project => project.threads.some(thread => thread.getAttribute('data-app-action-sidebar-thread-selected') === 'true'))?.key ?? current.projects[0]?.key ?? null;
    }
    const signature = JSON.stringify(current.projects.map(project => [project.key, project.label]));
    if (signature !== projectSignature || !projectSelect.options.length) {
      const items = current.projects.length ? current.projects : [{key:'', label:'暂无可配色的本地项目'}];
      projectSelect.replaceChildren(...items.map(project => { const option = document.createElement('option'); option.value = project.key; option.textContent = project.label; return option; }));
      projectList.replaceChildren(...current.projects.map(project => {
        const item = button('', () => { selectedProjectKey = project.key; current = adapter.inventory(); updateProjectControls(); closeProjectList(); });
        item.classList.add('ccld-project-option'); item.setAttribute('role', 'option'); item.setAttribute('data-ccld-project-key', project.key); item.tabIndex = -1; item.title = project.label;
        const check = document.createElement('span'); check.className = 'ccld-project-option-check'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span'); label.className = 'ccld-project-option-label'; label.textContent = project.label; item.append(check, label); return item;
      }));
      projectSignature = signature;
    }
    projectSelect.value = selectedProjectKey ?? ''; projectSelect.disabled = !selectedProjectKey || !connected || Boolean(colorDrag);
    const projectName = current.projects.find(project => project.key === selectedProjectKey)?.label ?? '暂无可配色的本地项目';
    if (projectTriggerLabel.textContent !== projectName) projectTriggerLabel.textContent = projectName;
    projectTrigger.title = projectName; projectTrigger.disabled = projectSelect.disabled;
    for (const item of projectList.children) item.setAttribute('aria-selected', String(item.getAttribute('data-ccld-project-key') === selectedProjectKey));
    if (projectTrigger.disabled) closeProjectList(false);
    updateWheel();
    const color = projectColor(selectedProjectKey), fixedColor = color && Object.keys(palette).find(name => preferences.toHex(name) === preferences.toHex(color));
    for (const swatch of fixedPalette.children) {
      swatch.setAttribute('aria-pressed', String(swatch.getAttribute('data-ccld-choice') === fixedColor));
      swatch.disabled = !selectedProjectKey || !connected || !storageHealthy || Boolean(pendingSave) || Boolean(colorDrag);
    }
    colorSample.hidden = !color || Boolean(fixedColor);
    customToggle.title = color && !fixedColor ? `当前自定义颜色 ${preferences.toHex(color)}` : '展开色轮选择自定义颜色';
    customToggle.disabled = !selectedProjectKey || !connected || !storageHealthy || Boolean(pendingSave) || Boolean(colorDrag);
    projectReset.disabled = !selectedProjectKey || !connected || !storageHealthy || Boolean(pendingSave) || Boolean(colorDrag) || !config.projects[selectedProjectKey];
    randomize.disabled = !connected || !storageHealthy || !current.ready || Boolean(pendingSave) || Boolean(colorDrag);
    toggle.disabled = !connected || !storageHealthy || Boolean(colorDrag);
  }
  function persist() {
    if (!durable) return;
    const value = ++revision;
    clearTimeout(pendingSave?.timer);
    persistenceError = '';
    pendingSave = { revision: value, timer: window.setTimeout(() => {
      if (pendingSave?.revision !== value) return;
      pendingSave = null; persistenceError = '本机保存未得到确认；当前更改可能在重开后丢失，请重试。'; updateText();
    }, 8000) };
    try { window[options.persistenceBinding](JSON.stringify({ token: options.sessionToken, revision: value, preferences: config })); }
    catch { clearTimeout(pendingSave.timer); pendingSave = null; persistenceError = '无法连接本机保存服务，当前更改尚未备份。'; }
    updateText();
  }
  function commit(next) {
    if (!storageHealthy) return false;
    try { config = preferences.save(next); colorDrag=null;colorPreview=null;error = ''; persist(); refresh(); return true; }
    catch (e) { error = `保存失败：${e.message}。此次更改未应用。`; updateText(); return false; }
  }
  function setColor(key, color) {
    current = adapter.inventory();
    if(colorDrag&&(!connected||!current.projects.some(project=>project.key===colorDrag.key))){colorDrag=null;colorPreview=null;}
    if (!connected || !current.projects.some(p => p.key === key)) return false;
    const projects = { ...config.projects };
    if (color === null) delete projects[key]; else projects[key] = color;
    const saved = commit({ ...config, projects });
    if (saved) dismissRandomUndo(); return saved;
  }
  function randomizeColors(options={}) {
    if (!connected || !storageHealthy || pendingSave) return false;
    current = adapter.inventory();
    if (!current.ready) return false;
    const colors = Object.keys(palette), assigned = [], projects = { ...config.projects };
    let previous;
    while (assigned.length < current.projects.length) {
      const bag = [...colors];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(window.Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (bag[0] === previous) [bag[0], bag[1]] = [bag[1], bag[0]];
      const batch = bag.slice(0, current.projects.length - assigned.length);
      assigned.push(...batch); previous = batch.at(-1);
    }
    // A second click must have a visible effect, including for a single project.
    if (current.projects.every((project, index) => config.projects[project.key] === assigned[index])) {
      for (let i = 0; i < assigned.length; i++) assigned[i] = colors[(colors.indexOf(assigned[i]) + 1) % colors.length];
    }
    current.projects.forEach((project, index) => { projects[project.key] = assigned[index]; });
    if (!current.projects.length) return false;
    const snapshot = { ...config.projects };
    if (!commit({ ...config, projects })) return false;
    if(options.undo===false)dismissRandomUndo();
    else{
      randomUndo = { projects: snapshot }; clearTimeout(undoTimer);
      undoTimer = window.setTimeout(() => dismissRandomUndo(), 30000);
    }
    updateText(); return true;
  }
  function dismissRandomUndo() { clearTimeout(undoTimer); undoTimer = null; randomUndo = null; updateText(); }
  function undoRandomize() {
    if (!randomUndo || !connected || !storageHealthy || pendingSave || colorDrag) return false;
    if (!commit({ ...config, projects: randomUndo.projects })) return false;
    dismissRandomUndo(); return true;
  }
  function pause() { return commit({ ...config, paused: true }); }
  function resume() { return commit({ ...config, paused: false }); }
  function clearColors() {
    try { config = preferences.clear(); colorDrag=null;colorPreview=null;storageHealthy = true; error = ''; persist(); refresh(); dismissRandomUndo(); return true; }
    catch (e) { error = `清除失败：${e.message}`; updateText(); return false; }
  }
  function clearMark(element,attribute=mark) { element.removeAttribute(attribute);element.style.removeProperty('--ccld-custom-light');element.style.removeProperty('--ccld-custom-dark'); }
  function paintElement(element,color,attribute=mark) {
    if(element.getAttribute(attribute)!==color)element.setAttribute(attribute,color);
    if(color.startsWith('#')){
      if(!colorPaintCache.has(color)){if(colorPaintCache.size>=256)colorPaintCache.delete(colorPaintCache.keys().next().value);colorPaintCache.set(color,preferences.paint(color));}
      const paint=colorPaintCache.get(color);element.style.setProperty('--ccld-custom-light',paint.light);element.style.setProperty('--ccld-custom-dark',paint.dark);
    }else{element.style.removeProperty('--ccld-custom-light');element.style.removeProperty('--ccld-custom-dark');}
  }
  function refresh() {
    if (destroyed) return;
    refreshCount++;
    current = adapter.inventory();
    if(colorDrag&&(!connected||!current.projects.some(project=>project.key===colorDrag.key))){colorDrag=null;colorPreview=null;}
    mountControls();
    const desired = new Map();
    if (connected && storageHealthy && !config.paused) {
      for (const project of current.projects) {
        const color = projectColor(project.key);
        if (!color) continue;
        desired.set(project.row, color);
        desired.set(project.icon, color);
        for (const thread of project.threads) desired.set(thread, color);
      }
    }
    for (const element of ownedNodes) if (!desired.has(element)) { clearMark(element); ownedNodes.delete(element); }
    for (const [element, color] of desired) {
      paintElement(element,color);
      ownedNodes.add(element);
    }
    const menus = [...document.querySelectorAll('[role="menu"][aria-labelledby]')];
    for (const [section, events] of menuControllers) {
      const project = adapter.menuOwner(section.parentElement, current.projects);
      if (!section.isConnected || !project || section.getAttribute('data-ccld-project') !== project.key) {
        events.abort(); section.remove(); menuControllers.delete(section);
      }
    }
    for (const menu of inlineControls ? [] : menus) {
      const project = adapter.menuOwner(menu, current.projects);
      if (!project || menu.querySelector('[data-ccld-owner="palette"]')) continue;
      const section = document.createElement('div'); section.className = 'ccld-menu'; section.setAttribute(owner, 'palette'); section.setAttribute('data-ccld-project', project.key);
      const events = new AbortController(); menuControllers.set(section, events);
      const title = document.createElement('div'); title.className = 'ccld-title'; title.textContent = '项目颜色';
      const grid = document.createElement('div'); grid.className = 'ccld-grid'; grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', `${project.label} 的项目颜色`);
      for (const [color, value] of Object.entries(palette)) {
        const swatch = button(value.name.slice(0, 1), () => setColor(project.key, color), events.signal);
        swatch.className = 'ccld-swatch'; swatch.setAttribute(mark, color); swatch.setAttribute('data-ccld-choice', color);
        swatch.setAttribute('role', 'menuitemradio'); swatch.setAttribute('aria-label', value.name);
        const dot = document.createElement('span'); dot.setAttribute('aria-hidden', 'true'); swatch.prepend(dot);
        grid.append(swatch);
      }
      const reset = button('恢复默认', () => setColor(project.key, null), events.signal); reset.setAttribute('role', 'menuitem'); reset.setAttribute('data-ccld-choice', 'default');
      section.append(title, grid, reset);
      section.addEventListener('pointerdown', event => event.stopPropagation(), { signal: events.signal });
      section.addEventListener('keydown', event => {
        const buttons = [...section.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
        if (['ArrowLeft','ArrowRight','ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key)) {
          event.stopPropagation(); event.preventDefault();
          if (event.key === 'Enter' || event.key === ' ') document.activeElement.click();
          else buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length]?.focus();
        }
      }, { signal: events.signal });
      menu.append(section);
    }
    for (const section of document.querySelectorAll('[data-ccld-owner="palette"]')) {
      for (const swatch of section.querySelectorAll('[role="menuitemradio"]')) {
        const checked = String(config.projects[section.getAttribute('data-ccld-project')] === swatch.getAttribute('data-ccld-choice'));
        if (swatch.getAttribute('aria-checked') !== checked) swatch.setAttribute('aria-checked', checked);
        swatch.disabled = !storageHealthy || !connected;
      }
    }
    updateText();
  }
  function schedule() { if (!destroyed && !frame) frame = requestAnimationFrame(() => { frame = 0; refresh(); }); }
  const observer = new MutationObserver(records => {
    const relevant = `${adapter.selectors.project},${adapter.selectors.thread},[role="menu"],[${mark}],[data-ccld-owner="palette"],[data-app-navigation-rail="true"],button[aria-label="打开个人资料菜单"]`;
    if (records.some(record => {
      if (record.type === 'attributes') return !record.target.closest(`[${owner}]`) && !record.attributeName.startsWith('data-ccld-');
      if (record.target.closest?.(`[${owner}]`)) return false;
      if (record.target.closest?.(`${adapter.selectors.project},${adapter.selectors.thread},[role="menu"]`)) return true;
      return [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && !node.hasAttribute?.(owner) &&
        (node.matches(relevant) || node.querySelector(relevant)));
    })) schedule();
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: [
    'data-app-action-sidebar-project-id', 'data-app-action-sidebar-project-label', 'data-app-action-sidebar-project-collapsed',
    'data-app-action-sidebar-thread-id', 'data-app-action-sidebar-thread-kind', 'data-app-action-sidebar-thread-host-id',
    'data-app-action-sidebar-thread-pinned', 'data-sidebar-project-container-id', 'data-sidebar-project-kind', 'aria-expanded', 'aria-labelledby',
    'data-thread-title', 'data-thread-title-trigger',
    'data-app-navigation-rail', 'aria-label',
  ] });
  window.addEventListener('storage', event => {
    if (event.key !== preferences.key) return;
    try { config = preferences.load(); storageHealthy = true; error = ''; dismissRandomUndo(); } catch (e) { storageHealthy = false; error = e.message; }
    refresh();
  }, { signal: controller.signal });
  const lease = setInterval(() => { if (Date.now() - heartbeat > (options.leaseMs ?? 15000) && connected) { connected = false; refresh(); } }, 2000);
  function destroy() {
    if (destroyed) return;
    destroyed = true; observer.disconnect(); controller.abort(); clearInterval(lease); cancelAnimationFrame(frame);
    clearTimeout(pendingSave?.timer); pendingSave = null;
    clearTimeout(undoTimer); undoTimer = null; randomUndo = null;
    clearTimeout(pendingCommand?.timer); pendingCommand = null;
    clearTimeout(pendingUI?.timer);pendingUI=null;
    for (const events of menuControllers.values()) events.abort();
    menuControllers.clear();
    for (const element of ownedNodes) clearMark(element);
    ownedNodes.clear();
    for (const element of document.querySelectorAll(`[${owner}]`)) element.remove();
    style.remove();
    widget.remove(); panel?.remove();
    if (window[globalKey] === api) delete window[globalKey];
  }
  const api = {
    refresh, pause, resume, destroy, setColor, randomizeColors, undoRandomize, clearColors, setQuotaVisible, stopRequested: false,
    product: options.product ?? 'demo',
    getPreferences() { return preferences.validate(config); },
    getUISettings(){return{...uiSettings};},
    uiSettingsAck(token,value,ok,message=''){
      if(token!==options.sessionToken||pendingUI?.revision!==value)return false;
      clearTimeout(pendingUI.timer);pendingUI=null;uiError=ok?'':`显示设置保存失败：${message}`;updateText();return true;
    },
    commandAck(token, id, ok, message = '') {
      if (token !== options.sessionToken || pendingCommand?.id !== id) return false;
      clearTimeout(pendingCommand.timer); pendingCommand = null;
      commandError = ok ? '' : `打开配色文件失败：${message}`; updateText(); return true;
    },
    persistenceAck(token, value, ok, message = '') {
      if (token !== options.sessionToken || pendingSave?.revision !== value) return false;
      clearTimeout(pendingSave.timer); pendingSave = null;
      persistenceError = ok ? '' : `本机保存失败：${message}。当前更改可能在重开后丢失。`;
      updateText(); return true;
    },
    async flushPersistence() {
      const deadline = Date.now() + 8500;
      while (pendingSave && !destroyed && Date.now() < deadline) await new Promise(resolve => window.setTimeout(resolve, 50));
      return !pendingSave && !persistenceError && !error;
    },
    async flushUISettings(){const deadline=Date.now()+8500;while(pendingUI&&!destroyed&&Date.now()<deadline)await new Promise(resolve=>window.setTimeout(resolve,50));return !pendingUI&&!uiError;},
    heartbeat() { heartbeat = Date.now(); if (!connected) { connected = true; refresh(); } else mountControls(); return this.status(); },
    status() { return { version: 1, connected, ready: current.ready, partial: current.partial, paused: config.paused, error: error || persistenceError, saving: Boolean(pendingSave), product: this.product,
      controlReady: !inlineControls || widget.isConnected, showQuota:uiSettings.showQuota, uiError,
      projectCount: current.projects.length, coloredCount: ownedNodes.size, refreshCount, destroyed }; },
  };
  window[globalKey] = api; refresh(); return api.status();
}
