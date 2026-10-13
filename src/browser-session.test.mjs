import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { once } from 'node:events';
import { PreferenceStore } from './preferences-store.mjs';
import { browserIdentity, preferencesForSession } from './browser-session.mjs';

test('同一应用启动保留手动停止，新应用启动恢复默认上色且保留项目颜色',async()=>{
  const root=fileURLToPath(new URL('../verification/release/',import.meta.url));
  const dir=await fs.mkdtemp(path.join(root,'browser-session-test-'));
  try{
    const store=new PreferenceStore(dir),original={version:1,paused:true,projects:{'local:project-a':'orange'}};
    await store.write(original);
    assert.deepEqual(await preferencesForSession(store,path.join(dir,'runtime'),'browser-first'),{...original,paused:false});
    await store.write(original);const saved=await fs.readFile(store.file,'utf8');
    assert.deepEqual(await preferencesForSession(store,path.join(dir,'runtime'),'browser-first'),original);
    assert.equal(await fs.readFile(store.file,'utf8'),saved);
    assert.deepEqual(await preferencesForSession(store,path.join(dir,'runtime'),'browser-second'),{...original,paused:false});
    assert.deepEqual(await store.read(),{...original,paused:false});
  }finally{await fs.rm(dir,{recursive:true});}
});

test('应用会话身份只接受同端口本机浏览器地址',async()=>{
  let endpoint;
  const server=http.createServer((request,response)=>response.end(JSON.stringify({webSocketDebuggerUrl:endpoint})));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const port=server.address().port;
  try{
    endpoint=`ws://127.0.0.1:${port}/devtools/browser/session-one`;assert.equal(await browserIdentity(port),'/devtools/browser/session-one');
    for(const value of [`ws://example.com:${port}/devtools/browser/session-one`,`ws://127.0.0.1:${port+1}/devtools/browser/session-one`,
      `ws://127.0.0.1:${port}/devtools/page/session-one`,`ws://127.0.0.1:${port}/devtools/browser/session-one?unexpected=1`]){
      endpoint=value;await assert.rejects(browserIdentity(port));
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
});
