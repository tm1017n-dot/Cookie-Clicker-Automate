import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { dirname,resolve,relative } from 'node:path';
const root=resolve(import.meta.dirname,'..');
function collect(entryPath){
  const modules=new Map();
  function add(path){
    path=resolve(path);const id=relative(root,path).replaceAll('\\','/');if(modules.has(id))return id;
    modules.set(id,'');
    let source=readFileSync(path,'utf8');
    source=source.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,(_,bindings,spec)=>`const {${bindings}}=require(${JSON.stringify(add(resolve(dirname(path),spec)))});`);
    const names=[...source.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)/g)].map(m=>m[1]);
    source=source.replace(/\bexport\s+/g,'');
    modules.set(id,source+'\nObject.assign(exports,{'+names.join(',')+'});');return id;
  }
  return {entry:add(resolve(root,entryPath)),modules};
}
function bundle({entry,modules},prefix='',suffix=''){
  return `(function(){'use strict';${prefix}const factories={\n`+[...modules].map(([id,source])=>JSON.stringify(id)+':function(require,exports){\n'+source+'\n}').join(',\n')+`\n};const cache={};function require(id){if(!cache[id]){cache[id]={};factories[id](require,cache[id]);}return cache[id];}require(${JSON.stringify(entry)});${suffix}})();\n`;
}
const main=collect('src/runtime/browser.mjs');
const workerBuild=collect('src/runtime/planner-worker.mjs');
const worker=bundle(workerBuild);
const meta=`// ==UserScript==\n// @name Cookie Clicker Auto Rebuild\n// @namespace cc-smart-auto\n// @version 9.0.0-alpha.12\n// @description Reproducible planner, exclusive purchases and diagnostic replay.\n// @match https://orteil.dashnet.org/cookieclicker/*\n// @grant none\n// @run-at document-idle\n// ==/UserScript==\n`;
const result=meta+bundle(main,`globalThis.__CC_AUTO_PLANNER_WORKER_SOURCE__=${JSON.stringify(worker)};`,`delete globalThis.__CC_AUTO_PLANNER_WORKER_SOURCE__;`);
mkdirSync(resolve(root,'dist'),{recursive:true});writeFileSync(resolve(root,'dist/Cookie_Clicker_Auto_Rebuild.user.js'),result);console.log('Built '+main.modules.size+' main modules and '+workerBuild.modules.size+' worker modules, '+Buffer.byteLength(result)+' bytes');
