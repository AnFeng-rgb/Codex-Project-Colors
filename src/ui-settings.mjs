import fs from 'node:fs/promises';
import path from 'node:path';
import {atomicWrite} from './preferences-store.mjs';
export function validateUISettings(value){
  if(!value||Array.isArray(value)||value.version!==1||typeof value.showQuota!=='boolean'||Object.keys(value).some(k=>!['version','showQuota'].includes(k)))throw Error('额度显示设置格式无效，原文件已保留');
  return{version:1,showQuota:value.showQuota};
}
export function parseUISettingsRequest(raw,token,previousRevision){
  if(typeof raw!=='string'||raw.length>512)return null;
  let value;try{value=JSON.parse(raw);}catch{return null;}
  if(!value||Array.isArray(value)||value.token!==token||!Number.isSafeInteger(value.revision)||value.revision<=previousRevision||Object.keys(value).some(k=>!['token','revision','settings'].includes(k)))return null;
  try{return{token,revision:value.revision,settings:validateUISettings(value.settings)};}catch{return null;}
}
export class UISettingsStore{
  constructor(directory){this.file=path.join(directory,'ui-settings.json');this.queue=Promise.resolve();}
  async read(){try{const raw=await fs.readFile(this.file,'utf8');if(raw.length>512)throw Error('额度显示设置文件过大');return validateUISettings(JSON.parse(raw));}catch(e){if(e.code==='ENOENT')return{version:1,showQuota:true};throw Error(`显示设置无法读取：${e.message}`);}}
  write(value){const settings=validateUISettings(value);const next=this.queue.catch(()=>{}).then(async()=>{await this.read();await atomicWrite(this.file,JSON.stringify(settings,null,2)+'\n');return settings;});this.queue=next;return next;}
}
