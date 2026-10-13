import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PreferenceStore, decodeRecord } from './preferences-store.mjs';

const root=new URL('../verification/release/',import.meta.url);
await fs.mkdir(root,{recursive:true});
async function directory(){return fs.mkdtemp(path.join(fileURLToPath(root),'store-test-'));}
const config=color=>({version:1,paused:false,projects:{'local:sample':color}});
test('原子保存、上一版备份、按顺序写入和本机文件权限',async()=>{
  const dir=await directory();try{
    const store=new PreferenceStore(dir);assert.equal(await store.read(),null);
    await store.write(config('blue'));
    await Promise.all([store.write(config('purple')),store.write(config('green'))]);
    assert.deepEqual(await store.read(),config('green'));assert.deepEqual(await store.read(store.backup),config('purple'));
    assert.equal((await fs.stat(store.file)).mode&0o777,0o600);
    assert.equal((await fs.readdir(dir)).some(file=>file.endsWith('.tmp')),false);
  }finally{await fs.rm(dir,{recursive:true});}
});
test('校验损坏时保留原文件和备份，显式恢复留下原文件副本',async()=>{
  const dir=await directory();try{
    const store=new PreferenceStore(dir);await store.write(config('blue'));await store.write(config('purple'));
    const raw=await fs.readFile(store.file,'utf8');await fs.writeFile(store.file,raw.replace('purple','red'));
    await assert.rejects(store.read(),/校验失败/);await assert.rejects(store.write(config('green')),/校验失败/);
    assert.deepEqual(await store.read(store.backup),config('blue'));
    await store.restoreBackup();assert.deepEqual(await store.read(),config('blue'));
    assert.equal((await fs.readdir(dir)).filter(file=>file.includes('before-restore')).length,1);
  }finally{await fs.rm(dir,{recursive:true});}
});
test('拒绝未知格式和非法色值',()=>{
  assert.throws(()=>decodeRecord('{"formatVersion":2}'));
  assert.throws(()=>decodeRecord('{"formatVersion":1,"preferences":{"version":1,"paused":false,"projects":{"local:sample":"invalid"}}}'));
});
