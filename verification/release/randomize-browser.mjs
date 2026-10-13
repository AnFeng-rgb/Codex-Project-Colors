import fs from 'node:fs/promises';
import { discover, Session } from '../../demo/core/cdp.mjs';
import { createAdapter } from '../../demo/core/adapter.mjs';
import { createPreferences } from '../../demo/core/preferences.mjs';
import { installRenderer } from '../../demo/core/renderer.mjs';
const session=new Session((await discover(39222,undefined,{preferredURL:'app://-/index.html'})).webSocketDebuggerUrl);
await session.connect();
try{
  const run=async(adapter,preferences,install)=>{
    const iframe=document.createElement('iframe');iframe.style.cssText='position:fixed;left:-10000px;width:800px;height:600px';document.body.append(iframe);
    const win=iframe.contentWindow,doc=win.document,checks=[],payloads=[],cache=new Map();
    const check=(name,ok)=>{checks.push({name,passed:!!ok});if(!ok)throw Error(name);};
    Object.defineProperty(win,'localStorage',{value:{getItem:key=>cache.get(key)??null,setItem:(key,value)=>cache.set(key,value),removeItem:key=>cache.delete(key)}});
    // Deterministic randomness verifies the repeated-click fallback as well as distribution.
    win.Math.random=()=>0;
    win.saveFixture=raw=>payloads.push(JSON.parse(raw));
    const originalTimeout=win.setTimeout.bind(win);let expireUndo;
    win.setTimeout=(callback,ms,...args)=>{if(ms===30000)expireUndo=callback;return originalTimeout(callback,ms,...args);};
    const nav=doc.createElement('nav');nav.setAttribute('data-app-navigation-rail','true');nav.innerHTML='<div>导航</div><div><button aria-haspopup="menu" aria-label="打开个人资料菜单">我的</button></div>';doc.body.append(nav);
    const group=(id,kind='local')=>{
      const element=doc.createElement('div');element.setAttribute('data-sidebar-project-container-id',`project:${id}`);element.setAttribute('data-sidebar-project-kind',kind);
      element.innerHTML=`<div data-app-action-sidebar-project-row data-app-action-sidebar-project-id="${id}"><span class="icon-leading-slot"><span data-sidebar-project-drop-zone="project-icon" data-sidebar-project-kind="${kind}" data-sidebar-project-container-id="project:${id}"><svg></svg></span></span><button id="menu-${id}" aria-haspopup="menu"></button></div><div data-app-action-sidebar-thread-row data-app-action-sidebar-thread-id="thread-${id}" data-app-action-sidebar-thread-kind="local" data-app-action-sidebar-thread-host-id="local" data-app-action-sidebar-thread-pinned="false"><span data-thread-title-trigger="true"><span data-thread-title="true">对话</span></span></div>`;
      doc.body.append(element);return element;
    };
    const groups=Array.from({length:14},(_,i)=>group(`p${i}`)),remote=group('remote','remote');
      const initial={version:1,paused:false,projects:{'local:absent':'purple','local:p0':'#123abc','local:p1':'green'}};
    try{
      install(adapter,preferences,{product:'color-labels.v1',storageKey:'random-fixture',initialPreferences:initial,persistenceBinding:'saveFixture',sessionToken:'random-token'},win);
      const api=win.__codexColorLabelsDemo,button=doc.querySelector('[data-ccld-action="randomize"]');
      check('弹窗存在可操作的全部项目随机配色按钮',button?.textContent==='全部项目随机配色'&&!button.disabled);
      button.click();const first=api.getPreferences(),assignment=groups.map((_,i)=>first.projects[`local:p${i}`]);
      check('含原来无颜色和已有颜色的全部本地项目一起赋色',assignment.every(color=>preferences(null).colors.includes(color))&&Object.keys(first.projects).length===15);
      const counts=preferences(null).colors.map(color=>assignment.filter(value=>value===color).length);
      check('六色分布均衡且相邻项目不重复',Math.max(...counts)-Math.min(...counts)<=1&&assignment.every((color,i)=>i===0||color!==assignment[i-1]));
      check('未挂载项目配置保留，远程项目不赋色',first.projects['local:absent']==='purple'&&!first.projects['local:remote']&&!remote.querySelector('[data-ccld-color]'));
      check('对话与所属项目颜色一致',groups.every((element,i)=>element.querySelector('[data-app-action-sidebar-thread-row]').getAttribute('data-ccld-color')===assignment[i]));
      check('批量配色只发送一份保存请求，并等待确认',payloads.length===1&&api.status().saving&&button.disabled);
      button.click();check('保存未确认时不重复随机请求',payloads.length===1);
      api.persistenceAck('random-token',payloads.at(-1).revision,true);check('确认后可再次随机',!button.disabled&&await api.flushPersistence());
      const undo=doc.querySelector('[data-ccld-action="undo-randomize"]');undo.click();
      check('撤销恢复原自选色、无配色项目和未挂载项目，一次保存',JSON.stringify(api.getPreferences().projects)===JSON.stringify(initial.projects)&&payloads.length===2&&api.status().saving&&undo.parentElement.hidden);
      api.persistenceAck('random-token',payloads.at(-1).revision,true);
      button.click();api.persistenceAck('random-token',payloads.at(-1).revision,true);const beforeSecond=api.getPreferences();
      button.click();const second=api.getPreferences();check('重复随机即使随机源相同也产生不同配色',JSON.stringify(second.projects)!==JSON.stringify(first.projects));
      api.persistenceAck('random-token',payloads.at(-1).revision,true);
      undo.click();check('连续随机只撤销最近一次',JSON.stringify(api.getPreferences().projects)===JSON.stringify(beforeSecond.projects));api.persistenceAck('random-token',payloads.at(-1).revision,true);
      api.pause();api.persistenceAck('random-token',payloads.at(-1).revision,true);
      const pausedBefore=api.getPreferences();button.click();check('随机保存未确认时撤销禁用',undo.disabled);api.persistenceAck('random-token',payloads.at(-1).revision,true);undo.click();
      check('停止状态撤销恢复颜色并保留停止',api.status().paused&&JSON.stringify(api.getPreferences().projects)===JSON.stringify(pausedBefore.projects)&&!doc.querySelector('[data-ccld-color]'));api.persistenceAck('random-token',payloads.at(-1).revision,true);
      button.click();api.persistenceAck('random-token',payloads.at(-1).revision,true);api.setColor('local:p0','blue');api.persistenceAck('random-token',payloads.at(-1).revision,true);
      check('手动选色后旧撤销失效，避免覆盖新选择',undo.parentElement.hidden&&!api.undoRandomize()&&api.getPreferences().projects['local:p0']==='blue');
      button.click();api.persistenceAck('random-token',payloads.at(-1).revision,true);const expired=api.getPreferences();expireUndo();check('撤销提示到期后移除，颜色保留',undo.parentElement.hidden&&!api.undoRandomize()&&JSON.stringify(expired)===JSON.stringify(api.getPreferences()));
      button.click();check('停止状态随机只更新配置，保持停止',api.status().paused&&!doc.querySelector('[data-ccld-color]'));
      api.persistenceAck('random-token',payloads.at(-1).revision,false,'模拟磁盘写入失败');check('批量保存失败明确显示错误',api.status().error.includes('模拟磁盘写入失败'));
      undo.click();check('保存失败仍可撤销并重新保存',api.status().saving&&!api.status().error);api.persistenceAck('random-token',payloads.at(-1).revision,true);
      api.destroy();
      groups.slice(1).forEach(group=>group.remove());remote.remove();
      install(adapter,preferences,{product:'color-labels.v1',storageKey:'single-fixture',initialPreferences:{version:1,paused:false,projects:{}}},win);
      const single=win.__codexColorLabelsDemo;single.randomizeColors();const old=single.getPreferences().projects['local:p0'];single.randomizeColors();check('仅一个项目时再次点击也会换色',single.getPreferences().projects['local:p0']!==old);
      single.destroy();check('清理不残留界面或颜色标记',!doc.querySelector('[data-ccld-owner],[data-ccld-color],#ccld-style'));
      return{passed:true,checks,scope:'受控浏览器的 14 个本地项目与 1 个远程项目，不改动用户已有颜色'};
    }catch(error){return{passed:false,error:error.message,checks};}finally{win.__codexColorLabelsDemo?.destroy();iframe.remove();}
  };
  const report=await session.expression(`(${run.toString()})(${createAdapter.toString()},${createPreferences.toString()},${installRenderer.toString()})`);
  await fs.writeFile(new URL('./randomize-browser.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}finally{session.close();}
