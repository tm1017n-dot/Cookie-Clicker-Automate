import { epsilon } from '../core/contracts.mjs';

export class Executor {
  constructor(adapter, ownsToken, clock = () => Date.now()) { this.adapter=adapter;this.ownsToken=ownsToken;this.clock=clock;this.pending=null;this.seen=new Set(); }
  execute(decision,input,cycleId) {
    const action=decision.selectedAction;
    const receipt={cycleId,actionId:action.id,attemptCount:0,status:'skipped',before:null,after:null,exception:null};
    if (this.pending) return {...receipt,status:'pending'};
    if (this.seen.has(cycleId)) return {...receipt,status:'duplicate-cycle'};
    this.seen.add(cycleId); if(this.seen.size>1000)this.seen.delete(this.seen.values().next().value);
    if(action.kind==='wait')return receipt;
    try {
      if(!this.ownsToken())return {...receipt,status:'stale-token'};
      const a=this.adapter,bank=a.game.cookies;
      if(!a.playable() || (input.observation && a.signature()!==input.observation.signature))return {...receipt,status:'stale'};
      const price=a.price(action.kind,action.targetId);
      if(Math.abs(price-action.price)>epsilon(price,action.price) || bank < input.state.bank-epsilon(bank,input.state.bank) || bank < price+input.state.reserve)return {...receipt,status:'stale'};
      receipt.before={marker:a.marker(action),bank};
      if(action.kind==='upgrade' && receipt.before.marker)return {...receipt,status:'already-owned'};
      if(!this.ownsToken())return {...receipt,status:'stale-token'};
      receipt.attemptCount=1;
      const result=a.execute(action);
      receipt.apiResult=typeof result==='boolean'?result:null;
      receipt.after={marker:a.marker(action),bank:a.game.cookies};
      if(receipt.after.marker>receipt.before.marker)receipt.status='confirmed';
      else if(result===false)receipt.status='rejected';
      else {receipt.status='pending';this.pending={action,before:receipt.before,at:this.clock(),receipt};}
    } catch(error) {receipt.status='exception';receipt.exception=String(error.message);}
    return receipt;
  }
  poll() {
    if(!this.pending)return null;
    const p=this.pending;
    if(!this.ownsToken()){this.pending=null;return {...p.receipt,status:'stale-token'};}
    if(this.adapter.marker(p.action)>p.before.marker) {this.pending=null;return {...p.receipt,status:'confirmed',after:{marker:this.adapter.marker(p.action),bank:this.adapter.game.cookies}};}
    if(this.clock()-p.at>2000){this.pending=null;return {...p.receipt,status:'unresolved'};}
    return {...p.receipt,status:'pending'};
  }
}
