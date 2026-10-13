// Adapted from codex-usage-badge, copyright (c) 2026 Codex Usage Badge contributors.
// MIT; full notice: third-party/codex-usage-badge-LICENSE.
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export class StartupController {
  constructor(adapter, {now=Date.now, sleep=delay, lastAttemptAt=0, cooldownMs=120000}={}) {
    Object.assign(this,{adapter,now,sleep,lastAttemptAt,cooldownMs});
    this.baselined=false; this.seen=new Set(); this.busy=false; this.stopped=false;
  }
  stop() { this.stopped=true; }
  async tick() {
    if(this.busy||this.stopped)return;
    this.busy=true;
    this.pendingLaunch=false;
    try {
      const snapshot=await this.adapter.snapshot();
      if(!this.baselined) {
        for(const app of snapshot.apps)this.seen.add(app.key);
        this.baselined=true;
        await this.adapter.record('watching',{existingApps:snapshot.apps.length});
        return;
      }
      const fresh=snapshot.apps.filter(app=>!this.seen.has(app.key));
      if(this.seen.size>256)this.seen=new Set(snapshot.apps.map(app=>app.key));
      if(fresh.length!==1||snapshot.apps.length!==1) {
        for(const app of snapshot.apps)this.seen.add(app.key);
        return;
      }
      const app=fresh[0], age=this.now()-app.launchedAt;
      if(!app.argumentsKnown||app.debugPort!==null) { this.seen.add(app.key); return; }
      // Wait for the initial launch to finish; never interrupt a partially initialized app.
      if((!app.finishedLaunching||snapshot.frontmostPid!==app.pid) && age>=0 && age<=8000 && snapshot.inputIdleMs>=age) {
        this.pendingLaunch=true; return;
      }
      // Remember even rejected candidates: do not revisit a running work window later.
      this.seen.add(app.key);
      if(age<0||age>8000||snapshot.inputIdleMs<age||snapshot.frontmostPid!==app.pid) {
        await this.adapter.record('skipped-active-or-background'); return;
      }
      if(this.lastAttemptAt && this.now()-this.lastAttemptAt<this.cooldownMs) {
        await this.adapter.record('skipped-cooldown'); return;
      }
      if(await this.adapter.portInUse()) { await this.adapter.record('port-in-use'); return; }
      if(this.stopped)return;
      // Durable receipt must succeed before any quit request. A failure/restart cannot cause a loop.
      this.lastAttemptAt=this.now();
      await this.adapter.record('attempt',{lastAttemptAt:this.lastAttemptAt,processKey:app.key});
      if(this.stopped)return;
      const quit=await this.adapter.quit(app,snapshot.inputStamp);
      if(!quit.accepted) { await this.adapter.record('quit-refused'); return; }
      const deadline=this.now()+10000;
      let absent=null;
      while(!this.stopped&&this.now()<deadline) {
        await this.sleep(200);
        const current=await this.adapter.snapshot();
        if(current.apps.some(a=>a.key!==app.key)) {
          for(const a of current.apps)this.seen.add(a.key);
          await this.adapter.record('another-instance-started'); return;
        }
        if(current.apps.length===0) { absent=current; break; }
      }
      if(this.stopped)return;
      if(!absent) { await this.adapter.record('quit-timeout'); return; }
      // User input during shutdown means they may have canceled/changed their mind; do not reopen.
      if(absent.inputStamp!==snapshot.inputStamp) { await this.adapter.record('canceled-by-input'); return; }
      await this.sleep(250);
      const beforeLaunch=await this.adapter.snapshot();
      if(this.stopped||beforeLaunch.apps.length||beforeLaunch.inputStamp!==snapshot.inputStamp) {
        for(const a of beforeLaunch.apps)this.seen.add(a.key);
        await this.adapter.record('reopen-canceled'); return;
      }
      const opened=await this.adapter.launch(snapshot.inputStamp,beforeLaunch.frontmostPid); // hidden, no activation
      if(!opened.launched) { await this.adapter.record('launch-failed'); return; }
      if(opened.key)this.seen.add(opened.key);
      if(this.stopped)return;
      // Only complete the user's original foreground launch if they have not interacted elsewhere.
      const shown=await this.adapter.show(opened,snapshot.inputStamp,beforeLaunch.frontmostPid);
      await this.adapter.record('reopened',{shown:!!shown.shown,processKey:opened.key});
    } catch(error) {
      await this.adapter.record('error',{message:error.message}).catch(()=>{});
    } finally { this.busy=false; }
  }
}
