import fs from 'node:fs/promises';
import path from 'node:path';
import { validateEndpoint } from '../demo/core/cdp.mjs';
import { atomicWrite } from './preferences-store.mjs';

export async function browserIdentity(port) {
  const response=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(3000),redirect:'error'});
  if(!response.ok)throw Error('无法确认应用启动会话');
  const version=await response.json(),endpoint=validateEndpoint(version.webSocketDebuggerUrl,'ws:');
  if(Number(endpoint.port)!==port||!/^\/devtools\/browser\/[a-zA-Z0-9_-]+$/.test(endpoint.pathname)||endpoint.search||endpoint.hash)throw Error('应用启动会话地址不匹配');
  return endpoint.pathname;
}

export async function preferencesForSession(store,runtime,identity) {
  const file=path.join(runtime,'browser-session.json');
  const previous=await fs.readFile(file,'utf8').then(JSON.parse).catch(error=>{
    if(error.code==='ENOENT')return null;throw Error('应用启动记录无法读取，请检查运行记录');
  });
  let preferences=await store.read();
  if(!preferences)throw Error('尚未建立正式配色文件');
  if(previous?.identity!==identity){
    if(preferences.paused){preferences={...preferences,paused:false};await store.write(preferences);}
    await atomicWrite(file,JSON.stringify({identity},null,2)+'\n');
  }
  return preferences;
}
