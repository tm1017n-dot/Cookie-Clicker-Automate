export const ENGINE_VERSION = '9.0.0-alpha.1';
export const RULESET_VERSION = 'cc-web-2.058/basic-1';
export const DEFAULT_CONFIG = Object.freeze({
  horizons: [60, 300, 900], weights: [0.2, 0.35, 0.45],
  depth: 3, beamWidth: 24, maxNodes: 1024, maxEvents: 4096,
  clickRate: 20, purchaseIntervalMs: 1500, riskWeight: 0.1,
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
