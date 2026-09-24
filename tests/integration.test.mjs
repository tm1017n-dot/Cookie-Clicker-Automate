import test from 'node:test';
import assert from 'node:assert/strict';
import { mockGame } from './helpers.mjs';
import { DEFAULT_CONFIG,canonical } from '../src/core/contracts.mjs';
import { GameAdapter } from '../src/game/adapter.mjs';
import { Executor } from '../src/runtime/executor.mjs';
import { Coordinator,RUNTIME_KEY } from '../src/runtime/coordinator.mjs';
import { Diagnostics } from '../src/runtime/diagnostics.mjs';
import { plan } from '../src/core/planner.mjs';
function setup(){const g=mockGame();g.cookies=100;const a=new GameAdapter(()=>g),input=a.capture(DEFAULT_CONFIG,{targetId:'upgrade:0',status:'ready'}),d=plan(input);return {g,a,input,d};}
test('100Hz automation uses the normal handler despite the game cooldown',()=>{
 const g=mockGame(),a=new GameAdapter(()=>g);g.lastClick=Date.now()+100;
 g.ClickCookie=()=>{if(Date.now()-g.lastClick<20)return;g.cookieClicks++;g.cookies+=1;g.lastClick=Date.now();};
 assert.equal(a.click(50),false);assert.equal(a.click(100),true);assert.equal(g.cookieClicks,1);assert.equal(g.cookies,1);
});
test('100Hz automation keeps margin beyond the exact 20ms game boundary',()=>{
 const g=mockGame(),a=new GameAdapter(()=>g),now=Date.now();g.lastClick=now;
 g.ClickCookie=()=>{if(Date.now()-g.lastClick<21)return;g.cookieClicks++;g.cookies+=1;g.lastClick=Date.now();};
 assert.equal(a.click(100),true);assert.equal(a.click(100),true);assert.equal(g.cookieClicks,2);
});
test('rejected high rate click preserves cooldown and click count',()=>{
 const g=mockGame(),a=new GameAdapter(()=>g);g.lastClick=Date.now();const before=g.lastClick;g.ClickCookie=()=>{};
 assert.equal(a.click(100),false);assert.equal(g.lastClick,before);assert.equal(g.cookieClicks,0);
});
test('click scheduling respects rate changes and never catches up in bursts',async()=>{
 const g=mockGame();let now=0;const r=new Coordinator({},new GameAdapter(()=>g),{config:{observeOnly:false},clock:()=>now});await r.start({timers:false});
 for(now=0;now<1000;now+=10)r.clickTick();assert.equal(g.cookieClicks,100);assert.equal(r.measuredClickRate(),100);
 r.setClickRate(20);for(now=1000;now<2000;now+=10)r.clickTick();assert.equal(g.cookieClicks,120);assert.equal(r.clickRate(),20);
 now=60000;r.clickTick();r.clickTick();assert.equal(g.cookieClicks,121);assert.throws(()=>r.setClickRate(101));r.shutdown();
});
test('short timer throttling is recovered with a bounded click batch',async()=>{
 const g=mockGame();let now=0;const r=new Coordinator({},new GameAdapter(()=>g),{config:{observeOnly:false},clock:()=>now});await r.start({timers:false});
 for(now=0;now<5000;now+=25)r.clickTick();
 now=5000;const measured=r.measuredClickRate();
 assert.ok(measured>=99 && measured<=100,`measured ${measured}`);
 const before=g.cookieClicks;now=5075;r.clickTick();assert.equal(g.cookieClicks-before,5);
 r.shutdown();
});
test('failed clicks stop the current recovery batch and are never counted',async()=>{
 let now=0,calls=0,accepted=0;const adapter={fault:null,click(){calls++;if(calls===3)return false;accepted++;return true;},collect(){return 0;}};
 const r=new Coordinator({},adapter,{config:{observeOnly:false},clock:()=>now});await r.start({timers:false});
 r.clickTick();now=50;r.clickTick();
 assert.equal(calls,3);assert.equal(accepted,2);assert.equal(r.clicks.length,2);assert.equal(r.clickAttempts.length,3);
 r.shutdown();
});
test('startup income uses only successful clicks, never the configured target',async()=>{
 const g=mockGame();let now=0;const r=new Coordinator({},new GameAdapter(()=>g),{clock:()=>now});await r.start({timers:false});
 assert.equal(r.clickRate(),0);r.setObserveOnly(false);assert.equal(r.measuredClickRate(),0);assert.equal(r.clickRate(),0);
 now=1000;assert.equal(r.clickRate(),0);r.shutdown();
});
test('real Game ID dictionaries are supported as well as arrays',()=>{const g=mockGame();g.UpgradesById=Object.fromEntries(g.UpgradesById.map(u=>[u.id,u]));g.mouseCps=()=>2**Object.values(g.UpgradesById).filter(u=>u.bought).length;g.AchievementsById={};assert.equal(new GameAdapter(()=>g).capture(DEFAULT_CONFIG).state.offers.length,3);});
test('nonlinear click bonuses invalidate a reusable upgrade rule',()=>{const g=mockGame();g.mouseCps=()=>100+2**g.UpgradesById.filter(u=>u.bought).length;const offer=new GameAdapter(()=>g).capture(DEFAULT_CONFIG).state.offers[0];assert.equal(offer.rootOnly,true);assert.equal(offer.effect.flatClick,1);});
test('SAFE-02 restoration failure permanently disables adapter writes',()=>{const g=mockGame(),a=new GameAdapter(()=>g);g.CalculateGains=()=>Object.defineProperty(g,'unexpected',{value:1,configurable:false});assert.throws(()=>a.measure(()=>{}));assert.match(a.fault,/reload-required/);assert.equal(a.click(),false);});
test('Adapter captures exact input while preserving Game descriptors',()=>{const g=mockGame(),a=new GameAdapter(()=>g),before=canonical({cookies:g.cookies,owned:g.UpgradesOwned,buildings:g.ObjectsById.map(b=>[b.amount,b.bought,b.storedCps]),upgrades:g.UpgradesById.map(u=>u.bought)}),win=g.Win,effs=g.effs;a.capture(DEFAULT_CONFIG);assert.equal(canonical({cookies:g.cookies,owned:g.UpgradesOwned,buildings:g.ObjectsById.map(b=>[b.amount,b.bought,b.storedCps]),upgrades:g.UpgradesById.map(u=>u.bought)}),before);assert.equal(g.Win,win);assert.equal(g.effs,effs);});
test('unchanged captures reuse marginal measurements while refreshing volatile values',()=>{
 const g=mockGame(),original=g.CalculateGains;let calls=0;g.CalculateGains=()=>{calls++;original();};const a=new GameAdapter(()=>g);
 const first=a.capture(DEFAULT_CONFIG);assert.ok(calls>0);calls=0;
 g.cookies=123;g.cookiesEarned=456;const second=a.capture(DEFAULT_CONFIG);
 assert.equal(calls,0);assert.equal(second.state.bank,123);assert.equal(second.state.earned,456);
 g.ObjectsById[0].amount++;g.ObjectsById[0].bought++;original();calls=0;a.capture(DEFAULT_CONFIG);assert.ok(calls>0);
 assert.equal(first.observation.measurementCache,'miss');assert.equal(second.observation.measurementCache,'hit');
});
test('locked buildings do not run hypothetical production passes',()=>{
 const g=mockGame(),original=g.CalculateGains;g.ObjectsById.push({id:1,name:'Grandma',amount:0,bought:0,level:0,locked:1,storedCps:1,storedTotalCps:0,basePrice:100,synergies:[],tieredAchievs:{},getPrice(){return 100;}});
 let calls=0;g.CalculateGains=()=>{calls++;original();};new GameAdapter(()=>g).capture(DEFAULT_CONFIG);
 // Baseline + Cursor + three offered upgrades; the locked Grandma adds no pass.
 assert.equal(calls,5);
});
test('SAFE-01 restores after calculate exception',()=>{const g=mockGame(),a=new GameAdapter(()=>g),win=g.Win;g.CalculateGains=()=>{g.cookies=999;g.ObjectsById[0].amount=77;throw new Error('injected');};assert.throws(()=>a.measure(x=>{x.UpgradesById[0].bought=1;}));assert.equal(g.cookies,0);assert.equal(g.ObjectsById[0].amount,1);assert.equal(g.UpgradesById[0].bought,0);assert.equal(g.Win,win);});
for(const failure of ['false','throw'])test('RES-0'+(failure==='false'?2:3)+' no fallback after '+failure,()=>{const {g,a,input,d}=setup();let facilityCalls=0;g.ObjectsById[0].buy=()=>{facilityCalls++;};g.UpgradesById[0].buy=()=>{if(failure==='throw')throw new Error('buy-failed');return false;};const e=new Executor(a,()=>true),r=e.execute(d,input,'1');assert.equal(r.attemptCount,1);assert.equal(facilityCalls,0);assert.equal(d.nextCommitment.targetId,'upgrade:0');assert.equal(e.execute(d,input,'1').status,'duplicate-cycle');});
test('RES-01 exactly one affordable reserved purchase, success confirmed by bought',()=>{const {g,a,input,d}=setup(),e=new Executor(a,()=>true),r=e.execute(d,input,'1');assert.equal(r.status,'confirmed');assert.equal(g.UpgradesById[0].bought,1);assert.equal(g.ObjectsById[0].amount,1);});
test('SAFE-03 true return without state change remains pending',()=>{const {g,a,input,d}=setup();g.UpgradesById[0].buy=()=>true;let now=0;const e=new Executor(a,()=>true,()=>now);assert.equal(e.execute(d,input,'1').status,'pending');assert.equal(e.execute(d,input,'2').attemptCount,0);now=2001;assert.equal(e.poll().status,'unresolved');});
test('SAFE-04 stale price causes no API call',()=>{const {g,a,input,d}=setup();g.UpgradesById[0].getPrice=()=>101;assert.equal(new Executor(a,()=>true).execute(d,input,'1').status,'stale');assert.equal(g.UpgradesById[0].bought,0);});
test('predicted unlock never invokes buy before the upgrade appears in store',()=>{
 const {g,a,input,d}=setup();g.UpgradesInStore=[];let calls=0;g.UpgradesById[0].buy=()=>{calls++;return true;};
 const receipt=new Executor(a,()=>true).execute(d,input,'not-yet-unlocked');assert.equal(receipt.status,'not-in-store');assert.equal(receipt.attemptCount,0);assert.equal(calls,0);
});
test('lost ownership denies even a valid purchase',()=>{const {a,input,d}=setup();assert.equal(new Executor(a,()=>false).execute(d,input,'1').attemptCount,0);});
test('RUN-01 and RUN-02 shutdown/token ownership for reinjection',async()=>{const page={},g=mockGame();let shutdown=0;page[RUNTIME_KEY]={shutdown(){shutdown++;}};const r1=new Coordinator(page,new GameAdapter(()=>g));await r1.start({timers:false});const r2=new Coordinator(page,new GameAdapter(()=>g));await r2.start({timers:false});assert.equal(shutdown,1);assert.equal(r1.owns(),false);assert.equal(r2.owns(),true);r1.clickTick();assert.equal(g.cookieClicks,0);r2.shutdown();});
test('LOG-02 storage failure prevents purchase',async()=>{const g=mockGame();g.cookies=100;const diagnostics=new Diagnostics();diagnostics.save=async()=>{throw new Error('quota');};const r=new Coordinator({},new GameAdapter(()=>g),{config:{observeOnly:false},diagnostics});await r.start({timers:false});await r.tick();assert.equal(g.UpgradesById[0].bought,0);assert.equal(r.error,'quota');r.shutdown();});
test('REC-03 API capture error is retried next cycle without buying',async()=>{const g=mockGame();g.ready=false;const r=new Coordinator({},new GameAdapter(()=>g));await r.start({timers:false});await r.tick();assert.equal(r.error,'game-not-ready');g.ready=true;await r.tick();assert.equal(r.error,null);assert.ok(r.last);r.shutdown();});

