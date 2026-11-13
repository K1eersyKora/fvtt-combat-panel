// Keep live media, focus, scroll containers and unaffected decks connected.
// No event handlers are installed here: the HUD delegates interactions to its root.
const keyed = ['data-hud-zone','data-hud-group','data-hud-item','data-hud-mode','data-hud-option',
  'data-hud-width','data-hud-delete-free','data-hud-weapon','data-hud-other-attack','data-hud-filter-act',
  'data-hud-filter','data-hud-divider','data-hud-pager','data-hud-page'];
const key = node => {
  if (node.nodeType !== 1) return null;
  for (const attr of keyed) if (node.hasAttribute(attr)) return `${node.tagName}|${attr}|${node.getAttribute(attr)}`;
  return node.id ? `${node.tagName}|${node.id}` : null;
};
const compatible = (a,b) => a.nodeType === b.nodeType && (a.nodeType !== 1 || a.tagName === b.tagName);
const mount = el => el.matches('[data-hud-zone],[data-hud-nav],[data-hud-attacks],.bg3-choice-popover');

function patchNode(current, next, options) {
  if (current.nodeType !== 1) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  const managed = options.shell && mount(current);
  for (const attr of Array.from(current.attributes)) {
    if (attr.name === 'data-hud-failed-src' || (managed && attr.name === 'hidden')) continue;
    if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
  }
  for (const attr of next.attributes) {
    if (managed && attr.name === 'hidden') continue;
    if (attr.name === 'src' && current.dataset.hudFailedSrc === attr.value) continue;
    if (current.getAttribute(attr.name) !== attr.value) {
      if (attr.name === 'src') delete current.dataset.hudFailedSrc;
      current.setAttribute(attr.name,attr.value);
    }
  }
  if (!managed) patchChildren(current,next,options);
}

function patchChildren(host, next, options) {
  const old = Array.from(host.childNodes), used = new Set();
  const byKey = new Map(old.map(n=>[key(n),n]).filter(([k])=>k));
  let cursor = host.firstChild;
  for (const fresh of Array.from(next.childNodes)) {
    const id = key(fresh);
    let node = id ? byKey.get(id) : old.find(n=>!used.has(n) && !key(n) && compatible(n,fresh));
    if (node && (!compatible(node,fresh) || used.has(node))) node = null;
    if (node) { used.add(node); patchNode(node,fresh,options); }
    else node = fresh.cloneNode(true);
    if (node !== cursor) host.insertBefore(node,cursor);
    cursor = node.nextSibling;
  }
  for (const node of old) if (!used.has(node)) node.remove();
}

export function patchHTML(host, html, options = {}) {
  const template = document.createElement('template');
  template.innerHTML = html;
  patchChildren(host,template.content,options);
}
