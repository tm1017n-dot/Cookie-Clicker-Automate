import { replay as currentReplay,hash } from '../src/runtime/diagnostics.mjs';
import { plan as legacyPlan } from './legacy/alpha1/planner.mjs';
import { plan as alpha4Plan } from './legacy/alpha4/planner.mjs';
import { canonical } from '../src/core/contracts.mjs';
export async function replay(snapshot){
  if(snapshot.schemaVersion===1 && snapshot.input.engineVersion==='9.0.0-alpha.4' && snapshot.input.rulesetVersion==='cc-web-2.058/basic-2'){
    if(await hash(snapshot.input)!==snapshot.inputHash)throw new Error('InputChecksumMismatch');
    const decision=alpha4Plan(snapshot.input);
    return {matches:canonical(decision)===canonical(snapshot.decision),decision,engineVersion:'9.0.0-alpha.4'};
  }
  if(snapshot.schemaVersion===1 && snapshot.input.engineVersion==='9.0.0-alpha.1' && snapshot.input.rulesetVersion==='cc-web-2.058/basic-1'){
    if(await hash(snapshot.input)!==snapshot.inputHash)throw new Error('InputChecksumMismatch');
    const decision=legacyPlan(snapshot.input);
    return {matches:canonical(decision)===canonical(snapshot.decision),decision,engineVersion:'9.0.0-alpha.1'};
  }
  return currentReplay(snapshot);
}
