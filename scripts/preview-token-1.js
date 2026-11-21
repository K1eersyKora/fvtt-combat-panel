export function readonlyToken(real, actor, position) {
  let token;
  // Wall Height annotates collision sources with the top and bottom of each sweep.
  // Keep those annotations on this preview object, isolated from the real token.
  const sweep={};
  const denied = new Set(['update', 'updateSource', 'setFlag', 'unsetFlag', 'delete', 'createEmbeddedDocuments', 'updateEmbeddedDocuments', 'deleteEmbeddedDocuments', 'control', 'release', 'setTarget', 'initializeVisionSource', 'updateVisionSource', 'initializeSources']);
  const readOnly=()=>{throw Error('Attack preview is read-only');};
  const atPosition=position&&{x:position.x,y:position.y,elevation:position.elevation};
  const center=atPosition&&{x:position.x+real.w/2,y:position.y+real.h/2};
  const doc=new Proxy(real.document,{get(t,k){
    if(k==='actor')return actor;
    if(k==='object')return token;
    if(atPosition&&Object.hasOwn(atPosition,k))return atPosition[k];
    if(denied.has(k))return readOnly;
    return Reflect.get(t,k,t);
  },set:readOnly});
  token=new Proxy(real,{get(t,k){
    if(k==='b'||k==='t')return sweep[k];
    if(atPosition&&k==='losHeight')return atPosition.elevation+(real.losHeight-real.document.elevation);
    if(k==='actor')return actor;
    if(k==='document')return doc;
    if(atPosition&&Object.hasOwn(atPosition,k))return atPosition[k];
    if(atPosition&&k==='center')return center;
    // A projected location has no live vision source. The workflow resolves sight-dependent effects.
    if(atPosition&&k==='vision')return null;
    if(denied.has(k))return readOnly;
    return Reflect.get(t,k,t);
  },set(t,k,value){if(k==='b'||k==='t'){sweep[k]=value;return true;}return readOnly();}});
  return token;
}
