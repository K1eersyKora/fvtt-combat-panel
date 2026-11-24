import {panelTheme} from './panel-theme-3.mjs';
const fail = message => { throw Error(message); };
const validPoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const xy = p => ({x:p.x,y:p.y});
const visible = t => t && !t.destroyed && t.visible && t.isVisible !== false && !t.document.hidden;
function player() {
  if(!game.ready || game.user.isGM || game.user.role < 1) fail('请使用普通玩家账号');
  if(!canvas.ready || game.Levels3DPreview?._active) fail('请打开二维地图');
}
function source() {
  player();
  const t=canvas.tokens.controlled.find(t=>t.isOwner && visible(t)) ??
    canvas.tokens.placeables.find(t=>t.actor?.id===game.user.character?.id && t.isOwner && visible(t));
  if(!t?.actor) fail('请在 PL 窗口选中自己拥有的棋子');
  return t;
}
function tokenRow(t) {
  const d=t.document;
  return {id:t.id,name:(t.isOwner || t.nameplate?.visible)?t.name:'场上目标',x:t.center.x,y:t.center.y,w:t.w,h:t.h,rotation:t.mesh?.angle||0};
}
function remaining(t) {
  if(!game.combat?.started || !game.combat.combatants.some(c=>c.tokenId===t.id))return null;
  const speed=Number(t.actor.system.attributes?.movement?.walk);
  if(!Number.isFinite(speed)||speed<=0)return null;
  const spent=t.document.movementHistory.reduce((n,w)=>n+(Number.isFinite(w.cost)?w.cost:0),0);
  return Math.max(0,speed-spent);
}
export function state() {
  player();
  let t;try{t=source();}catch{}
  const m=canvas.stage.worldTransform, screen=canvas.app.renderer.screen;
  return {user:game.user.name,scene:canvas.scene.id,sceneName:canvas.scene.name,theme:panelTheme(),
    view:[m.a,m.b,m.c,m.d,m.tx,m.ty,screen.width,screen.height],
    grid:canvas.grid.size,unit:canvas.grid.distance,units:canvas.scene.grid.units,
    source:t?{...tokenRow(t),remaining:remaining(t)}:null,
    targets:canvas.tokens.placeables.filter(visible).map(tokenRow)};
}
const slotEntries = actor => Object.entries(actor.system.spells||{}).filter(([key,s])=>(/^spell[1-9]$/.test(key)||key==='pact') && Number(s.max)>0)
  .map(([id,s])=>({id,level:Number(s.level)||Number(id.slice(5)),value:Number(s.value)||0,max:Number(s.max)}));
