const surfaces='#cp-party-panel,.cp-party-menu,.cp-lock-dialog,.cp-party-size-popover,#cp-story-ui,#cp-peer-inspector,.bg3-dm-dialog,.bg3-player-overlay,.bg3-check-consent';
export function installThemeLink(){
 const mark=node=>{if(node.nodeType!==1||node.parentElement?.closest('[data-combat-panel-theme]'))return;if(node.matches(surfaces))node.setAttribute('data-combat-panel-theme','');for(const el of node.querySelectorAll(surfaces))el.setAttribute('data-combat-panel-theme','');};
 mark(document.body);
 const observer=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)mark(node);});
 observer.observe(document.body,{childList:true,subtree:true});
 Hooks.once('shutdown',()=>observer.disconnect());
 return observer;
}
