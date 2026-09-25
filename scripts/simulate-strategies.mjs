import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {makeInput,ENGINE_VERSION} from '../src/core/contracts.mjs';
import {plan} from '../src/core/planner.mjs';
import {advance,applyAction,allOffers,offerById,income,eta,effectDelta} from '../src/core/model.mjs';

// Experimental policy only: do not modify the distributed planner.
let source=readFileSync(new URL('../src/core/planner.mjs',import.meta.url),'utf8');
source=source.replace(/from '\.\/(.*?)'/g,(_,name)=>`from '${new URL('../src/core/'+name,import.meta.url).href}'`);
const horizonRule='horizons[1] = Math.max(horizons[1], horizons[2]/3);';
if(!source.includes(horizonRule))throw new Error('Planner changed: review the experimental horizon override');
source=source.replace(horizonRule,'horizons.splice(0,3,...c.horizons);');
const fixedPlan=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).plan;
function greedy(input){
 const s=input.state;
 const ranked=allOffers(s).filter(o=>o.eligible&&o.effect).map(o=>({o,delta:effectDelta(s,o).economic,wait:eta(s,o.price)})).filter(x=>x.delta>0&&Number.isFinite(x.wait)).sort((a,b)=>(a.wait+a.o.price/a.delta)-(b.wait+b.o.price/b.delta)||a.o.id.localeCompare(b.o.id));
 const x=ranked[0];return {selectedAction:x&&x.wait===0?x.o:{id:'wait',kind:'wait'},nextCommitment:null,horizons:[],reasonCode:'wait-plus-payback'};
}
const building=(id,amount,unitCps,price)=>({id,amount,unitCps,nextPrice:price,unroundedNextPrice:price,priceAtAmount:amount,growth:1.15});
export function scenarios(){
 const out=[];
 out.push({name:'opening-100click',state:{clickUnit:1,clickRate:100,buildings:[building(0,0,.1,15),building(1,0,1,100),building(2,0,8,1100)],offers:[0,1,2].map(id=>({id:'upgrade:'+id,kind:'upgrade',targetId:id,price:[100,500,10000][id],requiresBuildings:[{id:0,amount:id===2?10:1}],effect:{buildingMultipliers:[{id:0,multiplier:2}],clickMultiplier:2}}))}});
 out.push({name:'remote-tier',state:{bank:500,passive:10,buildings:[building(1,0,1,100),building(2,0,40,1000)],offers:[{id:'upgrade:far',kind:'upgrade',targetId:1,price:10000,requiresBuildings:[{id:1,amount:60}],effect:{buildingMultipliers:[{id:1,multiplier:2}]}},{id:'upgrade:income',kind:'upgrade',targetId:2,price:500,effect:{flatPassive:50}}]}});
 out.push({name:'investment-order',state:{bank:100,passive:10,buildings:[building(1,0,10,100),building(2,0,100,1000)],offers:[{id:'upgrade:boost',kind:'upgrade',targetId:1,price:1000,effect:{buildingMultipliers:[{id:1,multiplier:3}]}},{id:'upgrade:discount',kind:'upgrade',targetId:2,price:2000,effect:{buildingPriceMultiplier:.5}},{id:'upgrade:goal',kind:'upgrade',targetId:3,price:5000,requiresBuildings:[{id:1,amount:25}],effect:{buildingMultipliers:[{id:1,multiplier:5}]}}]}});
 for(let seed=1;seed<=8;seed++){
  let v=seed;const random=()=>{v=(Math.imul(v,1664525)+1013904223)>>>0;return v/2**32;};
  const buildings=[1,2,3].map(id=>building(id,Math.floor(random()*5),[1,10,100][id-1],Math.ceil([40,400,4000][id-1]*(.5+random()))));
  const offers=buildings.flatMap(b=>[1,2].map(t=>({id:`tier:${b.id}:${t}`,kind:'upgrade',targetId:b.id*10+t,price:Math.ceil(b.nextPrice*(t===1?5:40)),requiresBuildings:[{id:b.id,amount:b.amount+(t===1?5:25)}],effect:{buildingMultipliers:[{id:b.id,multiplier:2}]}})));
  offers.push({id:'upgrade:global',kind:'upgrade',targetId:100,price:1000+Math.floor(random()*4000),effect:{passiveMultiplier:1.2}},{id:'upgrade:discount',kind:'upgrade',targetId:101,price:1000+Math.floor(random()*4000),effect:{buildingPriceMultiplier:.8,upgradePriceMultiplier:.9}});
  out.push({name:'seed-'+seed,state:{bank:Math.floor(random()*1000),passive:10,clickUnit:1,clickRate:seed%2?100:0,buildings,offers,buffs:seed%3===0?[{remaining:30,passive:7,click:1}]:[]}});
 }
 return out;
}
export function simulate(scenario,policy,seconds=900){
 let state=structuredClone(makeInput(scenario.state).state);const purchases=[],snapshots=[],times=[],targets={earned:{},cps:{}};let horizonMax=0,waits=0,switches=0,previous=null;
 for(let tick=0;tick<seconds/1.5;tick++){
  const input=makeInput({...state,commitment:policy==='no-reservation'?null:state.commitment,config:policy==='growth-weights'?{weights:[.05,.15,.8]}:{}});
  const start=performance.now();let decision=policy==='greedy'?greedy(input):policy==='fixed-horizon'?fixedPlan(input):plan(input);times.push(performance.now()-start);
  // Counterfactual sequence probe for investment-order only; never a production rule.
  const prefix=policy.match(/^prefix-facilities-(\d+)$/);
  if(prefix&&(state.buildings.find(b=>b.id===1)?.amount??Infinity)<Number(prefix[1])){
   const offer=offerById(state,'building:1');decision={selectedAction:eta(state,offer.price)===0?offer:{id:'wait',kind:'wait'},nextCommitment:null,horizons:[],reasonCode:'counterfactual-prefix'};
  }
  horizonMax=Math.max(horizonMax,decision.horizons?.[2]??0);
  state.commitment=policy==='no-reservation'?null:decision.nextCommitment;
  const next=state.commitment?.targetId??null;if(next&&previous&&next!==previous)switches++;previous=next;
  if(decision.selectedAction.kind!=='wait'){
   const offer=offerById(state,decision.selectedAction.id),after=applyAction(state,offer,1500);
   if(!after)throw new Error('invalid decision '+scenario.name+' '+policy+' '+decision.selectedAction.id);
   state=after;purchases.push({at:tick*1.5,id:offer.id,price:offer.price,reason:decision.reasonCode,target:next});
   if(state.commitment?.targetId===offer.id)state.commitment=null;
  }else waits++;
  state=advance(state,1.5);
  const cps=income(state).liquid;
  for(const target of [1e5,1e6,1e7])if(targets.earned[target]===undefined&&state.earned>=target)targets.earned[target]=state.elapsed;
  for(const target of [1000,10000,20000])if(targets.cps[target]===undefined&&cps>=target)targets.cps[target]=state.elapsed;
  if([60,300,900,1800,3600].includes(state.elapsed))snapshots.push({seconds:state.elapsed,bank:state.bank,earned:state.earned,cps,purchases:purchases.length,horizons:decision.horizons});
 }
 times.sort((a,b)=>a-b);
 return {scenario:scenario.name,policy,seconds,snapshots,targets,bank:state.bank,earned:state.earned,cps:income(state).liquid,owned:state.owned,buildings:state.buildings.map(b=>({id:b.id,amount:b.amount})),waits,switches,horizonMax,plannerMs:{median:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)]},purchases};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const results=[];for(const scenario of scenarios())for(const policy of ['current','fixed-horizon','no-reservation','greedy','growth-weights']){
  const result=simulate(scenario,policy);results.push(result);console.log(JSON.stringify({scenario:result.scenario,policy,earned:Math.round(result.earned),cps:Math.round(result.cps),purchases:result.purchases.length,waits:result.waits,p95:result.plannerMs.p95}));
 }
 for(const scenario of scenarios().filter(x=>['investment-order','seed-4','seed-6'].includes(x.name)))for(const policy of ['current','greedy','growth-weights']){
  const result=simulate(scenario,policy,3600);results.push(result);console.log(JSON.stringify({scenario:result.scenario,policy,seconds:3600,earned:Math.round(result.earned),cps:Math.round(result.cps)}));
 }
 for(const count of [2,4,6])results.push(simulate(scenarios().find(x=>x.name==='investment-order'),'prefix-facilities-'+count));
 mkdirSync('docs/rebuild/simulation',{recursive:true});
 writeFileSync('docs/rebuild/simulation/alpha15-results.json',JSON.stringify({engine:ENGINE_VERSION,revision:'51c2ffd64a6ca6f8a0bf0069f9955596cf195023',node:process.version,interval:1.5,scope:'Synthetic deterministic economy; same core model as planner, no browser, no random GC, no adapter or measurement costs. Fixed horizon, growth weights and no-reservation are experiments, not recommended replacements. Extended runs selected after initial results, not held-out validation.',scenarios:scenarios(),results},null,2)+'\n');
}
