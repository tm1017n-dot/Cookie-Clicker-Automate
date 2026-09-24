// Offline comparison on unchanged historical captures; not a browser or game-play benchmark.
import { readdirSync,readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { plan } from '../src/core/planner.mjs';
import { plan as alpha7Plan } from './legacy/alpha7/planner.mjs';
import { makeGolden } from '../src/core/golden.mjs';
import { DEFAULT_CONFIG,ENGINE_VERSION,RULESET_VERSION,makeInput } from '../src/core/contracts.mjs';
const dir=new URL('../tests/fixtures/captured/',import.meta.url);
for(const name of readdirSync(dir).filter(x=>x.endsWith('.json'))){
 const record=JSON.parse(readFileSync(new URL(name,dir),'utf8'));
 const input={...record.input,engineVersion:ENGINE_VERSION,rulesetVersion:RULESET_VERSION,config:{...DEFAULT_CONFIG,...record.input.config}};
 const samples=[];let decision;
 for(let n=0;n<10;n++){const start=performance.now();decision=plan(input);samples.push(performance.now()-start);}
 samples.sort((a,b)=>a-b);
 console.log(JSON.stringify({fixture:name,legacyAction:record.decision.selectedAction.id,currentAction:decision.selectedAction.id,medianMs:+samples[5].toFixed(2),maxMs:+samples[9].toFixed(2),nodes:decision.expandedNodes.length}));
}
const sample=JSON.parse(readFileSync(new URL('building-2.json',dir),'utf8')).input.state;
const stress=makeInput({...sample,commitment:null,offers:[...sample.offers,...sample.buildings.filter(b=>b.id>0).map(b=>({id:'upgrade:synthetic-'+b.id,kind:'upgrade',targetId:10000+b.id,price:b.nextPrice*10,requiresBuildings:[{id:b.id,amount:b.amount+4}],effect:{buildingMultipliers:[{id:b.id,multiplier:2}]}}))]});
for(const [engine,planner,input] of [['alpha7',alpha7Plan,{...stress,engineVersion:'9.0.0-alpha.7',rulesetVersion:'cc-web-2.058/strategy-1'}],['current',plan,stress]]){
 for(let n=0;n<5;n++)planner(input);
 const samples=[];let decision;
 for(let n=0;n<30;n++){const start=performance.now();decision=planner(input);samples.push(performance.now()-start);}
 samples.sort((a,b)=>a-b);
 console.log(JSON.stringify({fixture:'synthetic-next-tiers',engine,medianMs:+samples[15].toFixed(2),maxMs:+samples[29].toFixed(2),candidates:decision.allCandidates.length,nodes:decision.expandedNodes.length,routes:decision.unlockPaths.length,selectedAction:decision.selectedAction.id}));
}
const gcStress=makeInput({...stress.state,golden:makeGolden({}),offers:[...stress.state.offers,{id:'upgrade:gc',kind:'upgrade',targetId:9000,price:100,effect:{golden:{frequency:.5}}}]});
for(const [engine,planner,input] of [['alpha7',alpha7Plan,{...gcStress,engineVersion:'9.0.0-alpha.7'}],['current',plan,gcStress]]){
for(let n=0;n<5;n++)planner(input);
const gcTimes=[];let gcDecision;
for(let i=0;i<30;i++){const start=performance.now();gcDecision=planner(input);gcTimes.push(performance.now()-start);}
gcTimes.sort((a,b)=>a-b);
console.log(JSON.stringify({fixture:'synthetic-next-tiers-with-gc',engine,medianMs:+gcTimes[15].toFixed(2),maxMs:+gcTimes[29].toFixed(2),nodes:gcDecision.expandedNodes.length,samples:gcStress.state.golden.lanes.length}));

}
