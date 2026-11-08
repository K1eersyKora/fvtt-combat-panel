/* HUD-owned local previews. Committed templates remain created by dnd5e. */
const visible=t=>t?.actor&&!t.destroyed&&t.visible&&(game.user.isGM||(!t.document.hidden&&t.isVisible!==false));
export function areaTargetAllowed(token,source,activity,auto,settings={}) {
  if(!visible(token)||token.document.hidden||token.document.isSecret||token.actor.type==='group'||token.actor.flags?.['midi-qol']?.neverTarget)return false;
  const has=condition=>condition&&(globalThis.MidiQOL?.hasCondition?.(token.actor,condition)??token.actor.statuses?.has(condition));
  if(settings.optionalRules?.wallsBlockRange!=='none'&&(globalThis.MidiQOL?.WallsBlockConditions??[]).some(has))return false;
  if(String(auto).endsWith('IgnoreIncapacitated')&&globalThis.MidiQOL?.checkIncapacitated?.(token.actor,false,false))return false;
  if(String(auto).endsWith('IgnoreDefeated')&&(has(CONFIG.specialStatusEffects.DEFEATED)||has(settings.midiDeadCondition)))return false;
  const affects=activity.target?.affects??{};
  if(String(affects.special??'').split(';').some(s=>['self','-self'].includes(s))&&token.id===source.id)return false;
  let type=['ally','enemy'].includes(affects.type)?affects.type:'any';
  if(activity.midiProperties?.autoTargetType!=='any')type=activity.midiProperties?.autoTargetType??'';
  const d=token.document.disposition,s=source.document.disposition,secret=CONST.TOKEN_DISPOSITIONS.SECRET;
  const match={ally:d===s,notAlly:d!==s,enemy:d===-s||d===secret,notEnemy:d!==-s&&d!==secret,neutral:d===0,notNeutral:d!==0,friendly:d===1,notFriendly:d!==1,hostile:d===-1||d===secret,notHostile:d!==-1&&d!==secret};
  return match[type]??true;
}
export function coveredByTemplate(template,token,{walls=false}={}) {
  const grid=canvas.grid,doc=template.document,shape=template.shape;
  if(!shape||!token?.actor)return false;
  for(let x=token.document.width>=1?.5:token.document.width/2;x<token.document.width;x++)for(let y=token.document.height>=1?.5:token.document.height/2;y<token.document.height;y++){
    const px=token.x+x*grid.size,py=token.y+y*grid.size;
    if(!shape.contains(px-doc.x,py-doc.y))continue;
    let origin={x:doc.x,y:doc.y};
    if(shape instanceof PIXI.Rectangle)origin={x:doc.x+shape.width/2,y:doc.y+shape.height/2};
    if(!walls||!CONFIG.Canvas.polygonBackends.sight.testCollision(origin,{x:px,y:py},{mode:'any',type:'move'}))return true;
  }
  return false;
}
export class AreaAim {
  constructor(hud,activity){this.hud=hud;this.activity=activity;this.objects=[];this.disposed=false;this.rotation=0;this.targets=[];this.point=null;}
  async start(){
    const cls=game.dnd5e?.canvas?.AbilityTemplate??dnd5e.canvas.AbilityTemplate;
    this.objects=cls.fromActivity(this.activity)??[];
    if(!this.objects.length)throw Error('此活动没有可放置的范围模板');
    // Multi-template activities retain the native placement flow until all positions can be collected.
    if(this.objects.length!==1){this.destroy();throw Error('此活动需要多个模板，请从物品卡使用原生放置');}
    const t=this.objects[0];
    // Midi wraps AbilityTemplate.refresh and otherwise writes real user targets on hover.
    // Only this disposable preview sees autoTargetAction=none; committed activity is unchanged.
    t.activity=new Proxy(this.activity,{get:(target,key)=>key==='midiProperties'?{...target.midiProperties,autoTargetAction:'none'}:Reflect.get(target,key,target)});
    await t.draw();
    if(this.disposed){t.destroy();return;}
    canvas.templates.preview.addChild(t);t.eventMode='none';t.visible=false;t._refreshShape();
  }
  move(ev,{force=false}={}){
    if(!force&&performance.now()-(this.lastMove||0)<30)return;
    this.lastMove=performance.now();
    if(!ev||!this.hud.panel.token||this.disposed||!this.objects[0]?.shape)return;
    const t=this.objects[0],view=canvas.app.view.getBoundingClientRect();
    const point=canvas.stage.worldTransform.applyInverse({x:ev.clientX-view.left,y:ev.clientY-view.top});
    const self=this.activity.range?.units==='self',source=this.hud.panel.token;
    let pos=self?{...source.center}:t.getSnappedPosition(point);
    let direction=t.document.t==='rect'?45:this.rotation;
    if(self&&['cone','ray'].includes(t.document.t))direction=Math.atan2(point.y-pos.y,point.x-pos.x)*180/Math.PI+this.rotation;
    const patch={x:pos.x,y:pos.y,direction};
    if(t.document.flags.dnd5e?.dimensions?.adjustedSize&&self)patch.distance=game.modules.get('midi-qol')?.active?Math.ceil(Number(this.activity.target.template.size)+Math.max(source.document.width,source.document.height)*canvas.grid.distance/2)+0.000001:Number(this.activity.target.template.size)+Math.max(source.document.width,source.document.height)*canvas.grid.distance/2;
    t.document.updateSource(patch);t._refreshShape();t.refresh();t.visible=true;this.point={x:pos.x,y:pos.y,direction,distance:t.document.distance};
    let settings;try{settings=MidiQOL.configSettings();}catch{}
    const override=this.activity.midiProperties?.autoTargetAction;
    const auto=override&&override!=='default'?override:settings?.autoTarget??'always';
    const walls=String(auto).startsWith('wallsBlock');
    this.targets=canvas.tokens.placeables.filter(token=>areaTargetAllowed(token,source,this.activity,auto,settings)&&coveredByTemplate(t,token,{walls}));
  }
  rotate(ev){if(!this.point)return;this.rotation+=(ev.deltaY>0?1:-1)*(ev.shiftKey?15:5);this.move(this.hud.lastPoint,{force:true});}
  hide(){for(const t of this.objects)t.visible=false;}
  snapshot(){return this.point?{...this.point}:null;}
  destroy(){this.disposed=true;for(const t of this.objects){try{canvas.interface?.grid?.destroyHighlightLayer?.(t.highlightId);t.parent?.removeChild(t);t.destroy();}catch{}}this.objects=[];this.targets=[];}
}
/* Replace only the matching use's preview handler, leaving native creation hooks,
   scaled template data, consumption and Midi's template lifecycle intact. */
export function bindConfirmedPlacement(activity,point,isCurrent,onFailure){
  const hook=Hooks.on('dnd5e.createActivityTemplate',(used,templates)=>{
    if(used.uuid!==activity.uuid||!isCurrent())return;
    for(const t of templates)t.drawPreview=async()=>{
      try {
        if(templates.length!==1)throw Error('范围模板数量已变化，请重新选择');
        if(!isCurrent())throw Error('施法已取消');
        t.document.updateSource({x:point.x,y:point.y,direction:point.direction});
        const data=t.document.toObject();
        const created=await canvas.scene.createEmbeddedDocuments('MeasuredTemplate',[data]);
        if(!created?.length)throw Error('未能创建范围模板');
        return created;
      }catch(error){await onFailure?.(error);throw error;}
    };
  });
  return ()=>Hooks.off('dnd5e.createActivityTemplate',hook);
}
