import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPreferences } from './preferences.mjs';
import { PreferenceStore } from '../../src/preferences-store.mjs';

test('连续色值与六种旧配色均可保存，拒绝任意 CSS 和不完整色值',()=>{
  const preferences=createPreferences(null),values={version:1,paused:false,projects:{'local:old':'purple','local:new':'#12abEF'}};
  assert.deepEqual(preferences.validate(values),values);
  for(const color of ['#123','#12345678','rgb(1,2,3)','url(https://example.com)','red;display:none','#GG0000',null,123]){
    assert.throws(()=>preferences.validate({...values,projects:{'local:new':color}}));
  }
});

test('色轮角度与饱和度转换正确，包含环绕和中心灰度',()=>{
  const preferences=createPreferences(null);
  assert.equal(preferences.hsvToHex(0,1),'#ff0000');assert.equal(preferences.hsvToHex(120,1),'#00ff00');assert.equal(preferences.hsvToHex(240,1),'#0000ff');
  assert.equal(preferences.hsvToHex(360,1),'#ff0000');assert.equal(preferences.hsvToHex(-120,1),'#0000ff');assert.equal(preferences.hsvToHex(80,0),'#ffffff');
  for(const hex of ['#1b9abc','#ff3355','#abcdef','#ffffff','#000000']){
    const value=preferences.toHSV(hex);assert.equal(preferences.hsvToHex(value.hue,value.saturation,value.value),hex);
  }
});

test('自选颜色在深浅背景中保持标题可读性，旧配色数值不变',()=>{
  const preferences=createPreferences(null);
  const luminance=channels=>channels.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,value,i)=>sum+value*[.2126,.7152,.0722][i],0);
  const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
  for(const color of ['#ffffff','#000000','#ffff00','#00ff00','#00ffff','#ff00ff','#999999']){
    const paint=preferences.paint(color);assert.ok(contrast(paint.light.split(',').map(Number),[255,255,255])>=4.5);assert.ok(contrast(paint.dark.split(',').map(Number),[45,45,45])>=4.5);
  }
  assert.equal(preferences.paint('green').light,'37, 131, 71');assert.equal(preferences.paint('purple').dark,'204, 146, 255');
});

test('自选色独立保存、重读和备份恢复，旧格式保持兼容',async()=>{
  const dir=await fs.mkdtemp(path.join(fileURLToPath(new URL('../../verification/release/',import.meta.url)),'wheel-store-test-'));
  try{
    const store=new PreferenceStore(dir),old={version:1,paused:false,projects:{'local:a':'purple'}},next={...old,projects:{'local:a':'#22aaee'}};
    await store.write(old);await store.write(next);assert.deepEqual(await new PreferenceStore(dir).read(),next);
    assert.deepEqual(await store.read(store.backup),old);await store.restoreBackup();assert.deepEqual(await store.read(),old);
  }finally{await fs.rm(dir,{recursive:true});}
});
