import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInput,clone } from '../src/core/contracts.mjs';
import { plan } from '../src/core/planner.mjs';
import { plan as oldPlan } from '../scripts/legacy/alpha6/planner.mjs';
import { eta } from '../src/core/model.mjs';
import { eta as oldEta } from '../scripts/legacy/alpha6/model.mjs';
import { makeGolden } from '../src/core/golden.mjs';
import { hash } from '../src/runtime/diagnostics.mjs';
import { replay } from '../scripts/replay-engine.mjs';

test('alpha6 diagnostic replay retains original decisions and checksum checks',async()=>{
 const input={...clone(makeInput({passive:1,golden:makeGolden({})})),engineVersion:'9.0.0-alpha.6',rulesetVersion:'cc-web-2.058/strategy-1'};
 const snapshot={schemaVersion:1,input,inputHash:await hash(input),decision:oldPlan(input)};
 assert.equal((await replay(snapshot)).matches,true);input.state.bank++;
 await assert.rejects(()=>replay(snapshot),/InputChecksumMismatch/);
});

test('explicit unlock route gains no priority over a more productive ordinary purchase',()=>{
 const input=makeInput({bank:100,passive:1,buildings:[{id:1,amount:0,unitCps:.1,nextPrice:10,priceAtAmount:0}],offers:[
  {id:'upgrade:fast',kind:'upgrade',price:10,effect:{flatPassive:1000}},
  {id:'upgrade:tier',kind:'upgrade',price:10,requiresBuildings:[{id:1,amount:2}],effect:{flatPassive:1}}
 ],config:{depth:3,beamWidth:1}});
 const result=plan(input);assert.equal(result.selectedAction.id,'upgrade:fast');assert.equal(result.nextCommitment,null);
});

test('short unlock routes remain explicit alternatives even inside beam depth',()=>{
 const input=makeInput({bank:100,passive:1,buildings:[{id:1,amount:0,unitCps:.1,nextPrice:10,priceAtAmount:0}],offers:[
  {id:'upgrade:fast',kind:'upgrade',price:10,effect:{flatPassive:10}},
  {id:'upgrade:tier',kind:'upgrade',price:10,requiresBuildings:[{id:1,amount:2}],effect:{flatPassive:1000}}
 ],config:{depth:3,beamWidth:1}});
 const result=plan(input),route=result.unlockPaths.find(p=>p.targetId==='upgrade:tier');
 assert.equal(route.status,'known');assert.ok(Number.isInteger(route.nodeId));
 assert.equal(result.selectedAction.id,'building:1');assert.equal(result.nextCommitment.targetId,'upgrade:tier');
});

test('guaranteed ETA ignores forecasts across buff expiry and future income changes',()=>{
 for(let n=1;n<=20;n++){
  const s=makeInput({bank:10,passive:n,clickUnit:1,clickRate:100,golden:makeGolden({}),buffs:[{remaining:7,passive:7,click:2}],events:[{at:31,effect:{flatPassive:100}}]}).state;
  const before=JSON.stringify(s);assert.equal(eta(s,100000*n),oldEta(s,100000*n));assert.equal(JSON.stringify(s),before);
 }
});

test('optimized planner preserves alpha6 decisions and horizon values without unlock routes',()=>{
 for(let n=1;n<=20;n++){
  const input=makeInput({bank:n*11,passive:n,clickUnit:1,clickRate:n%2?100:0,golden:n%3?null:makeGolden({}),offers:[
   {id:'upgrade:a',kind:'upgrade',price:100,effect:{flatPassive:10}},
   {id:'upgrade:b',kind:'upgrade',price:200,effect:{passiveMultiplier:2}}
  ],buffs:[{remaining:7,passive:7,click:2}],events:[{at:31,effect:{flatPassive:100}}]});
  const prior={...clone(input),engineVersion:'9.0.0-alpha.6',rulesetVersion:'cc-web-2.058/strategy-1'},a=plan(input),b=oldPlan(prior);
  assert.deepEqual(a.selectedAction,b.selectedAction);assert.deepEqual(a.nextCommitment,b.nextCommitment);
  assert.equal(a.expandedNodes.length,b.expandedNodes.length);
  for(let j=0;j<a.expandedNodes.length;j++)for(let k=0;k<3;k++)assert.ok(Math.abs(a.expandedNodes[j].value[k]-b.expandedNodes[j].value[k])<1e-8*Math.max(1,Math.abs(b.expandedNodes[j].value[k])));
 }
});
