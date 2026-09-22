import { canonical, clone, assertJson, ENGINE_VERSION, RULESET_VERSION } from '../core/contracts.mjs';
import { plan } from '../core/planner.mjs';

export async function hash(value) {
  const bytes=new TextEncoder().encode(canonical(value));
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function bundle(input,decision,cycleId) {
  assertJson(input);assertJson(decision);
  const semantic=clone(input);
  delete semantic.environment.language;delete semantic.environment.observedAt;
  for(const o of semantic.state.offers){delete o.internalName;delete o.displayName;}
  return {schemaVersion:1,cycleId,input:clone(input),decision:clone(decision),receipt:null,
    inputHash:await hash(input),semanticHash:await hash(semantic),captureStatus:'complete',
    createdAt:new Date().toISOString()};
}
export async function replay(snapshot) {
  assertJson(snapshot);
  if(snapshot.schemaVersion!==1 || snapshot.input.engineVersion!==ENGINE_VERSION || snapshot.input.rulesetVersion!==RULESET_VERSION)throw new Error('VersionMismatch');
  if(snapshot.inputHash!==await hash(snapshot.input))throw new Error('InputChecksumMismatch');
  const actual=plan(snapshot.input);
  return {matches:canonical(actual)===canonical(snapshot.decision),decision:actual};
}
export class Diagnostics {
  constructor({limit=100,persist=false,indexedDB=globalThis.indexedDB}={}){this.limit=limit;this.persist=persist;this.indexedDB=indexedDB;this.records=[];this.db=null;}
  async open(){
    if(!this.persist)return;
    if(!this.indexedDB)throw new Error('IndexedDBUnavailable');
    this.db=await new Promise((resolve,reject)=>{const r=this.indexedDB.open('CC_REBUILD_DIAGNOSTICS_V1',1);r.onupgradeneeded=()=>r.result.createObjectStore('cycles',{keyPath:'cycleId'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  }
  async save(record){
    const saved=clone(record);assertJson(saved);
    if(this.persist){
      if(!this.db)throw new Error('DiagnosticsNotOpen');
      await new Promise((resolve,reject)=>{const tx=this.db.transaction('cycles','readwrite');tx.objectStore('cycles').put(saved);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('DiagnosticsAborted'));});
    }
    const index=this.records.findIndex(x=>x.cycleId===saved.cycleId);
    if(index>=0)this.records[index]=saved;else this.records.push(saved);
    if(this.records.length>this.limit)this.records.shift();
  }
  latest(){return this.records.length?clone(this.records.at(-1)):null;}
  async exportAll(){
    if(!this.persist)return clone(this.records);
    return new Promise((resolve,reject)=>{const r=this.db.transaction('cycles').objectStore('cycles').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  }
  close(){this.db?.close();}
}
