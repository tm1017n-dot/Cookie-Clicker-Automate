import { GameAdapter } from '../game/adapter.mjs';
import { Coordinator } from './coordinator.mjs';
import { Diagnostics } from './diagnostics.mjs';
import { mountPanel } from '../ui/panel.mjs';

export async function boot(page,document){
  const adapter=new GameAdapter(()=>page.Game);
  const runtime=new Coordinator(page,adapter,{diagnostics:new Diagnostics({persist:true})});
  mountPanel(runtime,document);
  try { await runtime.start(); await runtime.tick(); }
  catch(error) { runtime.error=String(error.message); runtime.onUpdate(runtime); }
  return runtime;
}
if(typeof document!=='undefined'){
  const page=typeof unsafeWindow!=='undefined'?unsafeWindow:window;
  boot(page,document).catch(error=>{console.error('[Cookie Auto]',error);});
}
