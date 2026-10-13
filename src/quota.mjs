import path from 'node:path';
import { VERSION } from './version.mjs';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

// Only public account/rateLimits/read fields enter the renderer. No auth data,
// credit IDs, raw responses or account identifiers are stored on disk.
export function normalizeQuota(raw, now=Date.now()) {
  const buckets=raw?.rateLimitsByLimitId;
  const bucket=buckets?.codex??(!buckets||Object.keys(buckets).length===0?raw?.rateLimits:null);
  const windows=[];
  for(const value of [bucket?.primary,bucket?.secondary]){
    const minutes=value?.windowDurationMins,used=value?.usedPercent;
    if(typeof used!=='number'||!Number.isFinite(used)||!Number.isFinite(minutes)||minutes<=0)continue;
    const kind=minutes===300?'five-hour':minutes===10080?'weekly':'other';
    if(windows.some(w=>w.minutes===minutes))continue;
    windows.push({kind,minutes,label:kind==='five-hour'?'5小时':kind==='weekly'?'本周':minutes<60?`${minutes}分钟`:minutes<1440?`${minutes/60}小时`:`${minutes/1440}天`,remaining:Math.max(0,Math.min(100,100-used)),resetsAt:Number.isFinite(value.resetsAt)&&value.resetsAt>0?value.resetsAt:null});
  }
  windows.sort((a,b)=>a.minutes-b.minutes);
  const earned=raw?.rateLimitResetCredits;
  const count=Number.isSafeInteger(earned?.availableCount)&&earned.availableCount>=0?earned.availableCount:null;
  const details=Array.isArray(earned?.credits)?earned.credits.filter(c=>c?.status==='available').map(c=>({expiresAt:Number.isFinite(c.expiresAt)&&c.expiresAt>0?c.expiresAt:null,...(c.expiresAt===null?{noExpiry:true}:{})})).sort((a,b)=>(a.expiresAt??Infinity)-(b.expiresAt??Infinity)):null;
  return{windows,cards:{count,details:count===null?null:details?.slice(0,count)??null},updatedAt:now,stale:false,error:windows.length?'':'额度数据暂不可用'};
}
export function quotaUnavailable(previous, now=Date.now()) {
  // Cached values remain explicitly marked as old, including expiry/reset dates.
  return previous?{...previous,stale:true,error:'额度更新失败，显示上次读数'}:{windows:[],cards:{count:null,details:null},updatedAt:null,stale:true,error:'额度暂不可用，请确认 Codex 已登录'};
}
export class QuotaClient {
  constructor(appPath,{spawnProcess=spawn,timeoutMs=15000}={}){
    this.command=path.join(appPath,'Contents/Resources/codex-cli/bin/codex');
    this.spawnProcess=spawnProcess;this.timeoutMs=timeoutMs;this.pending=new Map();this.id=0;this.closed=false;
  }
  async start(){
    if(this.closed)throw Error('Quota client stopped');
    this.child=this.spawnProcess(this.command,['app-server','--listen','stdio://'],{stdio:['pipe','pipe','ignore']});
    this.lines=createInterface({input:this.child.stdout});
    this.lines.on('line',line=>{
      if(line.length>1024*1024)return void this.stop();
      let message;try{message=JSON.parse(line);}catch{return;}
      const pending=this.pending.get(message.id);if(!pending)return;
      clearTimeout(pending.timer);this.pending.delete(message.id);
      if(message.error)pending.reject(Error('额度接口返回错误'));else pending.resolve(message.result);
    });
    this.child.once('error',()=>this.fail());this.child.once('exit',()=>this.fail());
    this.child.stdin.on('error',()=>this.fail());
    await this.request('initialize',{clientInfo:{name:'codex_project_colors',title:'Codex Project Colors',version:VERSION}});
    if(this.closed)throw Error('Quota client stopped');
    this.child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  }
  request(method,params){
    if(this.closed||!this.child) return Promise.reject(Error('额度连接不可用'));
    const id=++this.id;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('额度读取超时'));void this.stop();},this.timeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      this.child.stdin.write(JSON.stringify({id,method,...(params===undefined?{}:{params})})+'\n');
    });
  }
  read(){return this.request('account/rateLimits/read');}
  fail(){this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('额度连接已关闭'));}this.pending.clear();this.lines?.close();}
  async stop(){
    this.fail();const child=this.child;if(!child||child.exitCode!==null)return;
    child.stdin.destroy();child.kill('SIGTERM');
    await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},1000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
  }
}
