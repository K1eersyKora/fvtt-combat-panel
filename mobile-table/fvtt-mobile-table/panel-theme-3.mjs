const keys=['highlight','edgeStart','edgeEnd','base'];
const valid=c=>typeof c==='string'&&/^#[\da-f]{6}$/i.test(c);
const clean=c=>c&&keys.every(k=>valid(c[k]))?Object.fromEntries(keys.map(k=>[k,c[k].toLowerCase()])):null;
export function panelTheme(){
  const mod=game.modules.get('fvtt-combat-panel');
  if(!mod?.active)return null;
  const engine=mod.api?.ui?.getController?.()?.hud?.theme??globalThis.__dshCombatPanel?.hud?.theme;
  const state=engine?.state??game.user.getFlag('fvtt-combat-panel','hudTheme');
  const colors=clean(state?.draft);
  if(colors){
    const selected=state.presets?.find(p=>p.id===state.activeId);
    const result={colors,name:String(selected?.name||'玩家主题').slice(0,32)};
    if(engine?.animated?.()){
      const from=clean(state.presets.find(p=>p.id===state.rgb.fromId)?.colors),to=clean(state.presets.find(p=>p.id===state.rgb.toId)?.colors);
      if(from&&to)result.rgb={from,to,seconds:Math.max(2,Math.min(30,state.rgb.seconds||8)),epoch:Math.round(performance.timeOrigin+engine.epoch)};
    }
    return result;
  }
  const root=document.querySelector('#dsh-bg3-hud');if(!root)return null;
  const css=getComputedStyle(root),read=k=>css.getPropertyValue(k).trim();
  const custom=clean(Object.fromEntries(keys.map(k=>[k,read('--cp-theme-'+k)])));
  if(custom)return {colors:custom,name:'战斗面板'};
  const legacy=clean({highlight:read('--bg3-brass-gold'),edgeStart:read('--bg3-brass-aged'),edgeEnd:'#b4a1d1',base:read('--bg3-obsidian-deep')});
  return legacy?{colors:legacy,name:'经典战斗面板'}:null;
}
