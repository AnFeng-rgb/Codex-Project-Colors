import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreferences } from './preferences.mjs';
import { validateEndpoint, isMainTarget, discover } from './cdp.mjs';
import { createServer } from 'node:http';

function memory() {
  const map = new Map([['other-tool', 'keep']]);
  return { map, getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v), removeItem: k => map.delete(k) };
}
test('配置按身份隔离；暂停保留；清除只作用于自身键', () => {
  const store = memory(), p = createPreferences(store);
  const projects = { 'local:first': 'purple', 'local:second': 'blue' };
  p.save({ version: 1, paused: true, projects });
  assert.deepEqual(p.load().projects, projects);
  assert.equal(p.load().paused, true);
  const next = p.load(); delete next.projects['local:first']; p.save(next);
  assert.equal(p.load().projects['local:second'], 'blue');
  p.clear(); assert.deepEqual(p.load(), p.empty()); assert.equal(store.getItem('other-tool'), 'keep');
});
test('拒绝损坏、未知版本、非法颜色、未知身份和原型键；不覆盖原值', () => {
  const store = memory(), p = createPreferences(store);
  for (const value of ['invalid', '{"version":2,"paused":false,"projects":{}}',
    '{"version":1,"paused":false,"projects":{"local:first":"pink"}}',
    '{"version":1,"paused":false,"projects":{"__proto__":"blue"}}',
    '{"version":1,"paused":false,"projects":{"cloud:first":"blue"}}']) {
    store.setItem(p.key, value); assert.throws(() => p.load()); assert.equal(store.getItem(p.key), value);
  }
});
test('写入失败及读回不匹配不会报告成功', () => {
  const store = memory(), p = createPreferences(store);
  store.setItem = () => { throw new Error('quota exceeded'); };
  assert.throws(() => p.save(p.empty())); assert.deepEqual(p.load(), p.empty());
  store.setItem = () => {};
  assert.throws(() => p.save(p.empty()));
});
test('CDP 只接受本机明文接口，无凭据；拒绝网络地址', () => {
  assert.equal(validateEndpoint('ws://127.0.0.1:39222/devtools/page/test', 'ws:').hostname, '127.0.0.1');
  for (const url of ['ws://192.168.1.3:39222/x','ws://127.0.0.1.evil.test/x','wss://127.0.0.1/x','ws://user:pass@localhost/x']) assert.throws(() => validateEndpoint(url,'ws:'));
});
test('排除头像浮层、独立窗口、网页和 iframe', () => {
  assert.equal(isMainTarget({ type:'page',url:'app://-/index.html' }),true);
  for (const target of [
    {type:'page',url:'app://-/index.html?initialRoute=%2Favatar-overlay'},
    {type:'page',url:'app://-/detached-window.html'},
    {type:'page',url:'https://example.com/index.html'},
    {type:'iframe',url:'app://-/index.html'},
    {type:'page',url:'app://other/index.html'},
  ]) assert.equal(isMainTarget(target),false);
});
test('发现接口拒绝未知服务、多个主窗口、非本机 WebSocket 和重定向', async () => {
  let status=200, body='[]';
  const server=createServer((req,res)=>{res.writeHead(status,{'Content-Type':'application/json',Location:'http://example.com/'});res.end(body);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  try {
    const target={id:'one',type:'page',url:'app://-/index.html',webSocketDebuggerUrl:`ws://127.0.0.1:${port}/devtools/page/one`};
    await assert.rejects(discover(port),/未找到/);
    body=JSON.stringify([target]);assert.equal((await discover(port)).id,'one');
    body=JSON.stringify([target,{...target,id:'two'}]);await assert.rejects(discover(port),/多个主窗口/);
    body=JSON.stringify([target,{...target,id:'two',url:'app://-/index.html?initialRoute=%2Flocal%2Fother'}]);
    assert.equal((await discover(port,undefined,{preferredURL:'app://-/index.html'})).id,'one');
    await assert.rejects(discover(port,undefined,{preferredURL:'app://-/index.html?missing'}),/未找到/);
    body=JSON.stringify([{...target,webSocketDebuggerUrl:'ws://192.168.1.2/devtools/page/one'}]);await assert.rejects(discover(port),/非本机/);
    body='{"hello":"unknown service"}';await assert.rejects(discover(port),/不是调试窗口列表/);
    status=302;await assert.rejects(discover(port));
  } finally {await new Promise(resolve=>server.close(resolve));}
});
