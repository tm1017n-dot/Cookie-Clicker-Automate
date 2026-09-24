import { validateInput, clone, known, unknown, epsilon } from './contracts.mjs';
import { income, allOffers, offerById, applyAction, advance, eta, effectDelta } from './model.mjs';
import { unlockRoute } from './unlocks.mjs';
import { goldenSummary } from './golden.mjs';

const waitAction = (reason, seconds = null, targetId = null) => ({ id: 'wait', kind: 'wait', operation: 'waitUntil', targetId, price: 0, waitSeconds: seconds, reason });
const buyAction = o => ({ id: o.id, kind: o.kind, operation: o.kind === 'building' ? 'buyBuilding' : 'buyUpgrade', targetId: o.targetId, quantity: 1, price: o.price });
function values(s, rootElapsed, horizons, config, forecasts = null) {
  let end=s;
  return horizons.map(h => {
    const remaining = h - (end.elapsed - rootElapsed);
    if (remaining < 0) return null;
    end = advance(end, remaining, config.maxEvents);
    const forecast=goldenSummary(end.golden,config.riskWeight);
    if(forecasts)forecasts.push({seconds:h,...forecast});
    return end.bank + end.deferred + forecast.value;
  });
}
function dominates(a, b) { return a.every((v,i) => v >= b[i] - epsilon(v,b[i])) && a.some((v,i) => v > b[i] + epsilon(v,b[i])); }
export function plan(input) {
  validateInput(input);
  const s = clone(input.state), c = input.config;
  const warnings = [...s.modelWarnings];
  const offers = allOffers(s);
  const candidates = offers.map(o => {
    const d = effectDelta(s,o,c.riskWeight), seconds = o.eligible ? eta(s,o.price,c.maxEvents) : Infinity;
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
  const routes=offers.filter(o=>!o.eligible && !o.disabled && o.effect && !o.rootOnly && ((o.requiresBuildings?.length??0)+(o.requiresOwned?.length??0)>0 || o.requiresAchievements))
    .sort((a,b)=>Number(b.id===commitment?.targetId)-Number(a.id===commitment?.targetId) || a.id.localeCompare(b.id,'en'))
    .map(o=>unlockRoute(s,o.id,c,unlockBudget));
  const targetRoute=target && !target.eligible?routes.find(r=>r.targetId===target.id):null;
  const finiteT = candidates.filter(o => o.eligible && o.waitSeconds.status === 'known' && o.paybackSeconds.status === 'known').map(o => o.waitSeconds.value + o.paybackSeconds.value);
  const horizons = [...c.horizons];
  if (finiteT.length) horizons[2] = Math.max(horizons[2], 4 * Math.min(...finiteT));
  for(const route of routes.filter(r=>r.status==='known' && offers.find(o=>o.id===r.targetId)?.research)){
    const gain=income(route.state).economic-income(s).economic;
    if(gain>0)horizons[2]=Math.max(horizons[2],4*(route.eta+route.cost/gain));
  }
  if (target) {
    const d = effectDelta(s,target,c.riskWeight), t = eta(s,target.price,c.maxEvents);
    if (d?.economic > 0 && Number.isFinite(t)) horizons[2] = Math.max(horizons[2], 4 * (t + target.price / d.economic));
    if(targetRoute?.status==='known'){
      const gain=income(targetRoute.state).economic-income(s).economic;
      if(gain>0)horizons[2]=Math.max(horizons[2],4*(targetRoute.eta+targetRoute.cost/gain));
    }
  }
  horizons[1] = Math.max(horizons[1], horizons[2]/3);
  if (horizons.some(h => !Number.isFinite(h))) throw new Error('horizon-overflow');
  const baselineForecast=[];
  const baseline = values(s,s.elapsed,horizons,c,baselineForecast);
  const score = v => v.reduce((sum,x,i) => sum + c.weights[i] * (x-baseline[i])/Math.max(1,Math.abs(baseline[i]),s.bank), 0);
  const record = { schemaVersion: 1, finalLayer: 'planner', horizons, strategyWeights: c.weights,
    allCandidates: candidates, frontier: [], expandedNodes: [], prunedReasons: [],
    selectedAction: waitAction('WAIT_EVENT'), nextCommitment: commitment, plannedSteps: [],
    targetEta: null, reasonCode: 'WAIT_EVENT', warnings,
    unlockPaths:[],singleStepNodes:[],comparison:{policy:'one-step-floor-for-partial-models',commonDepth:1,heldBack:[]},reservationReview:null,
    goldenModel:s.golden?{samples:s.golden.lanes.length,seed:s.golden.seed,maxSeconds:s.golden.maxSeconds,maxEvents:s.golden.maxEvents,riskWeight:c.riskWeight,baseline:baselineForecast,omitted:['chain-rewards','storm-rewards','drops','discount-buffs']}:null,
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
        const cached = depth===0?singleById.get(o.id):null;
        const wait = cached?cached.path[0].wait:eta(node.state,o.price,c.maxEvents);
        if (!Number.isFinite(wait) || node.state.elapsed - s.elapsed + wait >= horizons[2]) continue;
        const ready = cached?null:advance(node.state,wait,c.maxEvents);
        const currentOffer = cached?cached.path[0].action:offerById(ready,o.id);
        const after = cached?cached.state:applyAction(ready,currentOffer);
        if (!after) continue;
        const path = cached?cached.path:[...node.path,{ action: buyAction(currentOffer), at: after.elapsed - s.elapsed, wait }];
        const v = cached?cached.value:extendValues(node,after);
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
    entry.nodeId=nodeId;terminals.push({id:nodeId++,state:route.state,path:route.path,value,score:score(value),goalId:route.targetId});
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
