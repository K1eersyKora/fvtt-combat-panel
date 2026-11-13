import {readDisplay,saveDisplay,MIN_SCALE,MAX_SCALE} from './hud-display-172.js';
import {PREDICTION_MODE_LABELS} from './prediction-policy-156.js';
import {normalizeTheme,hexToHSV,hsvToHex} from './hud-theme-200.js';
import {readPerformance, PERFORMANCE_LABELS} from './performance-199.js';

const ID='fvtt-combat-panel';
const LABELS={equipment:'装备',features:'特性',spells:'法术',bonus:'附赠'};
const ICONS={equipment:'fa-shield-halved',features:'fa-star',spells:'fa-wand-magic-sparkles',bonus:'fa-bolt'};
const GROUPS=['equipment','features','spells'];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fallback='icons/svg/item-bag.svg';

export function openHUDSettings(hud,group) {
  if(hud.settingsSheet?.dialog.isConnected) {
    if(group)hud.settingsSheet.openEditor(group);
    hud.settingsSheet.dialog.focus();return;
  }
  hud.closeScale();hud.hideTip(0);
  hud.settingsSheet=new HUDSettings(hud);
  hud.settingsSheet.open();if(group)hud.settingsSheet.openEditor(group);
}

class HUDSettings {
  constructor(hud) {
    this.hud=hud;this.theme=normalizeTheme(hud.theme.state);this.drafts=new Map();this.saving=false;this.previewFrame=null;this.scaleFrame=null;this.searchFrame=null;this.saveRevision=0;
    this.dialog=document.createElement('dialog');this.dialog.className='cp-hud-settings';
    this.dialog.setAttribute('aria-labelledby','cp-settings-title');
  }
  open() {
    const d=this.dialog;
    d.innerHTML=`<header class="cp-settings-header"><button type="button" class="cp-settings-back" data-settings-back hidden aria-label="返回基础设置"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span>返回</span></button><div><small>COMBAT HUD</small><h2 id="cp-settings-title">界面设置</h2></div><button type="button" data-settings-close class="cp-settings-close" aria-label="关闭设置">×</button></header>
      <nav class="cp-base-tabs" aria-label="基础设置分区"><button type="button" data-base-tab="general" aria-pressed="true">基础设置</button><button type="button" data-base-tab="palette" aria-pressed="false">调色盘</button></nav>
      <div class="cp-settings-stack"><div class="cp-settings-base" data-base-panel="general">
      <div class="cp-settings-general"><section class="cp-setting-card"><h3><i class="fa-solid fa-layer-group" aria-hidden="true"></i> 栏位内容</h3><div class="cp-setting-groups">${Object.entries(LABELS).map(([key,label])=>`<button type="button" data-settings-group="${key}"><i class="fa-solid ${ICONS[key]}" aria-hidden="true"></i><span>${label}</span><span class="cp-chevron">›</span></button>`).join('')}</div><p class="cp-setting-hint">选择内容，调整显示顺序</p></section>
      <section class="cp-setting-card"><h3><i class="fa-solid fa-sliders" aria-hidden="true"></i> 显示</h3><label class="cp-setting-row" for="cp-hud-size">整体缩放 <output data-size-value>${Math.round(this.hud.preferredScale*100)}%</output></label><input id="cp-hud-size" type="range" min="${MIN_SCALE*100}" max="${MAX_SCALE*100}" value="${Math.round(this.hud.preferredScale*100)}" step="1"><label class="cp-setting-row">玻璃质感<select data-hud-background><option value="brown">雾面玻璃</option><option value="transparent">轻透玻璃</option></select></label></section>
      <section class="cp-setting-card"><h3><i class="fa-solid fa-crosshairs" aria-hidden="true"></i> 瞄准预测</h3><div data-prediction-controls></div><p class="cp-setting-hint">基础均伤不计命中、豁免和减伤。</p></section></div>
      <div class="cp-settings-palette"><section class="cp-setting-card cp-palette-card"><h3><i class="fa-solid fa-palette" aria-hidden="true"></i> 调色盘<span class="cp-card-note">整个 HUD · 实时预览</span></h3><label class="cp-setting-row">颜色预设<select data-theme-preset aria-label="颜色预设"></select></label>
      <div class="cp-preset-name"><input type="text" data-preset-name maxlength="32" aria-label="预设名称" placeholder="为这套配色命名"><button type="button" data-preset-rename title="重命名选中预设">重命名</button></div>
      <div class="cp-color-grid">${[['highlight','高光'],['edgeStart','边缘起色'],['edgeEnd','边缘终色'],['base','基础底色']].map(([key,label])=>`<div><span>${label}</span><button type="button" class="cp-color-swatch" data-theme-color="${key}" aria-label="自由调色：${label}" aria-expanded="false"></button><output data-color-value="${key}"></output></div>`).join('')}</div>
      <div class="cp-preset-actions"><button type="button" data-preset-new>＋ 存为新预设</button><button type="button" data-preset-update>更新预设</button><button type="button" data-preset-delete title="删除选中预设">删除</button></div>
      </section>
      <section class="cp-setting-card cp-rgb-card"><label class="cp-rgb-heading"><span><strong>RGB 动态渐变</strong><small>两套预设，平滑往返</small></span><input type="checkbox" data-theme-rgb role="switch" aria-label="RGB 动态渐变"></label><fieldset class="cp-rgb-options"><div class="cp-rgb-presets"><label>预设 A<select data-rgb-from></select></label><span aria-hidden="true">↔</span><label>预设 B<select data-rgb-to></select></label></div><label class="cp-setting-row" for="cp-rgb-speed">单程时长<output data-rgb-speed-value></output></label><input id="cp-rgb-speed" type="range" min="2" max="30" step="1" data-rgb-speed></fieldset></section></div>
      </div><section class="cp-color-picker" aria-label="自由调色盘" hidden></section><section class="cp-settings-editor" aria-label="编辑栏位" hidden></section></div>
      <footer class="cp-settings-footer"><span data-settings-status role="status">配色和基础设置自动保存</span><button type="button" data-settings-done>完成</button></footer>`;
    const performanceLabel=document.createElement('label');performanceLabel.className='cp-setting-row';
    performanceLabel.append(document.createTextNode('界面性能'));
    const performanceSelect=document.createElement('select');performanceSelect.dataset.hudPerformance='';performanceSelect.setAttribute('aria-label','界面性能');
    for(const [value,label]of Object.entries(PERFORMANCE_LABELS))performanceSelect.add(new Option(label,value));
    performanceLabel.append(performanceSelect);d.querySelector('#cp-hud-size').parentElement.append(performanceLabel);
    const performanceHint=document.createElement('p');performanceHint.className='cp-setting-hint';performanceHint.dataset.performanceHint='';performanceLabel.after(performanceHint);
    this.syncPerformance();
    d.querySelector('[data-hud-background]').value=readDisplay().background;
    this.renderPrediction();this.syncThemeControls();
    d.addEventListener('click',event=>void this.click(event).catch(error=>this.fail(error)));
    d.addEventListener('input',event=>this.input(event));
    d.addEventListener('change',event=>void this.change(event).catch(error=>this.fail(error)));
    d.addEventListener('cancel',event=>{if(this.colorKey){event.preventDefault();this.closeColorPicker();}else if(this.group){event.preventDefault();if(!this.saving)this.back();}});
    d.addEventListener('close',()=>{this.flushPreview();this.flushScale(true);void this.saveTheme().catch(error=>this.fail(error));cancelAnimationFrame(this.searchFrame);this.hud.theme.detach(d);d.remove();if(this.hud.settingsSheet===this)this.hud.settingsSheet=null;this.hud.el.querySelector('[data-hud-settings]')?.focus({preventScroll:true});});
    document.body.appendChild(d);this.hud.theme.attach(d);d.showModal();
    d.querySelector('[data-settings-group]')?.focus({preventScroll:true});
  }
  renderPrediction() {
    const rows=game.user.isGM?[['predictionProbability','命中概率'],['predictionDamage','基础均伤']]:[['hidePredictionProbability','隐藏命中概率'],['hidePredictionDamage','隐藏基础均伤']];
    this.dialog.querySelector('[data-prediction-controls]').innerHTML=rows.map(([key,label])=>`<label class="cp-setting-row">${label}${game.user.isGM?`<select data-prediction="${key}">${Object.entries(PREDICTION_MODE_LABELS).map(([value,name])=>`<option value="${value}" ${game.settings.get(ID,key)===value?'selected':''}>${esc(name)}</option>`).join('')}</select>`:`<input type="checkbox" data-prediction="${key}" ${game.settings.get(ID,key)?'checked':''}>`}</label>`).join('');
  }
  syncPerformance() {
    const state=readPerformance();
    const select=this.dialog.querySelector('[data-hud-performance]');if(select)select.value=state.mode;
    const hint=this.dialog.querySelector('[data-performance-hint]');if(hint)hint.textContent=`当前：${state.low?'低配':'完整'} · 低配保留原生结算，减少模糊、动态配色与 3D 骰盘。`;
  }
  status(message) {this.dialog.querySelector('[data-settings-status]').textContent=message;}
  fail(error) {this.status('保存失败，请重试');this.hud.error(error);}
  async saveTheme() {
    this.flushPreview();const revision=++this.saveRevision;this.status('正在保存…');
    await this.hud.theme.save(this.theme);
    if(revision===this.saveRevision)this.status('已保存 · 当前用户');
  }
  syncThemeControls() {
    const d=this.dialog,s=this.theme,signature=JSON.stringify(s.presets.map(p=>[p.id,p.name]));
    const changed=signature!==this.presetSignature;
    const options=changed?s.presets.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join(''):null;
    for(const[selector,value]of [['[data-theme-preset]',s.activeId],['[data-rgb-from]',s.rgb.fromId],['[data-rgb-to]',s.rgb.toId]]){const e=d.querySelector(selector);if(changed)e.innerHTML=options;e.value=value;}
    this.presetSignature=signature;
    d.querySelector('[data-preset-name]').value=s.presets.find(p=>p.id===s.activeId).name;
    d.querySelector('[data-preset-delete]').disabled=s.presets.length<2;
    this.syncDraft();
  }
  syncDraft(){
    const d=this.dialog,s=this.theme;
    for(const[key,value]of Object.entries(s.draft)){const swatch=d.querySelector(`[data-theme-color="${key}"]`);if(swatch.style.getPropertyValue('--swatch')!==value)swatch.style.setProperty('--swatch',value);d.querySelector(`[data-color-value="${key}"]`).value=value.toUpperCase();}
    d.querySelector('[data-theme-rgb]').checked=s.rgb.enabled;d.querySelector('.cp-rgb-options').disabled=!s.rgb.enabled;
    d.querySelector('[data-rgb-speed]').value=s.rgb.seconds;d.querySelector('[data-rgb-speed-value]').value=s.rgb.seconds+' 秒';
  }
  queuePreview(skip){
    this.previewDirty=true;this.previewSkip=skip;
    if(this.previewFrame===null)this.previewFrame=requestAnimationFrame(()=>this.flushPreview());
  }
  flushPreview(){
    if(this.previewFrame!==null)cancelAnimationFrame(this.previewFrame);this.previewFrame=null;
    if(!this.previewDirty)return;this.previewDirty=false;
    this.hud.theme.set(this.theme);this.syncDraft();this.paintPicker(this.previewSkip);this.previewSkip=null;
  }
  queueScale(value){
    this.pendingScale=value;this.scaleDirty=true;
    if(this.scaleFrame===null)this.scaleFrame=requestAnimationFrame(()=>this.flushScale(false));
  }
  flushScale(persist){
    if(this.scaleFrame!==null)cancelAnimationFrame(this.scaleFrame);this.scaleFrame=null;
    if(!this.scaleDirty)return;
    this.hud.setHudSize(this.pendingScale,this.hud.hudWidth,persist);
    if(persist)this.scaleDirty=false;
  }
  input(event) {
    const e=event.target;
    if(e.matches('[data-color-hue]')){this.hsv.h=Number(e.value);this.applyPickerColor();}
    if(e.matches('[data-color-hex]')&&/^#[0-9a-f]{6}$/i.test(e.value)){this.hsv=hexToHSV(e.value);this.applyPickerColor(e);}
    if(e.matches('[data-color-channel]')&&e.value!==''&&e.checkValidity()){
      const values=[...this.dialog.querySelectorAll('[data-color-channel]')].map(i=>Number(i.value));
      if(values.every(n=>Number.isFinite(n)&&n>=0&&n<=255)){this.hsv=hexToHSV('#'+values.map(n=>Math.round(n).toString(16).padStart(2,'0')).join(''));this.applyPickerColor(e);}
    }
    if(e.matches('#cp-hud-size')) {this.dialog.querySelector('[data-size-value]').value=e.value+'%';this.queueScale(Number(e.value)/100);}
    if(e.dataset.themeColor) {
      this.theme.draft[e.dataset.themeColor]=e.value;this.theme.rgb.enabled=false;
      this.dialog.querySelector(`[data-color-value="${e.dataset.themeColor}"]`).value=e.value.toUpperCase();
      this.dialog.querySelector('[data-theme-rgb]').checked=false;this.dialog.querySelector('.cp-rgb-options').disabled=true;
      this.queuePreview();
    }
    if(e.matches('[data-rgb-speed]')){this.theme.rgb.seconds=Number(e.value);this.dialog.querySelector('[data-rgb-speed-value]').value=e.value+' 秒';this.queuePreview();}
    if(e.matches('[data-editor-search]')){cancelAnimationFrame(this.searchFrame);this.searchFrame=requestAnimationFrame(()=>{this.searchFrame=null;if(this.group)this.drawEditorRows();});}
  }
  async change(event) {
    const e=event.target;
    if(e.matches('#cp-hud-size'))this.flushScale(true);
    if(e.matches('[data-color-hue],[data-color-hex],[data-color-channel]')){
      if(e.matches('[data-color-hex]')&&!/^#[0-9a-f]{6}$/i.test(e.value)){e.value=this.theme.draft[this.colorKey].toUpperCase();this.status('请输入 #RRGGBB 格式的颜色');return;}
      this.paintPicker();await this.saveTheme();
    }
    if(e.matches('[data-hud-background]')){await saveDisplay('background',e.value);this.hud.position();this.status('已保存 · 当前用户');}
    if(e.matches('[data-hud-performance]')){await game.settings.set(ID,'performanceMode',e.value);this.syncPerformance();this.status('已保存 · 当前客户端');}
    if(e.dataset.prediction){try{await game.settings.set(ID,e.dataset.prediction,game.user.isGM?e.value:e.checked);}catch(error){this.renderPrediction();throw error;}}
    if(e.matches('[data-theme-preset]')) {this.theme.activeId=e.value;this.theme.draft={...this.theme.presets.find(p=>p.id===e.value).colors};this.syncThemeControls();}
    if(e.matches('[data-theme-rgb]')){this.theme.rgb.enabled=e.checked;this.syncThemeControls();}
    if(e.matches('[data-rgb-from]')){this.theme.rgb.fromId=e.value;this.syncThemeControls();}
    if(e.matches('[data-rgb-to]')){this.theme.rgb.toId=e.value;this.syncThemeControls();}
    if(e.matches('[data-theme-preset],[data-theme-color],[data-theme-rgb],[data-rgb-from],[data-rgb-to],[data-rgb-speed]'))await this.saveTheme();
    if(e.matches('[data-editor-item]')){const draft=this.drafts.get(this.group);e.checked?draft.selected.add(e.dataset.editorItem):draft.selected.delete(e.dataset.editorItem);draft.automatic=false;this.updateCount();}
  }
  async click(event) {
    const b=event.target.closest('button');if(!b||b.disabled)return;
    if(b.matches('[data-settings-close],[data-settings-done]')){if(!this.saving){this.closeColorPicker();this.dialog.close();}return;}
    if(b.dataset.themeColor){this.openColorPicker(b.dataset.themeColor);return;}
    if(b.matches('[data-color-done]')){this.closeColorPicker();return;}
    if(b.matches('[data-color-reset]')){this.hsv=hexToHSV(this.colorInitial);this.applyPickerColor();await this.saveTheme();return;}
    if(b.dataset.settingsGroup){this.openEditor(b.dataset.settingsGroup);return;}
    if(b.matches('[data-settings-back],[data-editor-cancel]')){this.back();return;}
    if(b.dataset.baseTab){this.dialog.querySelector('.cp-settings-base').dataset.basePanel=b.dataset.baseTab;this.dialog.querySelectorAll('[data-base-tab]').forEach(e=>e.setAttribute('aria-pressed',String(e===b)));return;}
    if(b.matches('[data-preset-new],[data-preset-update],[data-preset-rename],[data-preset-delete]')) {
      const s=this.theme,active=s.presets.find(p=>p.id===s.activeId),name=this.dialog.querySelector('[data-preset-name]').value.trim();
      if(!b.matches('[data-preset-delete]')&&!name){this.status('请为预设输入名称');this.dialog.querySelector('[data-preset-name]').focus();return;}
      if(b.matches('[data-preset-new]')){const id=crypto.randomUUID();s.presets.push({id,name,colors:{...s.draft}});s.activeId=id;}
      if(b.matches('[data-preset-update]')){active.name=name;active.colors={...s.draft};}
      if(b.matches('[data-preset-rename]'))active.name=name;
      if(b.matches('[data-preset-delete]')&&s.presets.length>1){s.presets=s.presets.filter(p=>p!==active);s.activeId=s.presets[0].id;s.draft={...s.presets[0].colors};this.theme=normalizeTheme(s);}
      this.syncThemeControls();await this.saveTheme();return;
    }
    if(b.matches('[data-editor-save]')){await this.saveEditor();return;}
    if(!this.group)return;
    const draft=this.drafts.get(this.group);
    if(b.matches('[data-editor-all],[data-editor-none],[data-editor-auto]')) {
      draft.automatic=b.hasAttribute('data-editor-auto');
      draft.selected=new Set(b.hasAttribute('data-editor-none')?[]:b.hasAttribute('data-editor-auto')?draft.curated:draft.order);
      this.drawEditorRows();return;
    }
    if(b.matches('[data-editor-up],[data-editor-down]')) {
      const id=b.closest('[data-editor-row]').dataset.editorRow,index=draft.order.indexOf(id),next=index+(b.hasAttribute('data-editor-up')?-1:1);
      if(next>=0&&next<draft.order.length){[draft.order[index],draft.order[next]]=[draft.order[next],draft.order[index]];draft.automatic=false;this.drawEditorRows();this.dialog.querySelector(`[data-editor-row="${CSS.escape(id)}"] [${b.hasAttribute('data-editor-up')?'data-editor-up':'data-editor-down'}]`)?.focus({preventScroll:true});}
    }
  }
  openEditor(group) {
    if(!Object.hasOwn(LABELS,group))return;
    this.closeColorPicker();
    this.group=group;
    if(!this.drafts.has(group)) {
      const h=this.hud,groups=group==='bonus'?GROUPS:[group];
      const bonus=i=>h.panel._activityList(i).some(a=>a.activation?.type==='bonus');
      const all=groups.flatMap(g=>h.catalog(g)).filter(i=>group!=='bonus'||bonus(i));
      const candidates=new Set(all.map(i=>i.id)),selected=groups.flatMap(g=>h.items(g,false)).map(i=>i.id).filter(id=>candidates.has(id));
      const curated=groups.flatMap(g=>h.curatedFor(g)).map(i=>i.id).filter(id=>candidates.has(id));
      const chosen=new Set(selected);
      this.drafts.set(group,{actor:h.storeActor(),all,lookup:new Map(all.map(i=>[i.id,i])),search:new Map(all.map(i=>[i.id,i.name.toLocaleLowerCase()])),rows:new Map(),selected:chosen,curated,order:[...selected,...all.map(i=>i.id).filter(id=>!chosen.has(id))],automatic:group!=='bonus'&&!Array.isArray(h.preferences()[group])});
    }
    const d=this.dialog,base=d.querySelector('.cp-settings-base'),editor=d.querySelector('.cp-settings-editor');
    base.inert=true;base.style.visibility='hidden';d.classList.add('is-editing');
    d.querySelector('[data-settings-back]').hidden=false;d.querySelector('#cp-settings-title').textContent=LABELS[group]+'栏位';
    d.querySelector('.cp-base-tabs').hidden=true;d.querySelector('.cp-settings-footer').hidden=true;
    editor.innerHTML=`<p class="cp-editor-description">勾选要显示的内容，用 ↑ ↓ 排序。${group==='bonus'?'附赠动作会保留在各自所属的栏位中。':'只调整快捷栏，不删除角色物品。'}</p><div class="cp-editor-tools"><input type="search" data-editor-search aria-label="搜索角色内容" placeholder="搜索角色已有内容…"><button type="button" data-editor-all>全选</button><button type="button" data-editor-none>清空</button><button type="button" data-editor-auto>默认推荐</button></div><ul data-editor-list></ul><footer class="cp-editor-footer"><span data-editor-count></span><button type="button" data-editor-cancel>返回</button><button type="button" data-editor-save>保存并返回</button></footer>`;
    editor.querySelector('[data-editor-list]').addEventListener('error',event=>{const img=event.target;if(img.tagName==='IMG'&&!img.src.endsWith(fallback))img.src=fallback;},true);
    editor.hidden=false;this.drawEditorRows();
    if(readPerformance().animate)editor.animate([{opacity:.5},{opacity:1}],{duration:120,easing:'ease-out'});
    d.querySelector('[data-settings-back]').focus({preventScroll:true});
  }
  openColorPicker(key) {
    if(this.colorKey)this.closeColorPicker();
    this.colorKey=key;this.colorInitial=this.theme.draft[key];this.hsv=hexToHSV(this.colorInitial);
    const names={highlight:'高光颜色',edgeStart:'边缘渐变 · 起色',edgeEnd:'边缘渐变 · 终色',base:'整体基础颜色'};
    const picker=this.dialog.querySelector('.cp-color-picker');
    picker.innerHTML=`<div class="cp-picker-header"><div><small>自由调色盘</small><h3>${names[key]}</h3></div><button type="button" data-color-done aria-label="返回调色盘">×</button></div><div class="cp-color-plane" tabindex="0" role="slider" aria-label="饱和度与亮度，左右调整饱和度，上下调整亮度" aria-valuemin="0" aria-valuemax="100"><i class="cp-color-point"></i></div><label class="cp-hue-label">色相<input type="range" min="0" max="360" step="1" data-color-hue aria-label="色相"></label><div class="cp-picker-values"><label class="cp-hex-field">HEX<input type="text" data-color-hex maxlength="7" spellcheck="false" aria-label="HEX 色值"></label>${['R','G','B'].map((channel,i)=>`<label>${channel}<input type="number" min="0" max="255" step="1" data-color-channel="${i}" aria-label="${channel} 通道"></label>`).join('')}</div><div class="cp-picker-comparison"><span>原色<i data-color-before></i></span><span>当前<i data-color-after></i></span><small>点击或拖动选色<br>HUD 同步预览</small></div><footer><button type="button" data-color-reset>还原此颜色</button><button type="button" data-color-done>完成选色</button></footer>`;
    this.dialog.querySelector('.cp-settings-palette').inert=true;
    this.dialog.querySelector(`[data-theme-color="${key}"]`).setAttribute('aria-expanded','true');
    picker.hidden=false;this.paintPicker();
    const plane=picker.querySelector('.cp-color-plane');
    let planeRect=null;
    const point=event=>{const r=planeRect??plane.getBoundingClientRect();this.hsv.s=Math.max(0,Math.min(1,(event.clientX-r.left)/r.width));this.hsv.v=1-Math.max(0,Math.min(1,(event.clientY-r.top)/r.height));this.applyPickerColor();};
    plane.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();plane.focus({preventScroll:true});planeRect=plane.getBoundingClientRect();plane.setPointerCapture(event.pointerId);point(event);});
    plane.addEventListener('pointermove',event=>{if(plane.hasPointerCapture(event.pointerId))point(event);});
    const finish=event=>{if(plane.hasPointerCapture(event.pointerId)){if(event.type==='pointerup')point(event);plane.releasePointerCapture(event.pointerId);}planeRect=null;void this.saveTheme().catch(error=>this.fail(error));};
    plane.addEventListener('pointerup',finish);plane.addEventListener('pointercancel',finish);
    plane.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();const step=event.shiftKey ? 0.1 : 0.01;
      if(event.key==='ArrowLeft')this.hsv.s=Math.max(0,this.hsv.s-step);
      if(event.key==='ArrowRight')this.hsv.s=Math.min(1,this.hsv.s+step);
      if(event.key==='ArrowUp')this.hsv.v=Math.min(1,this.hsv.v+step);
      if(event.key==='ArrowDown')this.hsv.v=Math.max(0,this.hsv.v-step);
      this.applyPickerColor();
    });
    plane.addEventListener('keyup',event=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))void this.saveTheme().catch(error=>this.fail(error));});
    plane.addEventListener('blur',()=>{this.flushPreview();void this.saveTheme().catch(error=>this.fail(error));});
    plane.focus({preventScroll:true});
  }
  paintPicker(skip) {
    if(!this.colorKey)return;
    const picker=this.dialog.querySelector('.cp-color-picker'),hex=this.theme.draft[this.colorKey],hsv=this.hsv;
    picker.querySelector('.cp-color-plane').style.setProperty('--hue',hsv.h);
    const plane=picker.querySelector('.cp-color-plane');plane.setAttribute('aria-valuenow',String(Math.round(hsv.s*100)));plane.setAttribute('aria-valuetext',`饱和度 ${Math.round(hsv.s*100)}%，亮度 ${Math.round(hsv.v*100)}%`);
    const dot=picker.querySelector('.cp-color-point');dot.style.left=hsv.s*100+'%';dot.style.top=(1-hsv.v)*100+'%';
    const input=picker.querySelector('[data-color-hex]');if(input!==skip)input.value=hex.toUpperCase();
    picker.querySelector('[data-color-hue]').value=hsv.h;
    picker.querySelectorAll('[data-color-channel]').forEach((e,i)=>{if(e!==skip)e.value=parseInt(hex.slice(1+i*2,3+i*2),16);});
    picker.querySelector('[data-color-before]').style.background=this.colorInitial;picker.querySelector('[data-color-after]').style.background=hex;
  }
  applyPickerColor(skip) {
    if(!this.colorKey)return;
    this.theme.draft[this.colorKey]=hsvToHex(this.hsv);this.theme.rgb.enabled=false;this.queuePreview(skip);
  }
  closeColorPicker() {
    if(!this.colorKey)return;
    this.flushPreview();const key=this.colorKey;this.colorKey=null;this.dialog.querySelector('.cp-color-picker').hidden=true;
    this.dialog.querySelector('.cp-settings-palette').inert=false;
    const button=this.dialog.querySelector(`[data-theme-color="${key}"]`);button.setAttribute('aria-expanded','false');button.focus({preventScroll:true});
    void this.saveTheme().catch(error=>this.fail(error));
  }
  drawEditorRows() {
    const draft=this.drafts.get(this.group),query=this.dialog.querySelector('[data-editor-search]').value.trim().toLocaleLowerCase();
    const list=this.dialog.querySelector('[data-editor-list]'),scroll=list.scrollTop,rows=[];
    for(let index=0;index<draft.order.length;index++){
      const id=draft.order[index],i=draft.lookup.get(id);if(!i||!draft.search.get(id).includes(query))continue;
      let row=draft.rows.get(id);
      if(!row){row=document.createElement('li');row.dataset.editorRow=id;row.innerHTML=`<label><input type="checkbox" data-editor-item="${esc(id)}"><img src="${esc(i.img||fallback)}" alt="" loading="lazy" decoding="async"><span>${esc(i.name)}</span><small>${this.group==='bonus'?LABELS[this.hud.groupOf(i)]:i.type==='spell'?(Number(i.system.level)||'戏法')+(i.system.level?'环':''):''}</small></label><button type="button" data-editor-up aria-label="上移 ${esc(i.name)}">↑</button><button type="button" data-editor-down aria-label="下移 ${esc(i.name)}">↓</button>`;draft.rows.set(id,row);}
      row.querySelector('input').checked=draft.selected.has(id);row.querySelector('[data-editor-up]').disabled=index===0;row.querySelector('[data-editor-down]').disabled=index===draft.order.length-1;rows.push(row);
    }
    if(rows.length)list.replaceChildren(...rows);else{const empty=document.createElement('li');empty.className='cp-editor-empty';empty.textContent='没有匹配的内容';list.replaceChildren(empty);}
    list.scrollTop=scroll;this.updateCount();
  }
  updateCount() {const draft=this.drafts.get(this.group);this.dialog.querySelector('[data-editor-count]').textContent=`已选 ${draft.selected.size} / ${draft.all.length}${draft.automatic?' · 默认推荐':''}`;}
  back() {
    if(this.saving)return;
    cancelAnimationFrame(this.searchFrame);this.searchFrame=null;const d=this.dialog,group=this.group;this.group=null;
    d.querySelector('.cp-settings-editor').hidden=true;d.querySelector('.cp-settings-base').inert=false;d.querySelector('.cp-settings-base').style.visibility='';
    d.classList.remove('is-editing');d.querySelector('[data-settings-back]').hidden=true;d.querySelector('#cp-settings-title').textContent='界面设置';
    d.querySelector('.cp-base-tabs').hidden=false;d.querySelector('.cp-settings-footer').hidden=false;
    d.querySelector(`[data-settings-group="${group}"]`)?.focus({preventScroll:true});
  }
  async saveEditor() {
    const group=this.group,draft=this.drafts.get(group),ids=draft.order.filter(id=>draft.selected.has(id));
    this.saving=true;this.dialog.querySelectorAll('.cp-settings-editor button,[data-settings-back],[data-settings-close]').forEach(b=>b.disabled=true);
    try {
      if(group!=='bonus')await this.hud.savePreference(draft.actor,group,draft.automatic?null:ids);
      else {
        if(this.hud.storeActor()?.uuid!==draft.actor?.uuid)throw Error('当前角色已改变，请重新打开设置');
        const bonusIds=new Set(draft.order),lookup=new Map(draft.all.map(i=>[i.id,i]));
        for(const g of GROUPS){
          if(!draft.all.some(i=>this.hud.groupOf(i)===g))continue;
          const next=ids.filter(id=>this.hud.groupOf(lookup.get(id))===g),current=this.hud.items(g,false).map(i=>i.id),result=[];
          for(const id of current){if(!bonusIds.has(id))result.push(id);else if(next.length)result.push(next.shift());}
          result.push(...next);await this.hud.savePreference(draft.actor,g,result);
        }
      }
      this.drafts.clear();this.saving=false;this.back();this.status('栏位已保存');
    } finally {this.saving=false;this.dialog.querySelectorAll('.cp-settings-editor button,[data-settings-back],[data-settings-close]').forEach(b=>b.disabled=false);}
  }
}
