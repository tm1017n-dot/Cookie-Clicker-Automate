import test from 'node:test';
import assert from 'node:assert/strict';
import { opening } from './helpers.mjs';
import { makeInput,clone,canonical,validateInput } from '../src/core/contracts.mjs';
import { plan } from '../src/core/planner.mjs';
import { income,advance,eta,effectDelta,allOffers,applyAction,buildingPrice } from '../src/core/model.mjs';
import { bundle,replay,Diagnostics } from '../src/runtime/diagnostics.mjs';

for(const [id,options,expected,target] of [
  ['OPEN-01',{},'wait','building:0'],
  ['OPEN-01-affordable',{bank:15},'building:0'],
  ['OPEN-02',{cursors:1},'wait','upgrade:0'],
  ['OPEN-03',{cursors:1,owned:[0]},'wait','upgrade:1'],
  ['OPEN-04',{cursors:10,owned:[0,1],bank:10000},'upgrade:2'],
  ['OPEN-26',{cursors:26,owned:[0],bank:500},'upgrade:1']
])test(id,()=>{const r=plan(opening(options));assert.equal(r.selectedAction.id,expected);if(target)assert.equal(r.nextCommitment.targetId,target);});
test('LANG-01 / MODEL-03 language and labels never change selected action',()=>{const a=clone(opening({cursors:1,owned:[0]})),b=clone(a);a.environment.language='en';b.environment.language='ja';for(const o of b.state.offers){o.displayName='日本語';o.description='2倍';}assert.deepEqual(plan(a).selectedAction,plan(b).selectedAction);});
test('opening is economic, not a mandatory Cursor sequence',()=>{
 assert.equal(plan(opening({bank:100,clickRate:0})).selectedAction.id,'building:1');
 assert.equal(plan(opening({bank:100,clickRate:100})).selectedAction.id,'building:0');
});
test('zero-income fresh save has no prescribed opening reservation',()=>{
 const result=plan(opening({bank:0,clickRate:0}));assert.equal(result.selectedAction.kind,'wait');assert.equal(result.nextCommitment,null);
});
for(const [id,n,base,price,unit,expected] of [
 ['GRAND-10',10,100,5000,1,'building'],['GRAND-11',11,100,5000,1,'upgrade'],
 ['FACT-05',5,130000,6500000,260,'building'],['FACT-11',11,130000,6500000,260,'upgrade']
])test(id,()=>{const s=makeInput({buildings:[{id:1,amount:n,unitCps:unit,nextPrice:Math.ceil(base*1.15**n),priceAtAmount:n}],offers:[{id:'upgrade:7',kind:'upgrade',price,effect:{buildingMultipliers:[{id:1,multiplier:2}]}}]}).state;const [b,u]=allOffers(s);const buildingPayback=b.price/effectDelta(s,b).liquid,upgradePayback=u.price/effectDelta(s,u).liquid;assert.equal(upgradePayback<buildingPayback?'upgrade':'building',expected);});

