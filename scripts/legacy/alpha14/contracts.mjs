export const ENGINE_VERSION = '9.0.0-alpha.14';
export const RULESET_VERSION = 'cc-web-2.058/strategy-1';
export const DEFAULT_CONFIG = Object.freeze({
  horizons: [60, 300, 900], weights: [0.2, 0.35, 0.45],
  depth: 3, beamWidth: 24, maxNodes: 1024, maxEvents: 4096,
  maxUnlockSteps:512,maxUnlockNodes:1024,
  maxGoalInvestments:6,maxGoalVariants:24,
  switchMargin:.25,switchAbsolute:.05,switchConfirmations:3,switchCooldown:4,
  clickRate: 100, purchaseIntervalMs: 1500, riskWeight: 0.1,
  goldenSamples:8,goldenSeed:713,
  observeOnly: true, autoClick: true, collectGolden: true, collectWrath: false,
  allowSell: false, allowLumps: false, allowAscend: false
});

export const clone = value => structuredClone(value);
export const epsilon = (a, b) => Math.max(1e-9, 1e-12 * Math.max(Math.abs(a), Math.abs(b)));
export const known = value => Number.isFinite(value) ? { status: 'known', value } : { status: 'unreachable', value: null, reason: 'no-finite-path' };
export const unknown = reason => ({ status: 'unknown', value: null, reason });
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function assertJson(value, path = '$') {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError(`${path}: non-finite`);
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw new TypeError(`${path}: not JSON`);
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) assertJson(v, path + '.' + k);
}
export function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const v of Object.values(value)) freeze(v); }
  return value;
}
export function validateInput(input) {
  assertJson(input);
  if (input.schemaVersion !== 1 || input.engineVersion !== ENGINE_VERSION || input.rulesetVersion !== RULESET_VERSION) throw new TypeError('VersionMismatch');
  const s = input.state, c = input.config;
  for (const key of ['bank', 'reserve', 'clickRate', 'elapsed']) if (!Number.isFinite(s[key]) || s[key] < 0) throw new TypeError('invalid state.' + key);
  for (const key of ['passive', 'clickUnit', 'clickFraction', 'nonCursorClick', 'deferred', 'earned']) if (!Number.isFinite(s[key])) throw new TypeError('invalid state.' + key);
  for (const key of ['depth', 'beamWidth', 'maxNodes', 'maxEvents']) if (!Number.isInteger(c[key]) || c[key] < 1) throw new TypeError('invalid config.' + key);
  if (c.depth > 5 || c.maxNodes > 10000 || c.maxEvents > 10000 || c.beamWidth > 128) throw new TypeError('unsafe planning budget');
  for(const key of ['maxUnlockSteps','maxUnlockNodes','switchConfirmations','switchCooldown'])if(!Number.isInteger(c[key])||c[key]<1||c[key]>1024)throw new TypeError('invalid config.'+key);
  for(const key of ['maxGoalInvestments','maxGoalVariants'])if(!Number.isInteger(c[key])||c[key]<1||c[key]>64)throw new TypeError('invalid config.'+key);
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
  if(!Number.isFinite(c.riskWeight)||c.riskWeight<0||c.riskWeight>1)throw new TypeError('invalid risk weight');
  if(!Number.isInteger(c.goldenSamples)||c.goldenSamples<1||c.goldenSamples>32||!Number.isInteger(c.goldenSeed)||c.goldenSeed<0||c.goldenSeed>4294967295)throw new TypeError('invalid golden config');
  if(s.production){
    const p=s.production;
    if(!Number.isInteger(p.achievements)||p.achievements<0||!(p.baseKitten>0)||!(p.milkMultiplier>0)||p.kittenPowers.some(v=>v<0))throw new TypeError('invalid production model');
    const milestoneIds=new Set();
    for(const m of p.milestones){if(milestoneIds.has(m.id)||!Number.isInteger(m.amount)||m.amount<1||!s.buildings.some(b=>b.id===m.buildingId))throw new TypeError('invalid milestone');milestoneIds.add(m.id);}
    for(const r of p.synergies)if(r.ka<0||r.kb<0||!s.buildings.some(b=>b.id===r.a)||!s.buildings.some(b=>b.id===r.b))throw new TypeError('invalid synergy');
  }
  if(s.golden){
    const g=s.golden;
    if(!(g.maxSeconds>0 && g.maxSeconds<=7200)||!Number.isInteger(g.maxEvents)||g.maxEvents<1||g.maxEvents>128||g.lanes.length<1||g.lanes.length>32||!(g.fps>0)||!(g.duration>0)||!(g.gain>=0))throw new TypeError('invalid golden budget');
    for(const [a,b] of [[g.min,g.max],[g.futureMin,g.futureMax]])if(!(a>=0 && b>a && b*g.fps<=180000))throw new TypeError('invalid golden interval');
    for(const lane of g.lanes)if(lane.extra<0||lane.next<0||lane.frenzy<0||lane.click<0||!Number.isInteger(lane.events)||lane.events<0)throw new TypeError('invalid golden sample');
  }
  return input;
}
export function makeInput(options = {}) {
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
