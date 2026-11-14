import{embeddedSources}from'./embedded-sources-1.js';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor,compiled=new Map();
export const embeddedRegistry={
 run(name,{workflow,trigger}={}){const source=embeddedSources[name];if(!source)throw Error('未注册的职业自动化：'+name);let fn=compiled.get(name);if(!fn){fn=new AsyncFunction('workflow','trigger',source);compiled.set(name,fn);}return fn(workflow,trigger);},
 validate(){return Object.entries(embeddedSources).map(([name,source])=>{try{new AsyncFunction('workflow','trigger',source);return{name,ok:true};}catch(error){return{name,ok:false,error:error.message};}});}
};