test('observation never establishes an execution reservation',async()=>{
 const g=mockGame(),r=new Coordinator({},new GameAdapter(()=>g));await r.start({timers:false});await r.tick();
 assert.ok(r.last.decision.nextCommitment);assert.equal(r.commitment,null);r.shutdown();
});
test('switching modes invalidates an in-flight observation before execution',async()=>{
 const g=mockGame();g.cookies=100;const d=new Diagnostics();let release,entered;
 const waiting=new Promise(resolve=>entered=resolve);d.save=async()=>{entered();await new Promise(resolve=>release=resolve);};
 const r=new Coordinator({},new GameAdapter(()=>g),{diagnostics:d});await r.start({timers:false});
 const tick=r.tick();await waiting;r.setObserveOnly(false);release();await tick;
 assert.equal(g.UpgradesById[0].bought,0);assert.equal(r.commitment,null);r.shutdown();
});
test('releasing a reservation invalidates a purchase waiting for diagnostic storage',async()=>{
 const g=mockGame();g.cookies=100;const d=new Diagnostics();let release,entered;const waiting=new Promise(resolve=>entered=resolve);
 d.save=async()=>{entered();await new Promise(resolve=>release=resolve);};
 const r=new Coordinator({},new GameAdapter(()=>g),{config:{observeOnly:false},diagnostics:d});await r.start({timers:false});
 r.commitment={targetId:'upgrade:0',status:'ready'};const tick=r.tick();await waiting;r.clearCommitment();release();await tick;
 assert.equal(g.UpgradesById[0].bought,0);assert.equal(r.commitment,null);r.shutdown();
});
test('journal does not redefine unchanged properties',async()=>{
 const {Journal}=await import('../src/game/journal.mjs');let writes=0;
 const object=new Proxy({a:1,b:2},{defineProperty(target,key,descriptor){writes++;return Reflect.defineProperty(target,key,descriptor);}});
 const journal=new Journal([object]);journal.restore();assert.equal(writes,0);
 object.a=3;writes=0;journal.restore();assert.equal(writes,1);assert.equal(object.a,1);
});
test('new save invalidates the previous save reservation',async()=>{
 const g=mockGame();g.startDate=1;g.fullDate=1;g.cookies=0;
 const r=new Coordinator({},new GameAdapter(()=>g),{config:{observeOnly:false}});await r.start({timers:false});await r.tick();
 r.commitment={targetId:'building:8',status:'saving'};g.startDate=2;g.fullDate=2;
 await r.tick();assert.notEqual(r.commitment?.targetId,'building:8');assert.notEqual(r.last.decision.reasonCode,'WAIT_TARGET_UNAVAILABLE');r.shutdown();
});
test('measurement restores nested production summary maps',()=>{
 const g=mockGame();g.cookiesPsByType={Cursor:123};g.cookiesMultByType={kittens:456};const calculate=g.CalculateGains;
 g.CalculateGains=()=>{calculate();g.cookiesPsByType.Cursor=999;g.cookiesMultByType.kittens=888;};
 new GameAdapter(()=>g).capture(DEFAULT_CONFIG);
 assert.deepEqual(g.cookiesPsByType,{Cursor:123});assert.deepEqual(g.cookiesMultByType,{kittens:456});
});
