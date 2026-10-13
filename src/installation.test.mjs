import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {configureInstallation,installationPaths,launchAgentPlist} from './installation.mjs';
import {PreferenceStore} from './preferences-store.mjs';
const root=fileURLToPath(new URL('../verification/release/',import.meta.url));
async function fixture(){
 const dir=await fs.mkdtemp(path.join(root,'install-test-')),bundle=path.join(dir,'Incoming.app'),home=path.join(dir,'home');
 await fs.mkdir(path.join(bundle,'Contents/Resources'),{recursive:true});
 await fs.writeFile(path.join(bundle,'Contents/Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.codex-project-colors.manager</string></dict></plist>');
 for(const name of ['node','startup-bridge'])await fs.writeFile(path.join(bundle,'Contents/Resources',name),'fixture');
 const calls=[],run=async(file,args)=>{calls.push({file,args});return{stdout:''};};return{dir,bundle,home,calls,run};
}
test('安装独立程序与登录服务，迁移配色；停用卸载只删自己的程序，保留数据',async()=>{
 const f=await fixture();try{
  const legacy=path.join(f.dir,'legacy'),colors={version:1,paused:false,projects:{'local:test':'purple'}};await new PreferenceStore(legacy).write(colors);
  const result=await configureInstallation('install',{...f,importData:legacy});assert.equal(result.automatic,true);assert.deepEqual(await new PreferenceStore(result.dataDir).read(),colors);
  assert.ok(f.calls.some(call=>call.args.includes('bootstrap')));assert.match(await fs.readFile(result.plist,'utf8'),/RunAtLoad/);
  await configureInstallation('disable',f);assert.equal(await fs.access(result.plist).then(()=>true).catch(()=>false),false);assert.deepEqual(await new PreferenceStore(result.dataDir).read(),colors);
  await configureInstallation('enable',f);await configureInstallation('uninstall',f);assert.equal(await fs.access(result.app).then(()=>true).catch(()=>false),false);assert.deepEqual(await new PreferenceStore(result.dataDir).read(),colors);
 }finally{await fs.rm(f.dir,{recursive:true});}
});
test('登录服务启用失败不留下下次登录会启动的配置',async()=>{const f=await fixture();try{f.run=async(file,args)=>{if(args.includes('bootstrap'))throw Error('denied');return{stdout:''};};await assert.rejects(configureInstallation('install',f),/未启用/);const p=installationPaths(f.home);assert.equal(await fs.access(p.plist).then(()=>true).catch(()=>false),false);assert.equal(JSON.parse(await fs.readFile(p.receipt,'utf8')).enabled,false);}finally{await fs.rm(f.dir,{recursive:true});}});
test('拒绝覆盖未知程序或登录配置',async()=>{const f=await fixture();try{const p=installationPaths(f.home);await fs.mkdir(path.dirname(p.plist),{recursive:true});await fs.writeFile(p.plist,'unrelated');await assert.rejects(configureInstallation('install',f),/不是本工具/);assert.equal(await fs.readFile(p.plist,'utf8'),'unrelated');}finally{await fs.rm(f.dir,{recursive:true});}});
test('登录配置使用固定参数并转义路径，未使用 shell 拼接',()=>{const plist=launchAgentPlist('/tmp/a & b.app','/tmp/<data>');assert.match(plist,/a &amp; b/);assert.match(plist,/&lt;data&gt;/);assert.doesNotMatch(plist,/<string>.*sh<\/string>/);});
