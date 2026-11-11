// Optional Rutz Tactics View adapter. Never fall through to the hidden 2D map.
export function tacticsView() {
 const api=globalThis.game?.modules?.get('rutz-diorama')?.api;
 const v=api?.isOpen?api.view:null;
 if(!v?.canvas?.isConnected||!v.renderer)return null;
 const rect=v.canvas.getBoundingClientRect();
 if(!rect.width||!rect.height)return null;
 return {v,r:v.renderer,rect};
}
export function tacticsTokenAt(clientX,clientY) {
 const state=tacticsView();if(!state)return undefined;
 const {r,rect}=state,x=clientX-rect.left,y=clientY-rect.top;
 if(x<0||y<0||x>rect.width||y>rect.height)return null;
 const hit=r.pick(x,y,{doors:false});
 if(hit?.type!=='token')return null;
 const t=canvas.tokens.get(hit.id);
 if(!t?.actor||t.destroyed||!t.visible||(!game.user.isGM&&(t.document.hidden||t.isVisible===false)))return null;
 return t;
}
export function tacticsBounds(token) {
 const state=tacticsView();if(!state)return undefined;
 const {r,rect}=state;
 const c=r.standeeCenter(token.id),top=r.standeeTop(token.id),p=top&&r.project(top);
 if(!c||!p||![c.x,c.y,p.x,p.y].every(Number.isFinite))return null;
 const height=Math.max(24,Math.abs(c.y-p.y)*2),width=Math.max(24,height*.7);
 return {x:rect.left+c.x,y:rect.top+c.y,left:rect.left+c.x-width/2,top:rect.top+c.y-height/2,width,height};
}
