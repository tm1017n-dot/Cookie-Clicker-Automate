import { synergyFactors } from '../core/production.mjs';

const cats=[['Kitten helpers',.1,13],['Kitten workers',.125,25],['Kitten engineers',.15,50],['Kitten overseers',.175,75],['Kitten managers',.2,100],['Kitten accountants',.2,125],['Kitten specialists',.2,150],['Kitten experts',.2,175],['Kitten consultants',.2,200],['Kitten assistants to the regional manager',.175,225],['Kitten marketeers',.15,250],['Kitten analysts',.125,275],['Kitten executives',.115,300],['Kitten admins',.11,325],['Kitten strategists',.105,350],['Kitten angels',.1,null],['Fortune #103',.05,null]];
const research=[['Bingo center/Research facility',{buildingMultipliers:[{id:1,multiplier:4}]}],['Specialized chocolate chips',{passiveMultiplier:1.01}],['Designer cocoa beans',{passiveMultiplier:1.02}],['Ritual rolling pins',{buildingMultipliers:[{id:1,multiplier:2}]}],['Underworld ovens',{passiveMultiplier:1.03}]];
const has=(g,key)=>!!g.Upgrades?.[key]?.bought;
const sameCallback=(callback,body)=>typeof callback==='function' && Function.prototype.toString.call(callback).replace(/\s+/g,'')==='function(){'+body.replace(/\s+/g,'')+'}';
export function strategyMetadata(g,buildings){
  const extras=new Map(),synergies=[],milestones=[],kittenPowers=[];
  const all=Object.values(g.UpgradesById??{}).filter(Boolean);
  const ordinaryCats=cats.map(([key,power,unlock])=>({u:g.Upgrades?.[key],power,unlock})).filter(x=>x.u);
  const futureCats=new Set(ordinaryCats.filter(x=>x.unlock && !x.u.bought && !x.u.unlocked).slice(0,3).map(x=>x.u));
  for(const {u,power,unlock} of ordinaryCats){
    if(u.bought)kittenPowers.push(power);
    const effect={kittenPower:power};
    if(has(g,'Cat ladies') && g.UpgradesByPool?.kitten?.includes(u))effect.buildingMultipliers=[{id:1,multiplier:1.29}];
    extras.set(u.id,{effect,future:futureCats.has(u),requiresAchievements:unlock??0,source:'kitten-milk-formula'});
  }
  for(const u of all){
    const a=u.buildingTie1,b=u.buildingTie2,t=g.Tiers?.[u.tier];
    if(a && b && a.synergies?.includes(u) && b.synergies?.includes(u)){
      const r={a:a.id,b:b.id,ka:.05,kb:.001};if(u.bought)synergies.push(r);
      const future=!!t && Number.isInteger(t.unlock) && t.unlock>0 && !!g.Has?.(t.req);
      extras.set(u.id,{effect:{synergies:[r]},future,requiresBuildings:future?[{id:a.id,amount:t.unlock},{id:b.id,amount:t.unlock}]:[],source:'building.synergies'});
    }
  }
  for(const b of Object.values(g.ObjectsById??{})){
    if(!b)continue;
    const u=b.grandma;
    if(u && b.id>1 && (g.GrandmaSynergies??[]).includes(u.name)){
      const r={a:b.id,b:1,ka:.01/(b.id-1),kb:0};if(u.bought)synergies.push(r);
      extras.set(u.id,{effect:{synergies:[r],buildingMultipliers:[{id:1,multiplier:2}]},future:false,
        callbackAllowed:sameCallback(u.buyFunction,"Game.Objects['Grandma'].redraw();"),source:'GrandmaSynergies'});
    }
    for(const a of Object.values(b.tieredAchievs??{})){
      const threshold=g.Tiers?.[a.tier]?.achievUnlock;
      if(!a.won && (a.pool==='' || a.pool==='normal' || a.pool==null) && Number.isInteger(threshold) && threshold>b.amount)milestones.push({id:a.id,buildingId:b.id,amount:threshold});
    }
  }
  let milkMultiplier=(has(g,"Santa's milk and cookies")?1.05:1)*(1+(g.auraMult?.('Breath of Milk')??0)*.05)*(g.eff?.('milk')??1);
  milkMultiplier*=[1,1.1,1.05,1.03][g.hasGod?.('mother')||0]??1;
  const achievements=g.AchievementsOwned??0;
  const production={synergies,kittenPowers,achievements,milkMultiplier,milestones:[...new Map(milestones.map(m=>[m.id,m])).values()],
    baseKitten:kittenPowers.reduce((n,p)=>n*(1+achievements/25*milkMultiplier*p),1),milkGrandma:has(g,'Milkhelp&reg; lactose intolerance relief tablets')?.05:0};
  const baseFactors=synergyFactors(buildings,synergies);
  for(const b of buildings)b.baseSynergy=baseFactors.get(b.id)??1;
  let finger=has(g,'Thousand fingers')?.1:0;
  for(const [key,m] of [['Million fingers',5],['Billion fingers',10],['Trillion fingers',20],['Quadrillion fingers',20],['Quintillion fingers',20],['Sextillion fingers',20],['Septillion fingers',20],['Octillion fingers',20],['Nonillion fingers',20],['Decillion fingers',20],['Undecillion fingers',20],['Unshackled cursors',25]])if(has(g,key))finger*=m;
  production.baseNonCursor=buildings.reduce((n,b)=>n+(b.id?b.amount:0),0);
  const clickBase=.1*2**['Reinforced index finger','Carpal tunnel prevention cream','Ambidextrous'].filter(key=>has(g,key)).length;
  production.cursorCoefficient=finger*(buildings.find(b=>b.id===0)?.unitCps??0)/(clickBase+finger*production.baseNonCursor);
  const bingo=g.Upgrades?.[research[0][0]],canResearch=!!bingo && (bingo.bought || bingo.unlocked || g.HasAchiev?.('Elder'));
  const frames=g.Has?.('Ultrascience')?g.fps*5:g.Has?.('Persistent memory')?Math.ceil((g.baseResearchTime??g.fps*1800)/10):(g.baseResearchTime??g.fps*1800);
  for(let i=0;i<research.length;i++){
    const [key,base]=research[i],u=g.Upgrades?.[key];if(!u)continue;
    if(i && !g.Upgrades?.[research[i-1][0]])continue;
    const nextKey=research[i+1]?.[0]??'One mind',next=g.Upgrades?.[nextKey];
    const effect={...base};if(next && i+1<research.length)effect.startResearch={targetId:'upgrade:'+next.id,seconds:frames/g.fps};
    extras.set(u.id,{effect,future:canResearch,callbackAllowed:sameCallback(u.buyFunction,"Game.SetResearch('"+nextKey+"');"),source:'research-chain-before-wrath',
      ...(i?{requiresOwned:['upgrade:'+g.Upgrades[research[i-1][0]].id],research:true,researchReady:!!u.unlocked || (g.nextResearch===u.id && g.researchT>0),
        availableAt:!u.unlocked && g.nextResearch===u.id && g.researchT>0?g.researchT/g.fps:0}:{requiresBuildings:[{id:1,amount:6}]})});
  }
  return {production,extras};
}
