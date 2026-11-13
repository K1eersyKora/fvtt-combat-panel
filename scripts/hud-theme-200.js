import {readPerformance, PERFORMANCE_HOOK} from './performance-199.js';
const ID = 'fvtt-combat-panel';
export const COLOR_KEYS = ['highlight', 'edgeStart', 'edgeEnd', 'base'];
export const DEFAULT_PRESETS = [
  {id:'aurora',name:'极光青金',colors:{highlight:'#f0d69b',edgeStart:'#9ce3df',edgeEnd:'#bd9ee8',base:'#162630'}},
  {id:'moon',name:'月辉冰蓝',colors:{highlight:'#94e6ff',edgeStart:'#69c9f4',edgeEnd:'#747de5',base:'#101e36'}},
  {id:'rose',name:'暮色紫晶',colors:{highlight:'#efb8ff',edgeStart:'#d88ce7',edgeEnd:'#faac9b',base:'#2b1738'}},
];
const copy = value => structuredClone(value);
const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value ?? '') ? value.toLowerCase() : fallback;
export function normalizeColors(value) {
  return Object.fromEntries(COLOR_KEYS.map(key => [key,color(value?.[key],DEFAULT_PRESETS[0].colors[key])]));
}
export function normalizeTheme(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const ids = new Set();
  const presets = (Array.isArray(value.presets) ? value.presets : DEFAULT_PRESETS).filter(p => {
    if (!p || typeof p.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id) || ids.has(p.id)) return false;
    ids.add(p.id);return true;
  }).map(p => ({id:p.id,name:String(p.name || '未命名预设').trim().slice(0,32),colors:normalizeColors(p.colors)}));
  if (!presets.length) presets.push(...copy(DEFAULT_PRESETS));
  const valid = id => presets.some(p => p.id === id);
  const activeId = valid(value.activeId) ? value.activeId : presets[0].id;
  const seconds = Number(value.rgb?.seconds);
  return {presets,activeId,draft:normalizeColors(value.draft ?? presets.find(p => p.id === activeId).colors),
    rgb:{enabled:value.rgb?.enabled === true,fromId:valid(value.rgb?.fromId) ? value.rgb.fromId : presets[0].id,
      toId:valid(value.rgb?.toId) ? value.rgb.toId : (presets[1] ?? presets[0]).id,
      seconds:Number.isFinite(seconds) ? Math.min(30,Math.max(2,seconds)) : 8}};
}
export function readTheme() { return normalizeTheme(game.user?.getFlag(ID,'hudTheme')); }
export function mixColor(a,b,t) {
  return '#'+[1,3,5].map(i => Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');
}
export function hexToHSV(hex) {
  const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
  const hue=!delta?0:max===r?((g-b)/delta)%6:max===g?(b-r)/delta+2:(r-g)/delta+4;
  return {h:(hue*60+360)%360,s:max?delta/max:0,v:max};
}
export function hsvToHex({h,s,v}) {
  const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;
  const rgb=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
  return '#'+rgb.map(n=>Math.round((n+m)*255).toString(16).padStart(2,'0')).join('');
}
// Only module-owned surfaces inherit live colors. Never animate the document root.
const THEME_ROOTS='#dsh-bg3-hud,.bg3-scale-popover,.bg3-free-dialog,#dsh-bg3-tooltip,#dsh-cp-hit,.cp-hud-settings,[data-combat-panel-theme],#cp-party-panel,.cp-party-menu,.cp-lock-dialog,.cp-party-size-popover,#cp-story-ui,#cp-peer-inspector,.bg3-dm-dialog,.bg3-player-overlay,.bg3-check-consent';
const RGB_INTERVAL=50;
export class HUDTheme {
  constructor() {
    this.state=readTheme();this.epoch=performance.now();this.frame=null;this.timer=null;
    this.roots=new Map();this.colors=this.state.draft;this.pending=0;this.queue=Promise.resolve();
    this.saved=JSON.stringify(this.state);
    this.visibility=new IntersectionObserver(entries=>{
      let changed=false;
      for(const entry of entries){const root=this.roots.get(entry.target);if(!root)continue;const visible=entry.isIntersecting;if(root.visible!==visible){root.visible=visible;changed=true;if(visible)this.write(entry.target,root,this.currentColors());}}
      if(changed)this.restart();
    });
    this.onVisibility=()=>this.restart();document.addEventListener('visibilitychange',this.onVisibility);
    this.hook=Hooks.on('updateUser',(user,change)=>{if(user.id===game.user.id&&change.flags?.[ID]?.hudTheme&&!this.pending){this.saved=JSON.stringify(readTheme());this.set(readTheme());}});
    this.performanceHook=Hooks.on(PERFORMANCE_HOOK,()=>this.restart());
    // Floating HUDs/dialogs are body children. Do not observe every item/chat mutation.
    this.mounts=new MutationObserver(records=>{
      for(const record of records)for(const node of record.addedNodes)this.discover(node);
      for(const el of this.roots.keys())if(!el.isConnected)this.detach(el);
    });
    this.mounts.observe(document.body,{childList:true});
    this.applicationHook=Hooks.on('renderApplication',(app,html)=>this.discover(html?.[0]??html));
    this.discover(document.body);this.restart();
  }
  discover(node){
    if(node?.nodeType!==1)return;
    if(node.matches(THEME_ROOTS))this.attach(node);
    for(const el of node.querySelectorAll(THEME_ROOTS))this.attach(el);
  }
  attach(el){
    if(this.roots.has(el)||el.parentElement?.closest(THEME_ROOTS))return;
    const root={visible:false,written:{}};this.roots.set(el,root);
    el.dataset.cpRgb=String(this.animated());this.write(el,root,this.currentColors());this.visibility.observe(el);
  }
  detach(el){this.visibility.unobserve(el);this.roots.delete(el);if(!this.hasVisibleRoot())this.stop();}
  animated(){return this.state.rgb.enabled&&readPerformance().animate;}
  hasVisibleRoot(){return [...this.roots].some(([el,root])=>el.isConnected&&root.visible);}
  set(value){
    const next=normalizeTheme(value),now=performance.now();
    if(next.rgb.seconds!==this.state.rgb.seconds)this.epoch=now-(now-this.epoch)*next.rgb.seconds/this.state.rgb.seconds;
    this.state=next;this.restart();
  }
  currentColors(now=performance.now()){
    const s=this.state;if(!this.animated())return s.draft;
    const a=s.presets.find(p=>p.id===s.rgb.fromId).colors,b=s.presets.find(p=>p.id===s.rgb.toId).colors;
    const t=(1-Math.cos((now-this.epoch)/(s.rgb.seconds*1000)*Math.PI))/2;
    return Object.fromEntries(COLOR_KEYS.map(k=>[k,mixColor(a[k],b[k],t)]));
  }
  write(el,root,colors){
    for(const key of COLOR_KEYS)if(root.written[key]!==colors[key]){el.style.setProperty('--cp-theme-'+key,colors[key]);root.written[key]=colors[key];}
  }
  paint(colors,all=false){
    this.colors=colors;
    for(const[el,root]of this.roots){if(!el.isConnected){this.detach(el);continue;}if(all||root.visible)this.write(el,root,colors);}
  }
  stop(){if(this.frame!==null)cancelAnimationFrame(this.frame);clearTimeout(this.timer);this.frame=null;this.timer=null;}
  restart(){
    this.stop();const animated=this.animated();
    for(const el of this.roots.keys())if(el.dataset.cpRgb!==String(animated))el.dataset.cpRgb=String(animated);
    if(document.hidden)return;
    if(!animated){this.paint(this.state.draft,true);return;}
    if(!this.hasVisibleRoot())return;
    const tick=now=>{this.frame=null;if(document.hidden||!this.hasVisibleRoot())return;this.paint(this.currentColors(now));this.timer=setTimeout(()=>{this.timer=null;this.frame=requestAnimationFrame(tick);},RGB_INTERVAL);};
    tick(performance.now());
  }
  save(value){
    const snapshot=normalizeTheme(value),key=JSON.stringify(snapshot);this.set(snapshot);
    if(!this.pending&&key===this.saved)return Promise.resolve();
    this.nextSave={snapshot,key};if(this.pending)return this.queue;
    this.pending=1;
    this.queue=(async()=>{
      try{while(this.nextSave){const next=this.nextSave;this.nextSave=null;if(next.key!==this.saved){await game.user.setFlag(ID,'hudTheme',next.snapshot);this.saved=next.key;}}}
      catch(error){this.nextSave=null;this.set(readTheme());throw error;}
      finally{this.pending=0;}
    })();return this.queue;
  }
  destroy(){
    this.stop();this.mounts.disconnect();this.visibility.disconnect();this.roots.clear();
    document.removeEventListener('visibilitychange',this.onVisibility);Hooks.off('updateUser',this.hook);Hooks.off(PERFORMANCE_HOOK,this.performanceHook);Hooks.off('renderApplication',this.applicationHook);
  }
}
export function installHUDTheme(hud){hud.theme=new HUDTheme();Hooks.once('shutdown',()=>hud.theme.destroy());return hud.theme;}
