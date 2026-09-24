import { plan } from '../core/planner.mjs';

self.onmessage=event=>{
  const {id,input}=event.data;
  try{self.postMessage({id,decision:plan(input)});}
  catch(error){self.postMessage({id,error:String(error?.message??error)});}
};
