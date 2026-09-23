import { DEFAULT_CONFIG } from '../core/contracts.mjs';
import { plan } from '../core/planner.mjs';
import { Executor } from './executor.mjs';
import { bundle, Diagnostics } from './diagnostics.mjs';

export const RUNTIME_KEY='__CC_SMART_AUTO_RUNTIME__';
export class Coordinator {
  constructor(page,adapter,{config={},diagnostics=new Diagnostics(),clock=()=>Date.now(),onUpdate=()=>{}}={}){
    this.page=page;this.adapter=adapter;this.config={...DEFAULT_CONFIG,...config};this.diagnostics=diagnostics;
    this.clock=clock;this.onUpdate=onUpdate;this.version='9.0.0-alpha.3';this.generation=0;
    this.token=globalThis.crypto.randomUUID();this.stopped=false;this.running=false;this.commitment=null;
    this.cycle=0;this.timers=[];this.clicks=[];this.started=clock();this.error=null;this.last=null;
    this.executor=new Executor(adapter,()=>this.owns(),clock);
    this.snapshot=()=>this.diagnostics.latest();
  }
  owns(){return !this.stopped && this.page[RUNTIME_KEY]===this;}
  async start({timers=true}={}){
    const old=this.page[RUNTIME_KEY];
    if(old?.shutdown)old.shutdown('new-version');
    this.page[RUNTIME_KEY]=this;
    await this.diagnostics.open();
    if(!this.owns())return;
    if(timers){
      this.timers.push(setInterval(()=>this.tick(),this.config.purchaseIntervalMs));
      this.timers.push(setInterval(()=>this.clickTick(),10));
      this.timers.push(setInterval(()=>this.collectTick(),150));
    }
    this.onUpdate(this);
  }
  measuredClickRate(){const now=this.clock();this.clicks=this.clicks.filter(t=>now-t<5000);return this.config.observeOnly || !this.config.autoClick?0:this.clicks.length/Math.max(.001,Math.min(5,(now-this.started)/1000));}
  clickRate(){return this.measuredClickRate();}
  clickTick(){
    if(!this.owns() || this.config.observeOnly || !this.config.autoClick || this.error)return;
    const now=this.clock();if(now<(this.nextClickAt??0))return;
    // No catch-up burst after a stalled/background tab.
    this.nextClickAt=now+1000/this.config.clickRate;
    try{if(this.adapter.click(this.config.clickRate))this.clicks.push(now);}catch(e){this.error=e.message;this.onUpdate(this);}
  }
  collectTick(){if(!this.owns() || this.config.observeOnly || this.error)return;try{this.adapter.collect(this.config);}catch(e){this.error=e.message;this.onUpdate(this);}}
  async tick(){
    if(!this.owns() || this.running || this.adapter.fault || this.error==='purchase-result-unresolved')return;
    this.running=true;
    const generation=this.generation,observeOnly=this.config.observeOnly;
    const elapsed=()=>globalThis.performance.now();
    const started=elapsed();
    try{
      this.error=null;
      const runIdentity=this.adapter.runIdentity();
      if(this.runIdentity!==undefined && this.runIdentity!==runIdentity){
        this.commitment=null;this.executor=new Executor(this.adapter,()=>this.owns(),this.clock);
        this.started=this.clock();this.clicks=[];
      }
      this.runIdentity=runIdentity;
      const pending=this.executor.poll();
      if(pending){
        if(pending.status==='pending')return;
        if(this.last){this.last.receipt=pending;await this.diagnostics.save(this.last);}
        if(pending.status==='unresolved')throw new Error('purchase-result-unresolved');
        if(pending.status==='confirmed' && this.commitment?.targetId===pending.actionId)this.commitment=null;
      }
      const input=this.adapter.capture(this.config,observeOnly?null:this.commitment,this.config.autoClick?this.clickRate():0);
      const captured=elapsed();
      const decision=plan(input);
      const planned=elapsed();
      const record=await bundle(input,decision,this.token+':'+(++this.cycle));
      record.runtimeVersion=this.version;
      record.timings={captureMs:captured-started,plannerMs:planned-captured};
      await this.diagnostics.save(record);
      if(!this.owns() || generation!==this.generation)return;
      if(!observeOnly){
        this.commitment=decision.nextCommitment;
        record.receipt=this.executor.execute(decision,input,record.cycleId);
        if(record.receipt.status==='confirmed' && this.commitment?.targetId===record.receipt.actionId)this.commitment=null;
        // An exception stops just this purchase cycle; the next cycle recaptures unless restore failed.
        if(this.adapter.fault)throw new Error(this.adapter.fault);
        await this.diagnostics.save(record);
      }
      this.last=record;
    }catch(error){
      this.error=String(error.message);
    }finally{this.running=false;this.onUpdate(this);}
  }
  setObserveOnly(value){
    if(this.config.observeOnly===value)return;
    this.generation++;this.config.observeOnly=value;this.commitment=null;this.last=null;this.resume();
  }
  clearCommitment(){this.generation++;this.commitment=null;this.last=null;this.onUpdate(this);}
  setClickRate(value){
    if(!Number.isInteger(value) || value<1 || value>100)throw new TypeError('クリック速度は1〜100の整数で指定してください');
    this.config.clickRate=value;this.clearCommitment();this.resume();
  }
  resume(){this.error=null;this.started=this.clock();this.clicks=[];this.nextClickAt=0;this.onUpdate(this);}
  shutdown(){if(this.stopped)return;this.stopped=true;for(const t of this.timers)clearInterval(t);this.timers=[];this.diagnostics.close();this.onUpdate(this);}
}
