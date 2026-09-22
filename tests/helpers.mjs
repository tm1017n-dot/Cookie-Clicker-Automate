import { makeInput } from '../src/core/contracts.mjs';
export function opening({bank=0,cursors=0,owned=[],clickRate=20}={}) {
  const multiplier=2**owned.filter(id=>id<3).length;
  return makeInput({bank,passive:0,clickUnit:multiplier,clickRate,
    owned:owned.map(id=>'upgrade:'+id),
    buildings:[{id:0,amount:cursors,unitCps:0.1*multiplier,nextPrice:Math.ceil(15*1.15**cursors),unroundedNextPrice:15*1.15**cursors,priceAtAmount:cursors,growth:1.15},
      {id:1,amount:0,unitCps:1,nextPrice:100,priceAtAmount:0,growth:1.15}],
    offers:[0,1,2].map(id=>({id:'upgrade:'+id,kind:'upgrade',targetId:id,price:[100,500,10000][id],
      requiresBuildings:[{id:0,amount:id===2?10:1}],effect:{buildingMultipliers:[{id:0,multiplier:2}],clickMultiplier:2}}))});
}
export function mockGame() {
  const g={ready:true,version:2.058,ascensionMode:0,fps:30,cookies:0,cookiesEarned:0,cookieClicks:0,cookiesPs:0,
    globalCpsMult:1,unbuffedCps:0,computedMouseCps:1,BuildingsOwned:0,UpgradesOwned:0,
    buyMode:1,buyBulk:1,mods:{},modHooks:{},buffs:{},effs:{},AchievementsById:[],wrinklers:[],shimmers:[],
    Win(){},Unlock(){},CountsAsUpgradeOwned(){return true;},priceIncrease:1.15};
  g.ObjectsById=[{id:0,name:'Cursor',amount:1,bought:1,level:0,storedCps:0.1,storedTotalCps:0.1,basePrice:15,
    getPrice(){return Math.ceil(15*1.15**this.amount);},buy(n){if(g.cookies<this.getPrice())return false;g.cookies-=this.getPrice();this.amount+=n;this.bought+=n;g.BuildingsOwned+=n;g.CalculateGains();return true;}}];
  g.UpgradesById=[0,1,2].map(id=>({id,name:'upgrade'+id,dname:'強化'+id,pool:'',bought:0,unlocked:1,
    getPrice(){return [100,500,10000][id];},buy(){if(g.cookies<this.getPrice())return false;g.cookies-=this.getPrice();this.bought=1;g.UpgradesOwned++;g.CalculateGains();return true;}}));
  g.UpgradesInStore=[...g.UpgradesById];
  g.mouseCps=()=>2**g.UpgradesById.filter(x=>x.bought).length;
  g.CalculateGains=()=>{const b=g.ObjectsById[0];b.storedCps=.1*g.mouseCps();b.storedTotalCps=b.storedCps*b.amount;g.cookiesPs=b.storedTotalCps;g.unbuffedCps=g.cookiesPs;g.computedMouseCps=g.mouseCps();g.effs={cps:1};};
  g.ClickCookie=()=>{g.cookieClicks++;g.cookies+=g.mouseCps();g.cookiesEarned+=g.mouseCps();};
  g.CalculateGains();return g;
}
