import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAdapter } from '../src/game/adapter.mjs';
import { DEFAULT_CONFIG,makeInput } from '../src/core/contracts.mjs';
import { income,applyAction,allOffers } from '../src/core/model.mjs';
import { strategyMetadata } from '../src/game/strategy.mjs';
import { mockGame } from './helpers.mjs';
function game(){
 const g=mockGame();g.UpgradesById=[];g.Upgrades={};g.cookieUpgrades=[];g.AchievementsOwned=25;g.Achievements={};g.GrandmaSynergies=[];
 g.ObjectsById=[0,1,2].map(id=>({id,amount:[1,10,5][id],bought:[1,10,5][id],level:0,basePrice:10**id,storedCps:[.1,1,10][id],synergies:[],tieredAchievs:{},getPrice(){return Math.ceil(this.basePrice*1.15**this.amount);}}));
 g.Has=key=>!!g.Upgrades[key]?.bought;g.auraMult=()=>0;g.eff=()=>1;
 const [cursor,a,b]=g.ObjectsById;
 const synergy={id:100,name:'Synergy',bought:0,unlocked:1,pool:'',buildingTie1:a,buildingTie2:b,tier:'synergy1',basePrice:100,getPrice(){return this.basePrice;}};
 a.synergies=[synergy];b.synergies=[synergy];g.Tiers={synergy1:{unlock:15,req:'volume'},1:{achievUnlock:11}};
 const kitten={id:101,name:'Kitten helpers',bought:0,unlocked:1,pool:'',kitten:1,basePrice:100,getPrice(){return this.basePrice;}};
 g.UpgradesById[100]=synergy;g.UpgradesById[101]=kitten;g.Upgrades.Synergy=synergy;g.Upgrades['Kitten helpers']=kitten;g.UpgradesInStore=[synergy,kitten];
 g.CalculateGains=()=>{g.globalCpsMult=kitten.bought?1+g.AchievementsOwned/25*.1:1;cursor.storedCps=.1;a.storedCps=1*(synergy.bought?1+.05*b.amount:1);b.storedCps=10*(synergy.bought?1+.001*a.amount:1);g.cookiesPs=g.ObjectsById.reduce((n,b)=>n+b.amount*b.storedCps,0)*g.globalCpsMult;};
 g.mouseCps=()=>1+g.cookiesPs*.01;g.cookies=1e9;g.CalculateGains();return g;
}
test('adapter captures reusable Synergy and Kitten and agrees after a sequence of purchases',()=>{
 const g=game(),adapter=new GameAdapter(()=>g);let s=adapter.capture(DEFAULT_CONFIG,null,100).state;
 for(const id of ['upgrade:100','upgrade:101','building:1','building:2']){
  const o=allOffers(s).find(o=>o.id===id);assert.equal(o.rootOnly,false);s=applyAction(s,o);
  if(o.kind==='building')g.ObjectsById[o.targetId].amount++;else g.UpgradesById[o.targetId].bought=1;
  g.CalculateGains();assert.ok(Math.abs(income(s).liquid-(g.cookiesPs+g.mouseCps()*100))<1e-7);
 }
});
test('owned synergy is normalized at capture, not applied twice',()=>{
 const g=game();g.UpgradesById[100].bought=1;g.CalculateGains();
 const s=new GameAdapter(()=>g).capture(DEFAULT_CONFIG,null,100).state;assert.ok(Math.abs(income(s).passive-g.cookiesPs)<1e-8);
 assert.equal(s.buildings[1].rootOnly,false);assert.equal(s.buildings[2].rootOnly,false);
});
test('facility achievements update planning without mutating live achievements',()=>{
 const g=game();g.UpgradesById[101].bought=1;g.ObjectsById[1].tieredAchievs={1:{id:9,tier:1,won:0,pool:''}};g.CalculateGains();
 const s=new GameAdapter(()=>g).capture(DEFAULT_CONFIG,null,100).state,next=applyAction(s,allOffers(s).find(o=>o.id==='building:1'));
 assert.equal(s.production.milestones.length,1);assert.ok(income(next).passive>income(s).passive+g.ObjectsById[1].storedCps*g.globalCpsMult);assert.equal(g.AchievementsOwned,25);
});
test('research callback is permitted only for the audited next step and stopped before One mind',()=>{
 const g=game();const names=['Bingo center/Research facility','Specialized chocolate chips','Designer cocoa beans','Ritual rolling pins','Underworld ovens','One mind'];
 names.forEach((name,i)=>{const u={id:200+i,name,bought:0,unlocked:i===0?1:0,pool:i?'tech':'',getPrice:()=>100};g.Upgrades[name]=u;g.UpgradesById[u.id]=u;});
 g.Upgrades[names[0]].buyFunction=function(){Game.SetResearch('Specialized chocolate chips');};
 g.baseResearchTime=1800*30;g.HasAchiev=()=>true;g.nextResearch=201;g.researchT=90;
 const extra=strategyMetadata(g,g.ObjectsById.map(b=>({...b}))).extras;
 assert.equal(extra.get(200).callbackAllowed,true);assert.equal(extra.get(201).availableAt,3);assert.equal(extra.has(205),false);
 g.Upgrades[names[0]].buyFunction=function(){Game.Reset();};assert.equal(strategyMetadata(g,g.ObjectsById.map(b=>({...b}))).extras.get(200).callbackAllowed,false);
});
