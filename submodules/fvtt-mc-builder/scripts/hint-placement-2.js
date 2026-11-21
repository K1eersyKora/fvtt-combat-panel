const gap=8;
const panels=[
  '#sidebar-content.expanded','#sidebar-tabs','#dsh-bg3-hud','#dsh-bg3-tooltip','#hotbar',
  '#mcb-move-toggle','#mcb-jump-toggle','#visual-active-effects .effect-icon',
  '#dsh-cp-lock','.dsh-cp-drag','.dsh-cp-drag b','.dsh-cp-drag .bg3-target-hint','.mcb-token-feet',
  '#scene-navigation .scene','#scene-controls .controls','#clip-navigation input',
  '#notifications .notification','.application:has(> .window-header)'
].join(',');
const hints=new Map();
let frame=0,poll=0;

function rect(x,y,w,h){return {left:x,top:y,right:x+w,bottom:y+h};}
function clamp(n,min,max){return Math.max(min,Math.min(max,n));}
function overlap(a,b){
  return Math.max(0,Math.min(a.right,b.right+gap)-Math.max(a.left,b.left-gap))
       * Math.max(0,Math.min(a.bottom,b.bottom+gap)-Math.max(a.top,b.top-gap));
}

export function placeHint(x,y,w,h,view,obstacles){
  const fitX=n=>clamp(n,view.left+gap,view.right-gap-w);
  const fitY=n=>clamp(n,view.top+gap,view.bottom-gap-h);
  x=fitX(x);y=fitY(y);
  const preferred=rect(x,y,w,h);
  if(!obstacles.some(b=>overlap(preferred,b)>0))return preferred;
  const xs=new Set([x]),ys=new Set([y]);
  for(const b of obstacles){
    xs.add(fitX(b.left-gap-w));xs.add(fitX(b.right+gap));
    ys.add(fitY(b.top-gap-h));ys.add(fitY(b.bottom+gap));
  }
  let best=preferred,least=Infinity,nearest=Infinity;
  for(const left of xs)for(const top of ys){
    const distance=(left-x)**2+(top-y)**2;
    if(least===0&&distance>=nearest)continue;
    const candidate=rect(left,top,w,h);
    const covered=obstacles.reduce((n,b)=>n+overlap(candidate,b),0);
    if(covered<least||(covered===least&&distance<nearest)){best=candidate;least=covered;nearest=distance;}
  }
  return best;
}

function visible(el){
  return el?.isConnected&&!el.hidden&&!el.classList.contains('dsh-cp-hidden')
    &&(el.checkVisibility?.({checkOpacity:true,checkVisibilityCSS:true})??!!el.getClientRects().length);
}
function write(el,key,value){if(el.style[key]!==value)el.style[key]=value;}
function layout(){
  frame=0;clearTimeout(poll);poll=0;
  const priority = {hit:0, move:1, 'native-move':1};
  const active=[...hints.values()].filter(h=>visible(h.el))
    .sort((a,b)=>(priority[a.kind]??2)-(priority[b.kind]??2));
  if(!active.length)return;
  const view={left:0,top:0,right:innerWidth,bottom:innerHeight};
  const obstacles=[...document.querySelectorAll(panels)].filter(visible).map(el=>el.getBoundingClientRect())
    .filter(r=>r.width&&r.height&&r.right>0&&r.bottom>0&&r.left<view.right&&r.top<view.bottom);
  for(const h of active){
    const {width:w,height}=h.el.getBoundingClientRect();
    const legacyHit=h.kind==='hit', prediction=h.kind.startsWith('prediction:');
    const x=legacyHit||prediction?h.x-w/2:h.x, y=legacyHit?h.y-height:h.y;
    let box;
    if(prediction&&y+height+gap<=view.bottom){
      const below={...view,top:Math.max(0,y-gap)};
      box=placeHint(x,y,w,height,below,obstacles);
      if(obstacles.some(b=>overlap(box,b)>0))box=null;
    }
    box??=placeHint(x,y,w,height,view,obstacles);
    if(legacyHit){
      write(h.el,'left',(box.left+w/2).toFixed(2)+'px');write(h.el,'top',(box.top+height).toFixed(2)+'px');
    }else write(h.el,'transform',`translate(${box.left.toFixed(2)}px,${box.top.toFixed(2)}px)`);
    obstacles.push(box);
  }
  // Sidebar and floating window transitions can move without a pointer event.
  poll=setTimeout(schedule,120);
}
function schedule(){if(!frame)frame=requestAnimationFrame(layout);}
export function anchorHint(kind,el,x,y){
  const old=hints.get(kind);
  if(old?.el===el&&old.x===x&&old.y===y){if(!poll&&!frame)schedule();return;}
  if(old?.el!==el){
    old?.resize.disconnect();old?.visibility.disconnect();
    const resize=new ResizeObserver(schedule),visibility=new MutationObserver(schedule);
    resize.observe(el);visibility.observe(el,{attributes:true,attributeFilter:['class','hidden']});
    hints.set(kind,{kind,el,resize,visibility});
  }
  Object.assign(hints.get(kind),{x,y});schedule();
}
export function releaseHint(kind){
  const h=hints.get(kind);if(!h)return;
  h.resize.disconnect();h.visibility.disconnect();hints.delete(kind);schedule();
}
