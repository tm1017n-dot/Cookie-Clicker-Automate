import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGolden,spawnDelay,goldenSummary } from '../src/core/golden.mjs';
import { makeInput,clone,canonical } from '../src/core/contracts.mjs';
import { advance,income,eta,applyAction,allOffers } from '../src/core/model.mjs';
import { plan } from '../src/core/planner.mjs';
import { captureGolden } from '../src/game/golden.mjs';
const golden=options=>makeGolden({min:30,max:90,futureMin:30,futureMax:90,...options});
test('splitting forecast advancement preserves reward, lottery and input',()=>{
 const s=makeInput({bank:1000,passive:10,clickUnit:1,clickRate:100,golden:golden({})}).state,before=canonical(s);
 const once=advance(s,900),split=advance(advance(s,137),763);
 assert.equal(canonical(s),before);
 for(let i=0;i<once.golden.lanes.length;i++){
  const a=once.golden.lanes[i],b=split.golden.lanes[i];assert.equal(a.rng,b.rng);assert.equal(a.events,b.events);assert.ok(Math.abs(a.extra-b.extra)<1e-6);
 }
});
test('spawn quantiles invert the frame hazard, including elapsed waiting',()=>{
 for(const age of [0,12,17])for(const u of [.1,.5,.9]){
  const fps=10,min=100,max=200,at=age*fps;let survive=1;
  for(let t=at+1;t<=max;t++){survive*=1-Math.max(0,(t-min)/(max-min))**5;if(1-survive>=u){assert.equal(spawnDelay(10,20,fps,age,u),(t-at)/fps);break;}}
 }
});
test('forecast reward never funds a purchase or shortens guaranteed ETA',()=>{
 const input=makeInput({passive:10,clickUnit:1,clickRate:100,golden:golden({})});
 const result=advance(input.state,900);assert.ok(goldenSummary(result.golden).mean>0);assert.equal(result.bank,99000);assert.equal(eta(input.state,1100),10);
 assert.equal(applyAction({...result,bank:0},{id:'x',kind:'upgrade',price:1,eligible:true,effect:{flatPassive:1}}),null);
});
test('no natural GC income is predicted before the earliest possible arrival',()=>{
 const s=makeInput({passive:10,golden:golden({min:300,max:900,futureMin:300,futureMax:900})}).state;
 assert.equal(goldenSummary(advance(s,60).golden).mean,0);
});
test('forecast Frenzy and Click frenzy compound the CpS-linked click component once',()=>{
 const g=golden({sampleCount:1});Object.assign(g.lanes[0],{next:999,frenzy:10,click:3});
 const s=makeInput({passive:10,clickUnit:2,clickFraction:.1,clickRate:100,golden:g}).state;
 const out=advance(s,10);assert.equal(goldenSummary(out.golden).mean,699060*3+660*7);assert.equal(out.bank,3100);
});
test('already active Frenzy is not counted twice and expires correctly',()=>{
 const s=makeInput({passive:10,buffs:[{remaining:10,passive:7,click:1}],golden:golden({actualFrenzy:10})}).state;
 const out=advance(s,15);assert.equal(out.bank,750);assert.equal(goldenSummary(out.golden).mean,0);
});
test('Lucky caps at passive production, independent of click income',()=>{
 for(const bank of [100,1e9]){
  let found=false;
  for(let seed=1;seed<100 && !found;seed++){
   const g=golden({sampleCount:1,seed});g.lanes[0].next=0;
   const s=makeInput({bank,passive:10,clickUnit:1e6,clickRate:100,golden:g}).state,out=advance(s,.001);
   if(out.golden.lanes[0].last==='multiply cookies'){assert.equal(out.golden.lanes[0].extra,Math.min(bank*.15,9000)+13);found=true;}
  }assert.equal(found,true);
 }
});
test('frequency upgrades affect future intervals, not the pending spawn',()=>{
 const input=makeInput({bank:100,passive:10,golden:golden({}),offers:[{id:'upgrade:52',kind:'upgrade',targetId:52,price:1,effect:{golden:{frequency:.5}}}]});
 const after=applyAction(input.state,allOffers(input.state)[0]);
 assert.deepEqual(after.golden.lanes.map(l=>l.next),input.state.golden.lanes.map(l=>l.next));assert.equal(after.golden.futureMin,15);
 assert.ok(goldenSummary(advance(after,900).golden).mean>goldenSummary(advance(input.state,900).golden).mean);
});
test('duration upgrade does not extend an already active buff',()=>{
 const s=makeInput({bank:1,golden:golden({actualFrenzy:10}),offers:[{id:'x',kind:'upgrade',price:1,effect:{golden:{duration:2}}}]}).state;
 const a=applyAction(s,allOffers(s)[0]);assert.equal(a.golden.duration,2);assert.equal(a.golden.lanes[0].frenzy,10);
});
test('forecast limits do not stop deterministic production and expose truncation',()=>{
 const s=makeInput({passive:1,golden:golden({maxSeconds:100,maxEvents:2})}).state;
 const end=advance(s,7200);assert.equal(end.bank,7200);assert.equal(goldenSummary(end.golden).limited,true);assert.equal(eta(s,7200),7200);
});
test('sampled decision and input stay deterministic through repeated planning',()=>{
 const input=makeInput({bank:100,passive:100,clickUnit:1,clickRate:100,golden:golden({}),offers:[{id:'upgrade:52',kind:'upgrade',targetId:52,price:100,effect:{golden:{frequency:.5}}}]});
 const before=canonical(input),decision=plan(input);assert.equal(decision.selectedAction.id,'upgrade:52');
 for(let n=0;n<3;n++)assert.deepEqual(plan(input),decision);assert.equal(canonical(input),before);
});
test('unsupported GC conditions disable prediction with a specific reason',()=>{
 const base={fps:30,Has:()=>false,shimmerTypes:{golden:{minTime:9000,maxTime:27000,time:0,getMinTime:()=>9000,getMaxTime:()=>27000}},buffs:{}};
 assert.equal(captureGolden(base,{collectGolden:false}).reason,'collection-disabled');
 assert.equal(captureGolden({...base,elderWrath:1},{collectGolden:true}).reason,'wrath-or-conflicting-god');
 assert.ok(captureGolden(base,{collectGolden:true}).model);
});
