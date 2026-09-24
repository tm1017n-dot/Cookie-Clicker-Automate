import { attachPanelLayout } from './panel-layout.mjs';
import { coverageLines } from './coverage.mjs';
export function mountPanel(runtime,document){
  document.getElementById('cc-rebuild-panel')?.remove();
  const root=document.createElement('section');root.id='cc-rebuild-panel';
  root.style.cssText='position:fixed;left:12px;top:60px;z-index:1000000;box-sizing:border-box;width:368px;min-width:240px;min-height:180px;max-width:100vw;max-height:100vh;resize:both;overflow:auto;background:#161d28;color:#fff;border:1px solid #63758e;border-radius:10px;padding:14px;font:13px/1.6 sans-serif;box-shadow:0 4px 20px #0008';
  const title=document.createElement('strong');title.textContent='Cookie Auto '+runtime.version;
  title.style.cssText='display:block;position:sticky;top:0;background:#161d28;cursor:move;touch-action:none;user-select:none;padding:4px 0';
  title.title='ドラッグまたは矢印キーで移動';
  const header=document.createElement('div');header.style.cssText='display:flex;align-items:center;gap:8px';title.style.flex='1';header.append(title);root.append(header);
  const collapse=document.createElement('button');header.append(collapse);
  const body=document.createElement('div');root.append(body);
  const hint=document.createElement('small');hint.textContent='上部で移動 · 右下でサイズ変更（位置とサイズは保存）';body.append(hint);
  const status=document.createElement('pre');status.style.cssText='white-space:pre-wrap;font:inherit';status.setAttribute('role','status');body.append(status);
  const unsupported=document.createElement('details');body.append(unsupported);
  const unsupportedTitle=document.createElement('summary');unsupported.append(unsupportedTitle);
  const unsupportedText=document.createElement('pre');unsupportedText.style.cssText='white-space:pre-wrap;font:inherit';unsupported.append(unsupportedText);
  const controls=document.createElement('div');body.append(controls);
  function button(label,handler){const b=document.createElement('button');b.textContent=label;b.style.cssText='margin:3px;padding:4px 7px;cursor:pointer';b.onclick=handler;controls.append(b);return b;}
  const mode=button('自動化を開始',()=>{runtime.setObserveOnly(!runtime.config.observeOnly);runtime.tick();render();});
  button('診断JSON',async()=>{try{const records=await runtime.diagnostics.exportAll();const blob=new Blob([JSON.stringify(records,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='cookie-auto-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){runtime.error=e.message;render();}});
  button('再観測',()=>{runtime.resume();runtime.tick();});
  button('予約解除',()=>{runtime.clearCommitment();runtime.tick();});
  button('停止',()=>runtime.shutdown());
  button('位置を戻す',()=>{layout.reset();render();});
  const settings=document.createElement('label');settings.textContent='クリック目標（回/秒） ';body.append(settings);
  const rate=document.createElement('input');rate.type='number';rate.min='1';rate.max='100';rate.step='1';rate.value=String(runtime.config.clickRate);rate.style.cssText='width:65px;margin:8px 0';settings.append(rate);
  rate.onchange=()=>{const value=Number(rate.value);if(!Number.isInteger(value)||value<1||value>100){rate.setCustomValidity('1〜100の整数を入力してください');rate.reportValidity();return;}rate.setCustomValidity('');runtime.setClickRate(value);runtime.tick();};
  const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='候補と判断の詳細';details.append(summary);
  const text=document.createElement('pre');text.style.cssText='white-space:pre-wrap;font-size:11px';details.append(text);body.append(details);
  let renderedDecision=null;
  details.ontoggle=()=>render();
  function render(){
    const d=runtime.last?.decision;
    const reasons={WAIT_TARGET:'購入資金を貯めています',BUY_TARGET:'予約対象を購入',BUY_BEST_PLAN:'成長効率を比較して購入',BUY_ADVANCES_TARGET:'目標への到達を早める購入',BUY_UNLOCK_PREREQUISITE:'強化の解禁に必要な施設・前提を購入',WAIT_UNLOCK_PREREQUISITE:'強化の解禁に必要な資金を貯めています',WAIT_EVENT:'次の変化を待っています',WAIT_NO_PROFITABLE_PLAN:'評価済み候補では購入より待機が有利です',WAIT_UNKNOWN_EFFECT:'評価済み候補では待機が有利です（購入可能な未評価候補あり）',WAIT_TARGET_UNAVAILABLE:'予約対象を再確認中',WAIT_PENDING:'購入結果を確認中'};
    const target=runtime.commitment?.targetId;
    const candidate=d?.allCandidates.find(c=>c.id===(target??d.selectedAction.id));
    const name=candidate?.displayName ?? (candidate?.kind==='building'?'施設 '+candidate.targetId:(target??'なし'));
    const eta=d?.targetEta?.direct;
    const unsupportedLines=coverageLines(d);unsupported.hidden=unsupportedLines.length===0;
    unsupportedTitle.textContent=`未評価・購入対象外の強化（${unsupportedLines.length}件）`;
    unsupportedText.textContent=unsupportedLines.join('\n');
    if(d?.reasonCode==='WAIT_UNKNOWN_EFFECT')unsupported.open=true;
    status.textContent=`${runtime.stopped?'停止':runtime.config.observeOnly?'観測モード（購入・クリックなし）':'自動化中'}\n${runtime.error?'診断：'+runtime.error:d?(reasons[d.reasonCode]??d.reasonCode):'ゲーム状態を確認中'}\n対象：${name}${eta?.status==='known'?'（約'+Math.ceil(eta.value)+'秒）':''}\n実クリック：約${runtime.measuredClickRate().toFixed(1)}回/秒 ／ 要求：約${runtime.attemptedClickRate().toFixed(1)}回/秒 ／ 目標${runtime.config.clickRate}\n基本購入版：ミニゲーム自動操作は未対応`;
    if(d?.goldenModel)status.textContent+='\n自然GC：'+d.goldenModel.samples+'通りの予測で評価（利益は購入資金に含めません）';
    if(d?.allCandidates.some(o=>o.research))status.textContent+='\n研究：完了待ち時間を含めて比較';
    if(details.open && renderedDecision!==d){text.textContent=d?JSON.stringify({horizons:d.horizons,plan:d.plannedSteps,targetEta:d.targetEta,reservationReview:d.reservationReview,comparison:d.comparison,unlockPaths:d.unlockPaths,goldenModel:d.goldenModel,candidates:d.allCandidates,warnings:d.warnings,timings:runtime.last?.timings},null,2):'';renderedDecision=d;}
    mode.textContent=runtime.config.observeOnly?'自動化を開始':'観測モードへ';mode.disabled=runtime.stopped;
    collapse.textContent=layout.collapsed()?'展開':'折りたたむ';collapse.setAttribute('aria-expanded',String(!layout.collapsed()));
  }
  document.body.append(root);
  const layout=attachPanelLayout(root,title,body,document);collapse.onclick=()=>{layout.toggle();render();};
  const previous=runtime.onUpdate;runtime.onUpdate=r=>{previous(r);if(runtime.stopped){layout.destroy();root.remove();}else render();};
  render();return {root,render};
}