test('events already due apply before earnings, including zero duration',()=>{const s=makeInput({passive:1,events:[{at:0,effect:{flatPassive:9}}]}).state;assert.equal(advance(s,0).passive,10);assert.equal(advance(s,1).bank,10);assert.equal(eta(s,100),10);});
test('free buildings keep base price until paid count becomes positive',()=>{const b={amount:1,free:3,priceAtAmount:1,nextPrice:15,unroundedNextPrice:15,growth:1.15};assert.equal(buildingPrice({...b,amount:3}),15);assert.equal(buildingPrice({...b,amount:4}),18);});
test('unavailable action fails closed',()=>{assert.equal(applyAction(makeInput().state,undefined),null);});
test('GRAND-28 does not keep buying Grandmas instead of affordable tier',()=>{
 const r=plan(makeInput({bank:5000,buildings:[{id:1,amount:28,unitCps:1,nextPrice:Math.ceil(100*1.15**28),priceAtAmount:28}],offers:[{id:'upgrade:7',kind:'upgrade',targetId:7,price:5000,effect:{buildingMultipliers:[{id:1,multiplier:2}]}}]}));assert.equal(r.selectedAction.id,'upgrade:7');
});
test('ECON-01 click stopping changes every rate and ETA',()=>{const s=clone(opening({cursors:1}).state);const on=eta(s,100);s.clickRate=0;assert.ok(eta(s,100)>on);assert.equal(income(s).click,0);});
test('ECON-02 CpS mouse fraction is counted once',()=>{const s=makeInput({passive:100,clickUnit:1,clickRate:20,clickFraction:.01}).state;const d=effectDelta(s,{effect:{flatPassive:100}});assert.equal(d.liquid,120);assert.equal(d.click,20);});
test('ECON-04 deferred balance cannot buy anything',()=>{const s=makeInput({bank:0,passive:1,deferred:1e9}).state;assert.equal(eta(s,100),100);});
test('TIME-01 expires click buff before long projection',()=>{const s=makeInput({clickUnit:1,clickRate:20,buffs:[{remaining:1,passive:1,click:777}]}).state;assert.equal(advance(s,10).bank,777*20+9*20);assert.equal(eta(s,777*20+20),2);});
test('TIME-02 research applies only at boundary',()=>{const s=makeInput({passive:1,events:[{at:10,effect:{flatPassive:9}}]}).state;assert.equal(advance(s,11).bank,20);});
test('TIME-03 slow profitable investment is not permanently postponed',()=>{const r=plan(makeInput({bank:10000,passive:1,offers:[{id:'upgrade:1',kind:'upgrade',targetId:1,price:10000,effect:{flatPassive:1}}]}));assert.ok(r.horizons[2]>=20000);assert.equal(r.selectedAction.id,'upgrade:1');});
test('TIME-04 waiting earns before a late purchase',()=>{const s=makeInput({passive:10}).state;assert.equal(advance(s,60).bank,600);const r=plan(makeInput({passive:1,offers:[{id:'upgrade:1',kind:'upgrade',targetId:1,price:100,effect:{flatPassive:100}}]}));const candidate=r.allCandidates[0];assert.equal(candidate.horizons[0].objectiveValue,60);});
test('MODEL-01 unknown upgrade is retained, never assigned invented income',()=>{const r=plan(makeInput({bank:500,offers:[{id:'upgrade:1',kind:'upgrade',targetId:1,price:1,effect:null}]}));assert.equal(r.allCandidates.length,1);assert.equal(r.allCandidates[0].deltaEconomicCps.status,'unknown');assert.equal(r.selectedAction.kind,'wait');});
test('MODEL-02 unlock requires its prerequisite, child model is regenerated',()=>{const r=plan(opening({bank:15}));assert.equal(r.selectedAction.id,'building:0');assert.ok(r.expandedNodes.some(n=>n.actionId==='upgrade:0'));});
test('REPLAY-01 deterministic roundtrip and immutable input (100 runs)',async()=>{const i=opening({cursors:1,owned:[0]}),r=plan(i),b=await bundle(i,r,'test');for(let n=0;n<100;n++)assert.equal(canonical(plan(i)),canonical(r));assert.equal((await replay(JSON.parse(JSON.stringify(b)))).matches,true);});
test('REPLAY-02 unknown version and corrupt checksum rejected',async()=>{const i=opening(),b=await bundle(i,plan(i),'x');b.input.schemaVersion=2;await assert.rejects(()=>replay(b));const wrong=clone(i);wrong.rulesetVersion='future';assert.throws(()=>validateInput(wrong),/VersionMismatch/);});
test('REPLAY-03 deterministic budget and unknown child boundary',()=>{const i=clone(opening({bank:10000}));i.config.maxNodes=2;const r=plan(i);assert.ok(r.expandedNodes.length<=2);assert.ok(r.warnings.includes('node-budget'));});
test('LOG-01 export copies recorded data without recomputing',async()=>{const d=new Diagnostics({limit:2});await d.open();await d.save({cycleId:'1',value:1});const out=await d.exportAll();out[0].value=99;assert.equal(d.latest().value,1);});
test('strict JSON rejects NaN, undefined and duplicate IDs',()=>{assert.throws(()=>makeInput({bank:NaN}));assert.throws(()=>makeInput({offers:[{id:'x',price:1},{id:'x',price:1}]}));});
