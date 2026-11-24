import {state, dispatch, sheet, clearPreviews, directlyVisible} from './game-13.mjs';
import {ChatMirror, postChat} from './chat-11.mjs';
import {LocalMap} from './local-map-8.mjs';
import {RelayChannel, cardRevision} from './relay-4.mjs';
import {resourcePath, worldResources, prepareAtlases, tokenArt} from './world-pack-7.mjs';
import {PlayerCheckBridge} from './bg3-check-1.mjs';

const LOAD_GUARD = Symbol.for('fvtt-mobile-table.loaded.v13');
if (!globalThis[LOAD_GUARD]) {
  globalThis[LOAD_GUARD] = true;

  const id = 'fvtt-mobile-table';
  const VERSION = '0.5.4';
  let session, opening;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function closePhone(s) {
    const ch = s.link;
    s.link = null; s.refresh = null; s.epoch = null; s.inspectTarget = null;
    s.chat?.close(); s.chat = null;
    clearInterval(s.timer); s.map.reset(); clearPreviews();
    ch?.close(); s.peer?.close(); s.peer = null; s.pending.clear();
  }
  function stop() {
    if (!session) return;
    const old = session; session = null;
    clearTimeout(old.packTimer); clearTimeout(old.sightPackTimer);
    closePhone(old); old.abort.abort();
    request(old, 'leave', {}).catch(() => {});
  }
  async function request(s, op, data, signal) {
    const res = await fetch(s.base + '/api/' + op, {
      method: 'POST', signal,
      headers: {'Content-Type': 'application/json', ...(s.token ? {Authorization: 'Bearer ' + s.token} : {})},
      body: JSON.stringify(data)
    });
    const json = await res.json();
    if (!res.ok) throw Object.assign(Error(json.error || '连接失败'), {status: res.status});
    return json;
  }
  function send(ch, data) {
    if (ch.readyState !== 'open') return;
    const text = JSON.stringify(data);
    if (text.length <= 24000) { ch.send(text); return; }
    const partId = foundry.utils.randomID(), total = Math.ceil(text.length / 20000);
    for (let i = 0; i < total; i++) {
      ch.send(JSON.stringify({event: 'messagePart', data: {id: partId, i, total, part: text.slice(i * 20000, (i + 1) * 20000)}}));
    }
  }
  function channel(s, ch) {
    let previous = null, previousCard = null, previewing = false, lastActor, cardDirty = true, joined = false, openingChannel;
    let previousCheck, joinedAt, finishedStartup = false;
    clearInterval(s.timer);
    const chat = new ChatMirror(data => send(ch, {event: 'chat', data}));
    s.chat = chat;
    const refresh = (forceSheet = false) => {
      if (session !== s || s.link !== ch || ch.readyState !== 'open' || !joined) return;
      if (game.user.isGM || game.user.id !== s.user) { stop(); return; }
      const check = s.checks.snapshot(), checkSignature = JSON.stringify(check);
      if (checkSignature !== previousCheck) {
        previousCheck = checkSignature;
        send(ch, {event:'bg3Check', data:check});
      }
      try {
        const current = state(s.inspectTarget);
        if (s.inspectTarget && !current.inspection) s.inspectTarget = null;
        if (previous?.scene !== current.scene || previous?.grid !== current.grid || previous?.unit !== current.unit) cardDirty = true;
        if (previous?.scene !== current.scene) {
          s.inspectTarget = null;
          current.inspection = null;
          clearPreviews();
          send(ch, {event: 'state', data: current});
        } else {
          const patch = {}, old = new Map(previous.targets.map(t => [t.id, t]));
          const changed = current.targets.filter(t => JSON.stringify(old.get(t.id)) !== JSON.stringify(t));
          const removed = previous.targets.filter(t => !current.targets.some(n => n.id === t.id)).map(t => t.id);
          if (changed.length) patch.changed = changed;
          if (removed.length) patch.removed = removed;
          for (const [key, value] of Object.entries(current)) {
            if (key !== 'targets' && JSON.stringify(previous[key]) !== JSON.stringify(value)) patch[key] = value;
          }
          if (Object.keys(patch).length) send(ch, {event: 'patch', data: patch});
        }
        previous = current;
        s.map.update(s, current).catch(e => s.map.block(s, e.message || '此场景的本地地图暂不可用'));
        // A large chat history or character card should not occupy the relay
        // before the first safe frame. Unsupported scenes still get their UI.
        finishedStartup ||= !!(s.map.last || s.map.lastReason || Date.now() - joinedAt >= 1800);
        if (finishedStartup) chat.sync();
        else if (!forceSheet) return;
        if (lastActor !== current.source?.id || cardDirty) {
          lastActor = current.source?.id; cardDirty = false;
          if (lastActor || game.user.character?.isOwner) {
            const next = packedSheet(s), rev = cardRevision(next);
            if (!previousCard || previousCard.actorId !== next.actorId) {
              if (!previousCard && s.knownCard === rev) send(ch, {event: 'sheetReady', data: {rev}});
              else send(ch, {event: 'sheet', data: next});
            } else {
              const patch = {};
              for (const key of Object.keys(next)) {
                if (JSON.stringify(previousCard[key]) === JSON.stringify(next[key])) continue;
                if (['actions', 'inventory'].includes(key)) {
                  const keyName = key === 'actions' ? 'key' : 'id';
                  const oldMap = new Map(previousCard[key].map(r => [r[keyName], r]));
                  const curMap = new Map(next[key].map(r => [r[keyName], r]));
                  const removed = previousCard[key].filter(r => !curMap.has(r[keyName])).map(r => r[keyName]);
                  const changes = next[key].filter(r => JSON.stringify(oldMap.get(r[keyName])) !== JSON.stringify(r));
                  patch[key] = {set: changes, remove: removed};
                  const order = next[key].map(r => r[keyName]);
                  if (JSON.stringify(order) !== JSON.stringify([...oldMap.keys()])) patch[key].order = order;
                } else patch[key] = next[key];
              }
              if (Object.keys(patch).length) send(ch, {event: 'sheetPatch', data: {actorId: next.actorId, from: cardRevision(previousCard), rev, patch}});
            }
            previousCard = next;
          }
        }
      } catch (e) {
        send(ch, {event: 'wait', data: e.message});
      }
    };
    s.refresh = refresh;
    s.invalidateSheet = () => { cardDirty = true; };
    const enter = () => {
      if (!openingChannel) openingChannel = (async () => {
        if (session !== s || s.link !== ch) return;
        joinedAt = Date.now(); joined = true; refresh(); s.timer = setInterval(refresh, 180);
        if (!s.map.pack) void loadPackIndex(s).catch(() => {});
      })();
      return openingChannel;
    };
    ch.onopen = enter;
    ch.onmessage = async event => {
      if (typeof event.data !== 'string' || event.data.length > 24000) return;
      let cmd; try { cmd = JSON.parse(event.data); } catch { return; }
      if (typeof cmd?.id !== 'string' || cmd.id.length > 80) return;
      const writes = ['cast', 'move', 'postChat', 'endTurn'].includes(cmd.op);
      const reply = (ok, data) => send(ch, {id: cmd.id, ok, data});
      if (session !== s || s.link !== ch || game.user.id !== s.user || game.user.isGM) return reply(false, '玩家会话已改变');
      if (cmd.op === 'join') {
        await enter();
        return reply(true, {world: game.world.title, chat: true, protocol: 2, version: VERSION});
      }
      if (!joined) return reply(false, '请先进入世界');
      if (cmd.op === 'bg3Check') {
        try { reply(true, s.checks.choose(cmd)); } catch (e) { reply(false,e.message); }
        return;
      }
      if (cmd.op === 'sheet') { try { return reply(true, packedSheet(s)); } catch (e) { return reply(false, e.message); } }
      if (cmd.op === 'cacheKeys') { s.map.useCache(cmd.epoch, cmd.keys); return reply(true, {}); }
      if (cmd.op === 'atlasCache') { s.map.acknowledgeAtlas(cmd.epoch, cmd.key, cmd.available === true); return reply(true, {}); }
      if (cmd.op === 'cacheMiss') { s.map.missing(cmd.epoch, cmd.keys); return reply(true, {}); }
      if (cmd.op === 'tokenInspect') {
        try {
          const res = await dispatch(cmd);
          s.inspectTarget = res.inspection ? res.inspection.id : null;
          return reply(true, res);
        } catch (e) {
          s.inspectTarget = null;
          return reply(false, e.message);
        }
      }
      const busyKey = cmd.op === 'postChat' ? 'chatBusy' : 'busy';
      if (writes && s.history.has(cmd.id)) return reply(...await s.history.get(cmd.id));
      if (writes && s[busyKey]) return reply(false, '上一项操作正在结算');
      if (cmd.op === 'predict' && previewing) return reply(false, '正在刷新预测');
      if (writes) s[busyKey] = true;
      if (cmd.op === 'predict') previewing = true;
      const operation = cmd.op === 'postChat' ? postChat(cmd.text) : dispatch(cmd);
      const receipt = operation.then(data => [true, data], error => [false, error.message || '操作失败']);
      if (writes) {
        s.history.set(cmd.id, receipt);
        if (s.history.size > 512) s.history.delete(s.history.keys().next().value);
      }
      const result = await receipt;
      if (writes) s[busyKey] = false;
      if (cmd.op === 'predict') previewing = false;
      const selected = cmd.op === 'selectToken' && result[0];
      if (selected || (writes && cmd.op !== 'postChat')) cardDirty = true;
      reply(...result); refresh(selected);
    };
    ch.onclose = () => { if (s.link === ch) { clearInterval(s.timer); chat.close(); s.inspectTarget = null; } };
    s.link = ch;
    if (ch.readyState === 'open') void enter();
  }
  function packedSheet(s, forPack = false) {
    const data = sheet(), actor = canvas.tokens.get(data.source)?.actor ?? game.actors.get(data.actorId);
    const portrait = resourcePath(actor?.img);
    if (forPack) data.portraitPath = portrait; else if (s.map.pack?.has(portrait)) data.portraitAsset = s.map.pack.get(portrait);
    for (const row of data.inventory) {
      const src = resourcePath(actor?.items.get(row.id)?.img);
      if (forPack) row.iconPath = src; else if (s.map.pack?.has(src)) row.iconAsset = s.map.pack.get(src);
    }
    for (const action of data.actions) {
      const item = actor?.items.get(action.key.split('/')[0]);
      const src = resourcePath(item?.img); if (forPack) { action.iconPath = src; continue; }
      const ref = s.map.pack?.get(src);
      if (ref) action.iconAsset = ref;
    }
    return data;
  }
  async function loadPackIndex(s) {
    const status = await request(s, 'pack/status', {manifest: true}, s.abort.signal);
    if (status.revision !== undefined && status.revision !== s.packRevision) return;
    if (status.state !== 'ready') return status.state;
    const byKey = new Map((status.files || []).map(a => [a.key, a]));
    s.map.pack = new Map(Object.entries(status.index || {}).map(([src, key]) => [src, byKey.get(key)]));
    s.map.atlases = new Map(Object.entries(status.atlases || {}).map(([sceneId, a]) => [sceneId, {...a, asset: byKey.get(a.key)}]));
    s.map.keyRequest = (key, scene, indices) => request(s, 'pack/keys', {key, scene, indices});
    s.map.last = null;
    return status.state;
  }
  function schedulePack(s, delay = 1000, refresh = false) {
    if (session !== s) return;
    s.packRefresh ||= refresh;
    clearTimeout(s.packTimer);
    s.packTimer = setTimeout(() => void preparePack(s), delay);
  }
  async function preparePack(s) {
    if (session !== s || s.packWork || game.user.isGM || s.user !== game.user.id || !canvas.ready) return;
    clearTimeout(s.packTimer);
    const revision = s.packRevision, refresh = s.packRefresh;
    s.packRefresh = false;
    const signal = s.abort.signal;
    s.packWork = (async () => {
      try {
        if (revision) await request(s, 'pack/reset', {revision}, signal);
        if (revision !== s.packRevision || session !== s) return;
        const inventory = worldResources();
        inventory.atlases = await prepareAtlases(s, revision, refresh);
        try { inventory.card = packedSheet(s, true); } catch {}
        if (revision !== s.packRevision || session !== s) return;
        await request(s, 'pack/prepare', {...inventory, revision, refresh}, signal);
        while (revision === s.packRevision && session === s) {
          const status = await loadPackIndex(s);
          if (status === 'ready' || status === 'failed') break;
          await wait(1200);
        }
      } catch (e) {
        if (revision === s.packRevision && session === s && e.status !== 409) {
          await request(s, 'pack/fail', {message: e.message, revision}, signal).catch(() => {});
        }
      }
    })();
    try { await s.packWork; }
    finally {
      s.packWork = null;
      if (revision !== s.packRevision || s.packRefresh) schedulePack(s);
    }
  }
  function invalidatePack(s) {
    ++s.packRevision;
    s.map.pack = new Map(); s.map.atlases = new Map(); s.map.last = null;
    request(s, 'pack/reset', {revision: s.packRevision}, s.abort.signal).catch(() => {});
    schedulePack(s);
  }
  function visiblePackArt() {
    return JSON.stringify([...new Set(canvas.tokens.placeables.filter(token => directlyVisible(token))
      .map(token => resourcePath(tokenArt(token)?.path)).filter(Boolean))].sort());
  }
  async function receive(s, msg) {
    if (msg.type === 'preparePack') {
      schedulePack(s, 0, msg.refresh);
      return;
    }
    if (msg.type === 'reset') { closePhone(s); return; }
    if (msg.type === 'relayOpen') {
      closePhone(s); s.epoch = msg.epoch; s.knownCard = msg.cardRevision; s.protocol = Number(msg.protocol) || 1;
      s.atlasCacheAware = msg.atlasCache === true;
      const link = new RelayChannel((op, data, signal) => request(s, op, data, signal), msg.epoch);
      channel(s, link); link.start(); return;
    }
    if (msg.type === 'offer') {
      const early = s.pending.get(msg.epoch) || [];
      closePhone(s); s.knownCard = msg.cardRevision; s.protocol = Number(msg.protocol) || 1;
      s.atlasCacheAware = msg.atlasCache === true;
      const pc = new RTCPeerConnection({iceServers: s.iceServers}); s.peer = pc; s.epoch = msg.epoch;
      pc.onicecandidate = e => { if (e.candidate) request(s, 'signal', {type: 'candidate', epoch: msg.epoch, candidate: e.candidate.toJSON()}).catch(() => {}); };
      pc.ondatachannel = e => { if (s.peer === pc && session === s) channel(s, e.channel); else e.channel.close(); };
      await pc.setRemoteDescription(msg.sdp);
      for (const candidate of early) await pc.addIceCandidate(candidate).catch(() => {});
      s.pending.clear();
      await pc.setLocalDescription(await pc.createAnswer());
      await request(s, 'signal', {type: 'answer', epoch: msg.epoch, sdp: pc.localDescription.toJSON()});
    } else if (msg.type === 'candidate') {
      if (s.epoch === msg.epoch && s.peer?.remoteDescription) await s.peer.addIceCandidate(msg.candidate).catch(() => {});
      else { const list = s.pending.get(msg.epoch) || []; if (list.length < 50) { list.push(msg.candidate); s.pending.set(msg.epoch, list); } }
    } else if (msg.type === 'closed' && msg.epoch === s.epoch) { closePhone(s); }
  }
  async function listen(s) {
    while (session === s) {
      try { const messages = await request(s, 'poll', {}, s.abort.signal); for (const m of messages) if (session === s) await receive(s, m); }
      catch (e) { if (session !== s) return; if (e.status === 401) { stop(); ui.notifications.warn('手机配对已结束'); return; } await wait(1200); }
    }
  }
  async function start() {
    if (game.user.isGM) throw Error('请在电脑登录的普通 PL 会话中配对');
    if (session) return session.code;
    if (opening) return opening;
    const port = Number(game.settings.get(id, 'bridgePort'));
    const s = {base: 'http://127.0.0.1:' + (port + 2), abort: new AbortController(), history: new Map(), pending: new Map(), map: new LocalMap(), checks: new PlayerCheckBridge(), user: game.user.id, inspectTarget: null, packRevision: 0, atlasSignatures: new Map()};
    opening = request(s, 'create', {identity: game.world.id + '/' + game.user.id, title: game.world.title, player: game.user.name}).then(result => {
      Object.assign(s, result); session = s; s.visiblePackArt = visiblePackArt(); listen(s); schedulePack(s, 0); return s.code;
    });
    try { return await opening; } finally { opening = null; }
  }
  async function pairDialog() {
    try {
      const code = await start();
      new Dialog({
        title: '手机配对 · ' + game.user.name,
        content: '<p>桌位开启期间可反复使用此码。换手机登录后，控制权转到新手机。</p><p style="font: bold 24px monospace;user-select:all">' + code + '</p>',
        buttons: {ok: {label: '完成'}, rotate: {label: '更换配对码', callback: () => { stop(); void pairDialog(); }}, stop: {label: '关闭桌位', callback: stop}},
        default: 'ok'
      }).render(true);
    } catch (e) { ui.notifications.error('手机配对失败：' + e.message); }
  }
  Hooks.once('init', () => game.settings.register(id, 'bridgePort', {name: '手机桌面服务端口', hint: 'DM 电脑上的配套程序监听端口', scope: 'client', config: true, type: Number, default: 31940}));
  for (const hook of ['updateToken', 'updateCombat', 'createCombatant', 'deleteCombatant', 'updateCombatant', 'controlToken']) {
    Hooks.on(hook, () => {
      if (session?.link?.readyState !== 'open') return;
      if (hook === 'controlToken') session.invalidateSheet?.();
      requestAnimationFrame(() => session?.refresh?.());
    });
  }
  for (const hook of ['updateActor', 'updateItem', 'createItem', 'deleteItem', 'createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect']) {
    Hooks.on(hook, doc => {
      const actor = doc.documentName === 'Actor' ? doc : doc.actor ?? doc.parent;
      if (actor?.isOwner) session?.invalidateSheet?.();
      if (session?.inspectTarget && session?.link?.readyState === 'open') requestAnimationFrame(() => session?.refresh?.());
    });
  }
  const resourceDocuments = ['Scene', 'Actor', 'Item', 'Token', 'JournalEntry', 'JournalEntryPage', 'Tile', 'Drawing', 'ActiveEffect'];
  for (const documentName of resourceDocuments) {
    for (const action of ['create', 'delete']) Hooks.on(action + documentName, () => { if (session) invalidatePack(session); });
  }
  const resourceFields = new Set(['name', 'ownership', 'tokenVision', 'foreground', 'background', 'backgroundColor', 'width', 'height', 'fog', 'hidden', 'disposition', 'role', 'character', 'permissions', 'img', 'prototypeToken', 'texture', 'ring', 'src', 'text', 'flags', 'effects', 'disabled']);
  for (const documentName of [...resourceDocuments, 'User', 'Setting']) {
    Hooks.on('update' + documentName, (doc, change) => {
      if (!session) return;
      if (documentName === 'Setting') {
        if (doc.key?.startsWith('autoanimations.')) invalidatePack(session);
        return;
      }
      const copied = Object.keys(foundry.utils.flattenObject(change || {}));
      if (documentName === 'Tile' || copied.some(key => resourceFields.has(key.split('.')[0]) || /^system\.(activities|identifier|identified)\b/.test(key))) invalidatePack(session);
    });
  }
  Hooks.on('canvasReady', () => {
    if (session) { session.visiblePackArt = visiblePackArt(); invalidatePack(session); }
  });
  Hooks.on('visibilityRefresh', () => {
    const s = session;
    if (!s || s.sightPackTimer) return;
    s.sightPackTimer = setTimeout(() => {
      s.sightPackTimer = null;
      if (session !== s || !canvas.ready) return;
      const next = visiblePackArt();
      if (next === s.visiblePackArt) return;
      s.visiblePackArt = next;
      invalidatePack(s);
    }, 300);
  });
  Hooks.once('ready', () => {
    if (game.user.isGM) return;
    game.modules.get(id).api = {version: VERSION, pair: start, disconnect: stop};
    const button = document.createElement('button'); button.type = 'button'; button.textContent = '手机配对'; button.title = '连接掌上跑团';
    button.style.cssText = 'position:fixed;right:14px;bottom:12px;width:auto;z-index:70;padding:3px 12px;background:#233633;color:#fff;border:1px solid #75aca0;border-radius:6px;';
    button.addEventListener('click', pairDialog); document.body.append(button);
    addEventListener('pagehide', stop, {once: true});
  });
}
