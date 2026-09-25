import test from 'node:test';
import assert from 'node:assert/strict';
import {makeInput,DEFAULT_CONFIG} from '../src/core/contracts.mjs';
import {plan} from '../src/core/planner.mjs';
import {unlockRoute} from '../src/core/unlocks.mjs';
import {mockGame} from './helpers.mjs';
import {GameAdapter} from '../src/game/adapter.mjs';
import {applyAction,advance,offerById} from '../src/core/model.mjs';
import {plan as alpha14Plan} from '../scripts/legacy/alpha14/planner.mjs';
import {hash} from '../src/runtime/diagnostics.mjs';
import {replay} from '../scripts/replay-engine.mjs';
import {Executor} from '../src/runtime/executor.mjs';

function measurementGame(){
 const g=mockGame(),original=g.CalculateGains;
 for(let id=10;id<16;id++)g.UpgradesById[id]={id,name:'unknown'+id,pool:'',bought:0,unlocked:1,getPrice(){return 1;}};
 g.UpgradesInStore=g.UpgradesById.filter(Boolean);
 g.CalculateGains=()=>{original();g.cookiesPs+=g.UpgradesById.filter(x=>x&&x.id>=10&&x.bought).length;};
 g.ObjectsById[0].minigameLoaded=true;g.ObjectsById[0].minigame={magic:0};return g;
}
test('changing magic allows the measurement queue to finish',()=>{
 const g=measurementGame(),a=new GameAdapter(()=>g);let input;
 for(let n=0;n<8;n++){g.ObjectsById[0].minigame.magic=n;input=a.capture(DEFAULT_CONFIG);assert.ok(input.observation.measurementPasses<=4);}
 assert.equal(input.observation.pendingMeasurements,0);assert.ok(input.state.offers.find(o=>o.id==='upgrade:15').effect);
});
test('production changes invalidate results but preserve fair probe progress',()=>{
 const g=measurementGame(),a=new GameAdapter(()=>g),seen=new Set();
 for(let n=0;n<8;n++){g.ObjectsById[0].amount++;g.CalculateGains();const input=a.capture(DEFAULT_CONFIG);assert.ok(input.observation.measurementPasses<=4);for(const o of input.state.offers)if(o.effect)seen.add(o.id);}
 for(let id=10;id<16;id++)assert.ok(seen.has('upgrade:'+id));
});
test('magic regeneration does not reject a fresh facility purchase',()=>{
 const g=mockGame();g.cookies=100;g.ObjectsById[0].minigameLoaded=true;g.ObjectsById[0].minigame={magic:0};
 const a=new GameAdapter(()=>g),input=a.capture(DEFAULT_CONFIG),offer=offerById(input.state,'building:0');
 g.ObjectsById[0].minigame.magic=1;
 const decision={selectedAction:{...offer,operation:'buyBuilding',quantity:1}};
 assert.equal(new Executor(a,()=>true).execute(decision,input,'magic').status,'confirmed');
});
const good={id:'upgrade:good',kind:'upgrade',targetId:9,price:1,effect:{flatPassive:100}};
test('missing reservations release and select a productive alternative',()=>{
 const p=plan(makeInput({bank:100,passive:1,commitment:{targetId:'missing',status:'saving'},offers:[good]}));
 assert.equal(p.selectedAction.id,good.id);assert.equal(p.reservationRecovery.reason,'target-missing');
});
test('temporarily unmodeled reservations recover or release after confirmation',()=>{
 const state={bank:100,passive:1,commitment:{targetId:'upgrade:pending',status:'saving'},offers:[good,{id:'upgrade:pending',kind:'upgrade',targetId:10,price:5,effect:null}]};
 let p=plan(makeInput(state));assert.equal(p.selectedAction.id,'wait');state.commitment=p.nextCommitment;
 const recovered=plan(makeInput({...state,offers:[good,{...state.offers[1],effect:{flatPassive:1}}]}));assert.equal(recovered.selectedAction.id,'upgrade:pending');
 p=plan(makeInput(state));assert.equal(p.selectedAction.id,'wait');state.commitment=p.nextCommitment;
 p=plan(makeInput(state));assert.equal(p.selectedAction.id,good.id);assert.equal(p.reservationRecovery.released,true);
});
test('41 affordable route purchases require 60 seconds between first and last',()=>{
 const i=makeInput({bank:1e9,passive:1,buildings:[{id:1,amount:0,unitCps:1,nextPrice:1,priceAtAmount:0}],offers:[{id:'goal',kind:'upgrade',targetId:1,price:1,requiresBuildings:[{id:1,amount:40}],effect:{flatPassive:1000}}]});
 const r=unlockRoute(i.state,'goal',i.config);assert.equal(r.path.length,41);assert.equal(r.eta,60);
 assert.equal(r.state.bank,1e9-r.cost+60+1.5*40*41/2);
 for(let n=1;n<r.path.length;n++)assert.ok(r.path[n].at-r.path[n-1].at>=1.5);
});
test('short beam also respects the purchase interval',()=>{
 const p=plan(makeInput({bank:100,passive:1,offers:[good,{...good,id:'upgrade:other',targetId:10}]}));
 for(const n of p.expandedNodes){const parent=p.expandedNodes.find(x=>x.id===n.parentId);if(parent)assert.ok(n.at-parent.at>=1.5);}
});
test('unreserved long goals extend the common horizon despite a cheap short investment',()=>{
 const state={passive:1,buildings:[{id:1,amount:0,unitCps:.01,nextPrice:1000,priceAtAmount:0}],offers:[{id:'small',kind:'upgrade',targetId:1,price:1,effect:{flatPassive:1}},{id:'goal',kind:'upgrade',targetId:2,price:10,requiresBuildings:[{id:1,amount:10}],effect:{flatPassive:1e6}}]};
 const p=plan(makeInput(state)),r=p.unlockPaths.find(x=>x.targetId==='goal');assert.ok(p.horizons[2]>r.eta);assert.equal(r.value.length,3);
});
test('current node values match independent path replay across buffs and events',()=>{
 for(let n=1;n<=25;n++){
  const i=makeInput({bank:n*10,passive:n,clickUnit:1,clickRate:n%2?100:0,buildings:[{id:1,amount:0,unitCps:10,nextPrice:30,priceAtAmount:0}],offers:[good,{id:'upgrade:mult',kind:'upgrade',targetId:10,price:100,effect:{passiveMultiplier:2}}],buffs:[{remaining:7,passive:7,click:2}],events:[{at:31,effect:{flatPassive:100}}]}),p=plan(i);
  const nodes=new Map(p.expandedNodes.map(x=>[x.id,x]));
  for(const node of p.expandedNodes){
   const path=[];for(let cur=node;cur;cur=nodes.get(cur.parentId))path.unshift(cur);
   for(let k=0;k<p.horizons.length;k++){
    const horizon=p.horizons[k];let state=i.state;
    for(const step of path){if(step.at>horizon)break;state=advance(state,step.at-state.elapsed);state=applyAction(state,offerById(state,step.actionId),i.config.purchaseIntervalMs);assert.ok(state);}
    const end=advance(state,horizon-state.elapsed),expected=end.bank+end.deferred;
    assert.ok(Math.abs(node.value[k]-expected)<1e-8*Math.max(1,Math.abs(expected)));
   }
  }
 }
});
test('alpha14 diagnostics remain replayable after review corrections',async()=>{
 const input={...structuredClone(makeInput({bank:100,passive:1,offers:[good]})),engineVersion:'9.0.0-alpha.14'};
 const snapshot={schemaVersion:1,input,inputHash:await hash(input),decision:alpha14Plan(input)};
 assert.equal((await replay(snapshot)).matches,true);
});
