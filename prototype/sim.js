/* Relay v2.1 – desktop Network Simulator. Own engine instance (mesh.js). Every highlight, counter and animation is computed from Mesh state. */
(function () {
  'use strict';
  var M = window.Mesh, W = 1000, H = 700, NS = 'http://www.w3.org/2000/svg';
  var st = { scen: 'emergency', pid: null, playing: false, timer: null, until: null, speed: 1, sel: null, notice: '',
    vb: { x: 0, y: 0, w: W, h: H }, anims: [], raf: 0, ctx: {}, built: false };
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

  /* ---------- scenarios: every action is a real engine call ---------- */
  var SCEN = {
    emergency: { label: '1 · Emergency assistance', dest: true, steps: [
      { t: 'A survivor posts a medical request', a: 'Post request', run: function () { var r = M.createRequest(K().A, { kind: 'urgent', category: 'Medical', title: 'Medical help needed near Hauz Khas Village', description: 'My mother needs medical assistance. She is having trouble breathing.', area: 'Hauz Khas Village', urgent: true }); st.ctx.rid = r.requestId; select(r.packetId); }, done: function () { return !!st.ctx.rid; } },
      { t: 'It spreads phone to phone, then stalls at a gap', a: 'Play', run: function () { play(function () { return false; }); }, done: stalled },
      { t: 'A neighbour shares Relay at the gap', a: 'Share Relay at the gap', run: function () { openInstall(gapNode()); }, done: bridged },
      { t: 'It crosses and reaches the volunteer', a: 'Play', run: function () { play(function () { return M.nodeHas(K().E, mainPid()); }); }, done: function () { return !!mainPid() && M.nodeHas(K().E, mainPid()); } },
      { t: 'The volunteer sends an offer of help', a: 'Send offer', run: function () { var x = M.createReply(K().E, st.ctx.rid, { kind: 'offer', note: 'I can walk your mother to the clinic gate. I am a nurse (self-reported).', area: 'Clinic gate' }); if (x.ok) { st.ctx.replyPid = x.packetId; select(x.packetId); } }, done: function () { return !!st.ctx.replyPid; } },
      { t: 'The offer travels back to the requester', a: 'Play', run: function () { play(function () { return M.nodeHas(K().A, st.ctx.replyPid); }); }, done: function () { return !!st.ctx.replyPid && M.nodeHas(K().A, st.ctx.replyPid); } },
      { t: 'The requester acknowledges the offer', a: 'Acknowledge and send', run: function () { var x = M.createAck(K().A, st.ctx.replyPid); if (x.ok) { st.ctx.ackPid = x.packetId; select(x.packetId); play(function () { return M.nodeHas(K().E, x.packetId); }); } }, done: function () { return !!st.ctx.ackPid && M.nodeHas(K().E, st.ctx.ackPid); } }] },
    missing: { label: '2 · Missing person', dest: true, steps: [
      { t: 'A survivor shares a missing-person request', a: 'Post request', run: function () { var r = M.createRequest(K().A, { kind: 'missing', category: 'Missing', title: 'Looking for Meera, 8, red school bag', description: 'Last seen near the bus stop in a blue uniform.', area: 'Lodhi Road bus stop', urgent: false, targets: ['LC'], lastKnown: 'Lodhi Colony' }); st.ctx.rid = r.requestId; select(r.packetId); }, done: function () { return !!st.ctx.rid; } },
      { t: 'It spreads through participating phones and stalls', a: 'Play', run: function () { play(function () { return false; }); }, done: stalled },
      { t: 'A neighbour shares Relay at the gap', a: 'Share Relay at the gap', run: function () { openInstall(gapNode()); }, done: bridged },
      { t: 'It reaches a phone near the clinic', a: 'Play', run: function () { play(function () { return M.nodeHas(K().E, mainPid()); }); }, done: function () { return !!mainPid() && M.nodeHas(K().E, mainPid()); } },
      { t: 'Someone submits a possible sighting', a: 'Send sighting', run: function () { var x = M.createReply(K().E, st.ctx.rid, { kind: 'sighting', note: 'Saw a girl with a red bag near the clinic gate around 10am.', area: 'Clinic gate, 10am' }); if (x.ok) { st.ctx.replyPid = x.packetId; select(x.packetId); } }, done: function () { return !!st.ctx.replyPid; } },
      { t: 'The sighting returns. It stays unverified.', a: 'Play', run: function () { play(function () { return M.nodeHas(K().A, st.ctx.replyPid); }); }, done: function () { return !!st.ctx.replyPid && M.nodeHas(K().A, st.ctx.replyPid); } }] },
    broadcast: { label: '3 · Community broadcast', dest: false, steps: [
      { t: 'Someone in Vasant Vihar posts a neighbourhood update', a: 'Post update', run: function () { var x = M.createBroadcast(K().L, { text: 'Water collection point open at City Hall, north entrance.', category: 'Resources', area: 'Vasant Vihar' }); st.ctx.bpid = x.packetId; select(x.packetId); }, done: function () { return !!st.ctx.bpid; } },
      { t: 'It spreads, but only as far as Relay links reach', a: 'Play', run: function () { play(function () { return false; }); }, done: stalled },
      { t: 'A neighbour shares Relay at the gap', a: 'Share Relay at the gap', run: function () { openInstall(gapNode()); }, done: bridged },
      { t: 'It crosses to the Hauz Khas side', a: 'Play', run: function () { play(function () { return M.nodeHas(K().A, st.ctx.bpid); }); }, done: function () { return !!st.ctx.bpid && M.nodeHas(K().A, st.ctx.bpid); } },
      { t: 'Priority: an urgent request enters the same links', a: 'Post urgent request + update', run: function () { M.createBroadcast(K().L, { text: 'Second update: queue is moving slowly at the north entrance.', category: 'Community', area: 'Vasant Vihar' }); var r = M.createRequest(K().L, { kind: 'urgent', category: 'Medical', title: 'Medical help needed near the market', description: 'Someone has collapsed outside the market.', area: 'Vasant Vihar', urgent: true }); st.ctx.urgentPid = r.packetId; select(r.packetId); }, done: function () { return !!st.ctx.urgentPid; } }] }
  };
  function mainPid() { return st.ctx.rid ? S().requests[st.ctx.rid].packetId : (st.ctx.bpid || null); }
  function stalled() { return !!st.ctx.sawStall; }   // sticky: once the stall has been observed the story step stays done
  function noteStall() { var p = mainPid(); if (!p) return; var s = M.stats(p); if (s.held > 1 && !s.canMove) st.ctx.sawStall = true; }
  function bridged() { return S().nodes[K().D].hasApp; }
  function gapNode() { var p = mainPid(), s = p && M.stats(p); return s && s.blocked && s.candidates.length ? s.candidates[0] : K().D; }
  function curStep() { var sc = SCEN[st.scen]; for (var i = 0; i < sc.steps.length; i++) if (!sc.steps[i].done()) return i; return sc.steps.length; }
  function select(pid) { st.pid = pid; }

  /* ---------- graph ---------- */
  function build() {
    var s = S(), svg = $('net'); clear(svg); st.nodeEls = {}; st.edgeEls = [];
    st.zoneG = el('g', {}, svg); st.edgeG = el('g', {}, svg); st.nodeG = el('g', {}, svg); st.ringG = el('g', {}, svg); st.animG = el('g', {}, svg); st.labG = el('g', {}, svg);
    s.hoods.forEach(function (hd, i) {
      el('rect', { x: hd.x, y: hd.y, width: hd.w, height: hd.h, rx: 26, class: 'zone' + (i % 2 ? ' alt' : '') }, st.zoneG);
      var t = el('text', { x: hd.x + 16, y: hd.y + 26, class: 'zone-t' }, st.zoneG); t.textContent = hd.name.toUpperCase(); hd.t = t;
    });
    s.edges.forEach(function (e) { var a = s.nodes[e.from], b = s.nodes[e.to]; st.edgeEls.push({ e: e, l: el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'e' }, st.edgeG) }); });
    s.order.forEach(function (id) { var n = s.nodes[id]; st.nodeEls[id] = el('circle', { cx: n.x, cy: n.y, r: 6, class: 'n', 'data-id': id }, st.nodeG); });
    st.built = true; rescale();
  }
  function scale() { var b = $('net').getBoundingClientRect(); return Math.min(b.width / st.vb.w, b.height / st.vb.h) || 1; }
  function setVB() { var v = st.vb; $('net').setAttribute('viewBox', v.x + ' ' + v.y + ' ' + v.w + ' ' + v.h); }
  function fit() { st.vb = { x: 0, y: 0, w: W, h: H }; rescale(); }
  function rescale() {
    setVB(); if (!st.built) return; var u = 1 / scale(), s = S(); st.u = u;
    s.order.forEach(function (id) { var n = s.nodes[id]; st.nodeEls[id].setAttribute('r', (n.key ? 8 : 5.2) * u); st.nodeEls[id].setAttribute('stroke-width', 1.7 * u); });
    st.edgeEls.forEach(function (x) { x.l.setAttribute('stroke-width', 1.3 * u); });
    s.hoods.forEach(function (hd) { hd.t.setAttribute('style', 'font-size:' + (11 * u) + 'px'); });
    if (st.drawn) paint();
  }
  function zoomBy(f, cx, cy) {
    var v = st.vb, nw = Math.max(170, Math.min(W * 1.1, v.w / f)), nh = nw * v.h / v.w;
    cx = cx == null ? v.x + v.w / 2 : cx; cy = cy == null ? v.y + v.h / 2 : cy;
    v.x = cx - (cx - v.x) * nw / v.w; v.y = cy - (cy - v.y) * nh / v.h; v.w = nw; v.h = nh; rescale();
  }
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
      if (down) { var dx = e.clientX - down.x, dy = e.clientY - down.y; moved += Math.abs(dx) + Math.abs(dy); if (moved > 5) { var sc = scale(); st.vb.x -= dx / sc; st.vb.y -= dy / sc; setVB(); tip.hidden = true; } down = { x: e.clientX, y: e.clientY }; return; }
      var id = nearest(e.clientX, e.clientY, 14);
      if (!id) { tip.hidden = true; return; }
      var n = S().nodes[id], has = st.pid && M.nodeHas(id, st.pid), b = wrap.getBoundingClientRect();
      clear(tip); tip.appendChild(h('b', {}, n.label)); tip.appendChild(h('span', {}, n.area + ' · ' + (M.canRelay(id) ? 'Relay on' : 'No Relay') + (st.pid ? (has ? ' · has the message' : ' · not reached') : '')));
      tip.hidden = false; tip.style.left = Math.min(e.clientX - b.left + 14, b.width - 260) + 'px'; tip.style.top = (e.clientY - b.top + 14) + 'px';
    });
    function up(e) { var was = down; down = null; if (was && moved <= 5 && e.type === 'pointerup') { st.sel = nearest(e.clientX, e.clientY, 18); paint(); } }
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
    svg.addEventListener('pointerleave', function () { tip.hidden = true; });
    svg.addEventListener('wheel', function (e) { e.preventDefault(); var c = toWorld(e.clientX, e.clientY); zoomBy(e.deltaY < 0 ? 1.18 : 1 / 1.18, c.x, c.y); }, { passive: false });
    window.addEventListener('resize', rescale);
  }

  /* ---------- engine-derived numbers ---------- */
  function msgInfo(p) {
    var r = p.requestId && S().requests[p.requestId];
    if (p.type === 'request') return { name: (r.kind === 'missing' ? 'Missing-person request' : (r.urgent ? 'Urgent ' + r.category.toLowerCase() + ' request' : r.category + ' request')), prio: (p.urgent ? 'Urgent: forwarded first' : 'Normal: forwarded after urgent traffic') + (p.route.policy === 'directed' ? ' · steered toward its target area' : ''), cls: p.urgent ? 'urgent' : 'info' };
    if (p.type === 'reply') return { name: p.payload.kind === 'sighting' ? 'Possible sighting (unverified)' : 'Offer of help (unverified)', prio: p.urgent ? 'Follows its urgent request' : 'Follows its request', cls: 'warn' };
    if (p.type === 'ack') return { name: 'Acknowledgment', prio: 'Follows its request', cls: 'info' };
    if (p.type === 'resolve') return { name: 'Resolution notice', prio: 'Follows its request', cls: 'info' };
    return { name: 'Community update', prio: 'Lowest priority: yields to urgent requests', cls: 'neutral' };
  }
  function destOf(p) {
    if (!p) return null;
    if (p.type === 'request') return SCEN[st.scen].dest ? K().E : null;
    if (p.type === 'reply') return S().requests[p.requestId].authorNodeId;
    if (p.type === 'ack') return p.payload.toNodeId;
    return null;
  }
  function holderComps(pid) {
    var s = S(), on = {}; s.order.forEach(function (id) { on[id] = M.canRelay(id); });
    var comp = M.components(on), hc = {}; M.holders(pid).forEach(function (id) { if (on[id]) hc[comp[id]] = 1; });
    return { comp: comp, hc: hc, on: on };
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
  function label(p) { var i = msgInfo(p); return i.name; }

  /* ---------- painting ---------- */
  function paint() {
    if (!st.built) return; st.drawn = true;
    var s = S(), pid = st.pid, p = pid && s.packets[pid], stt = p ? M.stats(pid) : null, u = st.u || 1;
    var has = {}, fresh = {}, hop = {}, cand = {};
    if (p) { stt.holders.forEach(function (i) { has[i] = 1; }); s.lastHops.forEach(function (m) { if (m.packetId === pid) { fresh[m.to] = 1; hop[m.from + '|' + m.to] = hop[m.to + '|' + m.from] = 1; } }); if (stt.blocked) stt.candidates.forEach(function (i) { cand[i] = 1; }); }
    noteStall();
    var dest = destOf(p), origin = p ? p.originNodeId : null;
    s.order.forEach(function (id) { st.nodeEls[id].setAttribute('class', 'n ' + (M.canRelay(id) ? 'on' : 'off') + (has[id] ? ' has' : '') + (st.sel === id ? ' sel' : '')); });
    st.edgeEls.forEach(function (x) { var e = x.e, live = M.canRelay(e.from) && M.canRelay(e.to);
      x.l.setAttribute('class', 'e' + (live ? ' live' : '') + (live && has[e.from] && has[e.to] ? ' hold' : '') + (hop[e.from + '|' + e.to] ? ' hop' : ''));
      x.l.setAttribute('stroke-dasharray', live ? '' : (3 * u) + ' ' + (3 * u)); });
    clear(st.ringG); clear(st.labG);
    function ring(id, cls, r) { var n = s.nodes[id]; el('circle', { cx: n.x, cy: n.y, r: r * u, class: 'ring ' + cls, 'stroke-width': 2.4 * u }, st.ringG); }
    function lab(id, text, cls) { var n = s.nodes[id], right = n.x > 760, t = el('text', { x: n.x + (right ? -1 : 1) * 14 * u, y: n.y + 4 * u, 'text-anchor': right ? 'end' : 'start', class: 'lab ' + (cls || ''), style: 'font-size:' + (12 * u) + 'px;stroke-width:' + (3 * u) + 'px' }, st.labG); t.textContent = text; }
    if (origin) { ring(origin, 'origin', 11); lab(origin, 'Origin · ' + s.nodes[origin].label); }
    if (dest && dest !== origin) { ring(dest, 'dest', 11); lab(dest, 'Destination · ' + s.nodes[dest].label, 'dest'); }
    Object.keys(cand).forEach(function (id) { ring(id, 'pulse', 12); lab(id, s.nodes[id].label + ' · no Relay'); });
    if (st.sel && st.sel !== origin && st.sel !== dest && !cand[st.sel]) { ring(st.sel, 'origin', 9); lab(st.sel, s.nodes[st.sel].label); }
    panels(p, stt, has, dest);
    controls(stt);
  }
  function controls(stt) {
    var can = st.pid && stt && stt.canMove;
    $('btn-play').disabled = st.playing || !st.pid || !can; $('btn-pause').disabled = !st.playing; $('btn-step').disabled = !st.pid;
  }
  function narrative(p, stt) {
    if (st.notice) return { head: 'Heads up', body: st.notice, tone: 'warn' };
    if (!p) return { head: 'Pick a scenario step', body: 'Use the story below, or the playback controls. Nothing moves until you press Play or Step.', tone: 'neutral' };
    var s = S(), hoodsWith = Object.keys(stt.hoods).filter(function (k) { return stt.hoods[k].held > 0; }).length;
    if (stt.expired) return { head: 'Message expired', body: 'It outlived its lifetime (' + (p.expiresTick - p.createdTick) + ' simulated minutes), so phones stopped passing it on.', tone: 'warn' };
    if (stt.canMove) return { head: 'Spreading phone to phone', body: 'Reached ' + stt.held + ' of ' + stt.participating + ' Relay phones in ' + hoodsWith + ' neighbourhood' + (hoodsWith === 1 ? '' : 's') + '. Each step moves it one hop.', tone: 'info' };
    if (stt.complete) return { head: 'Reached every phone it can', body: stt.held + ' of ' + stt.participating + ' Relay phones hold it. Phones without Relay cannot carry it.', tone: 'good' };
    var c = stt.candidates[0];
    if (c) return { head: 'Stalled: no route across the gap', body: 'Reached ' + stt.held + ' of ' + stt.participating + ' Relay phones. The ' + s.nodes[c].label.toLowerCase() + ' has no Relay, so the rest cannot be reached. If its owner accepts, ' + stt.unlock[c] + ' more phones become reachable.', tone: 'warn' };
    if (stt.policy === 'directed' || stt.policy === 'opportunistic') return { head: 'Targeted delivery has run its course', body: 'Reached ' + stt.held + ' of ' + stt.participating + ' Relay phones. This message is steered toward its target area with bounded detours, so it does not go to every phone.', tone: 'good' };
    return { head: 'Stopped: nothing left to reach', body: 'Reached ' + stt.held + ' of ' + stt.participating + ' Relay phones. No holder has a Relay neighbour that lacks it.', tone: 'warn' };
  }
  function panels(p, stt, has, dest) {
    var s = S(), side = $('side'), cov = M.coverage(), part = M.participating().length, sc = SCEN[st.scen], cur = curStep(); clear(side);
    /* story */
    var story = h('div', { class: 'card', id: 'story' }, h('div', { class: 'eyebrow' }, 'Scenario'), h('h2', {}, sc.label),
      h('ol', { class: 'story' }, sc.steps.map(function (x, i) { var d = x.done(); return h('li', { class: (d ? 'done' : '') + (i === cur ? ' now' : ''), 'data-step': i }, h('span', { class: 't' }, d ? '✓' : String(i + 1)), x.t); })));
    if (cur < sc.steps.length) story.appendChild(h('button', { class: 'btn primary block', id: 'btn-do', style: 'margin-top:10px', on: { click: function () { st.notice = ''; sc.steps[cur].run(); paint(); } } }, sc.steps[cur].a));
    else story.appendChild(h('div', { class: 'muted small', style: 'margin-top:8px' }, 'Scenario complete. Choose another scenario, or press Reset to run it again.'));
    side.appendChild(story);
    /* narrative */
    var nr = narrative(p, stt);
    side.appendChild(h('div', { class: 'card' }, h('div', { class: 'eyebrow' }, 'What is happening'), h('div', { class: 'headline', id: 'sim-head' }, nr.head), h('p', { class: 'muted', id: 'sim-body', style: 'margin:0' }, nr.body)));
    /* numbers */
    var m = h('div', { class: 'card', id: 'numbers' }, h('h2', {}, 'Live numbers'));
    m.appendChild(h('div', { class: 'metrics' },
      h('div', { class: 'metric' }, h('strong', { id: 'm-part' }, part + ' of 80'), h('span', {}, 'phones running Relay')),
      h('div', { class: 'metric' }, h('strong', { id: 'm-held' }, stt ? String(stt.held) : '–'), h('span', {}, 'reached by this message')),
      h('div', { class: 'metric' }, h('strong', { id: 'm-groups' }, cov.groups + ' · ' + cov.largest), h('span', {}, 'Relay groups · largest')),
      h('div', { class: 'metric' }, h('strong', { id: 'm-step' }, String(s.tick)), h('span', {}, 'simulated minutes'))));
    if (p) {
      var info = msgInfo(p), hcs = holderComps(p.id), cut = M.participating().filter(function (id) { return !hcs.hc[hcs.comp[id]]; }).length, pct = stt.participating ? Math.round(100 * stt.held / stt.participating) : 0;
      m.appendChild(h('div', { class: 'row', style: 'margin-top:10px' }, h('strong', {}, info.name), pill(info.cls === 'urgent' ? 'Urgent' : info.cls === 'neutral' ? 'Low priority' : 'Normal', info.cls)));
      m.appendChild(h('div', { class: 'muted small', id: 'm-prio' }, info.prio + ' · expires in ' + Math.max(0, p.expiresTick - s.tick) + ' min'));
      m.appendChild(h('div', { class: 'bar2', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Share of Relay phones reached' }, h('i', { style: 'width:' + pct + '%' })));
      m.appendChild(h('div', { class: 'row small', id: 'm-progress' }, h('span', {}, 'Delivery progress'), h('strong', {}, pct + '% of Relay phones')));
      m.appendChild(h('div', { class: 'row small', style: 'margin-top:4px', id: 'm-cut' }, h('span', {}, 'Relay phones cut off from it'), h('strong', {}, String(cut))));
      if (dest) {
        var dn = s.nodes[dest], got = M.nodeHas(dest, p.id), reach = M.canReach(p.id, dest), dl = got ? ['Reached', 'good'] : !M.canRelay(dest) ? ['No Relay on that phone', 'warn'] : stt.expired ? ['Expired before arriving', 'warn'] : reach ? ['Pending: a Relay route exists', 'info'] : ['Unreachable now: no Relay route', 'warn'];
        m.appendChild(h('div', { class: 'row', style: 'margin-top:8px', id: 'm-dest' }, h('span', { class: 'small' }, dn.label), pill(dl[0], dl[1])));
      }
      if (st.ctx.urgentPid && st.scen === 'broadcast') {
        var up = S().packets[st.ctx.urgentPid], bps = Object.keys(S().packets).filter(function (k) { return S().packets[k].type === 'broadcast' && S().packets[k].createdTick === up.createdTick; })[0];
        if (bps) m.appendChild(h('div', { class: 'note', style: 'margin-top:10px', id: 'm-priority' }, 'Priority check: the urgent request is on ' + M.holders(up.id).length + ' phones; the update posted at the same moment is on ' + M.holders(bps).length + '. Each link passes one message per step, urgent first.'));
      }
    }
    side.appendChild(m);
    /* message picker + selected device */
    var ids = Object.keys(s.packets), sel = h('select', { id: 'msgpick', 'aria-label': 'Message to follow', style: 'width:100%;min-height:40px;border:1px solid #cfd9e6;border-radius:10px;padding:0 8px' }, ids.length ? ids.map(function (id) { var o = h('option', { value: id }, label(s.packets[id]) + (s.packets[id].requestId ? ' · ' + s.requests[s.packets[id].requestId].title.slice(0, 26) : ' · ' + s.packets[id].payload.text.slice(0, 26))); if (id === st.pid) o.selected = true; return o; }) : h('option', { value: '' }, 'No messages yet'));
    sel.disabled = !ids.length; sel.addEventListener('change', function (e) { st.pid = e.target.value || null; paint(); });
    side.appendChild(h('div', { class: 'card' }, h('h2', {}, 'Message to follow'), sel));
    var dev = h('div', { class: 'card', id: 'devcard' }, h('h2', {}, 'Selected device'));
    if (!st.sel) dev.appendChild(h('p', { class: 'muted small', style: 'margin:0' }, 'Click any phone on the map to inspect it. Phones without Relay can accept an install from a neighbour.'));
    else {
      var n = s.nodes[st.sel], on = M.canRelay(st.sel), relayN = s.adj[st.sel].filter(M.canRelay).length;
      dev.appendChild(h('div', { class: 'row' }, h('strong', {}, n.label), pill(on ? 'Relay on' : 'No Relay', on ? 'good' : 'neutral')));
      dev.appendChild(h('div', { class: 'muted small' }, n.area + ' · ' + relayN + ' of ' + s.adj[st.sel].length + ' nearby phones run Relay' + (p ? (has[st.sel] ? ' · has the message' : ' · message not reached') : '')));
      if (on) { var q = queue(st.sel); dev.appendChild(h('div', { class: 'small', style: 'margin-top:8px;font-weight:700' }, 'Waiting to forward (urgent first)'));
        dev.appendChild(q.length ? h('ul', { class: 'queue', id: 'queue' }, q.slice(0, 5).map(function (x) { return h('li', {}, h('span', {}, label(x.p)), h('span', { class: 'muted' }, x.p.prio === 0 ? 'urgent' : x.p.prio === 2 ? 'update' : 'normal')); })) : h('div', { class: 'muted small' }, 'Nothing waiting.')); }
      else if (M.sharers(st.sel).length) dev.appendChild(h('button', { class: 'btn soft block', id: 'btn-install', style: 'margin-top:10px', on: { click: function () { openInstall(st.sel); } } }, icon('userplus'), 'Install Relay on this phone'));
      else dev.appendChild(h('div', { class: 'muted small', style: 'margin-top:8px' }, 'No neighbouring phone with Relay can share it.'));
    }
    side.appendChild(dev);
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
  function doStep() { M.step(); startAnim(); paint(); }
  function play(until) {
    st.notice = '';
    if (!st.pid) { st.notice = 'Nothing to play yet. Post a message with the scenario button first.'; paint(); return; }
    if (!M.stats(st.pid).canMove) { st.notice = 'This message cannot move right now: no Relay phone holding it has a Relay neighbour that lacks it.'; paint(); return; }
    st.until = until || null; st.playing = true; schedule(); paint();
  }
  function schedule() { clearTimeout(st.timer); st.timer = setTimeout(tick, 1100 / st.speed); }
  function tick() {
    if (!st.playing) return; doStep();
    var stop = (st.until && st.until()) || !st.pid || !M.stats(st.pid).canMove;
    if (stop) pause(); else schedule();
  }
  function pause() { clearTimeout(st.timer); st.timer = null; st.playing = false; st.until = null; paint(); }
  function resetWorld(keepScen) {
    pause(); M.reset(); st.ctx = {}; st.pid = null; st.sel = null; st.notice = ''; st.anims = []; clear(st.animG || document.createElement('g')); build(); fit(); paint();
  }

  /* ---------- consent-based install dialog ---------- */
  function openInstall(id) {
    pause(); var s = S(), n = s.nodes[id], p = st.pid;
    var sh = M.sharers(id).sort(function (a, b) { return (p && M.nodeHas(b, p)) - (p && M.nodeHas(a, p)); })[0];
    if (!sh) { st.notice = 'No neighbouring phone with Relay is close enough to share it.'; paint(); return; }
    var stage = 0;
    function show() {
      var body = $('mbody'); clear(body); $('mtitle').textContent = stage === 0 ? 'A neighbour nearby offers Relay' : 'Simulated file shared';
      if (stage === 0) body.appendChild(h('div', {}, h('p', {}, s.nodes[sh].label + ' is next to the ' + n.label.toLowerCase() + ' (' + n.area + ') and can pass the Relay install file over a short-range link. Nothing is installed unless its owner accepts.'),
        h('div', { class: 'note' }, 'Simulated: no file is transferred and nothing is installed.'),
        h('div', { class: 'stack', style: 'margin-top:12px' }, h('button', { class: 'btn primary block', id: 'inst-send', on: { click: function () { stage = 1; show(); } } }, 'Share install file'), h('button', { class: 'btn block', on: { click: closeModal } }, 'Cancel'))));
      else body.appendChild(h('div', {}, h('p', {}, 'Install Relay on the ' + n.label.toLowerCase() + '? It will then pass on messages from nearby phones.'),
        h('div', { class: 'stack' }, h('button', { class: 'btn primary block', id: 'inst-accept', on: { click: function () { var r = M.join(id, sh); closeModal(); st.notice = r.ok ? '' : r.error; paint(); } } }, 'Accept installation'), h('button', { class: 'btn block', on: { click: closeModal } }, 'Cancel'))));
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
    sel.addEventListener('change', function () { st.scen = sel.value; resetWorld(); });
    $('speed').addEventListener('change', function (e) { st.speed = +e.target.value; if (st.playing) schedule(); });
    $('btn-play').addEventListener('click', function () { play(null); }); $('btn-pause').addEventListener('click', pause);
    $('btn-step').addEventListener('click', function () { pause(); st.notice = ''; if (!st.pid) { st.notice = 'Nothing to step yet. Post a message with the scenario button first.'; paint(); return; } doStep(); });
    $('btn-reset').addEventListener('click', function () { resetWorld(); });
    $('z-in').addEventListener('click', function () { zoomBy(1.4); }); $('z-out').addEventListener('click', function () { zoomBy(1 / 1.4); }); $('z-fit').addEventListener('click', fit);
    $('mback').addEventListener('click', closeModal); document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
    var lg = $('legend');
    [['#37a08f', 'Relay on'], ['#e9edf2;border-color:#97a8ba', 'No Relay'], ['#146ce4', 'Has the message'], ['#fff;border-color:#14263a', 'Origin'], ['#fff;border-color:#7a3fd0', 'Destination'], ['#fff;border-color:#e3a22f', 'Gap: could connect']].forEach(function (x) { lg.appendChild(h('span', {}, h('i', { style: 'background:' + x[0] }), x[1])); });
    build(); attach(); fit(); paint();
  }
  window.RelaySim = { state: st };
  boot();
})();
