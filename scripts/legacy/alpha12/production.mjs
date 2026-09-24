export function achievementCount(s){
  const p=s.production;if(!p)return 0;
  return p.achievements+p.milestones.filter(m=>(s.buildings.find(b=>b.id===m.buildingId)?.amount??0)>=m.amount).length;
}
export function synergyFactors(buildings,synergies){
  const amounts=new Map(buildings.map(b=>[b.id,b.amount])),out=new Map(buildings.map(b=>[b.id,1]));
  for(const r of synergies){
    out.set(r.a,(out.get(r.a)??1)*(1+r.ka*(amounts.get(r.b)??0)));
    out.set(r.b,(out.get(r.b)??1)*(1+r.kb*(amounts.get(r.a)??0)));
  }
  return out;
}
export function productionValue(s){
  const p=s.production;if(!p)return Math.max(0,s.passive+s.buildings.reduce((n,b)=>n+b.amount*b.unitCps,0));
  const milk=achievementCount(s)/25*p.milkMultiplier;
  const kitten=p.kittenPowers.reduce((m,power)=>m*(1+milk*power),1)/(p.baseKitten||1);
  const factors=synergyFactors(s.buildings,p.synergies);
  const nonCursor=s.buildings.reduce((n,b)=>n+(b.id===0?0:b.amount),0);
  let raw=s.passive;
  for(const b of s.buildings){
    let unit=b.unitCps;
    if(b.id===0)unit+=(p.cursorCoefficient??0)*(nonCursor-(p.baseNonCursor??nonCursor));
    unit*=(factors.get(b.id)??1)/(b.baseSynergy??1);
    if(b.id===1 && p.milkGrandma)unit*=(1+milk*p.milkGrandma)/(1+p.achievements/25*p.milkMultiplier*p.milkGrandma);
    raw+=b.amount*unit;
  }
  return Math.max(0,raw*kitten);
}
