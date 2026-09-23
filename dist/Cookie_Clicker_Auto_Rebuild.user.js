// ==UserScript==
// @name Cookie Clicker Auto Rebuild
// @namespace cc-smart-auto
// @version 9.0.0-alpha.5
// @description Reproducible planner, exclusive purchases and diagnostic replay.
// @match https://orteil.dashnet.org/cookieclicker/*
// @grant none
// @run-at document-idle
// ==/UserScript==
(function(){'use strict';const factories={
"src/runtime/browser.mjs":function(require,exports){
const { GameAdapter }=require("src/game/adapter.mjs");
const { Coordinator }=require("src/runtime/coordinator.mjs");
const { Diagnostics }=require("src/runtime/diagnostics.mjs");
const { mountPanel }=require("src/ui/panel.mjs");

async function boot(page,document){
  const adapter=new GameAdapter(()=>page.Game);
  const runtime=new Coordinator(page,adapter,{diagnostics:new Diagnostics({persist:true})});
  mountPanel(runtime,document);
  try { await runtime.start(); await runtime.tick(); }
  catch(error) { runtime.error=String(error.message); runtime.onUpdate(runtime); }
  return runtime;
}
if(typeof document!=='undefined'){
  const page=typeof unsafeWindow!=='undefined'?unsafeWindow:window;
  boot(page,document).catch(error=>{console.error('[Cookie Auto]',error);});
}

Object.assign(exports,{boot});
},
"src/game/adapter.mjs":function(require,exports){
const { makeInput, clone, freeze, RULESET_VERSION }=require("src/core/contracts.mjs");
const { Journal }=require("src/game/journal.mjs");
const { effectDelta }=require("src/core/model.mjs");
const { refreshOnly,metadataEffect,eggPriceEffects,unroundedUpgradePrice }=require("src/game/effects.mjs");

const finite = (n,label) => { if (!Number.isFinite(n)) throw new Error('invalid-' + label); return n; };
const collection = value => Object.values(value || {}).filter(Boolean);
const objects = g => [g, g.ObjectsById, g.UpgradesById, g.AchievementsById, g.UpgradesInStore,
  g.buffs, g.effs, g.cookiesPsByType, g.cookiesMultByType, g.cookieUpgrades, g.wrinklers, ...collection(g.ObjectsById), ...collection(g.UpgradesById),
  ...collection(g.AchievementsById), ...Object.values(g.buffs || {}), ...collection(g.wrinklers)];
// Audited CalculateGains 2.058 writes root caches, these two maps and building caches.
// Win/Unlock are disabled during measurement; only the explicitly changed upgrade is writable.
const gainsObjects=(g,touched)=>[g,g.cookiesPsByType,g.cookiesMultByType,...collection(g.ObjectsById),...touched];
function normalTier(g,u){
  const b=u.buildingTie,t=g.Tiers?.[u.tier];
  if(!b || b.id===0 || !Number.isInteger(Number(u.tier)) || !t || t.special || !Number.isInteger(t.unlock) || t.unlock<1 || b.tieredUpgrades?.[u.tier]!==u || u.buildingTie2 || u.buyFunction || u.priceFunc)return null;
  let multiplier=2;
  if(g.ascensionMode!==1 && b.unshackleUpgrade && t.unshackleUpgrade && g.Has?.(b.unshackleUpgrade) && g.Has?.(t.unshackleUpgrade))multiplier+=b.id===1?.5:(20-b.id)*.1;
  return {buildingId:b.id,amount:t.unlock,multiplier};
}

class GameAdapter {
  constructor(getGame, { supportedVersions = ['2.058'] } = {}) {
    this.getGame = getGame; this.supportedVersions = supportedVersions; this.busy = false; this.fault = null;
  }
  get game() { const g = this.getGame(); if (!g?.ready) throw new Error('game-not-ready'); return g; }
  playable() { const g = this.getGame(); return Boolean(g?.ready && !g.OnAscend && !g.AscendTimer && !this.fault); }
  audit() {
    const g = this.game;
    if (!this.supportedVersions.includes(String(g.version))) throw new Error('unsupported-game-version:' + g.version);
    if (g.ascensionMode) throw new Error('unsupported-ascension-mode');
    if (Object.keys(g.mods || {}).length || Object.values(g.modHooks || {}).some(x => Array.isArray(x) && x.length)) throw new Error('unreviewed-mod-hooks');
  }
  measure(change, touched = null, probeMouse = false) {
    if (this.busy || this.fault) throw new Error(this.fault || 'adapter-busy');
    this.audit();
    const g = this.game, journal = new Journal(touched===null?objects(g):gainsObjects(g,touched));
    this.busy = true;
    try {
      g.Win = () => {}; g.Unlock = () => {};
      // The gains pass mutates caches; all root primitives and entity descriptors are journaled.
      change(g);
      g.CalculateGains();
      const result={ passive: finite(g.cookiesPs,'passive'), mouse: finite(g.mouseCps(),'mouse'),
        global: finite(g.globalCpsMult ?? 1,'multiplier') };
      if(probeMouse){const step=Math.max(1,Math.abs(g.cookiesPs));g.cookiesPs+=step;result.fraction=Math.max(0,(finite(g.mouseCps(),'mouse')-result.mouse)/step);}
      return result;
    } finally {
      try { journal.restore(); } catch (error) { this.fault = 'reload-required:' + error.message; throw error; }
      finally { this.busy = false; }
    }
  }
  price(kind,id) {
    const g = this.game;
    const target = kind === 'building' ? g.ObjectsById[id] : g.UpgradesById[id];
    if (!target) throw new Error('target-missing');
    return finite(target.getPrice(),'price');
  }
  marker(action) {
    const g = this.game;
    return action.operation === 'buyBuilding' ? g.ObjectsById[action.targetId]?.amount : g.UpgradesById[action.targetId]?.bought;
  }
  available(action){
    const g=this.game;
    return action.kind==='upgrade'?(g.UpgradesInStore??[]).some(u=>u.id===action.targetId):!!g.ObjectsById[action.targetId]&&!g.ObjectsById[action.targetId].locked;
  }
  runIdentity() { const g=this.game; return JSON.stringify([g.startDate??null,g.fullDate??null,g.resets??0]); }
  signature() {
    const g = this.game;
    return JSON.stringify({ run:this.runIdentity(),buildings:collection(g.ObjectsById).map(b => [b.id,b.amount,b.level]),
      upgrades:collection(g.UpgradesById).filter(u => u.bought).map(u => u.id),
      buffs:Object.values(g.buffs || {}).map(b => [b.name,b.multCpS ?? 1,b.multClick ?? 1]),
      season:g.season ?? '', dragon:[g.dragonAura ?? 0,g.dragonAura2 ?? 0],
      reserves:[g.lumps ?? 0,g.elderWrath ?? 0],
      minigames:collection(g.ObjectsById).filter(b => b.minigameLoaded).map(b => [b.id,b.minigame?.magic ?? null,b.minigame?.swaps ?? null]),
      ascend:!!(g.OnAscend || g.AscendTimer) });
  }
  capture(config, commitment = null, measuredRate = config.clickRate) {
    this.audit();
    const g = this.game;
    if (!this.playable()) throw new Error('game-not-playable');
    const signature = this.signature();
    const buffs = Object.values(g.buffs || {}).map(b => ({ id:b.id ?? b.name, remaining:Math.max(0,b.time/g.fps),
      passive:b.multCpS ?? 1,click:b.multClick ?? 1 }));
    if (Object.values(g.buffs || {}).some(b => b.name === 'Cursed finger')) throw new Error('unsupported-cursed-finger');
    const steady = this.measure(x => { x.buffs = {}; }, [], true);
    const fraction=steady.fraction;
    const buildings = collection(g.ObjectsById).map(b => {
      const price = this.price('building',b.id);
      const unit = Math.max(0,(b.storedCps ?? (b.amount ? b.storedTotalCps/b.amount : 0)) * steady.global);
      const measured = this.measure(x => { x.buffs={}; b.amount++; b.bought++; x.BuildingsOwned++; }, []);
      const passiveDelta = measured.passive - steady.passive;
      const clickDelta = measured.mouse - steady.mouse;
      const residual = clickDelta - fraction*passiveDelta;
      const crossEffect = Math.abs(passiveDelta-unit) > Math.max(1e-8,Math.abs(unit)*1e-6) || Math.abs(residual) > 1e-8;
      return { id:b.id,amount:b.amount,bought:b.bought,level:b.level ?? 0,free:b.free ?? 0,
        unitCps:unit,nextPrice:price,priceAtAmount:b.amount,growth:g.priceIncrease ?? 1.15,
        unroundedNextPrice:typeof g.modifyBuildingPrice==='function' ? finite(g.modifyBuildingPrice(b,b.basePrice*(g.priceIncrease??1.15)**Math.max(0,b.amount-(b.free??0))),'raw-price') : price,disabled:!!b.locked,
        effectOverride:crossEffect ? {building:b.id,flatPassive:passiveDelta-unit,flatClick:residual} : null,
        rootOnly:crossEffect, measurement:{passive:passiveDelta,mouse:clickDelta} };
    });
    const offered = new Set((g.UpgradesInStore || []).map(u => u.id));
    const nextTiers=new Map();
    for(const u of collection(g.UpgradesById)){
      const tier=normalTier(g,u);if(u.bought || u.unlocked || !tier)continue;
      const current=nextTiers.get(tier.buildingId);
      if(!current || tier.amount<current.tier.amount || (tier.amount===current.tier.amount && u.id<current.upgrade.id))nextTiers.set(tier.buildingId,{upgrade:u,tier});
    }
    const futureIds=new Set([...nextTiers.values()].map(x=>x.upgrade.id));
    const offers = collection(g.UpgradesById).filter(u => !u.bought && (offered.has(u.id) || u.id <= 2 || futureIds.has(u.id))).map(u => {
      const price = this.price('upgrade',u.id);
      const tier=normalTier(g,u),future=futureIds.has(u.id) && !offered.has(u.id);
      const disallowed = ['prestige','debug','toggle'].includes(u.pool) || !refreshOnly(u.buyFunction) || Boolean(u.toggleInto) || Boolean(u.ask) || (u.priceLumps??0)>0;
      // Locked ordinary tiers have audited metadata. Do not run hundreds of hypothetical gains passes.
      const measured = future||disallowed?null:this.measure(x => { x.buffs={}; u.bought=1; if (x.CountsAsUpgradeOwned?.(u.pool)) x.UpgradesOwned++; }, [u]);
      const passiveDelta = measured?measured.passive-steady.passive:0, mouseDelta = measured?measured.mouse-steady.mouse:0;
      let effect = null, rootOnly = true, confidence = 'unknown';
      if (u.id <= 2) { effect={buildingMultipliers:[{id:0,multiplier:2}],clickMultiplier:2}; rootOnly=false; confidence='high'; }
      else if(tier){effect={buildingMultipliers:[{id:tier.buildingId,multiplier:tier.multiplier}]};rootOnly=false;confidence='high';}
      else if(metadataEffect(g,u)){effect=metadataEffect(g,u);rootOnly=false;confidence='high';}
      else if (u.buildingTie && u.tier != null && !u.buildingTie1 && passiveDelta > 0) {
        const b = buildings.find(b => b.id === u.buildingTie.id);
        if (b && b.amount*b.unitCps > 0) {
          effect={buildingMultipliers:[{id:b.id,multiplier:1+passiveDelta/(b.amount*b.unitCps)}]}; confidence='medium'; rootOnly=false;
          if (Math.abs(mouseDelta-fraction*passiveDelta)>Math.max(1e-8,Math.abs(mouseDelta)*1e-6)) rootOnly=true;
        }
      }
      if (measured && effect && !rootOnly) {
        const prediction=effectDelta({passive:steady.passive-buildings.reduce((n,b)=>n+b.amount*b.unitCps,0),buildings,
          buffs:[],offers:[],clickUnit:steady.mouse-fraction*steady.passive,clickFraction:fraction,nonCursorClick:0,clickRate:1}, {effect});
        const agrees=(a,b)=>Math.abs(a-b)<=Math.max(1e-8,Math.abs(b)*1e-6);
        if(!agrees(prediction.click,mouseDelta) || !agrees(prediction.liquid-prediction.click,passiveDelta))rootOnly=true;
      }
      if (!effect || rootOnly) {
        effect=null;
        if (passiveDelta !== 0 || mouseDelta !== 0) { effect={flatPassive:passiveDelta,flatClick:mouseDelta-fraction*passiveDelta}; confidence='medium'; }
      }
      const eggFactors=eggPriceEffects(g,u);
      if(effect && eggFactors.length)effect={...effect,upgradePriceFactors:eggFactors};
      const rawPrice=unroundedUpgradePrice(g,u,price);
      const available = offered.has(u.id);
      return {id:'upgrade:'+u.id,kind:'upgrade',targetId:u.id,price,unroundedPrice:rawPrice??price,unverifiedPrice:rawPrice===null,effect,rootOnly,confidence,
        internalName:u.name,displayName:u.dname ?? u.name,pool:u.pool ?? '',
        disabled:disallowed || (!available && u.id>2 && !future),
        requiresBuildings:u.id<=2 ? [{id:0,amount:u.id===2 ? 10 : 1}] : future?[{id:tier.buildingId,amount:tier.amount}]:[],
        evidence:future?[{source:'Game.Tiers + building.tieredUpgrades',coverage:'next-ordinary-tier',unlockAmount:tier.amount,multiplier:tier.multiplier}]:[{source:'Game.CalculateGains + audited metadata',coverage:disallowed?'disabled':!rootOnly?'reusable':'current-state-production',passiveDelta,mouseDelta}],
        warnings:disallowed?['special-operation-not-enabled']:(effect?[]:['unknown-effect'])};
    });
    const sum = buildings.reduce((n,b) => n+b.unitCps*b.amount,0);
    const wither = g.cpsSucked || 0;
    // Deferred assets need a liquidation policy; this alpha does not trade them as liquid income.
    if (wither > 0) throw new Error('wrinkler-liquidation-model-not-enabled');
    const input = clone(makeInput({ bank:finite(g.cookies,'bank'), reserve:config.reserve ?? 0,
      passive:steady.passive-sum,clickUnit:steady.mouse-fraction*steady.passive,clickFraction:fraction,
      clickRate:config.autoClick?measuredRate:0,buildings,offers,buffs,commitment,
      owned:collection(g.UpgradesById).filter(u => u.bought).map(u => 'upgrade:'+u.id),earned:g.cookiesEarned ?? 0,
      config, modelWarnings:offers.some(o => o.rootOnly)?['partial-child-model']:[] }));
    input.environment={ gameVersion:String(g.version),language:globalThis.locId ?? 'unknown',fps:g.fps,
      observedAt:new Date().toISOString() };
    input.observation={ signature, bank:g.cookies,displayedCps:g.cookiesPs,unbuffedCps:g.unbuffedCps,
      clickUnit:g.mouseCps(),requestedClickRate:config.clickRate,measuredClickRate:measuredRate,
      achievements:collection(g.AchievementsById).filter(a => a.won).map(a => a.id), milk:g.milkProgress ?? 0,
      ruleset:RULESET_VERSION };
    if (signature !== this.signature()) throw new Error('capture-state-changed');
    return freeze(input);
  }
  execute(action) {
    if (this.busy || this.fault || !this.playable()) throw new Error('adapter-not-writable');
    const g = this.game;
    this.busy = true;
    try {
      if (action.operation === 'buyBuilding') {
        const oldMode=g.buyMode,oldBulk=g.buyBulk;
        try { g.buyMode=1;g.buyBulk=1;return g.ObjectsById[action.targetId].buy(1); }
        finally { g.buyMode=oldMode;g.buyBulk=oldBulk; }
      }
      if (action.operation === 'buyUpgrade') return g.UpgradesById[action.targetId].buy();
      throw new Error('operation-not-enabled');
    } finally { this.busy=false; }
  }
  click(requestedRate = 50) {
    if (this.busy || !this.playable()) return false;
    const g=this.game,before=g.cookieClicks;
    // Web 2.058 rejects calls less than 20ms apart. Permit the configured automation
    // rate through the normal click handler; never multiply cookie rewards directly.
    const lastClick=g.lastClick;
    if(requestedRate>50 && Number.isFinite(lastClick))g.lastClick=Math.min(lastClick,Date.now()-20);
    try { g.ClickCookie(); return g.cookieClicks>before; }
    finally { if(g.cookieClicks===before && requestedRate>50 && Number.isFinite(lastClick))g.lastClick=lastClick; }
  }
  collect(config) {
    if (this.busy || !this.playable()) return 0;
    let count=0;
    for (const shimmer of [...this.game.shimmers]) if (shimmer.type==='golden' && config.collectGolden && (!shimmer.wrath || config.collectWrath)) {shimmer.pop();count++;}
    return count;
  }
}

Object.assign(exports,{GameAdapter});
},
"src/core/contracts.mjs":function(require,exports){
const ENGINE_VERSION = '9.0.0-alpha.5';
const RULESET_VERSION = 'cc-web-2.058/basic-3';
const DEFAULT_CONFIG = Object.freeze({
  horizons: [60, 300, 900], weights: [0.2, 0.35, 0.45],
  depth: 3, beamWidth: 24, maxNodes: 1024, maxEvents: 4096,
  maxUnlockSteps:24,maxUnlockNodes:256,
  switchMargin:.25,switchAbsolute:.05,switchConfirmations:3,switchCooldown:4,
  clickRate: 100, purchaseIntervalMs: 1500, riskWeight: 0.1,
  observeOnly: true, autoClick: true, collectGolden: true, collectWrath: false,
  allowSell: false, allowLumps: false, allowAscend: false
});

const clone = value => structuredClone(value);
const epsilon = (a, b) => Math.max(1e-9, 1e-12 * Math.max(Math.abs(a), Math.abs(b)));
const known = value => Number.isFinite(value) ? { status: 'known', value } : { status: 'unreachable', value: null, reason: 'no-finite-path' };
const unknown = reason => ({ status: 'unknown', value: null, reason });
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function assertJson(value, path = '$') {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError(`${path}: non-finite`);
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw new TypeError(`${path}: not JSON`);
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) assertJson(v, path + '.' + k);
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const v of Object.values(value)) freeze(v); }
  return value;
}
function validateInput(input) {
  assertJson(input);
  if (input.schemaVersion !== 1 || input.engineVersion !== ENGINE_VERSION || input.rulesetVersion !== RULESET_VERSION) throw new TypeError('VersionMismatch');
  const s = input.state, c = input.config;
  for (const key of ['bank', 'reserve', 'clickRate', 'elapsed']) if (!Number.isFinite(s[key]) || s[key] < 0) throw new TypeError('invalid state.' + key);
  for (const key of ['passive', 'clickUnit', 'clickFraction', 'nonCursorClick', 'deferred', 'earned']) if (!Number.isFinite(s[key])) throw new TypeError('invalid state.' + key);
  for (const key of ['depth', 'beamWidth', 'maxNodes', 'maxEvents']) if (!Number.isInteger(c[key]) || c[key] < 1) throw new TypeError('invalid config.' + key);
  if (c.depth > 5 || c.maxNodes > 10000 || c.maxEvents > 10000 || c.beamWidth > 128) throw new TypeError('unsafe planning budget');
  for(const key of ['maxUnlockSteps','maxUnlockNodes','switchConfirmations','switchCooldown'])if(!Number.isInteger(c[key])||c[key]<1||c[key]>1024)throw new TypeError('invalid config.'+key);
  for(const key of ['switchMargin','switchAbsolute'])if(!Number.isFinite(c[key])||c[key]<0||c[key]>10)throw new TypeError('invalid config.'+key);
  if (c.horizons.length !== 3 || c.weights.length !== 3 || c.horizons.some((h, i) => h <= 0 || (i && h <= c.horizons[i - 1])) || c.weights.some(w => w < 0) || c.weights.reduce((a,b) => a+b,0) <= 0) throw new TypeError('invalid horizons/weights');
  const ids = new Set();
  for (const b of s.buildings) {
    if (!Number.isInteger(b.id) || ids.has('building:' + b.id) || b.amount < 0 || !Number.isInteger(b.amount) || b.unitCps < 0 || b.nextPrice < 0) throw new TypeError('invalid building');
    ids.add('building:' + b.id);
  }
  for (const o of s.offers) {
    if (ids.has(o.id) || typeof o.id !== 'string' || (o.price !== null && (typeof o.price !== 'number' || o.price < 0))) throw new TypeError('invalid offer');
    ids.add(o.id);
    if(o.requiresOwned!==undefined && (!Array.isArray(o.requiresOwned)||o.requiresOwned.some(id=>typeof id!=='string')))throw new TypeError('invalid upgrade prerequisites');
    if(o.requiresBuildings!==undefined && (!Array.isArray(o.requiresBuildings)||o.requiresBuildings.some(r=>!Number.isInteger(r.id)||r.id<0||!Number.isInteger(r.amount)||r.amount<0)))throw new TypeError('invalid building prerequisites');
  }
  for (const b of s.buffs) if (b.remaining < 0 || b.passive < 0 || b.click < 0) throw new TypeError('invalid buff');
  return input;
}
function makeInput(options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options.config };
  const state = {
    bank: 0, reserve: 0, passive: 0, clickUnit: 0, clickRate: 0,
    clickFraction: 0, nonCursorClick: 0, deferred: 0, deferredRate: 0,
    earned: 0, elapsed: 0, buildings: [], offers: [], owned: [], buffs: [], events: [],
    commitment: null, pendingExecution: null, strategy: 'BUILD', modelWarnings: [],
    ...options
  };
  delete state.config;
  const input = { schemaVersion: 1, engineVersion: ENGINE_VERSION, rulesetVersion: RULESET_VERSION,
    environment: { gameVersion: 'synthetic', language: 'en', fps: 30 },
    capabilities: { purchase: true, combos: false, minigames: false },
    config, state, stochasticModel: { seed: 0, samples: 0, mode: 'deterministic-base' } };
  return freeze(validateInput(clone(input)));
}

