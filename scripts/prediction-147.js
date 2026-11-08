/* Read-only dnd5e 5.1 / midi-qol 13 preview: no workflow, rolls or document writes. */
const own = (o,p) => p.split(".").reduce((v,k)=>v?.[k],o);
const list = x => x==null?[]:Array.isArray(x)?x:x.contents??Array.from(x);
const finite = x => x!==null&&x!==""&&x!==undefined&&Number.isFinite(Number(x));
const point = n => new Map([[n,1]]);
const uniq = a => [...new Set(a.filter(Boolean))];
const active = a => list(a?.appliedEffects??a?.effects).filter(e=>!e.disabled&&!e.isSuppressed&&!e.suppressed);
const has = (x,s) => x?.has?.(s)??list(x).includes(s);
const flag = (a,p) => own(a?.flags?.["midi-qol"],p);
const rule = p => {try{return globalThis.MidiQOL?.checkRule?.(p);}catch{return undefined;}};
const dnd = (a,p) => a?.flags?.dnd5e?.[p];
const effectId = e => e?.flags?.["chris-premades"]?.info?.identifier;
function combine(a,b,op) {
  if(a.size*b.size>100000||a.size+b.size>4096) throw Error("formula too large");
  const out=new Map();
  for(const [x,px] of a) for(const [y,py] of b) {
    const n=op(x,y);if(!Number.isFinite(n)) throw Error("nonfinite formula");
    const k=Math.round(n*1e9)/1e9;out.set(k,(out.get(k)??0)+px*py);
  }
  return out;
}
function mean(d) {return d?[...d].reduce((n,[v,p])=>n+v*p,0):null;}

