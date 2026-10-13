import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {StartupController} from './controller.mjs';
import {settings} from '../settings.mjs';
import {atomicWrite} from '../preferences-store.mjs';

const observedAt=Date.now();
const exec=promisify(execFile),opts=await settings();
const src=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bridge=process.env.COLOR_LABELS_BRIDGE??path.resolve(src,'../../startup-bridge');
const receipt=path.join(opts.runtime,'startup.json');
let state=await fs.readFile(receipt,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return{};throw error;});
if(!Number.isFinite(state.lastAttemptAt??0))throw Error('启动记录损坏；未尝试重开应用');
// Preserve only the durable cooldown across observer sessions, not old outcome fields.
state={lastAttemptAt:state.lastAttemptAt??0};
const abort=new AbortController();
const native=async(action,...args)=>JSON.parse((await exec(bridge,[action,opts.appPath,...args.map(String)],{timeout:35000,maxBuffer:65536,signal:abort.signal})).stdout);
const adapter={
  snapshot:()=>native('snapshot'),quit:(app,stamp,boot)=>native('quit',app.pid,app.key,stamp,...(boot?['boot']:[])),
  launch:(stamp,frontmost)=>native('launch',stamp,frontmost,opts.port),
  show:(app,stamp,frontmost)=>native('show',app.pid,app.key,stamp,frontmost,opts.port),
  portInUse:()=>new Promise(resolve=>{const socket=net.createConnection({host:'127.0.0.1',port:opts.port});let finished=false;const done=value=>{if(finished)return;finished=true;socket.destroy();resolve(value);};socket.once('connect',()=>done(true));socket.once('error',error=>done(error.code!=='ECONNREFUSED'));socket.setTimeout(500,()=>done(true));}),
  async record(event,details={}){state={...state,...details,event,watcherPID:process.pid,updatedAt:Date.now()};await atomicWrite(receipt,JSON.stringify(state,null,2)+'\n');console.log(event);},
};
const controller=new StartupController(adapter,{lastAttemptAt:state.lastAttemptAt??0,observedAt});
let stopped=false,pumping=false,pendingTimer,agentPending=false;
const snapshots=[];
async function ensureAgent(){const pid=Number(await fs.readFile(path.join(opts.runtime,'agent.lock/pid'),'utf8').catch(()=>'0'));let live=false;try{if(pid){process.kill(pid,0);live=true;}}catch{}if(!live)await exec(process.execPath,[path.join(src,'cli.mjs'),'start-passive','--data-dir',opts.dataDir]);}
function keepAgent(){if(agentPending||stopped)return;agentPending=true;initializing=ensureAgent().catch(error=>adapter.record('agent-error',{message:error.message})).finally(()=>{agentPending=false;});}
async function pump(snapshot){if(snapshot)snapshots.push(snapshot);if(pumping||stopped)return;pumping=true;clearTimeout(pendingTimer);try{do{await controller.tick(snapshots.shift());}while(snapshots.length&&!stopped);}catch(error){await adapter.record('error',{message:error.message}).catch(()=>{});}finally{pumping=false;if(controller.pendingLaunch&&!stopped)pendingTimer=setTimeout(()=>void pump(),300);}}
let observer,lines,initializing;
async function shutdown(code=0){if(stopped)return;stopped=true;controller.stop();clearTimeout(pendingTimer);abort.abort();observer?.kill('SIGTERM');lines?.close();await initializing?.catch(()=>{});await exec(process.execPath,[path.join(src,'cli.mjs'),'stop','--data-dir',opts.dataDir]).catch(()=>{});process.exit(code);}
process.once('SIGTERM',()=>void shutdown());process.once('SIGINT',()=>void shutdown());
// Observe first. Starting the passive worker must not delay launch observations
// or replace the initial snapshot with a later resample that loses the launch.
if(!stopped){
 observer=spawn(bridge,['watch',opts.appPath],{stdio:['ignore','pipe','pipe']});
 lines=createInterface({input:observer.stdout});
 lines.on('line',line=>{try{const snapshot=JSON.parse(line);if(!Array.isArray(snapshot.apps))throw Error('Invalid snapshot');void pump(snapshot);keepAgent();}catch{void shutdown(1);}});
 observer.once('error',()=>void shutdown(1));observer.once('exit',()=>{if(!stopped)void shutdown(1);});
 keepAgent();
}
