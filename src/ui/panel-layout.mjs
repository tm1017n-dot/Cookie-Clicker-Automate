const KEY='CC_REBUILD_PANEL_V1';
export function attachPanelLayout(root,handle,body,document){
  const view=document.defaultView;
  let state={left:12,top:60,width:368,height:null,collapsed:false},drag=null,timer=null;
  try{const saved=JSON.parse(view.localStorage.getItem(KEY));if(saved){for(const key of ['left','top','width','height'])if(Number.isFinite(saved[key])&&saved[key]>=0)state[key]=saved[key];state.collapsed=saved.collapsed===true;}}catch{}
  function persist(){try{view.localStorage.setItem(KEY,JSON.stringify(state));}catch{}}
  function apply(){
    state.width=Math.min(view.innerWidth,Math.max(240,state.width));
    state.left=Math.max(0,Math.min(view.innerWidth-state.width,state.left));
    state.top=Math.max(0,Math.min(Math.max(0,view.innerHeight-100),state.top));
    root.style.left=state.left+'px';root.style.top=state.top+'px';root.style.width=state.width+'px';
    root.style.maxHeight=Math.max(40,view.innerHeight-state.top)+'px';
    root.style.minWidth=Math.min(240,view.innerWidth)+'px';
    root.style.minHeight=state.collapsed?'0':Math.min(180,view.innerHeight-state.top)+'px';
    root.style.height=state.collapsed || state.height===null?'auto':Math.min(state.height,view.innerHeight-state.top)+'px';
    root.style.resize=state.collapsed?'none':'both';body.hidden=state.collapsed;
  }
  function capture(){const box=root.getBoundingClientRect();state.left=box.left;state.top=box.top;state.width=box.width;if(!state.collapsed)state.height=box.height;persist();}
  handle.onpointerdown=e=>{if(e.button!==0)return;const box=root.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX-box.left,y:e.clientY-box.top};handle.setPointerCapture(e.pointerId);e.preventDefault();};
  handle.onpointermove=e=>{if(!drag || drag.id!==e.pointerId)return;state.left=e.clientX-drag.x;state.top=e.clientY-drag.y;apply();};
  handle.onpointerup=handle.onpointercancel=()=>{drag=null;capture();};
  handle.onlostpointercapture=()=>{drag=null;};
  handle.tabIndex=0;handle.setAttribute('aria-label','パネルを移動。矢印キーでも移動できます');
  handle.onkeydown=e=>{const delta={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]}[e.key];if(!delta)return;e.preventDefault();state.left+=delta[0];state.top+=delta[1];apply();persist();};
  const onResize=()=>{apply();persist();};view.addEventListener('resize',onResize);
  const observer=typeof view.ResizeObserver==='function'?new view.ResizeObserver(()=>{view.clearTimeout(timer);timer=view.setTimeout(capture,200);}):null;
  apply();observer?.observe(root);
  return {
    collapsed:()=>state.collapsed,
    toggle(){if(!state.collapsed)capture();state.collapsed=!state.collapsed;apply();persist();},
    reset(){state={left:12,top:60,width:368,height:null,collapsed:false};apply();persist();},
    destroy(){observer?.disconnect();view.clearTimeout(timer);view.removeEventListener('resize',onResize);}
  };
}
