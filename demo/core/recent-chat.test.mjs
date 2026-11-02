import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from './adapter.mjs';
import { assessChatMarkerLive } from '../../verification/chat-marker-acceptance.mjs';

const adapter = createAdapter({ querySelectorAll: () => [] });

test('相同来源去重，冲突来源与重复记录保持未知', () => {
  const bootstrap = [
    { threadId: 'same', sourceKind: 'chatgpt' },
    { threadId: 'conflict', sourceKind: 'vscode' },
    { threadId: 'repeat', sourceKind: 'chatgpt' },
    { threadId: 'repeat', sourceKind: 'chatgpt' },
  ];
  const point = [
    { threadId: 'same', sourceKind: 'chatgpt' },
    { threadId: 'conflict', sourceKind: 'chatgpt' },
    { threadId: 'repeat', sourceKind: 'chatgpt' },
  ];
  const merged = adapter.mergeRecentCatalogEntries(bootstrap, point);
  assert.deepEqual(merged.filter(e => e.threadId === 'same').map(e => e.sourceKind), ['chatgpt']);
  assert.deepEqual(merged.filter(e => e.threadId === 'conflict').map(e => e.sourceKind), ['vscode', 'chatgpt']);
  assert.equal(merged.filter(e => e.threadId === 'repeat').length, 2);
  const candidate = id => ({ row: {}, conversationId: id, trialConversationType: null,
    conversationOrigin: null, temporary: false, automation: false });
  assert.deepEqual(adapter.classifyRecentRows([candidate('conflict'), candidate('repeat')], merged), []);
  assert.equal(adapter.classifyRecentRows([candidate('same')], merged).length, 1);
});

test('现场验收需要已识别 Chat 正例，零条不能通过', () => {
  const good = { connected: true, ready: true, quotaMounted: true, quotaVisibilityMatchesSetting: true,
    controlsInSharedCard: true, cardAboveProfile: true, cardVisible: true,
    chatMarkersVisible: true, chatMarkersMatchRows: true, workRowsMarked: 0,
    chatRows: 0, chatMarkers: 0 };
  assert.deepEqual(assessChatMarkerLive([good, good], ['same', 'same']), {
    passed: false, confirmedChatSampleCount: 0, chatPositiveCoverage: false,
  });
  const positive = { ...good, chatRows: 1, chatMarkers: 1 };
  assert.equal(assessChatMarkerLive([positive, good], ['same', 'same']).passed, true);
  assert.equal(assessChatMarkerLive([positive, good], ['same', 'different']).passed, false);
  assert.equal(assessChatMarkerLive([positive, { ...good, workRowsMarked: 1 }], ['same', 'same']).passed, false);
});

test('只把来源唯一且普通 Chat 元数据完整的行识别为 Chat', () => {
  const chatRow = {};
  const workRow = {};
  const matches = adapter.classifyRecentRows([
    { row: chatRow, conversationId: 'chat-id', trialConversationType: null, conversationOrigin: null, temporary: false, automation: false },
    { row: workRow, conversationId: 'work-id', trialConversationType: undefined, conversationOrigin: undefined, temporary: undefined, automation: undefined },
  ], [
    { threadId: 'chat-id', sourceKind: 'chatgpt' },
    { threadId: 'work-id', sourceKind: 'vscode' },
  ]);
  assert.deepEqual(matches, [{ row: chatRow, type: 'chat' }, { row: workRow, type: 'work' }]);
});

test('特殊、缺字段和未知来源的会话均保持未识别', () => {
  const records = [
    { conversationId: 'special', trialConversationType: 'work', conversationOrigin: null, temporary: false, automation: false },
    { conversationId: 'missing', trialConversationType: null, conversationOrigin: null, temporary: false },
    { conversationId: 'unknown-source', trialConversationType: null, conversationOrigin: null, temporary: false, automation: false },
  ];
  const entries = [
    { threadId: 'special', sourceKind: 'chatgpt' },
    { threadId: 'missing', sourceKind: 'chatgpt' },
    { threadId: 'unknown-source', sourceKind: null },
  ];
  assert.deepEqual(adapter.classifyRecentRows(records, entries), []);
});

test('目录 ID 重复或无法对应时不猜测类型', () => {
  const records = [
    { conversationId: 'duplicate', trialConversationType: null, conversationOrigin: null, temporary: false, automation: false },
    { conversationId: 'absent', trialConversationType: null, conversationOrigin: null, temporary: false, automation: false },
  ];
  const entries = [
    { threadId: 'duplicate', sourceKind: 'chatgpt' },
    { threadId: 'duplicate', sourceKind: 'vscode' },
  ];
  assert.deepEqual(adapter.classifyRecentRows(records, entries), []);
});