/** Pure bounded arithmetic parser, including random bonuses without rolling dice. */
export function formulaDistribution(formula,data={}) {
  try {
    let src=String(formula??"0").replace(/\[[^\]]*]/g,"");
    for(let depth=0;src.includes("@");depth++){
      if(depth>8||src.length>4096)throw Error("recursive formula");
      src=src.replace(/@([A-Za-z0-9_.]+)/g,(_,path)=>{
        const n=own(data,path);if(n===null||n===undefined||!["number","string"].includes(typeof n))throw Error("missing "+path);
        return "("+String(n||0)+")";
      });
    }
    let at=0;
    const ws=()=>{while(at<src.length&&/\s/.test(src[at]))at++;};
    function take(c){ws();if(src.startsWith(c,at)){at+=c.length;return true;}return false;}
    function atom(){
      ws();if(take("+"))return atom();if(take("-"))return combine(point(0),atom(),(a,b)=>a-b);
      if(take("(")){const d=sum();if(!take(")"))throw Error("unclosed");return d;}
      const fn=/^(min|max|floor|ceil|round|abs)\s*\(/i.exec(src.slice(at));
      if(fn){
        at+=fn[0].length;let d=sum();const name=fn[1].toLowerCase();
        while(take(",")){if(!["min","max"].includes(name))throw Error("arity");d=combine(d,sum(),Math[name]);}
        if(!take(")"))throw Error("unclosed");
        if(!["min","max"].includes(name))d=combine(d,point(0),a=>Math[name](a));
        return d;
      }
      const dice=/^(\d*)d(\d+)(?:(min|max)(\d+))?/i.exec(src.slice(at));
      if(dice){
        at+=dice[0].length;const count=Number(dice[1]||1),sides=Number(dice[2]);
        if(count>30||sides>1000||count*sides>1000||sides<1)throw Error("dice limit");
        const one=new Map();
        for(let n=1;n<=sides;n++){
          const v=dice[3]==="min"?Math.max(n,Number(dice[4])):dice[3]==="max"?Math.min(n,Number(dice[4])):n;
          one.set(v,(one.get(v)??0)+1/sides);
        }
        let d=point(0);for(let n=0;n<count;n++)d=combine(d,one,(a,b)=>a+b);return d;
      }
      const number=/^(?:\d+(?:\.\d*)?|\.\d+)/.exec(src.slice(at));
      if(!number)throw Error("unsupported");at+=number[0].length;return point(Number(number[0]));
    }
    function product(){
      let d=atom();while(true){
        if(take("*"))d=combine(d,atom(),(a,b)=>a*b);else if(take("/"))d=combine(d,atom(),(a,b)=>a/b);else return d;
      }
    }
    function sum(){
      let d=product();while(true){
        if(take("+"))d=combine(d,product(),(a,b)=>a+b);else if(take("-"))d=combine(d,product(),(a,b)=>a-b);else return d;
      }
    }
    const result=sum();ws();return at===src.length?result:null;
  }catch{return null;}
}
export function thresholdProbability({bonus,target,mode="normal",lucky=false,elven=false,natural=false,critical=20,minimum=1,maximum=20}){
  if(!(bonus instanceof Map)||!finite(target))return null;
  const count=mode==="normal"?1:mode==="adv"&&elven?3:2;let prev=0,cdf=0,total=0;
  for(let n=1;n<=20;n++){
    cdf+=lucky?(n===1?1/400:21/400):1/20;
    const cumulative=mode==="dis"?1-(1-cdf)**count:cdf**count,p=Math.max(0,cumulative-prev);prev=cumulative;
    const adjusted=Math.min(maximum,Math.max(minimum,n));
    for(const [b,pb]of bonus){
      const success=natural&&n===1?false:natural&&n>=critical?true:adjusted+b>=Number(target);
      if(success)total+=p*pb;
    }
  }
  return Math.max(0,Math.min(1,total));
}
function collection(values){
  const s=new Set(values);
  // Foundry supplies a non-writable Set.prototype.first; preserve that native helper.
  if(typeof s.first!=="function")Object.defineProperty(s,"first",{value:()=>s.values().next().value,configurable:true});
  return s;
}
function senseReady(source,target){
  // midi's sense helpers initialize missing vision, and remove disabled vision sources.
  return !!source?.vision?.los&&source?.document?.sight?.enabled===true&&target?.document?.sight?.enabled===true;
}
function sense(source,target,method,modes){
  if(!senseReady(source,target))return null;
  try{const r=globalThis.MidiQOL?.[method]?.(source,target,modes);return typeof r==="boolean"?r:null;}catch{return null;}
}
function senseModes(source,target){
  if(!senseReady(source,target))return null;
  try{const r=globalThis.MidiQOL?.canSenseModes?.(source,target);return Array.isArray(r)||r instanceof Set?r:null;}catch{return null;}
}
function snapshot(value,seen=new WeakMap(),depth=0){
  if(value===null||["string","number","boolean","undefined"].includes(typeof value))return value;
  if(typeof value!=="object"||depth>12)return undefined;
  if(seen.has(value))return seen.get(value);
  if(value instanceof Set){
    const out=collection([]);seen.set(value,out);
    for(const v of value)out.add(snapshot(v,seen,depth+1));
    return Object.freeze(out);
  }
  const out=Array.isArray(value)?[]:Object.create(null);seen.set(value,out);
  for(const key of Object.keys(value)){
    if(["constructor","prototype","__proto__"].includes(key)||key.startsWith("_"))continue;
    const v=snapshot(value[key],seen,depth+1);if(v!==undefined)out[key]=v;
  }
  return Object.freeze(out);
}
function itemView(item){
  const system=item?.system??{};
  return {id:item?.id,uuid:item?.uuid,name:item?.name,type:item?.type,flags:item?.flags,
    system:Object.fromEntries(["properties","type","identifier","equipped","attuned","attunement","source","uses","range","school","level"].map(k=>[k,system[k]]))};
}
function actorView(actor){
  return {id:actor?.id,uuid:actor?.uuid,name:actor?.name,type:actor?.type,system:actor?.system,flags:actor?.flags,statuses:actor?.statuses,items:list(actor?.items).map(itemView)};
}
function tokenView(token){
  const d=token?.document??{};
  return {id:token?.id,name:token?.name,center:token?.center,actor:actorView(token?.actor),
    document:{id:d.id,uuid:d.uuid,disposition:d.disposition,elevation:d.elevation,flags:d.flags}};
}
function contextFor({actor,sourceToken,activity,targetToken},senses){
  const item=activity.item,wf={actor,token:sourceToken,tokenUuid:sourceToken?.document?.uuid,item,activity,
    targets:collection([targetToken]),saves:collection([]),failedSaves:collection([]),superSavers:collection([]),
    semiSuperSavers:collection([]),hitTargets:collection([]),attackRoll:undefined,
    targetsCanSee:collection(senses.targetSee===true?[sourceToken]:[]),
    targetsCanSense:collection(senses.targetSense===true?[sourceToken]:[]),
    tokenCanSee:collection(senses.sourceSee===true?[targetToken]:[]),
    tokenCanSense:collection(senses.sourceSense===true?[targetToken]:[])};
  let data;
  try{data=globalThis.MidiQOL?.createConditionData?.({actor,token:sourceToken,activity,item,target:targetToken,workflow:wf});}catch{}
  data??={...(actor?.getRollData?.()??{}),actor:{raceOrType:actor?.system?.details?.type?.value},workflow:wf,w:wf,
    activity,item:item?.getRollData?.().item??item,target:targetToken?.actor?.getRollData?.()??{},targetId:targetToken?.id,
    targetUuid:targetToken?.document?.uuid,targetActorUuid:targetToken?.actor?.uuid,tokenUuid:sourceToken?.document?.uuid};
  data.canSee=senses.sourceSee??undefined;data.canSense=senses.sourceSense??undefined;
  if(data.target){data.target.canSee=senses.targetSee??undefined;data.target.canSense=senses.targetSense??undefined;}
  // Conditions receive only disposable value snapshots, never actual documents or methods.
  const safeActivity={id:activity.id,uuid:activity.uuid,name:activity.name,type:activity.type,actionType:actionType(activity),
    ability:activity.ability,attack:activity.attack,save:activity.save,range:activity.range,target:activity.target,
    activation:activity.activation,damage:activity.damage,item:itemView(item)};
  const safeSource=tokenView(sourceToken),safeTarget=tokenView(targetToken);
  const safeWorkflow={actor:actorView(actor),token:safeSource,tokenUuid:wf.tokenUuid,item:itemView(item),activity:safeActivity,
    targets:collection([safeTarget]),saves:collection([]),failedSaves:collection([]),superSavers:collection([]),
    semiSuperSavers:collection([]),hitTargets:collection([]),tokenCanSee:collection(senses.sourceSee===true?[safeTarget]:[]),
    tokenCanSense:collection(senses.sourceSense===true?[safeTarget]:[]),targetsCanSee:collection(senses.targetSee===true?[safeSource]:[]),
    targetsCanSense:collection(senses.targetSense===true?[safeSource]:[])};
  data.workflow=safeWorkflow;data.w=safeWorkflow;data.activity=safeActivity;data.a=safeActivity;
  delete data.CONFIG; // Full global configuration is unnecessary and may contain live objects.
  data.previewDistance=distance(sourceToken,targetToken);
  return snapshot(data);
}
async function condition(value,data,warnings,label){
  if(value===true||value===false)return value;if(finite(value))return Number(value)!==0;
  if(value==null||value===""||typeof value==="object")return false;let text=String(value).trim();
  let missingHelperData=false;
  text=text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:MidiQOL\.)?getDistance\(\s*(?:tokenUuid|workflow\.tokenUuid)\s*,\s*targetUuid\s*\)|(?:MidiQOL\.)?hasCondition\(\s*(workflow\.actor|workflow\.token\.actor|workflow\.targets\.first\(\)\.actor)\s*,\s*['"]([a-zA-Z][\w-]*)['"]\s*\)/g,(part,ref,status)=>{
    if(part[0]==='"'||part[0]==="'")return part;
    if(!ref){if(data.previewDistance==null)missingHelperData=true;return String(data.previewDistance);}
    const a=ref.includes('targets')?data.workflow?.targets?.first?.()?.actor:data.workflow?.actor;
    if(!a?.statuses)missingHelperData=true;
    return String(has(a?.statuses,status));
  });
  if(missingHelperData){warnings.push(label+'：条件所需的距离或状态数据不可用');return false;}
  if(text==="true"||text==="false")return text==="true";
  if(/[;{}=]|\+\+|--|\b(?:await|new|function|delete|import|eval|Function|this)\b|=>|\.(?:update|setFlag|unsetFlag|execute|use|roll|delete|create|push|splice|add|set)\s*\(/.test(text.replace(/===|!==|==|!=|<=|>=/g,""))||text.includes(String.fromCharCode(96))){
    warnings.push(label+"：条件包含操作，预览未执行");return false;
  }
  const allowedCalls=new Set(["includes","has","first","startsWith","endsWith","toLowerCase","toUpperCase","trim","Number","Boolean","min","max","floor","ceil","round","abs"]);
  const stripped=text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,"");
  if(/[\]\)]\s*(?:\?\.)?\s*\(|\?\.\s*\(/.test(text)||/\b(?:constructor|prototype|__proto__)\b/.test(text)||[...stripped.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].some(m=>!allowedCalls.has(m[1]))){
    warnings.push(label+"：自定义条件函数未在预览中执行");return false;
  }
  const roots=new Set([...Object.keys(data),"true","false","null","undefined","Math","Number","Boolean"]);
  if([...stripped.matchAll(/[A-Za-z_$][\w$]*/g)].some(m=>{
    const before=stripped.slice(0,m.index).trimEnd();return !before.endsWith(".")&&!roots.has(m[0]);
  })){
    warnings.push(label+"：自定义条件需在实际投掷时确认");return false;
  }
  if(/\b(?:canSee|canSense)\b/.test(text)&&(data.canSee===undefined||data.canSense===undefined)){
    warnings.push(label+"：视线条件尚未确定");return false;
  }
  if(typeof globalThis.MidiQOL?.evalCondition!=="function"){warnings.push(label+"：条件公式待工作流确认");return false;}
  const failed="FVTT_PREVIEW_CONDITION_UNKNOWN";
  try{
    // midi merges its own live helpers into the top-level sandbox. Keep every
    // condition-data root under one frozen namespace so those helpers cannot replace it.
    const expression=text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|@?[A-Za-z_$][\w$]*/g,(part,offset)=>{
      if(part[0]==='"'||part[0]==="'")return part.replace(/@([A-Za-z_$][\w$]*)/g,"@previewData.$1");
      if(text.slice(0,offset).trimEnd().endsWith("."))return part;
      if(part[0]==="@")return "@previewData."+part.slice(1);
      return Object.hasOwn(data,part)?"previewData."+part:part;
    });
    const v=await globalThis.MidiQOL.evalCondition(expression,{previewData:data},{async:true,errorReturn:failed});
    if(v===failed||v===undefined)throw Error("unknown");return !!v;
  }catch{warnings.push(label+"：条件无法预判");return false;}
}
const predictionAudits=new WeakMap();
async function anyFlag(actor,keys,data,warnings,reasons,label){
  let result=false;
  for(const key of keys){
    const audit=predictionAudits.get(data);
    const entries=(audit?.rules.get(actor)??discoverPredictionRules(actor)).filter(e=>e.key===key);
    for(const e of entries){
      const before=warnings.length,matched=await condition(e.value,data,warnings,e.name||label);
      if(audit)audit.trace.push({...e,actor:actor.uuid??String([...audit.rules.keys()].indexOf(actor)),status:warnings.length>before?'unknown':matched?'applied':'inactive',matched});
      if(matched){result=true;if(reasons)reasons.push((e.name||label)+' · '+label);}
    }
  }return result;
}
function distance(source,target){
  try{const d=globalThis.MidiQOL?.computeDistance?.(source,target,{wallsBlock:false,includeCover:false});return finite(d)&&d>=0?Number(d):null;}catch{return null;}
}
function nearbyFoe(source,radius,warnings){
  const tokens=globalThis.canvas?.tokens?.placeables;
  if(!tokens){warnings.push("近身敌人：当前场景数据不可用");return false;}
  const disposition=Number(source?.document?.disposition),enemy=disposition===0?-1:-disposition;
  let unknown=false;
  for(const token of tokens){
    if(!token.actor||token.id===source.id||token.document?.disposition!==enemy)continue;
    if(["incapacitated","dead","unconscious","stunned","paralyzed","petrified"].some(s=>has(token.actor.statuses,s)))continue;
    const hp=token.actor.system?.attributes?.hp?.value;if(finite(hp)&&Number(hp)<=0)continue;
    const d=distance(token,source);if(d===null){unknown=true;continue;}if(d>radius)continue;
    const sees=sense(token,source,"canSense");
    if(sees===true)return true;if(sees===null)unknown=true;
  }
  if(unknown)warnings.push("近身敌人的视线待确认，可能影响远程攻击");
  return false;
}
async function rangePreview(input,data,type,warnings){
  const {actor,sourceToken,activity,targetToken}=input,rangeData=activity.range;
  if(!rangeData||activity.target?.affects?.type==="self")return "normal";
  if(flag(actor,"rangeOverride.attack.all")||flag(actor,"rangeOverride.attack."+type)){
    warnings.push("射程代理由实际工作流确认；预览不执行代理条件");return "unknown";
  }
  let range=Number(rangeData.value??rangeData.reach??0),long=Number(rangeData.long??0);
  if(!range&&!long&&rangeData.units!=="touch")return "normal";
  for(const [prefix,label]of [["range","正常射程"],["long","远射程"]]){
    const formula="("+String(flag(actor,prefix+"."+type)??0)+")+("+String(flag(actor,prefix+".all")??0)+")";
    const bonus=formulaDistribution(formula,data);
    if(!bonus||bonus.size!==1){warnings.push(label+"修正无法安全预判");return "unknown";}
    if(prefix==="range")range=Math.max(0,range+mean(bonus));else long=Math.max(0,long+mean(bonus));
  }
  if(long>0&&long<range)long=range;
  const gridUnit=String(globalThis.canvas?.scene?.grid?.units??"").toLowerCase();
  const factor=rangeData.units==="mi"?(["ft","feet"].includes(gridUnit)?5280:["yd","yds","yards"].includes(gridUnit)?1760:1):
    rangeData.units==="km"&&["m","meter","meters","metre","metres"].includes(gridUnit)?1000:1;
  range*=factor;long*=factor;
  if(type==="rwak"&&range<long&&(await condition(dnd(actor,"sharpShooter"),data,warnings,"神射手")||await condition(flag(actor,"sharpShooter"),data,warnings,"神射手")))range=long;
  if(type==="rsak"&&await condition(dnd(actor,"spellSniper"),data,warnings,"法术狙击")){range*=2;long*=2;}
  if(rangeData.units==="touch"){range=Number(activity.item?.system?.range?.reach)||globalThis.canvas?.dimensions?.distance||5;long=0;}
  if(["mwak","msak","mpak"].includes(type)&&!has(activity.item?.system?.properties,"thr"))long=0;
  const measured=distance(sourceToken,targetToken);
  if(measured===null){warnings.push("射程：当前场景距离不可用");return "unknown";}
  let config;try{config=globalThis.MidiQOL?.configSettings?.();}catch{}
  let metric=false;try{metric=!!globalThis.game?.settings?.get?.("dnd5e","metricLengthUnits");}catch{}
  const d=Math.max(0,Number(measured.toFixed(metric?1:0))-Number(config?.gridlessFudge??0));
  const walls=rule("wallsBlockRange");
  if(walls&&walls!=="none")warnings.push("墙体与掩护影响待实际投掷时确认");
  if((long&&d>long)||(!long&&d>range))return rule("checkRange")==="longdisadv"&&["rwak","rsak","rpak"].includes(type)?"dis":"fail";
  return d>range?"dis":"normal";
}
function attackMode(activity){
  const last=activity.item?.flags?.dnd5e?.last?.[activity.id]??{};return {attackMode:last.attackMode,ammunition:last.ammunition};
}
function actionType(activity){
  try{return activity.getActionType?.(attackMode(activity).attackMode)??activity.actionType??(activity.attack?.type?.value==="ranged"?"r":"m")+(activity.attack?.type?.classification==="spell"?"sak":"wak");}catch{return activity.actionType;}
}
function addStatus(actor,statuses,reasons,label){
  const present=statuses.some(s=>has(actor?.statuses,s));if(present)reasons.push(label);return present;
}
function umbralUnseen(token,observer,warnings){
  const actor=token?.actor;
  if(!has(actor?.statuses,"umbralSight")&&!list(actor?.items).some(i=>i.system?.identifier==="umbral-sight"||/Umbral Sight|阴影视野/.test(i.name??"")))return false;
  try{
    const environment=token.document?.parent?.environment,lights=globalThis.canvas?.effects?.lightSources;
    if(!environment||!lights||!token.center)throw Error("missing lighting");
    if(environment.globalLight?.enabled)return false;
    const globalType=globalThis.foundry?.canvas?.sources?.GlobalLightSource;
    if(list(lights).some(light=>(!globalType||!(light instanceof globalType))&&light.shape?.contains?.(token.center.x,token.center.y)))return false;
    const modes=observer?.detectionModes??observer?.document?.detectionModes;
    if(!modes||!globalThis.MidiQOL?.canSense)throw Error("missing senses");
    const valid=list(modes).map(m=>m.id).filter(id=>!["lightPerception","basicSight","hearing"].includes(id));
    const sensed=sense(observer,token,"canSense",valid);
    if(typeof sensed!=="boolean")throw Error("unknown senses");return !sensed;
  }catch{warnings.push("阴影视野：黑暗与特殊感知待实际场景确认");return false;}
}
async function attackModifiers(input,data,senses,reasons,warnings){
  const {actor,sourceToken,activity,targetToken}=input,target=targetToken.actor;
  const type=actionType(activity),ability=activity.ability??activity.attack?.ability;
  const keys=["all","attack.all","attack."+type,...(["mwak","rwak"].includes(type)&&ability?["attack."+ability]:[])];
  const targets=["all","attack.all","attack."+type];
  let adv=await anyFlag(actor,keys.map(k=>"advantage."+k),data,warnings,reasons,"攻击优势");
  let dis=await anyFlag(actor,keys.map(k=>"disadvantage."+k),data,warnings,reasons,"攻击劣势");
  adv=(await anyFlag(target,targets.map(k=>"grants.advantage."+k),data,warnings,reasons,"目标授予优势"))||adv;
  dis=(await anyFlag(target,targets.map(k=>"grants.disadvantage."+k),data,warnings,reasons,"目标授予劣势"))||dis;
  dis=addStatus(actor,["prone","restrained","blinded","poisoned"],reasons,"攻击者状态造成劣势")||dis;
  adv=addStatus(target,["restrained","blinded","stunned","paralyzed","unconscious"],reasons,"目标状态授予优势")||adv;
  const dist=distance(sourceToken,targetToken);
  if(has(target.statuses,"prone")){
    if(dist===null)warnings.push("倒地目标：距离未知，优势/劣势待确认");
    else if(dist<=5){adv=true;reasons.push("倒地目标 · 5尺内优势");}
    else{dis=true;reasons.push("倒地目标 · 5尺外劣势");}
  }
  if(has(actor.statuses,"frightened"))warnings.push("恐慌：恐惧来源是否在视线内尚需确认");
  const invis=rule("invisAdvantage");
  if(invis){
    if(senses.targetSense===false||(invis==="RAW"&&has(actor.statuses,"invisible"))){adv=true;reasons.push("目标无法感知攻击者");}
    if(senses.sourceSense===false||(invis==="RAW"&&has(target.statuses,"invisible"))){dis=true;reasons.push("攻击者无法感知目标");}
    if((has(actor.statuses,"umbralSight")||has(target.statuses,"umbralSight"))&&(senses.sourceSense===null||senses.targetSense===null))warnings.push("阴影视野：黑暗及目标感知尚未确定");
  }
  if(rule("hiddenAdvantage")==="effect"){
    adv=addStatus(actor,["hidden"],reasons,"隐藏攻击者获得优势")||adv;
    dis=addStatus(target,["hidden"],reasons,"隐藏目标造成劣势")||dis;
  }
  if(umbralUnseen(sourceToken,targetToken,warnings)){adv=true;reasons.push("阴影视野 · 黑暗中目标无法以特殊感知发现攻击者");}
  if(umbralUnseen(targetToken,sourceToken,warnings)){dis=true;reasons.push("阴影视野 · 黑暗中无法以特殊感知发现目标");}
  const props=activity.item?.system?.properties,nearby=Number(rule("nearbyFoe")||0);
  const ranged=["rwak","rsak","rpak"].includes(type)||(type==="mwak"&&has(props,"thr")&&dist>5);
  if(nearby>0&&ranged&&!await anyFlag(actor,["ignoreNearbyFoes"],data,warnings,reasons,"忽略近身敌人")){
    if(nearbyFoe(sourceToken,nearby,warnings)){dis=true;reasons.push("近身敌人妨碍远程攻击");}
  }
  if(has(props,"hvy")&&!await anyFlag(actor,["fail.disadvantage.heavy"],data,warnings,reasons,"免除重型武器劣势")){
    const modern=activity.item?.system?.source?.rules!=="2014";
    const penalty=modern?(type==="mwak"&&actor.system?.abilities?.str?.value<13)||(type==="rwak"&&actor.system?.abilities?.dex?.value<13):["tiny","sm"].includes(actor.system?.traits?.size);
    if(penalty){dis=true;reasons.push("重型武器使用条件造成劣势");}
  }
  let impossible=false;
  try{
    const r=await rangePreview(input,data,type,warnings);
    if(r==="dis"){dis=true;reasons.push("超出正常射程 · 劣势");}
    if(r==="fail"){impossible=true;warnings.push("超出可攻击范围");}
  }catch{warnings.push("射程未能计算");}
  for(const e of active(target))if(effectId(e)==="blurEffect"){
    const modes=senseModes(sourceToken,targetToken);
    if(modes&&!has(modes,"blindsight")&&!has(modes,"seeAll")){dis=true;reasons.push(e.name+" · 朦胧造成劣势");}
    else if(!modes)warnings.push("朦胧：特殊感知是否穿透幻象待确认");
  }
  const macro=String(flag(activity.item,"onUseMacroName")??"");
  if(macro.includes("MWP-HalberdFeintAdvantage")&&(activity.id==="pcBE7Uko0qpPxD9h"||/诡诈攻击/.test(activity.name??""))){
    const uses=activity.item.system?.uses,max=Number(uses?.max)||0,spent=Number(uses?.spent)||0,combat=globalThis.game?.combat,used=flag(activity.item,"dshChargeRound");
    if((!max||spent<max)&&(!combat||used!==combat.id+":"+combat.round)){
      adv=true;dis=false;reasons.push("方天画戟 · 现有诡诈宏强制优势并清除工作流劣势");
    }else{impossible=true;warnings.push("诡诈攻击：充能耗尽或本轮已使用，当前不能发动");}
  }
  if(macro.includes("MWP-HalberdPrecision"))warnings.push("精准攻击可在未命中后选择追加1d12；未计入基础概率");
  if(await anyFlag(target,["grants.noAdvantage.attack.all","grants.noAdvantage.attack."+type],data,warnings,null,"目标阻止优势")){adv=false;reasons.push("目标阻止攻击优势");}
  if(await anyFlag(target,["grants.noDisadvantage.attack.all","grants.noDisadvantage.attack."+type],data,warnings,null,"目标阻止劣势")){dis=false;reasons.push("目标阻止攻击劣势");}
  if(adv&&dis)reasons.push("优势与劣势相互抵消");
  return {mode:adv===dis?"normal":adv?"adv":"dis",advantage:adv,disadvantage:dis,impossible,type};
}
function attackBonus(activity,warnings){
  let formula,data={};
  try{
    const parts=activity.getAttackData?.(attackMode(activity));
    if(parts){formula=parts.parts.map(p=>"("+p+")").join("+")||"0";data=parts.data??{};}
    else{formula=activity.labels?.toHit;data=activity.getRollData?.()??{};}
  }catch{warnings.push("攻击公式读取失败");return null;}
  const d=typeof formula==="string"||typeof formula==="number"?formulaDistribution(formula,data):null;
  if(!d)warnings.push("攻击修正包含无法安全预判的公式");return d;
}
function damageMean(activity){
  const labels=activity.labels?.damages;if(!labels?.length)return null;
  const data=activity.getRollData?.()??{},dice=labels.map(l=>formulaDistribution(l.formula,data));
  return dice.some(d=>!d)?null:dice.reduce((total,d)=>total+mean(d),0);
}
function optionalWarnings(actor,activity,warnings,target){
  for(const [id,opt]of Object.entries(flag(actor,"optional")??{}))if(opt?.attack||opt?.save)warnings.push((opt.label||id)+"：可选检定加值尚未选择");
  const macro=String(flag(activity.item,"onUseMacroName")??"");
  if(/preAttackRoll|preCheckHits/.test(macro)&&!macro.includes("MWP-Halberd"))warnings.push("自定义攻击宏可能在掷骰时改变结果");
  const vow=list(actor?.items).find(i=>i.system?.identifier==="vow-of-enmity"||/Vow of Enmity|仇敌誓言/.test(i.name??""));
  const vowBound=active(target).some(e=>e.flags?.["midi-qol"]?.dshVowSourceActorUuid===actor?.uuid
    && e.flags?.["midi-qol"]?.dshVowSourceItemUuid===vow?.uuid
    && list(e.changes).some(c=>c.key==="flags.midi-qol.grants.advantage.attack.all"));
  if(vow&&!vowBound&&!active(actor).some(e=>/enmity|仇敌|誓言/i.test(e.name??"")&&list(e.changes).some(c=>c.key.startsWith("flags.midi-qol.advantage.attack."))))warnings.push("仇敌誓言：未读取到目标绑定优势，需确认立誓目标");
  if(rule("checkFlanking")&&rule("checkFlanking")!=="off")warnings.push("夹击按现有激活效果；移动后的状态由工作流复核");
  if(rule("coverCalculation")&&rule("coverCalculation")!=="none")warnings.push("动态掩护由工作流复核");
}