function describe(item,a) {
  const template=a.target?.template, affects=a.target?.affects;
  const teleport=item.system.identifier==='misty-step'||/^(迷踪步|迷蹤步|Misty Step)$/i.test(item.name);
  const type=template?.type||'',shape=({sphere:'circle',radius:'circle',cylinder:'circle',emanation:'circle',emanationNoTemplate:'circle',cone:'cone',line:'line',wall:'line',cube:'square',square:'square',squareRadius:'square'})[type];
  let mode=shape?'area':affects?.type==='self'?'self':(affects?.type || ['attack','heal','save'].includes(a.type))?'target':'self';
  if(teleport)mode='teleport';
  const count=Number(affects?.count);
  return {key:item.id+'/'+a.id,name:item.name,identifier:item.system.identifier||'',activity:a.name||item.name,type:a.type,group:item.type,mode,shape:shape||'',size:Number(template?.size)||0,
    width:Number(template?.width)||5,anchored:a.range?.units==='self',max:count>0?count:(affects?.choice?30:1),
    level:Number(item.system.level)||0,needsSlot:item.type==='spell'&&Number(item.system.level)>0 && !!a.consumption?.spellSlot,
    uses:(item.system.uses?.max!=null && String(item.system.uses.max)!=='')?Math.max(0,Number(item.system.uses.max)-Number(item.system.uses.spent||0)):null};
}
function getAction(t,key) {
  const [itemId,activityId]=String(key).split('/'),item=t.actor.items.get(itemId),act=item?.system.activities?.get(activityId);
  if(!act)fail('角色卡上的活动已变化，请重新打开');return {item,act,info:describe(item,act)};
}
const readableDescriptions=new Map();
function description(html){
  if(typeof html!=='string'||!html)return '';
  if(readableDescriptions.has(html))return readableDescriptions.get(html);
  const dom=new DOMParser().parseFromString(html,'text/html');
  for(const node of dom.querySelectorAll('.secret:not(.revealed),[data-visibility="gm"],script,style,iframe,object'))node.remove();
  for(const block of dom.querySelectorAll('p,div,li,br,h1,h2,h3,h4,tr'))block.append(document.createTextNode('\n'));
  const text=dom.body.textContent.replace(/@(?:UUID|Compendium)\[[^\]]+\]\{([^}]+)\}/g,'$1').replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n').trim();
  if(readableDescriptions.size>=512)readableDescriptions.delete(readableDescriptions.keys().next().value);
  readableDescriptions.set(html,text);return text;
}
export function sheet(){
  if(!game.ready||game.user.isGM)fail('需要玩家桌位');
  let t;try{t=source();}catch{}
  const actor=t?.actor??game.user.character;if(!actor?.isOwner)fail('没有可读取的玩家角色卡');
  const actions=[];
  for(const item of actor.items)for(const a of item.system.activities?.values?.()||[]){
    if(a.activation?.type==='legendary'||a.type==='forward'&&!a.item)continue;
    actions.push(describe(item,a));
  }
  const attributes=actor.system.attributes||{},hp=attributes.hp;
  const abilities=Object.entries(actor.system.abilities||{}).map(([id,s])=>({id,value:s.value,mod:s.mod,save:s.save?.value??s.save?.mod??s.save??null})).map(a=>({...a,save:Number.isFinite(a.save)?a.save:null}));
  const inventory=actor.items.map(i=>({id:i.id,name:i.name,group:i.type,quantity:i.system.quantity??null,
    equipped:i.system.equipped??null,description:description(i.system.description?.value)}));
  const skills=Object.entries(actor.system.skills||{}).map(([id,v])=>({id,mod:Number.isFinite(v.total)?v.total:v.mod,label:game.i18n.localize(CONFIG.DND5E?.skills?.[id]?.label||id)}));
  return {actorId:actor.id,actor:actor.name,source:t?.id??null,hp:hp?{value:hp.value,max:hp.max,temp:hp.temp||0}:null,
    ac:attributes.ac?.value??null,level:actor.system.details?.level??null,speed:attributes.movement?.walk??null,
    biography:description(actor.system.details?.biography?.value),abilities,skills,conditions:[...(actor.statuses||[])].sort(),inventory,slots:slotEntries(actor),actions};
}
function checkContext(t,cmd) {
  if(cmd.scene!==canvas.scene.id || cmd.source!==t.id)fail('场景或角色已改变，请重新选择');
  if(!validPoint(cmd.origin)||Math.hypot(cmd.origin.x-t.center.x,cmd.origin.y-t.center.y)>1)fail('角色已经移动，请重新规划');
}
function within(p){return validPoint(p)&&canvas.dimensions.sceneRect.contains(p.x,p.y);}
function makePath(t,cmd) {
  if(!Array.isArray(cmd.points)||!cmd.points.length||cmd.points.length>40||cmd.points.some(p=>!within(p)))fail('请选择地图内的有效路径');
  const origin={x:t.document.x,y:t.document.y,elevation:t.document.elevation};
  const steps=cmd.points.map(p=>({...t.document.getSnappedPosition({x:p.x-(t.center.x-origin.x),y:p.y-(t.center.y-origin.y)}),explicit:true}));
  const route=[origin,...steps], [path,blocked]=t.constrainMovementPath(route,{preview:true});
  const cost=t.document.measureMovementPath(path).cost;
  const budget=remaining(t);
  const reason=game.paused?'游戏已暂停':blocked?'路线受阻，请调整路径':budget!==null&&cost>budget+0.001?'超出本回合步行余量':'';
  return {steps,cost,budget,reason,preview:path.slice(1).map(p=>({x:p.x+t.w/2,y:p.y+t.h/2}))};
}
function target(t,id) {const other=canvas.tokens.get(id);if(!visible(other))fail('目标已离开视野，请重新选择');return other;}
function setTargets(tokens){
  for(const current of [...game.user.targets])if(!tokens.includes(current))current.setTarget(false,{releaseOthers:false,user:game.user});
  for(const t of tokens)if(!game.user.targets.has(t))t.setTarget(true,{releaseOthers:false,user:game.user});
}
const panelModule='fvtt-combat-panel';
const iconCache=new Map();
export async function displayIcon(src,naturalSize=false){
  if(!src)return null;
  const key=naturalSize?'chat:'+src:src;
  if(iconCache.has(key))return iconCache.get(key);
  const img=new Image();img.crossOrigin='anonymous';img.src=new URL(src,document.baseURI).href;
  try{await img.decode();const c=document.createElement('canvas');c.width=c.height=72;const ctx=c.getContext('2d');
    const k=Math.min(72/img.naturalWidth,72/img.naturalHeight),w=img.naturalWidth*k,h=img.naturalHeight*k;
    if(naturalSize){c.width=Math.max(1,Math.round(w));c.height=Math.max(1,Math.round(h));}
    ctx.drawImage(img,(c.width-w)/2,(c.height-h)/2,w,h);const uri=c.toDataURL('image/webp',.87);
    if(iconCache.size>=300)iconCache.delete(iconCache.keys().next().value);iconCache.set(key,uri);return uri;
  }catch{return null;}
}
let predictionApi;
async function prediction(t,cmd) {
  const {act}=getAction(t,cmd.key), other=target(t,cmd.target);
  if(!['attack','save'].includes(act.type))return {label:act.type==='heal'?'治疗无需命中检定':'此能力无需命中检定'};
  if(!game.modules.get(panelModule)?.active)return {label:'战斗预测模组未启用'};
  const url=name=>foundry.utils.getRoute('modules/'+panelModule+'/scripts/'+name);
  try{
    predictionApi??=Promise.all([import(url('prediction-policy-156.js')),import(url('prediction-147.js')),import(url('workflow-preview-147.js'))]);
    const [policy,predict,workflow]=await predictionApi;
    if(!policy.getPredictionPolicy(game.user).probability)return {label:'当前设置未向玩家显示概率'};
    const result=await predict.computePreview({actor:t.actor,sourceToken:t,activity:act,targetToken:other,workflowResolver:workflow.workflowAttackPreview});
    if(!policy.getPredictionPolicy(game.user).probability||!visible(other))return {label:'暂无可见预测'};
    const label=result.kind==='save'?'目标豁免失败率':'命中率';
    return {label,percent:Number.isFinite(result.chance)?Math.round(result.chance*100):null,mode:result.mode};
  }catch {predictionApi=null;return {label:'当前活动暂无可用预测'};}
}
function checkRange(t,act,p) {
  const r=act.range||{}, limits={ft:1,mi:5280,m:1,km:1000,touch:1};
  const limit=r.units==='touch'?canvas.grid.distance:Number(r.value)*limits[r.units];
  if(Number.isFinite(limit)&&limit>0&&canvas.grid.measurePath([t.center,p]).distance>limit+0.01)fail('超出施法距离');
}
function confirmedTemplate(act,point) {
  const hook=Hooks.on('dnd5e.createActivityTemplate',(used,templates)=>{
    if(used.uuid!==act.uuid && used.item?.system?.linkedActivity?.uuid!==act.uuid)return;
    for(const template of templates)template.drawPreview=async()=>{
      if(templates.length!==1)fail('当前能力需要多个模板，请在电脑选择');
      template.document.updateSource(point);
      return canvas.scene.createEmbeddedDocuments('MeasuredTemplate',[template.document.toObject()]);
    };
  });
  return ()=>Hooks.off('dnd5e.createActivityTemplate',hook);
}
function templatePlacement(t,act,info,cmd) {
  if(info.mode!=='area'||!within(cmd.point)||!Number.isFinite(cmd.direction))fail('请选择地图内的有效范围');
  const factory=game.dnd5e?.canvas?.AbilityTemplate??globalThis.dnd5e?.canvas?.AbilityTemplate;
  const templates=factory?.fromActivity(act)??[];
  if(templates.length!==1)fail('这个活动需要专用模板，请在电脑上施放');
  const template=templates[0],doc=template.document;
  let base=info.anchored?xy(t.center):template.getSnappedPosition(cmd.point);
  let direction=doc.t==='rect'?45:cmd.direction;
  if(info.anchored&&info.shape==='square'&&doc.t==='rect'){
    const side=doc.width*canvas.dimensions.distancePixels, sideIndex=((Math.round(cmd.direction/90)%4)+4)%4;
    base=template.getSnappedPosition([{x:t.center.x+t.w/2,y:t.center.y-side/2},{x:t.center.x-side/2,y:t.center.y+t.h/2},
      {x:t.center.x-t.w/2-side,y:t.center.y-side/2},{x:t.center.x-side/2,y:t.center.y-t.h/2-side}][sideIndex]);
  }
  if(!info.anchored)checkRange(t,act,base);
  const placement={x:base.x,y:base.y,direction};doc.updateSource(placement);
  const shape=template._computeShape();
  const outline=shape.points?{points:Array.from(shape.points)}:Number.isFinite(shape.radius)?{radius:shape.radius}:{x:shape.x,y:shape.y,w:shape.width,h:shape.height};
  return {placement,outline};
}
async function cast(t,cmd) {
  const {act,info}=getAction(t,cmd.key);
  if(game.paused)fail('游戏已暂停');
  if(game.modules.get('midi-qol')?.active && globalThis.MidiQOL?.configSettings?.()?.undoWorkflow && !game.users.activeGM)fail('本世界的战斗撤销记录需要在线 GM，请先连接 GM');
  if(info.uses===0)fail('物品次数已用完');
  if(info.needsSlot&&!slotEntries(t.actor).some(s=>s.id===cmd.slot&&s.level>=info.level&&s.value>0))fail('所选法术位不足，请重新选择');
  const ids=Array.isArray(cmd.targets)?[...new Set(cmd.targets)]:[];
  const targets=info.mode==='self'?[t]:ids.map(id=>target(t,id));
  if(info.mode==='target'&&(!targets.length||targets.length>info.max))fail('目标数量不正确');
  if(info.mode==='target')for(const other of targets){
    const anchor=cmd.anchors?.[other.id];
    if(!validPoint(anchor)||Math.hypot(anchor.x-other.center.x,anchor.y-other.center.y)>1)fail('目标已经移动，请重新选择');
    checkRange(t,act,other.center);
  }
  if(info.mode==='teleport')return teleport(t,act,info,cmd);
  let release;
  if(info.mode==='area'){
    release=confirmedTemplate(act,templatePlacement(t,act,info,cmd).placement);
  }
  const before=[...game.user.targets];
  try{
    setTargets(targets);
    const usage={midiOptions:{targetUuids:targets.map(o=>o.document.uuid),configureDialog:false,workflowOptions:{targetConfirmation:'none',autoFastAttack:true,autoFastDamage:true}}};
    if(info.needsSlot)usage.spell={slot:cmd.slot};
    if(release)usage.create={measuredTemplate:true};
    const result=await act.use(usage,{configure:false});
    if(!result || result.aborted)fail('施放取消或未通过当前世界规则');
    return {message:'已提交：'+info.name};
  }finally{release?.();setTargets(before.filter(visible));}
}
async function teleport(t,act,info,cmd) {
  if(!within(cmd.point))fail('请选择可见的空地');
  const d=t.document, pos=d.getSnappedPosition({x:cmd.point.x-t.w/2,y:cmd.point.y-t.h/2});
  const dest={x:pos.x+t.w/2,y:pos.y+t.h/2};
  const valid=()=>canvas.grid.measurePath([t.center,dest]).distance<=30.001 && (!canvas.visibility.tokenVision||canvas.visibility.testVisibility(dest,{tolerance:0}))
    && !canvas.tokens.placeables.some(other=>other!==t && other.bounds.intersects(new PIXI.Rectangle(pos.x+1,pos.y+1,t.w-2,t.h-2)));
  if(!valid())fail('落点不可用，请选择 30 尺内可见的空地');
  // Third-party teleport macros own placement, consumption and movement together.
  const adapter=game.modules.get('fvtt-automation-repair')?.active ?
    await import(foundry.utils.getRoute('modules/fvtt-automation-repair/scripts/hud-teleport-1.js')).catch(()=>null):null;
  const dedicated=adapter?adapter.teleportWorkflow(act):act.item.flags?.['chris-premades']?.info?.identifier||
    act.item.flags?.['midi-qol']?.onUseMacroName||act.item.flags?.autoanimations?.primary?.video?.menuType==='teleportation';
  if(dedicated)
    fail('此传送由桌面十字选点宏接管，请在 PL 窗口施放；尚未消费');
  const use={midiOptions:{targetUuids:[d.uuid],workflowOptions:{targetConfirmation:'none'}}};
  if(info.needsSlot)use.spell={slot:cmd.slot};
  const used=await act.use(use,{configure:false});if(!used||used.aborted)fail('传送施放已取消');
  if(!valid())fail('施法后落点发生变化，请 DM 检查施法记录');
  const moved=await d.move([{...pos,action:'blink'}],{method:'api',constrainOptions:{ignoreWalls:true}});
  const landed=moved&&Math.hypot(d._source.x-pos.x,d._source.y-pos.y)<1;
  return {message:landed?'已传送':'法术已使用，请核对世界规则允许的实际落点'};
}
export async function dispatch(cmd) {
  if(cmd.op==='view'){
    player();
    if(cmd.scene!==canvas.scene.id||!validPoint(cmd.center)||![cmd.width,cmd.height].every(v=>Number.isFinite(v)&&v>0&&v<1000000))fail('无效的地图视口');
    const screen=canvas.app.renderer.screen,rect=canvas.dimensions.sceneRect;
    const x=Math.max(rect.x,Math.min(rect.right,cmd.center.x)),y=Math.max(rect.y,Math.min(rect.bottom,cmd.center.y));
    canvas.pan({x,y,scale:.94*Math.min(screen.width/cmd.width,screen.height/cmd.height)});
    return {ok:true};
  }
  const t=source();
  if(cmd.op==='sheet')return sheet();
  if(cmd.op==='portrait')return displayIcon(t.actor.img);
  if(cmd.op==='icon')return displayIcon(t.actor.items.get(String(cmd.key).split('/')[0])?.img);
  checkContext(t,cmd);
  if(cmd.op==='predict')return prediction(t,cmd);
  if(cmd.op==='template'){const {act,info}=getAction(t,cmd.key);return templatePlacement(t,act,info,cmd);}
  if(cmd.op==='route'){const {cost,budget,reason,preview}=makePath(t,cmd);return {cost,budget,reason,preview};}
  if(cmd.op==='move'){
    const {steps,reason}=makePath(t,cmd);if(reason)fail(reason);
    if(!await t.document.move(steps,{method:'api',showRuler:true}))fail('移动被世界规则阻止');
    const end=steps.at(-1),actual=t.document._source;return {message:Math.hypot(end.x-actual.x,end.y-actual.y)<1?'移动完成':'仅移动到可达位置',
      position:{x:actual.x+t.w/2,y:actual.y+t.h/2}};
  }
  if(cmd.op==='cast')return cast(t,cmd);
  fail('未知操作');
}