Object.assign(exports,{ENGINE_VERSION,RULESET_VERSION,DEFAULT_CONFIG,clone,epsilon,known,unknown,canonical,assertJson,freeze,validateInput,makeInput});
},
"src/game/journal.mjs":function(require,exports){
// Preserve descriptors as well as values: game functions and collection identities matter.
const fields=['value','get','set','writable','enumerable','configurable'];
const same=(a,b)=>a && b && fields.every(field=>Object.is(a[field],b[field]));
class Journal {
  constructor(objects) {
    this.entries = [...new Set(objects.filter(x => x && typeof x === 'object'))].map(object => ({ object, descriptors: Object.getOwnPropertyDescriptors(object) }));
  }
  restore() {
    for (const { object, descriptors } of [...this.entries].reverse()) {
      for (const key of Reflect.ownKeys(object)) if (!(key in descriptors)) {
        if (!Reflect.deleteProperty(object,key)) throw new Error('restore-delete-failed:' + String(key));
      }
      for(const key of Reflect.ownKeys(descriptors)) {
        if(!same(Object.getOwnPropertyDescriptor(object,key),descriptors[key]))Object.defineProperty(object,key,descriptors[key]);
      }
    }
    for (const { object, descriptors } of this.entries) {
      const actual = Object.getOwnPropertyDescriptors(object);
      if (Reflect.ownKeys(actual).length !== Reflect.ownKeys(descriptors).length) throw new Error('restore-key-mismatch');
      for (const key of Reflect.ownKeys(descriptors)) {
        for (const field of fields)
          if (!Object.is(actual[key]?.[field],descriptors[key][field])) throw new Error('restore-value-mismatch:' + String(key));
      }
    }
  }
}

Object.assign(exports,{Journal});
},
"src/core/model.mjs":function(require,exports){
const { clone, epsilon }=require("src/core/contracts.mjs");

// Copy only writable simulation data. Effects, prerequisites and evidence are immutable.
function copyState(s) {
  return {...s,buildings:s.buildings.map(b=>({...b})),offers:s.offers?.map(o=>({...o})),
    owned:s.owned?.slice(),buffs:s.buffs.map(b=>({...b})),events:s.events?.slice()};
}

function income(s) {
  const raw = Math.max(0, s.passive + s.buildings.reduce((sum, b) => sum + b.amount * b.unitCps, 0));
  const passiveMult = s.buffs.reduce((m, b) => m * b.passive, 1);
  const clickMult = s.buffs.reduce((m, b) => m * b.click, 1);
  const passive = raw * passiveMult;
  const nonCursor = s.buildings.filter(b => b.id !== 0).reduce((n, b) => n + b.amount, 0);
  const clickUnit = Math.max(0, s.clickUnit + s.clickFraction * passive + s.nonCursorClick * nonCursor) * clickMult;
  const click = clickUnit * s.clickRate;
  const liquid = passive + click;
  return { passive, click, clickUnit, liquid, economic: liquid + (s.deferredRate || 0) };
}
function buildingPrice(b) {
  if (b.amount === (b.priceAtAmount ?? b.amount)) return b.nextPrice;
  const paid = amount => Math.max(0, amount - (b.free ?? 0));
  return Math.ceil((b.unroundedNextPrice ?? b.nextPrice) * (b.growth ?? 1.15) ** (paid(b.amount) - paid(b.priceAtAmount)));
}
function eligible(s, o) {
  if (s.owned.includes(o.id) || o.disabled || o.price === null) return false;
  if (s.pricesChanged && o.unverifiedPrice) return false;
  if (o.requiresOwned?.some(id => !s.owned.includes(id))) return false;
  if (o.requiresBuildings?.some(r => (s.buildings.find(b => b.id === r.id)?.amount ?? 0) < r.amount)) return false;
  if (o.availableAt != null && s.elapsed < o.availableAt) return false;
  return true;
}
function allOffers(s) {
  return [...s.buildings.filter(b => !b.disabled).map(b => ({ id: 'building:' + b.id, kind: 'building', targetId: b.id,
    price: buildingPrice(b), effect: b.effectOverride ?? { building: b.id }, rootOnly:!!b.rootOnly, confidence: 'high', eligible: true })),
    ...s.offers.map(o => ({ ...o, eligible: eligible(s, o) }))].sort((a,b) => a.id.localeCompare(b.id, 'en'));
}
function offerById(s,id) {
  const b=s.buildings.find(b=>'building:'+b.id===id);
  if(b)return b.disabled?undefined:{id,kind:'building',targetId:b.id,price:buildingPrice(b),effect:b.effectOverride??{building:b.id},rootOnly:!!b.rootOnly,confidence:'high',eligible:true};
  const o=s.offers.find(o=>o.id===id);
  return o?{...o,eligible:eligible(s,o)}:undefined;
}
function applyEffect(s, e) {
  if (e.building != null) s.buildings.find(b => b.id === e.building).amount++;
  s.passive += e.flatPassive ?? 0;
  s.clickUnit += e.flatClick ?? 0;
  s.clickFraction += e.clickFraction ?? 0;
  s.nonCursorClick += e.nonCursorClick ?? 0;
  if (e.passiveMultiplier != null) {
    s.passive *= e.passiveMultiplier;
    for (const b of s.buildings) b.unitCps *= e.passiveMultiplier;
  }
  if (e.clickMultiplier != null) {
    s.clickUnit *= e.clickMultiplier;
    s.clickFraction *= e.clickMultiplier;
    s.nonCursorClick *= e.clickMultiplier;
  }
  for (const m of e.buildingMultipliers ?? []) {
    const b = s.buildings.find(x => x.id === m.id);
    if (b) b.unitCps *= m.multiplier;
  }
  const buildingDiscount=e.buildingPriceMultiplier??e.priceMultiplier;
  const upgradeDiscount=e.upgradePriceMultiplier??e.priceMultiplier;
  if (buildingDiscount != null) {
    for (const b of s.buildings) { b.unroundedNextPrice=(b.unroundedNextPrice??b.nextPrice)*buildingDiscount; b.nextPrice=Math.ceil(b.unroundedNextPrice); }
  }
  if (upgradeDiscount != null) {
    for (const o of s.offers) if (o.price !== null) { o.unroundedPrice=(o.unroundedPrice??o.price)*upgradeDiscount; o.price=Math.ceil(o.unroundedPrice); }
    s.pricesChanged=true;
  }
  for(const m of e.upgradePriceFactors??[]){
    const o=s.offers?.find(o=>o.id===m.id);
    if(o && o.price!==null){o.unroundedPrice=(o.unroundedPrice??o.price)*m.multiplier;o.price=Math.ceil(o.unroundedPrice);}
  }
  if (e.reward) { s.bank += e.reward; s.earned += e.reward; }
  if (e.buff) s.buffs.push(clone(e.buff));
}
function applyAction(state, offer) {
  const s = copyState(state);
  if (!offer?.effect || !offer.eligible || s.bank + epsilon(s.bank, offer.price) < offer.price + s.reserve) return null;
  s.bank = Math.max(0, s.bank - offer.price);
  applyEffect(s, offer.effect);
  if (offer.kind !== 'building' || offer.effect.building == null) s.owned.push(offer.id);
  return s;
}
function advance(state, seconds, maxEvents = 4096) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new TypeError('invalid duration');
  const s = copyState(state);
  for (const e of s.events.filter(e => e.at <= s.elapsed)) applyEffect(s, e.effect ?? {});
  s.events = s.events.filter(e => e.at > s.elapsed);
  s.buffs = s.buffs.filter(b => b.remaining > 0);
  let left = seconds, count = 0;
  while (left > 0) {
    if (++count > maxEvents) throw new Error('event-budget');
    const upcoming = s.events.filter(e => e.at > s.elapsed).map(e => e.at - s.elapsed);
    const dt = Math.min(left, ...s.buffs.filter(b => b.remaining > 0).map(b => b.remaining), ...upcoming);
    const rates = income(s);
    s.bank += rates.liquid * dt;
    s.earned += rates.liquid * dt;
    s.deferred += (s.deferredRate || 0) * dt;
    s.elapsed += dt;
    left = Math.max(0, left - dt);
    for (const b of s.buffs) b.remaining = Math.max(0, b.remaining - dt);
    s.buffs = s.buffs.filter(b => b.remaining > 0);
    const due = s.events.filter(e => e.at <= s.elapsed);
    for (const e of due) applyEffect(s, e.effect ?? {});
    s.events = s.events.filter(e => e.at > s.elapsed);
  }
  return s;
}
function eta(state, price, maxEvents = 4096) {
  if (price == null || !Number.isFinite(price)) return Infinity;
  let s = advance(state, 0, maxEvents), elapsed = 0;
  for (let n = 0; n < maxEvents; n++) {
    const need = price + s.reserve - s.bank;
    if (need <= epsilon(price + s.reserve, s.bank)) return elapsed;
    const rate = income(s).liquid;
    const direct = rate > 0 ? need / rate : Infinity;
    const next = Math.min(...s.buffs.filter(b => b.remaining > 0).map(b => b.remaining), ...s.events.filter(e => e.at > s.elapsed).map(e => e.at - s.elapsed));
    if (direct <= next) return elapsed + direct;
    if (!Number.isFinite(next)) return Infinity;
    s = advance(s, next, maxEvents); elapsed += next;
  }
  return Infinity;
}
function effectDelta(s, offer) {
  if (!offer.effect) return null;
  const before = income(s), after = copyState(s);
  applyEffect(after, offer.effect);
  const out = income(after);
  return { liquid: out.liquid - before.liquid, click: out.click - before.click, economic: out.economic - before.economic };
}

