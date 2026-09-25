import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInput,clone } from '../src/core/contracts.mjs';
import { plan } from '../src/core/planner.mjs';
import { unlockRoute } from '../src/core/unlocks.mjs';

const tierState=()=>({bank:100,buildings:[{id:1,amount:1,unitCps:1,nextPrice:10,unroundedNextPrice:10,priceAtAmount:1,growth:1.15}],offers:[
 {id:'upgrade:7',kind:'upgrade',targetId:7,price:200,requiresBuildings:[{id:1,amount:5}],effect:{buildingMultipliers:[{id:1,multiplier:100}]}},
 {id:'upgrade:9',kind:'upgrade',targetId:9,price:100,effect:{flatPassive:10}}
]});
test('unlock route accounts for every price increase and prerequisite',()=>{
 const input=makeInput(tierState()),route=unlockRoute(input.state,'upgrade:7',input.config);
 assert.equal(route.status,'known');assert.equal(route.path.length,5);assert.deepEqual(route.path.map(s=>s.action.price),[10,12,14,16,200]);assert.equal(route.cost,252);assert.ok(route.state.owned.includes('upgrade:7'));assert.equal(input.state.buildings[0].amount,1);
});
test('goal route reaches milestones beyond the local search depth',()=>{
 const input=makeInput({bank:1e12,buildings:[{id:1,amount:0,unitCps:1,nextPrice:10,unroundedNextPrice:10,priceAtAmount:0,growth:1.15}],offers:[
  {id:'upgrade:far',kind:'upgrade',targetId:77,price:100,requiresBuildings:[{id:1,amount:40}],effect:{buildingMultipliers:[{id:1,multiplier:10}]}}
 ]}),route=unlockRoute(input.state,'upgrade:far',input.config);
 assert.equal(route.status,'known');assert.equal(route.path.length,41);assert.equal(route.path[0].action.id,'building:1');assert.equal(route.path.at(-1).action.id,'upgrade:far');
});
test('long goal route can buy an upgrade that strengthens future facilities',()=>{
 const d=plan(makeInput({bank:10,passive:1,buildings:[{id:1,amount:0,unitCps:1,nextPrice:10,unroundedNextPrice:10,priceAtAmount:0,growth:1.15}],offers:[
  {id:'upgrade:boost',kind:'upgrade',targetId:1,price:10,effect:{buildingMultipliers:[{id:1,multiplier:100}]}},
  {id:'upgrade:goal',kind:'upgrade',targetId:2,price:100,requiresBuildings:[{id:1,amount:10}],effect:{buildingMultipliers:[{id:1,multiplier:10}]}}
 ]})),direct=d.unlockPaths.find(r=>r.targetId==='upgrade:goal'&&!r.investmentId),invested=d.unlockPaths.find(r=>r.targetId==='upgrade:goal'&&r.investmentId==='upgrade:boost');
 assert.ok(invested.eta<direct.eta);assert.equal(invested.steps[0].action.id,'upgrade:boost');assert.equal(d.selectedAction.id,'upgrade:boost');assert.equal(d.nextCommitment.targetId,'upgrade:boost');
});
test('long goal route compares a discount before future facilities and upgrade',()=>{
 const d=plan(makeInput({bank:10,passive:10,buildings:[{id:1,amount:0,unitCps:1,nextPrice:100,unroundedNextPrice:100,priceAtAmount:0,growth:1.15}],offers:[
  {id:'upgrade:discount',kind:'upgrade',targetId:1,price:10,effect:{buildingPriceMultiplier:.5,upgradePriceMultiplier:.5}},
  {id:'upgrade:goal',kind:'upgrade',targetId:2,price:1000,requiresBuildings:[{id:1,amount:5}],effect:{buildingMultipliers:[{id:1,multiplier:10}]}}
 ]})),direct=d.unlockPaths.find(r=>r.targetId==='upgrade:goal'&&!r.investmentId),discounted=d.unlockPaths.find(r=>r.targetId==='upgrade:goal'&&r.investmentId==='upgrade:discount');
 assert.ok(discounted.totalCost<direct.totalCost);assert.ok(discounted.eta<direct.eta);
});
test('valuable unlock beyond ordinary search depth changes the first action',()=>{
 const input=makeInput(tierState()),d=plan(input);assert.equal(d.selectedAction.id,'building:1');assert.equal(d.nextCommitment.targetId,'upgrade:7');
 assert.equal(d.unlockPaths.find(r=>r.targetId==='upgrade:7').steps.length,5);
 const without=clone(input);without.state.offers=without.state.offers.filter(o=>o.id!=='upgrade:7');assert.equal(plan(without).selectedAction.id,'upgrade:9');
});
test('locked upgrade reservation buys prerequisites rather than the locked upgrade',()=>{
 const state=tierState();state.offers=state.offers.slice(0,1);
 const d=plan(makeInput({...state,commitment:{targetId:'upgrade:7',status:'saving'}}));assert.equal(d.selectedAction.id,'building:1');assert.equal(d.nextCommitment.targetId,'upgrade:7');
});
test('unlock reservation permits an investment that reduces complete target ETA',()=>{
 const d=plan(makeInput({...tierState(),commitment:{targetId:'upgrade:7',status:'saving'}}));assert.equal(d.selectedAction.id,'upgrade:9');assert.equal(d.nextCommitment.targetId,'upgrade:7');
 assert.ok(d.targetEta.via.find(x=>x.actionId==='upgrade:9').seconds.value<d.targetEta.direct.value);
});
test('unlock cycles and oversized routes stop with explicit reasons',()=>{
 const cyclic=makeInput({offers:[{id:'a',price:1,effect:{flatPassive:1},requiresOwned:['b']},{id:'b',price:1,effect:{flatPassive:1},requiresOwned:['a']}]});assert.equal(unlockRoute(cyclic.state,'a',cyclic.config).reason,'dependency-cycle');
 const input=makeInput({...tierState(),config:{maxUnlockSteps:2}});assert.equal(unlockRoute(input.state,'upgrade:7',input.config).reason,'unlock-budget');
});
test('unlock route includes prerequisite upgrades and their income during saving',()=>{
 const input=makeInput({bank:10,offers:[{id:'upgrade:1',kind:'upgrade',price:10,effect:{flatPassive:10}},{id:'upgrade:2',kind:'upgrade',price:100,requiresOwned:['upgrade:1'],effect:{flatPassive:100}}]});
 const route=unlockRoute(input.state,'upgrade:2',input.config);assert.equal(route.eta,10);assert.equal(route.cost,110);assert.deepEqual(route.path.map(s=>s.action.id),['upgrade:1','upgrade:2']);
});
test('availability waiting is recorded before a prerequisite purchase',()=>{
 const input=makeInput({bank:10,offers:[{id:'upgrade:1',kind:'upgrade',price:1,availableAt:10,effect:{flatPassive:10}},{id:'upgrade:2',kind:'upgrade',price:1,requiresOwned:['upgrade:1'],effect:{flatPassive:100}}]});
 const route=unlockRoute(input.state,'upgrade:2',input.config);assert.equal(route.path[0].wait,10);assert.equal(route.eta,11.5);
});
const reservationState=()=>({bank:0,passive:1,commitment:{targetId:'upgrade:1',status:'saving'},offers:[
 {id:'upgrade:1',kind:'upgrade',targetId:1,price:1000,effect:{flatPassive:1}},
 {id:'upgrade:2',kind:'upgrade',targetId:2,price:900,effect:{flatPassive:100}}
]});
test('saving target switches only after three consistent material improvements',()=>{
 const state=reservationState();for(let n=1;n<=3;n++){const d=plan(makeInput(state));assert.equal(d.nextCommitment.targetId,n<3?'upgrade:1':'upgrade:2');state.commitment=d.nextCommitment;if(n===3)assert.equal(d.reservationReview.switched,true);}
});
test('affordable target and pending execution cannot be replaced',()=>{
 const state=reservationState();assert.equal(plan(makeInput({...state,bank:1000})).selectedAction.id,'upgrade:1');assert.equal(plan(makeInput({...state,pendingExecution:{cycleId:'x'}})).reasonCode,'WAIT_PENDING');
});
test('an affordable productive investment can rescue a target after clicks stop',()=>{
 const input=makeInput({bank:100,commitment:{targetId:'upgrade:1',status:'saving'},offers:[{id:'upgrade:1',kind:'upgrade',targetId:1,price:1000,effect:{flatPassive:100}},{id:'upgrade:2',kind:'upgrade',targetId:2,price:100,effect:{flatPassive:10}}]});
 const d=plan(input);assert.equal(d.targetEta.direct.status,'unreachable');assert.equal(d.selectedAction.id,'upgrade:2');assert.equal(d.reasonCode,'BUY_ADVANCES_TARGET');
});
test('cooldown blocks switching and changing challenger resets confirmation',()=>{
 const state=reservationState();state.commitment.cooldown=4;assert.equal(plan(makeInput(state)).nextCommitment.targetId,'upgrade:1');
 state.commitment={targetId:'upgrade:1',status:'saving',challengerId:'upgrade:9',challengerCount:2};const d=plan(makeInput(state));assert.equal(d.nextCommitment.challengerCount,1);assert.equal(d.nextCommitment.targetId,'upgrade:1');
});
test('a vanished improvement clears the challenger and small differences never switch',()=>{
 const state=reservationState();state.offers[1].price=1000;state.offers[1].effect.flatPassive=1.001;
 state.commitment.challengerId='upgrade:2';state.commitment.challengerCount=2;
 for(let n=0;n<5;n++){const d=plan(makeInput(state));assert.equal(d.nextCommitment.targetId,'upgrade:1');assert.equal(d.nextCommitment.challengerCount,0);state.commitment=d.nextCommitment;}
});
test('repeated identical inputs give identical reservation reviews',()=>{
 const input=makeInput(reservationState());assert.deepEqual(plan(input),plan(input));
});
test('extra search cannot defeat a root-only candidate that wins the one-step comparison',()=>{
 const state=tierState();state.offers=[state.offers[0],{id:'upgrade:9',kind:'upgrade',targetId:9,price:100,rootOnly:true,effect:{flatPassive:2}}];
 const d=plan(makeInput(state));assert.equal(d.selectedAction.id,'upgrade:9');assert.ok(d.comparison.heldBack.some(x=>x.actionId==='building:1'));
 assert.ok(d.allCandidates.find(x=>x.id==='building:1').oneStepHorizons.length===3);
});