function saveBonus(actor,ability,warnings){
  const a=actor.system?.abilities?.[ability],data=actor.getRollData?.()??{};
  if(!a)return null;
  if(finite(a.mod)&&a.saveProf){
    const parts=[String(a.mod)];
    if(a.saveProf.hasProficiency)parts.push(String(a.saveProf.term));
    if(a.bonuses?.save)parts.push(String(a.bonuses.save));
    if(actor.system?.bonuses?.abilities?.save)parts.push(String(actor.system.bonuses.abilities.save));
    if(ability==="dex"&&actor.system?.attributes?.ac?.cover)parts.push(String(actor.system.attributes.ac.cover));
    try{actor.addRollExhaustion?.(parts,data);}catch{warnings.push("疲乏豁免修正未能读取");}
    const d=formulaDistribution(parts.map(p=>"("+p+")").join("+"),data);
    if(!d)warnings.push("豁免修正包含无法安全预判的公式");
    return d;
  }
  const value=a.save?.value??(finite(a.save)?a.save:undefined);
  if(!finite(value)){warnings.push("目标豁免数值不可用");return null;}
  if(/d\d/i.test((a.bonuses?.save??"")+" "+(actor.system?.bonuses?.abilities?.save??""))){
    warnings.push("目标随机豁免加值未能读取");return null;
  }
  return point(Number(value));
}
async function saveModifiers(input,data,ability,reasons,warnings){
  const {actor,activity,targetToken}=input,target=targetToken.actor;
  const keys=["all","ability.all","ability.save.all","ability.save."+ability];
  let adv=await anyFlag(target,keys.map(k=>"advantage."+k),data,warnings,reasons,"目标豁免优势");
  let dis=await anyFlag(target,keys.map(k=>"disadvantage."+k),data,warnings,reasons,"目标豁免劣势");
  const rollMode=target.system?.abilities?.[ability]?.save?.roll?.mode;
  if(rollMode===1){adv=true;reasons.push("目标属性豁免设置 · 优势");}
  if(rollMode===-1){dis=true;reasons.push("目标属性豁免设置 · 劣势");}
  const grants=["all","save.all","save."+ability];
  adv=(await anyFlag(actor,grants.map(k=>"grants.advantage."+k),data,warnings,reasons,"施法者授予豁免优势"))||adv;
  dis=(await anyFlag(actor,grants.map(k=>"grants.disadvantage."+k),data,warnings,reasons,"施法者授予豁免劣势"))||dis;
  const magical=activity.item?.type==="spell"||activity.midiProperties?.magicEffect||activity.item?.flags?.midiProperties?.magiceffect;
  if(magical){
    adv=(await anyFlag(target,["magicResistance.all","magicResistance."+ability],data,warnings,reasons,"魔法抗性"))||adv;
    dis=(await anyFlag(target,["magicVulnerability.all","magicVulnerability."+ability],data,warnings,reasons,"魔法易伤"))||dis;
    const mrName=globalThis.game?.i18n?.localize?.("midi-qol.MagicResistanceFeat");
    if(list(target.items).some(i=>i.type==="feat"&&(i.name===mrName||i.system?.identifier==="magic-resistance"))){adv=true;reasons.push("魔法抗性特性 · 豁免优势");}
  }
  // These traits apply only to their matching save, never to ordinary attack rolls.
  const statusEffects=list(activity.effects).flatMap(ref=>{
    const e=activity.item?.effects?.get?.(ref._id??ref.id);return list(e?.statuses);
  });
  const charm=statusEffects.includes("charmed")||["charm-person","dominate-person"].includes(activity.item?.system?.identifier);
  if(charm&&list(target.items).some(i=>i.system?.identifier==="fey-ancestry"||/Fey Ancestry|妖精血统/.test(i.name??""))){
    adv=true;reasons.push("妖精血统 · 对魅惑豁免优势");
  }
  if(activity.item?.flags?.["chris-premades"]?.info?.identifier==="charmPerson"&&globalThis.game?.combat){
    adv=true;reasons.push("魅惑人类 · CPR战斗中目标豁免优势");
  }
  const poison=statusEffects.includes("poisoned")||list(activity.damage?.parts).some(p=>has(p.types,"poison"));
  if(poison&&active(target).some(e=>effectId(e)==="protectionFromPoison"||/Protection from Poison|防护毒素/.test(e.name??""))){
    adv=true;reasons.push("防护毒素 · 对毒素豁免优势");
  }
  if(await anyFlag(target,["grants.noAdvantage.all","grants.noAdvantage.save"],data,warnings,null,"阻止豁免优势"))adv=false;
  if(await anyFlag(target,["grants.noDisadvantage.all","grants.noDisadvantage.save"],data,warnings,null,"阻止豁免劣势"))dis=false;
  if(adv&&dis)reasons.push("目标豁免优势与劣势相互抵消");
  return adv===dis?"normal":adv?"adv":"dis";
}
async function forcedAttack(input,data,type,warnings,reasons){
  const {actor,targetToken}=input,target=targetToken.actor;
  if(await anyFlag(actor,["fail.all","fail.attack","fail.attack.all","fail.attack."+type],data,warnings,reasons,"攻击自动失败"))return 0;
  if(await anyFlag(actor,["success.all","success.attack.all","success.attack."+type],data,warnings,reasons,"攻击自动成功"))return 1;
  if(await anyFlag(target,["grants.attack.success.all","grants.attack.success."+type],data,warnings,reasons,"目标授予自动命中"))return 1;
  if(await anyFlag(target,["grants.attack.fail.all","grants.attack.fail."+type],data,warnings,reasons,"目标授予自动未命中"))return 0;
  return null;
}
export async function computePreview(input){
  const {actor,sourceToken,activity,targetToken}=input,reasons=[],warnings=[];
  const kind=activity?.type==="save"?"save":"attack";
  const result={kind,chance:null,mode:"normal",damage:null,reasons,warnings,basis:"当前已生效数据；最终以实际工作流为准"};
  if(!actor||!activity||!targetToken?.actor){warnings.push("角色、活动或目标数据不可用");return result;}
  if(activity.type!=="attack"&&activity.type!=="save"){
    result.basis="此活动不直接进行攻击或豁免";return result;
  }
  const senses={sourceSee:sense(sourceToken,targetToken,"canSee"),sourceSense:sense(sourceToken,targetToken,"canSense"),
    targetSee:sense(targetToken,sourceToken,"canSee"),targetSense:sense(targetToken,sourceToken,"canSense")};
  if(Object.values(senses).some(v=>v===null))warnings.push("视觉信息不完整，隐蔽与感知造成的优势/劣势待确认");
  const data=contextFor(input,senses),audit=predictionAudit(input);
  predictionAudits.set(data,audit);
  result.damage=damageMean(activity);
  optionalWarnings(actor,activity,warnings,targetToken.actor);
  if(kind==="attack"){
    const mods=await attackModifiers(input,data,senses,reasons,warnings),bonus=attackBonus(activity,warnings);
    const workflowMode=await input.workflowResolver?.({...input,baselineMode:mods.mode,baselineAdvantage:mods.advantage,baselineDisadvantage:mods.disadvantage});
    if(workflowMode && !workflowMode.unsupported){mods.mode=workflowMode.mode;result.predictionSource=workflowMode.source;result.workflowAttribution=workflowMode.attribution;}
    else result.predictionSource="read-only-fallback";
    result.mode=mods.mode;result.bonus=mean(bonus);
    const ac=targetToken.actor.system?.attributes?.ac?.value;
    result.ac=finite(ac)?Number(ac):null;
    if(result.ac===null)warnings.push("目标AC不可用");
    const crit=Number(activity.attack?.critical?.threshold)||20,ability=activity.ability??activity.attack?.ability;
    result.chance=thresholdProbability({bonus,target:result.ac,mode:mods.mode,natural:true,critical:crit,
      lucky:!!dnd(actor,"halflingLucky"),elven:!!dnd(actor,"elvenAccuracy")&&["dex","int","wis","cha"].includes(ability)});
    const forced=await forcedAttack(input,data,mods.type,warnings,reasons);
    if(forced!==null)result.chance=forced;
    if(mods.impossible)result.chance=0;
  }else{
    const abilities=typeof activity.save?.ability==="string"?[activity.save.ability]:list(activity.save?.ability);
    const dc=activity.save?.dc?.value??actor.system?.attributes?.spelldc;
    result.dc=finite(dc)?Number(dc):null;
    if(result.dc===null)warnings.push("豁免DC不可用");
    const options=[];
    for(const ability of abilities){
      const localReasons=[],bonus=saveBonus(targetToken.actor,ability,warnings);
      const mode=await saveModifiers(input,data,ability,localReasons,warnings);
      const roll=targetToken.actor.system?.abilities?.[ability]?.save?.roll??{};
      let success=thresholdProbability({bonus,target:result.dc,mode,natural:!!rule("criticalSaves"),lucky:!!dnd(targetToken.actor,"halflingLucky"),
        minimum:finite(roll.min)?Number(roll.min):1,maximum:finite(roll.max)?Number(roll.max):20});
      if(["str","dex"].includes(ability)&&["paralyzed","unconscious","stunned"].some(s=>has(targetToken.actor.statuses,s))){
        success=0;localReasons.push("目标状态 · 力量/敏捷豁免自动失败");
      }
      if(await anyFlag(targetToken.actor,["fail.all","fail.ability.all","fail.ability.save.all","fail.ability.save."+ability],data,warnings,localReasons,"目标豁免自动失败"))success=0;
      options.push({ability,mode,bonus:mean(bonus),success,reasons:localReasons});
    }
    if(options.some(o=>o.success===null))warnings.push("至少一项可选豁免无法预判");
    else if(options.length){
      const chosen=options.reduce((a,b)=>a.success>b.success?a:b);
      result.chance=1-chosen.success;result.mode=chosen.mode;result.bonus=chosen.bonus;result.ability=chosen.ability;
      reasons.push(...chosen.reasons);
      if(options.length>1)warnings.push("多属性豁免按目标最有利的选择估计");
    }else warnings.push("豁免属性不可用");
    result.basis="目标豁免失败概率；最终以实际工作流为准";
  }
  auditUnresolved(input,audit,warnings);
  result.conditionTrace=audit.trace;
  result.conditionCoverage={discovered:[...audit.rules.values()].reduce((n,a)=>n+a.length,0),evaluated:audit.trace.filter(t=>t.status!=='unsupported').length,unresolved:audit.trace.filter(t=>t.status==='unknown'||t.status==='unsupported').length};
  result.reasons=uniq(reasons);result.warnings=uniq(warnings);
  result.complete=result.warnings.length===0;
  predictionAudits.delete(data);
  return result;
}

