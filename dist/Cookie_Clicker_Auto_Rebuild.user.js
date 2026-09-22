// ==UserScript==
// @name Cookie Clicker Auto Rebuild
// @namespace cc-smart-auto
// @version 9.0.0-alpha.2
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

const finite = (n,label) => { if (!Number.isFinite(n)) throw new Error('invalid-' + label); return n; };
const collection = value => Object.values(value || {}).filter(Boolean);
const objects = g => [g, g.ObjectsById, g.UpgradesById, g.AchievementsById, g.UpgradesInStore,
  g.buffs, g.effs, g.cookiesPsByType, g.cookiesMultByType, g.cookieUpgrades, g.wrinklers, ...collection(g.ObjectsById), ...collection(g.UpgradesById),
  ...collection(g.AchievementsById), ...Object.values(g.buffs || {}), ...collection(g.wrinklers)];
// Audited CalculateGains 2.058 writes root caches, these two maps and building caches.
// Win/Unlock are disabled during measurement; only the explicitly changed upgrade is writable.
const gainsObjects=(g,touched)=>[g,g.cookiesPsByType,g.cookiesMultByType,...collection(g.ObjectsById),...touched];

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
  measure(change, touched = null) {
    if (this.busy || this.fault) throw new Error(this.fault || 'adapter-busy');
    this.audit();
    const g = this.game, journal = new Journal(touched===null?objects(g):gainsObjects(g,touched));
    this.busy = true;
    try {
      g.Win = () => {}; g.Unlock = () => {};
      // The gains pass mutates caches; all root primitives and entity descriptors are journaled.
      change(g);
      g.CalculateGains();
      return { passive: finite(g.cookiesPs,'passive'), mouse: finite(g.mouseCps(),'mouse'),
        global: finite(g.globalCpsMult ?? 1,'multiplier') };
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
    const steady = this.measure(x => { x.buffs = {}; }, []);
    // Derive CpS-linked mouse contribution from the live formula, without invoking a click.
    const journal = new Journal(gainsObjects(g,[]));
    let fraction;
    try {
      g.buffs = {}; g.CalculateGains();
      const base = g.cookiesPs, mouse = g.mouseCps(), step = Math.max(1,Math.abs(base));
      g.cookiesPs = base + step;
      fraction = Math.max(0,(g.mouseCps() - mouse) / step);
    } finally { try { journal.restore(); } catch (e) { this.fault = 'reload-required:' + e.message; throw e; } }
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
    const offers = collection(g.UpgradesById).filter(u => !u.bought && (offered.has(u.id) || u.id <= 2)).map(u => {
      const price = this.price('upgrade',u.id);
      const disallowed = ['prestige','debug','toggle'].includes(u.pool) || Boolean(u.buyFunction) || Boolean(u.toggleInto) || Boolean(u.ask);
      const measured = this.measure(x => { x.buffs={}; u.bought=1; if (x.CountsAsUpgradeOwned?.(u.pool)) x.UpgradesOwned++; }, [u]);
      const passiveDelta = measured.passive-steady.passive, mouseDelta = measured.mouse-steady.mouse;
      let effect = null, rootOnly = true, confidence = 'unknown';
      if (u.id <= 2) { effect={buildingMultipliers:[{id:0,multiplier:2}],clickMultiplier:2}; rootOnly=false; confidence='high'; }
      else if (u.buildingTie && u.tier != null && !u.buildingTie1 && passiveDelta > 0) {
        const b = buildings.find(b => b.id === u.buildingTie.id);
        if (b && b.amount*b.unitCps > 0) {
          effect={buildingMultipliers:[{id:b.id,multiplier:1+passiveDelta/(b.amount*b.unitCps)}]}; confidence='medium'; rootOnly=false;
          if (Math.abs(mouseDelta-fraction*passiveDelta)>Math.max(1e-8,Math.abs(mouseDelta)*1e-6)) rootOnly=true;
        }
      }
      if (effect && !rootOnly) {
        const prediction=effectDelta({passive:steady.passive-buildings.reduce((n,b)=>n+b.amount*b.unitCps,0),buildings,
          buffs:[],clickUnit:steady.mouse-fraction*steady.passive,clickFraction:fraction,nonCursorClick:0,clickRate:1}, {effect});
        const agrees=(a,b)=>Math.abs(a-b)<=Math.max(1e-8,Math.abs(b)*1e-6);
        if(!agrees(prediction.click,mouseDelta) || !agrees(prediction.liquid-prediction.click,passiveDelta))rootOnly=true;
      }
      if (!effect || rootOnly) {
        if (passiveDelta !== 0 || mouseDelta !== 0) { effect={flatPassive:passiveDelta,flatClick:mouseDelta-fraction*passiveDelta}; confidence='medium'; }
      }
      const available = offered.has(u.id);
      return {id:'upgrade:'+u.id,kind:'upgrade',targetId:u.id,price,effect,rootOnly,confidence,
        internalName:u.name,displayName:u.dname ?? u.name,pool:u.pool ?? '',
        disabled:disallowed || (!available && u.id>2),
        requiresBuildings:u.id<=2 ? [{id:0,amount:u.id===2 ? 10 : 1}] : [],
        evidence:[{source:'Game.CalculateGains',coverage:u.buyFunction?'bought-only':'production',passiveDelta,mouseDelta}],
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
  click() {
    if (this.busy || !this.playable()) return false;
    const g=this.game,before=g.cookieClicks;
    g.ClickCookie(); return g.cookieClicks>before;
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
const ENGINE_VERSION = '9.0.0-alpha.1';
const RULESET_VERSION = 'cc-web-2.058/basic-1';
const DEFAULT_CONFIG = Object.freeze({
  horizons: [60, 300, 900], weights: [0.2, 0.35, 0.45],
  depth: 3, beamWidth: 24, maxNodes: 1024, maxEvents: 4096,
  clickRate: 20, purchaseIntervalMs: 1500, riskWeight: 0.1,
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
  if (c.horizons.length !== 3 || c.weights.length !== 3 || c.horizons.some((h, i) => h <= 0 || (i && h <= c.horizons[i - 1])) || c.weights.some(w => w < 0) || c.weights.reduce((a,b) => a+b,0) <= 0) throw new TypeError('invalid horizons/weights');
  const ids = new Set();
  for (const b of s.buildings) {
    if (!Number.isInteger(b.id) || ids.has('building:' + b.id) || b.amount < 0 || !Number.isInteger(b.amount) || b.unitCps < 0 || b.nextPrice < 0) throw new TypeError('invalid building');
    ids.add('building:' + b.id);
  }
  for (const o of s.offers) {
    if (ids.has(o.id) || typeof o.id !== 'string' || (o.price !== null && (typeof o.price !== 'number' || o.price < 0))) throw new TypeError('invalid offer');
    ids.add(o.id);
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
  if (e.priceMultiplier != null) {
    for (const b of s.buildings) { b.nextPrice = Math.ceil(b.nextPrice * e.priceMultiplier); b.unroundedNextPrice = (b.unroundedNextPrice ?? b.nextPrice / e.priceMultiplier) * e.priceMultiplier; }
    for (const o of s.offers) if (o.price !== null) o.price *= e.priceMultiplier;
  }
  if (e.reward) { s.bank += e.reward; s.earned += e.reward; }
  if (e.buff) s.buffs.push(clone(e.buff));
}
function applyAction(state, offer) {
  const s = clone(state);
  if (!offer?.effect || !offer.eligible || s.bank + epsilon(s.bank, offer.price) < offer.price + s.reserve) return null;
  s.bank = Math.max(0, s.bank - offer.price);
  applyEffect(s, offer.effect);
  if (offer.kind !== 'building' || offer.effect.building == null) s.owned.push(offer.id);
  return s;
}
function advance(state, seconds, maxEvents = 4096) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new TypeError('invalid duration');
  const s = clone(state);
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
  const before = income(s), after = clone(s);
  applyEffect(after, offer.effect);
  const out = income(after);
  return { liquid: out.liquid - before.liquid, click: out.click - before.click, economic: out.economic - before.economic };
}

Object.assign(exports,{income,buildingPrice,eligible,allOffers,applyEffect,applyAction,advance,eta,effectDelta});
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
    this.clock=clock;this.onUpdate=onUpdate;this.version='9.0.0-alpha.2';this.generation=0;
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
      this.timers.push(setInterval(()=>this.clickTick(),Math.max(20,1000/Math.max(1,this.config.clickRate))));
      this.timers.push(setInterval(()=>this.collectTick(),150));
    }
    this.onUpdate(this);
  }
  clickRate(){const now=this.clock();this.clicks=this.clicks.filter(t=>now-t<=5000);return now-this.started<5000?this.config.clickRate:this.clicks.length/5;}
  clickTick(){if(!this.owns() || this.config.observeOnly || !this.config.autoClick || this.error)return;try{if(this.adapter.click())this.clicks.push(this.clock());}catch(e){this.error=e.message;this.onUpdate(this);}}
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
  resume(){this.error=null;this.started=this.clock();this.clicks=[];this.onUpdate(this);}
  shutdown(){if(this.stopped)return;this.stopped=true;for(const t of this.timers)clearInterval(t);this.timers=[];this.diagnostics.close();this.onUpdate(this);}
}

Object.assign(exports,{RUNTIME_KEY,Coordinator});
},
"src/core/planner.mjs":function(require,exports){
const { validateInput, clone, known, unknown, epsilon }=require("src/core/contracts.mjs");
const { income, allOffers, applyAction, advance, eta, effectDelta }=require("src/core/model.mjs");

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
  const finiteT = candidates.filter(o => o.eligible && o.waitSeconds.status === 'known' && o.paybackSeconds.status === 'known').map(o => o.waitSeconds.value + o.paybackSeconds.value);
  const horizons = [...c.horizons];
  if (finiteT.length) horizons[2] = Math.max(horizons[2], 4 * Math.min(...finiteT));
  if (target) {
    const d = effectDelta(s,target), t = eta(s,target.price,c.maxEvents);
    if (d?.economic > 0 && Number.isFinite(t)) horizons[2] = Math.max(horizons[2], 4 * (t + target.price / d.economic));
  }
  horizons[1] = Math.max(horizons[1], horizons[2]/3);
  if (horizons.some(h => !Number.isFinite(h))) throw new Error('horizon-overflow');
  const baseline = values(s,s.elapsed,horizons,c);
  const score = v => v.reduce((sum,x,i) => sum + c.weights[i] * (x-baseline[i])/Math.max(1,Math.abs(baseline[i]),s.bank), 0);
  const record = { schemaVersion: 1, finalLayer: 'planner', horizons, strategyWeights: c.weights,
    allCandidates: candidates, frontier: [], expandedNodes: [], prunedReasons: [],
    selectedAction: waitAction('WAIT_EVENT'), nextCommitment: commitment, plannedSteps: [],
    targetEta: null, reasonCode: 'WAIT_EVENT', warnings };
  function finish(action, reason, next = commitment) { record.selectedAction = action; record.reasonCode = reason; record.nextCommitment = next; return record; }
  if (s.pendingExecution) return finish(waitAction('WAIT_PENDING'), 'WAIT_PENDING');
  if (commitment) {
    if (!target || !target.eligible || !target.effect) return finish(waitAction('WAIT_TARGET_UNAVAILABLE',null,commitment.targetId),'WAIT_TARGET_UNAVAILABLE',{...commitment,status:'blocked'});
    const direct = eta(s,target.price,c.maxEvents);
    const vias = offers.filter(o => o.id !== target.id && o.eligible && o.effect && eta(s,o.price,c.maxEvents) === 0).map(o => {
      const next = applyAction(s,o), afterTarget = allOffers(next).find(x => x.id === target.id);
      return { actionId: o.id, seconds: known(afterTarget ? eta(next,afterTarget.price,c.maxEvents) : Infinity) };
    });
    record.targetEta = { targetId: target.id, direct: known(direct), via: vias };
    if (direct === 0) return finish(buyAction(target),'BUY_TARGET',{...commitment,status:'ready'});
    const better = vias.filter(v => v.seconds.status === 'known' && v.seconds.value < direct - Math.max(1/input.environment.fps,epsilon(direct,v.seconds.value)));
    better.sort((a,b) => a.seconds.value-b.seconds.value || a.actionId.localeCompare(b.actionId));
    if (better.length) return finish(buyAction(offers.find(o => o.id === better[0].actionId)), 'BUY_ADVANCES_TARGET',{...commitment,status:'saving'});
    return finish(waitAction('WAIT_TARGET',Number.isFinite(direct)?direct:null,target.id),'WAIT_TARGET',{...commitment,status:Number.isFinite(direct)?'saving':'blocked'});
  }
  const root = { id: 0, state: s, path: [], value: baseline, score: 0 };
  let beam = [root], terminals = [root], nodeId = 1;
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
        const currentOffer = allOffers(ready).find(x => x.id === o.id);
        const after = applyAction(ready,currentOffer);
        if (!after) continue;
        const path = [...node.path,{ action: buyAction(currentOffer), at: after.elapsed - s.elapsed, wait }];
        const v = horizons.map(h => {
          let at = s;
          for (const step of path) {
            if (step.at > h) break;
            at = advance(at,step.at - (at.elapsed-s.elapsed),c.maxEvents);
            at = applyAction(at,allOffers(at).find(x => x.id === step.action.id));
          }
          return values(at,s.elapsed,[h],c)[0];
        });
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
  const frontier = terminals.filter(n => !terminals.some(other => other !== n && dominates(other.value,n.value)));
  record.frontier = frontier.map(n => n.id);
  for (const candidate of candidates) {
    const matching = terminals.filter(n => n.path[0]?.action.id === candidate.id);
    matching.sort((a,b) => b.score-a.score || a.id-b.id);
    candidate.horizons = (matching[0]?.value ?? []).map((value,i) => ({ seconds:horizons[i],objectiveValue:value }));
  }
  frontier.sort((a,b) => {
    if (Math.abs(a.score-b.score) > epsilon(a.score,b.score)) return b.score-a.score;
    return (a.path[0]?.action.price ?? 0)-(b.path[0]?.action.price ?? 0) || (a.path[0]?.action.id ?? 'wait').localeCompare(b.path[0]?.action.id ?? 'wait');
  });
  const best = frontier[0] ?? root;
  record.plannedSteps = best.path;
  record.objectiveComponents = best.value;
  if (!best.path.length) return finish(waitAction(candidates.some(x => !x.effect) ? 'WAIT_UNKNOWN_EFFECT' : 'WAIT_EVENT'), candidates.some(x => !x.effect) ? 'WAIT_UNKNOWN_EFFECT' : 'WAIT_EVENT');
  const first = best.path[0];
  if (first.wait > 0) return finish(waitAction('WAIT_TARGET',first.wait,first.action.id),'WAIT_TARGET',{targetId:first.action.id,status:'saving'});
  return finish(first.action,'BUY_BEST_PLAN',null);
}

Object.assign(exports,{plan});
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
function mountPanel(runtime,document){
  document.getElementById('cc-rebuild-panel')?.remove();
  const root=document.createElement('section');root.id='cc-rebuild-panel';
  root.style.cssText='position:fixed;left:12px;top:60px;z-index:1000000;width:340px;max-height:75vh;overflow:auto;background:#161d28;color:#fff;border:1px solid #63758e;border-radius:10px;padding:14px;font:13px/1.6 sans-serif;box-shadow:0 4px 20px #0008';
  const title=document.createElement('strong');title.textContent='Cookie Auto '+runtime.version;root.append(title);
  const status=document.createElement('pre');status.style.cssText='white-space:pre-wrap;font:inherit';root.append(status);
  const controls=document.createElement('div');root.append(controls);
  function button(label,handler){const b=document.createElement('button');b.textContent=label;b.style.cssText='margin:3px;padding:4px 7px;cursor:pointer';b.onclick=handler;controls.append(b);return b;}
  const mode=button('自動化を開始',()=>{runtime.setObserveOnly(!runtime.config.observeOnly);runtime.tick();render();});
  button('診断JSON',async()=>{try{const records=await runtime.diagnostics.exportAll();const blob=new Blob([JSON.stringify(records,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='cookie-auto-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){runtime.error=e.message;render();}});
  button('再観測',()=>{runtime.resume();runtime.tick();});
  button('予約解除',()=>{runtime.commitment=null;runtime.tick();});
  button('停止',()=>runtime.shutdown());
  const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='候補と判断の詳細';details.append(summary);
  const text=document.createElement('pre');text.style.cssText='white-space:pre-wrap;font-size:11px';details.append(text);root.append(details);
  let renderedDecision=null;
  details.ontoggle=()=>render();
  function render(){
    const d=runtime.last?.decision;
    status.textContent=`${runtime.stopped?'停止':runtime.config.observeOnly?'観測モード（購入・クリックなし）':'自動化中'}\n単一起動：${runtime.owns()?'有効':'所有権なし'}\n${runtime.error?'診断：'+runtime.error:d?d.reasonCode+' / '+d.selectedAction.id:'ゲーム状態を確認中'}\n予約：${runtime.commitment?.targetId??'なし'}\n実クリック：約${runtime.clickRate().toFixed(1)}回/秒\n基本購入版：ミニゲーム自動操作は未対応`;
    if(details.open && renderedDecision!==d){text.textContent=d?JSON.stringify({horizons:d.horizons,plan:d.plannedSteps,targetEta:d.targetEta,candidates:d.allCandidates,warnings:d.warnings,timings:runtime.last?.timings},null,2):'';renderedDecision=d;}
    mode.textContent=runtime.config.observeOnly?'自動化を開始':'観測モードへ';mode.disabled=runtime.stopped;
  }
  const previous=runtime.onUpdate;runtime.onUpdate=r=>{previous(r);if(runtime.stopped)root.remove();else render();};
  document.body.append(root);render();return {root,render};
}

Object.assign(exports,{mountPanel});
}
};const cache={};function require(id){if(!cache[id]){cache[id]={};factories[id](require,cache[id]);}return cache[id];}require("src/runtime/browser.mjs");})();
