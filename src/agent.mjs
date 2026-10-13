import fs from 'node:fs/promises';
import { VERSION } from './version.mjs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { discover, Session } from '../demo/core/cdp.mjs';
import { createAdapter } from '../demo/core/adapter.mjs';
import { createPreferences } from '../demo/core/preferences.mjs';
import { installRenderer } from '../demo/core/renderer.mjs';
import { ensureApplication } from '../demo/platforms/macos/launch.mjs';
import { PreferenceStore, atomicWrite } from './preferences-store.mjs';
import { settings } from './settings.mjs';
import { parseCommand, revealPreferences } from './commands.mjs';
import { browserIdentity, preferencesForSession } from './browser-session.mjs';
import { FirstUsePalette } from './first-use.mjs';
import { installQuotaRenderer, quotaPresentation } from '../demo/core/quota-renderer.mjs';
import { QuotaClient, normalizeQuota, quotaUnavailable } from './quota.mjs';
import { UISettingsStore,parseUISettingsRequest } from './ui-settings.mjs';

const opts = await settings(), store = new PreferenceStore(opts.dataDir);
const firstPalette = new FirstUsePalette(opts.dataDir);
const uiStore=new UISettingsStore(opts.dataDir);
let uiConfig={version:1,showQuota:true};
const PRODUCT = 'color-labels.v1', BINDING = '__colorLabelsSaveV1', CONTROL = '__colorLabelsCommandV1', STORAGE = 'codex-color-labels.v1';
const UI_BINDING='__colorLabelsUISettingsV1';
const lock = path.join(opts.runtime, 'agent.lock'), stopFile = path.join(opts.runtime, 'stop-request');
let session, token, stopping = false, ownsLock = false, lastStatus = '', fatal = '';
let quotaClient, quotaValue, quotaBusy=false, nextQuotaRead=0;
async function refreshQuota(){
  if(stopping||!session||!uiConfig.showQuota||quotaBusy||Date.now()<nextQuotaRead)return;
  quotaBusy=true;const current=session,currentToken=token;
  let client=quotaClient;
  try{
    if(!client||client.closed){client=new QuotaClient(opts.appPath);quotaClient=client;await client.start();}
    const result=await client.read();
    if(stopping||current!==session||currentToken!==token)return;
    quotaValue=normalizeQuota(result);nextQuotaRead=Date.now()+60000;
  }catch{
    if(quotaClient===client){quotaClient=null;await client?.stop();}
    if(stopping||current!==session||currentToken!==token)return;
    quotaValue=quotaUnavailable(quotaValue);nextQuotaRead=Date.now()+15000;
  }finally{quotaBusy=false;}
  if(current===session&&currentToken===token&&!stopping)await current.evaluate(value=>window.__codexProjectQuota?.update(value),quotaValue).catch(()=>{});
}
async function resetQuota(){const old=quotaClient;quotaClient=null;quotaValue=null;nextQuotaRead=0;await old?.stop();}
await fs.mkdir(opts.runtime, { recursive: true });
const alive = pid => { try { process.kill(pid, 0); return true; } catch(e) { return e.code !== 'ESRCH'; } };
async function publish(status, detail = '', renderer) {
  await atomicWrite(path.join(opts.runtime, 'status.json'), JSON.stringify({ product: PRODUCT, version: VERSION, status, detail, pid: process.pid, updatedAt: new Date().toISOString(), renderer }, null, 2));
  if (lastStatus !== `${status}:${detail}`) { console.log(`${status}${detail ? '：' + detail : ''}`); lastStatus = `${status}:${detail}`; }
}
async function acquire() {
  try { await fs.mkdir(lock); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const pid = Number(await fs.readFile(path.join(lock,'pid'),'utf8').catch(()=>'0'));
    if (!pid || alive(pid)) return false;
    await fs.rm(lock,{recursive:true}); await fs.mkdir(lock);
  }
  ownsLock = true;
  await fs.writeFile(path.join(lock,'pid'),String(process.pid));
  await fs.rm(stopFile,{force:true}); return true;
}
async function connect() {
  const target = await discover(opts.port, opts.targetURL, {preferredURL:opts.windowURL});
  const identity = await browserIdentity(opts.port);
  await resetQuota();
  session?.close(); session = new Session(target.webSocketDebuggerUrl); await session.connect();
  const connectedSession = session, currentToken = randomUUID(); token = currentToken;
  let lastCommandId = 0;
  let lastUIRevision=0,uiSettingsError='';
  await uiStore.queue.catch(()=>{});
  try{uiConfig=await uiStore.read();}catch(e){uiConfig={version:1,showQuota:false};uiSettingsError=e.message;}
  await store.queue.catch(()=>{});
  let initial = await store.read();
  if (!initial) {
    initial = await session.evaluate((current,legacy)=>{
      const raw=localStorage.getItem(current)??localStorage.getItem(legacy);return raw===null?null:JSON.parse(raw);
    },STORAGE,'codex-color-labels.demo.v1');
    initial = createPreferences(null).validate(initial ?? createPreferences(null).empty());
    await store.write(initial);
  }
  initial = await preferencesForSession(store, opts.runtime, identity);
  session.onEvent(message=>{
    if(message.method==='Runtime.bindingCalled'&&message.params?.name===UI_BINDING){
      const request=parseUISettingsRequest(message.params.payload,currentToken,lastUIRevision);
      if(!request||token!==currentToken)return;
      lastUIRevision=request.revision;
      void(async()=>{
        let ok=true,reason='';
        try{await uiStore.write(request.settings);}catch(e){ok=false;reason=e.message;}
        if(token!==currentToken)return;
        if(ok){uiConfig=request.settings;if(!uiConfig.showQuota)await resetQuota();else nextQuotaRead=0;}
        try{await connectedSession.evaluate((key,revision,success,error)=>window.__codexColorLabelsDemo?.uiSettingsAck(key,revision,success,error),currentToken,request.revision,ok,reason);}catch{}
        if(ok&&uiConfig.showQuota)void refreshQuota();
      })();return;
    }
    if(message.method==='Runtime.bindingCalled'&&message.params?.name===CONTROL){
      const command=parseCommand(message.params.payload,currentToken,lastCommandId);
      if(!command||token!==currentToken)return;
      lastCommandId=command.id;
      void(async()=>{
        let ok=true,reason='';
        try{await store.queue;await revealPreferences(opts.dataDir);}catch(e){ok=false;reason=e.message;}
        if(token!==currentToken)return;
        try{await connectedSession.evaluate((key,id,success,error)=>window.__codexColorLabelsDemo?.commandAck(key,id,success,error),currentToken,command.id,ok,reason);}catch{}
      })();return;
    }
    if(message.method!=='Runtime.bindingCalled'||message.params?.name!==BINDING)return;
    void (async()=>{
      let payload;
      try {payload=JSON.parse(message.params.payload);} catch{return;}
      if(payload.token!==currentToken||token!==currentToken||!Number.isSafeInteger(payload.revision)||payload.revision<1)return;
      let ok=true, reason='';
      try {await store.write(payload.preferences);}catch(e){ok=false;reason=e.message;}
      if(token!==currentToken)return;
      try {await connectedSession.evaluate((key,revision,success,error)=>window.__codexColorLabelsDemo?.persistenceAck(key,revision,success,error),currentToken,payload.revision,ok,reason);}catch{}
    })();
  });
  await session.request('Runtime.enable');
  await session.request('Runtime.addBinding',{name:BINDING});
  await session.request('Runtime.addBinding',{name:CONTROL});
  await session.request('Runtime.addBinding',{name:UI_BINDING});
  const options={product:PRODUCT,storageKey:STORAGE,initialPreferences:initial,persistenceBinding:BINDING,controlBinding:CONTROL,sessionToken:currentToken,uiSettings:uiConfig,uiSettingsError,uiPersistenceBinding:UI_BINDING};
  await session.expression(`(${installRenderer.toString()})(${createAdapter.toString()},${createPreferences.toString()},${JSON.stringify(options)})`);
  await session.expression(`(${installQuotaRenderer.toString()})(${createAdapter.toString()},${quotaPresentation.toString()},${JSON.stringify({windows:[],cards:{count:null,details:null},updatedAt:null,stale:true,error:'正在读取额度…'})},${JSON.stringify({visible:uiConfig.showQuota})})`);
  void refreshQuota();
  await firstPalette.apply(session);
  const status=await session.evaluate(()=>window.__codexColorLabelsDemo.status());
  await publish(status.ready?'已连接':'当前界面需要适配',status.error,status);
}
async function launchIfNeeded(error) {
  const occupied=await new Promise(resolve=>{
    const socket=createConnection({host:'127.0.0.1',port:opts.port});
    const done=value=>{socket.destroy();resolve(value);};socket.setTimeout(1500);
    socket.once('connect',()=>done(true));socket.once('timeout',()=>done(true));socket.once('error',e=>done(e.code!=='ECONNREFUSED'));
  });
  if(occupied)throw error;
  await ensureApplication(opts.appPath,opts.port,{entryLabel:'颜色标签管理窗口的“开启配色 / 重新连接”按钮',configurationHint:'配色文件夹中的 settings.json'});
  for(let i=0;i<30;i++){try{await connect();return;}catch(e){if(i===29)throw e;await delay(500);}}
}
if(await acquire()){
  process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
  try {
    await store.read();await publish('未连接','正在连接本机应用');
    try {await connect();}catch(e){if(process.argv.includes('--passive'))await publish('等待应用启动','自动连接已就绪；等待官方应用提供本机接口');else await launchIfNeeded(e);}
    while(!stopping){
      if(await fs.access(stopFile).then(()=>true).catch(()=>false))break;
      try {
        if(!session){await connect();}
        else {
          let state=await session.evaluate(()=>{
            window.__codexProjectQuota?.heartbeat();
            if(window.__codexColorLabelsStopRequested)return{stop:true};
            const api=window.__codexColorLabelsDemo;return api?.product==='color-labels.v1'?api.heartbeat():null;
          });
          if(state?.stop)break;
          if(!state)await connect();
          else {
            void refreshQuota();
            if(await firstPalette.apply(session))state=await session.evaluate(()=>window.__codexColorLabelsDemo.status());
            await publish(!state.ready?'当前界面需要适配':state.error?'保存需要处理':state.paused?'上色已暂停':'已连接',state.error,state);
          }
        }
      }catch(e){
        session?.close();session=null;token=null;
        await resetQuota();
        const reason=e.cause?.code==='ECONNREFUSED'?'本机连接接口未开启':e.message;
        if(process.argv.includes('--passive')&&e.cause?.code==='ECONNREFUSED'){
          const startup=await fs.readFile(path.join(opts.runtime,'startup.json'),'utf8').then(JSON.parse).catch(()=>({}));
          const blocked=['waiting-for-fresh-launch','skipped-active-or-background'].includes(startup.event);
          await publish(blocked?'等待下次正常打开':'等待应用启动',blocked?'当前工作窗口没有本机接口，已保留。保存后完全退出并从官方图标重新打开即可接入。':'启动观察助手等待官方应用启动，配色已保留。');
        }
        else await publish('未连接',`${reason}。当前工作窗口保持；可通过管理程序重新连接或选择窗口。配色已保留。`);
      }
      await delay(2000);
    }
  }catch(e){fatal=e.message;process.exitCode=1;}
  finally {
    token=null;
    await resetQuota();
    await store.queue.catch(()=>{});
    await uiStore.queue.catch(()=>{});
    if(session){
      try{await session.evaluate(()=>{window.__codexProjectQuota?.destroy();if(window.__codexColorLabelsDemo?.product==='color-labels.v1')window.__codexColorLabelsDemo.destroy();delete window.__codexColorLabelsStopRequested;});await session.request('Runtime.removeBinding',{name:BINDING});await session.request('Runtime.removeBinding',{name:CONTROL});await session.request('Runtime.removeBinding',{name:UI_BINDING});}catch{}
      session.close();
    }
    await publish(fatal?'未连接':'已停止',fatal||'上色已停止，配色保留。调试端口需退出并正常打开原应用才能关闭。');
    if(ownsLock){await fs.rm(lock,{recursive:true,force:true});await fs.rm(stopFile,{force:true});}
    // A disconnected Chromium WebSocket can leave its close handshake pending.
    // All writes, renderer cleanup and lock removal have finished at this point.
    process.exit(process.exitCode ?? 0);
  }
}