test('精确的 ChatGPT 服务器侧栏来源可补齐未进入目录缓存的旧 Chat', () => {
  const row = {};
  const record = {
    row, conversationId: 'older-chat', chatgptSidebar: true,
    trialConversationType: null, conversationOrigin: null, temporary: false, automation: false,
  };
  assert.deepEqual(adapter.classifyRecentRows([record], []), [{ row, type: 'chat' }]);
});

test('缺失来源、冲突来源、重复 ID 或特殊类型仍不标记', () => {
  const records = [
    { row: {}, conversationId: 'unknown', chatgptSidebar: false, trialConversationType: null, conversationOrigin: null, temporary: false, automation: false },
    { row: {}, conversationId: 'untrusted', chatgptSidebar: true, trialConversationType: null, conversationOrigin: null, temporary: false, automation: false },
    { row: {}, conversationId: 'duplicate', chatgptSidebar: true, trialConversationType: null, conversationOrigin: null, temporary: false, automation: false },
    { row: {}, conversationId: 'special', chatgptSidebar: true, trialConversationType: 'work', conversationOrigin: null, temporary: false, automation: false },
  ];
  const entries = [
    { threadId: 'untrusted', sourceKind: null },
    { threadId: 'duplicate', sourceKind: 'chatgpt' },
    { threadId: 'duplicate', sourceKind: 'vscode' },
  ];
  assert.deepEqual(adapter.classifyRecentRows(records, entries), []);
});

test('从 React 行属性只提取会话标识及分类字段，不读取标题', () => {
  const conversation = {
    trial_conversation_type: null,
    conversation_origin: null,
    is_temporary_chat: false,
    is_automation_conversation: false,
    get title() { throw new Error('标题不应读取'); },
  };
  const sourceConversation = {
    id: 'private-id', conversation_origin: null, trial_conversation_type: null,
    is_temporary_chat: false, is_automation_conversation: false,
  };
  function tnr() {}
  function nnr() {}
  const sourceFiber = { type: tnr, memoizedProps: { variant: 'sidebar', conversation: sourceConversation }, return: null };
  const row = { __reactFiber$sample: { type: nnr, memoizedProps: { conversationId: 'private-id', conversation }, return: sourceFiber } };
  assert.deepEqual(adapter.conversationIdentity(row), {
    conversationId: 'private-id',
    trialConversationType: null,
    conversationOrigin: null,
    temporary: false,
    automation: false,
    chatgptSidebar: true,
    newSidebarOrdinaryChat: false,
  });
});

test('新版客户端可用精确侧栏归属及完整普通会话形态恢复标记', () => {
  const base = {
    id: 'chat-id', conversation_origin: null, trial_conversation_type: null,
    is_temporary_chat: false, is_do_not_remember: false, gizmo_id: null,
    workspace_id: null, conversation_template_id: null, sugar_item_id: null,
    async_status: null,
  };
  const create = (overrides = {}, propsOverrides = {}, sidebarKey = 'chatgpt:conversation:chat-id') => {
    const conversation = { ...base, ...overrides };
    Object.defineProperty(conversation, 'title', { get() { throw Error('不允许读取会话标题'); } });
    const row = {
      closest: selector => selector === '[data-sidebar-chatgpt-conversation-key]'
        ? { getAttribute: name => name === 'data-sidebar-chatgpt-conversation-key' ? sidebarKey : null }
        : null,
      __reactFiber$new: { memoizedProps: {
        conversationId: 'chat-id', conversation, variant: 'sidebar', hasCloudAutomation: false,
        ...propsOverrides,
      }, return: null },
    };
    return { row, ...adapter.conversationIdentity(row) };
  };
  const match = record => adapter.classifyRecentRows([record], [
    { threadId: 'chat-id', sourceKind: 'chatgpt' },
  ]);
  const ordinary = create();
  assert.equal(ordinary.newSidebarOrdinaryChat, true);
  assert.deepEqual(match(ordinary), [{ row: ordinary.row, type: 'chat' }]);
  // A currently generating ordinary Chat may have a numeric async status.
  assert.equal(match(create({ async_status: 1 })).length, 1);
  const rejected = [
    create({}, { hasCloudAutomation: true }),
    create({}, { hasCloudAutomation: undefined }),
    create({}, { variant: 'project' }),
    create({}, {}, 'chatgpt:conversation:wrong-id'),
    create({ conversation_origin: 'tpp' }),
    create({ trial_conversation_type: 'work' }),
    create({ is_temporary_chat: true }),
    create({ is_do_not_remember: true }),
    create({ gizmo_id: 'custom-gpt' }),
    create({ workspace_id: 'team' }),
    create({ conversation_template_id: 'template' }),
    create({ sugar_item_id: 'special' }),
    create({ async_status: 'invalid' }),
    create({ is_automation_conversation: true }),
  ];
  for (const record of rejected) {
    assert.equal(record.newSidebarOrdinaryChat, false);
    assert.deepEqual(match(record), []);
  }
  assert.deepEqual(adapter.classifyRecentRows([ordinary], [
    { threadId: 'chat-id', sourceKind: 'vscode' },
  ]), [{ row: ordinary.row, type: 'work' }]);
  assert.deepEqual(adapter.classifyRecentRows([ordinary], [
    { threadId: 'chat-id', sourceKind: null },
  ]), []);
});

