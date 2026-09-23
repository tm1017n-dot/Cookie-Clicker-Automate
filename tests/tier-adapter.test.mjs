import test from 'node:test';
import assert from 'node:assert/strict';
import { mockGame } from './helpers.mjs';
import { GameAdapter } from '../src/game/adapter.mjs';
import { DEFAULT_CONFIG } from '../src/core/contracts.mjs';
function tierGame(){
 const g=mockGame();g.Tiers={1:{unlock:1},2:{unlock:5},3:{unlock:25},fortune:{unlock:-1,special:1}};
 const b={id:1,amount:0,bought:0,level:0,storedCps:1,storedTotalCps:0,tieredUpgrades:{},getPrice(){return Math.ceil(100*1.15**this.amount);}};g.ObjectsById.push(b);
 for(const [index,tier] of [1,2,3,'fortune'].entries()){
   const u={id:10+index,name:'tier'+tier,pool:'',unlocked:0,bought:0,tier,buildingTie:b,buildingTie1:b,getPrice:()=>100*(index+1)};
   g.UpgradesById[u.id]=u;b.tieredUpgrades[tier]=u;
 }
 g.mouseCps=()=>2**g.UpgradesById.filter(u=>u.id<3&&u.bought).length;
 g.CalculateGains=()=>{
   const cursor=g.ObjectsById[0];cursor.storedCps=.1*g.mouseCps();cursor.storedTotalCps=cursor.amount*cursor.storedCps;
   b.storedCps=2**g.UpgradesById.filter(u=>u.id>=10&&u.bought).length;b.storedTotalCps=b.amount*b.storedCps;
   g.cookiesPs=cursor.storedTotalCps+b.storedTotalCps;g.unbuffedCps=g.cookiesPs;g.computedMouseCps=g.mouseCps();
 };g.CalculateGains();return g;
}
test('next ordinary tier is captured at zero buildings without guessing special tiers',()=>{
 const g=tierGame(),input=new GameAdapter(()=>g).capture(DEFAULT_CONFIG),next=input.state.offers.find(o=>o.targetId===10);
 assert.deepEqual(next.requiresBuildings,[{id:1,amount:1}]);assert.equal(next.rootOnly,false);assert.deepEqual(next.effect,{buildingMultipliers:[{id:1,multiplier:2}]});
 assert.equal(input.state.offers.some(o=>o.targetId===11||o.targetId===13),false);
});
test('real TieredUpgrade buildingTie1 metadata remains a reusable model',()=>{
 const g=tierGame(),u=g.UpgradesById[10];g.ObjectsById[1].amount=1;u.unlocked=1;g.UpgradesInStore.push(u);g.CalculateGains();
 const input=new GameAdapter(()=>g).capture(DEFAULT_CONFIG);assert.equal(input.state.offers.find(o=>o.targetId===10).rootOnly,false);
 assert.deepEqual(input.state.offers.find(o=>o.targetId===11).requiresBuildings,[{id:1,amount:5}]);
});
test('locked future tiers add no CalculateGains pass',()=>{
 const g=tierGame(),calculate=g.CalculateGains;let count=0;g.CalculateGains=()=>{count++;calculate();};
 new GameAdapter(()=>g).capture(DEFAULT_CONFIG);assert.equal(count,7);
});
test('unshackled ordinary tiers use the audited extra multiplier',()=>{
 const g=tierGame();g.ObjectsById[1].unshackleUpgrade='building-unshackle';g.Tiers[1].unshackleUpgrade='tier-unshackle';g.Has=()=>true;
 const o=new GameAdapter(()=>g).capture(DEFAULT_CONFIG).state.offers.find(o=>o.targetId===10);assert.equal(o.effect.buildingMultipliers[0].multiplier,2.5);
});