Object.assign(exports,{copyState,income,buildingPrice,eligible,allOffers,offerById,applyEffect,applyAction,advance,eta,effectDelta});
},
"src/game/effects.mjs":function(require,exports){
// Audited against Web 2.058. Keys are engine dictionary keys, never translated labels.
const priceRules=[
  ['Season savings',{buildingPriceMultiplier:.99}],
  ['Toy workshop',{upgradePriceMultiplier:.95}],
  ["Santa's dominion",{passiveMultiplier:1.2,buildingPriceMultiplier:.99,upgradePriceMultiplier:.98}],
  ['Faberge egg',{buildingPriceMultiplier:.99,upgradePriceMultiplier:.99}],
  ['Fortune #100',{passiveMultiplier:1.01,buildingPriceMultiplier:.99,upgradePriceMultiplier:.99}],
  ['Wrinkler ambergris',{passiveMultiplier:1.06,upgradePriceMultiplier:.99}]
];
function refreshOnly(callback){
  if(!callback)return true;
  const source=Function.prototype.toString.call(callback).replace(/\s+/g,'');
  return /^(?:function\w*\(\)|\(\)=>)\{(?:Game\.(?:storeToRefresh|upgradesToRebuild)=1;?)+\}$/.test(source);
}
function metadataEffect(g,u){
  for(const [key,effect] of priceRules)if(g.Upgrades?.[key]===u)return {...effect};
  if((g.cookieUpgrades??[]).includes(u) && Number.isFinite(u.power) && u.power>=0)return {passiveMultiplier:1+u.power*.01};
  return null;
}
function eggPriceEffects(g,u){
  if(!(g.eggDrops??[]).some(key=>g.Upgrades?.[key]===u) && !(g.rareEggDrops??[]).some(key=>g.Upgrades?.[key]===u))return [];
  return [...(g.eggDrops??[]).map(key=>({id:'upgrade:'+g.Upgrades[key].id,multiplier:2})),
    ...(g.rareEggDrops??[]).map(key=>({id:'upgrade:'+g.Upgrades[key].id,multiplier:3}))];
}
// Preserve pre-ceiling prices so two successive discounts do not compound rounding error.
// Verification against getPrice is mandatory before the result is used.
function unroundedUpgradePrice(g,u,actual){
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

Object.assign(exports,{refreshOnly,metadataEffect,eggPriceEffects,unroundedUpgradePrice});
},
"src/runtime/coordinator.mjs":function(require,exports){
const { DEFAULT_CONFIG }=require("src/core/contracts.mjs");
const { plan }=require("src/core/planner.mjs");
const { Executor }=require("src/runtime/executor.mjs");
const { bundle, Diagnostics }=require("src/runtime/diagnostics.mjs");

const RUNTIME_KEY='__CC_SMART_AUTO_RUNTIME__';
class Coordinator {
  constructor(page,adapter,{config={},diagnostics=new Diagnostics(),clock=()=>Date.now(),onUpdate=()=>{}}={}){
    this.page=page;this.adapter=adapter;this.config={...DEFAULT_CONFIG,...config};this.diagnostics=diagnostics;
    this.clock=clock;this.onUpdate=onUpdate;this.version='9.0.0-alpha.5';this.generation=0;
    this.token=globalThis.crypto.randomUUID();this.stopped=false;this.running=false;this.commitment=null;
    this.cycle=0;this.timers=[];this.clicks=[];this.started=clock();this.error=null;this.last=null;
    this.executor=new Executor(adapter,()=>this.owns(),clock);
    this.snapshot=()=>this.diagnostics.latest();
  }
  owns(){return !this.stopped && this.page[RUNTIME_KEY]===this;}
  async start({timers=true}={}){
    const old=this.page[RUNTIME_KEY];
    if(old?.shutdown)old.shutdown('new-version');
    this.page[RUNTIME_KEY]=this;
    await this.diagnostics.open();
    if(!this.owns())return;
    if(timers){
      this.timers.push(setInterval(()=>this.tick(),this.config.purchaseIntervalMs));
      this.timers.push(setInterval(()=>this.clickTick(),10));
      this.timers.push(setInterval(()=>this.collectTick(),150));
    }
    this.onUpdate(this);
  }
  measuredClickRate(){const now=this.clock();this.clicks=this.clicks.filter(t=>now-t<5000);return this.config.observeOnly || !this.config.autoClick?0:this.clicks.length/Math.max(.001,Math.min(5,(now-this.started)/1000));}
  clickRate(){return this.measuredClickRate();}
  clickTick(){
    if(!this.owns() || this.config.observeOnly || !this.config.autoClick || this.error)return;
    const now=this.clock();if(now<(this.nextClickAt??0))return;
    // No catch-up burst after a stalled/background tab.
    this.nextClickAt=now+1000/this.config.clickRate;
    try{if(this.adapter.click(this.config.clickRate))this.clicks.push(now);}catch(e){this.error=e.message;this.onUpdate(this);}
  }
  collectTick(){if(!this.owns() || this.config.observeOnly || this.error)return;try{this.adapter.collect(this.config);}catch(e){this.error=e.message;this.onUpdate(this);}}
  async tick(){
    if(!this.owns() || this.running || this.adapter.fault || this.error==='purchase-result-unresolved')return;
    this.running=true;
    const generation=this.generation,observeOnly=this.config.observeOnly;
    const elapsed=()=>globalThis.performance.now();
    const started=elapsed();
    try{
      this.error=null;
      const runIdentity=this.adapter.runIdentity();
      if(this.runIdentity!==undefined && this.runIdentity!==runIdentity){
        this.commitment=null;this.executor=new Executor(this.adapter,()=>this.owns(),this.clock);
        this.started=this.clock();this.clicks=[];
      }
      this.runIdentity=runIdentity;
      const pending=this.executor.poll();
      if(pending){
        if(pending.status==='pending')return;
        if(this.last){this.last.receipt=pending;await this.diagnostics.save(this.last);}
        if(pending.status==='unresolved')throw new Error('purchase-result-unresolved');
        if(pending.status==='confirmed' && this.commitment?.targetId===pending.actionId)this.commitment=null;
      }
      const input=this.adapter.capture(this.config,observeOnly?null:this.commitment,this.config.autoClick?this.clickRate():0);
      const captured=elapsed();
      const decision=plan(input);
      const planned=elapsed();
      const record=await bundle(input,decision,this.token+':'+(++this.cycle));
      record.runtimeVersion=this.version;
      record.timings={captureMs:captured-started,plannerMs:planned-captured};
      await this.diagnostics.save(record);
      if(!this.owns() || generation!==this.generation)return;
      if(!observeOnly){
        this.commitment=decision.nextCommitment;
        record.receipt=this.executor.execute(decision,input,record.cycleId);
        if(record.receipt.status==='confirmed' && this.commitment?.targetId===record.receipt.actionId)this.commitment=null;
        // An exception stops just this purchase cycle; the next cycle recaptures unless restore failed.
        if(this.adapter.fault)throw new Error(this.adapter.fault);
        await this.diagnostics.save(record);
      }
      this.last=record;
    }catch(error){
      this.error=String(error.message);
    }finally{this.running=false;this.onUpdate(this);}
  }
  setObserveOnly(value){
    if(this.config.observeOnly===value)return;
    this.generation++;this.config.observeOnly=value;this.commitment=null;this.last=null;this.resume();
  }
  clearCommitment(){this.generation++;this.commitment=null;this.last=null;this.onUpdate(this);}
  setClickRate(value){
    if(!Number.isInteger(value) || value<1 || value>100)throw new TypeError('クリック速度は1〜100の整数で指定してください');
    this.config.clickRate=value;this.clearCommitment();this.resume();
  }
  resume(){this.error=null;this.started=this.clock();this.clicks=[];this.nextClickAt=0;this.onUpdate(this);}
  shutdown(){if(this.stopped)return;this.stopped=true;for(const t of this.timers)clearInterval(t);this.timers=[];this.diagnostics.close();this.onUpdate(this);}
}

Object.assign(exports,{RUNTIME_KEY,Coordinator});
},
"src/core/planner.mjs":function(require,exports){
const { validateInput, clone, known, unknown, epsilon }=require("src/core/contracts.mjs");
const { income, allOffers, offerById, applyAction, advance, eta, effectDelta }=require("src/core/model.mjs");
const { unlockRoute }=require("src/core/unlocks.mjs");

const waitAction = (reason, seconds = null, targetId = null) => ({ id: 'wait', kind: 'wait', operation: 'waitUntil', targetId, price: 0, waitSeconds: seconds, reason });
const buyAction = o => ({ id: o.id, kind: o.kind, operation: o.kind === 'building' ? 'buyBuilding' : 'buyUpgrade', targetId: o.targetId, quantity: 1, price: o.price });
function values(s, rootElapsed, horizons, config) {
  return horizons.map(h => {
    const remaining = h - (s.elapsed - rootElapsed);
    if (remaining < 0) return null;
    const end = advance(s, remaining, config.maxEvents);
    return end.bank + end.deferred;
  });
}
function dominates(a, b) { return a.every((v,i) => v >= b[i] - epsilon(v,b[i])) && a.some((v,i) => v > b[i] + epsilon(v,b[i])); }
function plan(input) {
  validateInput(input);
  const s = clone(input.state), c = input.config;
  const warnings = [...s.modelWarnings];
  const offers = allOffers(s);
  const candidates = offers.map(o => {
    const d = effectDelta(s,o), seconds = o.eligible ? eta(s,o.price,c.maxEvents) : Infinity;
    return { ...o, affordable: o.eligible && seconds === 0, waitSeconds: known(seconds),
      deltaLiquidCps: d ? known(d.liquid) : unknown('effect-not-covered'),
      deltaClickCps: d ? known(d.click) : unknown('effect-not-covered'),
      deltaEconomicCps: d ? known(d.economic) : unknown('effect-not-covered'),
      paybackSeconds: d && d.economic > 0 ? known(o.price / d.economic) : unknown('no-positive-steady-gain'),
      sourceEvidence: o.evidence ?? [], simulationWarnings: o.warnings ?? [],
      confidence: o.confidence ?? (d ? 'medium' : 'unknown'), horizons: [] };
  });
  let commitment = clone(s.commitment);
  if (commitment && s.owned.includes(commitment.targetId)) commitment = null;
  const target = commitment ? offers.find(o => o.id === commitment.targetId) : null;
  const unlockBudget={remaining:c.maxUnlockNodes};
  const routes=offers.filter(o=>!o.eligible && !o.disabled && o.effect && !o.rootOnly && ((o.requiresBuildings?.length??0)+(o.requiresOwned?.length??0)>0))
    .sort((a,b)=>Number(b.id===commitment?.targetId)-Number(a.id===commitment?.targetId) || a.id.localeCompare(b.id,'en'))
    .map(o=>unlockRoute(s,o.id,c,unlockBudget));
  const targetRoute=target && !target.eligible?routes.find(r=>r.targetId===target.id):null;
  const finiteT = candidates.filter(o => o.eligible && o.waitSeconds.status === 'known' && o.paybackSeconds.status === 'known').map(o => o.waitSeconds.value + o.paybackSeconds.value);
  const horizons = [...c.horizons];
  if (finiteT.length) horizons[2] = Math.max(horizons[2], 4 * Math.min(...finiteT));
  if (target) {
    const d = effectDelta(s,target), t = eta(s,target.price,c.maxEvents);
    if (d?.economic > 0 && Number.isFinite(t)) horizons[2] = Math.max(horizons[2], 4 * (t + target.price / d.economic));
    if(targetRoute?.status==='known'){
      const gain=income(targetRoute.state).economic-income(s).economic;
      if(gain>0)horizons[2]=Math.max(horizons[2],4*(targetRoute.eta+targetRoute.cost/gain));
    }
  }
  horizons[1] = Math.max(horizons[1], horizons[2]/3);
  if (horizons.some(h => !Number.isFinite(h))) throw new Error('horizon-overflow');
  const baseline = values(s,s.elapsed,horizons,c);
  const score = v => v.reduce((sum,x,i) => sum + c.weights[i] * (x-baseline[i])/Math.max(1,Math.abs(baseline[i]),s.bank), 0);
  const record = { schemaVersion: 1, finalLayer: 'planner', horizons, strategyWeights: c.weights,
    allCandidates: candidates, frontier: [], expandedNodes: [], prunedReasons: [],
    selectedAction: waitAction('WAIT_EVENT'), nextCommitment: commitment, plannedSteps: [],
    targetEta: null, reasonCode: 'WAIT_EVENT', warnings,
    unlockPaths:[],singleStepNodes:[],comparison:{policy:'one-step-floor-for-partial-models',commonDepth:1,heldBack:[]},reservationReview:null,
    coverage:{unmodeledAffordable:candidates.filter(o=>o.affordable&&!o.effect&&!o.disabled).map(o=>o.id),
      unmodeled:candidates.filter(o=>!o.effect&&!o.disabled).map(o=>o.id),disabled:candidates.filter(o=>o.disabled).map(o=>o.id)} };
  function finish(action, reason, next = commitment) { record.selectedAction = action; record.reasonCode = reason; record.nextCommitment = next; return record; }
  if (s.pendingExecution) return finish(waitAction('WAIT_PENDING'), 'WAIT_PENDING');
  if(commitment && target?.eligible && target.effect && eta(s,target.price,c.maxEvents)===0)return finish(buyAction(target),'BUY_TARGET',{...commitment,status:'ready'});
  function pathValues(path){return horizons.map(h=>{
    let at=s;
    for(const step of path){if(step.at>h)break;at=advance(at,step.at-(at.elapsed-s.elapsed),c.maxEvents);at=applyAction(at,offerById(at,step.action.id));if(!at)throw new Error('invalid-simulation-path');}
    return values(at,s.elapsed,[h],c)[0];
  });}
  // Earlier horizons keep their parent's continuation value; only the new tail changes.
  function extendValues(parent,after){
    const continuation=values(after,s.elapsed,horizons,c);
    return continuation.map((v,i)=>v===null?parent.value[i]:v);
  }
  const root = { id: 0, state: s, path: [], value: baseline, score: 0 };
  const singles=[];
  for(const o of offers){
    if(!o.eligible || !o.effect)continue;
    const wait=eta(s,o.price,c.maxEvents);if(!Number.isFinite(wait) || wait>=horizons[2])continue;
    const ready=advance(s,wait,c.maxEvents),current=offerById(ready,o.id),after=applyAction(ready,current);if(!after)continue;
    const path=[{action:buyAction(current),at:after.elapsed-s.elapsed,wait}],value=extendValues(root,after);
    singles.push({id:-singles.length-1,state:after,path,value,score:score(value),terminalOnly:!!o.rootOnly});
  }
  const singleById=new Map(singles.map(n=>[n.path[0].action.id,n]));
  record.singleStepNodes=singles.map(n=>({id:n.id,actionId:n.path[0].action.id,at:n.path[0].at,value:n.value}));
  const partialFloor=Math.max(-Infinity,...singles.filter(n=>n.terminalOnly).map(n=>n.score));
  record.comparison.partialFloor=known(partialFloor);
  let beam = [root], terminals = [root,...singles], nodeId = 1;
  for (let depth = 0; depth < c.depth && beam.length; depth++) {
    const nextLevel = [];
    for (const node of beam) {
      if (node.terminalOnly) continue;
      for (const o of allOffers(node.state)) {
        if (!o.eligible || !o.effect || (o.rootOnly && depth > 0)) continue;
        if (nodeId > c.maxNodes) { warnings.push('node-budget'); break; }
        const wait = eta(node.state,o.price,c.maxEvents);
        if (!Number.isFinite(wait) || node.state.elapsed - s.elapsed + wait >= horizons[2]) continue;
        const ready = advance(node.state,wait,c.maxEvents);
        const currentOffer = offerById(ready,o.id);
        const after = applyAction(ready,currentOffer);
        if (!after) continue;
        const path = [...node.path,{ action: buyAction(currentOffer), at: after.elapsed - s.elapsed, wait }];
        const v = extendValues(node,after);
        const next = { id: nodeId++, state: after, path, value: v, score: score(v), terminalOnly:!!o.rootOnly };
        nextLevel.push(next); terminals.push(next);
        record.expandedNodes.push({ id:next.id,parentId:node.id,actionId:o.id,at:after.elapsed-s.elapsed,value:v });
      }
      if (nodeId > c.maxNodes) break;
    }
    const remaining = nextLevel.filter(n => !nextLevel.some(other => other !== n && dominates(other.value,n.value) && other.state.elapsed <= n.state.elapsed && other.path[0].action.id === n.path[0].action.id));
    // Preserve first-action and horizon diversity; no Upgrade-only slot or price ordering.
    const selected = [], used = new Set();
    const groups = horizons.map((_,i) => [...remaining].sort((a,b) => b.value[i]-a.value[i] || a.id-b.id));
    for (let rank = 0; selected.length < c.beamWidth && rank < remaining.length; rank++) {
      for (const group of groups) { const n = group[rank]; if (n && !used.has(n.id) && selected.length < c.beamWidth) { selected.push(n); used.add(n.id); } }
    }
    for (const n of nextLevel) if (!used.has(n.id)) record.prunedReasons.push({ nodeId:n.id,reason:'beam-budget-or-dominance' });
    beam = selected;
    if (nodeId > c.maxNodes) { if(!warnings.includes('node-budget'))warnings.push('node-budget'); break; }
  }
  for(const route of routes){
    const entry={targetId:route.targetId,status:route.status,reason:route.reason??null,totalCost:route.cost,eta:route.eta,steps:route.path};record.unlockPaths.push(entry);
    if(route.status!=='known' || route.eta>=horizons[2])continue;
    const value=pathValues(route.path);entry.value=value;
    if(route.path.length>c.depth){entry.nodeId=nodeId;terminals.push({id:nodeId++,state:route.state,path:route.path,value,score:score(value),goalId:route.targetId});}
  }
  const comparable=terminals.filter(n=>{
    if(n.path.length<=1 || !Number.isFinite(partialFloor))return true;
    const one=singleById.get(n.path[0].action.id);
    const allowed=one && one.score>=partialFloor-epsilon(one.score,partialFloor);
    if(!allowed)record.comparison.heldBack.push({nodeId:n.id,actionId:n.path[0].action.id,reason:'unequal-model-coverage'});
    return allowed;
  });
  const frontier = comparable.filter(n => !comparable.some(other => other !== n && dominates(other.value,n.value)));
  record.frontier = frontier.map(n => n.id);
  for (const candidate of candidates) {
    const matching = terminals.filter(n => n.path[0]?.action.id === candidate.id);
    matching.sort((a,b) => b.score-a.score || a.id-b.id);
    candidate.horizons = (matching[0]?.value ?? []).map((value,i) => ({ seconds:horizons[i],objectiveValue:value }));
    const one=singleById.get(candidate.id);
    candidate.oneStepHorizons=(one?.value??[]).map((value,i)=>({seconds:horizons[i],objectiveValue:value}));
    candidate.additionalValue=one && matching.length?matching[0].value.map((v,i)=>v-one.value[i]):[];
  }
  frontier.sort((a,b) => {
    if (Math.abs(a.score-b.score) > epsilon(a.score,b.score)) return b.score-a.score;
    return (a.path[0]?.action.price ?? 0)-(b.path[0]?.action.price ?? 0) || (a.path[0]?.action.id ?? 'wait').localeCompare(b.path[0]?.action.id ?? 'wait');
  });
  const best = frontier[0] ?? root;
  if(commitment){
    if(!target || !target.effect || (!target.eligible && targetRoute?.status!=='known'))return finish(waitAction('WAIT_TARGET_UNAVAILABLE',null,commitment.targetId),'WAIT_TARGET_UNAVAILABLE',{...commitment,status:'blocked'});
    const direct=target.eligible?eta(s,target.price,c.maxEvents):targetRoute.eta;
    const incumbent=target.eligible?singleById.get(target.id):{score:score(pathValues(targetRoute.path))};
    const challengerId=best.goalId??best.path[0]?.action.id;
    const challenger=best.goalId?best:singleById.get(challengerId);
    const cooldown=Math.max(0,(commitment.cooldown??0)-1);
    const improvement=challenger && incumbent?challenger.score-incumbent.score:null;
    const required=incumbent?Math.max(c.switchAbsolute,Math.abs(incumbent.score)*c.switchMargin):null;
    const qualifies=!!challengerId && challengerId!==target.id && improvement!==null && improvement>required && !(commitment.cooldown>0);
    const count=qualifies?(commitment.challengerId===challengerId?(commitment.challengerCount??0)+1:1):0;
    const switched=count>=c.switchConfirmations;
    record.reservationReview={oldTarget:target.id,challengerId:challengerId??null,improvement,required,confirmations:count,cooldown,switched,basis:best.goalId || !target.eligible?'complete-unlock-route':'one-step'};
    if(switched){commitment={targetId:challengerId,status:'saving',cooldown:c.switchCooldown,challengerCount:0};}
    else{
      commitment={...commitment,cooldown,challengerId:qualifies?challengerId:null,challengerCount:count};
      const viaBudget={remaining:c.maxUnlockNodes};
      const vias=offers.filter(o=>o.id!==target.id && o.eligible && o.effect && !o.rootOnly && eta(s,o.price,c.maxEvents)===0).map(o=>{
        const next=applyAction(s,o),afterTarget=allOffers(next).find(x=>x.id===target.id);
        const route=afterTarget && !afterTarget.eligible?unlockRoute(next,target.id,c,viaBudget):null;
        const seconds=afterTarget?.eligible?eta(next,afterTarget.price,c.maxEvents):route?.status==='known'?route.eta:Infinity;
        return {actionId:o.id,seconds:known(seconds)};
      });
      record.targetEta={targetId:target.id,direct:known(direct),via:vias};
      const better=vias.filter(v=>v.seconds.status==='known' && (!Number.isFinite(direct) || v.seconds.value<direct-Math.max(1/input.environment.fps,epsilon(direct,v.seconds.value))));
      better.sort((a,b)=>a.seconds.value-b.seconds.value || a.actionId.localeCompare(b.actionId));
      if(better.length)return finish(buyAction(offers.find(o=>o.id===better[0].actionId)),'BUY_ADVANCES_TARGET',{...commitment,status:'saving'});
      if(!target.eligible){
        record.plannedSteps=targetRoute.path;const first=targetRoute.path[0];
        return first.wait>0?finish(waitAction('WAIT_UNLOCK_PREREQUISITE',first.wait,first.action.id),'WAIT_UNLOCK_PREREQUISITE',commitment):finish(first.action,'BUY_UNLOCK_PREREQUISITE',commitment);
      }
      return finish(waitAction('WAIT_TARGET',Number.isFinite(direct)?direct:null,target.id),'WAIT_TARGET',{...commitment,status:Number.isFinite(direct)?'saving':'blocked'});
    }
  }
  record.plannedSteps = best.path;
  record.objectiveComponents = best.value;
  if (!best.path.length) {
    const reason=record.coverage.unmodeledAffordable.length?'WAIT_UNKNOWN_EFFECT':'WAIT_NO_PROFITABLE_PLAN';
    return finish(waitAction(reason),reason);
  }
  const first = best.path[0];
  if(best.goalId || record.reservationReview?.switched){
    const next={...(record.reservationReview?.switched?commitment:{}),targetId:best.goalId??first.action.id,status:'saving'};
    return first.wait>0?finish(waitAction('WAIT_TARGET',first.wait,first.action.id),'WAIT_TARGET',next):finish(first.action,best.goalId?'BUY_UNLOCK_PREREQUISITE':'BUY_BEST_PLAN',next);
  }
  if (first.wait > 0) return finish(waitAction('WAIT_TARGET',first.wait,first.action.id),'WAIT_TARGET',{targetId:first.action.id,status:'saving'});
  return finish(first.action,'BUY_BEST_PLAN',null);
}

Object.assign(exports,{plan});
},
"src/core/unlocks.mjs":function(require,exports){
const { clone }=require("src/core/contracts.mjs");
const { offerById,applyAction,advance,eta,eligible }=require("src/core/model.mjs");

// Simulate the complete dependency cost without external side effects.
function unlockRoute(initial,targetId,config,budget={remaining:256}){
  let state=clone(initial),cost=0,limited=false;
  const path=[],visiting=new Set();
  function buy(id){
    if(path.length>=config.maxUnlockSteps || budget.remaining<=0)throw new Error('unlock-budget');
    let offer=offerById(state,id);
    if(!offer || !offer.eligible || !offer.effect || offer.disabled)throw new Error('unavailable-prerequisite');
    if(limited || (offer.rootOnly && path.length))throw new Error('unsupported-child-model');
    for(let n=0;n<config.maxEvents;n++){
      const delay=eta(state,offer.price,config.maxEvents);
      if(!Number.isFinite(delay))throw new Error('unreachable');
      state=advance(state,delay,config.maxEvents);
      offer=offerById(state,id);
      const after=applyAction(state,offer);
      if(after){
        budget.remaining--;cost+=offer.price;state=after;limited=!!offer.rootOnly;
        const at=state.elapsed-initial.elapsed;
        path.push({action:{id:offer.id,kind:offer.kind,operation:offer.kind==='building'?'buyBuilding':'buyUpgrade',targetId:offer.targetId,quantity:1,price:offer.price},at,wait:at-(path.at(-1)?.at??0)});return;
      }
      if(!offer?.eligible)throw new Error('unavailable-prerequisite');
    }
    throw new Error('event-budget');
  }
  function acquire(id){
    if(state.owned.includes(id))return;
    if(visiting.has(id))throw new Error('dependency-cycle');
    if(visiting.size>=config.maxUnlockSteps)throw new Error('unlock-budget');
    const offer=offerById(state,id);
    if(!offer || offer.disabled || !offer.effect)throw new Error('unknown-prerequisite');
    visiting.add(id);
    for(const required of offer.requiresOwned??[])acquire(required);
    for(const requirement of offer.requiresBuildings??[]){
      const building=state.buildings.find(b=>b.id===requirement.id);
      if(!building || building.disabled)throw new Error('unavailable-building');
      while(state.buildings.find(b=>b.id===requirement.id).amount<requirement.amount)buy('building:'+requirement.id);
    }
    if(offer.availableAt>state.elapsed){if(limited)throw new Error('unsupported-child-model');state=advance(state,offer.availableAt-state.elapsed,config.maxEvents);}
    if(!eligible(state,offer))throw new Error('unavailable-prerequisite');
    buy(id);visiting.delete(id);
  }
  try{acquire(targetId);return {targetId,status:'known',state,path,cost,eta:state.elapsed-initial.elapsed};}
  catch(error){return {targetId,status:'unavailable',reason:error.message,path:[],cost:null,eta:null};}
}

Object.assign(exports,{unlockRoute});
},
"src/runtime/executor.mjs":function(require,exports){
const { epsilon }=require("src/core/contracts.mjs");

class Executor {
  constructor(adapter, ownsToken, clock = () => Date.now()) { this.adapter=adapter;this.ownsToken=ownsToken;this.clock=clock;this.pending=null;this.seen=new Set(); }
  execute(decision,input,cycleId) {
    const action=decision.selectedAction;
    const receipt={cycleId,actionId:action.id,attemptCount:0,status:'skipped',before:null,after:null,exception:null};
    if (this.pending) return {...receipt,status:'pending'};
    if (this.seen.has(cycleId)) return {...receipt,status:'duplicate-cycle'};
    this.seen.add(cycleId); if(this.seen.size>1000)this.seen.delete(this.seen.values().next().value);
    if(action.kind==='wait')return receipt;
    try {
      if(!this.ownsToken())return {...receipt,status:'stale-token'};
      const a=this.adapter,bank=a.game.cookies;
      if(!a.playable() || (input.observation && a.signature()!==input.observation.signature))return {...receipt,status:'stale'};
      if(!a.available(action))return {...receipt,status:'not-in-store'};
      const price=a.price(action.kind,action.targetId);
      if(Math.abs(price-action.price)>epsilon(price,action.price) || bank < input.state.bank-epsilon(bank,input.state.bank) || bank < price+input.state.reserve)return {...receipt,status:'stale'};
      receipt.before={marker:a.marker(action),bank};
      if(action.kind==='upgrade' && receipt.before.marker)return {...receipt,status:'already-owned'};
      if(!this.ownsToken())return {...receipt,status:'stale-token'};
      receipt.attemptCount=1;
      const result=a.execute(action);
      receipt.apiResult=typeof result==='boolean'?result:null;
      receipt.after={marker:a.marker(action),bank:a.game.cookies};
      if(receipt.after.marker>receipt.before.marker)receipt.status='confirmed';
      else if(result===false)receipt.status='rejected';
      else {receipt.status='pending';this.pending={action,before:receipt.before,at:this.clock(),receipt};}
    } catch(error) {receipt.status='exception';receipt.exception=String(error.message);}
    return receipt;
  }
  poll() {
    if(!this.pending)return null;
    const p=this.pending;
    if(!this.ownsToken()){this.pending=null;return {...p.receipt,status:'stale-token'};}
    if(this.adapter.marker(p.action)>p.before.marker) {this.pending=null;return {...p.receipt,status:'confirmed',after:{marker:this.adapter.marker(p.action),bank:this.adapter.game.cookies}};}
    if(this.clock()-p.at>2000){this.pending=null;return {...p.receipt,status:'unresolved'};}
    return {...p.receipt,status:'pending'};
  }
}

Object.assign(exports,{Executor});
},
"src/runtime/diagnostics.mjs":function(require,exports){
const { canonical, clone, assertJson, ENGINE_VERSION, RULESET_VERSION }=require("src/core/contracts.mjs");
const { plan }=require("src/core/planner.mjs");

async function hash(value) {
  const bytes=new TextEncoder().encode(canonical(value));
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function bundle(input,decision,cycleId) {
  assertJson(input);assertJson(decision);
  const semantic=clone(input);
  delete semantic.environment.language;delete semantic.environment.observedAt;
  for(const o of semantic.state.offers){delete o.internalName;delete o.displayName;}
  return {schemaVersion:1,cycleId,input:clone(input),decision:clone(decision),receipt:null,
    inputHash:await hash(input),semanticHash:await hash(semantic),captureStatus:'complete',
    createdAt:new Date().toISOString()};
}
async function replay(snapshot) {
  assertJson(snapshot);
  if(snapshot.schemaVersion!==1 || snapshot.input.engineVersion!==ENGINE_VERSION || snapshot.input.rulesetVersion!==RULESET_VERSION)throw new Error('VersionMismatch');
  if(snapshot.inputHash!==await hash(snapshot.input))throw new Error('InputChecksumMismatch');
  const actual=plan(snapshot.input);
  return {matches:canonical(actual)===canonical(snapshot.decision),decision:actual};
}
class Diagnostics {
  constructor({limit=100,persist=false,indexedDB=globalThis.indexedDB}={}){this.limit=limit;this.persist=persist;this.indexedDB=indexedDB;this.records=[];this.db=null;}
  async open(){
    if(!this.persist)return;
    if(!this.indexedDB)throw new Error('IndexedDBUnavailable');
    this.db=await new Promise((resolve,reject)=>{const r=this.indexedDB.open('CC_REBUILD_DIAGNOSTICS_V1',1);r.onupgradeneeded=()=>r.result.createObjectStore('cycles',{keyPath:'cycleId'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  }
  async save(record){
    const saved=clone(record);assertJson(saved);
    if(this.persist){
      if(!this.db)throw new Error('DiagnosticsNotOpen');
      await new Promise((resolve,reject)=>{const tx=this.db.transaction('cycles','readwrite');tx.objectStore('cycles').put(saved);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('DiagnosticsAborted'));});
    }
    const index=this.records.findIndex(x=>x.cycleId===saved.cycleId);
    if(index>=0)this.records[index]=saved;else this.records.push(saved);
    if(this.records.length>this.limit)this.records.shift();
  }
  latest(){return this.records.length?clone(this.records.at(-1)):null;}
  async exportAll(){
    if(!this.persist)return clone(this.records);
    return new Promise((resolve,reject)=>{const r=this.db.transaction('cycles').objectStore('cycles').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  }
  close(){this.db?.close();}
}

Object.assign(exports,{hash,bundle,replay,Diagnostics});
},
"src/ui/panel.mjs":function(require,exports){
const { attachPanelLayout }=require("src/ui/panel-layout.mjs");
const { coverageLines }=require("src/ui/coverage.mjs");
function mountPanel(runtime,document){
  document.getElementById('cc-rebuild-panel')?.remove();
  const root=document.createElement('section');root.id='cc-rebuild-panel';
  root.style.cssText='position:fixed;left:12px;top:60px;z-index:1000000;box-sizing:border-box;width:368px;min-width:240px;min-height:180px;max-width:100vw;max-height:100vh;resize:both;overflow:auto;background:#161d28;color:#fff;border:1px solid #63758e;border-radius:10px;padding:14px;font:13px/1.6 sans-serif;box-shadow:0 4px 20px #0008';
  const title=document.createElement('strong');title.textContent='Cookie Auto '+runtime.version;
  title.style.cssText='display:block;position:sticky;top:0;background:#161d28;cursor:move;touch-action:none;user-select:none;padding:4px 0';
  title.title='ドラッグまたは矢印キーで移動';
  const header=document.createElement('div');header.style.cssText='display:flex;align-items:center;gap:8px';title.style.flex='1';header.append(title);root.append(header);
  const collapse=document.createElement('button');header.append(collapse);
  const body=document.createElement('div');root.append(body);
  const hint=document.createElement('small');hint.textContent='上部で移動 · 右下でサイズ変更（位置とサイズは保存）';body.append(hint);
  const status=document.createElement('pre');status.style.cssText='white-space:pre-wrap;font:inherit';status.setAttribute('role','status');body.append(status);
  const unsupported=document.createElement('details');body.append(unsupported);
  const unsupportedTitle=document.createElement('summary');unsupported.append(unsupportedTitle);
  const unsupportedText=document.createElement('pre');unsupportedText.style.cssText='white-space:pre-wrap;font:inherit';unsupported.append(unsupportedText);
  const controls=document.createElement('div');body.append(controls);
  function button(label,handler){const b=document.createElement('button');b.textContent=label;b.style.cssText='margin:3px;padding:4px 7px;cursor:pointer';b.onclick=handler;controls.append(b);return b;}
  const mode=button('自動化を開始',()=>{runtime.setObserveOnly(!runtime.config.observeOnly);runtime.tick();render();});
  button('診断JSON',async()=>{try{const records=await runtime.diagnostics.exportAll();const blob=new Blob([JSON.stringify(records,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='cookie-auto-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){runtime.error=e.message;render();}});
  button('再観測',()=>{runtime.resume();runtime.tick();});
  button('予約解除',()=>{runtime.clearCommitment();runtime.tick();});
  button('停止',()=>runtime.shutdown());
  button('位置を戻す',()=>{layout.reset();render();});
  const settings=document.createElement('label');settings.textContent='クリック目標（回/秒） ';body.append(settings);
  const rate=document.createElement('input');rate.type='number';rate.min='1';rate.max='100';rate.step='1';rate.value=String(runtime.config.clickRate);rate.style.cssText='width:65px;margin:8px 0';settings.append(rate);
  rate.onchange=()=>{const value=Number(rate.value);if(!Number.isInteger(value)||value<1||value>100){rate.setCustomValidity('1〜100の整数を入力してください');rate.reportValidity();return;}rate.setCustomValidity('');runtime.setClickRate(value);runtime.tick();};
  const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='候補と判断の詳細';details.append(summary);
  const text=document.createElement('pre');text.style.cssText='white-space:pre-wrap;font-size:11px';details.append(text);body.append(details);
  let renderedDecision=null;
  details.ontoggle=()=>render();
  function render(){
    const d=runtime.last?.decision;
    const reasons={WAIT_TARGET:'購入資金を貯めています',BUY_TARGET:'予約対象を購入',BUY_BEST_PLAN:'成長効率を比較して購入',BUY_ADVANCES_TARGET:'目標への到達を早める購入',BUY_UNLOCK_PREREQUISITE:'強化の解禁に必要な施設・前提を購入',WAIT_UNLOCK_PREREQUISITE:'強化の解禁に必要な資金を貯めています',WAIT_EVENT:'次の変化を待っています',WAIT_NO_PROFITABLE_PLAN:'評価済み候補では購入より待機が有利です',WAIT_UNKNOWN_EFFECT:'評価済み候補では待機が有利です（購入可能な未評価候補あり）',WAIT_TARGET_UNAVAILABLE:'予約対象を再確認中',WAIT_PENDING:'購入結果を確認中'};
    const target=runtime.commitment?.targetId;
    const candidate=d?.allCandidates.find(c=>c.id===(target??d.selectedAction.id));
    const name=candidate?.displayName ?? (candidate?.kind==='building'?'施設 '+candidate.targetId:(target??'なし'));
    const eta=d?.targetEta?.direct;
    const unsupportedLines=coverageLines(d);unsupported.hidden=unsupportedLines.length===0;
    unsupportedTitle.textContent=`未評価・購入対象外の強化（${unsupportedLines.length}件）`;
    unsupportedText.textContent=unsupportedLines.join('\n');
    if(d?.reasonCode==='WAIT_UNKNOWN_EFFECT')unsupported.open=true;
    status.textContent=`${runtime.stopped?'停止':runtime.config.observeOnly?'観測モード（購入・クリックなし）':'自動化中'}\n${runtime.error?'診断：'+runtime.error:d?(reasons[d.reasonCode]??d.reasonCode):'ゲーム状態を確認中'}\n対象：${name}${eta?.status==='known'?'（約'+Math.ceil(eta.value)+'秒）':''}\n実クリック：約${runtime.measuredClickRate().toFixed(1)}回/秒 ／ 目標${runtime.config.clickRate}\n基本購入版：ミニゲーム自動操作は未対応`;
    if(details.open && renderedDecision!==d){text.textContent=d?JSON.stringify({horizons:d.horizons,plan:d.plannedSteps,targetEta:d.targetEta,reservationReview:d.reservationReview,comparison:d.comparison,unlockPaths:d.unlockPaths,candidates:d.allCandidates,warnings:d.warnings,timings:runtime.last?.timings},null,2):'';renderedDecision=d;}
    mode.textContent=runtime.config.observeOnly?'自動化を開始':'観測モードへ';mode.disabled=runtime.stopped;
    collapse.textContent=layout.collapsed()?'展開':'折りたたむ';collapse.setAttribute('aria-expanded',String(!layout.collapsed()));
  }
  document.body.append(root);
  const layout=attachPanelLayout(root,title,body,document);collapse.onclick=()=>{layout.toggle();render();};
  const previous=runtime.onUpdate;runtime.onUpdate=r=>{previous(r);if(runtime.stopped){layout.destroy();root.remove();}else render();};
  render();return {root,render};
}

Object.assign(exports,{mountPanel});
},
"src/ui/panel-layout.mjs":function(require,exports){
const KEY='CC_REBUILD_PANEL_V1';
function attachPanelLayout(root,handle,body,document){
  const view=document.defaultView;
  let state={left:12,top:60,width:368,height:null,collapsed:false},drag=null,timer=null;
  try{const saved=JSON.parse(view.localStorage.getItem(KEY));if(saved){for(const key of ['left','top','width','height'])if(Number.isFinite(saved[key])&&saved[key]>=0)state[key]=saved[key];state.collapsed=saved.collapsed===true;}}catch{}
  function persist(){try{view.localStorage.setItem(KEY,JSON.stringify(state));}catch{}}
  function apply(){
    state.width=Math.min(view.innerWidth,Math.max(240,state.width));
    state.left=Math.max(0,Math.min(view.innerWidth-state.width,state.left));
    state.top=Math.max(0,Math.min(Math.max(0,view.innerHeight-100),state.top));
    root.style.left=state.left+'px';root.style.top=state.top+'px';root.style.width=state.width+'px';
    root.style.maxHeight=Math.max(40,view.innerHeight-state.top)+'px';
    root.style.minWidth=Math.min(240,view.innerWidth)+'px';
    root.style.minHeight=state.collapsed?'0':Math.min(180,view.innerHeight-state.top)+'px';
    root.style.height=state.collapsed || state.height===null?'auto':Math.min(state.height,view.innerHeight-state.top)+'px';
    root.style.resize=state.collapsed?'none':'both';body.hidden=state.collapsed;
  }
  function capture(){const box=root.getBoundingClientRect();state.left=box.left;state.top=box.top;state.width=box.width;if(!state.collapsed)state.height=box.height;persist();}
  handle.onpointerdown=e=>{if(e.button!==0)return;const box=root.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX-box.left,y:e.clientY-box.top};handle.setPointerCapture(e.pointerId);e.preventDefault();};
  handle.onpointermove=e=>{if(!drag || drag.id!==e.pointerId)return;state.left=e.clientX-drag.x;state.top=e.clientY-drag.y;apply();};
  handle.onpointerup=handle.onpointercancel=()=>{drag=null;capture();};
  handle.onlostpointercapture=()=>{drag=null;};
  handle.tabIndex=0;handle.setAttribute('aria-label','パネルを移動。矢印キーでも移動できます');
  handle.onkeydown=e=>{const delta={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]}[e.key];if(!delta)return;e.preventDefault();state.left+=delta[0];state.top+=delta[1];apply();persist();};
  const onResize=()=>{apply();persist();};view.addEventListener('resize',onResize);
  const observer=typeof view.ResizeObserver==='function'?new view.ResizeObserver(()=>{view.clearTimeout(timer);timer=view.setTimeout(capture,200);}):null;
  apply();observer?.observe(root);
  return {
    collapsed:()=>state.collapsed,
    toggle(){if(!state.collapsed)capture();state.collapsed=!state.collapsed;apply();persist();},
    reset(){state={left:12,top:60,width:368,height:null,collapsed:false};apply();persist();},
    destroy(){observer?.disconnect();view.clearTimeout(timer);view.removeEventListener('resize',onResize);}
  };
}

Object.assign(exports,{attachPanelLayout});
},
"src/ui/coverage.mjs":function(require,exports){
function coverageLines(decision){
  if(!decision)return [];
  return decision.allCandidates.filter(o=>o.kind==='upgrade' && (o.disabled || !o.effect))
    .sort((a,b)=>Number(b.affordable)-Number(a.affordable)||Number(a.disabled)-Number(b.disabled))
    .map(o=>{
    const name=o.displayName??o.internalName??o.id;
    const reason=o.disabled?'購入対象外：特殊操作・購入条件が未対応':o.affordable?'購入可能ですが、間接効果をまだ評価できません':o.eligible?'資金待ち・効果未評価':'未解禁・効果未評価';
    return `${name} — ${reason}`;
  });
}

Object.assign(exports,{coverageLines});
}
};const cache={};function require(id){if(!cache[id]){cache[id]={};factories[id](require,cache[id]);}return cache[id];}require("src/runtime/browser.mjs");})();
