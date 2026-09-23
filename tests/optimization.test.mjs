import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInput,clone } from '../src/core/contracts.mjs';
import { plan } from '../src/core/planner.mjs';
import { applyAction,advance,allOffers,buildingPrice } from '../src/core/model.mjs';
import { plan as previousPlan } from '../scripts/legacy/alpha4/planner.mjs';
import { hash } from '../src/runtime/diagnostics.mjs';
import { replay } from '../scripts/replay-engine.mjs';
import { coverageLines } from '../src/ui/coverage.mjs';

function scenario(seed){
 let n=seed;const rand=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/2**32;};
 return makeInput({bank:Math.floor(rand()*500),passive:rand()*10,clickUnit:1,clickFraction:.01,clickRate:seed%2?100:0,
  buildings:[0,1,2].map(id=>({id,amount:Math.floor(rand()*5),unitCps:1+rand()*10,nextPrice:Math.ceil(10+rand()*500),priceAtAmount:0,growth:1.15})),
  offers:[0,1,2].map(id=>({id:'upgrade:'+id,kind:'upgrade',targetId:id,price:Math.ceil(1+rand()*300),effect:{passiveMultiplier:1+rand()},rootOnly:id===2 && seed%3===0})),
  buffs:seed%2?[{id:'x',remaining:7,passive:7,click:2}]:[],events:seed%3?[{at:31,effect:{flatPassive:100}}]:[],
  config:{horizons:[10,30,100],depth:3,beamWidth:8,maxNodes:80}});
}
test('tail-only evaluation agrees with full path replay across timed events and click rates',()=>{
 for(let seed=1;seed<=40;seed++){
  const current=scenario(seed),old={...clone(current),engineVersion:'9.0.0-alpha.4',rulesetVersion:'cc-web-2.058/basic-2'};
  const a=plan(current),b=previousPlan(old);
  assert.deepEqual(a.selectedAction,b.selectedAction,'action seed '+seed);assert.deepEqual(a.nextCommitment,b.nextCommitment);
  assert.equal(a.expandedNodes.length,b.expandedNodes.length);
  for(let j=0;j<a.expandedNodes.length;j++)for(let k=0;k<3;k++)assert.ok(Math.abs(a.expandedNodes[j].value[k]-b.expandedNodes[j].value[k])<1e-8*Math.max(1,Math.abs(b.expandedNodes[j].value[k])),'value seed '+seed);
 }
});
test('copy-on-write preserves frozen source through discounts, events and buff expiry',()=>{
 const input=makeInput({bank:1000,buildings:[{id:1,amount:1,unitCps:10,nextPrice:11,unroundedNextPrice:10.1,priceAtAmount:1}],offers:[
  {id:'upgrade:1',kind:'upgrade',price:1,effect:{buildingPriceMultiplier:.95,upgradePriceMultiplier:.95}},
  {id:'upgrade:2',kind:'upgrade',price:11,unroundedPrice:10.1,effect:{flatPassive:2}}
 ],buffs:[{remaining:1,passive:7,click:2}],events:[{at:2,effect:{flatPassive:100,buff:{remaining:3,passive:2,click:1}}}]});
 const before=JSON.stringify(input);const next=applyAction(input.state,allOffers(input.state).find(o=>o.id==='upgrade:1'));
 assert.equal(buildingPrice(next.buildings[0]),10);assert.equal(next.offers[1].price,10);
 const end=advance(next,6);assert.equal(end.passive,100);assert.deepEqual(end.buffs,[]);assert.deepEqual(end.events,[]);
 assert.equal(JSON.stringify(input),before);
});
test('alpha4 diagnostic roundtrip still uses its recorded planner',async()=>{
 const input={...clone(scenario(3)),engineVersion:'9.0.0-alpha.4',rulesetVersion:'cc-web-2.058/basic-2'};
 const snapshot={schemaVersion:1,input,inputHash:await hash(input),decision:previousPlan(input)};
 assert.equal((await replay(snapshot)).matches,true);snapshot.input.state.bank++;
 await assert.rejects(()=>replay(snapshot),/InputChecksumMismatch/);
});
test('readable UI coverage includes names and distinguishes unaffordable and disabled',()=>{
 const d=plan(makeInput({bank:10,offers:[
  {id:'upgrade:9',kind:'upgrade',price:1,effect:null,displayName:'幸運'},
  {id:'upgrade:10',kind:'upgrade',price:1,effect:null,disabled:true,displayName:'季節'},
  {id:'upgrade:11',kind:'upgrade',price:100,effect:null,displayName:'未来'}]}));
 const lines=coverageLines(d);assert.match(lines[0],/幸運.*購入可能/);assert.ok(lines.some(line=>/季節.*購入対象外/.test(line)));assert.ok(lines.some(line=>/未来.*資金待ち/.test(line)));
});
