import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInput,DEFAULT_CONFIG } from '../src/core/contracts.mjs';
import { plan } from '../src/core/planner.mjs';
import { GameAdapter } from '../src/game/adapter.mjs';
import { mockGame } from './helpers.mjs';
import { metadataEffect,unroundedUpgradePrice,eggPriceEffects } from '../src/game/effects.mjs';
import { applyAction,allOffers } from '../src/core/model.mjs';

test('disabled or unaffordable unknowns do not mislabel economic waiting',()=>{
 for(const extra of [{disabled:true},{price:1000}]){
  const d=plan(makeInput({bank:10,offers:[{id:'upgrade:9',kind:'upgrade',targetId:9,price:1,effect:null,...extra}]}));
  assert.equal(d.reasonCode,'WAIT_NO_PROFITABLE_PLAN');
 }
});
test('affordable unmodeled candidates are named separately from disabled operations',()=>{
 const d=plan(makeInput({bank:10,offers:[{id:'upgrade:9',kind:'upgrade',targetId:9,displayName:'未対応の強化',price:1,effect:null},{id:'upgrade:10',kind:'upgrade',targetId:10,displayName:'切替',price:1,effect:null,disabled:true}]}));
 assert.equal(d.reasonCode,'WAIT_UNKNOWN_EFFECT');
 assert.deepEqual(d.coverage.unmodeledAffordable,['upgrade:9']);assert.deepEqual(d.coverage.disabled,['upgrade:10']);
});
test('unknowns do not block profitable known candidates',()=>{
 const d=plan(makeInput({bank:10,offers:[{id:'upgrade:9',kind:'upgrade',targetId:9,price:1,effect:null},{id:'upgrade:10',kind:'upgrade',targetId:10,price:10,effect:{flatPassive:10}}]}));
 assert.equal(d.selectedAction.id,'upgrade:10');
});
function cookieGame(){
 const g=mockGame();g.UpgradesById=[];g.UpgradesInStore=[];g.mouseCps=()=>1;
 const u={id:100,pool:'cookie',power:10,name:'Internal cookie',dname:'翻訳済み',unlocked:1,bought:0,basePrice:10,getPrice(){return 10;}};
 g.cookieUpgrades=[u];g.UpgradesById[u.id]=u;g.UpgradesInStore=[u];
 g.CalculateGains=()=>{g.globalCpsMult=u.bought?1.1:1;g.cookiesPs=g.ObjectsById[0].amount*.1*g.globalCpsMult;};g.CalculateGains();return g;
}
test('constant cookie power becomes a reusable measured multiplier',()=>{
 const g=cookieGame(),o=new GameAdapter(()=>g).capture(DEFAULT_CONFIG).state.offers[0];
 assert.equal(o.rootOnly,false);assert.deepEqual(o.effect,{passiveMultiplier:1.1});assert.equal(g.UpgradesById[100].bought,0);
});
test('strictly store-refresh callbacks are allowed, arbitrary callbacks stay disabled',()=>{
 const g=cookieGame(),u=g.UpgradesById[100];
 u.buyFunction=Function('Game.storeToRefresh=1;');
 assert.equal(new GameAdapter(()=>g).capture(DEFAULT_CONFIG).state.offers[0].disabled,false);
 u.buyFunction=()=>{throw new Error('must never execute');};
 assert.equal(new GameAdapter(()=>g).capture(DEFAULT_CONFIG).state.offers[0].disabled,true);
});
test('discounts can win only through cheaper productive purchases, not invented income',()=>{
 const d=plan(makeInput({bank:510,buildings:[{id:1,amount:0,unitCps:100,nextPrice:1000,unroundedNextPrice:1000,priceAtAmount:0}],offers:[{id:'upgrade:9',kind:'upgrade',targetId:9,price:10,effect:{buildingPriceMultiplier:.5}}]}));
 assert.equal(d.selectedAction.id,'upgrade:9');assert.equal(d.allCandidates.find(o=>o.id==='upgrade:9').deltaLiquidCps.value,0);
 assert.ok(d.plannedSteps.some(s=>s.action.id==='building:1' && s.action.price===500));
});
test('discount rules use engine dictionary identity across several upgrade families',()=>{
 for(const [key,expected] of [['Season savings',{buildingPriceMultiplier:.99}],['Toy workshop',{upgradePriceMultiplier:.95}],['Faberge egg',{buildingPriceMultiplier:.99,upgradePriceMultiplier:.99}]]){
  const u={id:200,name:key,dname:'別言語'};const g={Upgrades:{[key]:u}};
  assert.deepEqual(metadataEffect(g,u),expected);assert.equal(metadataEffect(g,{...u}),null);
 }
});
test('live discount metadata survives zero production gain and refresh-only handler',()=>{
 const g=cookieGame(),u=g.UpgradesById[100];g.cookieUpgrades=[];g.Upgrades={'Season savings':u};
 u.buyFunction=Function('Game.storeToRefresh=1;');g.CalculateGains=()=>{g.globalCpsMult=1;g.cookiesPs=g.ObjectsById[0].amount*.1;};g.CalculateGains();
 const o=new GameAdapter(()=>g).capture(DEFAULT_CONFIG).state.offers[0];
 assert.equal(o.disabled,false);assert.equal(o.rootOnly,false);assert.deepEqual(o.effect,{buildingPriceMultiplier:.99});assert.equal(u.bought,0);
});
test('cookie metadata is downgraded when measured gains disagree',()=>{
 const g=cookieGame();g.UpgradesById[100].power=50;
 const o=new GameAdapter(()=>g).capture(DEFAULT_CONFIG).state.offers[0];assert.equal(o.rootOnly,true);assert.ok(o.effect.flatPassive>0);
});
test('unsafe callbacks and lump prices add no hypothetical gains pass',()=>{
 for(const change of [u=>u.buyFunction=()=>{},u=>u.priceLumps=1]){
  const g=cookieGame();change(g.UpgradesById[100]);const calculate=g.CalculateGains;let count=0;g.CalculateGains=()=>{count++;calculate();};
  const o=new GameAdapter(()=>g).capture(DEFAULT_CONFIG).state.offers[0];assert.equal(o.disabled,true);assert.equal(count,2);
 }
});
test('discount calculation retains unrounded values and rejects mismatched price functions',()=>{
 const g={Has:key=>key==='Toy workshop',auraMult:()=>0,eff:()=>1};
 assert.equal(unroundedUpgradePrice(g,{basePrice:101,pool:''},96),95.94999999999999);
 assert.equal(unroundedUpgradePrice(g,{basePrice:101,pool:''},97),null);
 const input=makeInput({bank:1000,offers:[{id:'upgrade:1',kind:'upgrade',price:1,effect:{upgradePriceMultiplier:.95}},{id:'upgrade:2',kind:'upgrade',price:96,unroundedPrice:95.95,effect:{flatPassive:1}}]});
 const state=applyAction(input.state,allOffers(input.state)[0]);assert.equal(state.offers[1].price,92);
});
test('egg purchase scales common and rare prices separately after a discount',()=>{
 const a={id:1},b={id:2},g={Upgrades:{a,b},eggDrops:['a'],rareEggDrops:['b']};
 const factors=eggPriceEffects(g,b);assert.deepEqual(factors,[{id:'upgrade:1',multiplier:2},{id:'upgrade:2',multiplier:3}]);
 const input=makeInput({bank:100,offers:[{id:'upgrade:1',kind:'upgrade',price:999,unroundedPrice:999,effect:{flatPassive:1}},{id:'upgrade:2',kind:'upgrade',price:1,effect:{upgradePriceMultiplier:.99,upgradePriceFactors:factors}}]});
 const state=applyAction(input.state,allOffers(input.state).find(o=>o.id==='upgrade:2'));assert.equal(state.offers[0].price,1979);
});
test('unverified rounded upgrade prices are not extrapolated after a discount',()=>{
 const input=makeInput({bank:100,offers:[{id:'upgrade:1',kind:'upgrade',price:1,effect:{upgradePriceMultiplier:.95}},{id:'upgrade:2',kind:'upgrade',price:10,unverifiedPrice:true,effect:{flatPassive:1}}]});
 const state=applyAction(input.state,allOffers(input.state)[0]);assert.equal(allOffers(state).find(o=>o.id==='upgrade:2').eligible,false);
});
