// Frame-hazard inversion; the cache only memoizes deterministic numeric tables.
const tables=new Map();
export function spawnDelay(minSeconds,maxSeconds,fps,age,u){
  const min=Math.ceil(minSeconds*fps),max=Math.ceil(maxSeconds*fps),key=min+':'+max;
  if(!(min>=0 && max>min) || max>180000 || !(fps>0) || !(u>0 && u<1))throw new Error('unsupported-golden-interval');
  let cdf=tables.get(key);
  if(!cdf){
    cdf=new Float64Array(max+1);let survival=1;
    for(let t=min+1;t<=max;t++){survival*=1-((t-min)/(max-min))**5;cdf[t]=1-survival;}
    if(tables.size>=16)tables.delete(tables.keys().next().value);tables.set(key,cdf);
  }
  const at=Math.min(max,Math.max(0,Math.floor(age*fps)));
  const threshold=cdf[at]+(1-cdf[at])*u;
  let low=at,high=max;while(low<high){const mid=(low+high)>>>1;if(cdf[mid]<threshold)low=mid+1;else high=mid;}
  return Math.max(1,low-at)/fps;
}
function random(lane,key){let n=lane[key]>>>0;n^=n<<13;n^=n>>>17;n^=n<<5;lane[key]=n>>>0;return (lane[key]+.5)/4294967296;}
export function makeGolden(options){
  const g={fps:30,min:300,max:900,futureMin:300,futureMax:900,age:0,duration:1,gain:1,actualFrenzy:0,actualClick:0,last:'',fools:false,canLumps:false,maxSeconds:3600,maxEvents:64,sampleCount:8,seed:713,...options};
  g.lanes=Array.from({length:g.sampleCount},(_,i)=>({rng:(g.seed+Math.imul(i+1,2654435761))>>>0,timeRng:(g.seed+Math.imul(i+1,2246822519))>>>0,
    next:spawnDelay(g.min,g.max,g.fps,g.age,(i+.5)/g.sampleCount),last:g.last,frenzy:g.actualFrenzy,click:g.actualClick,specials:[],extra:0,events:0,limited:false}));
  return g;
}
export function copyGolden(g){return {...g,lanes:g.lanes.map(l=>({...l,specials:l.specials.map(b=>({...b}))}))};}
export function goldenSummary(g,riskWeight=.1){
  if(!g)return {mean:0,lower:0,value:0,limited:false};
  const xs=g.lanes.map(l=>l.extra).sort((a,b)=>a-b),mean=xs.reduce((n,x)=>n+x,0)/xs.length,lower=xs[Math.floor((xs.length-1)*.1)];
  return {mean,lower,value:mean-riskWeight*Math.max(0,mean-lower),limited:g.lanes.some(l=>l.limited)};
}
function multipliers(g,l,absoluteTime){
  const f=l.frenzy>0 && absoluteTime>=g.actualFrenzy?7:1;
  const c=l.click>0 && absoluteTime>=g.actualClick?777:1;
  return {passive:f*l.specials.reduce((n,b)=>n*b.power,1),click:c};
}
function chooseEffect(s,g,l,bank,passive){
  const r=()=>random(l,'rng');let list=['frenzy','multiply cookies'];
  if(r()<.03 && s.earned>=100000)list.push('chain cookie','cookie storm');
  if(r()<.05 && g.fools)list.push('everything must go');
  if(r()<.1){r();list.push('click frenzy');}
  if(s.buildings.reduce((n,b)=>n+b.amount,0)>=10 && r()<.25)list.push('building special');
  if(g.canLumps && r()<.0005)list.push('free sugar lump');
  // Consume the aura-selection rolls, even though supported states have no GC dragon aura.
  if(r()<.15 || r()<.05){r();r();}
  if(l.last && r()<.8)list=list.filter(x=>x!==l.last);
  if(r()<.0001)list.push('blab');
  let choice=list[Math.min(list.length-1,Math.floor(r()*list.length))];l.last=choice;
  if(choice==='building special'){
    const buildings=s.buildings.filter(b=>b.amount>=10);
    if(!buildings.length)choice='frenzy';
    else{
      const b=buildings[Math.min(buildings.length-1,Math.floor(r()*buildings.length))],existing=l.specials.find(x=>x.id===b.id);
      if(existing)existing.remaining+=Math.ceil(30*g.duration);
      else l.specials.push({id:b.id,power:1+b.amount/10,remaining:Math.ceil(30*g.duration)});
    }
  }
  if(choice==='frenzy')l.frenzy+=Math.ceil(77*g.duration);
  if(choice==='click frenzy')l.click+=Math.ceil(13*g.duration);
  if(choice==='multiply cookies')l.extra+=Math.min(Math.max(0,bank)*.15,passive*900)*g.gain+13;
  // Other outcomes are retained in the lottery, but their unmodeled rewards are zero.
}
export function advanceGolden(s,seconds,rates){
  const g=s.golden;if(!g || seconds<=0)return;
  const length=Math.min(seconds,Math.max(0,g.maxSeconds-s.elapsed));
  const clickMult=s.buffs.reduce((m,b)=>m*b.click,1);
  const linked=s.clickFraction*rates.passive*clickMult*s.clickRate;
  for(const l of g.lanes){
    let time=0;
    while(time<length){
      if(l.events>=g.maxEvents){l.limited=true;break;}
      const dt=Math.min(length-time,l.next,l.frenzy>0?l.frenzy:Infinity,l.click>0?l.click:Infinity,...l.specials.map(b=>b.remaining));
      const mult=multipliers(g,l,s.elapsed+time);
      const extra=rates.passive*(mult.passive-1)+(rates.click+linked*(mult.passive-1))*mult.click-rates.click;
      l.extra+=Math.max(0,extra)*dt;time+=dt;l.next=Math.max(0,l.next-dt);
      l.frenzy=Math.max(0,l.frenzy-dt);l.click=Math.max(0,l.click-dt);
      for(const b of l.specials)b.remaining=Math.max(0,b.remaining-dt);l.specials=l.specials.filter(b=>b.remaining>0);
      if(l.next<=1e-9){
        const at=multipliers(g,l,s.elapsed+time);
        const expiredActual=s.elapsed<g.actualFrenzy && s.elapsed+time>=g.actualFrenzy;
        chooseEffect({...s,earned:s.earned+rates.liquid*time+l.extra},g,l,s.bank+rates.liquid*time+l.extra,rates.passive/(expiredActual?7:1)*at.passive);
        l.events++;l.next=spawnDelay(g.futureMin,g.futureMax,g.fps,0,random(l,'timeRng'))+.15;
      }
    }
    if(seconds>length)l.limited=true;
  }
}
