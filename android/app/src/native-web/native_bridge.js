/* Relay Android adapter. Loaded ONLY inside the Android WebView (after mesh.js, before app.js).
   mesh.js is used here purely for its read-only view functions (case/version/reply/ack/status logic). Its simulated 80-phone world is
   discarded: state is rebuilt from this phone's own database snapshot (window.RelayAndroid.snapshot()), and every write goes to native code.
   Nothing here simulates peers, time or deliveries. */
(function () {
  'use strict';
  var RA = window.RelayAndroid, M = window.Mesh;
  var NB = window.RelayNative = { radio: {}, hoodSet: false, me: null, error: '' };
  if (!RA || !M) { NB.error = 'Native bridge missing'; return; }

  function parse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
  function minutes(ms) { return Math.floor(ms / 60000); }

  /* Rebuild the engine's state object from the latest snapshot. */
  NB.refresh = function () {
    var snap = parse(RA.snapshot());
    if (!snap) { NB.error = 'Could not read phone state'; return false; }
    var S = M.state(), me = snap.me.id, tick = minutes(snap.now);
    NB.me = me; NB.radio = snap.radio || {}; NB.hoodSet = !!(snap.me.hood && snap.me.hood.set); NB.snap = snap;
    S.tick = tick; S.keys = { A: me }; S.order = [me]; S.edges = []; S.lastHops = []; S.opts = { evictExpired: false, storageCap: Infinity, autoConfirm: false, userNode: me };
    S.requests = {}; S.packets = {}; S.attachments = {}; S.privateAddr = snap.privateAddr || {};
    S.inbox = {}; S.inbox[me] = {}; S.outbox = {}; S.outbox[me] = {};
    var hid = {}; (snap.flags.hidden || []).forEach(function (c) { hid[c] = true; });
    var nr = {}; (snap.flags.notRelevant || []).forEach(function (c) { nr[c] = true; });
    S.local = {}; S.local[me] = { hidden: hid, notRelevant: nr };
    var h = snap.me.hood;
    S.nodes = {}; S.nodes[me] = { id: me, label: 'My phone', zone: null, hood: h.id, hoodName: h.name, area: h.name, hasApp: true, active: true, key: 'A', confirmedTick: tick - minutes(h.ageMs) };
    var peers = (NB.radio.permissionsGranted && NB.radio.bluetoothEnabled) ? (NB.radio.recentPeers || []) : [];
    S.adj = {}; S.adj[me] = peers.map(function (t) { return 'peer:' + t; });
    peers.forEach(function (t) { S.nodes['peer:' + t] = { id: 'peer:' + t, hasApp: true, active: true, hood: null }; });

    var byId = {}; snap.packets.forEach(function (p) { byId[p.id] = p; });
    var authorOf = {};   // caseId -> device id of the requester (origin of any request packet; the native layer verified the case ID binds to that key)
    snap.packets.forEach(function (p) { if (p.type === 'request') authorOf[p.caseId] = p.origin; });

    snap.packets.forEach(function (p) {
      var f = p.fields || {}, payload = null;
      if (p.type !== 'request' && p.type !== 'reply' && p.type !== 'broadcast' && !p.byAuthor) return;      // forged ack/resolve/address/attachment (not signed by the requester) never reaches the UI
      if (p.type === 'request') {
        payload = { kind: f.kind, category: f.category, title: f.title, description: f.description, area: f.area, hood: f.authorHood || null, hoodName: f.authorHoodName || '',
          areaHood: f.areaHood || null, areaHoodName: f.areaHoodName || '', urgent: !!p.urgent, validity: Math.round(p.validityMs / 60000), targets: (p.route && p.route.targets) || [],
          lastKnown: f.lastKnown || '', lastContact: f.lastContact || '', note: f.note || '', hasPrivate: f.hasPrivate === '1', attachmentId: f.attachmentId || null, version: p.version };
      } else if (p.type === 'reply') {
        payload = { kind: f.kind, note: f.note, area: f.area || '', fromNodeId: p.origin, toNodeId: authorOf[p.caseId] || '', fromHood: f.fromHood || '' };
      } else if (p.type === 'ack') {
        var rp = byId[f.replyPacketId]; payload = { replyPacketId: f.replyPacketId, toNodeId: rp ? rp.origin : '' };
      } else if (p.type === 'broadcast') {
        payload = { text: f.text, category: f.category, area: f.area || '', hood: f.hood || null, hoodName: f.hoodName || '' };
      } else if (p.type === 'address') {
        if (!(f.opened || p.mine)) return;
        payload = { replyPacketId: f.replyPacketId, toNodeId: f.toDevice, building: f.building, directions: f.directions };
      } else if (p.type === 'attachment') {
        payload = { attachmentId: f.attachmentId, bytes: Number(f.size) };
      }
      S.packets[p.id] = { id: p.id, type: p.type, requestId: p.caseId, caseId: p.caseId, originNodeId: p.origin, payload: payload, urgent: !!p.urgent, prio: p.prio, version: p.version,
        route: { policy: p.route.policy, maxHops: p.route.maxHops, fanout: p.route.fanout, targets: p.route.targets }, createdTick: minutes(p.createdMs), expiresTick: minutes(p.expiresMs) };
      S.inbox[me][p.id] = { tick: minutes(p.receivedMs), via: p.via, hops: p.hops, detours: p.detours, tgt: p.tgt };
      if (p.sentTo > 0) S.outbox[me][p.id] = { tick: minutes(p.receivedMs), to: 'peer', count: p.sentTo, good: p.sentTo };
      if (p.type === 'request') {
        var r = S.requests[p.caseId];
        if (!r) r = S.requests[p.caseId] = { id: p.caseId, kind: f.kind, category: f.category, title: f.title, description: f.description, area: f.area, hood: f.areaHood || null,
          authorNodeId: p.origin, urgent: !!p.urgent, createdTick: minutes(p.createdMs), expiresTick: minutes(p.expiresMs), packetId: p.id, versions: [], targets: (p.route && p.route.targets) || [] };
        r.versions.push(p.id);
        if (p.version === 0) { r.createdTick = minutes(p.createdMs); r.packetId = p.id; }
      }
    });
    Object.keys(S.requests).forEach(function (c) { var r = S.requests[c]; r.versions.sort(function (a, b) { return S.packets[a].version - S.packets[b].version; }); });

    snap.attachments.forEach(function (a) {
      var syn = 'att:' + a.id;
      var rec = S.attachments[a.id] = { id: a.id, caseId: a.caseId, bytes: a.size, w: a.w, h: a.h, packetId: syn };
      Object.defineProperty(rec, 'dataUrl', { get: function () { var v = RA.attachment(a.id); return v || ''; }, enumerable: true });
      if (a.complete) {   // makes mesh.photoOf() report "ready" only for fully received, hash-verified photos
        S.packets[syn] = { id: syn, type: 'attachment', requestId: a.caseId, caseId: a.caseId, originNodeId: me, payload: { attachmentId: a.id, bytes: a.size }, urgent: false, prio: 2, version: 0, route: { policy: 'flood', maxHops: 1, fanout: 0, targets: [] }, createdTick: tick, expiresTick: tick + 100000 };
        S.inbox[me][syn] = { tick: tick, via: null, hops: 0, detours: 0, tgt: false };
      }
    });
    NB.error = '';
    return true;
  };

  /* ---- writes: native validates again, signs, stores and (later) transmits. The UI only gets honest outcomes. ---- */
  function out(r) { var o = parse(r) || { ok: false, error: 'Native error' }; if (o.ok) NB.refresh(); return { ok: !!o.ok, error: o.error || '', requestId: o.caseId, caseId: o.caseId, packetId: o.packetId }; }
  M.createRequest = function (nodeId, f) { return out(RA.createRequest(JSON.stringify(f))); };
  M.renewRequest = function (nodeId, rid, patch) { return out(RA.renewRequest(rid, JSON.stringify(patch || {}))); };
  M.createReply = function (nodeId, rid, f) { return out(RA.createReply(rid, f.kind, f.note || '', f.area || '')); };
  M.createAck = function (nodeId, replyPid) { return out(RA.createAck(replyPid)); };
  M.createResolve = function (nodeId, rid) { return out(RA.createResolve(rid)); };
  M.createBroadcast = function (nodeId, f) { return out(RA.createBroadcast(JSON.stringify(f))); };
  M.shareAddress = function (nodeId, replyPid) { return out(RA.shareAddress(replyPid)); };
  M.setHood = function (nodeId, id, custom) { return out(RA.setHood(id || '', custom || '')); };
  M.confirmHood = function () { out(RA.confirmHood()); };
  M.setHidden = function (nodeId, rid) { out(RA.hide(rid)); };
  M.setNotRelevant = function (nodeId, pid) { out(RA.notRelevant(pid)); };
  /* In the real app a case can be briefly unknown to the UI (native saved it, the refresh has not landed): reads must never throw on it. */
  ['caseState', 'requestView', 'photoOf', 'latestHeld'].forEach(function (name) {
    var orig = M[name]; if (!orig) return;
    M[name] = function (nodeId, rid) { return M.state().requests[rid] ? orig.apply(M, arguments) : null; };
  });
  /* The simulator-only controls do nothing in the real app (there is no simulated clock or world). */
  M.step = function () { return 0; }; M.join = function () { return { ok: false, error: 'not available' }; }; M.sharers = function () { return []; };

  NB.requestPermissions = function () { RA.requestPermissions(); };
  NB.enableBluetooth = function () { RA.requestEnableBluetooth(); };
  NB.openSettings = function () { RA.openAppSettings(); };
  NB.startRelay = function () { RA.startRelay(); };
  NB.stopRelay = function () { RA.stopRelay(); };
  NB.shareApp = function () { return parse(RA.shareApp()) || { ok: false, error: 'Could not share' }; };

  window.__relayChanged = function () { if (NB.refresh() && window.RelayUI && window.RelayUI.nativeChanged) window.RelayUI.nativeChanged(); };
})();
