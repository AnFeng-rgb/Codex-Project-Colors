export function quotaPresentation(value,now=Date.now()){
  const all=Array.isArray(value?.windows)?value.windows:[];
  const weekly=all.find(w=>w.kind==='weekly'&&Number.isFinite(w.remaining));
  const fiveHour=all.find(w=>w.kind==='five-hour'&&Number.isFinite(w.remaining));
  const windows=weekly?[...(fiveHour?[fiveHour]:[]),weekly]:[];
  const stale=!!value?.stale||!Number.isFinite(value?.updatedAt)||now-value.updatedAt>180000;
  const count=value?.cards?.count;
  const details=Number.isSafeInteger(count)&&count>0&&Array.isArray(value?.cards?.details)?value.cards.details.slice(0,count).map(card=>{
    const expiry=card.expiresAt;
    const expired=Number.isFinite(expiry)&&expiry*1000<=now;
    const urgent=!stale&&Number.isFinite(expiry)&&expiry*1000>now&&expiry*1000<=now+3*86400000;
    return{...card,urgent,expired};
  }).sort((a,b)=>(a.urgent?0:a.expired?2:1)-(b.urgent?0:b.expired?2:1)||(a.expiresAt??Infinity)-(b.expiresAt??Infinity)):null;
  return{windows,stale,details,urgentCount:details?.filter(card=>card.urgent).length??0};
}
export function installQuotaRenderer(createAdapter, createQuotaView, initial, options={}, environment=globalThis) {
  const win=environment,doc=win.document,key='__codexProjectQuota';
  win[key]?.destroy();
  const adapter=createAdapter(doc),events=new win.AbortController();
  let value=initial,signature='',dead=false,lastHeartbeat=Date.now(),visible=options.visible!==false;
  const card=doc.createElement('div');
  const slot=doc.createElement('div'),trigger=doc.createElement('button'),panel=doc.createElement('div'),style=doc.createElement('style');
  card.id='cclq-card';card.setAttribute('data-cclq-owner','true');card.setAttribute('role','group');card.setAttribute('aria-label','额度与项目配色');
  slot.id='cclq-slot';trigger.id='cclq-trigger';panel.id='cclq-panel';style.id='cclq-style';
  for(const node of [slot,panel])node.setAttribute('data-cclq-owner','true');
  slot.append(trigger);trigger.type='button';trigger.setAttribute('aria-label','账号额度');trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-controls',panel.id);trigger.setAttribute('aria-expanded','false');
  card.append(slot);
  panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','账号额度');panel.tabIndex=-1;
  style.textContent=`
    [data-cclq-owner]{--cclq-green:#168747;--cclq-orange:#ad7100;--cclq-red:#bd3042}
    @media(prefers-color-scheme:dark){html:not(.light):not([data-theme="light"]) [data-cclq-owner]{--cclq-green:#66d491;--cclq-orange:#f5bc58;--cclq-red:#ff8999}}
    html.dark [data-cclq-owner],html[data-theme="dark"] [data-cclq-owner]{--cclq-green:#66d491;--cclq-orange:#f5bc58;--cclq-red:#ff8999}
    html.light [data-cclq-owner],html[data-theme="light"] [data-cclq-owner]{--cclq-green:#168747;--cclq-orange:#ad7100;--cclq-red:#bd3042}
    #cclq-card{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:8px;width:42px;flex-shrink:0;padding:4px 1px;margin:6px 0 8px;border:1px solid var(--color-border,#8883);border-radius:22px;background:var(--color-surface-elevated-secondary,Canvas);color:var(--color-text-default,CanvasText);-webkit-app-region:no-drag}
    #cclq-slot{width:38px;flex-shrink:0;display:flex;justify-content:center;margin:0;-webkit-app-region:no-drag}
    #cclq-slot[hidden]{display:none!important}
    #cclq-trigger{position:relative;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;align-items:center;padding:4px 1px;width:38px;border:0;border-radius:18px;background:transparent;color:var(--color-text-default,CanvasText);font-family:inherit;cursor:pointer}
    .cclq-alert{position:absolute;right:-2px;top:-1px;display:grid;place-items:center;width:12px;height:12px;border-radius:50%;background:#c83042;border:1.5px solid var(--color-surface-elevated-secondary,Canvas);color:white;font:700 10px/12px system-ui}
    #cclq-trigger[aria-expanded=true] .cclq-alert{display:none}
    #cclq-trigger:hover,#cclq-trigger[aria-expanded=true]{background:var(--color-bg-primary-ghost-hover,#8882)}
    #cclq-trigger:focus-visible,#cclq-panel button:focus-visible{outline:2px solid var(--color-ring,#528bdf);outline-offset:2px}
    .cclq-meter{display:flex;flex-direction:column;align-items:center;gap:4px;--q-color:#168747}
    .cclq-ring{width:36px;height:36px;position:relative;display:grid;place-items:center}
    .cclq-ring svg{position:absolute;inset:0;width:36px;height:36px;transform:rotate(-90deg)}
    .cclq-ring circle{fill:none;stroke-width:3px;stroke:#8883}
    .cclq-ring .cclq-value{stroke:var(--q-color);stroke-linecap:round}
    .cclq-percent{font:600 11px/1 system-ui;color:var(--q-color)}
    .cclq-label{font:10px/13px system-ui;color:var(--color-text-secondary,#777)}
    #cclq-trigger[data-stale=true] .cclq-meter{--q-color:var(--color-text-secondary,#777)!important}
    #cclq-panel{position:fixed;z-index:2147483646;box-sizing:border-box;width:200px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow-y:auto;overflow-x:hidden;border:1px solid var(--color-border,#8884);border-radius:14px;background:var(--color-surface-elevated-secondary,Canvas);color:var(--color-text-default,CanvasText);box-shadow:0 8px 30px #0002;font:13px/1.5 system-ui;-webkit-app-region:no-drag}
    #cclq-panel[hidden]{display:none!important}
    .cclq-header{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid var(--color-border,#8883);font-weight:600}
    .cclq-close{background:none;border:0;border-radius:5px;color:inherit;font:20px/24px system-ui;cursor:pointer;width:24px;height:24px;padding:0}
    .cclq-content{padding:0 12px 12px}
    .cclq-section{padding:9px 0;border-bottom:1px solid var(--color-border,#8883)}
    .cclq-section:last-child{border-bottom:0;padding-bottom:0}
    .cclq-row{display:flex;justify-content:space-between;gap:8px;align-items:center}
    .cclq-muted{color:var(--color-text-secondary,#777);font-size:12px}
    .cclq-date{margin-top:3px}
    .cclq-card{display:flex;align-items:center;gap:3px;box-sizing:border-box;padding:5px 4px;border-radius:5px;background:var(--color-bg-primary-ghost-hover,#8881);margin-top:5px;font-size:12px;white-space:nowrap}
    .cclq-card-prefix,.cclq-expiry-state{flex-shrink:0}
    .cclq-expiry{min-width:0;overflow:hidden;text-overflow:ellipsis}
    .cclq-card[data-urgent=true] .cclq-expiry,.cclq-card[data-urgent=true] .cclq-expiry-state{color:var(--cclq-red)}
    .cclq-notice{font-size:11px;margin-top:8px;color:var(--color-text-secondary,#777)}
  `;
  doc.head.append(style);doc.body.append(panel);
  const el=(tag,text,className)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
  const tone=p=>p>=30?'var(--cclq-green)':p>=15?'var(--cclq-orange)':'var(--cclq-red)';
  function date(seconds,compact=false){
    if(!Number.isFinite(seconds))return null;
    const d=new Date(seconds*1000);if(!Number.isFinite(d.getTime()))return null;
    const now=new Date(),sameDay=d.toDateString()===now.toDateString();
    const day=compact?`${d.getFullYear()!==now.getFullYear()?`${d.getFullYear()}年`:''}${d.getMonth()+1}月${d.getDate()}日`:sameDay?'今天':new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',...(d.getFullYear()!==now.getFullYear()?{year:'numeric'}:{})}).format(d);
    return `${day}${compact?'':' '}${new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}).format(d)}`;
  }
  function close(focus=true){panel.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus&&slot.isConnected)trigger.focus();}
  function mount(){
    const anchor=adapter.controlAnchor?.();if(!anchor){card.remove();close(false);return;}
    slot.hidden=!visible;
    const color=anchor.rail.querySelector('[data-ccld-owner="sidebar-control"]');
    if(slot.parentElement!==card)card.prepend(slot);
    if(card.parentElement!==anchor.rail||card.nextElementSibling!==anchor.footer)anchor.rail.insertBefore(card,anchor.footer);
    if(color&&(color.parentElement!==card||color.nextElementSibling))card.append(color);
    if(!panel.hidden)position();
  }
  function position(){const rect=trigger.getBoundingClientRect();panel.style.left=`${Math.max(8,Math.min(rect.right+10,win.innerWidth-panel.offsetWidth-8))}px`;panel.style.top=`${Math.max(8,Math.min(rect.bottom-panel.offsetHeight,win.innerHeight-panel.offsetHeight-8))}px`;}
  function render(){
    if(dead)return;
    const view=createQuotaView(value),{stale,windows,details,urgentCount}=view;
    trigger.dataset.stale=String(!!stale);
    const next=JSON.stringify({...value,...view});
    if(next!==signature){
      const restoreFocus=!panel.hidden&&panel.contains(doc.activeElement);
      signature=next;trigger.replaceChildren();panel.replaceChildren();
      for(const w of windows.length?windows:[{label:'额度',remaining:null}]){
        const meter=el('span',undefined,'cclq-meter');meter.style.setProperty('--q-color',w.remaining===null?'#888':tone(w.remaining));
        const ring=el('span',undefined,'cclq-ring');
        ring.innerHTML='<svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15"/><circle class="cclq-value" cx="18" cy="18" r="15" pathLength="100"/></svg>';
        ring.querySelector('.cclq-value').setAttribute('stroke-dasharray',`${w.remaining??0} 100`);
        ring.append(el('span',w.remaining===null?'—':`${Math.round(w.remaining)}%`,'cclq-percent'));
        meter.append(ring,el('span',w.label,'cclq-label'));trigger.append(meter);
      }
      if(urgentCount){const badge=el('span','!','cclq-alert');badge.setAttribute('aria-hidden','true');trigger.append(badge);}
      trigger.title=stale?(value?.error||'额度暂不可用'):windows.length?windows.map(w=>`${w.label}剩余 ${Math.round(w.remaining)}%`).join(' · '):'周额度数据暂不可用';
      if(urgentCount)trigger.title+=`${trigger.title?' · ':''}${urgentCount}张充值卡将在3天内到期`;
      trigger.setAttribute('aria-label',`账号额度 · ${trigger.title}`);
      const header=el('div',undefined,'cclq-header'),closeButton=el('button','×','cclq-close');closeButton.type='button';closeButton.setAttribute('aria-label','关闭账号额度');header.append(el('span','账号额度'),closeButton);
      const content=el('div',undefined,'cclq-content');
      for(const w of windows){const section=el('div',undefined,'cclq-section'),row=el('div',undefined,'cclq-row'),remaining=el('span',`剩余 ${Math.round(w.remaining)}%`);remaining.style.color=stale?'var(--color-text-secondary,#777)':tone(w.remaining);row.append(el('strong',w.label),remaining);const reset=date(w.resetsAt);section.append(row,el('div',reset?`${reset} 重置`:'重置时间未提供','cclq-muted cclq-date'));content.append(section);}
      if(!windows.length)content.append(el('div',value?.error||(value?.updatedAt?'周额度数据暂不可用':'正在读取额度…'),'cclq-section cclq-muted'));
      const cards=value?.cards??{count:null,details:null},section=el('div',undefined,'cclq-section'),row=el('div',undefined,'cclq-row');row.append(el('strong','充值卡'),el('span',cards.count===null?'未提供':`剩余 ${cards.count} 张`,'cclq-muted'));section.append(row);
      if(cards.count===null)section.append(el('div','服务暂未提供重置卡信息','cclq-muted cclq-date'));
      else if(cards.count===0)section.append(el('div','暂无可用卡','cclq-muted cclq-date'));
      else if(!details?.length)section.append(el('div','到期明细未提供','cclq-muted cclq-date'));
      else {for(const item of details){const expiry=date(item.expiresAt,true),status=item.urgent?'即将到期':item.expired?'已到期':expiry?'到期':item.noExpiry?'无到期日':'到期时间未提供';const row=el('div',undefined,'cclq-card');row.dataset.urgent=String(item.urgent);row.title=expiry?`1张 · ${date(item.expiresAt)} ${status}`:`1张 · ${status}`;row.append(el('span','1张 ·','cclq-card-prefix'),el('span',expiry??'','cclq-expiry'),el('span',status,'cclq-expiry-state'));section.append(row);}if(details.length<cards.count)section.append(el('div','其余卡券明细未提供','cclq-muted cclq-date'));}
      content.append(section);
      if(stale)content.append(el('div',value?.error||'读数已过期，正在刷新','cclq-notice'));
      panel.append(header,content);if(restoreFocus)closeButton.focus();
    }
    mount();
  }
  panel.addEventListener('click',event=>{if(event.target.closest('.cclq-close'))close();},{signal:events.signal});
  trigger.addEventListener('click',()=>{if(!visible)return;if(!panel.hidden)return close();panel.hidden=false;trigger.setAttribute('aria-expanded','true');render();position();panel.querySelector('button')?.focus();},{signal:events.signal});
  doc.addEventListener('pointerdown',event=>{if(!slot.contains(event.target)&&!panel.contains(event.target))close(false);},{signal:events.signal,capture:true});
  doc.addEventListener('keydown',event=>{if(panel.hidden)return;if(event.key==='Escape'){event.preventDefault();close();}else if(event.key==='Tab'){event.preventDefault();panel.querySelector('button')?.focus();}},{signal:events.signal});
  win.addEventListener('resize',()=>{if(!panel.hidden)position();},{signal:events.signal});
  doc.addEventListener('scroll',()=>{if(!panel.hidden)position();},{signal:events.signal,capture:true});
  const timer=win.setInterval(()=>{if(Date.now()-lastHeartbeat>15000&&value&&!value.stale)value={...value,stale:true,error:'后台连接已断开，显示上次读数'};render();},2000);
  const api={update(next){value=next;render();},setVisible(show){visible=show===true;if(!visible)close(false);render();},heartbeat(){lastHeartbeat=Date.now();render();},controlContainer(anchor){return card.parentElement===anchor.rail?card:null;},status(){const view=createQuotaView(value);return{mounted:card.isConnected,visible,windows:view.windows.length,urgentCount:view.urgentCount,stale:trigger.dataset.stale==='true',open:!panel.hidden};},destroy(){if(dead)return;dead=true;events.abort();win.clearInterval(timer);const color=card.querySelector('[data-ccld-owner="sidebar-control"]');if(color){const anchor=adapter.controlAnchor?.();if(anchor)anchor.rail.insertBefore(color,anchor.footer);else color.remove();}card.remove();slot.remove();panel.remove();style.remove();if(win[key]===api)delete win[key];}};
  win[key]=api;render();return api.status();
}
