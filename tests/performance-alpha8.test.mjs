import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInput,clone,canonical } from '../src/core/contracts.mjs';
import { plan } from '../src/core/planner.mjs';
import { plan as alpha7Plan } from '../scripts/legacy/alpha7/planner.mjs';
import { plan as alpha8Plan } from '../scripts/legacy/alpha8/planner.mjs';
import { plan as alpha9Plan } from '../scripts/legacy/alpha9/planner.mjs';
import { plan as alpha10Plan } from '../scripts/legacy/alpha10/planner.mjs';
import { plan as alpha11Plan } from '../scripts/legacy/alpha11/planner.mjs';
import { hash } from '../src/runtime/diagnostics.mjs';
import { replay } from '../scripts/replay-engine.mjs';
import { makeGolden } from '../src/core/golden.mjs';

function scenario(seed){
 let n=seed;const random=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/2**32;};
 const buildings=[0,1,2,3].map(id=>({id,amount:Math.floor(random()*5),unitCps:1+random()*20,nextPrice:Math.ceil(10+random()*100),priceAtAmount:0,growth:1.15}));
 return makeInput({bank:50+random()*500,passive:1+random()*10,clickUnit:1,clickFraction:.01,clickRate:seed%2?100:0,
  buildings,offers:[
   {id:'upgrade:gain',kind:'upgrade',price:100,effect:{passiveMultiplier:1.5}},
   {id:'upgrade:tier',kind:'upgrade',price:200,requiresBuildings:[{id:1,amount:buildings[1].amount+2}],effect:{buildingMultipliers:[{id:1,multiplier:2}]}}
  ],golden:seed%3===0?makeGolden({seed}):null,config:{depth:3,beamWidth:8,maxNodes:100}});
}

test('lightweight unlock snapshots preserve alpha7 plans across routes and GC states',()=>{
 for(let seed=1;seed<=30;seed++){
  const input=scenario(seed),before=canonical(input);
  const prior={...clone(input),engineVersion:'9.0.0-alpha.7'},current=plan(input),old=alpha7Plan(prior);
  assert.equal(canonical(current),canonical(old),'decision seed '+seed);
  assert.equal(canonical(input),before,'input seed '+seed);
 }
});

test('alpha7 diagnostics continue to replay with the archived planner',async()=>{
 const input={...clone(scenario(7)),engineVersion:'9.0.0-alpha.7'};
 const snapshot={schemaVersion:1,input,inputHash:await hash(input),decision:alpha7Plan(input)};
 assert.equal((await replay(snapshot)).matches,true);
 const corrupt=JSON.parse(JSON.stringify(snapshot));corrupt.input.state.bank++;
 await assert.rejects(()=>replay(corrupt),/InputChecksumMismatch/);
});

test('alpha8 diagnostics continue to replay after the runtime scheduler change',async()=>{
 const input={...clone(scenario(8)),engineVersion:'9.0.0-alpha.8'};
 const snapshot={schemaVersion:1,input,inputHash:await hash(input),decision:alpha8Plan(input)};
 assert.equal((await replay(snapshot)).matches,true);
});

test('alpha9 diagnostics continue to replay after click-gate hardening',async()=>{
 const input={...clone(scenario(9)),engineVersion:'9.0.0-alpha.9'};
 const snapshot={schemaVersion:1,input,inputHash:await hash(input),decision:alpha9Plan(input)};
 assert.equal((await replay(snapshot)).matches,true);
});

test('alpha10 diagnostics continue to replay after capture caching',async()=>{
 const input={...clone(scenario(10)),engineVersion:'9.0.0-alpha.10'};
 const snapshot={schemaVersion:1,input,inputHash:await hash(input),decision:alpha10Plan(input)};
 assert.equal((await replay(snapshot)).matches,true);
});

test('alpha11 diagnostics continue to replay after planner isolation',async()=>{
 const input={...clone(scenario(10)),engineVersion:'9.0.0-alpha.11'};
 const snapshot={schemaVersion:1,input,inputHash:await hash(input),decision:alpha11Plan(input)};
 assert.equal((await replay(snapshot)).matches,true);
});
