import { validateInput, clone, known, unknown, epsilon } from './contracts.mjs';
import { income, allOffers, applyAction, advance, eta, effectDelta } from './model.mjs';

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
export function plan(input) {
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
