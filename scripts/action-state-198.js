// Round-based HUD state; document values arrive on every client, workflows do not.
const keys=['action','bonus','reaction'];
const blank=()=>({action:false,bonus:false,reaction:false});
export function midiUsed(actor) {
  const a=game.modules.get('midi-qol')?.active?(actor?.getFlag?.('midi-qol','actions')??{}):{};
  return {action:!!a.action,bonus:Number(a.bonusActionsUsed??0)>=Number(a.bonusActionsMax??1),reaction:Number(a.reactionsUsed??0)>=Number(a.reactionsMax??1)};
}
export class ActionState {
  constructor(changed) { this.changed=changed;this.entries=new Map();this.epoch=this.combatKey(); }
  combatKey(){const c=game.combat;return c?.started?`${c.id}:${c.round}`:null;}
  syncCombat(){const epoch=this.combatKey();if(epoch!==this.epoch){this.epoch=epoch;this.reset();}}
  reset(){
    for(const e of this.entries.values())for(const timer of Object.values(e.timers))clearTimeout(timer);
    this.entries.clear();
    // Preserve the project's new-round reset, even if Midi clears old effects later.
    for(const a of game.actors??[])this.entry(a,midiUsed(a));
    for(const c of game.combat?.combatants??[])if(c.actor)this.entry(c.actor,midiUsed(c.actor));
    this.changed();
  }
  entry(actor,ignore=null){
    const id=actor?.uuid??actor?.id;if(!id)return null;
    let e=this.entries.get(id);
    if(!e){e={used:blank(),ignore:ignore??blank(),timers:{}};this.entries.set(id,e);}
    return e;
  }
  read(actor){
    this.syncCombat();const e=this.entry(actor);if(!e)return blank();
    if(this.epoch){const native=midiUsed(actor);for(const k of keys){if(!native[k])e.ignore[k]=false;if(native[k]&&!e.ignore[k])e.used[k]=true;}}
    return {...e.used};
  }
  mark(actor,type,usage={}){
    const key=String(type??'').startsWith('reaction')?'reaction':type;
    if(!actor||!keys.includes(key)||usage?.midiOptions?.isTriggered)return;
    this.syncCombat();const e=this.entry(actor);if(!e)return;
    // More than one bonus action/reaction uses Midi's actual exhaustion threshold.
    const a=game.modules.get('midi-qol')?.active?(actor.getFlag?.('midi-qol','actions')??{}):{};
    const max=Number(key==='bonus'?a.bonusActionsMax??1:key==='reaction'?a.reactionsMax??1:1);
    if(max>1){this.changed();return;}
    e.used[key]=true;e.ignore[key]=false;clearTimeout(e.timers[key]);
    if(!this.epoch)e.timers[key]=setTimeout(()=>{e.used[key]=false;this.changed();},6000);
    this.changed();
  }
}
