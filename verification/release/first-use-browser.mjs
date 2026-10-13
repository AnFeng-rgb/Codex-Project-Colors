import fs from 'node:fs/promises';
import {discover,Session} from '../../demo/core/cdp.mjs';
import {createAdapter} from '../../demo/core/adapter.mjs';
import {createPreferences} from '../../demo/core/preferences.mjs';
import {installRenderer} from '../../demo/core/renderer.mjs';
import {initializeFirstPalette} from '../../src/first-use.mjs';
const session=new Session((await discover(39222,'app://-/index.html')).webSocketDebuggerUrl);await session.connect();
try{
  const run=async(adapter,preferences,install,initialize)=>{
    const checks=[];const check=(name,value)=>{checks.push({name,passed:!!value});if(!value)throw Error(name);};
    const iframe=document.createElement('iframe');iframe.style.cssText='position:fixed;left:-10000px;width:800px;height:600px';document.body.append(iframe);
    const win=iframe.contentWindow,doc=win.document,cache=new Map();let payloads=[],saveOK=true;
    Object.defineProperty(win,'localStorage',{value:{getItem:key=>cache.get(key)??null,setItem:(key,value)=>cache.set(key,value),removeItem:key=>cache.delete(key)}});
    win.saveFixture=raw=>{const payload=JSON.parse(raw);payloads.push(payload);queueMicrotask(()=>win.__codexColorLabelsDemo.persistenceAck(payload.token,payload.revision,saveOK,saveOK?'':'test save failure'));};
    const nav=doc.createElement('nav');nav.setAttribute('data-app-navigation-rail','true');nav.innerHTML='<div>导航</div><div><button aria-haspopup="menu" aria-label="打开个人资料菜单">我的</button></div>';doc.body.append(nav);
    const group=(id,kind='local')=>{const node=doc.createElement('div');node.setAttribute('data-sidebar-project-container-id',`project:${id}`);node.setAttribute('data-sidebar-project-kind',kind);node.innerHTML=`<div data-app-action-sidebar-project-row data-app-action-sidebar-project-id="${id}"><span class="icon-leading-slot"><span data-sidebar-project-drop-zone="project-icon"><svg></svg></span></span><button id="menu-${id}" aria-haspopup="menu"></button></div>`;doc.body.append(node);return node;};
    const setup=value=>{payloads=[];install(adapter,preferences,{product:'color-labels.v1',storageKey:'first-use-fixture',initialPreferences:value,persistenceBinding:'saveFixture',sessionToken:'first-use-token'},win);return win.__codexColorLabelsDemo;};
    try{
      let api=setup(preferences(null).empty());
      check('没有本地项目时等待，不消费首次初始化',!(await initialize(api)).complete&&payloads.length===0);
      const projects=Array.from({length:8},(_,i)=>group(`p${i}`));group('remote','remote');api.refresh();
      const result=await initialize(api),assigned=projects.map((_,i)=>api.getPreferences().projects[`local:p${i}`]);
      check('首次就绪后默认开启并自动赋予本地项目六色方案',result.complete&&result.assigned&&!api.status().paused&&assigned.every(color=>preferences(null).colors.includes(color)));
      const counts=preferences(null).colors.map(color=>assigned.filter(value=>value===color).length);
      check('默认方案均衡，相邻项目不同色，远程项目不分配',Math.max(...counts)-Math.min(...counts)<=1&&assigned.every((color,i)=>!i||color!==assigned[i-1])&&!api.getPreferences().projects['local:remote']);
      check('默认方案批量保存一次且没有随机撤销提示',payloads.length===1&&!api.status().saving&&!api.undoRandomize());
      const first=JSON.stringify(api.getPreferences());await initialize(api);
      check('已有方案不重新随机',JSON.stringify(api.getPreferences())===first&&payloads.length===1);
      api=setup({version:1,paused:false,projects:{'local:p0':'#123abc'}});const migrated=JSON.stringify(api.getPreferences());const migratedResult=await initialize(api);
      check('升级迁移时保留原自选色，不补写或覆盖其他项目',migratedResult.complete&&!migratedResult.assigned&&JSON.stringify(api.getPreferences())===migrated&&payloads.length===0);
      api=setup({version:1,paused:true,projects:{}});const pausedResult=await initialize(api);
      check('用户已关闭时不分配、不改变开关',pausedResult.complete&&!pausedResult.assigned&&api.status().paused&&payloads.length===0);
      api=setup(preferences(null).empty());saveOK=false;const failed=await initialize(api);
      check('保存失败不会报告首次初始化已完成',!failed.complete&&api.status().error.includes('test save failure'));
      return{passed:checks.every(check=>check.passed),checks};
    }finally{win.__codexColorLabelsDemo?.destroy();iframe.remove();}
  };
  const result=await session.expression(`(${run.toString()})(${createAdapter.toString()},${createPreferences.toString()},${installRenderer.toString()},${initializeFirstPalette.toString()})`);
  await fs.writeFile(new URL('./first-use-browser.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
}finally{session.close();}
