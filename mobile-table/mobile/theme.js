export const presets=[
  {name:'极光青金',colors:{highlight:'#f0d69b',edgeStart:'#9ce3df',edgeEnd:'#bd9ee8',base:'#162630'}},
  {name:'月辉冰蓝',colors:{highlight:'#94e6ff',edgeStart:'#69c9f4',edgeEnd:'#747de5',base:'#101e36'}},
  {name:'暮色紫晶',colors:{highlight:'#efb8ff',edgeStart:'#d88ce7',edgeEnd:'#faac9b',base:'#2b1738'}}
];
const names={highlight:'高亮',edgeStart:'渐变起色',edgeEnd:'渐变尾色',base:'面板底色'},keys=Object.keys(names);
const color=c=>/^#[0-9a-f]{6}$/i.test(c),valid=c=>c&&keys.every(k=>color(c[k]));
const $=id=>document.getElementById(id);
const get=(k,f)=>{try{return JSON.parse(localStorage.getItem(k))??f;}catch{return f;}};
const rgb=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));
const hex=v=>'#'+v.map(n=>Math.round(n).toString(16).padStart(2,'0')).join('');
const mix=(a,b,t)=>hex(rgb(a).map((v,i)=>v+(rgb(b)[i]-v)*t));
function hsv(c){
  const [r,g,b]=rgb(c).map(i=>i/255),v=Math.max(r,g,b),d=v-Math.min(r,g,b);
  return {h:d?((v===r?(g-b)/d:v===g?(b-r)/d+2:(r-g)/d+4)*60+360)%360:0,s:v?d/v:0,v};
}
function fromHSV({h,s,v}){
  const f=n=>{const k=(n+h/60)%6;return (v-v*s*Math.max(0,Math.min(k,4-k,1)))*255;};return hex([f(5),f(3),f(1)]);
}
let native=null;try{native=JSON.parse(window.TableDisplay?.getPalette?.()||'null');}catch{}
let saved=get('table-custom-theme',native?.mode==='custom'?native.colors:null);
if(!valid(saved))saved=null;
let remote=get('table-panel-theme',null);
if(!valid(remote?.colors))remote={name:'极光青金',colors:valid(native?.colors)?native.colors:presets[0].colors};
let draft,openingPalette,channel='highlight',pick={h:0,s:0,v:0},timer,current,callback,editing=false;
let lastNative='';
export const themeColors=()=>current||presets[0].colors;
function paint(colors){
  if(!valid(colors))return;current=colors;
  const root=document.documentElement,st=root.style;
  for(const k of keys)st.setProperty('--cp-theme-'+k,colors[k]);
  const [r,g,b]=rgb(colors.base).map(x=>{const v=x/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
  const light=.2126*r+.7152*g+.0722*b>.29;
  st.setProperty('--ink',light?'#111621':'#eee7d6');st.setProperty('--dim',light?'#32394a':'#afbdc6');
  st.setProperty('--accent-ink',light?mix(colors.highlight,'#161e2a',.64):colors.highlight);
  st.setProperty('--edge-ink',light?mix(colors.edgeStart,'#161e2a',.58):colors.edgeStart);
  const tone=light?'light':'dark';
  st.colorScheme=tone;
  root.dataset.themeTone=tone;
  document.querySelector('meta[name="theme-color"]').content=colors.base;callback?.();
}
function nativeSave(){
  const c=saved||remote.colors,mode=saved?'custom':'follow',stamp=JSON.stringify([mode,c]);
  if(stamp===lastNative)return;lastNative=stamp;window.TableDisplay?.savePalette?.(mode,...keys.map(k=>c[k]));
}
function apply(){
  clearInterval(timer);
  if(editing){paint(draft);return;}
  const c=saved||remote.colors;paint(c);nativeSave();
  const cycle=!saved&&remote.rgb;
  if(cycle&&valid(cycle.from)&&valid(cycle.to)&&!document.hidden&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
    const tick=()=>{const t=(1-Math.cos((Date.now()-cycle.epoch)/(Math.max(2,cycle.seconds)*1000)*Math.PI))/2;
      paint(Object.fromEntries(keys.map(k=>[k,mix(cycle.from[k],cycle.to[k],t)])));};
    tick();timer=setInterval(tick,100);
  }
}
export function syncTheme(value){
  const next=valid(value?.colors)?value:{name:'极光青金',colors:presets[0].colors};
  if(JSON.stringify(next)===JSON.stringify(remote))return;remote=next;localStorage.setItem('table-panel-theme',JSON.stringify(next));apply();
}
function fields(){
  const c=draft[channel];$('hex').value=c.toUpperCase();$('hex').setAttribute('aria-invalid','false');$('colorError').textContent='';
  const modified=keys.some(k=>draft[k]!==openingPalette[k]),preset=presets.find(p=>keys.every(k=>p.colors[k]===draft[k]));
  $('themeOrigin').textContent=modified?'未保存预览 · '+(preset?.name||'自定义'):(saved?'本机自定义':'跟随战斗面板 · '+remote.name);
  $('hue').value=String(Math.round(pick.h));$('sv').style.setProperty('--h',String(pick.h));const dot=$('sv').querySelector('b');dot.style.left=(100*pick.s)+'%';dot.style.top=(100*(1-pick.v))+'%';
  for(const b of $('channels').children){const key=b.dataset.key;b.classList.toggle('active',key===channel);b.setAttribute('aria-pressed',String(key===channel));b.style.setProperty('--swatch',draft[key]);}
  for(const b of $('presets').children){const match=keys.every(k=>presets[b.dataset.i].colors[k]===draft[k]);b.classList.toggle('active',match);b.setAttribute('aria-pressed',String(match));}
  $('saveTheme').disabled=false;
}
function finish(){editing=false;$('appearance').close();apply();}
export function installTheme(onChange){
  callback=onChange;
  presets.forEach((p,i)=>{const b=document.createElement('button');b.dataset.i=i;const strip=document.createElement('i');strip.style.background='linear-gradient(110deg,'+p.colors.highlight+','+p.colors.edgeStart+','+p.colors.edgeEnd+')';b.append(strip,document.createTextNode(p.name));
    b.onclick=()=>{draft={...p.colors};pick=hsv(draft[channel]);fields();apply();};$('presets').append(b);});
  for(const [key,label] of Object.entries(names)){const b=document.createElement('button');b.dataset.key=key;const chip=document.createElement('i');b.append(chip,document.createTextNode(label));
    b.onclick=()=>{channel=key;pick=hsv(draft[key]);fields();};$('channels').append(b);}
  $('openPalette').onclick=()=>{draft={...themeColors()};openingPalette={...draft};editing=true;channel='highlight';pick=hsv(draft[channel]);
    fields();apply();$('appearance').showModal();};
  $('themeClose').onclick=finish;$('appearance').oncancel=e=>{e.preventDefault();finish();};
  $('followTheme').onclick=()=>{saved=null;localStorage.removeItem('table-custom-theme');finish();};
  $('saveTheme').onclick=()=>{if(!color($('hex').value))return;saved={...draft};localStorage.setItem('table-custom-theme',JSON.stringify(saved));finish();};
  $('hex').oninput=()=>{let v=$('hex').value.trim();if(/^[0-9a-f]{6}$/i.test(v))v='#'+v;
    if(!color(v)){$('colorError').textContent='输入 6 位十六进制颜色';$('hex').setAttribute('aria-invalid','true');$('saveTheme').disabled=true;return;}
    draft[channel]=v.toLowerCase();pick=hsv(draft[channel]);fields();apply();};
  $('hue').oninput=()=>{pick.h=Number($('hue').value);draft[channel]=fromHSV(pick);fields();apply();};
  const sv=$('sv'),point=e=>{const r=sv.getBoundingClientRect();pick.s=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width));pick.v=1-Math.min(1,Math.max(0,(e.clientY-r.top)/r.height));draft[channel]=fromHSV(pick);fields();apply();};
  sv.onpointerdown=e=>{sv.setPointerCapture(e.pointerId);point(e);};sv.onpointermove=e=>{if(sv.hasPointerCapture(e.pointerId))point(e);};
  document.addEventListener('visibilitychange',apply);apply();
}
