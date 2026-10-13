import fs from 'node:fs/promises';
import { discover, Session } from '../../demo/core/cdp.mjs';
import { createAdapter } from '../../demo/core/adapter.mjs';
import { createPreferences } from '../../demo/core/preferences.mjs';
import { installRenderer } from '../../demo/core/renderer.mjs';
const session=new Session((await discover(39222,undefined,{preferredURL:'app://-/index.html'})).webSocketDebuggerUrl);
await session.connect();
try {
  const run=async(adapter,preferences,install)=>{
    const iframe=document.createElement('iframe');iframe.style.cssText='position:fixed;left:-10000px;width:800px;height:600px';document.body.append(iframe);
    const win=iframe.contentWindow,doc=win.document,checks=[],saved=[],commands=[];
    const check=(name,ok)=>{checks.push({name,passed:!!ok});if(!ok)throw Error(name);};
    const settle=async()=>{await Promise.resolve();win.__codexColorLabelsDemo?.heartbeat();};
    const nav=()=>{
      const rail=doc.createElement('nav');rail.setAttribute('data-app-navigation-rail','true');
      rail.innerHTML='<div>导航</div><div class="profile-footer"><button aria-haspopup="menu" aria-label="打开个人资料菜单">我的</button></div>';
      doc.body.append(rail);return rail;
    };
    const cache=new Map();Object.defineProperty(win,'localStorage',{value:{getItem:key=>cache.get(key)??null,setItem:(key,value)=>cache.set(key,value),removeItem:key=>cache.delete(key)}});
    win.saveFixture=raw=>{const payload=JSON.parse(raw);saved.push(payload);win.__codexColorLabelsDemo?.persistenceAck(payload.token,payload.revision,true);};
    win.commandFixture=raw=>commands.push(JSON.parse(raw));
    const group=doc.createElement('div');group.setAttribute('data-sidebar-project-container-id','project:sample');group.setAttribute('data-sidebar-project-kind','local');
    group.innerHTML='<div data-app-action-sidebar-project-row data-app-action-sidebar-project-id="sample"><span class="icon-leading-slot"><span data-sidebar-project-drop-zone="project-icon" data-sidebar-project-kind="local" data-sidebar-project-container-id="project:sample"><svg></svg></span></span><button id="sample-menu" aria-haspopup="menu"></button></div>';
    doc.body.append(group);let rail=nav();
    try{
      install(adapter,preferences,{product:'color-labels.v1',storageKey:'sidebar-fixture',initialPreferences:{version:1,paused:false,projects:{'local:sample':'green'}},persistenceBinding:'saveFixture',controlBinding:'commandFixture',sessionToken:'fixture'},win);
      const api=win.__codexColorLabelsDemo,button=doc.querySelector('button[aria-label="项目配色"]'),slot=button.parentElement,panel=doc.getElementById('ccld-panel'),toggle=panel.querySelector('[data-ccld-action="toggle"]');
      check('入口在个人资料区域正上方，旧浮动控件取消',slot.parentElement===rail&&slot.nextElementSibling.className==='profile-footer'&&!doc.querySelector('.ccld-status'));
      const activeColor=win.getComputedStyle(button).color;
      check('未打开面板即可通过入口看到开启状态',panel.hidden&&button.getAttribute('data-state')==='on'&&button.getAttribute('data-enabled')==='true');
      button.click();check('点击打开弹窗并聚焦停止按钮',!panel.hidden&&doc.activeElement===toggle&&toggle.textContent==='停止上色');
      check('正常面板去除开启状态及常驻说明，开关明确可访问',!panel.textContent.includes('上色已开启')&&!panel.textContent.includes('停止上色会保留配色')&&toggle.getAttribute('role')==='switch'&&toggle.getAttribute('aria-checked')==='true'&&panel.querySelector('.ccld-note').hidden);
      check('方案 B 窄卡片不出现配色文件入口',panel.getBoundingClientRect().width===200&&panel.getBoundingClientRect().height<=320&&!panel.querySelector('[data-ccld-action="open-preferences"]')&&!panel.textContent.includes('打开配色文件'));
      toggle.click();await api.flushPersistence();check('停止撤去配色、保存原颜色，入口仍可恢复',api.status().paused&&!group.querySelector('[data-ccld-color]')&&api.getPreferences().projects['local:sample']==='green'&&toggle.textContent==='恢复上色'&&slot.isConnected);
      check('停止后入口即时变为灰色暂停状态',button.getAttribute('data-state')==='off'&&button.getAttribute('data-enabled')==='false'&&win.getComputedStyle(button).color!==activeColor&&toggle.getAttribute('aria-checked')==='false');
      toggle.click();await api.flushPersistence();check('恢复重新应用原配色',!api.status().paused&&group.querySelector('[data-ccld-color="green"]'));
      win.saveFixture=raw=>saved.push(JSON.parse(raw));api.setColor('local:sample','purple');const request=saved.at(-1);
      check('保存期间保留必要反馈且拒绝过期回执',panel.textContent.includes('正在保存')&&!api.persistenceAck('wrong',request.revision,true));
      api.persistenceAck('fixture',request.revision,false,'模拟保存失败');check('保存失败显示原因',panel.textContent.includes('模拟保存失败'));
      check('错误在侧栏入口显示且不误表示已关闭上色',button.getAttribute('data-state')==='error'&&button.getAttribute('data-enabled')==='true');
      api.setColor('local:sample','green');api.persistenceAck('fixture',saved.at(-1).revision,true);check('成功回执清除错误',!panel.textContent.includes('模拟保存失败'));
      check('处理成功后入口恢复正常开启状态',button.getAttribute('data-state')==='on');
      toggle.focus();toggle.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));check('键盘可从总开关移动到项目选择',doc.activeElement===doc.getElementById('ccld-project-trigger'));
      const trigger=doc.getElementById('ccld-project-trigger'),list=doc.getElementById('ccld-project-list');
      trigger.click();check('展开项目列表显示唯一勾选项并聚焦当前项目',!list.hidden&&list.querySelectorAll('[aria-selected="true"]').length===1&&doc.activeElement===list.querySelector('[aria-selected="true"]'));
      list.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));check('Escape 先关闭项目列表，保留配色面板',list.hidden&&!panel.hidden&&doc.activeElement===trigger);
      const longName='一个需要完整展示而且不能撑宽面板的非常长的项目名称';group.querySelector('[data-app-action-sidebar-project-row]').setAttribute('data-app-action-sidebar-project-label',longName);api.refresh();
      trigger.click();const option=list.querySelector('[role="option"]'),label=option.querySelector('.ccld-project-option-label');
      check('长项目名截断显示且悬停可查看全名',trigger.title===longName&&option.title===longName&&label.textContent===longName&&win.getComputedStyle(label).textOverflow==='ellipsis'&&label.scrollWidth>label.clientWidth&&panel.scrollWidth<=panel.clientWidth);
      for(const theme of ['light','dark']){
        doc.documentElement.setAttribute('data-theme',theme);doc.documentElement.style.setProperty('--color-surface-elevated-secondary',theme==='dark'?'#2d2d2d':'#fff');doc.documentElement.style.setProperty('--color-text-default',theme==='dark'?'#fff':'#000');
        check(`${theme}项目列表文字与背景正确`,win.getComputedStyle(list).backgroundColor===(theme==='dark'?'rgb(45, 45, 45)':'rgb(255, 255, 255)')&&win.getComputedStyle(option).color===(theme==='dark'?'rgb(255, 255, 255)':'rgb(0, 0, 0)'));
      }
      option.click();check('选择项目关闭列表且不修改配色',list.hidden&&trigger.title===longName&&api.getPreferences().projects['local:sample']==='green');
      toggle.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));check('Escape 关闭并返回入口焦点',panel.hidden&&doc.activeElement===button);
      button.click();doc.body.dispatchEvent(new win.PointerEvent('pointerdown',{bubbles:true}));check('点击外部关闭弹窗',panel.hidden);
      rail.remove();rail=nav();await settle();check('导航被替换后重新定位且不重复入口',slot.parentElement===rail&&doc.querySelectorAll('[data-ccld-owner="sidebar-control"]').length===1);
      const profile=rail.querySelector('[aria-haspopup="menu"]');profile.setAttribute('aria-label','未知个人资料入口');await settle();check('未知个人资料结构不猜测位置',!slot.isConnected&&!api.status().controlReady);
      profile.setAttribute('aria-label','打开个人资料菜单');await settle();check('结构恢复后自动还原入口',slot.isConnected&&api.status().controlReady);
      const duplicate=nav();await settle();check('重复导航结构不重复或误放入口',!slot.isConnected);duplicate.remove();await settle();
      api.destroy();check('销毁清理入口、弹窗、标记和待确认操作',!doc.querySelector('[data-ccld-owner], [data-ccld-color], #ccld-style'));
      check('新面板不发起文件操作',commands.length===0);
      return{passed:true,checks,scope:'受控浏览器 DOM；保存回执模拟，不改变用户聊天或配色'};
    }catch(e){return{passed:false,error:e.message,checks};}finally{win.__codexColorLabelsDemo?.destroy();iframe.remove();}
  };
  const report=await session.expression(`(${run.toString()})(${createAdapter.toString()},${createPreferences.toString()},${installRenderer.toString()})`);
  await fs.writeFile(new URL('./sidebar-browser.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}finally{session.close();}
