import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile,spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import net from 'node:net';
const exec=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
test('自动模式快速进入等待，不主动打开应用，停止后无残留',async()=>{
 const dir=await fs.mkdtemp(path.join(root,'verification/release/passive-test-'));try{
 const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(resolve=>server.close(resolve));
 await fs.writeFile(path.join(dir,'settings.json'),JSON.stringify({port,appPath:path.join(dir,'absent.app')}));
 const start=Date.now();const state=JSON.parse((await exec(process.execPath,[path.join(root,'src/cli.mjs'),'start-passive','--data-dir',dir],{timeout:4000})).stdout);assert.equal(state.running,true);assert.ok(Date.now()-start<4000);
 assert.equal(state.renderer?.connected??false,false);await exec(process.execPath,[path.join(root,'src/cli.mjs'),'stop','--data-dir',dir]);assert.equal(await fs.access(path.join(dir,'runtime/agent.lock')).then(()=>true).catch(()=>false),false);
 }finally{await exec(process.execPath,[path.join(root,'src/cli.mjs'),'stop','--data-dir',dir]).catch(()=>{});await fs.rm(dir,{recursive:true});}
});
test('已退出或状态超时的后台不会显示连接成功',async()=>{
  const dir=await fs.mkdtemp(path.join(root,'verification/release/status-test-'));
  try{
    const runtime=path.join(dir,'runtime');await fs.mkdir(path.join(runtime,'agent.lock'),{recursive:true});
    const result=async()=>JSON.parse((await exec(process.execPath,[path.join(root,'src/cli.mjs'),'status','--data-dir',dir])).stdout);
    await fs.writeFile(path.join(runtime,'agent.lock/pid'),String(process.pid));
    await fs.writeFile(path.join(runtime,'status.json'),JSON.stringify({status:'已连接',updatedAt:new Date(Date.now()-60000).toISOString(),renderer:{connected:true,ready:true}}));
    const stale=await result();assert.equal(stale.status,'未连接');assert.equal(stale.renderer.connected,false);
    const child=spawn(process.execPath,['-e','process.exit(0)']);await once(child,'close');
    await fs.writeFile(path.join(runtime,'agent.lock/pid'),String(child.pid));
    const exited=await result();assert.equal(exited.status,'已停止');assert.equal(exited.running,false);assert.equal(exited.renderer.connected,false);
  }finally{await fs.rm(dir,{recursive:true});}
});

test('已连接时重复开启沿用后台；断开时重新开启会停止旧后台并报告真实启动错误',async()=>{
  const dir=await fs.mkdtemp(path.join(root,'verification/release/recovery-test-'));
  let helper;
  try{
    const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');
    const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
    const runtime=path.join(dir,'runtime'),lock=path.join(runtime,'agent.lock');
    await fs.mkdir(lock,{recursive:true});
    await fs.writeFile(path.join(dir,'settings.json'),JSON.stringify({port,appPath:path.join(dir,'absent.app')}));
    const script=`const fs=require('node:fs'),path=require('node:path');
      const runtime=process.argv[1],lock=path.join(runtime,'agent.lock');
      fs.writeFileSync(path.join(lock,'pid'),String(process.pid));
      console.log('ready');
      setInterval(()=>{if(fs.existsSync(path.join(runtime,'stop-request'))){fs.rmSync(lock,{recursive:true});process.exit(0);}},25);`;
    helper=spawn(process.execPath,['-e',script,runtime]);await once(helper.stdout,'data');
    const close=once(helper,'close');
    const state={pid:helper.pid,status:'已连接',updatedAt:new Date().toISOString(),renderer:{connected:true,ready:true,paused:true}};
    await fs.writeFile(path.join(runtime,'status.json'),JSON.stringify(state));
    const args=[path.join(root,'src/cli.mjs'),'start','--data-dir',dir,'--legacy-runtime',path.join(dir,'legacy')];
    const healthy=JSON.parse((await exec(process.execPath,args)).stdout);
    assert.equal(healthy.alreadyRunning,true);assert.equal(healthy.pid,helper.pid);
    assert.equal(healthy.renderer.paused,true);
    await fs.writeFile(path.join(runtime,'status.json'),JSON.stringify({...state,status:'未连接',renderer:{connected:false}}));
    let failed;
    try{await exec(process.execPath,args);assert.fail('无应用路径必须返回失败');}
    catch(error){if(!error.stdout)throw error;failed=JSON.parse(error.stdout);}
    assert.equal((await close)[0],0);
    assert.equal(failed.ok,false);assert.equal(failed.running,false);
    assert.notEqual(failed.pid,helper.pid);assert.match(failed.detail,/未找到指定的应用目录/);
    assert.equal(await fs.access(lock).then(()=>true).catch(()=>false),false);
  }finally{
    if(helper&&helper.exitCode===null){helper.kill('SIGTERM');await once(helper,'close');}
    await fs.rm(dir,{recursive:true});
  }
});
