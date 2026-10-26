import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from './adapter.mjs';

const adapter = createAdapter({ querySelectorAll: () => [] });

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

test('从 React 行属性只提取会话标识及分类字段，不读取标题', () => {
  const conversation = {
    trial_conversation_type: null,
    conversation_origin: null,
    is_temporary_chat: false,
    is_automation_conversation: false,
    get title() { throw new Error('标题不应读取'); },
  };
  const row = { __reactFiber$sample: { memoizedProps: { conversationId: 'private-id', conversation }, return: null } };
  assert.deepEqual(adapter.conversationIdentity(row), {
    conversationId: 'private-id',
    trialConversationType: null,
    conversationOrigin: null,
    temporary: false,
    automation: false,
  });
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
