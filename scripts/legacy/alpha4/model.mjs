import { clone, epsilon } from './contracts.mjs';

export function income(s) {
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
export function buildingPrice(b) {
  if (b.amount === (b.priceAtAmount ?? b.amount)) return b.nextPrice;
  const paid = amount => Math.max(0, amount - (b.free ?? 0));
  return Math.ceil((b.unroundedNextPrice ?? b.nextPrice) * (b.growth ?? 1.15) ** (paid(b.amount) - paid(b.priceAtAmount)));
}
export function eligible(s, o) {
  if (s.owned.includes(o.id) || o.disabled || o.price === null) return false;
  if (o.requiresOwned?.some(id => !s.owned.includes(id))) return false;
  if (o.requiresBuildings?.some(r => (s.buildings.find(b => b.id === r.id)?.amount ?? 0) < r.amount)) return false;
  if (o.availableAt != null && s.elapsed < o.availableAt) return false;
  return true;
}
export function allOffers(s) {
  return [...s.buildings.filter(b => !b.disabled).map(b => ({ id: 'building:' + b.id, kind: 'building', targetId: b.id,
    price: buildingPrice(b), effect: b.effectOverride ?? { building: b.id }, rootOnly:!!b.rootOnly, confidence: 'high', eligible: true })),
    ...s.offers.map(o => ({ ...o, eligible: eligible(s, o) }))].sort((a,b) => a.id.localeCompare(b.id, 'en'));
}
export function applyEffect(s, e) {
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
export function applyAction(state, offer) {
  const s = clone(state);
  if (!offer?.effect || !offer.eligible || s.bank + epsilon(s.bank, offer.price) < offer.price + s.reserve) return null;
  s.bank = Math.max(0, s.bank - offer.price);
  applyEffect(s, offer.effect);
  if (offer.kind !== 'building' || offer.effect.building == null) s.owned.push(offer.id);
  return s;
}
export function advance(state, seconds, maxEvents = 4096) {
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
export function eta(state, price, maxEvents = 4096) {
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
export function effectDelta(s, offer) {
  if (!offer.effect) return null;
  const before = income(s), after = clone(s);
  applyEffect(after, offer.effect);
  const out = income(after);
  return { liquid: out.liquid - before.liquid, click: out.click - before.click, economic: out.economic - before.economic };
}
