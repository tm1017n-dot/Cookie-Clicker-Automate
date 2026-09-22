export function mountPanel(runtime,document){
  document.getElementById('cc-rebuild-panel')?.remove();
  const root=document.createElement('section');root.id='cc-rebuild-panel';
  root.style.cssText='position:fixed;left:12px;top:60px;z-index:1000000;width:340px;max-height:75vh;overflow:auto;background:#161d28;color:#fff;border:1px solid #63758e;border-radius:10px;padding:14px;font:13px/1.6 sans-serif;box-shadow:0 4px 20px #0008';
  const title=document.createElement('strong');title.textContent='Cookie Auto '+runtime.version;root.append(title);
  const status=document.createElement('pre');status.style.cssText='white-space:pre-wrap;font:inherit';root.append(status);
  const controls=document.createElement('div');root.append(controls);
  function button(label,handler){const b=document.createElement('button');b.textContent=label;b.style.cssText='margin:3px;padding:4px 7px;cursor:pointer';b.onclick=handler;controls.append(b);return b;}
  const mode=button('自動化を開始',()=>{runtime.setObserveOnly(!runtime.config.observeOnly);runtime.tick();render();});
  button('診断JSON',async()=>{try{const records=await runtime.diagnostics.exportAll();const blob=new Blob([JSON.stringify(records,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='cookie-auto-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){runtime.error=e.message;render();}});
  button('再観測',()=>{runtime.resume();runtime.tick();});
  button('予約解除',()=>{runtime.commitment=null;runtime.tick();});
  button('停止',()=>runtime.shutdown());
  const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='候補と判断の詳細';details.append(summary);
  const text=document.createElement('pre');text.style.cssText='white-space:pre-wrap;font-size:11px';details.append(text);root.append(details);
  let renderedDecision=null;
  details.ontoggle=()=>render();
  function render(){
    const d=runtime.last?.decision;
    status.textContent=`${runtime.stopped?'停止':runtime.config.observeOnly?'観測モード（購入・クリックなし）':'自動化中'}\n単一起動：${runtime.owns()?'有効':'所有権なし'}\n${runtime.error?'診断：'+runtime.error:d?d.reasonCode+' / '+d.selectedAction.id:'ゲーム状態を確認中'}\n予約：${runtime.commitment?.targetId??'なし'}\n実クリック：約${runtime.clickRate().toFixed(1)}回/秒\n基本購入版：ミニゲーム自動操作は未対応`;
    if(details.open && renderedDecision!==d){text.textContent=d?JSON.stringify({horizons:d.horizons,plan:d.plannedSteps,targetEta:d.targetEta,candidates:d.allCandidates,warnings:d.warnings,timings:runtime.last?.timings},null,2):'';renderedDecision=d;}
    mode.textContent=runtime.config.observeOnly?'自動化を開始':'観測モードへ';mode.disabled=runtime.stopped;
  }
  const previous=runtime.onUpdate;runtime.onUpdate=r=>{previous(r);if(runtime.stopped)root.remove();else render();};
  document.body.append(root);render();return {root,render};
}
