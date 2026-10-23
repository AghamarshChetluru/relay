/* Relay v2.2 – deterministic store-and-forward engine for an 80-phone simulated city.
   Logical simulation only: no real radio. All phone-facing views read ONLY that phone's own inbox/outbox;
   global knowledge lives in Mesh.stats(), used by the Network Simulator alone.

   Routing policy by message type (see route objects on packets):
     emergency / general assistance  -> 'flood'        broad multi-direction propagation, hop budget, urgent first
     missing person                  -> 'directed'     prefers phones whose DECLARED neighbourhood is closer to the target(s) in a
                                                       small offline neighbourhood graph; same-area forwarding, bounded detours,
                                                       per-phone fan-out budget. No target / unknown => 'opportunistic' (small hop budget)
     community broadcast             -> 'flood'        lowest priority, short lifetime, hop budget
   Replies, acknowledgments, resolution notices and sealed address shares flood (the requester's area may be stale or unknown). */
(function (global) {
  'use strict';

  /* ---------- documented policy (one simulation step = one simulated minute) ---------- */
  var TTL = { request: 90, reply: 90, ack: 90, resolve: 90, address: 60, broadcast: 45 };   // request: legacy default when no validity is given
  var CAP = 1;                // max packets a phone can hand to ONE neighbour per step (scarcity => priority matters)
  var MAX_BROADCAST = 280;
  var VALIDITY = { urgentOptions: [30, 60, 120], urgentDefault: 60, general: 360, missing: 1440 };   // minutes; product defaults, not medical standards
  var REMIND = 30, STALE = 60;  // location reminder after 30 min; declared area is not trusted for directional routing after 60 min
  var EVICT_GRACE = 30;         // expired packets stay visible (as expired) for 30 more minutes, then non-author caches drop them
  var ROUTE = { floodHops: 60, broadcastHops: 30, directedHops: 40, directedFanout: 3, detourMax: 1, detourAway: 1, patience: 16, patientExtra: 2, oppHops: 10, oppFanout: 3 };

  /* Illustrative, coarse offline neighbourhood graph for south/central Delhi. NOT a survey: an edge means
     "neighbouring or directly linked by a main road". Only hop distance in this graph is used; no coordinates. */
  var NEIGH = [
    { id: 'HK', name: 'Hauz Khas' }, { id: 'GP', name: 'Green Park' }, { id: 'SE', name: 'Safdarjung Enclave' },
    { id: 'BS', name: 'Ber Sarai' }, { id: 'JS', name: 'Jia Sarai' }, { id: 'VV', name: 'Vasant Vihar' },
    { id: 'CP', name: 'Connaught Place' }, { id: 'LC', name: 'Lodhi Colony' }, { id: 'CK', name: 'Chanakyapuri' }, { id: 'LN', name: 'Lajpat Nagar' }
  ];
  var NEIGH_EDGES = [['HK', 'GP'], ['HK', 'SE'], ['HK', 'BS'], ['HK', 'JS'], ['BS', 'JS'], ['BS', 'VV'], ['GP', 'SE'], ['GP', 'LN'],
    ['SE', 'LC'], ['SE', 'VV'], ['LC', 'CP'], ['LC', 'CK'], ['LC', 'LN'], ['CK', 'CP'], ['CK', 'VV']];
  var NID = {}; NEIGH.forEach(function (n) { NID[n.id] = n; });
  var NDIST = (function () {
    var adj = {}, out = {}; NEIGH.forEach(function (n) { adj[n.id] = []; });
    NEIGH_EDGES.forEach(function (e) { adj[e[0]].push(e[1]); adj[e[1]].push(e[0]); });
    NEIGH.forEach(function (n) {
      var d = {}, q = [n.id]; d[n.id] = 0;
      while (q.length) { var c = q.shift(); adj[c].forEach(function (o) { if (d[o] == null) { d[o] = d[c] + 1; q.push(o); } }); }
      out[n.id] = d;
    });
    return out;
  })();
  function hdist(a, b) { return NDIST[a] && NDIST[a][b] != null ? NDIST[a][b] : null; }
  function distToSet(h, targets) {
    if (!h) return null; var best = null;
    targets.forEach(function (t) { var d = hdist(h, t); if (d !== null && (best === null || d < best)) best = d; });
    return best;
  }

  /* Physical clusters of the 80-phone simulation. Each cluster is drawn as one neighbourhood and its phones declare that neighbourhood. */
  var HOODS = [
    { id: 'OT', hood: 'HK', name: 'Hauz Khas',          n: 14, x: 20,  y: 40,  w: 300, h: 290 },
    { id: 'MK', hood: 'GP', name: 'Green Park',         n: 14, x: 350, y: 40,  w: 300, h: 290 },
    { id: 'NS', hood: 'LN', name: 'Lajpat Nagar',       n: 12, x: 680, y: 40,  w: 300, h: 290 },
    { id: 'LQ', hood: 'VV', name: 'Vasant Vihar',       n: 12, x: 20,  y: 370, w: 300, h: 290 },
    { id: 'CC', hood: 'SE', name: 'Safdarjung Enclave', n: 14, x: 350, y: 370, w: 300, h: 290 },
    { id: 'CD', hood: 'LC', name: 'Lodhi Colony',       n: 14, x: 680, y: 370, w: 300, h: 290 }
  ];
  var ZONEHOOD = {}; HOODS.forEach(function (z) { ZONEHOOD[z.id] = z.hood; });
  /* a few phones in each cluster declare a neighbouring area (people are not all where the cluster centre is) */
  var SECOND = { OT: ['BS', 'BS', 'JS', 'JS'], CD: ['CP', 'CP', 'CP', 'CK', 'CK'], LQ: ['CK', 'CK'] };

  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  /* ---------- topology (built once, deterministic) ---------- */
  function build(seed) {
    var r = rng(seed), nodes = [], byHood = {}, edgeSet = {}, edges = [];
    HOODS.forEach(function (h) {
      var pts = [], min = 54, tries = 0;
      while (pts.length < h.n) {
        var p = { x: Math.round(h.x + 36 + r() * (h.w - 72)), y: Math.round(h.y + 46 + r() * (h.h - 84)) };
        if (pts.every(function (q) { return dist(p, q) >= min; })) pts.push(p);
        if (++tries > 3000) { min -= 4; tries = 0; }
      }
      byHood[h.id] = pts.map(function (p) {
        var n = { id: 'p' + (nodes.length + 1), hood: h.id, x: p.x, y: p.y, hasApp: true, key: null };
        nodes.push(n); return n;
      });
    });
    function addEdge(a, b) {
      if (a === b) return; var k = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;
      if (edgeSet[k]) return; edgeSet[k] = 1; edges.push({ from: a.id, to: b.id, enabled: true });
    }
    function pairs(A, B, k) {
      var all = [];
      A.forEach(function (a) { B.forEach(function (b) { all.push([dist(a, b), a, b]); }); });
      all.sort(function (p, q) { return p[0] - q[0] || (p[1].id < q[1].id ? -1 : 1); });
      var ua = {}, ub = {}, out = [];
      all.forEach(function (p) { if (out.length < k && !ua[p[1].id] && !ub[p[2].id]) { ua[p[1].id] = ub[p[2].id] = 1; out.push(p); } });
      return out;
    }
    /* key phones */
    function pick(h, fn) { return byHood[h].slice().sort(fn)[0]; }
    var A = pick('OT', function (p, q) { return p.x - q.x || p.y - q.y; });
    var E = pick('CD', function (p, q) { return q.x - p.x || p.y - q.y; });
    var corner = { x: 650, y: 370 };
    var D = pick('CC', function (p, q) { return dist(p, corner) - dist(q, corner); });
    var M = pick('MK', function (p, q) { return dist(p, { x: 500, y: 185 }) - dist(q, { x: 500, y: 185 }); });
    var S = pick('NS', function (p, q) { return dist(p, { x: 830, y: 185 }) - dist(q, { x: 830, y: 185 }); });
    var ccRest = byHood.CC.filter(function (p) { return p !== D; });
    var L = ccRest.length && byHood.LQ.slice().sort(function (p, q) { return dist(p, { x: 170, y: 515 }) - dist(q, { x: 170, y: 515 }); })[0];
    var C = ccRest.slice().sort(function (p, q) { return dist(p, { x: 500, y: 515 }) - dist(q, { x: 500, y: 515 }); })[0];
    /* intra-neighbourhood links: MST (connected) + 2 nearest neighbours */
    HOODS.forEach(function (h) {
      var P = byHood[h.id], all = [];
      for (var i = 0; i < P.length; i++) for (var j = i + 1; j < P.length; j++) all.push([dist(P[i], P[j]), P[i], P[j]]);
      all.sort(function (p, q) { return p[0] - q[0]; });
      var parent = {}; P.forEach(function (p) { parent[p.id] = p.id; });
      function find(x) { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; }
      all.forEach(function (p) { var a = find(p[1].id), b = find(p[2].id); if (a !== b) { parent[a] = b; addEdge(p[1], p[2]); } });
      P.forEach(function (p) {
        P.filter(function (q) { return q !== p; }).sort(function (a, b) { return dist(p, a) - dist(p, b); })
          .slice(0, 2).forEach(function (q) { if (dist(p, q) < 95) addEdge(p, q); });
      });
    });
    /* inter-neighbourhood links. NOTE: Market ↔ Clinic side is joined ONLY through the Crossroads phone D. */
    pairs(byHood.OT, byHood.MK, 3).forEach(function (p) { addEdge(p[1], p[2]); });
    pairs(byHood.MK, byHood.NS, 2).forEach(function (p) { addEdge(p[1], p[2]); });
    pairs(byHood.LQ, ccRest, 2).forEach(function (p) { addEdge(p[1], p[2]); });
    pairs(ccRest, byHood.CD, 2).forEach(function (p) { addEdge(p[1], p[2]); });
    var m1 = pairs([D], byHood.MK, 1)[0][2], c1 = pairs([D], byHood.CD, 1)[0][2];
    addEdge(D, m1); addEdge(D, c1);
    var keys = { A: A, D: D, E: E, M: M, S: S, L: L, C: C };
    return { nodes: nodes, edges: edges, keys: keys, m1: m1, c1: c1, r: r };
  }

  function components(nodes, edges, on) {
    var adj = {}, comp = {}, n = 0;
    nodes.forEach(function (p) { adj[p.id] = []; });
    edges.forEach(function (e) { if (on[e.from] && on[e.to]) { adj[e.from].push(e.to); adj[e.to].push(e.from); } });
    nodes.forEach(function (p) {
      if (!on[p.id] || comp[p.id] != null) return;
      var q = [p.id]; comp[p.id] = n;
      while (q.length) { var c = q.shift(); adj[c].forEach(function (d) { if (comp[d] == null) { comp[d] = n; q.push(d); } }); }
      n++;
    });
    return comp;
  }

  var TOPO;
  function topology() {
    if (TOPO) return TOPO;
    for (var seed = 1; seed < 400; seed++) {
      var t = build(seed), r = t.r, k = t.keys, protect = {};
      Object.keys(k).forEach(function (x) { protect[k[x].id] = 1; }); protect[t.m1.id] = protect[t.c1.id] = 1;
      var cand = t.nodes.filter(function (p) { return !protect[p.id]; });
      for (var i = cand.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), tmp = cand[i]; cand[i] = cand[j]; cand[j] = tmp; }
      var off = {}; cand.slice(0, 16).forEach(function (p) { off[p.id] = 1; }); off[k.D.id] = 1;
      var on = {}, onD = {};
      t.nodes.forEach(function (p) { on[p.id] = !off[p.id]; onD[p.id] = on[p.id] || p.id === k.D.id; });
      var c0 = components(t.nodes, t.edges, on), c1 = components(t.nodes, t.edges, onD);
      var ok = c0[k.A.id] !== c0[k.E.id] && c1[k.A.id] === c1[k.E.id] &&
        c0[k.A.id] === c0[k.M.id] && c0[k.A.id] === c0[k.S.id] &&
        c0[k.E.id] === c0[k.L.id] && c0[k.E.id] === c0[k.C.id];
      if (ok) {
        var size = {}; t.nodes.forEach(function (p) { if (on[p.id]) size[c0[p.id]] = (size[c0[p.id]] || 0) + 1; });
        var strays = 0; Object.keys(size).forEach(function (c) { if (+c !== c0[k.A.id] && +c !== c0[k.E.id]) strays += size[c]; });
        if (size[c0[k.A.id]] >= 22 && size[c0[k.E.id]] >= 22 && strays <= 4) {
          t.nodes.forEach(function (p) { p.hasApp = !off[p.id]; });
          TOPO = t; TOPO.seed = seed; return TOPO;
        }
      }
    }
    throw new Error('topology generation failed');
  }

  var KEYNAMES = { A: 'My phone', D: 'Crossroads phone', E: 'Clinic volunteer', M: 'Green Park volunteer',
                   S: 'Lajpat Nagar volunteer', L: 'Vasant Vihar volunteer', C: 'Safdarjung Enclave volunteer' };

  var S;
  function fresh() {
    var t = topology(), st = { tick: 0, hoods: HOODS, nodes: {}, order: [], edges: [], adj: {}, keys: {},
      requests: {}, packets: {}, inbox: {}, outbox: {}, log: [], lastHops: [], local: {}, seq: { r: 0, p: 0, a: 0 },
      attachments: {}, privateAddr: {}, opts: { evictExpired: false, storageCap: Infinity, autoConfirm: true, userNode: null } };
    var HP = {}; HOODS.forEach(function (hd) { HP[hd.id] = { px: 16 + Math.round((hd.y - 40) / 330) * 324, py: 16 + Math.round((hd.x - 20) / 330) * 314, hd: hd }; });
    t.nodes.forEach(function (p) {
      var hp = HP[p.hood], hid = ZONEHOOD[p.hood];
      st.nodes[p.id] = { id: p.id, label: 'Nearby phone', zone: p.hood, hood: hid, hoodName: NID[hid].name, area: NID[hid].name, x: p.x, y: p.y,
        px: hp.px + (p.x - hp.hd.x), py: hp.py + (p.y - hp.hd.y), hasApp: p.hasApp, active: true, key: null, confirmedTick: 0 };
      st.order.push(p.id); st.adj[p.id] = []; st.inbox[p.id] = {}; st.outbox[p.id] = {}; st.local[p.id] = { hidden: {}, notRelevant: {} };
    });
    Object.keys(t.keys).forEach(function (k) { var n = st.nodes[t.keys[k].id]; n.label = KEYNAMES[k]; n.key = k; st.keys[k] = n.id; });
    Object.keys(SECOND).forEach(function (z) {
      var cand = st.order.filter(function (id) { var n = st.nodes[id]; return n.zone === z && !n.key && n.hasApp; }).sort().reverse();
      SECOND[z].forEach(function (h, i) { var n = st.nodes[cand[i]]; if (n) { n.hood = h; n.hoodName = NID[h].name; n.area = n.hoodName; } });
    });
    st.opts.userNode = st.keys.A;
    var dn = st.nodes[st.keys.D], cc = HP.CC; dn.px = cc.px + 26; dn.py = cc.py + cc.hd.h - 36;   // portrait layout helper (unused by the desktop simulator)
    st.hoodPos = {}; HOODS.forEach(function (hd) { st.hoodPos[hd.id] = { px: HP[hd.id].px, py: HP[hd.id].py }; });
    t.edges.forEach(function (e) {
      st.edges.push({ from: e.from, to: e.to, enabled: true }); st.adj[e.from].push(e.to); st.adj[e.to].push(e.from);
    });
    return st;
  }
  function reset() { S = fresh(); }
  function state() { return S; }
  function name(id) { return S.nodes[id].label; }
  function canRelay(id) { var n = S.nodes[id]; return n.hasApp && n.active; }
  function log(msg) { S.log.push({ tick: S.tick, msg: msg }); if (S.log.length > 60) S.log.shift(); }
  function nodeHas(id, pid) { return !!S.inbox[id][pid]; }
  function isExpired(p) { return S.tick >= p.expiresTick; }
  function holders(pid) { return S.order.filter(function (id) { return nodeHas(id, pid); }); }
  function ids(n, l) { return l + (n); }

  /* ---------- declared neighbourhood (no GPS) ---------- */
  function setHood(nodeId, hoodId, customName) {
    var n = S.nodes[nodeId]; n.hood = NID[hoodId] ? hoodId : null;
    n.hoodName = n.hood ? NID[hoodId].name : String(customName || '').trim(); n.area = n.hoodName || 'Unknown area'; n.confirmedTick = S.tick;
  }
  function confirmHood(nodeId) { S.nodes[nodeId].confirmedTick = S.tick; }
  function hoodState(nodeId) {
    var n = S.nodes[nodeId], age = S.tick - n.confirmedTick;
    return { id: n.hood, name: n.hoodName || 'Unknown area', age: age, due: age >= REMIND, stale: age > STALE, reliable: !!n.hood && age <= STALE };
  }
  function hoodOf(id) { var h = hoodState(id); return h.reliable ? h.id : null; }   // what routing is allowed to trust
  function distTo(id, targets) { return distToSet(hoodOf(id), targets); }
  function nearby(a, b) { var d = hdist(a, b); return d !== null && d <= 1; }

  /* ---------- packets ---------- */
  function routeFor(type, kind, targets) {
    if (type === 'broadcast') return { policy: 'flood', maxHops: ROUTE.broadcastHops };
    if (kind === 'missing') {
      var tg = (targets || []).filter(function (x) { return NID[x]; });
      if (tg.length) return { policy: 'directed', maxHops: ROUTE.directedHops, fanout: ROUTE.directedFanout, detourMax: ROUTE.detourMax, detourAway: ROUTE.detourAway, targets: tg };
      return { policy: 'opportunistic', maxHops: ROUTE.oppHops, fanout: ROUTE.oppFanout, targets: [] };
    }
    return { policy: 'flood', maxHops: ROUTE.floodHops };
  }
  function newPacket(type, nodeId, rid, payload, urgent, o) {
    o = o || {}; var pid = 'P' + (++S.seq.p), route0 = o.route || routeFor(type);
    S.packets[pid] = { id: pid, type: type, requestId: rid || null, caseId: rid || null, originNodeId: nodeId, payload: payload || null,
      urgent: !!urgent, prio: (type === 'broadcast' || type === 'attachment') ? 2 : (urgent ? 0 : 1), version: o.version || 0,
      route: o.route || routeFor(type), createdTick: S.tick, expiresTick: o.expiresTick != null ? o.expiresTick : S.tick + TTL[type] };
    S.inbox[nodeId][pid] = { tick: S.tick, via: null, hops: 0, detours: 0, tgt: route0 && route0.targets ? distToSet(hoodOf(nodeId), route0.targets) === 0 : false };
    return pid;
  }

  /* ---------- authoring ---------- */
  function validityFor(f) {
    if (f.validity != null) return +f.validity;
    return null;
  }
  function createRequest(nodeId, f) {
    if (!canRelay(nodeId)) return { ok: false, error: 'This phone does not have Relay.' };
    var rid = 'R' + (++S.seq.r), n = S.nodes[nodeId], v = validityFor(f);
    var expires = S.tick + (v != null ? v : TTL.request);
    var areaHood = NID[f.areaHood] ? f.areaHood : null, areaName = areaHood ? NID[areaHood].name : String(f.areaHoodName || '').trim();
    var targets = (f.targets || (f.kind === 'missing' && areaHood ? [areaHood] : [])).filter(function (x) { return NID[x]; });
    var payload = { kind: f.kind, category: f.category || '', title: f.title, description: f.description || '', area: f.area || '', hood: n.hood, hoodName: n.hoodName,
      urgent: !!f.urgent, validity: v != null ? v : TTL.request, targets: targets, lastKnown: f.lastKnown || '', lastContact: f.lastContact || '', note: f.note || '', areaHood: areaHood, areaHoodName: areaName || n.hoodName,
      hasPrivate: !!(f.privateAddress && (f.privateAddress.building || f.privateAddress.directions)), attachmentId: null, version: 0 };
    var pid = newPacket('request', nodeId, rid, payload, f.urgent, { route: routeFor('request', f.kind, targets), expiresTick: expires });
    S.requests[rid] = { id: rid, kind: f.kind, category: f.category || '', title: f.title, description: f.description || '', area: f.area || '',
      hood: areaHood || n.hood, authorNodeId: nodeId, urgent: !!f.urgent, createdTick: S.tick, expiresTick: expires, packetId: pid, versions: [pid], targets: targets };
    if (payload.hasPrivate) S.privateAddr[rid] = { building: f.privateAddress.building || '', directions: f.privateAddress.directions || '' };
    if (f.photo) attachPhoto(nodeId, rid, f.photo);
    log(name(nodeId) + ' saved a request on its own phone.');
    return { ok: true, requestId: rid, packetId: pid, caseId: rid };
  }
  function attachPhoto(nodeId, rid, photo) {
    var r = S.requests[rid], aid = 'A' + (++S.seq.a), lp = S.packets[r.versions[r.versions.length - 1]];
    S.attachments[aid] = { id: aid, caseId: rid, dataUrl: photo.dataUrl, bytes: photo.bytes, w: photo.w, h: photo.h, mime: photo.mime || 'image/jpeg' };
    lp.payload.attachmentId = aid;
    var pid = newPacket('attachment', nodeId, rid, { attachmentId: aid, bytes: photo.bytes }, false, { route: lp.route, expiresTick: lp.expiresTick });
    S.attachments[aid].packetId = pid; r.attachmentId = aid;
    return aid;
  }
  function createBroadcast(nodeId, f) {
    var text = String(f.text || '').trim();
    if (!canRelay(nodeId)) return { ok: false, error: 'This phone does not have Relay.' };
    if (!text) return { ok: false, error: 'Write a short update first.' };
    if (text.length > MAX_BROADCAST) return { ok: false, error: 'Updates are limited to ' + MAX_BROADCAST + ' characters.' };
    var n = S.nodes[nodeId];
    var pid = newPacket('broadcast', nodeId, null, { text: text, category: f.category || 'Community', area: f.area || '', hood: n.hood, hoodName: n.hoodName }, false);
    log(name(nodeId) + ' saved a community update on its own phone.');
    return { ok: true, packetId: pid };
  }

  /* ---------- case (request) helpers: one case, several packet versions ---------- */
  function latestHeld(nodeId, rid) {
    var r = S.requests[rid], out = null;
    r.versions.forEach(function (pid) { if (nodeHas(nodeId, pid)) out = S.packets[pid]; });
    return out;
  }
  function nodeHasCase(nodeId, rid) { return !!latestHeld(nodeId, rid); }
  function requestPacketOf(rid) { return S.packets[S.requests[rid].packetId]; }
  function isResolvedFor(nodeId, rid) {
    return Object.keys(S.packets).some(function (k) {
      var p = S.packets[k]; return p.type === 'resolve' && p.requestId === rid && nodeHas(nodeId, k);
    });
  }
  function caseState(nodeId, rid) {
    var lp = latestHeld(nodeId, rid); if (!lp) return null;
    return { packet: lp, payload: lp.payload, version: lp.version, renewed: lp.version > 0, expired: isExpired(lp), resolved: isResolvedFor(nodeId, rid),
      minutesLeft: Math.max(0, lp.expiresTick - S.tick) };
  }
  function renewRequest(nodeId, rid, patch) {
    var r = S.requests[rid]; patch = patch || {};
    if (!r || r.authorNodeId !== nodeId) return { ok: false, error: 'Only the requester can renew this request.' };
    if (isResolvedFor(nodeId, rid)) return { ok: false, error: 'This request is already resolved.' };
    var lp = latestHeld(nodeId, rid), pl = Object.assign({}, lp.payload);
    ['description', 'area', 'lastKnown', 'lastContact', 'note'].forEach(function (k) { if (patch[k] != null) pl[k] = patch[k]; });
    if (patch.targets) pl.targets = patch.targets.filter(function (x) { return NID[x]; });
    var v = patch.validity != null ? +patch.validity : pl.validity; pl.validity = v; pl.version = lp.version + 1;
    var expires = S.tick + v, route = routeFor('request', r.kind, pl.targets);
    var pid = newPacket('request', nodeId, rid, pl, r.urgent, { route: route, expiresTick: expires, version: lp.version + 1 });
    r.versions.push(pid); r.expiresTick = expires; r.targets = pl.targets;
    if (pl.attachmentId) { var att = S.attachments[pl.attachmentId]; if (att && S.packets[att.packetId]) { S.packets[att.packetId].expiresTick = expires; S.packets[att.packetId].route = route; } }
    log(name(nodeId) + ' renewed a request (same case, new packet).');
    return { ok: true, packetId: pid, caseId: rid, version: lp.version + 1 };
  }
  function createReply(nodeId, rid, f) {
    var r = S.requests[rid], lp = r && latestHeld(nodeId, rid);
    if (!r || !canRelay(nodeId) || nodeId === r.authorNodeId || !lp) return { ok: false, error: 'This phone has not received that request.' };
    if (isExpired(lp)) return { ok: false, error: 'This request has expired and is no longer relayed.' };
    if (isResolvedFor(nodeId, rid)) return { ok: false, error: 'The requester marked this resolved.' };
    var note = String(f.note || '').trim();
    if (!note) return { ok: false, error: 'Add a short note first.' };
    var pid = newPacket('reply', nodeId, rid, { kind: f.kind, note: note, area: String(f.area || '').trim(),
      fromNodeId: nodeId, toNodeId: r.authorNodeId, fromHood: S.nodes[nodeId].hoodName }, r.urgent);
    log(name(nodeId) + ' saved a response on its own phone.');
    return { ok: true, packetId: pid };
  }
  function createAck(nodeId, replyPid) {
    var rp = S.packets[replyPid];
    if (!rp || rp.type !== 'reply' || !nodeHas(nodeId, replyPid)) return { ok: false, error: 'That response has not reached this phone.' };
    var r = S.requests[rp.requestId];
    if (r.authorNodeId !== nodeId) return { ok: false, error: 'Only the requester can acknowledge.' };
    if (ackedBy(nodeId, replyPid)) return { ok: false, error: 'Already acknowledged.' };
    var pid = newPacket('ack', nodeId, r.id, { replyPacketId: replyPid, toNodeId: rp.originNodeId }, r.urgent);
    log(name(nodeId) + ' saved an acknowledgment on its own phone.');
    return { ok: true, packetId: pid };
  }
  function createResolve(nodeId, rid) {
    var r = S.requests[rid];
    if (!r || r.authorNodeId !== nodeId || isResolvedFor(nodeId, rid)) return { ok: false, error: 'Only the requester can resolve, once.' };
    var pid = newPacket('resolve', nodeId, rid, null, r.urgent);
    log(name(nodeId) + ' marked a request resolved on its own phone.');
    return { ok: true, packetId: pid };
  }
  function ackedBy(nodeId, replyPid) {
    return Object.keys(S.packets).some(function (k) {
      var p = S.packets[k]; return p.type === 'ack' && p.payload.replyPacketId === replyPid && nodeHas(nodeId, k);
    });
  }
  /* Exact address: kept on the requester's phone; shared only with a volunteer the requester chooses, as a sealed packet
     (modelled: only the addressed phone can read it; every phone may carry it). */
  function ownAddress(nodeId, rid) { var r = S.requests[rid]; return r && r.authorNodeId === nodeId ? S.privateAddr[rid] || null : null; }
  function shareAddress(nodeId, replyPid) {
    var rp = S.packets[replyPid];
    if (!rp || rp.type !== 'reply' || !nodeHas(nodeId, replyPid)) return { ok: false, error: 'That response has not reached this phone.' };
    var r = S.requests[rp.requestId], a = S.privateAddr[r.id];
    if (r.authorNodeId !== nodeId || !a) return { ok: false, error: 'No exact address to share.' };
    if (addressSharedFor(nodeId, replyPid)) return { ok: false, error: 'Already shared with this volunteer.' };
    var pid = newPacket('address', nodeId, r.id, { replyPacketId: replyPid, toNodeId: rp.originNodeId, building: a.building, directions: a.directions }, r.urgent);
    log(name(nodeId) + ' sealed the exact address for one volunteer.');
    return { ok: true, packetId: pid };
  }
  function addressSharedFor(nodeId, replyPid) {
    return Object.keys(S.packets).some(function (k) { var p = S.packets[k]; return p.type === 'address' && p.payload.replyPacketId === replyPid && p.originNodeId === nodeId; });
  }
  function sharedAddressAt(nodeId, rid) {   // only the addressed phone can read the contents
    var out = null;
    Object.keys(S.packets).forEach(function (k) { var p = S.packets[k]; if (p.type === 'address' && p.requestId === rid && p.payload.toNodeId === nodeId && nodeHas(nodeId, k)) out = { building: p.payload.building, directions: p.payload.directions }; });
    return out;
  }
  function photoOf(nodeId, rid) {
    var lp = latestHeld(nodeId, rid); if (!lp || !lp.payload.attachmentId) return null;
    var att = S.attachments[lp.payload.attachmentId];
    if (!att) return null;
    return nodeHas(nodeId, att.packetId) ? { ready: true, id: att.id, dataUrl: att.dataUrl, bytes: att.bytes, w: att.w, h: att.h } : { ready: false, id: att.id, bytes: att.bytes };
  }

  /* ---------- the step: snapshot knowledge, one hop per packet, CAP per link direction, priority + routing policy ---------- */
  function prio(a, b) {
    var pa = S.packets[a], pb = S.packets[b];
    return pa.prio - pb.prio || pa.createdTick - pb.createdTick || (+a.slice(1)) - (+b.slice(1));
  }
  function supersededAt(nodeId, p) {
    if (p.type !== 'request') return false;
    return S.requests[p.requestId].versions.some(function (pid) { return S.packets[pid].version > p.version && nodeHas(nodeId, pid); });
  }
  /* Who may src hand packet pid to right now? (shared by step() and stats().canMove so they never disagree) */
  function plan(src, pid, hasFn) {
    var p = S.packets[pid], e = S.inbox[src][pid];
    if (!e || isExpired(p) || supersededAt(src, p)) return [];
    var rt = p.route; if (e.hops >= rt.maxHops) return [];
    var cands = S.adj[src].filter(function (d) { return canRelay(d) && !hasFn(d, pid); });
    if (!cands.length) return [];
    var ob = S.outbox[src][pid], sentGood = ob ? ob.good || 0 : 0, left = rt.fanout ? rt.fanout - sentGood : Infinity;
    var out;
    if (rt.policy === 'directed') {
      var ds = distTo(src, rt.targets), good = [], detour = [];
      var patient = !e.tgt && S.tick - e.tick >= ROUTE.patience, dmax = e.tgt ? 0 : rt.detourMax + (patient ? ROUTE.patientExtra : 0), away = rt.detourAway + (patient ? 1 : 0);
      cands.forEach(function (d) {
        var dd = distTo(d, rt.targets), inArea = dd !== null && dd <= 1 && ds !== null && ds <= 1;
        if (dd !== null && ds !== null && (dd <= ds || inArea)) good.push({ d: d, s: dd, det: false });
        else if (e.detours < dmax && (dd === null || ds === null || dd - ds <= away)) detour.push({ d: d, s: dd === null ? 99 : dd, det: true });
      });
      good.sort(function (a, b) { return a.s - b.s || (a.d < b.d ? -1 : 1); });
      detour.sort(function (a, b) { return a.s - b.s || (a.d < b.d ? -1 : 1); });
      var usable = left > 0 ? good.slice(0, left) : [];       // fan-out budget limits better-direction copies only ...
      out = usable.length ? usable : detour;                   // ... so an exhausted budget can never trap a packet: detours take over
    } else {
      out = cands.map(function (d) { return { d: d, s: 0, det: false }; });
      if (rt.policy === 'opportunistic') out = out.slice(0, Math.max(0, left));
    }
    return out;
  }
  function step() {
    var snap = {}, next = S.tick + 1, moved = [], slots = {};
    S.order.forEach(function (id) { snap[id] = Object.keys(S.inbox[id]); });
    S.order.forEach(function (src) {
      if (!canRelay(src)) return;
      snap[src].slice().sort(prio).forEach(function (pid) {
        plan(src, pid, function (d, x) { return !!S.inbox[d][x]; }).forEach(function (c) {
          var k = src + '>' + c.d; if ((slots[k] || 0) >= CAP || S.inbox[c.d][pid]) return;
          var e = S.inbox[src][pid], p0 = S.packets[pid];
          S.inbox[c.d][pid] = { tick: next, via: src, hops: e.hops + 1, detours: e.detours + (c.det ? 1 : 0), tgt: !!e.tgt || (p0.route.targets && distTo(c.d, p0.route.targets) === 0) };
          slots[k] = (slots[k] || 0) + 1;
          var ob = S.outbox[src][pid]; if (!ob) ob = S.outbox[src][pid] = { tick: next, to: c.d, count: 0, good: 0 }; ob.count++; if (!c.det) ob.good = (ob.good || 0) + 1;
          moved.push({ from: src, to: c.d, packetId: pid });
        });
      });
    });
    S.tick = next; S.lastHops = moved; housekeeping();
    return moved.length;
  }
  function involved(id, p) {
    if (p.originNodeId === id) return true;
    var pl = p.payload || {};
    if ((p.type === 'ack' || p.type === 'address' || p.type === 'reply') && pl.toNodeId === id) return true;
    if (p.type === 'resolve') { var r = S.requests[p.requestId]; return r.authorNodeId === id || myReplies(id, p.requestId).length > 0; }
    return false;
  }
  function housekeeping() {
    var o = S.opts;
    if (o.autoConfirm) S.order.forEach(function (id) { if (id !== o.userNode) S.nodes[id].confirmedTick = S.tick; });   // other (simulated) users keep confirming their area
    if (!o.evictExpired && !isFinite(o.storageCap)) return;
    S.order.forEach(function (id) {
      var ib = S.inbox[id], keys = Object.keys(ib);
      if (o.evictExpired) keys.forEach(function (pid) {
        var p = S.packets[pid]; if (involved(id, p)) return;
        if (S.tick >= p.expiresTick + EVICT_GRACE || supersededAt(id, p)) delete ib[pid];
      });
      if (isFinite(o.storageCap)) {
        var items = Object.keys(ib).filter(function (pid) { return !involved(id, S.packets[pid]); });
        if (items.length > o.storageCap) {
          items.sort(function (a, b) {
            var pa = S.packets[a], pb = S.packets[b];
            return (isExpired(pb) - isExpired(pa)) || (pb.prio - pa.prio) || (pa.createdTick - pb.createdTick);   // drop expired first, then lowest priority, then oldest
          }).slice(0, items.length - o.storageCap).forEach(function (pid) { delete ib[pid]; });
        }
      }
    });
  }

  function sharers(id) { return S.adj[id].filter(function (o) { return canRelay(o); }); }
  function join(id, sharerId) {
    var n = S.nodes[id];
    if (n.hasApp) return { ok: false, error: 'Already has Relay.' };
    if (!canRelay(sharerId) || S.adj[id].indexOf(sharerId) < 0) return { ok: false, error: 'Needs an adjacent phone that has Relay.' };
    n.hasApp = true;
    log(n.label + ' accepted the Relay install from a neighbour.');
    return { ok: true };
  }

  /* ---------- phone-local views (no global knowledge) ---------- */
  function peers(nodeId) { return S.adj[nodeId].filter(canRelay).length; }
  function sentObserved(nodeId, pid) { return !!S.outbox[nodeId][pid]; }
  function receivedRequests(nodeId) {
    return Object.keys(S.requests).map(function (k) { return S.requests[k]; }).filter(function (r) { return nodeHasCase(nodeId, r.id); });
  }
  function receivedCases(nodeId) {
    return receivedRequests(nodeId).map(function (r) { var cs = caseState(nodeId, r.id); return { id: r.id, r: r, pkt: cs.packet, payload: cs.payload, state: cs }; });
  }
  function receivedBroadcasts(nodeId) {
    return Object.keys(S.packets).map(function (k) { return S.packets[k]; })
      .filter(function (p) { return p.type === 'broadcast' && nodeHas(nodeId, p.id); });
  }
  function repliesAt(nodeId, rid) {
    return Object.keys(S.packets).map(function (k) { return S.packets[k]; })
      .filter(function (p) { return p.type === 'reply' && p.requestId === rid && nodeHas(nodeId, p.id); });
  }
  function acksAt(nodeId, replyPid) {
    return Object.keys(S.packets).map(function (k) { return S.packets[k]; })
      .filter(function (p) { return p.type === 'ack' && p.payload.replyPacketId === replyPid && nodeHas(nodeId, p.id); });
  }
  function myReplies(nodeId, rid) { return repliesAt(nodeId, rid).filter(function (p) { return p.originNodeId === nodeId; }); }

  /* What THIS phone can truthfully say about a case. */
  function requestView(nodeId, rid) {
    var r = S.requests[rid], cs = caseState(nodeId, rid);
    if (!cs) return null;
    var expired = cs.expired, author = nodeId === r.authorNodeId, v = { author: author, expired: expired, renewed: cs.renewed, tone: '', label: '', note: '' };
    if (author) {
      var reps = repliesAt(nodeId, rid), acked = reps.some(function (p) { return ackedBy(nodeId, p.id); });
      if (cs.resolved) { v.label = 'Resolved on this phone'; v.tone = 'ok'; }
      else if (reps.length) { v.label = acked ? 'Offer acknowledged' : 'Offer received'; v.tone = 'ok'; v.note = 'An offer is not proof that help has arrived.'; }
      else if (expired) { v.label = 'Expired'; v.tone = 'warn'; v.note = 'No longer being passed along. Renew it if you still need help.'; }
      else if (sentObserved(nodeId, cs.packet.id)) { v.label = 'Shared with a nearby phone'; v.tone = 'info'; v.note = 'No response has reached this phone yet.'; }
      else if (peers(nodeId) > 0) { v.label = 'Saved on this phone'; v.note = 'Waiting to pass it to a nearby phone.'; }
      else { v.label = 'Saved on this phone'; v.tone = 'warn'; v.note = 'No nearby phone with Relay right now. It will move when one appears.'; }
    } else {
      var mine = myReplies(nodeId, rid);
      if (cs.resolved) { v.label = 'Resolved by requester'; v.tone = 'ok'; }
      else if (mine.some(function (p) { return acksAt(nodeId, p.id).length; })) { v.label = 'Requester acknowledged your offer'; v.tone = 'ok'; v.note = 'This does not confirm anyone has been helped.'; }
      else if (mine.length) {
        var sent = mine.some(function (p) { return sentObserved(nodeId, p.id); });
        v.label = sent ? 'Your offer was shared onward' : 'Your offer is saved on this phone'; v.tone = 'info';
        v.note = 'You will not be told when it arrives, only if the requester acknowledges.';
      }
      else if (expired) { v.label = 'Expired'; v.tone = 'warn'; }
      else { v.label = 'Received on this phone'; }
    }
    return v;
  }

  function setHidden(nodeId, rid) { S.local[nodeId].hidden[rid] = true; }
  function setNotRelevant(nodeId, pid) { S.local[nodeId].notRelevant[pid] = true; }

  /* ---------- simulator-only global statistics ---------- */
  function participating() { return S.order.filter(canRelay); }
  function stats(pid) {
    var p = S.packets[pid], on = {}, hs = holders(pid), expired = isExpired(p), hoods = {};
    S.order.forEach(function (id) { on[id] = canRelay(id); });
    var canMove = !expired && hs.some(function (src) { return on[src] && plan(src, pid, function (d, x) { return nodeHas(d, x); }).length > 0; });
    var comp = components(S.order.map(function (id) { return { id: id }; }), S.edges, on), hc = {};
    hs.forEach(function (id) { if (on[id]) hc[comp[id]] = 1; });
    var csize = {}; S.order.forEach(function (id) { if (on[id]) csize[comp[id]] = (csize[comp[id]] || 0) + 1; });
    var unlock = {};
    var candidates = S.order.filter(function (id) {
      if (on[id]) return false;
      var inH = false, others = {};
      S.adj[id].forEach(function (o) { if (!on[o]) return; if (hc[comp[o]]) inH = true; else others[comp[o]] = 1; });
      var n = 0; Object.keys(others).forEach(function (c) { n += csize[c]; });
      unlock[id] = n; return inH && n > 0;
    }).sort(function (a, b) { return unlock[b] - unlock[a] || (a < b ? -1 : 1); });
    S.hoods.forEach(function (h) { hoods[h.id] = { name: h.name, held: 0, total: 0 }; });
    S.order.forEach(function (id) { if (on[id]) { var h = hoods[S.nodes[id].zone]; h.total++; if (nodeHas(id, pid)) h.held++; } });
    var part = participating().length, held = hs.filter(function (id) { return on[id]; }).length;
    var unreached = part - held;
    return { holders: hs, held: held, participating: part, expired: expired, canMove: canMove, policy: p.route.policy,
      blocked: !canMove && !expired && unreached > 0, complete: !canMove && !expired && unreached === 0,
      candidates: candidates, unlock: unlock, hoods: hoods };
  }
  function canReach(pid, nodeId) {
    if (nodeHas(nodeId, pid)) return true;
    if (!canRelay(nodeId) || isExpired(S.packets[pid])) return false;
    var on = {}; S.order.forEach(function (id) { on[id] = canRelay(id); });
    var comp = components(S.order.map(function (id) { return { id: id }; }), S.edges, on);
    return holders(pid).some(function (id) { return on[id] && comp[id] === comp[nodeId]; });
  }
  function coverage() {
    var on = {}; S.order.forEach(function (id) { on[id] = canRelay(id); });
    var comp = components(S.order.map(function (id) { return { id: id }; }), S.edges, on), size = {}, n = 0, big = 0;
    Object.keys(comp).forEach(function (id) { size[comp[id]] = (size[comp[id]] || 0) + 1; });
    Object.keys(size).forEach(function (c) { n++; if (size[c] > big) big = size[c]; });
    return { groups: n, largest: big, participating: Object.keys(comp).length };
  }

  global.Mesh = { WORLD: { land: { w: 1000, h: 700 }, port: { w: 656, h: 950 } }, TTL: TTL, CAP: CAP, MAX_BROADCAST: MAX_BROADCAST, VALIDITY: VALIDITY, ROUTE: ROUTE,
    REMIND: REMIND, STALE: STALE, EVICT_GRACE: EVICT_GRACE, HOODS: HOODS, NEIGHBORHOODS: NEIGH, NEIGH_EDGES: NEIGH_EDGES, hoodDistance: hdist,
    reset: reset, state: state, name: name, canRelay: canRelay, nodeHas: nodeHas, holders: holders, isExpired: isExpired, topology: topology,
    setHood: setHood, confirmHood: confirmHood, hoodState: hoodState, nearby: nearby,
    createRequest: createRequest, createBroadcast: createBroadcast, createReply: createReply, createAck: createAck, createResolve: createResolve,
    renewRequest: renewRequest, attachPhoto: attachPhoto, shareAddress: shareAddress, addressSharedFor: addressSharedFor, sharedAddressAt: sharedAddressAt,
    ownAddress: ownAddress, photoOf: photoOf, isResolvedFor: isResolvedFor, ackedBy: ackedBy, step: step, join: join, sharers: sharers,
    peers: peers, sentObserved: sentObserved, receivedRequests: receivedRequests, receivedCases: receivedCases, receivedBroadcasts: receivedBroadcasts,
    caseState: caseState, latestHeld: latestHeld, repliesAt: repliesAt, acksAt: acksAt, myReplies: myReplies, requestView: requestView,
    setHidden: setHidden, setNotRelevant: setNotRelevant, stats: stats, canReach: canReach, coverage: coverage, participating: participating,
    components: function (on) { return components(S.order.map(function (id) { return { id: id }; }), S.edges, on); } };
  reset();
})(window);
