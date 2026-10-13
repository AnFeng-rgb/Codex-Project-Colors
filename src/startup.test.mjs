import test from 'node:test';
import assert from 'node:assert/strict';
import {StartupController} from './startup/controller.mjs';
function fixture({existing=false}={}){
  let now=10000;const app={pid:100,key:'100:9990',launchedAt:9990,finishedLaunching:true,argumentsKnown:true,debugPort:null};
  const state={apps:existing?[app]:[],frontmostPid:100,inputIdleMs:100,inputStamp:'same'},events=[];let quits=0,launches=0,occupied=false;
  const adapter={snapshot:async()=>structuredClone(state),portInUse:async()=>occupied,record:async(event,details)=>events.push({event,...details}),quit:async()=>{quits++;state.apps=[];state.frontmostPid=50;return{accepted:true};},launch:async()=>{launches++;state.apps=[{...app,pid:101,key:'101:new',debugPort:'39222'}];return{launched:true,key:'101:new',pid:101};},show:async()=>({shown:true})};
  const controller=new StartupController(adapter,{now:()=>now,sleep:async ms=>{now+=ms;}});
  return{app,state,events,adapter,controller,counts:()=>({quits,launches}),setOccupied:value=>occupied=value,advance:ms=>now+=ms};
}
test('只对新启动、未操作的前台实例正常重开一次；重开实例不循环',async()=>{
  const f=fixture();await f.controller.tick();f.state.apps=[f.app];await f.controller.tick();await f.controller.tick();assert.deepEqual(f.counts(),{quits:1,launches:1});assert.equal(f.events.at(-1).event,'reopened');
});
test('启动观察助手不退出已存在的工作窗口',async()=>{const f=fixture({existing:true});await f.controller.tick();await f.controller.tick();assert.deepEqual(f.counts(),{quits:0,launches:0});});
for(const [name,mutate] of [
  ['输入已发生',f=>f.state.inputIdleMs=0],['不在前台',f=>f.state.frontmostPid=50],['超过启动窗口',f=>f.advance(9000)],
  ['已有调试参数',f=>f.app.debugPort='39222'],['无法确认参数',f=>f.app.argumentsKnown=false],['多个实例',f=>f.state.apps.push({...f.app,key:'other',pid:200})],['端口已占用',f=>f.setOccupied(true)],
])test(`${name}时不退出官方应用`,async()=>{const f=fixture();await f.controller.tick();f.state.apps=[f.app];mutate(f);await f.controller.tick();assert.deepEqual(f.counts(),{quits:0,launches:0});});
test('初始化未完成等待，完成后才请求退出',async()=>{const f=fixture();await f.controller.tick();f.app.finishedLaunching=false;f.state.apps=[f.app];await f.controller.tick();assert.equal(f.controller.pendingLaunch,true);assert.equal(f.counts().quits,0);f.app.finishedLaunching=true;await f.controller.tick();assert.equal(f.counts().launches,1);});
test('退出被拒绝后不强制结束或重新打开',async()=>{const f=fixture();await f.controller.tick();f.state.apps=[f.app];f.adapter.quit=async()=>({accepted:false});await f.controller.tick();assert.equal(f.counts().launches,0);assert.equal(f.events.at(-1).event,'quit-refused');});
test('退出过程中出现输入时取消重开',async()=>{const f=fixture();await f.controller.tick();f.state.apps=[f.app];f.adapter.quit=async()=>{f.state.apps=[];f.state.inputStamp='changed';return{accepted:true};};await f.controller.tick();assert.equal(f.counts().launches,0);assert.equal(f.events.at(-1).event,'canceled-by-input');});
test('冷却记录和持久化失败均阻止重复退出',async()=>{const f=fixture();await f.controller.tick();f.state.apps=[f.app];f.controller.lastAttemptAt=9999;await f.controller.tick();assert.equal(f.counts().quits,0);const g=fixture();await g.controller.tick();g.state.apps=[g.app];g.adapter.record=async event=>{if(event==='attempt')throw Error('disk');};await g.controller.tick();assert.equal(g.counts().quits,0);});
test('停用观察助手后不执行退出和启动',async()=>{const f=fixture();await f.controller.tick();f.state.apps=[f.app];f.controller.stop();await f.controller.tick();assert.deepEqual(f.counts(),{quits:0,launches:0});});
