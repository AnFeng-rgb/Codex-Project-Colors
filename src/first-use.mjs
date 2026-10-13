import fs from 'node:fs/promises';
import path from 'node:path';
import {atomicWrite} from './preferences-store.mjs';

// Serialized into the connected renderer. The optional argument supports isolated fixtures.
export async function initializeFirstPalette(api=window.__codexColorLabelsDemo){
  if(api?.product!=='color-labels.v1')return{complete:false};
  const status=api.status();
  if(!status.connected||!status.ready||status.saving||status.error)return{complete:false};
  const preferences=api.getPreferences();
  // Preserve migrated colors and explicit user choices, including turning coloring off.
  if(preferences.paused||Object.keys(preferences.projects).length)return{complete:true,assigned:false};
  if(!api.randomizeColors({undo:false}))return{complete:false};
  const confirmed=await api.flushPersistence();
  return{complete:confirmed,assigned:confirmed};
}

export class FirstUsePalette {
  constructor(dataDir){this.file=path.join(dataDir,'first-use.json');this.complete=undefined;}
  async apply(session){
    if(this.complete===undefined){
      const record=await fs.readFile(this.file,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw Error('首次配色记录无法读取，未重新分配颜色');});
      if(record&&(record.version!==1||record.paletteInitialized!==true))throw Error('首次配色记录格式无效，未重新分配颜色');
      this.complete=Boolean(record);
    }
    if(this.complete)return false;
    const result=await session.evaluate(initializeFirstPalette);
    if(!result.complete)return false;
    // Record completion only after the renderer has received the file save confirmation.
    await atomicWrite(this.file,JSON.stringify({version:1,paletteInitialized:true},null,2)+'\n');
    this.complete=true;
    return result.assigned===true;
  }
}
