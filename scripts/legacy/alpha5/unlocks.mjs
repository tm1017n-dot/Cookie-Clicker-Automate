import { clone } from './contracts.mjs';
import { offerById,applyAction,advance,eta,eligible } from './model.mjs';

// Simulate the complete dependency cost without external side effects.
export function unlockRoute(initial,targetId,config,budget={remaining:256}){
  let state=clone(initial),cost=0,limited=false;
  const path=[],visiting=new Set();
  function buy(id){
    if(path.length>=config.maxUnlockSteps || budget.remaining<=0)throw new Error('unlock-budget');
    let offer=offerById(state,id);
    if(!offer || !offer.eligible || !offer.effect || offer.disabled)throw new Error('unavailable-prerequisite');
    if(limited || (offer.rootOnly && path.length))throw new Error('unsupported-child-model');
    for(let n=0;n<config.maxEvents;n++){
      const delay=eta(state,offer.price,config.maxEvents);
      if(!Number.isFinite(delay))throw new Error('unreachable');
      state=advance(state,delay,config.maxEvents);
      offer=offerById(state,id);
      const after=applyAction(state,offer);
      if(after){
        budget.remaining--;cost+=offer.price;state=after;limited=!!offer.rootOnly;
        const at=state.elapsed-initial.elapsed;
        path.push({action:{id:offer.id,kind:offer.kind,operation:offer.kind==='building'?'buyBuilding':'buyUpgrade',targetId:offer.targetId,quantity:1,price:offer.price},at,wait:at-(path.at(-1)?.at??0)});return;
      }
      if(!offer?.eligible)throw new Error('unavailable-prerequisite');
    }
    throw new Error('event-budget');
  }
  function acquire(id){
    if(state.owned.includes(id))return;
    if(visiting.has(id))throw new Error('dependency-cycle');
    if(visiting.size>=config.maxUnlockSteps)throw new Error('unlock-budget');
    const offer=offerById(state,id);
    if(!offer || offer.disabled || !offer.effect)throw new Error('unknown-prerequisite');
    visiting.add(id);
    for(const required of offer.requiresOwned??[])acquire(required);
    for(const requirement of offer.requiresBuildings??[]){
      const building=state.buildings.find(b=>b.id===requirement.id);
      if(!building || building.disabled)throw new Error('unavailable-building');
      while(state.buildings.find(b=>b.id===requirement.id).amount<requirement.amount)buy('building:'+requirement.id);
    }
    if(offer.availableAt>state.elapsed){if(limited)throw new Error('unsupported-child-model');state=advance(state,offer.availableAt-state.elapsed,config.maxEvents);}
    if(!eligible(state,offer))throw new Error('unavailable-prerequisite');
    buy(id);visiting.delete(id);
  }
  try{acquire(targetId);return {targetId,status:'known',state,path,cost,eta:state.elapsed-initial.elapsed};}
  catch(error){return {targetId,status:'unavailable',reason:error.message,path:[],cost:null,eta:null};}
}
