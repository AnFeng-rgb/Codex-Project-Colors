import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {PreferenceStore,atomicWrite} from './preferences-store.mjs';

const exec=promisify(execFile);
export const label='local.codex-project-colors.startup';
export function installationPaths(home=os.homedir()) {
  const app=path.join(home,'Applications/Codex Project Colors.app'),dataDir=path.join(home,'Library/Application Support/CodexProjectColors');
  return{app,dataDir,plist:path.join(home,`Library/LaunchAgents/${label}.plist`),receipt:path.join(dataDir,'installation.json')};
}
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function launchAgentPlist(app,dataDir){
  const resources=path.join(app,'Contents/Resources');
  const args=[path.join(resources,'node'),path.join(resources,'tool/src/startup/watch.mjs'),'--data-dir',dataDir];
  return`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map(value=>`<string>${xml(value)}</string>`).join('')}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>10</integer><key>StandardOutPath</key><string>${xml(path.join(dataDir,'runtime/startup.log'))}</string><key>StandardErrorPath</key><string>${xml(path.join(dataDir,'runtime/startup-error.log'))}</string></dict></plist>\n`;
}
const exists=file=>fs.access(file).then(()=>true).catch(()=>false);
async function ownedApp(app){
  const plist=path.join(app,'Contents/Info.plist');
  const {stdout}=await exec('/usr/libexec/PlistBuddy',['-c','Print CFBundleIdentifier',plist]);
  if(!['local.colorlabels.manager','local.codex-project-colors.manager'].includes(stdout.trim()))throw Error('目标目录不是本工具，已保留原文件');
}
export async function installationStatus(home){
  const p=installationPaths(home),receipt=await fs.readFile(p.receipt,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return{};throw error;});
  const startup=await fs.readFile(path.join(p.dataDir,'runtime/startup.json'),'utf8').then(JSON.parse).catch(()=>({}));let watcherRunning=false;
  try{if(Number.isInteger(startup.watcherPID)&&startup.watcherPID>0){process.kill(startup.watcherPID,0);watcherRunning=true;}}catch{}
  return{installed:await exists(p.app),automatic:receipt.enabled===true&&await exists(p.plist),watcherRunning,startupEvent:startup.event??null,...p};
}
export async function configureInstallation(action,{bundle,importData,home,run=exec}={}){
  const p=installationPaths(home),domain=`gui/${process.getuid()}`;
  if(!['install','enable','disable','uninstall'].includes(action))throw Error('未知安装操作');
  await fs.mkdir(path.join(p.dataDir,'runtime'),{recursive:true,mode:0o700});
  const appCLI=()=>[path.join(p.app,'Contents/Resources/node'),[path.join(p.app,'Contents/Resources/tool/src/cli.mjs'),'stop','--data-dir',p.dataDir]];
  async function stop(){
    const startup=await fs.readFile(path.join(p.dataDir,'runtime/startup.json'),'utf8').then(JSON.parse).catch(()=>({}));
    const watcherPID=startup.watcherPID;
    if(await exists(p.plist)) {
      const actual=await fs.readFile(p.plist,'utf8');if(!actual.includes(`<string>${label}</string>`))throw Error('登录配置不是本工具，未修改');
      await run('/bin/launchctl',['bootout',`${domain}/${label}`]).catch(async error=>{const active=await run('/bin/launchctl',['print',`${domain}/${label}`]).then(()=>true).catch(()=>false);if(active)throw error;});
    }
    if(await exists(p.app)){await ownedApp(p.app);const[node,args]=appCLI();await run(node,args);}
    // launchctl can return before the observer has completed its own shutdown.
    // Wait for that completion before removing or replacing executable files.
    if(Number.isInteger(watcherPID)&&watcherPID>0){
      const alive=()=>{try{process.kill(watcherPID,0);return true;}catch{return false;}};
      for(let i=0;i<40&&alive();i++)await delay(250);
      if(alive())throw Error('启动观察助手尚未确认退出；已保留程序，请稍后重试');
    }
  }
  if(action==='install'){
    await ownedApp(bundle);
    await fs.access(path.join(bundle,'Contents/Resources/node'));
    await fs.access(path.join(bundle,'Contents/Resources/startup-bridge'));
    await stop();
    if(importData&&path.resolve(importData)!==path.resolve(p.dataDir)){
      await run(path.join(bundle,'Contents/Resources/node'),[path.join(bundle,'Contents/Resources/tool/src/cli.mjs'),'stop','--data-dir',importData]);
      const settingsFile=path.join(importData,'settings.json');
      if(await exists(settingsFile)&&!await exists(path.join(p.dataDir,'settings.json'))){const old=JSON.parse(await fs.readFile(settingsFile,'utf8'));const clean={};for(const key of ['port','appPath','windowURL','targetURL'])if(old[key]!==undefined)clean[key]=old[key];await atomicWrite(path.join(p.dataDir,'settings.json'),JSON.stringify(clean,null,2)+'\n');}
      // The old helper has stopped and flushed; the official application stays open.
      const imported=await new PreferenceStore(importData).read();
      if(imported&&!await new PreferenceStore(p.dataDir).read())await new PreferenceStore(p.dataDir).write(imported);
    }
    if(path.resolve(bundle)!==path.resolve(p.app)){
      await fs.mkdir(path.dirname(p.app),{recursive:true});
      const staged=p.app+`.install-${randomUUID()}`;await fs.cp(bundle,staged,{recursive:true,errorOnExist:true,force:false});
      if(await exists(p.app)){await ownedApp(p.app);await fs.rename(p.app,p.app+`.previous-${Date.now()}`);}
      await fs.rename(staged,p.app);
    }
  }
  if(action==='install'||action==='enable'){
    await ownedApp(p.app);
    if(action==='enable')await stop();
    await fs.mkdir(path.dirname(p.plist),{recursive:true});
    if(await exists(p.plist)&&!(await fs.readFile(p.plist,'utf8')).includes(`<string>${label}</string>`))throw Error('登录配置已被其他文件占用，未覆盖');
    await atomicWrite(p.plist,launchAgentPlist(p.app,p.dataDir));
    await atomicWrite(p.receipt,JSON.stringify({version:1,enabled:false},null,2)+'\n');
    try{await run('/bin/launchctl',['bootstrap',domain,p.plist]);await atomicWrite(p.receipt,JSON.stringify({version:1,enabled:true},null,2)+'\n');}
    catch(error){await run('/bin/launchctl',['bootout',`${domain}/${label}`]).catch(()=>{});await fs.rm(p.plist,{force:true});throw Error(`自动启动未启用：${error.message}`);}
  }else{
    await stop();await fs.rm(p.plist,{force:true});await atomicWrite(p.receipt,JSON.stringify({version:1,enabled:false},null,2)+'\n');
    if(action==='uninstall'&&await exists(p.app)){await ownedApp(p.app);await fs.rm(p.app,{recursive:true});}
  }
  return installationStatus(home);
}
