// Local-only integration harness. Official game assets are downloaded separately, never bundled.
import { createServer } from 'node:http';
import { readFileSync,existsSync,mkdirSync,writeFileSync } from 'node:fs';
import { resolve,extname } from 'node:path';
const root=resolve(import.meta.dirname,'..'),port=8765,origin='http://127.0.0.1:'+port;
const div=(id,children=' ',cls='')=>`<div id="${id}" class="${cls}">${children}</div>`;
const list=ids=>ids.split(' ').map(id=>div(id)).join('');
const structure=div('wrapper',div('topBar',list('topbarDashnet topbarOrteil topbarTumblr topbarTwitter topbarDiscord topbarMerch')+div('heralds',div('heraldsAmount'))+list('tinyglobe changeLanguage topbarOtherVersions topBarEnd'))+
  div('game',list('versionNumber')+div('loader','Loading...'+div('failedToLoad'))+div('offGameMessageWrap',div('offGameMessage'))+'<canvas id="backgroundCanvas"></canvas>'+list('goldenCookie seasonPopup shimmers alert particles sparkles notes darken toggleBox')+
  div('promptAnchor',div('prompt',list('promptContent promptClose'),'framed'))+
  div('ascend',div('ascendBG')+div('ascendZoomable',div('ascendContent',div('ascendUpgrades')))+div('ascendOverlay',div('ascendBox',div('ascendData1',div('ascendPrestige'))+div('ascendData2',div('ascendHCs'))+list('ascendButton ascendModeButton'))+div('ascendInfo')))+
  div('debug',list('devConsole debugLog'))+
  div('sectionLeft','<canvas id="backgroundLeftCanvas"></canvas>'+div('sectionLeftInfo')+div('cookies',div('cookiesPerSecond'),'title')+div('bakeryNameAnchor',div('bakeryName','','title'))+div('specialPopup','','framed prompt offScreen')+div('buffs','','crateBox')+div('cookieAnchor',list('bigCookie cookieNumbers'))+div('sectionLeftExtra'),'inset')+
  div('leftBeam','','separatorLeft')+div('rightBeam','','separatorRight')+
  div('sectionMiddle',div('comments',div('prefsButton','Options','panelButton')+div('statsButton','Stats','panelButton')+div('logButton',div('checkForUpdate'),'panelButton')+div('legacyButton',div('ascendMeterContainer',div('ascendMeter'))+list('ascendNumber ascendTooltip'),'panelButton')+div('commentsText',div('commentsText1','','commentsText')+div('commentsText2','','commentsText'))+div('lumps',list('lumpsIcon lumpsIcon2 lumpsAmount')),'inset title')+div('centerArea',div('buildingsTitle','Buildings','inset title zoneTitle')+div('buildingsMaster',div('buildingsMute'))+div('rows')+div('menu')),'inset')+
  div('sectionRight',div('smallSupport')+div('store',div('storeTitle','Store','inset title')+list('toggleUpgrades upgrades techUpgrades vaultUpgrades storeBulk products'))+list('detectAds support adPlaysaurus adAQ'))+
  div('tooltipAnchor',div('tooltip'))+div('preloadImages'),'') ,'onWeb');
const html=`<!doctype html><html><head><meta charset="utf-8"><base href="https://orteil.dashnet.org/cookieclicker/"><title>Cookie Auto isolated integration test</title><link rel="stylesheet" href="style.css?v=10c"><script>var VERSION=2.058,BETA=0,SAVESUFFIX='_rebuildTest',App=0,PRESETMODS=[],LOCAL=true;</script><script src="base64.js"></script><script src="${origin}/official-main.js"></script></head><body>${structure}<script src="${origin}/dist/Cookie_Clicker_Auto_Rebuild.user.js"></script><script type="module" src="${origin}/harness.mjs"></script></body></html>`;
const harness=`const p=document.createElement('aside');p.style.cssText='position:fixed;bottom:0;left:0;background:#fff;color:#111;z-index:2000000;padding:6px;font:12px sans-serif';p.innerHTML='<b>専用検証環境（通常セーブとは別）</b> <button id="test-report">診断を保存</button> <button id="test-reinject">新版を再注入</button> <pre id="test-status"></pre>';document.body.append(p);document.getElementById('test-report').onclick=async()=>{const r=window.__CC_SMART_AUTO_RUNTIME__;await fetch('${origin}/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(await r.diagnostics.exportAll())});};document.getElementById('test-reinject').onclick=()=>{const s=document.createElement('script');s.src='${origin}/dist/Cookie_Clicker_Auto_Rebuild.user.js?'+Date.now();document.body.append(s);};setInterval(()=>{const g=window.Game,r=window.__CC_SMART_AUTO_RUNTIME__;document.getElementById('test-status').textContent=JSON.stringify({ready:g?.ready,version:g?.version,cookies:g?.cookies,cps:g?.cookiesPs,buildings:g?.ObjectsById?.filter(b=>b.amount).map(b=>[b.id,b.amount]),upgrades:Object.values(g?.UpgradesById||{}).filter(u=>u.bought).map(u=>u.id),error:r?.error,cycle:r?.cycle,timings:r?.last?.timings,receipt:r?.last?.receipt,decision:r?.last?.decision?.selectedAction},null,1);},1000);`;
mkdirSync(resolve(root,'work'),{recursive:true});
createServer(async(req,res)=>{
  try{
    const pathname=new URL(req.url,origin).pathname;
    if(pathname==='/report' && req.method==='POST'){
      let data='';for await(const chunk of req){data+=chunk;if(data.length>30_000_000)throw new Error('report-too-large');}
      JSON.parse(data);writeFileSync(resolve(root,'work/live-diagnostics.json'),data);res.end('saved');return;
    }
    if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end(req.url.includes('?fresh')?html.replace("SAVESUFFIX='_rebuildTest'","SAVESUFFIX='_rebuildFreshAlpha2'"):html);return;}
    if(pathname==='/harness.mjs'){res.setHeader('Content-Type','text/javascript');res.end(harness);return;}
    const path=pathname==='/official-main.js'?resolve(root,'../game-main.js'):resolve(root,'.'+pathname);
    if((pathname!=='/official-main.js' && !path.startsWith(root+'/') && !path.startsWith(root+'\\')) || !existsSync(path)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',extname(path)==='.json'?'application/json':'text/javascript');res.end(readFileSync(path));
  }catch(e){res.writeHead(500);res.end(String(e.message));}
}).listen(port,'127.0.0.1',()=>console.log(origin));
