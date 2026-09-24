import { plan } from '../core/planner.mjs';

export function createPlanner(page,source){
  const fallback=input=>plan(input);
  fallback.mode='main-thread';
  if(!source || !page?.Worker || !page?.Blob || !page?.URL?.createObjectURL)return fallback;
  let worker,url,nextId=0;const pending=new Map();
  const stop=()=>{if(!worker)return;worker.terminate();worker=null;if(url){page.URL.revokeObjectURL(url);url=null;}};
  const fail=()=>{const jobs=[...pending.values()];pending.clear();stop();for(const job of jobs){clearTimeout(job.timer);try{job.resolve(fallback(job.input));}catch(error){job.reject(error);}}};
  try{
    url=page.URL.createObjectURL(new page.Blob([source],{type:'text/javascript'}));
    worker=new page.Worker(url);
    page.URL.revokeObjectURL(url);url=null;
    worker.onmessage=event=>{const job=pending.get(event.data.id);if(!job)return;pending.delete(event.data.id);clearTimeout(job.timer);if(event.data.error)job.reject(new Error(event.data.error));else job.resolve(event.data.decision);};
    worker.onerror=fail;
  }catch{if(url)page.URL.revokeObjectURL(url);return fallback;}
  const run=input=>new Promise((resolve,reject)=>{
    const id=++nextId,timer=setTimeout(fail,10000);pending.set(id,{input,resolve,reject,timer});
    try{worker.postMessage({id,input});}catch{fail();}
  });
  run.mode='worker';
  run.close=()=>{for(const job of pending.values()){clearTimeout(job.timer);job.reject(new Error('planner-closed'));}pending.clear();stop();};
  return run;
}
