/* Relay v3 - desktop network simulator. Own engine instance (mesh.js). Every highlight, counter, explanation and animation is computed from Mesh state
   (see sim_explain.js and docs/SIMULATOR_V3_DESIGN.md). Schematic only: positions are a drawing of a simulated network, not a map. */
(function () {
  'use strict';
  var M = window.Mesh, X = window.SimExplain, W = 1000, H = 700, NS = 'http://www.w3.org/2000/svg';
  var st = { scen: 'emergency', pid: null, playing: false, timer: null, until: null, speed: 1, sel: null, notice: '', vb: { x: 0, y: 0, w: W, h: H }, anims: [], raf: 0,
    ctx: {}, built: false, tab: 'walk', report: null, history: [], focus: 'city', mode: 'story', interval: 0 };
  var L = {};   // tiny event bus so the Story view can follow the same engine and scenario state
  function on(n, f) { (L[n] = L[n] || []).push(f); }
  function emit(n, a) { (L[n] || []).forEach(function (f) { try { f(a); } catch (e) { setTimeout(function () { throw e; }); } }); }
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function $(id) { return document.getElementById(id); }
  function S() { return M.state(); }
  function K() { return S().keys; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function h(tag, attrs) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { var v = attrs[k];
      if (k === 'class') e.className = v; else if (k === 'on') Object.keys(v).forEach(function (n) { e.addEventListener(n, v[n]); }); else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v); });
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) e.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); }); else e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
    return e;
  }
  function el(tag, attrs, parent) { var e = document.createElementNS(NS, tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); if (parent) parent.appendChild(e); return e; }
  var ICON = { play: 'M7 5l12 7-12 7z', pause: 'M8 5v14M16 5v14', step: 'M5 5l10 7-10 7zM19 5v14', reset: 'M4 4v6h6M5 14a8 8 0 108-8', zin: 'M12 5v14M5 12h14', zout: 'M5 12h14',
    fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', signal: 'M12 12h.01M8.5 8.5a5 5 0 000 7M15.5 8.5a5 5 0 010 7M5.5 5.5a9 9 0 000 13M18.5 5.5a9 9 0 010 13', userplus: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M19 8v6M16 11h6', check: 'M5 12l5 5 9-10' };
  function icon(n) { var s = el('svg', { viewBox: '0 0 24 24', class: 'icon' + (n === 'play' || n === 'step' ? ' solid' : ''), 'aria-hidden': 'true' }); el('path', { d: ICON[n] }, s); return s; }
  function pill(t, c) { return h('span', { class: 'pill ' + (c || 'neutral') }, t); }
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : b); }

  /* ---------- scenarios: every action is a real engine call ---------- */
  var FIXED = /[?&]responder=clinic/.test(location.search);   // regression mode: the original scripted "clinic volunteer" / "Vasant Vihar volunteer" (used by the older Explore test suites)
  function hash(t) { var x = 2166136261; for (var i = 0; i < t.length; i++) { x ^= t.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
  function farSide() {   // Relay phones in the same group as the far-side key phone: the group the requester's side cannot reach until the gap is bridged
    var s = S(), on = {}; s.order.forEach(function (i) { on[i] = M.canRelay(i); }); var comp = M.components(on), want = comp[K().E];
    return s.order.filter(function (i) { return on[i] && comp[i] === want; }).sort();
  }
  function pickBy(salt, ids) { return ids.reduce(function (b, i) { return hash(salt + i) < hash(salt + b) ? i : b; }, ids[0]); }
  function poster() { if (FIXED) return K().L; var c = st.ctx; if (!c.poster) c.poster = pickBy('poster:' + st.scen, farSide()); return c.poster; }
  /* The responder is whoever really receives the request on the other side: once at least six far-side phones hold it (or it can no longer move) the engine state picks one of them. */
  function respNow() {
    var c = st.ctx; if (FIXED) return K().E; if (c.responder) return c.responder;
    var pid = mainPid(), ins = c.install; if (!pid || !ins) return null;
    var D = ins.id, o = S().requests[c.rid] ? S().requests[c.rid].authorNodeId : null, can = M.stats(pid).canMove;
    var cand = M.holders(pid).filter(function (i) { return i !== D && i !== o && M.canRelay(i) && ins.newSet.indexOf(i) >= 0; }).sort();
    if (!cand.length && !can) cand = M.holders(pid).filter(function (i) { return M.canRelay(i) && ins.newSet.indexOf(i) >= 0 && i !== o; }).sort();
    if (!cand.length || (cand.length < 6 && can)) return null;
    c.responder = pickBy('responder:' + st.scen, cand); return c.responder;
  }
  function replyFor(id) { var q = REQ[st.scen].reply; return FIXED ? q : { kind: q.kind, note: q.note2, area: S().nodes[id].area + (q.kind === 'sighting' ? ', 10am' : '') }; }
  function updateFor(id, which) { var q = REQ.broadcast[which]; return FIXED ? q : { text: q.text, category: q.category, area: S().nodes[id].area }; }
  function urgentFor(id) { var q = REQ.broadcast.urgent; return FIXED ? q : { kind: q.kind, category: q.category, title: q.title, description: q.description, area: S().nodes[id].area, urgent: q.urgent }; }
  var REQ = {
    emergency: { request: { kind: 'urgent', category: 'Medical', title: 'Medical help needed near Hauz Khas Village', description: 'My mother needs medical assistance. She is having trouble breathing.', area: 'Hauz Khas Village', urgent: true },
      reply: { kind: 'offer', note: 'I can walk your mother to the clinic gate. I am a nurse (self-reported).', area: 'Clinic gate', note2: 'I’m close by and can help. I’m a nurse (self-reported).' } },
    missing: { request: { kind: 'missing', category: 'Missing', title: 'Looking for Meera, 8, red school bag', description: 'Last seen near the bus stop in a blue uniform.', area: 'Lodhi Road bus stop', urgent: false, targets: ['LC'], lastKnown: 'Lodhi Colony' },
      reply: { kind: 'sighting', note: 'Saw a girl with a red bag near the clinic gate around 10am.', area: 'Clinic gate, 10am', note2: 'Saw a girl with a red bag near the bus stop around 10am.' } },
    broadcast: { update: { text: 'Water collection point open at City Hall, north entrance.', category: 'Resources', area: 'Vasant Vihar' },
      update2: { text: 'Second update: queue is moving slowly at the north entrance.', category: 'Community', area: 'Vasant Vihar' },
      urgent: { kind: 'urgent', category: 'Medical', title: 'Medical help needed near the market', description: 'Someone has collapsed outside the market.', area: 'Vasant Vihar', urgent: true } }
  };
  var SCEN = {
    emergency: { label: '1 · Emergency assistance', dest: true,
      situation: function () { return { head: 'Mobile networks are down.', body: [h('b', {}, 'A person in Hauz Khas needs a doctor.'), ' They cannot call anyone. ' + M.participating().length + ' of the 80 phones in this simulated area run Relay, which passes short messages directly between nearby phones. Any Relay phone that receives it could respond. The request is not addressed to anyone: it spreads to every Relay phone it can reach.'] }; },
      steps: [
      { t: 'A survivor posts a medical request', a: 'Post request', run: function () { var r = M.createRequest(K().A, REQ.emergency.request); st.ctx.rid = r.requestId; select(r.packetId); }, done: function () { return !!st.ctx.rid; } },
      { t: 'It spreads phone to phone, then stalls at a gap', a: 'Play', run: function () { play(function () { return false; }); }, done: stalled },
      { t: 'A neighbour shares Relay at the gap', a: 'Share Relay at the gap', run: function () { openInstall(gapNode()); }, done: bridged },
      { t: 'It crosses and reaches someone who can respond', a: 'Play', run: function () { play(function () { var r = respNow(); return !!r && M.nodeHas(r, mainPid()); }); }, done: function () { var r = respNow(); return !!mainPid() && !!r && M.nodeHas(r, mainPid()); } },
      { t: 'A responder sends an offer of help', a: 'Send offer', run: function () { var r = respNow(), x = r ? M.createReply(r, st.ctx.rid, replyFor(r)) : { ok: false }; if (x.ok) { st.ctx.replyPid = x.packetId; select(x.packetId); } }, done: function () { return !!st.ctx.replyPid; } },
      { t: 'The offer travels back to the requester', a: 'Play', run: function () { play(function () { return M.nodeHas(K().A, st.ctx.replyPid); }); }, done: function () { return !!st.ctx.replyPid && M.nodeHas(K().A, st.ctx.replyPid); } },
      { t: 'The requester acknowledges the offer', a: 'Acknowledge and send', run: function () { var x = M.createAck(K().A, st.ctx.replyPid); if (x.ok) { st.ctx.ackPid = x.packetId; select(x.packetId); play(function () { return M.nodeHas(respNow(), x.packetId); }); } }, done: function () { return !!st.ctx.ackPid && M.nodeHas(respNow(), st.ctx.ackPid); } }] },
    missing: { label: '2 · Missing person', dest: true,
      situation: function () { return { head: 'A child is missing and nobody can phone around.', body: [h('b', {}, 'A parent in Hauz Khas is looking for a child last seen near Lodhi Colony.'), ' The request carries a target area, not coordinates. Each phone declares a neighbourhood by choice (no GPS). Relay prefers to pass the request to phones whose declared area is closer to the target in a small offline neighbourhood graph, with a limited number of detours.'] }; },
      steps: [
      { t: 'A survivor shares a missing-person request', a: 'Post request', run: function () { var r = M.createRequest(K().A, REQ.missing.request); st.ctx.rid = r.requestId; select(r.packetId); }, done: function () { return !!st.ctx.rid; } },
      { t: 'It spreads through participating phones and stalls', a: 'Play', run: function () { play(function () { return false; }); }, done: stalled },
      { t: 'A neighbour shares Relay at the gap', a: 'Share Relay at the gap', run: function () { openInstall(gapNode()); }, done: bridged },
      { t: 'It reaches a phone on the other side', a: 'Play', run: function () { play(function () { var r = respNow(); return !!r && M.nodeHas(r, mainPid()); }); }, done: function () { var r = respNow(); return !!mainPid() && !!r && M.nodeHas(r, mainPid()); } },
      { t: 'Someone submits a possible sighting', a: 'Send sighting', run: function () { var r = respNow(), x = r ? M.createReply(r, st.ctx.rid, replyFor(r)) : { ok: false }; if (x.ok) { st.ctx.replyPid = x.packetId; select(x.packetId); } }, done: function () { return !!st.ctx.replyPid; } },
      { t: 'The sighting returns. It stays unverified.', a: 'Play', run: function () { play(function () { return M.nodeHas(K().A, st.ctx.replyPid); }); }, done: function () { return !!st.ctx.replyPid && M.nodeHas(K().A, st.ctx.replyPid); } }] },
    broadcast: { label: '3 · Community broadcast', dest: false, phaseText: { outcome: 'An urgent request and community updates now compete for the same links.' },
      situation: function () { return { head: 'Useful information, but not an emergency.', body: [h('b', {}, 'A neighbour in Vasant Vihar posts that a water point is open.'), ' Community updates are the lowest priority: when a phone-to-phone link is busy, urgent requests go first. Later you will see an urgent request and an update compete for the same links.'] }; },
      steps: [
      { t: 'A neighbour posts a community update', a: 'Post update', run: function () { var x = M.createBroadcast(poster(), updateFor(poster(), 'update')); st.ctx.bpid = x.packetId; select(x.packetId); }, done: function () { return !!st.ctx.bpid; } },
      { t: 'It spreads, but only as far as Relay links reach', a: 'Play', run: function () { play(function () { return false; }); }, done: stalled },
      { t: 'A neighbour shares Relay at the gap', a: 'Share Relay at the gap', run: function () { openInstall(gapNode()); }, done: bridged },
      { t: 'It crosses to the Hauz Khas side', a: 'Play', run: function () { play(function () { return M.nodeHas(K().A, st.ctx.bpid); }); }, done: function () { return !!st.ctx.bpid && M.nodeHas(K().A, st.ctx.bpid); } },
      { t: 'Priority: an urgent request enters the same links', a: 'Post urgent request + update', run: function () { var b2 = M.createBroadcast(poster(), updateFor(poster(), 'update2')); st.ctx.bpid2 = b2.packetId; var r = M.createRequest(poster(), urgentFor(poster())); st.ctx.urgentPid = r.packetId; st.ctx.urgentTick = S().tick; select(r.packetId); }, done: function () { return !!st.ctx.urgentPid; } },
      { t: 'Watch which message goes first on a busy link', a: 'Step once', run: function () { pause(); st.notice = ''; doStep(); }, done: function () { return contested().length > 0; } }] }
  };
  function contested() {   // link-capacity waits since the urgent request was posted: the engine's own priority ordering at work
    var c = st.ctx, ids = {}; [c.bpid, c.bpid2, c.urgentPid].forEach(function (x) { if (x) ids[x] = 1; });
    var out = []; st.history.forEach(function (x) { if (x.tick > (c.urgentTick || 0)) x.waited.forEach(function (w) { if (w.code === 'capacity' && ids[w.pid]) out.push({ tick: x.tick, w: w }); }); });
    return out;
  }
  var PHASE = [['create', 'Create'], ['spread', 'Spread'], ['obstacle', 'Obstacle'], ['change', 'Change'], ['outcome', 'Outcome']];
  var PHASE_TEXT = { create: 'A message is created on one phone.', spread: 'It moves only between phones that run Relay and are next to each other.', obstacle: 'It stops. Something blocks it, and the panel says what.',
    change: 'Someone joins Relay. Watch what becomes possible, and what actually arrives.', outcome: 'A human response travels back through the same kind of links.' };
  function mainPid() { return st.ctx.rid ? S().requests[st.ctx.rid].packetId : (st.ctx.bpid || null); }
  function stalled() { return !!st.ctx.sawStall; }   // sticky: once the stall has been observed the story step stays done
  function noteStall() { var p = mainPid(); if (!p) return; var s = M.stats(p); if (s.held > 1 && !s.canMove && !st.ctx.sawStall) { st.ctx.sawStall = true; st.ctx.stallHeld = s.held; } }
  function bridged() { return S().nodes[K().D].hasApp; }
  function gapNode() { var p = mainPid(), s = p && M.stats(p); return s && s.blocked && s.candidates.length ? s.candidates[0] : K().D; }
  function curStep() { var sc = SCEN[st.scen]; for (var i = 0; i < sc.steps.length; i++) if (!sc.steps[i].done()) return i; return sc.steps.length; }
  function select(pid) { st.pid = pid; st.report = null; }
  function phase() {
    if (!mainPid()) return 'create';
    if (st.ctx.replyPid || st.ctx.urgentPid) return 'outcome';
    if (bridged()) return 'change';
    return stalled() ? 'obstacle' : 'spread';
  }

  /* ---------- graph ---------- */
  function build() {
    var s = S(), svg = $('net'); clear(svg); st.nodeEls = {}; st.edgeEls = []; st.edgeMap = {}; st.zoneEls = {};
    st.zoneG = el('g', {}, svg); st.edgeG = el('g', {}, svg); st.nodeG = el('g', {}, svg); st.ringG = el('g', {}, svg); st.animG = el('g', {}, svg); st.labG = el('g', {}, svg);
    s.hoods.forEach(function (hd, i) {
      var r = el('rect', { x: hd.x, y: hd.y, width: hd.w, height: hd.h, rx: 26, class: 'zone' + (i % 2 ? ' alt' : '') }, st.zoneG);
      var t = el('text', { x: hd.x + 16, y: hd.y + 26, class: 'zone-t' }, st.zoneG); t.textContent = hd.name.toUpperCase(); st.zoneEls[hd.id] = { r: r, t: t, hd: hd };
    });
    s.edges.forEach(function (e) { var a = s.nodes[e.from], b = s.nodes[e.to], l = el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'e' }, st.edgeG); var x = { e: e, l: l }; st.edgeEls.push(x); st.edgeMap[e.from + '|' + e.to] = st.edgeMap[e.to + '|' + e.from] = x; });
    s.order.forEach(function (id) { var n = s.nodes[id]; st.nodeEls[id] = el('circle', { cx: n.x, cy: n.y, r: 6, class: 'n', 'data-id': id }, st.nodeG); });
    st.built = true; rescale();
  }
  function scale() { var b = $('net').getBoundingClientRect(); return Math.min(b.width / st.vb.w, b.height / st.vb.h) || 1; }
  function setVB() { var v = st.vb; $('net').setAttribute('viewBox', v.x + ' ' + v.y + ' ' + v.w + ' ' + v.h); }
  function fit() { st.vb = { x: 0, y: 0, w: W, h: H }; st.focus = 'city'; rescale(); }
  function rescale() { setVB(); if (!st.built) return; st.u = 1 / scale(); if (st.drawn) paint(); else { markFocus(); } }
  function zoomBy(f, cx, cy) {
    var v = st.vb, nw = Math.max(170, Math.min(W * 1.1, v.w / f)), nh = nw * v.h / v.w;
    cx = cx == null ? v.x + v.w / 2 : cx; cy = cy == null ? v.y + v.h / 2 : cy;
    v.x = cx - (cx - v.x) * nw / v.w; v.y = cy - (cy - v.y) * nh / v.h; v.w = nw; v.h = nh; st.focus = ''; rescale();
  }
  function aspect() { var b = $('net').getBoundingClientRect(); return b.width && b.height ? b.height / b.width : H / W; }
  function viewOn(cx, cy, w) { var hh = w * aspect(); st.vb = { x: cx - w / 2, y: cy - hh / 2, w: w, h: hh }; rescale(); }
  function focusOn(mode) {
    var s = S(), p = st.pid && s.packets[st.pid], id = st.sel || (p && p.originNodeId) || K().A, n = s.nodes[id];
    if (mode === 'city') { fit(); return; }
    if (mode === 'area') { var z = s.hoods.filter(function (x) { return x.id === n.zone; })[0]; viewOn(z.x + z.w / 2, z.y + z.h / 2, Math.max(z.w + 80, (z.h + 80) / aspect())); }
    else viewOn(n.x, n.y, 230);
    st.focus = mode; rescale();
  }
  function markFocus() { [['city', 'focus-city'], ['area', 'focus-area'], ['phone', 'focus-phone']].forEach(function (x) { var b = $(x[1]); if (!b) return; b.className = 'seg' + (st.focus === x[0] ? ' on' : ''); b.setAttribute('aria-pressed', String(st.focus === x[0])); }); }
  function toWorld(cx, cy) { var svg = $('net'), p = svg.createSVGPoint(); p.x = cx; p.y = cy; var q = p.matrixTransform(svg.getScreenCTM().inverse()); return { x: q.x, y: q.y }; }
  function nearest(cx, cy, maxPx) {
    var w = toWorld(cx, cy), s = S(), best = null, bd = 1e9, sc = scale();
    s.order.forEach(function (id) { var n = s.nodes[id], d = Math.hypot(n.x - w.x, n.y - w.y) * sc; if (d < bd) { bd = d; best = id; } });
    return bd <= maxPx ? best : null;
  }
  function attach() {
    var svg = $('net'), down = null, moved = 0, tip = $('tip'), wrap = $('canvaswrap');
    svg.addEventListener('pointerdown', function (e) { try { svg.setPointerCapture(e.pointerId); } catch (x) {} down = { x: e.clientX, y: e.clientY }; moved = 0; });
    svg.addEventListener('pointermove', function (e) {
      if (down) { var dx = e.clientX - down.x, dy = e.clientY - down.y; moved += Math.abs(dx) + Math.abs(dy); if (moved > 5) { var sc = scale(); st.vb.x -= dx / sc; st.vb.y -= dy / sc; st.focus = ''; setVB(); markFocus(); tip.hidden = true; } down = { x: e.clientX, y: e.clientY }; return; }
      var id = nearest(e.clientX, e.clientY, 14);
      if (!id) { tip.hidden = true; return; }
      var n = S().nodes[id], has = st.pid && M.nodeHas(id, st.pid), b = wrap.getBoundingClientRect(), inb = has && S().inbox[id][st.pid];
      clear(tip); tip.appendChild(h('b', {}, X.nm(id) + (id === K().A || n.key ? '' : '')));
      tip.appendChild(h('span', {}, n.area + ' · ' + (M.canRelay(id) ? 'Relay on' : 'No Relay') + (st.pid ? (has ? ' · has the message' + (inb && inb.via ? ' (from ' + X.nm(inb.via) + ')' : ' (origin)') : ' · not reached') : '')));
      tip.hidden = false; tip.style.left = Math.min(e.clientX - b.left + 14, b.width - 260) + 'px'; tip.style.top = (e.clientY - b.top + 14) + 'px';
    });
    function up(e) { var was = down; down = null; if (was && moved <= 5 && e.type === 'pointerup') { st.sel = nearest(e.clientX, e.clientY, 18); if (st.sel) st.tab = 'inspect'; paint(); } }
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
    svg.addEventListener('pointerleave', function () { tip.hidden = true; });
    svg.addEventListener('wheel', function (e) { e.preventDefault(); var c = toWorld(e.clientX, e.clientY); zoomBy(e.deltaY < 0 ? 1.18 : 1 / 1.18, c.x, c.y); }, { passive: false });
    window.addEventListener('resize', rescale);
  }

  /* ---------- engine-derived helpers ---------- */
  function destOf(p) {
    if (!p) return null;
    if (p.type === 'request') return SCEN[st.scen].dest ? respNow() : null;
    if (p.type === 'reply') return S().requests[p.requestId].authorNodeId;
    if (p.type === 'ack') return p.payload.toNodeId;
    return null;
  }
  function queue(id) {
    var s = S(), out = [];
    Object.keys(s.inbox[id]).forEach(function (pid) {
      var p = s.packets[pid]; if (M.isExpired(p)) return;
      var wait = s.adj[id].filter(function (o) { return M.canRelay(o) && !M.nodeHas(o, pid); }).length;
      if (wait) out.push({ p: p, wait: wait });
    });
    return out.sort(function (a, b) { return a.p.prio - b.p.prio || a.p.createdTick - b.p.createdTick; });
  }
  function nameOf(pid) { return X.packetInfo(pid).name; }
  function trustedHood(id) { var x = M.hoodState(id); return x.reliable ? x.id : null; }
  function sumOut(pid) { var s = S(), n = 0; s.order.forEach(function (id) { var o = s.outbox[id][pid]; if (o) n += o.count; }); return n; }

  /* ---------- painting ---------- */
  function paint() {
    if (!st.built) return; st.drawn = true;
    if (st.mode !== 'explore') { noteStall(); emit('paint'); return; }
    var s = S(), pid = st.pid, p = pid && s.packets[pid], stt = p ? M.stats(pid) : null, u = st.u || 1;
    noteStall();
    var g = p ? X.groupsFor(pid) : null, fr = p ? X.frontier(pid) : null, has = {}, reach = {}, cut = {}, fresh = {}, hop = {}, path = {}, next = {}, held = {}, cand = {};
    if (p) {
      g.holders.forEach(function (i) { has[i] = 1; }); g.reachable.forEach(function (i) { reach[i] = 1; }); g.cutOff.forEach(function (i) { cut[i] = 1; });
      s.lastHops.forEach(function (m) { if (m.packetId === pid) { fresh[m.to] = 1; hop[m.from + '|' + m.to] = hop[m.to + '|' + m.from] = 1; } });
      g.holders.forEach(function (i) { var v = s.inbox[i][pid].via; if (v) path[v + '|' + i] = path[i + '|' + v] = 1; });
      fr.next.forEach(function (x) { next[x.from + '|' + x.to] = next[x.to + '|' + x.from] = 1; }); fr.held.forEach(function (x) { held[x.from + '|' + x.to] = held[x.to + '|' + x.from] = 1; });
      if (stt.blocked) stt.candidates.forEach(function (i) { cand[i] = 1; });
    }
    var dest = destOf(p), origin = p ? p.originNodeId : null, targets = (p && p.route.targets) || [];
    s.hoods.forEach(function (hd) {
      var z = st.zoneEls[hd.id], isT = targets.indexOf(hd.hood) >= 0, d = targets.length ? M.hoodDistance(hd.hood, targets[0]) : null;
      z.r.setAttribute('class', 'zone' + (s.hoods.indexOf(hd) % 2 ? ' alt' : '') + (isT ? ' target' : '')); z.t.setAttribute('class', 'zone-t' + (isT ? ' target' : ''));
      z.t.setAttribute('style', 'font-size:' + (11 * u) + 'px'); clear(z.t);
      var t1 = el('tspan', { x: hd.x + 16 }, z.t); t1.textContent = hd.name.toUpperCase();
      var sub = isT ? 'TARGET AREA' : targets.length && d !== null ? d + (d === 1 ? ' STEP AWAY' : ' STEPS AWAY') : '';
      if (sub) { var t2 = el('tspan', { x: hd.x + 16, dy: 13 * u, class: 'zone-sub' }, z.t); t2.textContent = sub; }   // second line: distance to the target in the neighbourhood graph
    });
    s.order.forEach(function (id) {
      var e = st.nodeEls[id], n = s.nodes[id], on = M.canRelay(id), cls = 'n ' + (on ? 'on' : 'off'), sw = 1.7, r = n.key ? 8 : 5.2;
      if (p && on) { if (has[id]) cls += ' has'; else if (reach[id]) { cls += ' reach'; sw = 2.6; } else { cls += ' cut'; sw = 2.4; } }
      if (fr && fr.frontierNodes[id]) { cls += ' front'; sw = 2.8; }
      if (fresh[id]) r *= 1.35;
      if (st.sel === id) cls += ' sel';
      e.setAttribute('class', cls); e.setAttribute('r', r * u); e.setAttribute('stroke-width', sw * u); e.setAttribute('stroke-dasharray', on ? '' : (2.2 * u) + ' ' + (1.8 * u));
    });
    st.edgeEls.forEach(function (x) {
      var e = x.e, k = e.from + '|' + e.to, live = M.canRelay(e.from) && M.canRelay(e.to), w = 1.3, dash = live ? '' : (3 * u) + ' ' + (3 * u);
      var cls = 'e' + (live ? ' live' : '') + (path[k] ? ' path' : '') + (hop[k] ? ' hop' : '') + (next[k] ? ' next' : '') + (held[k] ? ' held' : '');
      if (path[k]) w = 2.2; if (hop[k]) w = 3.2; if (next[k]) { w = 2.2; dash = (5 * u) + ' ' + (3 * u); } if (held[k]) { w = 2.2; dash = (1.5 * u) + ' ' + (3 * u); }
      x.l.setAttribute('class', cls); x.l.setAttribute('stroke-width', w * u); x.l.setAttribute('stroke-dasharray', dash);
    });
    clear(st.ringG); clear(st.labG);
    function ring(id, cls, r) { var n = s.nodes[id]; el('circle', { cx: n.x, cy: n.y, r: r * u, class: 'ring ' + cls, 'stroke-width': 2.4 * u, 'stroke-dasharray': cls === 'gap' ? (4 * u) + ' ' + (3 * u) : '' }, st.ringG); }
    function lab(id, text, cls) { var n = s.nodes[id], right = n.x > 760, t = el('text', { x: n.x + (right ? -1 : 1) * 14 * u, y: n.y + 4 * u, 'text-anchor': right ? 'end' : 'start', class: 'lab ' + (cls || ''), style: 'font-size:' + (12 * u) + 'px;stroke-width:' + (3 * u) + 'px' }, st.labG); t.textContent = text; }
    if (origin) { ring(origin, 'origin', 11); lab(origin, 'Origin · ' + s.nodes[origin].label); }
    if (dest && dest !== origin) { ring(dest, 'dest', 11); lab(dest, (p.type === 'request' ? 'Responder · ' : 'Destination · ') + X.nm(dest), 'dest'); }
    Object.keys(cand).forEach(function (id) { ring(id, 'gap', 12); lab(id, s.nodes[id].label + ' · no Relay', 'gap'); });
    if (st.sel && st.sel !== origin && st.sel !== dest && !cand[st.sel]) { ring(st.sel, 'origin', 9); lab(st.sel, X.nm(st.sel)); }
    if (st.vb.w < 380) s.order.forEach(function (id) { var n = s.nodes[id]; if (n.x < st.vb.x - 10 || n.x > st.vb.x + st.vb.w + 10 || n.y < st.vb.y - 10 || n.y > st.vb.y + st.vb.h + 10) return; var t = el('text', { x: n.x + 8 * u, y: n.y - 7 * u, class: 'nl', style: 'font-size:' + (9.5 * u) + 'px;stroke-width:' + (2.5 * u) + 'px' }, st.labG); t.textContent = id; });   // semantic zoom: phone ids appear when zoomed in
    markFocus(); panels(p, stt, g, fr, dest); controls(stt); emit('paint');
  }
  function controls(stt) {
    var can = st.pid && stt && stt.canMove;
    $('btn-play').disabled = st.playing || !st.pid || !can; $('btn-pause').disabled = !st.playing; $('btn-step').disabled = !st.pid;
  }

  /* ---------- explanations ---------- */
  function narrative(p, stt, g, fr) {
    if (st.notice) return { head: 'Heads up', body: st.notice, tone: 'warn' };
    if (!p) return { head: 'Nothing has been posted yet', body: 'Press the blue button to create the first message. Nothing moves until you press Play or Step.', tone: 'neutral' };
    var s = S(), hoodsWith = Object.keys(stt.hoods).filter(function (k) { return stt.hoods[k].held > 0; }).length, rec = 'Received by ' + stt.held + ' of ' + stt.participating + ' Relay phones';
    if (stt.expired) return { head: 'Message expired', body: 'It outlived its lifetime (' + (p.expiresTick - p.createdTick) + ' simulated minutes), so phones stopped passing it on. ' + rec + '.', tone: 'warn' };
    if (stt.canMove) { var dd = destOf(p), arrived = dd && dd !== p.originNodeId && M.nodeHas(dd, p.id);
      return { head: 'Spreading phone to phone', body: rec + ' in ' + plural(hoodsWith, 'neighbourhood', 'neighbourhoods') + '. Each step moves it one hop, and only between phones that are neighbours and both run Relay.' + (arrived ? ' It has already reached ' + s.nodes[dd].label + ' and keeps spreading, because this policy sends to every neighbour rather than steering toward one phone.' : ''), tone: 'info' }; }
    if (stt.complete) return { head: 'Reached every phone it can', body: rec + ': that is all of them. Phones without Relay cannot carry it.', tone: 'good' };
    var c = stt.candidates[0];
    if (c) return { head: 'Stalled: no route across the gap', body: rec + '. The ' + s.nodes[c].label.toLowerCase() + ' has no Relay, and it is the only link between two groups of Relay phones. If its owner accepts, ' + stt.unlock[c] + ' more phones become reachable (reachable is not received).', tone: 'warn' };
    if (stt.policy === 'directed' || stt.policy === 'opportunistic') return { head: 'Targeted delivery has run its course', body: rec + '. This message is steered toward its target area with a limited number of detours, so by design it does not go to every phone.', tone: 'good' };
    return { head: 'Stopped: nothing left to reach', body: rec + '. No holder has a Relay neighbour that lacks it.', tone: 'warn' };
  }
  function sample(list, n) {   // one example of each reason first, then the rest
    var seen = {}, out = [], rest = [];
    list.forEach(function (x) { if (!seen[x.code]) { seen[x.code] = 1; out.push(x); } else rest.push(x); });
    return out.concat(rest).slice(0, n);
  }
  function groupLine(list, verbPhrase) {   // many identical-reason hand-offs collapse into one line
    var by = {}; list.forEach(function (m) { (by[m.code + '|' + m.text] = by[m.code + '|' + m.text] || []).push(m); });
    return Object.keys(by).map(function (k) { var a = by[k], senders = {}; a.forEach(function (m) { senders[m.from] = 1; }); return { cls: '', main: plural(a.length, 'hand-off', 'hand-offs') + ' by ' + plural(Object.keys(senders).length, 'phone', 'phones') + (verbPhrase || ''), sub: a[0].text }; });
  }
  function whyList(p, stt, fr) {
    var lines = [], rep = st.report, pid = p.id, policy = p.route.policy;
    function mv(m) { return { cls: m.det ? 'held' : '', main: X.who(m.from) + ' → ' + X.who(m.to), sub: m.text }; }
    if (rep) {
      lines.push({ cls: 'wait', main: 'Last step (simulated minute ' + rep.tick + '):', sub: '' });
      var moves = rep.moves.filter(function (m) { return m.pid === pid; });
      if (moves.length) {
        if (policy === 'flood') lines = lines.concat(groupLine(moves)); else sample(moves, 6).forEach(function (m) { lines.push(mv(m)); });
        if (policy !== 'flood' && moves.length > 6) lines.push({ cls: '', main: '…and ' + (moves.length - 6) + ' more hand-offs this step', sub: '' });
      } else lines.push({ cls: 'wait', main: 'No hand-offs this step', sub: '' });
      rep.waited.filter(function (w) { return w.pid === pid && w.code === 'capacity'; }).slice(0, 3).forEach(function (w) { lines.push({ cls: 'wait', main: X.who(w.from) + ' → ' + X.who(w.to) + ' waited', sub: w.text }); });
    } else if (fr.next.length) {
      var intro = { cls: '', main: 'Next step (from the engine’s plan, not yet happened):', sub: '' }; lines.push(intro);
      if (policy === 'flood') lines = lines.concat(groupLine(fr.next, ' will pass it on')); else sample(fr.next, 5).forEach(function (m) { lines.push(mv(m)); });
    }
    var heldLines = [];
    sample(fr.held, 3).forEach(function (m) { heldLines.push({ cls: 'held', main: X.who(m.from) + ' is not passing it to ' + X.who(m.to), sub: m.text }); });
    if (fr.held.length > 3) heldLines.push({ cls: 'held', main: '…and ' + (fr.held.length - 3) + ' other held-back links', sub: '' });
    lines = stt.canMove ? lines.concat(heldLines) : heldLines.concat(lines);      // when it has stopped, why it stopped comes first
    if (fr.stop) lines.unshift({ cls: 'stop', main: 'Stopped', sub: fr.stop.text });
    return lines;
  }
  function stallDetail(pid, stt) {
    var b = X.bridge(pid); if (!b || stt.canMove) return null;
    var other = b.otherSides.reduce(function (a, x) { return a + x; }, 0), cutAll = X.groupsFor(pid).cutOff.length, extra = cutAll - other;
    return h('div', { class: 'note', id: 'gap-why', style: 'margin-top:8px' }, h('b', {}, b.name + ' (' + b.area + ')'), ' has no Relay. It sits between ' + plural(b.holdSide, 'Relay phone', 'Relay phones') + ' that hold the message and ' + plural(b.otherSides.reduce(function (a, x) { return a + x; }, 0), 'Relay phone', 'Relay phones') + ' that have no route to it. Without Relay on this one phone there is no chain of neighbouring Relay phones across the gap, so the other side is cut off, not slow.' + (extra > 0 ? ' (' + plural(extra, 'more cut-off phone is', 'more cut-off phones are') + ' in groups this phone does not touch.)' : ''));
  }

  function phasesCard() {
    var cur = phase(), idx = PHASE.map(function (x) { return x[0]; }).indexOf(cur);
    return h('div', { class: 'card', id: 'phasecard' }, h('ol', { class: 'phases', id: 'phases', 'aria-label': 'Walkthrough: create, spread, obstacle, change, outcome' }, PHASE.map(function (x, i) { return h('li', { class: i < idx ? 'done' : i === idx ? 'now' : '', 'aria-current': i === idx ? 'step' : false }, x[1]); })),
      h('div', { class: 'small muted', id: 'phase-text' }, (SCEN[st.scen].phaseText && SCEN[st.scen].phaseText[cur]) || PHASE_TEXT[cur]));
  }
  function situationCard(collapsed) {
    var x = SCEN[st.scen].situation();
    if (collapsed) return h('details', { class: 'card limits', id: 'situation' }, h('summary', {}, 'The situation: ' + x.head), h('p', { class: 'sit', style: 'margin:4px 0 0' }, x.body));
    return h('div', { class: 'card', id: 'situation' }, h('div', { class: 'eyebrow' }, 'The situation'), h('div', { class: 'headline' }, x.head), h('p', { class: 'sit', style: 'margin:0' }, x.body));
  }
  function storyCard() {
    var sc = SCEN[st.scen], cur = curStep();
    var story = h('div', { class: 'card', id: 'story' }, h('div', { class: 'eyebrow' }, 'Walkthrough · ' + sc.label.replace(/^\d · /, '')),
      cur < sc.steps.length ? h('div', { class: 'stepnow' }, h('span', { class: 'small muted' }, 'Step ' + (cur + 1) + ' of ' + sc.steps.length), h('b', { id: 'step-now' }, sc.steps[cur].t)) : h('div', { class: 'stepnow' }, h('b', {}, 'Scenario complete')));
    if (cur < sc.steps.length) story.appendChild(h('button', { class: 'btn primary block', id: 'btn-do', style: 'margin-top:8px', on: { click: function () { st.notice = ''; sc.steps[cur].run(); paint(); } } }, sc.steps[cur].a));
    else story.appendChild(h('div', { class: 'muted small', style: 'margin-top:8px' }, 'Choose another scenario, or press Reset to run it again.'));
    story.appendChild(h('details', { class: 'steps' }, h('summary', {}, 'All ' + sc.steps.length + ' steps'),
      h('ol', { class: 'story' }, sc.steps.map(function (x, i) { var d = x.done(); return h('li', { class: (d ? 'done' : '') + (i === cur ? ' now' : ''), 'data-step': i }, h('span', { class: 't' }, d ? '✓' : String(i + 1)), x.t); }))));
    return story;
  }
  function nowCard(p, stt, g, fr) {
    var nr = narrative(p, stt, g, fr), card = h('div', { class: 'card', id: 'nowcard' }, h('div', { class: 'eyebrow' }, 'What is happening, and why'), h('div', { class: 'headline', id: 'sim-head' }, nr.head), h('p', { class: 'muted', id: 'sim-body', style: 'margin:0' }, nr.body));
    if (p) {
      var sd = stallDetail(p.id, stt); if (sd) card.appendChild(sd);
      var lines = whyList(p, stt, fr);
      if (lines.length) card.appendChild(h('ul', { class: 'why', id: 'why' }, lines.map(function (l) { return h('li', { class: l.cls }, l.main, l.sub ? h('small', {}, l.sub) : null); })));
    }
    return card;
  }
  function msgCard(p, g) {
    if (!p) return null; var i = X.packetInfo(p.id), s = S();
    var ids = Object.keys(s.packets), sel = h('select', { id: 'msgpick', class: 'pick', 'aria-label': 'Message to follow' }, ids.map(function (id) { var o = h('option', { value: id }, nameOf(id) + (s.packets[id].requestId ? ' · ' + s.requests[s.packets[id].requestId].title.slice(0, 26) : ' · ' + s.packets[id].payload.text.slice(0, 26))); if (id === st.pid) o.selected = true; return o; }));
    sel.addEventListener('change', function (e) { st.pid = e.target.value || null; st.report = null; paint(); });
    var holdTxt = g.holders.length === 1 ? 'Held by 1 Relay phone: ' + i.originName + ' (the origin)' : 'Held by ' + g.holders.length + ' Relay phones';
    return h('div', { class: 'card', id: 'msgcard' }, h('div', { class: 'eyebrow' }, 'The message and who holds it'),
      h('div', { class: 'mcard' }, h('span', { class: 'badge ' + i.tone }, i.badge), h('h3', {}, i.title), i.body ? h('p', {}, i.body) : null,
        h('div', { class: 'meta' }, [i.from, i.where ? ' · ' + i.where : '']), h('div', { class: 'meta', style: 'margin-top:4px' }, i.priority + ' · expires in ' + i.expiresInMin + ' simulated min')),
      h('div', { class: 'small', id: 'm-holders', style: 'margin-top:8px;font-weight:700' }, holdTxt), h('div', { class: 'small muted' }, i.policyText),
      h('div', { style: 'margin-top:8px' }, h('label', { class: 'small muted', for: 'msgpick' }, 'Message shown on the map'), sel));
  }
  function numbersCard(p, stt, g, dest) {
    var s = S(), cov = M.coverage(), part = M.participating().length;
    var m = h('div', { class: 'card', id: 'numbers' }, h('h2', {}, 'Live numbers'));
    m.appendChild(h('div', { class: 'metrics' },
      h('div', { class: 'metric' }, h('strong', { id: 'm-part' }, part + ' of 80'), h('span', {}, 'phones running Relay')),
      h('div', { class: 'metric' }, h('strong', { id: 'm-held' }, stt ? String(stt.held) : '–'), h('span', {}, 'received this message')),
      h('div', { class: 'metric' }, h('strong', { id: 'm-groups' }, cov.groups + ' · ' + cov.largest), h('span', {}, 'Relay groups · largest')),
      h('div', { class: 'metric' }, h('strong', { id: 'm-step' }, String(s.tick)), h('span', {}, 'simulated minutes'))));
    if (!p) return m;
    var info = X.packetInfo(p.id), pct = stt.participating ? Math.round(100 * stt.held / stt.participating) : 0, tot = 80;
    m.appendChild(h('div', { class: 'row', style: 'margin-top:10px' }, h('strong', {}, info.name), pill(info.tone === 'urgent' ? 'Urgent' : info.tone === 'neutral' ? 'Low priority' : 'Normal', info.tone === 'warn' ? 'warn' : info.tone)));
    m.appendChild(h('div', { class: 'muted small', id: 'm-prio' }, info.priority + ' · expires in ' + info.expiresInMin + ' min'));
    m.appendChild(h('div', { class: 'reach', role: 'img', id: 'reachbar', 'aria-label': 'Received ' + g.holders.length + ', could still receive ' + g.reachable.length + ', cut off ' + g.cutOff.length + ', no Relay ' + g.noRelay.length },
      h('i', { class: 'r-held', style: 'width:' + (100 * g.holders.length / tot) + '%' }), h('i', { class: 'r-reach', style: 'width:' + (100 * g.reachable.length / tot) + '%' }), h('i', { class: 'r-cut', style: 'width:' + (100 * g.cutOff.length / tot) + '%' }), h('i', { class: 'r-no', style: 'width:' + (100 * g.noRelay.length / tot) + '%' })));
    m.appendChild(h('div', { class: 'keys', id: 'reachkeys' },
      h('span', {}, h('i', { class: 'sw has' }), 'Received', h('b', { id: 'r-held' }, String(g.holders.length))), h('span', {}, h('i', { class: 'sw reach' }), 'Could still receive', h('b', { id: 'r-reach' }, String(g.reachable.length))),
      h('span', {}, h('i', { class: 'sw cut' }), 'Cut off from it', h('b', { id: 'r-cut' }, String(g.cutOff.length))), h('span', {}, h('i', { class: 'sw off' }), 'No Relay', h('b', { id: 'r-norelay' }, String(g.noRelay.length)))));
    m.appendChild(h('div', { class: 'muted small', style: 'margin:4px 0 0' }, '“Could still receive” means connected to a holder through Relay phones. It is not receipt.'));
    m.appendChild(h('div', { class: 'row small', id: 'm-progress', style: 'margin-top:6px' }, h('span', {}, 'Received so far'), h('strong', {}, pct + '% of Relay phones')));
    m.appendChild(h('div', { class: 'row small', style: 'margin-top:4px', id: 'm-cut' }, h('span', {}, 'Relay phones cut off from it'), h('strong', {}, String(g.cutOff.length))));
    if (dest) {
      var dn = s.nodes[dest], got = M.nodeHas(dest, p.id), reach = M.canReach(p.id, dest), dl = got ? ['Reached', 'good'] : !M.canRelay(dest) ? ['No Relay on that phone', 'warn'] : stt.expired ? ['Expired before arriving', 'warn'] : reach ? ['Pending: a Relay route exists', 'info'] : ['Unreachable now: no Relay route', 'warn'];
      m.appendChild(h('div', { class: 'row', style: 'margin-top:8px', id: 'm-dest' }, h('span', { class: 'small' }, (p.type === 'request' ? 'Responder: ' : '') + X.nm(dest)), pill(dl[0], dl[1])));
    }
    scenMetrics(m, p, stt, g); return m;
  }
  function scenMetrics(m, p, stt, g) {
    var s = S(), A = K().A, rows = [], ctx = st.ctx;
    function atA(kind) { return Object.keys(s.packets).filter(function (k) { var q = s.packets[k]; return q.type === 'reply' && q.requestId === ctx.rid && (!kind || q.payload.kind === kind) && M.nodeHas(A, k); }).length; }
    if (st.scen === 'emergency') rows = [['Volunteer offers received by the requester', String(atA('offer'))], ['Phones holding the request', String(g.holders.length) + ' of ' + (g.holders.length + g.reachable.length + g.cutOff.length)]];
    else if (st.scen === 'missing' && p.route.targets && p.route.targets.length) {
      var tgt = g.holders.filter(function (i) { var d = trustedHood(i); return d && p.route.targets.indexOf(d) >= 0; }).length, inT = M.participating().filter(function (i) { var d = trustedHood(i); return d && p.route.targets.indexOf(d) >= 0; }).length;
      rows = [['Phones reached in the target area', tgt + ' of ' + inT + ' Relay phones there'], ['Copies handed on so far', String(sumOut(p.id))], ['Possible sightings returned (unverified)', String(atA('sighting'))]];
    } else if (st.scen === 'broadcast') {
      var upd = ctx.bpid, urg = ctx.urgentPid, exp = Object.keys(s.packets).filter(function (k) { return M.isExpired(s.packets[k]); }).length;
      rows = [['Phones holding the first update', String(upd ? M.holders(upd).length : 0)]]; if (ctx.bpid2) rows.push(['Phones holding the second update', String(M.holders(ctx.bpid2).length)]); if (urg) rows.push(['Phones holding the urgent request', String(M.holders(urg).length)]); rows.push(['Expired messages', String(exp)]);
    }
    if (rows.length) m.appendChild(h('dl', { class: 'cmp', id: 'scen-metrics' }, rows.map(function (r) { return [h('dt', {}, r[1]), h('dd', {}, r[0])]; }).reduce(function (a, b) { return a.concat(b); }, [])));
  }
  function hoodCard(p) {
    if (!p || !p.route.targets || !p.route.targets.length) return null;
    var hg = X.hoodGraph(p.id), byId = {}, rings = {}, pos = {}, cx = 150, cy = 118, R = [0, 52, 90, 112, 112];
    hg.rows.forEach(function (r) { byId[r.id] = r; var k = r.dist === null ? 4 : Math.min(r.dist, 3); (rings[k] = rings[k] || []).push(r); });
    Object.keys(rings).forEach(function (k) { var a = rings[k]; a.forEach(function (r, i) { var ang = (2 * Math.PI * i / a.length) + k * 0.9 - Math.PI / 2; pos[r.id] = k === '0' ? { x: cx, y: cy } : { x: cx + R[k] * Math.cos(ang), y: cy + R[k] * Math.sin(ang) * 0.95 }; }); });
    var svg = el('svg', { viewBox: '0 0 300 236', role: 'img', 'aria-label': 'Schematic neighbourhood graph centred on the target area. Distance in steps, not kilometres.' });
    [52, 90, 112].forEach(function (r) { el('circle', { cx: cx, cy: cy, r: r, class: 'ring0' }, svg); });
    var act = {}; if (st.report) st.report.moves.filter(function (m) { return m.pid === p.id; }).forEach(function (m) { var a = trustedHood(m.from), b = trustedHood(m.to); if (a && b && a !== b) act[a + '|' + b] = act[b + '|' + a] = 1; });
    hg.edges.forEach(function (e) { el('line', { x1: pos[e[0]].x, y1: pos[e[0]].y, x2: pos[e[1]].x, y2: pos[e[1]].y, class: act[e[0] + '|' + e[1]] ? 'act' : '' }, svg); });
    hg.rows.forEach(function (r) { var q = pos[r.id], g = el('g', {}, svg); var c = el('circle', { cx: q.x, cy: q.y, r: 14, class: (r.dist === 0 ? 'tg ' : '') + (r.holders ? 'hold' : '') }, g); var t = el('text', { x: q.x, y: q.y + 3.5, 'text-anchor': 'middle', class: r.holders ? '' : 'hl', style: r.holders ? 'fill:#fff;font-weight:800' : '' }, g); t.textContent = r.id; var ti = el('title', {}, g); ti.textContent = r.name + ' · ' + (r.dist === null ? 'unreachable in this graph' : r.dist + ' steps from the target') + ' · ' + r.relay + ' Relay phones declare it · ' + r.holders + ' hold the message'; });
    var tb = h('table', { class: 'tbl', id: 'hood-table' }, h('tr', {}, ['Declared area', 'Steps to target', 'Relay phones', 'Hold it'].map(function (x) { return h('td', { class: 'muted small' }, x); })),
      hg.rows.slice().sort(function (a, b) { return (a.dist === null ? 9 : a.dist) - (b.dist === null ? 9 : b.dist) || (a.name < b.name ? -1 : 1); }).filter(function (r) { return r.relay || r.dist === 0; }).map(function (r) { return h('tr', {}, h('td', {}, r.name), h('td', {}, r.dist === null ? '–' : String(r.dist)), h('td', {}, String(r.relay)), h('td', {}, String(r.holders))); }));
    return h('div', { class: 'card hood', id: 'hoodcard' }, h('div', { class: 'eyebrow' }, 'Why it is steered this way'),
      h('p', { class: 'small', style: 'margin:0 0 6px' }, 'Relay passes the request to a phone when its declared neighbourhood is no farther from ' + X.targetNames(p.route) + ' than the sender’s, or when both are within 1 step of it. A few detours are allowed so it cannot get stuck. Steps are hops in this small offline graph: not kilometres, and not GPS.'),
      svg, tb);
  }
  function priorityCard() {
    if (st.scen !== 'broadcast' || !st.ctx.urgentPid) return null;
    var s = S(), u = st.ctx.urgentPid, b = st.ctx.bpid2, rep = st.report, card = h('div', { class: 'card', id: 'prioritycard' }, h('div', { class: 'eyebrow' }, 'Who goes first when a link is busy'));
    card.appendChild(h('p', { class: 'small', style: 'margin:0 0 6px' }, 'A phone hands each neighbour ' + M.CAP + ' message per step. If two messages want the same link, the one with the higher priority goes first: urgent request (priority ' + s.packets[u].prio + ') before community update (priority ' + s.packets[b].prio + ').'));
    card.appendChild(h('div', { class: 'note', id: 'm-priority', style: 'margin:0 0 8px' }, 'Priority check: the urgent request is on ' + M.holders(u).length + ' phones; the update posted at the same moment is on ' + M.holders(b).length + '. Each link passes one message per step, urgent first.'));
    var all = contested(), wins = 0; all.forEach(function (x) { if (s.packets[x.w.winner].prio <= s.packets[x.w.pid].prio) wins++; });
    if (!st.history.length || !all.length && !rep) card.appendChild(h('div', { class: 'muted small', id: 'm-priority-none' }, 'Press Step. The engine reports which messages used each link and which had to wait.'));
    else {
      card.appendChild(h('div', { class: 'small', id: 'prio-summary', style: 'font-weight:700' }, all.length ? 'Since the urgent request was posted, ' + plural(all.length, 'busy-link moment', 'busy-link moments') + ' occurred. The higher-priority message went first in ' + wins + ' of ' + all.length + '.' : 'No link has been contested yet.'));
      if (all.length) card.appendChild(h('ul', { class: 'why', id: 'prio-list' }, all.slice(-5).reverse().map(function (x) { var w = x.w; return h('li', { class: 'wait' }, 'Minute ' + x.tick + ' · ' + X.nm(w.from) + ' → ' + X.nm(w.to) + ': ' + nameOf(w.winner) + ' went first', h('small', {}, nameOf(w.pid) + ' waited for the next step (one message per link per step).')); })));
      if (rep) { var last = rep.moves.filter(function (m) { return m.pid === u; }).length, lastB = rep.moves.filter(function (m) { return m.pid === b; }).length;
        card.appendChild(h('div', { class: 'small muted', style: 'margin-top:6px' }, 'Hand-offs in the last step: urgent request ' + last + ', second update ' + lastB + '.')); }
    }
    return card;
  }
  function changedCard() {
    var ins = st.ctx.install; if (!ins || !st.pid) return null; var pid = ins.pid, g = X.groupsFor(pid), s = S();
    var got = ins.newSet.filter(function (i) { return M.nodeHas(i, pid); }).length;
    var rows = [['Newly connected', X.nm(ins.id) + ' now runs Relay and touches ' + plural(ins.links, 'Relay phone', 'Relay phones') + '. Relay groups: ' + ins.before.groups + ' → ' + ins.after.groups + '.'],
      ['Newly reachable', plural(ins.newSet.length, 'Relay phone is', 'Relay phones are') + ' now in a group that holds the message. Reachable only means a route exists.'],
      ['Actually received since', got + ' of those ' + ins.newSet.length + ' have received it so far' + (got === ins.newSet.length && got ? ' (all)' : '') + '. Total received: ' + g.holders.length + ' (was ' + ins.before.holders + ' before the install).']];
    if (st.ctx.replyPid) rows.push(['Responded', 'A reply now exists (' + (M.nodeHas(K().A, st.ctx.replyPid) ? 'and has reached the requester' : 'still travelling') + ').']);
    return h('div', { class: 'card', id: 'changedcard' }, h('div', { class: 'eyebrow' }, 'What changed when Relay was installed'), h('dl', { class: 'cmp' }, rows.map(function (r) { return [h('dt', {}, r[0]), h('dd', {}, r[1])]; }).reduce(function (a, b) { return a.concat(b); }, [])));
  }
  function outcomeCard() {
    var rp = st.ctx.replyPid; if (!rp || st.scen === 'broadcast') return null; var s = S(), A = K().A, i = X.packetInfo(rp), got = M.nodeHas(A, rp);
    var card = h('div', { class: 'card', id: 'outcomecard' }, h('div', { class: 'eyebrow' }, 'The human response'), h('div', { class: 'mcard' }, h('span', { class: 'badge warn' }, 'Unverified'), h('h3', {}, i.title), h('p', {}, i.body), h('div', { class: 'meta' }, i.from + (i.where ? ' · ' + i.where : ''))));
    if (!got) card.appendChild(h('div', { class: 'small muted', style: 'margin-top:8px', id: 'outcome-state' }, 'It exists only on the responder’s phone until it hops back. Press Play.'));
    else {
      var ch = X.chain(rp, A); card.appendChild(h('div', { class: 'small', id: 'outcome-state', style: 'margin-top:8px;font-weight:700' }, 'Reached the requester through ' + plural(ch.length - 1, 'hand-off', 'hand-offs') + ' via ' + plural(ch.length, 'phone', 'phones') + '.'));
      if (st.scen === 'missing') card.appendChild(h('p', { class: 'small', id: 'outcome-close', style: 'margin:6px 0 0' }, 'A possible sighting returned. It is unverified: a person still has to check it.'));
      else if (st.ctx.ackPid && M.nodeHas(respNow(), st.ctx.ackPid)) card.appendChild(h('p', { class: 'small', id: 'outcome-close', style: 'margin:6px 0 0;font-weight:700' }, 'A request travelled. Someone responded. Coordination became possible.', h('span', { class: 'muted', style: 'display:block;font-weight:400' }, 'This simulation does not show that anyone was helped. The offer is self-reported and unverified.')));
      else card.appendChild(h('p', { class: 'small muted', style: 'margin:6px 0 0' }, 'Next: the requester acknowledges the offer, which must travel back to the responder.'));
    }
    return card;
  }
  function limitsCard() {
    return h('details', { class: 'card limits', id: 'limits' }, h('summary', {}, 'What Relay can and cannot promise'),
      h('ul', {}, h('li', {}, 'Can: pass a short message between nearby phones that run Relay, with no internet and no server.'), h('li', {}, 'Cannot: reach phones that no chain of Relay phones connects to. Nothing here is guaranteed to arrive.'),
        h('li', {}, 'Simulated minutes show order of events, not how long real Bluetooth would take.'), h('li', {}, 'Offers and sightings are unverified. A response is not proof that help arrived.')));
  }
  function walkPanel(side, p, stt, g, fr, dest) {
    /* explanation first (what / why / what changed / outcome), then the data behind it */
    side.appendChild(phasesCard()); if (!p) side.appendChild(situationCard(false)); side.appendChild(storyCard());
    var late = phase() === 'outcome', first = late ? [outcomeCard(), priorityCard()] : [];
    first.forEach(function (c) { if (c) side.appendChild(c); });
    side.appendChild(nowCard(p, stt, g, fr));
    (late ? [changedCard(), hoodCard(p), msgCard(p, g)] : [changedCard(), hoodCard(p), msgCard(p, g)]).forEach(function (c) { if (c) side.appendChild(c); });
    side.appendChild(numbersCard(p, stt, g, dest));
    if (p) side.appendChild(situationCard(true));
    side.appendChild(limitsCard());
  }

  /* ---------- inspect tab: technical detail on demand ---------- */
  function inspectPanel(side, p, stt, g, fr) {
    var s = S();
    if (p) {
      var i = X.packetInfo(p.id), rt = p.route;
      side.appendChild(h('div', { class: 'card', id: 'msginspect' }, h('h2', {}, 'Selected message'), h('div', { class: 'small' }, h('b', {}, i.name), ' · ' + i.from),
        h('dl', { class: 'cmp' }, [['Routing policy', rt.policy + (rt.targets && rt.targets.length ? ' → ' + X.targetNames(rt) : '')], ['Hop limit', String(rt.maxHops)], ['Fan-out limit', rt.fanout ? String(rt.fanout) : 'none'], ['Detours allowed', rt.policy === 'directed' ? String(rt.detourMax) + ' (+' + M.ROUTE.patientExtra + ' if stuck ' + M.ROUTE.patience + '+ min)' : 'n/a'], ['Link capacity', M.CAP + ' message per neighbour per step'], ['Lifetime', (p.expiresTick - p.createdTick) + ' simulated min, ' + i.expiresInMin + ' left'], ['Hand-offs so far', String(sumOut(p.id))]]
          .map(function (r) { return [h('dt', {}, r[0]), h('dd', {}, r[1])]; }).reduce(function (a, b) { return a.concat(b); }, []))));
    }
    var pickOpts = [h('option', { value: '' }, 'Choose a phone…')].concat(s.order.slice().sort(function (a, b) { var na = s.nodes[a], nb = s.nodes[b]; return (nb.key ? 1 : 0) - (na.key ? 1 : 0) || (na.zone < nb.zone ? -1 : na.zone > nb.zone ? 1 : 0) || (+a.slice(1)) - (+b.slice(1)); }).map(function (id) { var o = h('option', { value: id }, X.nm(id) + ' · ' + s.nodes[id].area + ' · ' + (M.canRelay(id) ? 'Relay' : 'no Relay')); if (id === st.sel) o.selected = true; return o; }));
    var pick = h('select', { id: 'phonepick', class: 'pick', 'aria-label': 'Choose a phone to inspect' }, pickOpts); pick.addEventListener('change', function (e) { st.sel = e.target.value || null; paint(); });
    var dev = h('div', { class: 'card', id: 'devcard' }, h('h2', {}, 'Selected device'), h('div', { class: 'pickrow' }, pick));
    if (!st.sel) dev.appendChild(h('p', { class: 'muted small', style: 'margin:8px 0 0' }, 'Click any phone on the map, or choose one above. Phones without Relay can accept an install from a neighbour.'));
    else {
      var n = s.nodes[st.sel], on = M.canRelay(st.sel), relayN = s.adj[st.sel].filter(M.canRelay).length, has = p && M.nodeHas(st.sel, p.id);
      dev.appendChild(h('div', { class: 'row', style: 'margin-top:8px' }, h('strong', {}, X.nm(st.sel)), pill(on ? 'Relay on' : 'No Relay', on ? 'good' : 'neutral')));
      dev.appendChild(h('div', { class: 'muted small' }, n.area + ' · ' + relayN + ' of ' + s.adj[st.sel].length + ' nearby phones run Relay' + (p ? (has ? ' · has the message' : ' · message not reached') : '')));
      if (p && has) { var ch = X.chain(p.id, st.sel); dev.appendChild(h('div', { class: 'small', id: 'chain', style: 'margin-top:6px' }, h('b', {}, 'How it got here: '), ch.length === 1 ? 'this phone is the origin.' : ch.map(function (x) { return X.nm(x); }).join(' → '))); }
      if (p) {
        var rows = X.neighbours(st.sel, p.id);
        dev.appendChild(h('div', { class: 'small', style: 'margin-top:8px;font-weight:700' }, 'Neighbours and this message'));
        dev.appendChild(h('table', { class: 'tbl', id: 'nbrs' }, rows.map(function (r) { return h('tr', {}, h('td', { class: r.verdict === 'send' ? 'v-send' : r.verdict === 'detour' ? 'v-detour' : r.verdict === 'withhold' ? 'v-withhold' : r.verdict === 'stop' ? 'v-stop' : '' }, r.name), h('td', {}, h('b', {}, r.verdict === 'send' ? 'Will receive next step. ' : r.verdict === 'detour' ? 'Detour next step. ' : r.verdict === 'withhold' ? 'Held back. ' : r.verdict === 'stop' ? 'Not passed on. ' : ''), r.text)); })));
      }
      if (on) { var q = queue(st.sel); dev.appendChild(h('div', { class: 'small', style: 'margin-top:8px;font-weight:700' }, 'Waiting to forward (urgent first)'));
        dev.appendChild(q.length ? h('ul', { class: 'queue', id: 'queue' }, q.slice(0, 5).map(function (x) { return h('li', {}, h('span', {}, nameOf(x.p.id)), h('span', { class: 'muted' }, x.p.prio === 0 ? 'urgent' : x.p.prio === 2 ? 'update' : 'normal')); })) : h('div', { class: 'muted small' }, 'Nothing waiting.')); }
      else if (M.sharers(st.sel).length) dev.appendChild(h('button', { class: 'btn soft block', id: 'btn-install', style: 'margin-top:10px', on: { click: function () { openInstall(st.sel); } } }, icon('userplus'), 'Install Relay on this phone'));
      else dev.appendChild(h('div', { class: 'muted small', style: 'margin-top:8px' }, 'No neighbouring phone with Relay can share it.'));
    }
    side.appendChild(dev);
    if (p) {
      var log = st.history.filter(function (x) { return x.moves.some(function (m) { return m.pid === p.id; }) || x.waited.some(function (w) { return w.pid === p.id; }); }).slice(-20).reverse();
      side.appendChild(h('div', { class: 'card', id: 'steplog-card' }, h('h2', {}, 'Step-by-step history'), log.length ? h('ul', { class: 'steplog', id: 'steplog' }, log.map(function (x) {
        var mv = x.moves.filter(function (m) { return m.pid === p.id; }), det = mv.filter(function (m) { return m.det; }).length;
        return h('li', {}, h('b', {}, 't=' + x.tick), ' · ' + plural(mv.length, 'hand-off', 'hand-offs') + (det ? ' (' + det + ' detour' + (det === 1 ? '' : 's') + ')' : '') + (x.waited.some(function (w) { return w.pid === p.id && w.code === 'capacity'; }) ? ' · some waited for a busy link' : '') + (mv.length <= 3 ? ': ' + mv.map(function (m) { return m.from + '→' + m.to; }).join(', ') : '')); })) : h('div', { class: 'muted small' }, 'No hand-offs yet. Press Step or Play.')));
    }
  }
  function panels(p, stt, g, fr, dest) {
    var side = $('side'), top = side.scrollTop; clear(side);
    $('tab-walk').setAttribute('aria-selected', String(st.tab === 'walk')); $('tab-inspect').setAttribute('aria-selected', String(st.tab === 'inspect'));
    if (st.tab === 'inspect') inspectPanel(side, p, stt, g, fr); else walkPanel(side, p, stt, g, fr, dest);
    side.scrollTop = top;
  }

  /* ---------- playback ---------- */
  function startAnim() {
    if (reduce || !st.pid) return; var s = S(), t0 = performance.now(), dur = Math.min(900, 1100 / st.speed * 0.8);
    s.lastHops.filter(function (m) { return m.packetId === st.pid; }).slice(0, 80).forEach(function (m) { st.anims.push({ a: s.nodes[m.from], b: s.nodes[m.to], t0: t0, dur: dur }); });
    if (!st.raf) st.raf = requestAnimationFrame(frame);
  }
  function frame() {
    var now = performance.now(), u = st.u || 1; clear(st.animG);
    st.anims = st.anims.filter(function (a) { return now - a.t0 < a.dur; });
    st.anims.forEach(function (a) { var k = Math.max(0, Math.min(1, (now - a.t0) / a.dur)); el('circle', { cx: a.a.x + (a.b.x - a.a.x) * k, cy: a.a.y + (a.b.y - a.a.y) * k, r: 5 * u, class: 'packet', 'stroke-width': 1.5 * u }, st.animG); });
    st.raf = st.anims.length ? requestAnimationFrame(frame) : 0;
  }
  function stopAnim() { st.anims = []; if (st.raf) cancelAnimationFrame(st.raf); st.raf = 0; if (st.animG) clear(st.animG); }
  function doStep() {
    var before = X.snapshotPlan(); M.step(); st.report = X.report(before);
    st.history.push({ tick: st.report.tick, moves: st.report.moves.map(function (m) { return { from: m.from, to: m.to, pid: m.pid, det: m.det, code: m.code }; }), waited: st.report.waited.map(function (w) { return { from: w.from, to: w.to, pid: w.pid, code: w.code, winner: w.winner }; }) });
    if (st.history.length > 300) st.history.shift(); if (st.mode === 'explore') startAnim(); emit('step', st.report); paint();
  }
  function play(until) {
    st.notice = '';
    if (!st.pid) { st.notice = 'Nothing to play yet. Post a message with the blue button first.'; paint(); return; }
    if (!M.stats(st.pid).canMove) { st.notice = 'This message cannot move right now: no Relay phone holding it has a Relay neighbour that lacks it.'; paint(); return; }
    st.until = until || null; st.playing = true; schedule(); paint();
  }
  function schedule() { clearTimeout(st.timer); st.timer = setTimeout(tick, st.interval || 1100 / st.speed); }
  function tick() {
    if (!st.playing) return; doStep();
    var stop = (st.until && st.until()) || !st.pid || !M.stats(st.pid).canMove;
    if (stop) pause(); else schedule();
  }
  function pause() { clearTimeout(st.timer); st.timer = null; st.playing = false; st.until = null; stopAnim(); emit('pause'); paint(); }
  function resetWorld() {
    pause(); M.reset(); st.ctx = {}; st.pid = null; st.sel = null; st.notice = ''; st.report = null; st.history = []; st.tab = 'walk'; stopAnim(); build(); fit(); emit('reset'); paint();
  }

  /* ---------- consent-based install (Explore dialog and Story share this) ---------- */
  function sharerFor(id) { var p = mainPid() || st.pid; return M.sharers(id).sort(function (a, b) { return (p && M.nodeHas(b, p)) - (p && M.nodeHas(a, p)); })[0]; }
  function doJoin(id, sh, p) {
    var before = p ? X.connectivity(p) : null, r = M.join(id, sh); st.notice = r.ok ? '' : r.error;
    if (r.ok && p) { var after = X.connectivity(p); st.ctx.install = { id: id, pid: p, links: X.liveLinks(id).length, before: before, after: after, newSet: X.groupsFor(p).reachable.slice(), tick: S().tick }; st.report = null; }
    return r;
  }

  function openInstall(id) {
    pause(); var s = S(), n = s.nodes[id], p = st.pid;
    var sh = M.sharers(id).sort(function (a, b) { return (p && M.nodeHas(b, p)) - (p && M.nodeHas(a, p)); })[0];
    if (!sh) { st.notice = 'No neighbouring phone with Relay is close enough to share it.'; paint(); return; }
    var stage = 0;
    function effect() {
      if (!p) return null; var b = X.bridge(p), g = X.groupsFor(p), st0 = M.stats(p); if (!b || b.id !== id) return null;
      return h('p', { class: 'sit', id: 'inst-effect' }, 'If it installs: this phone would link ' + plural(b.holdSide, 'Relay phone', 'Relay phones') + ' that hold the message to ' + plural(b.otherSides.reduce(function (a, x) { return a + x; }, 0), 'Relay phone', 'Relay phones') + ' that do not. Nothing is received yet: the message still has to hop across.');
    }
    function show() {
      var body = $('mbody'); clear(body); $('mtitle').textContent = stage === 0 ? 'A neighbour nearby offers Relay' : 'Simulated file shared';
      if (stage === 0) body.appendChild(h('div', {}, h('p', {}, s.nodes[sh].label + ' is next to the ' + n.label.toLowerCase() + ' (' + n.area + ') and can pass the Relay install file over a short-range link. Nothing is installed unless its owner accepts.'), effect(),
        h('div', { class: 'note' }, 'Simulated: no file is transferred and nothing is installed.'),
        h('div', { class: 'stack', style: 'margin-top:12px' }, h('button', { class: 'btn primary block', id: 'inst-send', on: { click: function () { stage = 1; show(); } } }, 'Share install file'), h('button', { class: 'btn block', on: { click: closeModal } }, 'Cancel'))));
      else body.appendChild(h('div', {}, h('p', {}, 'Install Relay on the ' + n.label.toLowerCase() + '? It will then pass on messages from nearby phones.'),
        h('div', { class: 'stack' }, h('button', { class: 'btn primary block', id: 'inst-accept', on: { click: function () {
          doJoin(id, sh, p); closeModal(); paint(); } } }, 'Accept installation'), h('button', { class: 'btn block', on: { click: closeModal } }, 'Cancel'))));
    }
    $('modalroot').hidden = false; show(); $('modal').focus();
  }
  function closeModal() { $('modalroot').hidden = true; }

  /* ---------- boot ---------- */
  function boot() {
    $('mark').appendChild(icon('signal'));
    function setBtn(id, ic, text) { var b = $(id); b.appendChild(icon(ic)); b.appendChild(document.createTextNode(text)); }
    setBtn('btn-play', 'play', 'Play'); setBtn('btn-pause', 'pause', 'Pause'); setBtn('btn-step', 'step', 'Step'); setBtn('btn-reset', 'reset', 'Reset');
    $('z-in').appendChild(icon('zin')); $('z-out').appendChild(icon('zout')); $('z-fit').appendChild(icon('fit'));
    var sel = $('scenario'); Object.keys(SCEN).forEach(function (k) { sel.appendChild(h('option', { value: k }, SCEN[k].label)); });
    sel.addEventListener('change', function () { setScenario(sel.value); });
    $('to-story').addEventListener('click', function () { setMode('story'); });
    $('speed').addEventListener('change', function (e) { st.speed = +e.target.value; if (st.playing) schedule(); });
    $('btn-play').addEventListener('click', function () { play(null); }); $('btn-pause').addEventListener('click', pause);
    $('btn-step').addEventListener('click', function () { pause(); st.notice = ''; if (!st.pid) { st.notice = 'Nothing to step yet. Post a message with the blue button first.'; paint(); return; } doStep(); });
    $('btn-reset').addEventListener('click', function () { resetWorld(); });
    $('z-in').addEventListener('click', function () { zoomBy(1.4); }); $('z-out').addEventListener('click', function () { zoomBy(1 / 1.4); }); $('z-fit').addEventListener('click', fit);
    $('focus-city').addEventListener('click', function () { focusOn('city'); }); $('focus-area').addEventListener('click', function () { focusOn('area'); }); $('focus-phone').addEventListener('click', function () { focusOn('phone'); });
    $('tab-walk').addEventListener('click', function () { st.tab = 'walk'; paint(); }); $('tab-inspect').addEventListener('click', function () { st.tab = 'inspect'; paint(); });
    $('mback').addEventListener('click', closeModal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
      if (e.target === document.body && e.key === ' ') { e.preventDefault(); if (st.playing) pause(); else if (!$('btn-play').disabled) play(null); }
    });
    var lg = $('legend'); lg.setAttribute('aria-label', 'Legend');
    [['sw on', 'Relay phone'], ['sw has', 'Has the message'], ['sw reach', 'Could still receive'], ['sw cut', 'Cut off from it'], ['sw off', 'No Relay'], ['sw front', 'Hands it on next'],
      ['ln', 'Path it took'], ['ln hop', 'Moved this step'], ['ln next', 'Will move next'], ['ln held', 'Held back']].forEach(function (x) { lg.appendChild(h('span', {}, h('i', { class: x[0] }), x[1])); });
    build(); attach(); fit(); paint();
  }
  function setScenario(k) { st.scen = k; var sel = $('scenario'); if (sel) sel.value = k; resetWorld(); }
  function setMode(m) {
    pause(); st.mode = m; document.body.className = 'mode-' + m; $('s-root').hidden = m !== 'story'; $('explore').hidden = m !== 'explore';
    try { history.replaceState(null, '', m === 'explore' ? '#explore' : location.pathname + location.search.replace(/[?&]mode=explore/, '')); } catch (e) {}
    if (m === 'explore') { st.interval = 0; rescale(); paint(); } else { st.interval = STORY_INTERVAL; emit('mode', m); emit('paint'); }
  }
  var STORY_INTERVAL = 640;   // ms between simulated steps while Story plays; Explore keeps its own speed control
  window.RelaySim = { state: st, on: on, api: { SCEN: SCEN, REQ: REQ, setScenario: setScenario, setMode: setMode, curStep: curStep, doStep: doStep, play: play, pause: pause, reset: resetWorld, select: select, mainPid: mainPid,
    bridged: bridged, gapNode: gapNode, stalled: stalled, sharerFor: sharerFor, responder: respNow, poster: poster, replyFor: replyFor, updateFor: updateFor, urgentFor: urgentFor, fixed: FIXED, join: function (id) { var sh = sharerFor(id); if (!sh) return { ok: false, error: 'No neighbouring phone with Relay is close enough to share it.' }; var r = doJoin(id, sh, mainPid() || st.pid); paint(); return r; }, contested: contested, S: S, K: K } };
  var qs = location.search + location.hash; setMode(/mode=explore|#explore/.test(qs) ? 'explore' : 'story');
  boot();
})();
