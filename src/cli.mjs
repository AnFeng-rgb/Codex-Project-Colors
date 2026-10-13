import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { settings } from './settings.mjs';
import { PreferenceStore, atomicWrite } from './preferences-store.mjs';
import { discover, Session, isMainTarget } from '../demo/core/cdp.mjs';
import {configureInstallation,installationStatus} from './installation.mjs';

const action=process.argv[2]??'status';
let opts;
const exists=file=>fs.access(file).then(()=>true).catch(()=>false);
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
async function readState(){
  const state=await fs.readFile(path.join(opts.runtime,'status.json'),'utf8').then(JSON.parse).catch(()=>({status:'已停止',detail:'尚未开启配色'}));
  const pid=Number(await fs.readFile(path.join(opts.runtime,'agent.lock/pid'),'utf8').catch(()=>'0'));
  if(!pid||!alive(pid))return{...state,status:state.status==='未连接'?'未连接':'已停止',renderer:state.renderer?{...state.renderer,connected:false}:undefined,running:false};
  if(!Number.isFinite(Date.parse(state.updatedAt))||Date.now()-Date.parse(state.updatedAt)>12000)return{
    ...state,status:'未连接',detail:'后台未及时更新状态，等待恢复；配色文件保留。',renderer:{...state.renderer,connected:false},running:true,
  };
  return{...state,running:true};
}
async function stopDirectory(runtime){
  const lock=path.join(runtime,'agent.lock');if(!await exists(lock))return;
  const pid=Number(await fs.readFile(path.join(lock,'pid'),'utf8').catch(()=>'0'));
  if(pid&&!alive(pid)){await fs.rm(lock,{recursive:true});return;}
  await fs.writeFile(path.join(runtime,'stop-request'),'stop');
  for(let i=0;i<40;i++){if(!await exists(lock)&&(!pid||!alive(pid)))return;await delay(250);}
  throw new Error('后台尚未确认停止；没有强制结束进程，请稍后重试');
}
async function control(method){
  const session=new Session((await discover(opts.port,opts.targetURL,{preferredURL:opts.windowURL})).webSocketDebuggerUrl);await session.connect();
  try{return await session.evaluate(async method=>{
    const api=window.__codexColorLabelsDemo;if(api?.product!=='color-labels.v1')throw new Error('正式版尚未连接');
    const operation=method==='clear'?'clearColors':method;
    if(!api[operation]())throw new Error(api.status().error||'操作没有完成');
    if(!await api.flushPersistence())throw new Error(api.status().error||'保存没有得到确认');
    return api.status();
  },method);}finally{session.close();}
}
try{
  opts=await settings();await fs.mkdir(opts.runtime,{recursive:true});
  let result;
  if(['install-auto','enable-auto','disable-auto','uninstall-auto'].includes(action)){
    const argument=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
    result={status:'设置已完成',...await configureInstallation(action.replace('-auto',''),{bundle:argument('--bundle'),importData:argument('--import-data')})};
  }else if(action==='windows'){
    const list=await(await fetch(`http://127.0.0.1:${opts.port}/json/list`,{signal:AbortSignal.timeout(3000),redirect:'error'})).json();
    if(!Array.isArray(list))throw new Error('本机调试窗口列表无效');
    result={status:'请选择连接窗口',windows:list.filter(t=>isMainTarget(t,opts.targetURL)).map(t=>({title:t.title||'Codex 主窗口',url:t.url}))};
  }else if(action==='select-window'){
    const url=process.argv[3];
    await discover(opts.port,opts.targetURL,{preferredURL:url});
    await stopDirectory(opts.runtime);
    const file=path.join(opts.dataDir,'settings.json');
    const config=await fs.readFile(file,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return{};throw e;});
    await atomicWrite(file,JSON.stringify({...config,windowURL:url},null,2)+'\n');
    if((await installationStatus()).automatic)await configureInstallation('enable');
    result={status:'已停止',detail:'已记住连接窗口，点击开启配色。',running:false};
  }else if(action==='status')result={...await readState(),installation:await installationStatus()};
  else if(action==='start'||action==='start-passive'){
    await new PreferenceStore(opts.dataDir).read();
    const before=await readState();
    if(before.running&&before.renderer?.connected&&before.renderer?.ready)result={...before,alreadyRunning:true};
    else {
      // A live helper can outlast the application; an explicit retry replaces it.
      await stopDirectory(opts.runtime);
      await stopDirectory(opts.legacyRuntime);
      const log=path.join(opts.runtime,'agent.log');
      const size=await fs.stat(log).then(s=>s.size).catch(()=>0);
      if(size>1000000)await fs.rename(log,`${log}.previous`);
      const descriptor=fss.openSync(log,'a',0o600);
      const child=spawn(process.execPath,[path.join(path.dirname(fileURLToPath(import.meta.url)),'agent.mjs'),'--data-dir',opts.dataDir,...(action==='start-passive'?['--passive']:[])],{detached:true,stdio:['ignore',descriptor,descriptor]});
      const launchedPid=child.pid;child.unref();fss.closeSync(descriptor);
      for(let i=0;i<60;i++){
        result=await readState();
        if(result.pid===launchedPid&&(((action==='start-passive'||result.status!=='未连接')&&result.running)||(!result.running&&result.detail)))break;
        await delay(250);
      }
      if(!result?.running)throw new Error(result?.detail||'后台未启动，请查看运行记录');
    }
  }else if(action==='stop'){
    await stopDirectory(opts.runtime);result={...(await readState()),status:'已停止',detail:'已停止上色，保存的配色保留。调试端口仍可能开启。'};
  }else if(['pause','resume','clear'].includes(action))result={status:'已连接',renderer:await control(action)};
  else if(action==='restore-backup'){
    await stopDirectory(opts.runtime);await new PreferenceStore(opts.dataDir).restoreBackup();if((await installationStatus()).automatic)await configureInstallation('enable');result={status:'已恢复',detail:'已恢复上一份备份，原文件保留；自动配色启用时会重新连接。'};
  }else throw new Error('未知操作');
  console.log(JSON.stringify({ok:true,...result,dataDir:opts.dataDir}));
}catch(error){
  const state=opts?await readState().catch(()=>({})):{};
  console.log(JSON.stringify({...state,ok:false,status:'操作未完成',detail:error.message}));process.exitCode=1;
}
