import { readFileSync } from 'node:fs';
import { replay } from '../src/runtime/diagnostics.mjs';
const path=process.argv[2];if(!path)throw new Error('Usage: node scripts/replay.mjs snapshot.json');
const data=JSON.parse(readFileSync(path,'utf8'));
for(const record of Array.isArray(data)?data:[data]){const result=await replay(record);console.log(record.cycleId,result.matches?'MATCH':'DIFFERENT',result.decision.selectedAction.id);if(!result.matches)process.exitCode=1;}