// Discover applied data from any module. Item effects which have not transferred
// to the actor are intentionally excluded: owning a spell is not its active effect.
export function discoverPredictionRules(actor) {
  const records=[];
  const relevant=key=>/^flags\.midi-qol\.(?:(?:grants\.)?(?:advantage|disadvantage|noAdvantage|noDisadvantage|fail|success)(?:\.|$)|grants\.attack\.(?:success|fail)\.|magicResistance\.|magicVulnerability\.|ignoreNearbyFoes$|optional\.)/.test(key);
  const sourceOf=e=>{
    const explicit=e.flags?.core?.sourceId??e._stats?.compendiumSource??e.origin??'';
    const pack=String(explicit).match(/^Compendium\.([^.]+)\./)?.[1];
    const declared=Object.keys(e.flags??{}).filter(id=>globalThis.game?.modules?.get?.(id)?.active);
    return pack??declared[0]??'ActiveEffect';
  };
  for(const e of active(actor))for(const c of list(e.changes))if(relevant(c.key))records.push({key:c.key.slice(15),value:c.value,name:e.name??'效果',effectUuid:e.uuid??e.id,origin:e.origin??null,source:sourceOf(e),mode:c.mode});
  const effectKeys=new Set(records.map(r=>r.key));
  const seen=new WeakSet();
  const walk=(obj,path='')=>{
    if(!obj||typeof obj!=='object'||seen.has(obj)||path.split('.').length>24)return;
    seen.add(obj);
    for(const [key,value]of Object.entries(obj??{})){
      if(['__proto__','constructor','prototype'].includes(key))continue;
      const next=path?path+'.'+key:key;
      if(value&&typeof value==='object'&&!Array.isArray(value))walk(value,next);
      else if(relevant('flags.midi-qol.'+next)&&!effectKeys.has(next))records.push({key:next,value,name:'角色条件',source:'prepared-midi-flag'});
    }
  };
  walk(actor?.flags?.['midi-qol']);
  return records.map((record,index)=>({...record,ruleId:index}));
}