test('按当前最近列表 ID 只读查询目录来源，且不读取目录标题', async () => {
  const calls = [];
  const pager = {
    hostIds: ['local', 'chatgpt:test'],
    readEntries: async request => {
      calls.push(request);
      return request.filter(item => item.hostId === 'chatgpt:test').map(item => ({
        threadId: item.threadId, sourceKind: 'chatgpt',
        get displayTitle() { throw new Error('标题不应读取'); },
      }));
    },
    getPageState() {}, ensurePage() {}, loadMore() {},
  };
  const row = { __reactFiber$sample: { memoizedState: { memoizedState: pager, next: null }, return: null } };
  const entries = await adapter.readRecentCatalogEntries([{ row, conversationId: 'chat-id' }]);
  assert.deepEqual(entries, [{ threadId: 'chat-id', sourceKind: 'chatgpt' }]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(batch => batch[0].hostId), ['local', 'chatgpt:test']);
});

test('重复的隐藏最近列表不阻断唯一可见列表；两个可见列表时保持未知', () => {
  const trigger = {};
  const row = { closest: () => null, getAttribute: () => null, getBoundingClientRect: () => ({ width: 200, height: 30 }), querySelector: () => trigger };
  const section = width => ({
    closest: () => null,
    getBoundingClientRect: () => ({ width, height: width ? 200 : 0 }),
    querySelectorAll: () => [row],
  });
  const makeAdapter = sections => createAdapter({ querySelectorAll: () => sections, defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) } });
  assert.deepEqual(makeAdapter([section(0), section(220)]).recentRows(), [row]);
  assert.deepEqual(makeAdapter([section(220), section(220)]).recentRows(), []);
});

test('项目清单忽略隐藏副本，保留唯一可见项目的原配色映射', () => {
  const adapterSelectors = createAdapter({ querySelectorAll: () => [], defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) } }).selectors;
  const makeProject = visible => {
    const group = {
      parentElement: null,
      getAttribute: name => name === 'data-sidebar-project-container-id' ? 'project:sample' : name === 'data-sidebar-project-kind' ? 'local' : null,
      getBoundingClientRect: () => ({ width: visible ? 220 : 0, height: visible ? 300 : 0 }),
      querySelectorAll: selector => selector === adapterSelectors.project ? [row] : [],
    };
    const icon = { getBoundingClientRect: () => ({ width: 16, height: 16 }), closest: () => group };
    const trigger = { id: visible ? 'visible-menu' : 'hidden-menu' };
    const row = {
      parentElement: group,
      getAttribute: name => name === 'data-app-action-sidebar-project-id' ? 'sample' : name === 'data-app-action-sidebar-project-label' ? '项目' : null,
      getBoundingClientRect: () => ({ width: visible ? 220 : 0, height: visible ? 30 : 0 }),
      querySelectorAll: selector => selector === '.icon-leading-slot [data-sidebar-project-drop-zone="project-icon"] svg' ? [icon] : [],
      querySelector: selector => selector === 'button[aria-haspopup="menu"][id]' ? trigger : null,
    };
    return row;
  };
  const rows = [makeProject(true), makeProject(false)];
  const doc = {
    querySelectorAll: selector => selector === adapterSelectors.project ? rows : [],
    defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) },
  };
  const inventory = createAdapter(doc).inventory();
  assert.equal(inventory.projectRows, 1);
  assert.equal(inventory.projects.length, 1);
  assert.equal(inventory.partial, false);
});
