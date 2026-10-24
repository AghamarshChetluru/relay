/* Relay simulator v4 - Story mode ("follow the message").
   Same engine, same scenario machine as Explore (sim.js). Every visual is derived from Mesh state:
   - the current moment comes from engine/scenario state, not from a slide counter;
   - highlighted phones are phones that really store the tracked packet; dots move only along real hand-offs (lastHops);
   - a phone preview only shows what that phone could know (Mesh.requestView / caseState / repliesAt), never global counts.
   Positions are the engine's schematic coordinates. Nothing here changes routing. */
(function () {
  'use strict';
  var RS = window.RelaySim, API = RS.api, st = RS.state, M = window.Mesh, X = window.SimExplain, NS = 'http://www.w3.org/2000/svg';
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
  var ICON = { play: 'M7 5l12 7-12 7z', pause: 'M8 5v14M16 5v14', step: 'M5 5l10 7-10 7zM19 5v14', reset: 'M4 4v6h6M5 14a8 8 0 108-8', signal: 'M12 12h.01M8.5 8.5a5 5 0 000 7M15.5 8.5a5 5 0 010 7M5.5 5.5a9 9 0 000 13M18.5 5.5a9 9 0 010 13' };
  function icon(n) {
    var s = el('svg', { viewBox: '0 0 24 24', class: 'icon' + (n === 'play' || n === 'step' ? ' solid' : ''), 'aria-hidden': 'true' });
    if (n === 'step') { el('path', { d: 'M6 5l9 7-9 7z', fill: 'currentColor' }, s); el('rect', { x: 17, y: 5, width: 2.4, height: 14, rx: 1, fill: 'currentColor' }, s); return s; }
    el('path', { d: ICON[n], fill: n === 'play' || n === 'step' ? 'currentColor' : 'none', stroke: n === 'play' || n === 'step' ? 'none' : 'currentColor', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, s); return s;
  }
  function sc0() { return st.scen; }
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : b); }
  function lc(s) { return s.charAt(0).toLowerCase() + s.slice(1); }

  var V = { built: false, nodeEls: {}, edgeEls: [], edgeMap: {}, zoneEls: {}, cam: null, tween: null, u: 1, dots: [], raf: 0, why: {}, open: {}, consent: false,
    wide: false, sig: '', tip: null, m: null, anchored: [], scal: [] };
  var NEXT = { emergency: 'missing', missing: 'broadcast', broadcast: 'emergency' };
  var NEXT_LABEL = { missing: 'Try the missing-person scenario', broadcast: 'Try the community update', emergency: 'Try the emergency scenario' };
  var STEPS = { emergency: ['Need', 'Spread', 'Gap', 'Connection', 'Response'], missing: ['Need', 'Spread', 'Gap', 'Connection', 'Response'], broadcast: ['News', 'Spread', 'Gap', 'Connection', 'Priority'] };

  /* ================= which moment are we in? derived from the engine ================= */
  function origin() { return st.scen === 'broadcast' ? API.poster() : K().A; }
  function area(id) { return S().nodes[id].area; }
  function trustedHood(id) { var x = M.hoodState(id); return x.reliable ? x.id : null; }
  function clusterOf(id) { var z = S().hoods.filter(function (h) { return h.id === S().nodes[id].zone; })[0]; return z ? z.name : ''; }
  function pathMoment(pid) {
    var ctx = st.ctx, sr = X.stopReason(pid);
    if (API.bridged()) {
      var base = ctx.install ? ctx.install.before.holders : (ctx.stallHeld || 0);
      if (M.stats(pid).held > base) return (sr.code !== 'moving' && !API.responder()) ? { id: 'stopped', why: sr } : { id: 'crossing' };
      return { id: 'connect' };
    }
    if (ctx.sawStall && sr.code !== 'moving') return sr.code === 'gap' ? { id: 'gap' } : { id: 'stopped', why: sr };
    return { id: 'spread' };
  }
  /* A message that outlived its lifetime before it got where the story needs it is its own moment, never a "gap". */
  function delivered(pid, m) {
    var c = st.ctx, p = S().packets[pid]; if (!p) return false;
    if (p.type === 'reply') return M.nodeHas(K().A, pid);
    if (p.type === 'ack') return !!API.responder() && M.nodeHas(API.responder(), pid);
    if (st.scen === 'broadcast') return pid === c.bpid ? M.nodeHas(K().A, pid) : false;
    return !!API.responder() && M.nodeHas(API.responder(), pid);
  }
  function moment() {
    var m = baseMoment(), tp = tracked(m);
    if (tp && ['spread', 'gap', 'connect', 'crossing', 'return', 'ack', 'ready', 'stopped'].indexOf(m.id) >= 0 && M.isExpired(S().packets[tp]) && !delivered(tp, m)) return { id: 'expired', pid: tp };
    return m;
  }
  function baseMoment() {
    var ctx = st.ctx, sc = st.scen, A = K().A, E = API.responder(), rp = API.mainPid();
    if (sc === 'broadcast') {
      if (!ctx.bpid) return { id: 'need' };
      if (ctx.urgentPid) return API.contested().length ? { id: 'contest' } : { id: 'ready' };
      if (M.nodeHas(A, ctx.bpid)) return { id: 'intro' };
      return pathMoment(ctx.bpid);
    }
    if (!ctx.rid) return { id: 'need' };
    if (ctx.ackPid) return E && M.nodeHas(E, ctx.ackPid) ? { id: 'done' } : { id: 'ack' };
    if (ctx.replyPid) return M.nodeHas(A, ctx.replyPid) ? (sc === 'missing' ? { id: 'done' } : { id: 'arrived' }) : { id: 'return' };
    if (E && M.nodeHas(E, rp)) return { id: 'respond' };
    return pathMoment(rp);
  }
  function tracked(m) {
    var c = st.ctx;
    if (m.id === 'need') return null;
    if (m.id === 'expired') return m.pid;
    if (st.scen === 'broadcast') return (m.id === 'ready' || m.id === 'contest') ? c.urgentPid : c.bpid;
    if (m.id === 'ack' || m.id === 'done') return c.ackPid || c.replyPid;
    if (m.id === 'return' || m.id === 'arrived') return c.replyPid;
    return API.mainPid();
  }
  function stepIndex(m) {
    var i = { need: 0, spread: 1, stopped: 1, expired: 1, gap: 2, connect: 3, crossing: 3 }[m.id]; return i == null ? 4 : i;
  }
  function playing() { return st.playing; }
  function isPlayMoment(m) { return ['spread', 'crossing', 'return', 'ack'].indexOf(m.id) >= 0; }

  /* ================= what the tracked packet looks like across the network ================= */
  function trackInfo(pid, m) {
    var s = S(), T = { pid: pid, kind: 'req', holds: {}, prior: {}, reach: {}, cut: {}, fresh: {}, hop: {}, path: {}, poss: {}, amber: {}, held: 0, relay: M.participating().length };
    if (!pid) return T;
    var p = s.packets[pid]; T.kind = p.type === 'reply' || p.type === 'ack' ? 'rep' : 'req';
    var g = X.groupsFor(pid); g.holders.forEach(function (i) { T.holds[i] = 1; }); T.held = g.holders.length;
    if (m.id === 'gap') g.cutOff.forEach(function (i) { T.cut[i] = 1; });
    if (m.id === 'connect' || m.id === 'crossing') g.reachable.forEach(function (i) { T.reach[i] = 1; });
    g.holders.forEach(function (i) { var v = s.inbox[i][pid].via; if (v) T.path[v + '|' + i] = T.path[i + '|' + v] = 1; });
    T.detours = s.lastHops.filter(function (x) { var a = s.inbox[x.from][pid], b = s.inbox[x.to][pid]; return x.packetId === pid && a && b && b.detours > a.detours; });   // genuine detour hand-offs of the last step, from the engine's own records
    s.lastHops.forEach(function (x) { if (x.packetId === pid) { T.fresh[x.to] = 1; T.hop[x.from + '|' + x.to] = T.hop[x.to + '|' + x.from] = 1; } });
    if (T.kind === 'rep' && API.mainPid()) M.holders(API.mainPid()).forEach(function (i) { if (!T.holds[i] && M.canRelay(i)) T.prior[i] = 1; });
    if (m.id === 'connect' || m.id === 'crossing') X.frontier(pid).next.forEach(function (e) { T.poss[e.from + '|' + e.to] = T.poss[e.to + '|' + e.from] = 1; });
    if (m.id === 'gap') { var b = X.bridge(pid); if (b) { T.bridge = b.id; s.adj[b.id].forEach(function (o) { if (M.canRelay(o)) T.amber[b.id + '|' + o] = T.amber[o + '|' + b.id] = 1; }); } }
    return T;
  }

  /* ================= stage ================= */
  function buildStage() {
    var s = S(), svg = $('s-net'); clear(svg); V.nodeEls = {}; V.edgeEls = []; V.edgeMap = {}; V.zoneEls = {};
    V.gZ = el('g', {}, svg); V.gE = el('g', {}, svg); V.gN = el('g', {}, svg); V.gR = el('g', {}, svg); V.gD = el('g', {}, svg); V.gL = el('g', {}, svg);
    s.hoods.forEach(function (hd) {
      var r = el('rect', { x: hd.x, y: hd.y, width: hd.w, height: hd.h, rx: 26, class: 'sz' }, V.gZ);
      var t = el('text', { x: hd.x + 16, y: hd.y + 24, class: 'szl' }, V.gZ); V.zoneEls[hd.id] = { r: r, t: t, hd: hd };
    });
    s.edges.forEach(function (e) { var a = s.nodes[e.from], b = s.nodes[e.to], l = el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'se' }, V.gE); var x = { e: e, l: l, w: 1.2, dash: null }; V.edgeEls.push(x); V.edgeMap[e.from + '|' + e.to] = V.edgeMap[e.to + '|' + e.from] = x; });
    s.order.forEach(function (id) { var n = s.nodes[id]; V.nodeEls[id] = { c: el('circle', { cx: n.x, cy: n.y, r: 5, class: 'sn', 'data-id': id }, V.gN), r: n.key ? 6.6 : 5, sw: 1.5, dash: null }; });
    V.built = true;
  }
  function stageBox() { var r = $('s-stage').getBoundingClientRect(); return { w: Math.max(1, r.width), h: Math.max(1, r.height) }; }
  function fitVB(ids, pad, minW, padPx) {
    var sb = stageBox(), asp = sb.h / sb.w, s = S(), x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    ids.forEach(function (id) { var n = s.nodes[id]; x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); });
    if (!ids.length || ids.length === s.order.length) { x0 = 20; y0 = 40; x1 = 980; y1 = 660; }
    var w = Math.max(minW || 300, (x1 - x0) + 2 * pad, ((y1 - y0) + 2 * pad) / asp), maxW = Math.max(1010, 740 / asp);
    if (padPx) w = Math.max(w, ((x1 - x0) + 2 * pad) / (1 - 2 * padPx / sb.w)); else if (w > maxW) w = maxW;   // padPx: keep this much empty screen beside the content for a phone preview
    var hh = w * asp, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, X0 = cx - w / 2, Y0 = cy - hh / 2;
    if (!padPx) { if (w < 1040) X0 = Math.max(-30, Math.min(1030 - w, X0)); if (hh < 740) Y0 = Math.max(-20, Math.min(720 - hh, Y0)); }   // do not show empty space beyond the drawn network
    return { x: X0, y: Y0, w: w, h: hh };
  }
  function relayNeighbours(id) { return S().adj[id].filter(M.canRelay); }
  function uniq(a) { var o = {}; return a.filter(function (x) { return o[x] ? false : (o[x] = 1); }); }
  function focusFor(m, T) {
    var s = S(), all = s.order, o = origin(), E = API.responder(), A = K().A, ids, pad = 80, minW = 600;
    function around(list) { var out = list.slice(); list.forEach(function (i) { out = out.concat(relayNeighbours(i)); }); return uniq(out); }
    if (V.wide) return fitVB(all, 28, 0);
    switch (m.id) {
      case 'need': return fitVB(around([o]), 80, 560, 285);
      case 'spread': ids = around(M.holders(T.pid).filter(M.canRelay));
        if (st.scen === 'missing') { var tgts = API.REQ.missing.request.targets; ids = uniq(ids.concat(s.order.filter(function (i) { return M.canRelay(i) && tgts.indexOf(trustedHood(i)) >= 0; }))); minW = 760; pad = 70; }   // keep the last-known area in view while the request moves toward it
        break;
      case 'gap': case 'return': case 'ack': case 'intro': return fitVB(all, 28, 0);
      case 'done': case 'arrived': return fitVB(all, 28, 0, 285);
      case 'connect': return fitVB(all, 28, 0);   // before/after needs both groups in view
      case 'crossing': { var b = API.gapNode(); ids = around([b]).concat(Object.keys(T.fresh)); minW = 760; pad = 90; break; }
      case 'respond': return fitVB(around([E]), 80, 600, 285);
      case 'ready': ids = around([o]); minW = 480; break;
      case 'contest': { var c = firstContest(); ids = c ? around([c.w.from, c.w.to]) : around([o]); minW = 460; break; }
      default: return fitVB(all, 28, 0);
    }
    return fitVB(ids, pad, minW);
  }
  function setCam(target, instant) {
    if (!V.cam || instant || reduce) { V.cam = target; V.tween = null; applyCam(); return; }
    var from = { x: V.cam.x, y: V.cam.y, w: V.cam.w, h: V.cam.h }, same = Math.abs(from.x - target.x) + Math.abs(from.y - target.y) + Math.abs(from.w - target.w) < 1;
    if (same) { V.cam = target; applyCam(); return; }
    var tw = V.tween = { from: from, to: target, t0: performance.now(), dur: 620 }; if (!V.raf) V.raf = requestAnimationFrame(frame);
    clearTimeout(V.camTimer); V.camTimer = setTimeout(function () { if (V.tween === tw) { V.cam = tw.to; V.tween = null; applyCam(); } }, tw.dur + 120);   // animation frames can be throttled (hidden tab); never leave the camera stranded part-way
  }
  function applyCam() {
    var c = V.cam, sb = stageBox(); $('s-net').setAttribute('viewBox', c.x + ' ' + c.y + ' ' + c.w + ' ' + c.h); V.u = c.w / sb.w; applyScale(); positionOverlays();
  }
  function ease(k) { return k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; }
  function frame() {
    var now = performance.now(), busy = false;
    if (V.tween) {
      var t = V.tween, k = Math.min(1, (now - t.t0) / t.dur), e = ease(k);
      V.cam = { x: t.from.x + (t.to.x - t.from.x) * e, y: t.from.y + (t.to.y - t.from.y) * e, w: t.from.w + (t.to.w - t.from.w) * e, h: t.from.h + (t.to.h - t.from.h) * e };
      if (k >= 1) { V.cam = t.to; V.tween = null; } else busy = true; applyCam();
    }
    clear(V.gD); var u = V.u;
    V.dots = V.dots.filter(function (d) { return now - d.t0 < d.dur; });
    V.dots.forEach(function (d) { var k = Math.max(0, Math.min(1, (now - d.t0) / d.dur)); el('circle', { cx: d.a.x + (d.b.x - d.a.x) * k, cy: d.a.y + (d.b.y - d.a.y) * k, r: 4.6 * u, class: 'sdot ' + d.cls }, V.gD); });
    if (V.dots.length) busy = true; V.raf = busy ? requestAnimationFrame(frame) : 0;
  }
  function applyScale() {
    var u = V.u;
    Object.keys(V.nodeEls).forEach(function (id) { var x = V.nodeEls[id]; x.c.setAttribute('r', x.r * u); x.c.setAttribute('stroke-width', x.sw * u); x.c.setAttribute('stroke-dasharray', x.dash ? (x.dash[0] * u) + ' ' + (x.dash[1] * u) : ''); });
    V.edgeEls.forEach(function (x) { x.l.setAttribute('stroke-width', x.w * u); x.l.setAttribute('stroke-dasharray', x.dash ? (x.dash[0] * u) + ' ' + (x.dash[1] * u) : ''); });
    V.scal.forEach(function (x) { if (x.r != null) x.n.setAttribute('r', x.r * u); if (x.sw != null) x.n.setAttribute('stroke-width', x.sw * u); if (x.f != null) x.n.setAttribute('style', 'font-size:' + (x.f * u) + 'px;stroke-width:' + (3 * u) + 'px'); if (x.dx != null) x.n.setAttribute('x', x.bx + x.dx * u); if (x.dy != null) x.n.setAttribute('y', x.by + x.dy * u); });
    Object.keys(V.zoneEls).forEach(function (k) { var z = V.zoneEls[k]; z.t.setAttribute('style', 'font-size:' + (11 * u) + 'px'); if (z.sub) z.sub.setAttribute('dy', 13 * u); });
  }
  function toScreen(x, y) { var c = V.cam, sb = stageBox(); return { x: (x - c.x) / c.w * sb.w, y: (y - c.y) / c.h * sb.h }; }

  /* ================= painting the network for the current moment ================= */
  function renderStage(m, T) {
    var s = S(), sc = st.scen, dimSet = null, o = origin(), isCtx = T.pid && T.kind === 'req';
    if (m.id === 'need') dimSet = uniq([o].concat(relayNeighbours(o)));
    else if (m.id === 'spread') dimSet = uniq(M.holders(T.pid).filter(M.canRelay).reduce(function (a, i) { return a.concat([i], relayNeighbours(i)); }, []));
    else if (m.id === 'return' || m.id === 'ack') dimSet = uniq(Object.keys(T.holds).reduce(function (a, i) { return a.concat([i], relayNeighbours(i)); }, []));
    else if (m.id === 'ready' || m.id === 'contest') { var c = firstContest(); dimSet = c ? uniq([c.w.from, c.w.to].concat(relayNeighbours(c.w.from))) : uniq([o].concat(relayNeighbours(o))); }
    var inDim = {}; if (dimSet) dimSet.forEach(function (i) { inDim[i] = 1; });
    s.order.forEach(function (id) {
      var x = V.nodeEls[id], on = M.canRelay(id), cls = 'sn';
      if (!on) cls += ' off'; else if (T.holds[id]) cls += ' held' + (T.kind === 'rep' ? ' rep' : ''); else if (T.prior[id]) cls += ' prior'; else if (T.reach[id]) cls += ' reach'; else if (T.cut[id]) cls += ' cut';
      if (dimSet && !inDim[id]) cls += ' dim'; if (T.fresh[id] && T.holds[id]) cls += ' fresh';
      x.c.setAttribute('class', cls); x.r = (s.nodes[id].key ? 6.8 : 5.2) * (T.fresh[id] && T.holds[id] ? 1.3 : 1); x.sw = T.reach[id] ? 2.2 : 1.5; x.dash = on ? null : [2.4, 2];
    });
    V.edgeEls.forEach(function (x) {
      var e = x.e, k = e.from + '|' + e.to, live = M.canRelay(e.from) && M.canRelay(e.to), cls = 'se' + (live ? ' live' : ''), w = 1.2, dash = live ? null : [3, 3];
      if (T.path[k]) { cls += ' path' + (T.kind === 'rep' ? ' rep' : ''); w = 2.2; }
      if (T.hop[k]) { cls += ' hop' + (T.kind === 'rep' ? ' rep' : ''); w = 3.4; }
      if (T.poss[k]) { cls += ' poss'; w = 2.4; dash = [5, 3.5]; }
      if (T.amber[k]) { cls += ' amber'; w = 2.4; dash = [4, 3]; }
      if (m.id === 'contest') { var fc = firstContest(); if (fc && ((e.from === fc.w.from && e.to === fc.w.to) || (e.from === fc.w.to && e.to === fc.w.from))) { cls += ' focus'; w = 4.6; dash = null; } }
      if (dimSet && !(inDim[e.from] && inDim[e.to])) cls += ' dim';
      x.l.setAttribute('class', cls); x.w = w; x.dash = dash;
    });
    /* zones: names, and in the missing-person story the declared target area with each area's distance to it */
    var targets = sc === 'missing' ? API.REQ.missing.request.targets : [];
    s.hoods.forEach(function (hd) {   // a drawn cluster is where phones meet, not what they declare: just name it
      var z = V.zoneEls[hd.id]; z.r.setAttribute('class', 'sz'); z.t.setAttribute('class', 'szl'); clear(z.t); var t1 = el('tspan', { x: hd.x + 16 }, z.t); t1.textContent = hd.name.toUpperCase(); z.sub = null;
    });
    /* rings, labels, the bridge affordance */
    clear(V.gR); clear(V.gL); V.scal = [];
    function ring(id, cls, r) { var n = s.nodes[id], c = el('circle', { cx: n.x, cy: n.y, class: 'sring ' + cls }, V.gR); V.scal.push({ n: c, r: r, sw: 2.2 }); return c; }
    function lab(id, text, cls, dxPx) { var n = s.nodes[id], right = n.x > 800, t = el('text', { x: n.x, y: n.y, 'text-anchor': right ? 'end' : 'start', class: 'slab ' + (cls || '') }, V.gL); t.textContent = text; V.scal.push({ n: t, f: 12.5, dx: (right ? -1 : 1) * (dxPx || 13), dy: 4, bx: n.x, by: n.y }); }
    if (targets.length) s.order.forEach(function (i) { if (M.canRelay(i) && targets.indexOf(trustedHood(i)) >= 0 && i !== o) ring(i, 'tgt', 8); });   // phones that actually declare the last-known area
    var tracking = T.pid != null, oLabel = { emergency: 'Needs help', missing: 'Looking for a child', broadcast: 'Posted the update' }[sc];
    if (m.id === 'need' || (tracking && m.id !== 'contest' && m.id !== 'ready')) { ring(o, 'origin', 10.5); lab(o, oLabel); }
    if (sc === 'missing' && T.kind === 'req' && ['spread', 'gap', 'connect', 'crossing'].indexOf(m.id) >= 0) {   // the last hand-offs, each labelled with the area the receiving phone DECLARES (that is what routing reads)
      var dets = {}, shown = 0; (T.detours || []).forEach(function (x) { dets[x.to] = 1; ring(x.to, 'det', 9); lab(x.to, 'Detour · declares ' + area(x.to), 'amber'); shown++; });
      Object.keys(T.fresh).filter(function (i) { return !dets[i] && i !== o && Math.hypot(s.nodes[i].x - s.nodes[o].x, s.nodes[i].y - s.nodes[o].y) > 150; })   // not on top of the requester's own label
        .slice(0, 3).forEach(function (i) { lab(i, 'Declares ' + area(i), 'mute'); });
    }
    if (m.id === 'ready') ring(o, 'origin', 10.5);
    var E = API.responder(), A = K().A;
    if (sc !== 'broadcast' && E && ['respond', 'return', 'arrived', 'ack', 'done'].indexOf(m.id) >= 0) { ring(E, 'resp', 10.5); lab(E, 'Responder', 'teal'); }
    if ((m.id === 'return' || m.id === 'arrived' || m.id === 'ack' || m.id === 'done') && sc !== 'broadcast') { ring(A, 'origin', 10.5); }
    if (m.id === 'gap' && T.bridge) bridgeAffordance(T.bridge);
    if ((m.id === 'connect' || m.id === 'crossing') && st.ctx.install) { ring(st.ctx.install.id, 'joined', 11); lab(st.ctx.install.id, 'Joined Relay', 'teal'); }
    if (m.id === 'gap') groupLabel(T.cut, 'Can’t receive it yet');
    if (m.id === 'connect') groupLabel(T.reach, 'Now reachable, not received');
    if (m.id === 'contest') { var cc = firstContest(); if (cc) { ring(cc.w.from, 'origin', 10.5); ring(cc.w.to, 'origin', 8); } }
    applyScale();
  }
  function groupLabel(set, text) {
    var ids = Object.keys(set); if (!ids.length) return; var s = S(), x = 0, y = 0; ids.forEach(function (i) { x += s.nodes[i].x; y += s.nodes[i].y; });
    var t = el('text', { x: x / ids.length, y: y / ids.length, 'text-anchor': 'middle', class: 'slab mute' }, V.gL); t.textContent = text; V.scal.push({ n: t, f: 13 });
  }
  function bridgeAffordance(id) {
    var n = S().nodes[id], g = el('g', { class: 'sbridge', tabindex: '0', role: 'button', 'aria-label': 'This phone has no Relay. Let it join Relay.' }, V.gR);
    var c = el('circle', { cx: n.x, cy: n.y, class: 'sring bridge' }, g); V.scal.push({ n: c, r: 12, sw: 2.4 }); c.setAttribute('stroke-dasharray', '4 3');
    var hit = el('circle', { cx: n.x, cy: n.y, fill: 'transparent' }, g); V.scal.push({ n: hit, r: 16 });
    var b = el('circle', { cx: n.x + 11, cy: n.y - 11, class: 'plus' }, g); V.scal.push({ n: b, r: 6.5, sw: 0 });
    var open = function () { V.consent = true; render(); };
    g.addEventListener('click', open); g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    var t = el('text', { x: n.x, y: n.y, class: 'slab amber' }, V.gL); t.textContent = 'No Relay'; V.scal.push({ n: t, f: 12.5, dx: 15, dy: 22, bx: n.x, by: n.y });
  }

  /* ================= text, metrics, rail ================= */
  function firstContest() {
    var c = st.ctx, list = API.contested().filter(function (x) { return x.w.winner === c.urgentPid; }); return list.length ? list[0] : (API.contested()[0] || null);
  }
  function copyFor(m, T) {
    var sc = st.scen, c = st.ctx, s = S(), A = K().A, E = API.responder(), held = T.held, relay = T.relay, g = T.pid ? X.groupsFor(T.pid) : null;
    var out = { head: '', sub: '', metrics: [], primary: null, info: false, done: false }, base = sc === 'broadcast' ? 'update' : 'request', flood = T.pid && s.packets[T.pid].route.policy === 'flood';
    function playBtn() { return { label: playing() ? 'Pause' : 'Resume', fn: togglePlay, kind: 'toggle' }; }
    var have = { v: held, l: 'of ' + relay + ' Relay phones have it' };   // "have it" includes the sender; "other phones" below does not
    switch (m.id) {
      case 'need':
        if (sc === 'emergency') { out.head = 'Mobile networks are down. Someone needs help.'; out.sub = 'A person in Hauz Khas needs medical assistance but can’t make a call.'; }
        else if (sc === 'missing') { out.head = 'A child is missing. Nobody can phone around.'; out.sub = 'A parent in Hauz Khas reports a child last seen near Lodhi Colony.'; }
        else { out.head = 'A neighbour has useful news.'; out.sub = 'A neighbour reports a water collection point in ' + area(API.poster()) + '. It’s unverified.'; }
        out.primary = { label: sc === 'broadcast' ? 'Send report' : 'Send request', fn: actSend }; out.info = true; break;
      case 'spread':
        out.head = sc === 'missing' ? 'Phones pass it on, favouring areas near ' + X.targetNames(s.packets[T.pid].route) + '.' : sc === 'broadcast' ? 'Reports travel the same way.' : 'One request. Passed from phone to phone.';
        out.sub = held <= 1 ? 'It’s only on the original phone so far.' : 'The ' + base + ' reached ' + plural(held - 1, 'other phone', 'other phones') + '.' + (sc === 'missing' ? (T.detours && T.detours.length ? ' A copy just took a short detour, which routing allows.' : ' Areas are declared by people, not GPS.') : '');
        out.metrics = [have]; out.primary = playBtn(); break;
      case 'gap': {
        var gb = X.bridge(T.pid);
        out.head = 'The ' + base + ' can’t go any further.'; out.sub = 'One phone without Relay separates these groups.';
        out.metrics = [{ v: held, l: 'have it' }, { v: gb ? gb.unlock : g.cutOff.length, l: 'cut off behind it' }]; out.primary = { label: 'Let this phone join Relay', fn: actAskJoin }; break; }
      case 'connect': {
        var ins = c.install;
        out.head = 'A new path is open.'; out.sub = flood ? 'A route exists. Delivery hasn’t happened yet.' : 'A route exists. Nothing is delivered yet, and routing rules decide where it goes.';
        out.metrics = [{ v: held, l: 'have it' }, { v: ins ? ins.newSet.length : 0, l: 'newly connected phones' }]; out.primary = { label: 'Watch it cross', fn: actCross }; break; }
      case 'crossing': {
        var ns = c.install ? c.install.newSet : [], got = ns.filter(function (i) { return M.nodeHas(i, T.pid); }).length;
        out.head = 'The ' + base + ' is crossing.'; out.sub = got ? got + ' of the ' + ns.length + ' newly connected phones have it.' : 'The bridge phone has it. None of the ' + ns.length + ' newly connected phones do yet.'; out.metrics = [{ v: held, l: 'have it' }]; out.primary = playBtn(); break; }
      case 'stopped': {
        var sr = m.why || X.stopReason(T.pid);
        out.head = 'The ' + base + ' has stopped spreading.';
        out.sub = sr.code === 'policy' ? 'Its routing rule isn’t sending it to ' + plural(sr.connected, 'connected phone', 'connected phones') + (sr.waiting ? ' now. A later detour is possible.' : ' now.') : sr.code === 'complete' ? 'It reached every phone it can.' : 'No Relay link leads to the phones still without it.';
        out.metrics = [have]; out.done = true; break; }
      case 'expired': {
        var ep = s.packets[m.pid], noun = ep.type === 'reply' ? 'reply' : ep.type === 'ack' ? 'acknowledgment' : base;
        out.head = 'The ' + noun + ' expired.'; out.sub = 'It lived ' + (ep.expiresTick - ep.createdTick) + ' simulated minutes. Phones stopped passing it on.'; out.metrics = [have]; out.done = true; break; }
      case 'respond':
        if (sc === 'missing') { out.head = 'The request reached a phone on the other side.'; out.sub = 'Its owner may or may not reply. This demo sends an example sighting report.'; out.primary = { label: 'Send example sighting', fn: actReply }; }
        else { out.head = 'The request reached someone who could respond.'; out.sub = 'This phone declares ' + area(E) + '. Whether to reply is its owner’s choice.'; out.primary = { label: 'Send example offer', fn: actReply }; }
        out.metrics = [{ v: held, l: 'phones have the request' }]; break;
      case 'return':
        out.head = sc === 'missing' ? 'The sighting report is on its way back.' : 'The reply is on its way back.'; out.sub = 'It may take a different route than the request did.';
        out.metrics = [{ v: held, l: 'phones have the reply' }]; out.primary = playBtn(); break;
      case 'arrived':
        out.head = 'The reply reached the requester.'; out.sub = 'It’s an example reply from a simulated person, and it’s unverified.'; out.primary = { label: 'Acknowledge the offer', fn: actAck }; break;
      case 'ack':
        out.head = 'The requester acknowledged the offer.'; out.sub = 'The acknowledgment is still travelling. It means the offer was seen, not accepted.'; out.metrics = [{ v: held, l: 'phones have it' }]; out.primary = playBtn(); break;
      case 'done':
        out.done = true;
        if (sc === 'missing') { out.head = 'The sighting report reached the requester.'; out.sub = 'It’s an unverified example. Someone still has to check it.'; }
        else { out.head = 'Request received. Offer returned. Acknowledgment delivered.'; out.sub = 'The reply is a simulated person’s example. Relay can’t guarantee delivery, replies or help.'; }
        break;
      case 'intro':
        out.head = 'The report reached the other side.'; out.sub = 'Now an urgent request joins it at the same phone.'; out.primary = { label: 'Add the urgent request', fn: actUrgent }; break;
      case 'ready':
        out.head = 'Two messages. One phone.'; out.sub = 'Both want the same links.'; out.primary = { label: 'Send both onward', fn: actOnward }; break;
      case 'contest': {
        var cc = firstContest(), list = API.contested(), wins = list.filter(function (x) { return s.packets[x.w.winner].prio <= s.packets[x.w.pid].prio; }).length;
        out.head = 'When a link is busy, urgent messages go first.';
        out.sub = cc ? 'On this link, the ' + lc(X.packetInfo(cc.w.winner).name) + ' went first. The ' + lc(X.packetInfo(cc.w.pid).name) + ' waited.' : '';
        out.metrics = [{ v: wins + ' of ' + list.length, l: 'busy links: higher priority first' }]; out.primary = { label: V.wide ? 'Zoom back to the link' : 'See the whole network', fn: function () { V.wide = !V.wide; render(); } }; out.done = true; break; }
    }
    return out;
  }
  function renderText(cp) {
    $('s-head').textContent = cp.head; $('s-sub').textContent = cp.sub;
    $('s-info').hidden = !cp.info; if (!cp.info) { $('s-infotip').hidden = true; $('s-info').setAttribute('aria-expanded', 'false'); }
    var mt = $('s-metrics'); clear(mt); cp.metrics.slice(0, 2).forEach(function (x) { mt.appendChild(h('div', { class: 's-metric' }, h('b', {}, String(x.v)), h('span', {}, x.l))); });
  }
  function renderRail(m, cp) {
    var idx = stepIndex(m), names = STEPS[st.scen], pr = $('s-progress'); clear(pr);
    names.forEach(function (n, i) { pr.appendChild(h('li', { class: i < idx || (cp.done && i === idx) ? 'done' : i === idx ? 'now' : '', 'aria-current': i === idx ? 'step' : false }, n)); });
    var act = $('s-act'); clear(act);
    if (cp.primary) act.appendChild(h('button', { class: 's-primary', id: 's-primary', on: { click: cp.primary.fn } }, cp.primary.label));
    if (cp.done) {
      act.appendChild(h('button', { class: 's-second', id: 's-replay', on: { click: function () { API.reset(); } } }, 'Replay'));
      act.appendChild(h('button', { class: 's-second', id: 's-next', on: { click: function () { API.setScenario(NEXT[st.scen]); } } }, NEXT_LABEL[NEXT[st.scen]]));
      act.appendChild(h('button', { class: 's-second', id: 's-explore2', on: { click: goExplore } }, 'Explore the network'));
    }
    var canStep = !!(API.mainPid() && ['spread', 'crossing', 'return', 'ack'].indexOf(m.id) >= 0 && M.stats(tracked(m) || API.mainPid()).canMove);   
    $('s-step').hidden = !canStep; $('s-step').disabled = !canStep; $('s-playpause').hidden = true;
  }

  /* ================= phone previews: what a phone itself can show ================= */
  function cardEl(badge, tone, title, body, meta, draft) {
    return h('div', { class: 'ph-card' + (draft ? ' draft' : '') }, h('span', { class: 'ph-badge ' + tone }, badge), h('h4', {}, title), body ? h('p', {}, body) : null, meta ? h('small', {}, meta) : null);
  }
  function requestCard(nodeId, rid, draft) {
    var r = S().requests[rid], pl = r && r.versions.length ? S().packets[r.versions[0]].payload : null, q = pl || API.REQ[st.scen].request;
    var missing = (r ? r.kind : q.kind) === 'missing', urgent = r ? r.urgent : q.urgent;
    return cardEl(missing ? 'Missing person' : urgent ? 'Urgent' : 'Request', missing ? 'info' : 'urgent', q.title, q.description, missing ? 'Last seen near ' + q.area + '. Reported by the requester, not confirmed.' : q.area, draft);
  }
  function previewSpecs(m, T) {
    var sc = st.scen, c = st.ctx, A = K().A, E = API.responder(), out = [], rid = c.rid;
    function view(n) { var v = rid && M.requestView(n, rid); return v ? v.label : ''; }
    if (sc === 'broadcast') {
      var L = API.poster(), bp = c.bpid, lt = 'Neighbour’s phone · declares ' + area(L);
      if (m.id === 'need') out.push({ node: L, mode: 'full', title: lt, cards: [cardEl('Community update', 'neutral', 'Water point open', API.updateFor(L, 'update').text, API.updateFor(L, 'update').area, true)], status: 'Draft', cls: 'mute' });
      else if (m.id === 'spread' && bp) out.push({ node: L, mode: 'chip', title: lt, label: M.sentObserved(L, bp) ? 'Shared with a nearby phone' : 'Saved on this phone' });
      else if (m.id === 'ready') {
        var q = [c.urgentPid, c.bpid2].filter(Boolean).sort(function (x, y) { return S().packets[x].prio - S().packets[y].prio; });
        out.push({ node: L, mode: 'full', title: lt + ' · waiting to send', cards: q.map(function (pid) { var i = X.packetInfo(pid); return h('div', { class: 'chipmsg ' + (pid === c.urgentPid ? 'first' : 'wait') }, i.name, h('em', {}, pid === c.urgentPid ? 'urgent' : 'update')); }), status: 'Both are saved on this phone', cls: 'mute' });
      }
      else if (m.id === 'intro' && bp) out.push({ node: A, mode: 'full', title: 'A phone in Hauz Khas', cards: M.receivedBroadcasts(A).slice(0, 1).map(function (p) { return cardEl('Community update', 'neutral', p.payload.category + ' update', p.payload.text, p.payload.area); }), status: 'Received on this phone', cls: 'ok' });
      return out;
    }
    if (m.id === 'need') out.push({ node: A, mode: 'full', title: 'Requester’s phone · declares ' + area(A), cards: [requestCard(A, null, true)], status: 'Draft', cls: 'mute' });
    else if (m.id === 'spread' && rid) out.push({ node: A, mode: 'chip', title: 'Requester’s phone', label: view(A), cards: [requestCard(A, rid)], status: view(A) });
    else if (m.id === 'respond' && rid) {
      var draft = API.replyFor(E);
      out.push({ node: E, mode: 'full', title: 'Responder’s phone · declares ' + area(E), cards: [requestCard(E, rid), cardEl('Example reply', 'warn', draft.kind === 'sighting' ? 'Possible sighting' : 'Offer of help', draft.note, 'The owner chooses whether to send it. Relay delivers; it does not decide.', true)], status: view(E), cls: 'mute' });
    } else if (m.id === 'return' && rid) out.push({ node: E, mode: 'chip', title: 'Responder’s phone · declares ' + area(E), label: view(E) });
    else if ((m.id === 'arrived' || m.id === 'ack' || m.id === 'done') && rid) {
      var rep = M.repliesAt(A, rid)[0], sight = rep && rep.payload.kind === 'sighting', lbl = view(A);
      if (m.id === 'arrived' || m.id === 'done') {
        out.push({ node: A, mode: 'full', title: 'Requester’s phone', cards: [rep ? cardEl('Unverified', 'warn', sight ? 'Possible sighting' : 'Offer of help', rep.payload.note, 'From a phone that declares ' + (rep.payload.fromHood || 'an unknown area') + (rep.payload.area ? ' · ' + rep.payload.area : '')) : null].filter(Boolean), status: lbl, cls: 'ok' });
        if (m.id === 'done' && sc !== 'missing') out.push({ node: E, mode: 'chip', title: 'Responder’s phone · declares ' + area(E), label: view(E) });
      } else out.push({ node: A, mode: 'chip', title: 'Requester’s phone', label: view(A) });
    }
    return out;
  }
  function phoneEl(spec, key) {
    var open = V.open[key] != null ? V.open[key] : spec.mode === 'full';
    if (!open) { var chip = h('div', { class: 'ph chip', role: 'button', tabindex: '0', 'aria-label': spec.title + ': ' + (spec.label || spec.status) }, h('i'), spec.label || spec.status);
      var exp = function () { V.open[key] = true; V.sig = ''; render(); }; chip.addEventListener('click', exp); chip.addEventListener('keydown', function (e) { if (e.key === 'Enter') exp(); }); return chip; }
    var body = h('div', { class: 'ph-body' }, spec.cards || []);
    var x = spec.mode === 'chip' ? h('button', { class: 'ph-x', 'aria-label': 'Collapse', on: { click: function () { V.open[key] = false; V.sig = ''; render(); } } }, '×') : null;
    return h('div', { class: 'ph', role: 'group', 'aria-label': spec.title }, h('div', { class: 'ph-bar' }, h('i'), spec.title, x), body, h('div', { class: 'ph-status ' + (spec.cls || '') }, spec.status || spec.label));
  }
  function renderOverlays(m, T) {
    var ov = $('s-overlay'), specs = previewSpecs(m, T), pops = [];
    if (V.consent && m.id === 'gap') pops.push('consent');
    if (m.id === 'contest') pops.push('contest');
    var sig = JSON.stringify([m.id, specs.map(function (x) { return [x.node, x.mode, x.label, x.status, V.open[x.node + x.mode + m.id]]; }), pops, st.scen, firstContest() && firstContest().tick]);
    if (sig !== V.sig) {
      V.sig = sig; clear(ov); V.anchored = [];
      specs.forEach(function (sp) { var e = phoneEl(sp, sp.node + sp.mode + m.id); e.setAttribute('data-node', sp.node); ov.appendChild(e); V.anchored.push({ el: e, node: sp.node, side: 'auto' }); });
      if (pops.indexOf('consent') >= 0) { var b = API.gapNode(), sh = API.sharerFor(b);
        var pop = h('div', { class: 'pop', id: 's-consent', role: 'dialog', 'aria-label': 'Let this phone join Relay' }, h('b', {}, 'Let this phone join Relay?'), h('p', {}, 'A nearby phone offers Relay to this one. If its owner accepts, it joins.'),
          h('div', { class: 'row' }, h('button', { class: 'go', id: 's-accept', on: { click: actJoin } }, 'Accept'), h('button', { id: 's-notnow', on: { click: function () { V.consent = false; render(); } } }, 'Not now')), h('small', {}, 'Simulated. Nothing is installed.'));
        pop.setAttribute('data-node', b); ov.appendChild(pop); V.anchored.push({ el: pop, node: b, side: 'auto' }); }
      if (pops.indexOf('contest') >= 0) { var cc = firstContest(), s = S();
        if (cc) { var bx = h('div', { class: 'contest', id: 's-contest' }, h('b', {}, 'Link busy · one message per step'),
          h('div', { class: 'chipmsg first' }, X.packetInfo(cc.w.winner).name, h('em', {}, 'went first')), h('div', { class: 'chipmsg wait' }, X.packetInfo(cc.w.pid).name, h('em', {}, 'waited')));
          ov.appendChild(bx); V.anchored.push({ el: bx, node: cc.w.to, side: 'auto', avoid: s.adj[cc.w.from].filter(M.canRelay), strong: [cc.w.from, cc.w.to] }); } }
    }
    positionOverlays();
  }
  function positionOverlays() {
    var sb = stageBox(), s = S();
    V.anchored.forEach(function (a) {
      var n = s.nodes[a.node], p = toScreen(n.x, n.y), w = a.el.offsetWidth || 250, hh = a.el.offsetHeight || 120, chip = a.el.className.indexOf('chip') >= 0;
      var keep = (a.avoid || s.adj[a.node].filter(M.canRelay)).map(function (i) { var q = toScreen(s.nodes[i].x, s.nodes[i].y); return { x: q.x, y: q.y }; });
      var cx = 0; keep.forEach(function (q) { cx += q.x - p.x; });
      var labelRight = n.x <= 800, lab = { x0: labelRight ? p.x - 16 : p.x - 160, x1: labelRight ? p.x + 160 : p.x + 16, y0: p.y - 16, y1: p.y + 16 };   // the phone and its text label
      var side = [{ x: p.x + 24, y: p.y - hh / 2 }, { x: p.x - w - 24, y: p.y - hh / 2 }], above = { x: p.x - w / 2, y: p.y - hh - 24 }, below = { x: p.x - w / 2, y: p.y + 24 };
      if (cx > 0) side.reverse();
      var cand = chip ? [above, below].concat(side) : side.concat([below, above]), best = null;
      cand.forEach(function (c) {
        var x = Math.max(10, Math.min(sb.w - w - 10, c.x)), y = Math.max(10, Math.min(sb.h - hh - 10, c.y)), hit = 0;
        keep.forEach(function (q) { if (q.x > x - 12 && q.x < x + w + 12 && q.y > y - 12 && q.y < y + hh + 12) hit++; });
        if (x < lab.x1 && x + w > lab.x0 && y < lab.y1 && y + hh > lab.y0) hit += 100;   // never sit on the phone it describes
        (a.strong || []).forEach(function (id) { var q = toScreen(s.nodes[id].x, s.nodes[id].y); if (q.x > x - 16 && q.x < x + w + 16 && q.y > y - 16 && q.y < y + hh + 16) hit += 100; });   // nor on the ends of the link it explains
        if (!best || hit < best.hit) best = { x: x, y: y, hit: hit };
      });
      a.el.style.left = best.x + 'px'; a.el.style.top = best.y + 'px';
    });
  }

  /* ================= actions (all of them call the real engine) ================= */
  function stepsOf() { return API.SCEN[st.scen].steps; }
  function playUntil() {
    var m0 = moment(), start = m0.id, active = tracked(m0) || API.mainPid();   // Story's active narrative packet; Explore's selected packet is irrelevant here
    API.play(function () {
      var n = moment().id; if (n === start) return false; if (start === 'connect' && n === 'crossing') { start = 'crossing'; return false; } return true;
    }, active);
  }
  function actSend() { stepsOf()[0].run(); render(); playUntil(); }
  function togglePlay() { if (st.playing) API.pause(); else playUntil(); }
  function actAskJoin() { V.consent = true; V.sig = ''; render(); var b = $('s-accept'); if (b) b.focus(); }
  function actJoin() { var r = API.join(API.gapNode()); V.consent = false; V.sig = ''; if (!r.ok) st.notice = r.error; render(); }
  function actCross() { playUntil(); }
  function actReply() { stepsOf()[4].run(); render(); playUntil(); }
  function actAck() { stepsOf()[6].run(); render(); }   // the scenario step creates the acknowledgment and starts it travelling
  function actUrgent() { stepsOf()[4].run(); V.sig = ''; render(); }
  function actOnward() { stepsOf()[5].run(); V.sig = ''; render(); }
  function goExplore() { var m = moment(), tp = tracked(m) || API.mainPid(); if (tp) API.select(tp); API.setMode('explore'); }
  /* ================= hand-off dots, tips, wiring ================= */
  function onStep(rep) {
    if (reduce || st.mode !== 'story') return; var m = moment(), tp = tracked(m), s = S(), ids = {};
    if (m.id === 'contest' || m.id === 'ready') { [st.ctx.urgentPid, st.ctx.bpid, st.ctx.bpid2].forEach(function (x) { if (x) ids[x] = 1; }); } else if (tp) ids[tp] = 1;
    var t0 = performance.now(), dur = Math.min(520, (st.interval || 640) * 0.8);
    V.dots = V.dots.filter(function (d) { return t0 - d.t0 < d.dur; });   // a dot from an earlier step never lingers into the next one
    rep.moves.forEach(function (mv) { if (!ids[mv.pid]) return; V.why[mv.from + '|' + mv.to + '|' + mv.pid] = mv.text;
      var typ = s.packets[mv.pid].type; V.dots.push({ a: s.nodes[mv.from], b: s.nodes[mv.to], t0: t0, dur: dur, cls: typ === 'reply' || typ === 'ack' ? 'rep' : (mv.det ? 'det' : mv.pid === st.ctx.urgentPid ? 'urg' : 'req') }); });
    if (V.dots.length && !V.raf) V.raf = requestAnimationFrame(frame);
  }
  function whyFor(a, b, T) {
    var s = S(), pid = T.pid, ka = a + '|' + b + '|' + pid, kb = b + '|' + a + '|' + pid;
    if (!M.canRelay(a) || !M.canRelay(b)) return 'One of these phones doesn’t run Relay, so nothing can cross this link.';
    if (pid) {
      var t = V.why[ka] || V.why[kb]; if (t) return t;
      var fr = X.frontier(pid), hit = fr.next.concat(fr.held).filter(function (e) { return (e.from === a && e.to === b) || (e.from === b && e.to === a); })[0];
      if (hit) return (fr.next.indexOf(hit) >= 0 ? 'Next: ' : 'Not selected now: ') + hit.text;
      if (s.inbox[a][pid] && s.inbox[b][pid]) return 'Both phones already have it.';
    }
    return 'Both phones run Relay.' + (X.linkText(a, b) ? ' ' + X.linkText(a, b) : '');
  }
  function showTip(x, y, title, text) {
    var ov = $('s-overlay'), t = V.tip; if (!t) { t = V.tip = h('div', { class: 'tipbox', role: 'status' }); }
    clear(t); t.appendChild(h('b', {}, title)); t.appendChild(document.createTextNode(text)); if (!t.parentNode) ov.appendChild(t); var sb = stageBox();
    t.style.left = Math.min(sb.w - 290, x + 14) + 'px'; t.style.top = Math.min(sb.h - 70, y + 14) + 'px';
  }
  function hideTip() { if (V.tip && V.tip.parentNode) V.tip.parentNode.removeChild(V.tip); }
  function attachStage() {
    var svg = $('s-net');
    svg.addEventListener('pointermove', function (e) {
      if (!V.m) return; var r = svg.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, s = S(), best = null, bd = 13, T = V.T;
      s.order.forEach(function (id) { var p = toScreen(s.nodes[id].x, s.nodes[id].y), d = Math.hypot(p.x - px, p.y - py); if (d < bd) { bd = d; best = { t: 'n', id: id }; } });
      if (!best) { var ed = 6; V.edgeEls.forEach(function (x) { var a = toScreen(s.nodes[x.e.from].x, s.nodes[x.e.from].y), b = toScreen(s.nodes[x.e.to].x, s.nodes[x.e.to].y), dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1, k = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / L2)), d = Math.hypot(a.x + k * dx - px, a.y + k * dy - py); if (d < ed) { ed = d; best = { t: 'e', a: x.e.from, b: x.e.to }; } }); }
      if (!best) { hideTip(); return; }
      if (best.t === 'n') { var n = s.nodes[best.id], has = T.pid && M.nodeHas(best.id, T.pid), inb = has && s.inbox[best.id][T.pid];
        showTip(px, py, X.nm(best.id), 'Declares ' + n.area + (clusterOf(best.id) && clusterOf(best.id) !== n.area ? ' (drawn with the ' + clusterOf(best.id) + ' cluster)' : '') + ' · ' + (M.canRelay(best.id) ? 'Relay on' : 'No Relay') + (T.pid && M.canRelay(best.id) ? (has ? (inb && inb.via ? ' · got it from ' + X.nm(inb.via) : ' · started here') : ' · doesn’t have it yet') : '')); }
      else showTip(px, py, X.nm(best.a) + ' ↔ ' + X.nm(best.b), whyFor(best.a, best.b, T));
    });
    svg.addEventListener('pointerleave', hideTip);
  }

  /* ================= main render ================= */
  function render() {
    if (st.mode !== 'story' || !V.built) return;
    var m = moment(); if (m.id !== 'contest') V.wide = false; if (m.id !== 'gap') V.consent = false;
    var T = trackInfo(tracked(m), m), cp = copyFor(m, T); V.m = m; V.T = T;
    document.body.setAttribute('data-moment', m.id);
    renderText(cp); renderRail(m, cp); renderStage(m, T);
    var instant = !V.cam || V.lastScen !== st.scen; V.lastScen = st.scen; setCam(focusFor(m, T), instant);
    renderOverlays(m, T);
    var sc = $('s-scenario'); if (sc.value !== st.scen) sc.value = st.scen;
    var key = $('s-key'); clear(key);
    var tg = sc0() === 'missing', tgEntry = tg ? [['tgt', 'Declares Lodhi Colony']] : [];
    $('s-note').textContent = tg ? 'Schematic: clusters are where phones meet. Routing follows the area each phone declares, not the drawing or GPS.' : 'Schematic: clusters are where phones meet. Each phone declares its own area.';
    if (m.id === 'need') { key.hidden = !tg; if (tg) tgEntry.forEach(function (x) { key.appendChild(h('span', {}, h('i', { class: x[0] }), x[1])); }); $('s-note').hidden = false; return; }   // nothing can be "received" yet
    key.hidden = false; $('s-note').hidden = false;
    [['', 'Not yet received'], ['held', 'Has it'], ['off', 'No Relay']].concat(T.kind === 'rep' && T.pid ? [['rep', 'Has the reply']] : [], tg && T.detours && T.detours.length ? [['det', 'Detour hand-off']] : [], m.id === 'connect' || m.id === 'crossing' ? [['reach', 'Connected, not received']] : [], m.id === 'gap' ? [['cut', 'Cut off']] : [], tgEntry)
      .forEach(function (x) { key.appendChild(h('span', {}, h('i', { class: x[0] }), x[1])); });
  }

  function init() {
    $('s-mark').appendChild(icon('signal'));
    var sel = $('s-scenario'); Object.keys(API.SCEN).forEach(function (k) { sel.appendChild(h('option', { value: k }, { emergency: 'Emergency assistance', missing: 'Missing person', broadcast: 'Community update' }[k])); });
    sel.addEventListener('change', function () { API.setScenario(sel.value); });
    $('s-to-explore').addEventListener('click', goExplore);
    $('s-info').addEventListener('click', function () { var t = $('s-infotip'), o = t.hidden; t.hidden = !o; $('s-info').setAttribute('aria-expanded', String(o)); });
    $('s-step').appendChild(icon('step')); $('s-restart').appendChild(icon('reset')); $('s-playpause').appendChild(icon('pause'));
    $('s-step').addEventListener('click', function () { API.pause(); API.doStep(); });
    $('s-restart').addEventListener('click', function () { API.reset(); });
    document.addEventListener('keydown', function (e) {
      if (st.mode !== 'story') return;
      if (e.key === 'Escape' && V.consent) { V.consent = false; V.sig = ''; render(); }
      if (e.key === ' ' && e.target === document.body && V.m && isPlayMoment(V.m)) { e.preventDefault(); togglePlay(); }
    });
    window.addEventListener('resize', function () { V.cam = null; render(); });
    RS.on('paint', render); RS.on('step', onStep);
    RS.on('pause', function () { V.dots = []; if (V.gD) clear(V.gD); });
    RS.on('reset', function () { V.why = {}; V.open = {}; V.consent = false; V.wide = false; V.sig = ''; V.cam = null; V.dots = []; });
    RS.on('mode', function () { V.cam = null; V.sig = ''; });
    buildStage(); attachStage();
    $('s-playpause').hidden = true; render();
  }
  window.RelayStory = { state: V, moment: moment, render: render, copyFor: function () { var m = moment(); return copyFor(m, trackInfo(tracked(m), m)); } };
  init();
})();
