import { readdirSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
function scan(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const p=resolve(dir,e.name);if(e.isDirectory())scan(p);else if(/\.(mjs|js)$/.test(p)){const r=spawnSync(process.execPath,['--check',p],{encoding:'utf8'});if(r.status!==0){console.error(r.stderr);process.exitCode=1;}}}}
for(const dir of ['src/core','src/game','src/runtime','src/ui','scripts','dist'])scan(resolve(root,dir));
for(const name of readdirSync(resolve(root,'src/core'))){const text=readFileSync(resolve(root,'src/core',name),'utf8');if(/\bGame\b|\bdocument\b|Date\.now\(|Math\.random\(/.test(text)){console.error('Impure core: '+name);process.exitCode=1;}}
