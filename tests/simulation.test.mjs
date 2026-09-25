import test from 'node:test';
import assert from 'node:assert/strict';
import {simulate,scenarios} from '../scripts/simulate-strategies.mjs';
test('simulation repeatability excludes machine timings and preserves scenario input',()=>{
 const scenario=scenarios()[0],before=JSON.stringify(scenario);
 const a=simulate(scenario,'current',60),b=simulate(scenario,'current',60);
 delete a.plannerMs;delete b.plannerMs;assert.deepEqual(a,b);assert.equal(JSON.stringify(scenario),before);
 for(let n=1;n<a.purchases.length;n++)assert.ok(a.purchases[n].at-a.purchases[n-1].at>=1.5);
});
test('simulation conserves bank plus spending against initial funds and income',()=>{
 for(const policy of ['current','fixed-horizon','no-reservation','greedy','growth-weights']){
  const scenario=scenarios()[2],r=simulate(scenario,policy,60);
  const spent=r.purchases.reduce((total,p)=>total+p.price,0);
  assert.ok(Math.abs(r.bank+spent-scenario.state.bank-r.earned)<1e-6);
  assert.ok(r.purchases.every(p=>p.at<60));
 }
});
