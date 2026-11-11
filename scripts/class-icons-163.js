const ASSETS='modules/fvtt-combat-panel/assets/classes/';
const aliases={barbarian:['野蛮人','野蠻人','蛮族','蠻族'],bard:['吟游诗人','吟遊詩人','诗人','詩人'],cleric:['牧师','牧師'],druid:['德鲁伊','德魯伊'],fighter:['战士','戰士'],monk:['武僧'],paladin:['圣武士','聖武士','圣骑士','聖騎士'],ranger:['游侠','遊俠'],rogue:['游荡者','遊蕩者','盗贼','盜賊'],sorcerer:['术士','術士'],warlock:['邪术师','邪術師','魔契师','魔契師'],wizard:['法师','法師','巫师','巫師']};
const normalized=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/(?:\b(?:class|phb|srd|2014|2024)\b|[（()）\[\]【】])/g,' ').trim();
export function classKey(item){
 const identifier=normalized(item?.system?.identifier);
 for(const [key,names]of Object.entries(aliases))if(identifier===key||names.includes(identifier))return key;
 const name=normalized(item?.name);
 const words=name.split(/[^a-z]+/);
 // Exact English word boundaries avoid matching e.g. "custom-fighter" as an official identifier.
 for(const [key,names]of Object.entries(aliases))if(words.includes(key)||names.some(alias=>name.includes(alias)))return key;
 return null;
}
export function classInfo(actor){
 const original=actor?.system?.details?.originalClass;
 const items=Array.from(actor?.items?.contents??actor?.items??[]).filter(i=>i.type==='class');
 items.sort((a,b)=>(Number(b.system?.levels)||0)-(Number(a.system?.levels)||0)||Number(b.id===original)-Number(a.id===original)||(Number(a.sort)||0)-(Number(b.sort)||0)||String(a.id??a.name).localeCompare(String(b.id??b.name)));
 const item=items[0];if(!item)return null;
 const key=classKey(item);
 return {id:item.id,name:item.name,level:Number(item.system?.levels)||0,key,img:ASSETS+(key?key+'.png':'generic.svg')};
}
