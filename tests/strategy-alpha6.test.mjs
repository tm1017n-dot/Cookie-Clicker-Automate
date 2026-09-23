import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInput } from '../src/core/contracts.mjs';
import { income,applyAction,allOffers,advance,eta } from '../src/core/model.mjs';
import { unlockRoute } from '../src/core/unlocks.mjs';
import { makeInput as legacyInput } from '../scripts/legacy/alpha5/contracts.mjs';
import { plan as legacyPlan } from '../scripts/legacy/alpha5/planner.mjs';
import { hash } from '../src/runtime/diagnostics.mjs';
import { replay } from '../scripts/replay-engine.mjs';

test('alpha5 diagnostics replay using the preserved engine and verify checksums',async()=>{
 const input=legacyInput({bank:50,passive:1,offers:[{id:'upgrade:1',kind:'upgrade',price:10,effect:{flatPassive:2}}]});
 const snapshot={schemaVersion:1,input,inputHash:await hash(input),decision:legacyPlan(input)};
 assert.equal((await replay(snapshot)).matches,true);const corrupt=JSON.parse(JSON.stringify(snapshot));corrupt.input.state.bank++;
 await assert.rejects(()=>replay(corrupt),/InputChecksumMismatch/);
});

test('synergy updates both building rates after each purchase',()=>{
 const s=makeInput({bank:100,buildings:[{id:1,amount:10,unitCps:1,nextPrice:1,priceAtAmount:10},{id:2,amount:10,unitCps:10,nextPrice:1,priceAtAmount:10}],production:{synergies:[],kittenPowers:[],baseKitten:1,achievements:0,milkMultiplier:1,milestones:[]},offers:[{id:'upgrade:s',kind:'upgrade',price:1,effect:{synergies:[{a:1,b:2,ka:.05,kb:.001}]}}]}).state;
 const next=applyAction(s,allOffers(s).find(o=>o.id==='upgrade:s'));
 assert.equal(income(next).passive,116);const after=applyAction(next,allOffers(next).find(o=>o.id==='building:2'));
 assert.equal(income(after).passive,126.6);assert.equal(income(s).passive,110);
});
test('facility milestone increases milk once and compounds all owned kittens',()=>{
 const s=makeInput({bank:100,buildings:[{id:1,amount:4,unitCps:10,nextPrice:1,priceAtAmount:4}],production:{synergies:[],kittenPowers:[.1,.2],baseKitten:1.1*1.2,achievements:25,milkMultiplier:1,milestones:[{id:9,buildingId:1,amount:5}]}}).state;
 const a=applyAction(s,allOffers(s)[0]),b=applyAction(a,allOffers(a)[0]);
 assert.ok(Math.abs(income(a).passive-50*(1+26/25*.1)*(1+26/25*.2)/(1.1*1.2))<1e-9);
 assert.ok(Math.abs(income(b).passive/income(a).passive-6/5)<1e-9);
});
test('research route waits after prerequisite, but never buys the locked target directly',()=>{
 const input=makeInput({bank:100,passive:1,offers:[{id:'upgrade:1',kind:'upgrade',targetId:1,price:10,effect:{startResearch:{targetId:'upgrade:2',seconds:30}}},{id:'upgrade:2',kind:'upgrade',targetId:2,price:20,research:true,researchReady:false,requiresOwned:['upgrade:1'],effect:{flatPassive:10}}]});
 const route=unlockRoute(input.state,'upgrade:2',input.config);assert.equal(route.status,'known');assert.equal(route.eta,30);assert.equal(route.cost,30);assert.equal(route.path[0].action.id,'upgrade:1');
 const first=applyAction(input.state,allOffers(input.state)[0]);assert.equal(allOffers(first)[1].eligible,false);assert.equal(allOffers(advance(first,30))[1].eligible,true);
});

test('kitten unlock route buys milestone facilities and respects the search budget',()=>{
 const input=makeInput({bank:1000,buildings:[{id:1,amount:4,unitCps:10,nextPrice:1,priceAtAmount:4}],production:{synergies:[],kittenPowers:[],baseKitten:1,achievements:12,milkMultiplier:1,milestones:[{id:9,buildingId:1,amount:5}]},offers:[{id:'upgrade:cat',kind:'upgrade',price:10,requiresAchievements:13,effect:{kittenPower:.1}}]});
 const before=JSON.stringify(input),route=unlockRoute(input.state,'upgrade:cat',input.config);
 assert.equal(route.status,'known');assert.deepEqual(route.path.map(p=>p.action.id),['building:1','upgrade:cat']);assert.equal(JSON.stringify(input),before);
 assert.equal(unlockRoute(input.state,'upgrade:cat',input.config,{remaining:1}).status,'unavailable');
 assert.equal(allOffers(input.state).find(o=>o.id==='upgrade:cat').eligible,false);
});

test('already running research uses remaining time without restarting its prerequisite',()=>{
 const input=makeInput({bank:100,passive:1,owned:['upgrade:1'],offers:[{id:'upgrade:2',kind:'upgrade',price:20,research:true,researchReady:true,availableAt:17,requiresOwned:['upgrade:1'],effect:{flatPassive:10}}]});
 const route=unlockRoute(input.state,'upgrade:2',input.config);
 assert.equal(route.status,'known');assert.equal(route.eta,17);assert.equal(route.path.length,1);
});