export function predictionModuleInventory() {
  return Array.from(globalThis.game?.modules?.values?.()??list(globalThis.game?.modules)).filter(m=>m.active).map(m=>({id:m.id,title:m.title??m.id,version:m.version,
    discovery:'applied-effects-and-midi-flags',arbitraryWorkflowSupported:false}));
}

function predictionAudit(input) {
  const actors=[input.actor,input.targetToken?.actor].filter(Boolean),rules=new Map(),trace=[];
  for(const actor of actors)if(!rules.has(actor))rules.set(actor,discoverPredictionRules(actor));
  return {rules,trace};
}

function auditUnresolved(input,audit,warnings) {
  const kind=input.activity?.type;
  for(const [actor,records]of audit.rules)for(const record of records){
    if(audit.trace.some(t=>t.actor===(actor.uuid??String([...audit.rules.keys()].indexOf(actor)))&&t.ruleId===record.ruleId))continue;
    if(record.key.startsWith('optional.'))continue;
    const rollRelevant=kind==='attack'?/^(?:grants\.)?(?:advantage|disadvantage|noAdvantage|noDisadvantage)\.(?:all$|attack(?:\.|$))/.test(record.key)
      :/^(?:grants\.)?(?:advantage|disadvantage|noAdvantage|noDisadvantage)\.(?:all$|ability\.all$|ability\.save(?:\.|$)|save(?:\.|$))/.test(record.key);
    if(!rollRelevant)continue;
    // Distinguish a condition for another attack type from an unsupported key.
    const tail=record.key.split('.').at(-1),current=actionType(input.activity);
    if(kind==='attack'&&['mwak','rwak','msak','rsak','mpak','rpak'].includes(tail)&&tail!==current)continue;
    const ownerRelevant=actor===input.actor?!record.key.startsWith('grants.'):record.key.startsWith('grants.');
    if(kind==='attack'&&!ownerRelevant)continue;
    if(kind==='attack'&&['str','dex','con','int','wis','cha'].includes(tail)&&tail!==(input.activity.ability??input.activity.attack?.ability))continue;
    if(kind==='save'){
      const abilities=typeof input.activity.save?.ability==='string'?[input.activity.save.ability]:list(input.activity.save?.ability);
      if(['str','dex','con','int','wis','cha'].includes(tail)&&!abilities.includes(tail))continue;
      if(actor!==input.targetToken?.actor&&!record.key.startsWith('grants.'))continue;
      if(actor===input.targetToken?.actor&&/^grants\.(advantage|disadvantage)\./.test(record.key))continue;
    }
    audit.trace.push({...record,actor:actor.uuid??String([...audit.rules.keys()].indexOf(actor)),status:'unsupported',matched:false});
    warnings.push(record.name+'：发现尚未适配的条件 '+record.key);
  }
  // Never execute arbitrary actor/item macro code merely because the user hovers.
  for(const obj of [input.actor,input.targetToken?.actor,input.activity?.item]){
    const macro=String(flag(obj,'onUseMacroName')??'');
    if(/preAttackRoll|preCheckHits|preItemRoll|preTargeting|preSave/i.test(macro))warnings.push((obj?.name??'对象')+'：工作流宏尚未执行，可能改变最终判定');
  }
  const applied=Object.keys(input.activity?.item?.flags?.['chris-premades']?.macros??{});
  if(applied.length)warnings.push('此活动包含 CPR 宏；仅已生效的效果与可读条件计入预测');
}
