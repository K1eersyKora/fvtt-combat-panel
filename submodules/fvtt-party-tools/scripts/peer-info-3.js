import {usesLeft,resolveConsumptionItem} from './parent-ui-1.js';
const array=value=>Array.from(value?.contents??value??[]);
const number=value=>Number.isFinite(Number(value))?Number(value):0;
const important=/bardic|inspiration|channel divinity|sorcery|superiority|wild shape|lay on hands|rage|ki points|focus points|诗人激励|引导神力|术法点|卓越骰|荒野形态|圣疗|狂暴|真气|气点|专注点/i;
const resourceNames=[
 [/bardic inspiration/i,'诗人激励'],[/channel divinity/i,'引导神力'],[/sorcery points?/i,'术法点'],
 [/superiority dice|superiority die/i,'卓越骰'],[/wild shape/i,'荒野形态'],[/lay on hands/i,'圣疗'],
 [/focus points?/i,'专注点'],[/ki points?/i,'气点'],[/rage/i,'狂暴'],[/second wind/i,'回气'],
 [/action surge/i,'动作如潮'],[/arcane recovery/i,'奥术回想'],[/divine sense/i,'神圣感知'],
 [/healing light/i,'治愈之光'],[/war priest/i,'战争祭司'],[/lucky|luck points?/i,'幸运']
];
export function resourceLabel(value,fallback='特性资源'){
 const text=String(value??'').normalize('NFKC');
 if(/\p{Script=Han}/u.test(text))return (text.match(/[\p{Script=Han}\d]+(?:[·・][\p{Script=Han}\d]+)*/gu)??[]).join(' ');
 return resourceNames.find(([pattern])=>pattern.test(text))?.[1]??fallback;
}

export function peerInfo(actor){
 const items=array(actor?.items),classes=items.filter(i=>i.type==='class').sort((a,b)=>number(b.system.levels)-number(a.system.levels));
 const level=classes.reduce((n,i)=>n+number(i.system.levels),0)||number(actor.system.details?.level);
 const subclasses=items.filter(i=>i.type==='subclass');
 const pools=new Map();
 const add=(id,label,uses,priority=0,fallback)=>{const r=usesLeft(uses);if(r.max<=0||pools.has(id))return;pools.set(id,{id,label:resourceLabel(label,fallback),...r,priority:priority+(important.test(label)?100:0)});};
 for(const [key,pool]of Object.entries(actor.system.resources??{})){const label=pool?.label??({legact:'传奇动作',legres:'传奇抗性'}[key]);if(label&&number(pool.max)>0)add('actor:'+key,label,pool,90);}
 for(const item of items.filter(i=>i.type==='feat')){
  add('item:'+item.id,item.name,item.system.uses,40);
  for(const activity of array(item.system.activities)){
   add('activity:'+item.id+':'+activity.id,activity.name||item.name,activity.uses,20,resourceLabel(item.name));
   for(const target of array(activity.consumption?.targets))if(target.type==='itemUses'&&target.target){const source=resolveConsumptionItem(actor,target.target);if(source)add('item:'+source.id,source.name,source.system.uses,70);}
  }
 }
 const resources=[...pools.values()].sort((a,b)=>b.priority-a.priority||a.label.localeCompare(b.label,'zh'));
 const slots=[];
 for(let level=1;level<=9;level++){const pool=actor.system.spells?.['spell'+level];if(number(pool?.max)>0)slots.push({key:'spell'+level,level,max:number(pool.max),value:Math.max(0,Math.min(number(pool.max),number(pool.value))),pact:false});}
 const pact=actor.system.spells?.pact;if(number(pact?.max)>0)slots.push({key:'pact',level:number(pact.level),max:number(pact.max),value:Math.max(0,Math.min(number(pact.max),number(pact.value))),pact:true});
 const hp=actor.system.attributes?.hp??{};
 return {name:actor.name,img:actor.img||actor.prototypeToken?.texture?.src||'icons/svg/mystery-man.svg',level,
  levelLabel:level?`${level} 级`:actor.type==='npc'?`CR ${actor.system.details?.cr??'—'}`:'等级 —',
  classes:classes.map(i=>({name:i.name,level:number(i.system.levels)})),subclasses:subclasses.map(i=>i.name),resources,slots,
  ac:actor.system.attributes?.ac?.value??'—',hp:{value:number(hp.value),max:number(hp.max),temp:Math.max(0,number(hp.temp))}};
}

export function overlap(a,b){return Math.max(0,Math.min(a.left+a.width,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.top+a.height,b.bottom)-Math.max(a.top,b.top));}
export function placePeerCard(size,anchor,bounds,death=[],chrome=[]){
 const initial=Math.min(1,bounds.width/size.width,bounds.height/size.height);
 const scales=[initial,...[.92,.84,.76,.68].map(n=>initial*n)];let fallback;
 for(const scale of scales){
  const width=size.width*scale,height=size.height*scale;
  const sameColumn=death.filter(r=>r.right>anchor.left-30&&r.left<anchor.right+30);
  const above=Math.min(anchor.top,...sameColumn.map(r=>r.top))-12;
  const candidates=[
   [anchor.cx-width/2,above-height],[anchor.left-width-12,anchor.top-height-12],[anchor.right+12,anchor.top-height-12],
   [anchor.left-width-12,anchor.cy-height/2],[anchor.right+12,anchor.cy-height/2],
   [bounds.left,bounds.top],[bounds.right-width,bounds.top],[bounds.left,bounds.bottom-height],[bounds.right-width,bounds.bottom-height],
   [anchor.cx-width/2,anchor.bottom+12],
   ...death.flatMap(r=>[[r.left-width-12,anchor.top-height],[r.right+12,anchor.top-height],[anchor.cx-width/2,r.bottom+12]])
  ];
  let best;
  for(const [x,y]of candidates){
   const left=Math.max(bounds.left,Math.min(x,bounds.right-width)),top=Math.max(bounds.top,Math.min(y,bounds.bottom-height));
   const rect={left,top,width,height},blocked=death.reduce((sum,r)=>sum+overlap(rect,r),0),busy=chrome.reduce((sum,r)=>sum+overlap(rect,r),0);
   const score=blocked*100000+busy*10+Math.abs(left+width/2-anchor.cx)+Math.abs(top+height-anchor.top)*.8+Math.max(0,top+height-anchor.top)*1.5;
   const result={...rect,scale,blocked,score};if(!best||score<best.score)best=result;
  }
  if(!fallback||best.score<fallback.score)fallback=best;
  if(best.blocked===0)return best;
 }
 return fallback;
}
