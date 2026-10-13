import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FirstUsePalette} from './first-use.mjs';
const root=fileURLToPath(new URL('../verification/release/',import.meta.url));
const fixture=async fn=>{const dir=await fs.mkdtemp(path.join(root,'first-use-test-'));try{await fn(dir);}finally{await fs.rm(dir,{recursive:true});}};
test('首次配色确认后才记录完成，重连和主动清空后不自动重新随机',()=>fixture(async dir=>{
  const first=new FirstUsePalette(dir);let calls=0;
  const session={evaluate:async()=>{calls++;return{complete:true,assigned:true};}};
  assert.equal(await first.apply(session),true);assert.equal(calls,1);
  assert.deepEqual(JSON.parse(await fs.readFile(first.file,'utf8')),{version:1,paletteInitialized:true});
  assert.equal(await first.apply(session),false);assert.equal(await new FirstUsePalette(dir).apply(session),false);assert.equal(calls,1);
}));
test('项目未就绪或保存未确认时保持待初始化，下次成功后完成',()=>fixture(async dir=>{
  const first=new FirstUsePalette(dir);let calls=0;
  const session={evaluate:async()=>({complete:++calls===3,assigned:calls===3})};
  assert.equal(await first.apply(session),false);assert.equal(await fs.access(first.file).then(()=>true).catch(()=>false),false);
  assert.equal(await first.apply(session),false);assert.equal(await first.apply(session),true);assert.equal(calls,3);
}));
test('已迁移的配色或用户关闭状态直接完成初始化，不要求覆盖颜色',()=>fixture(async dir=>{
  const first=new FirstUsePalette(dir);let calls=0;
  const session={evaluate:async()=>{calls++;return{complete:true,assigned:false};}};
  assert.equal(await first.apply(session),false);assert.equal(await new FirstUsePalette(dir).apply(session),false);assert.equal(calls,1);
}));
test('损坏的首次初始化记录不会自动覆盖项目颜色',()=>fixture(async dir=>{
  const first=new FirstUsePalette(dir);await fs.writeFile(first.file,'{"version":999,"paletteInitialized":true}');let calls=0;
  await assert.rejects(first.apply({evaluate:async()=>{calls++;return{complete:true};}}),/格式无效/);assert.equal(calls,0);
}));
