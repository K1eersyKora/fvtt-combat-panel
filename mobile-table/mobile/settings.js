import {manageStorage} from './asset-cache.js';
const $=id=>document.getElementById(id);
const size=bytes=>bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':bytes?Math.ceil(bytes/1024)+' KB':'0 KB';
export function installSettings(onCleared,onStart,chatThemeApi){
  const dialog=$('settings');let seq=0,summary=null,clearing=false;
  const themes = [['dark', $('chatThemeDark')], ['paper', $('chatThemePaper')]];
  $('chatThemeGroup').hidden = !chatThemeApi?.setChatTheme;
  function syncChatTheme() {
    const selected = chatThemeApi?.getChatTheme?.() || 'dark';
    for (const [theme, button] of themes) {
      button.setAttribute('aria-pressed', String(selected === theme));
      button.classList.toggle('active', selected === theme);
    }
  }
  for (const [theme, button] of themes) {
    button.onclick = () => { chatThemeApi?.setChatTheme?.(theme); syncChatTheme(); };
  }
  function present(r){summary=r;$('cacheUsage').textContent='资源 '+r.files+' 个 · '+size(r.bytes)+'　角色卡 '+r.cards+' 张 · '+size(r.cardBytes);
    $('cacheLocation').textContent=r.location+(window.TableAssets?'。世界资源按桌位分文件夹，离线角色卡保存为 character.json。':'。浏览器按网站与桌位隔离保存。');
    $('clearCache').disabled=!r.files&&!($('clearCard').checked&&r.cards);}
  async function inspect(){const revision=++seq;$('clearPrompt').hidden=true;$('clearCache').disabled=true;$('cacheUsage').textContent='正在统计…';
    try{const r=await manageStorage($('cacheRange').value);if(seq===revision)present(r);}catch(e){if(seq===revision)$('cacheUsage').textContent='无法统计缓存：'+e.message;}}
  function open(){if(dialog.open)return;syncChatTheme();$('cacheResult').textContent='';$('clearCard').checked=false;dialog.showModal();inspect();}
  function close(){if(clearing)return;dialog.close();if(location.hash==='#settings')window.TableDisplay?.changeServer?.();}
  $('settingsOpen').onclick=open;$('settingsClose').onclick=close;
  dialog.oncancel=e=>{e.preventDefault();if(!$('clearPrompt').hidden)$('clearPrompt').hidden=true;else close();};
  $('cacheRange').onchange=()=>{$('cacheResult').textContent='';inspect();};
  $('clearCard').onchange=()=>{$('clearPrompt').hidden=true;if(summary)present(summary);};
  $('clearCache').onclick=()=>{if(!summary)return;$('clearPrompt').hidden=false;
    const inc=$('clearCard').checked,where=$('cacheRange').value==='all'?'全部桌位':'当前桌位';
    $('clearExplanation').textContent='清理'+where+'的 '+size(summary.bytes+(inc?summary.cardBytes:0))+' 缓存。'+(inc?'同时删除本机角色卡。':'保留本机角色卡。')+'下次可重新下载。';};
  $('cancelClear').onclick=()=>{$('clearPrompt').hidden=true;};
  $('confirmClear').onclick=async()=>{
    if(clearing)return;clearing=true;++seq;$('confirmClear').disabled=true;$('cacheRange').disabled=true;$('clearCard').disabled=true;$('settingsClose').disabled=true;
    try{const range=$('cacheRange').value,include=$('clearCard').checked;onStart?.(range,include);
      const r=await manageStorage(range,true,include);present(r);$('clearPrompt').hidden=true;$('cacheResult').textContent='已释放 '+size(r.freed)+'。';await onCleared?.(include);
    }catch(e){$('cacheResult').textContent='清理未完成：'+e.message;}
    finally{clearing=false;$('confirmClear').disabled=false;$('cacheRange').disabled=false;$('clearCard').disabled=false;$('settingsClose').disabled=false;}
  };
  if(location.hash==='#settings')open();return open;
}
