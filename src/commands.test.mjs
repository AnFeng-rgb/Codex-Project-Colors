import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from './commands.mjs';

test('页面文件入口拒绝过期会话、重放、任意路径及未知操作',()=>{
  const request={token:'active',id:1,action:'open-preferences'};
  assert.deepEqual(parseCommand(JSON.stringify(request),'active',0),request);
  for(const value of [null,{...request,token:'stale'},{...request,id:0},{...request,id:1.5},
    {...request,action:'run-shell'},{...request,path:'/another/file'}]){
    assert.equal(parseCommand(JSON.stringify(value),'active',0),null);
  }
  assert.equal(parseCommand(JSON.stringify(request),'active',1),null);
  assert.equal(parseCommand('{broken','active',0),null);
});
