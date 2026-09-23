// Audited against Web 2.058. Keys are engine dictionary keys, never translated labels.
const priceRules=[
  ['Season savings',{buildingPriceMultiplier:.99}],
  ['Toy workshop',{upgradePriceMultiplier:.95}],
  ["Santa's dominion",{passiveMultiplier:1.2,buildingPriceMultiplier:.99,upgradePriceMultiplier:.98}],
  ['Faberge egg',{buildingPriceMultiplier:.99,upgradePriceMultiplier:.99}],
  ['Fortune #100',{passiveMultiplier:1.01,buildingPriceMultiplier:.99,upgradePriceMultiplier:.99}],
  ['Wrinkler ambergris',{passiveMultiplier:1.06,upgradePriceMultiplier:.99}]
];
export function refreshOnly(callback){
  if(!callback)return true;
  const source=Function.prototype.toString.call(callback).replace(/\s+/g,'');
  return /^(?:function\w*\(\)|\(\)=>)\{(?:Game\.(?:storeToRefresh|upgradesToRebuild)=1;?)+\}$/.test(source);
}
export function metadataEffect(g,u){
  for(const [key,effect] of priceRules)if(g.Upgrades?.[key]===u)return {...effect};
  if((g.cookieUpgrades??[]).includes(u) && Number.isFinite(u.power) && u.power>=0)return {passiveMultiplier:1+u.power*.01};
  return null;
}
export function eggPriceEffects(g,u){
  if(!(g.eggDrops??[]).some(key=>g.Upgrades?.[key]===u) && !(g.rareEggDrops??[]).some(key=>g.Upgrades?.[key]===u))return [];
  return [...(g.eggDrops??[]).map(key=>({id:'upgrade:'+g.Upgrades[key].id,multiplier:2})),
    ...(g.rareEggDrops??[]).map(key=>({id:'upgrade:'+g.Upgrades[key].id,multiplier:3}))];
}
// Preserve pre-ceiling prices so two successive discounts do not compound rounding error.
// Verification against getPrice is mandatory before the result is used.
export function unroundedUpgradePrice(g,u,actual){
  if(typeof g.Has!=='function' || typeof g.auraMult!=='function' || typeof g.eff!=='function')return null;
  let price=u.priceFunc?u.priceFunc(u):u.basePrice;
  if(!Number.isFinite(price) || price<0)return null;
  if(u.pool!=='prestige'){
    if(g.Has('Toy workshop'))price*=.95;
    if(g.Has('Five-finger discount'))price*=.99**((g.ObjectsById[0]?.amount??0)/100);
    const factors=[["Santa's dominion",.98],['Faberge egg',.99],['Divine sales',.99],['Fortune #100',.99],['Wrinkler ambergris',.99]];
    for(const [key,mult] of factors)if(g.Has(key))price*=mult;
    if(u.kitten && g.Has('Kitten wages'))price*=.9;
    if(g.hasBuff?.("Haggler's luck"))price*=.98;
    if(g.hasBuff?.("Haggler's misery"))price*=1.02;
    price*=1-g.auraMult('Master of the Armory')*.02;
    price*=g.eff('upgradeCost');
    if(u.pool==='cookie' && g.Has('Divine bakeries'))price/=5;
  }
  return Math.ceil(price)===actual?price:null;
}
