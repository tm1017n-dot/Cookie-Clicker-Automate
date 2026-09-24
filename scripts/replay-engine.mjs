import { replay as currentReplay,hash } from '../src/runtime/diagnostics.mjs';
import { plan as legacyPlan } from './legacy/alpha1/planner.mjs';
import { plan as alpha4Plan } from './legacy/alpha4/planner.mjs';
import { plan as alpha5Plan } from './legacy/alpha5/planner.mjs';
import { plan as alpha6Plan } from './legacy/alpha6/planner.mjs';
import { plan as alpha7Plan } from './legacy/alpha7/planner.mjs';
import { plan as alpha8Plan } from './legacy/alpha8/planner.mjs';
import { canonical } from '../src/core/contracts.mjs';
export async function replay(snapshot){
  if(snapshot.schemaVersion===1 && snapshot.input.engineVersion==='9.0.0-alpha.8' && snapshot.input.rulesetVersion==='cc-web-2.058/strategy-1'){
    if(await hash(snapshot.input)!==snapshot.inputHash)throw new Error('InputChecksumMismatch');
    const decision=alpha8Plan(snapshot.input);
    return {matches:canonical(decision)===canonical(snapshot.decision),decision,engineVersion:'9.0.0-alpha.8'};
  }
  if(snapshot.schemaVersion===1 && snapshot.input.engineVersion==='9.0.0-alpha.7' && snapshot.input.rulesetVersion==='cc-web-2.058/strategy-1'){
    if(await hash(snapshot.input)!==snapshot.inputHash)throw new Error('InputChecksumMismatch');
    const decision=alpha7Plan(snapshot.input);
    return {matches:canonical(decision)===canonical(snapshot.decision),decision,engineVersion:'9.0.0-alpha.7'};
  }
  if(snapshot.schemaVersion===1 && snapshot.input.engineVersion==='9.0.0-alpha.6' && snapshot.input.rulesetVersion==='cc-web-2.058/strategy-1'){
    if(await hash(snapshot.input)!==snapshot.inputHash)throw new Error('InputChecksumMismatch');
    const decision=alpha6Plan(snapshot.input);
    return {matches:canonical(decision)===canonical(snapshot.decision),decision,engineVersion:'9.0.0-alpha.6'};
  }
  if(snapshot.schemaVersion===1 && snapshot.input.engineVersion==='9.0.0-alpha.5' && snapshot.input.rulesetVersion==='cc-web-2.058/basic-3'){
    if(await hash(snapshot.input)!==snapshot.inputHash)throw new Error('InputChecksumMismatch');
    const decision=alpha5Plan(snapshot.input);
    return {matches:canonical(decision)===canonical(snapshot.decision),decision,engineVersion:'9.0.0-alpha.5'};
  }
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
