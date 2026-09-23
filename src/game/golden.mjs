import { makeGolden } from '../core/golden.mjs';
const has=(g,key)=>!!g.Has?.(key);
export function captureGolden(g,config){
  const type=g.shimmerTypes?.golden;
  if(!config.collectGolden)return {model:null,reason:'collection-disabled'};
  if(!type?.getMinTime || !type?.getMaxTime)return {model:null,reason:'timer-unavailable'};
  if(has(g,'Golden switch [off]'))return {model:null,reason:'golden-switch'};
  if(g.elderWrath || g.hasGod?.('scorn') || g.hasGod?.('asceticism'))return {model:null,reason:'wrath-or-conflicting-god'};
  if(type.chain || (g.shimmers??[]).some(s=>s.type==='golden'))return {model:null,reason:'active-shimmer-or-chain'};
  if((g.auraMult?.('Dragonflight')??0)>0 || (g.auraMult?.('Reaper of Fields')??0)>0 || has(g,'Distilled essence of redoubled luck'))return {model:null,reason:'special-golden-distribution'};
  if(Object.values(g.buffs??{}).some(b=>!['Frenzy','Click frenzy'].includes(b.name)))return {model:null,reason:'special-active-buff'};
  const fps=g.fps,min=type.minTime/fps,max=type.maxTime/fps;
  if(!(min>=0 && max>min && max*fps<=180000))return {model:null,reason:'timer-uninitialized'};
  let duration=has(g,'Get lucky')?2:1;
  for(const [key,m] of [['Lasting fortune',1.1],['Lucky digit',1.01],['Lucky number',1.01],['Green yeast digestives',1.01],['Lucky payout',1.01]])if(has(g,key))duration*=m;
  duration*=1+(g.auraMult?.('Epoch Manipulator')??0)*.05;
  duration*=g.eff?.('goldenCookieEffDur')??1;
  duration*=([1,1.07,1.05,1.02][g.hasGod?.('decadence')||0]??1);
  let gain=(1+(g.auraMult?.('Ancestral Metamorphosis')??0)*.1)*(g.eff?.('goldenCookieGain')??1);
  if(has(g,'Green yeast digestives'))gain*=1.01;if(has(g,'Dragon fang'))gain*=1.03;
  const model=makeGolden({fps,min,max,futureMin:type.getMinTime({wrath:0})/fps,futureMax:type.getMaxTime({wrath:0})/fps,age:type.time/fps,
    duration,gain,actualFrenzy:(g.buffs?.Frenzy?.time??0)/fps,actualClick:(g.buffs?.['Click frenzy']?.time??0)/fps,
    last:type.last??'',fools:g.season==='fools',canLumps:!!g.canLumps?.(),seed:config.goldenSeed??713,sampleCount:config.goldenSamples??8});
  return {model,reason:null};
}
export function goldenUpgradeEffect(g,u,model){
  if(!model)return null;
  for(const key of ['Lucky day','Serendipity'])if(g.Upgrades?.[key]===u)return {golden:{frequency:.5}};
  if(g.Upgrades?.['Get lucky']===u)return {golden:{duration:2}};
  if(g.Upgrades?.['Golden goose egg']===u)return {golden:{frequency:.95}};
  return null;
}
