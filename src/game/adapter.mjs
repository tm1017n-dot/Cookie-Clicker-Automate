import { makeInput, clone, freeze, RULESET_VERSION } from '../core/contracts.mjs';
import { Journal } from './journal.mjs';
import { effectDelta } from '../core/model.mjs';
import { refreshOnly,metadataEffect,eggPriceEffects,unroundedUpgradePrice } from './effects.mjs';
import { strategyMetadata } from './strategy.mjs';
import { captureGolden,goldenUpgradeEffect } from './golden.mjs';

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

export class GameAdapter {
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
      reserves:[g.lumps ?? 0,g.elderWrath ?? 0],achievements:g.AchievementsOwned??0,research:g.nextResearch??0,
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
    const {production,extras}=strategyMetadata(g,buildings),golden=captureGolden(g,config);
    const nonCursor=production.baseNonCursor;
    const clickPerBuilding=production.cursorCoefficient>0?(buildings.find(b=>b.id>0)?.measurement.mouse??0)-fraction*(buildings.find(b=>b.id>0)?.measurement.passive??0):0;
    const baseState={passive:steady.passive-buildings.reduce((n,b)=>n+b.amount*b.unitCps,0),buildings,production,
      buffs:[],offers:[],clickUnit:steady.mouse-fraction*steady.passive-clickPerBuilding*nonCursor,clickFraction:fraction,nonCursorClick:clickPerBuilding,clickRate:1};
    const agrees=(a,b)=>Math.abs(a-b)<=Math.max(1e-8,Math.abs(b)*1e-6);
    for(const b of buildings){
      const d=effectDelta({...baseState,production:{...production,milestones:[]}},{effect:{building:b.id}});
      const dp=d.liquid-d.click,extraPassive=b.measurement.passive-dp,extraClick=b.measurement.mouse-d.click-fraction*extraPassive;
      b.rootOnly=!agrees(dp,b.measurement.passive)||!agrees(d.click,b.measurement.mouse);
      b.effectOverride=b.rootOnly?{building:b.id,flatPassive:extraPassive,flatClick:extraClick}:null;
    }
    const nextTiers=new Map();
    for(const u of collection(g.UpgradesById)){
      const tier=normalTier(g,u);if(u.bought || u.unlocked || !tier)continue;
      const current=nextTiers.get(tier.buildingId);
      if(!current || tier.amount<current.tier.amount || (tier.amount===current.tier.amount && u.id<current.upgrade.id))nextTiers.set(tier.buildingId,{upgrade:u,tier});
    }
    const futureIds=new Set([...nextTiers.values()].map(x=>x.upgrade.id));
    for(const [id,extra] of extras)if(extra.future)futureIds.add(id);
    const offers = collection(g.UpgradesById).filter(u => !u.bought && (offered.has(u.id) || u.id <= 2 || futureIds.has(u.id))).map(u => {
      const price = this.price('upgrade',u.id);
      const tier=normalTier(g,u),future=futureIds.has(u.id) && !offered.has(u.id),extra=extras.get(u.id);
      const gcEffect=goldenUpgradeEffect(g,u,golden.model);
      const disallowed = ['prestige','debug','toggle'].includes(u.pool) || (!refreshOnly(u.buyFunction) && !extra?.callbackAllowed) || Boolean(u.toggleInto) || Boolean(u.ask) || (u.priceLumps??0)>0;
      // Locked ordinary tiers have audited metadata. Do not run hundreds of hypothetical gains passes.
      const measured = future||disallowed?null:this.measure(x => { x.buffs={}; u.bought=1; if (x.CountsAsUpgradeOwned?.(u.pool)) x.UpgradesOwned++; }, [u]);
      const passiveDelta = measured?measured.passive-steady.passive:0, mouseDelta = measured?measured.mouse-steady.mouse:0;
      let effect = null, rootOnly = true, confidence = 'unknown';
      if (u.id <= 2) { effect={buildingMultipliers:[{id:0,multiplier:2}],clickMultiplier:2}; rootOnly=false; confidence='high'; }
      else if(tier){effect={buildingMultipliers:[{id:tier.buildingId,multiplier:tier.multiplier}]};rootOnly=false;confidence='high';}
      else if(extra){effect=extra.effect;rootOnly=false;confidence='high';}
      else if(gcEffect){effect=gcEffect;rootOnly=false;confidence='estimated';}
      else if(metadataEffect(g,u)){effect=metadataEffect(g,u);rootOnly=false;confidence='high';}
      else if (u.buildingTie && u.tier != null && !u.buildingTie1 && passiveDelta > 0) {
        const b = buildings.find(b => b.id === u.buildingTie.id);
        if (b && b.amount*b.unitCps > 0) {
          effect={buildingMultipliers:[{id:b.id,multiplier:1+passiveDelta/(b.amount*b.unitCps)}]}; confidence='medium'; rootOnly=false;
          if (Math.abs(mouseDelta-fraction*passiveDelta)>Math.max(1e-8,Math.abs(mouseDelta)*1e-6)) rootOnly=true;
        }
      }
      if (measured && effect && !rootOnly) {
        const prediction=effectDelta(baseState, {effect});
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
        requiresBuildings:u.id<=2 ? [{id:0,amount:u.id===2 ? 10 : 1}] : extra?.requiresBuildings??(future&&tier?[{id:tier.buildingId,amount:tier.amount}]:[]),
        ...(extra?.requiresOwned?{requiresOwned:extra.requiresOwned}:{}),...(extra?.requiresAchievements?{requiresAchievements:extra.requiresAchievements}:{}),
        ...(extra?.research?{research:true,researchReady:extra.researchReady,availableAt:extra.availableAt}:{}),
        evidence:extra?[{source:extra.source,coverage:rootOnly?'current-state-production':'dynamic-model',passiveDelta,mouseDelta}]:gcEffect?[{source:'natural-golden-scenarios',coverage:'sampled-expectation'}]:future?[{source:'Game.Tiers + building.tieredUpgrades',coverage:'next-ordinary-tier',unlockAmount:tier.amount,multiplier:tier.multiplier}]:[{source:'Game.CalculateGains + audited metadata',coverage:disallowed?'disabled':!rootOnly?'reusable':'current-state-production',passiveDelta,mouseDelta}],
        warnings:disallowed?['special-operation-not-enabled']:(effect?[]:['unknown-effect'])};
    });
    const sum = buildings.reduce((n,b) => n+b.unitCps*b.amount,0);
    const wither = g.cpsSucked || 0;
    // Deferred assets need a liquidation policy; this alpha does not trade them as liquid income.
    if (wither > 0) throw new Error('wrinkler-liquidation-model-not-enabled');
    const input = clone(makeInput({ bank:finite(g.cookies,'bank'), reserve:config.reserve ?? 0,
      passive:steady.passive-sum,clickUnit:steady.mouse-fraction*steady.passive-clickPerBuilding*nonCursor,clickFraction:fraction,nonCursorClick:clickPerBuilding,production,golden:golden.model,
      clickRate:config.autoClick?measuredRate:0,buildings,offers,buffs,commitment,
      owned:collection(g.UpgradesById).filter(u => u.bought).map(u => 'upgrade:'+u.id),earned:g.cookiesEarned ?? 0,
      config, modelWarnings:[...(offers.some(o => o.rootOnly)?['partial-child-model']:[]),...(golden.reason?['golden-model:'+golden.reason]:['golden-sampled-partial-rewards'])] }));
    input.stochasticModel={seed:golden.model?.seed??0,samples:golden.model?.sampleCount??0,mode:golden.model?'natural-golden-scenarios':'deterministic-base'};
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
