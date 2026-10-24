/* Relay simulator - explanations. Pure logic (no DOM). Every verdict comes from the engine:
   - "will it be handed on next step?" is Mesh.plan(), the exact function Mesh.step() calls;
   - why a hand-off happened is described from the engine's own numbers (target distance, detour count, fan-out, hop budget, priority);
   - nothing here moves a message, invents a transfer or changes routing.
   tests/sim_explain_test.js checks all of this against the engine on every step of the three scenarios. */
(function (global) {
  'use strict';
  var M = global.Mesh;
  function S() { return M.state(); }

  /* ---------- names ---------- */
  /* The engine seeds a few phones with scripted names ("Clinic volunteer"...). Only the requester's phone and the bridge phone keep a descriptive name; everyone else is just a phone.
     ?responder=clinic (the regression flag the older Explore suites use) restores the scripted names. */
  function isFixed() { return typeof location !== 'undefined' && /[?&]responder=clinic/.test(location.search || ''); }
  function nm(id) { var n = S().nodes[id]; return n.key && (n.key === 'A' || n.key === 'D' || isFixed()) ? n.label : 'Phone ' + id; }
  function area(id) { return S().nodes[id].area || 'unknown area'; }
  function who(id) { var n = S().nodes[id]; return n.key && nm(id) === n.label ? nm(id) : nm(id) + ' (declares ' + area(id) + ')'; }
  function trusted(id) { var h = M.hoodState(id); return h.reliable ? h.id : null; }     // what routing is allowed to trust: a recently confirmed declared area
  function hoodName(hid) { var o = M.NEIGHBORHOODS.filter(function (x) { return x.id === hid; })[0]; return o ? o.name : hid; }
  function targetNames(rt) { return (rt.targets || []).map(hoodName).join(' / '); }
  function distSet(hid, targets) {
    if (!hid) return null; var best = null;
    targets.forEach(function (t) { var d = M.hoodDistance(hid, t); if (d !== null && (best === null || d < best)) best = d; });
    return best;
  }
  function steps(n) { return n + (n === 1 ? ' step' : ' steps'); }
  function superseded(src, p) {
    if (p.type !== 'request') return false;
    return S().requests[p.requestId].versions.some(function (v) { return S().packets[v].version > p.version && M.nodeHas(src, v); });
  }

  /* ---------- the message ---------- */
  var NEW_PACKET = 'A new packet with its own route. It may not follow the request\u2019s path, and arrival is not guaranteed.';
  function packetInfo(pid) {
    var s = S(), p = s.packets[pid]; if (!p) return null;
    var r = p.requestId && s.requests[p.requestId], pl = p.payload || {}, rt = p.route, o = { id: pid, type: p.type, policy: rt.policy };
    o.origin = p.originNodeId; o.originName = nm(p.originNodeId); o.expiresInMin = Math.max(0, p.expiresTick - s.tick); o.lifetimeMin = p.expiresTick - p.createdTick;
    o.maxHops = rt.maxHops; o.fanout = rt.fanout || null; o.targets = rt.targets || [];
    if (p.type === 'request') {
      var missing = r.kind === 'missing';
      o.badge = missing ? 'Missing person' : (r.urgent ? 'Urgent' : 'Request'); o.tone = missing ? 'info' : (r.urgent ? 'urgent' : 'info');
      o.title = r.title; o.body = r.description; o.where = r.area; o.from = 'Posted by ' + nm(p.originNodeId) + ' (declares ' + area(p.originNodeId) + ')';
      o.name = missing ? 'Missing-person request' : (r.urgent ? 'Urgent ' + r.category.toLowerCase() + ' request' : r.category + ' request');
      o.priority = p.urgent ? 'Urgent: forwarded before ordinary traffic' : 'Normal: forwarded after urgent traffic';
    } else if (p.type === 'reply') {
      var sight = pl.kind === 'sighting';
      o.badge = 'Unverified'; o.tone = 'warn'; o.title = sight ? 'Possible sighting' : 'Offer of help'; o.body = pl.note; o.where = pl.area;
      o.from = (sight ? 'Submitted by ' : 'Sent by ') + nm(p.originNodeId) + ' (declares ' + area(p.originNodeId) + ')'; o.name = sight ? 'Possible sighting (unverified)' : 'Offer of help (unverified)';
      o.priority = NEW_PACKET; o.kind = pl.kind;
    } else if (p.type === 'ack') {
      var rp0 = s.packets[pl.replyPacketId], sg0 = !!rp0 && rp0.payload.kind === 'sighting';
      o.badge = 'Acknowledgment'; o.tone = 'info'; o.title = sg0 ? 'Sighting acknowledged' : 'Offer acknowledged';
      o.body = sg0 ? 'The requester saw the sighting report. That does not mean it was checked or confirmed.' : 'The requester saw the offer. That does not mean it was accepted or that help is on the way.';
      o.from = 'Sent by ' + nm(p.originNodeId); o.name = 'Acknowledgment'; o.priority = NEW_PACKET;
    } else if (p.type === 'resolve') {
      o.badge = 'Resolved'; o.tone = 'info'; o.title = 'Request marked resolved'; o.body = ''; o.from = 'Sent by ' + nm(p.originNodeId); o.name = 'Resolution notice'; o.priority = NEW_PACKET;
    } else {
      o.badge = 'Community update'; o.tone = 'neutral'; o.title = pl.category + ' update'; o.body = pl.text; o.where = pl.area; o.from = 'Posted by ' + nm(p.originNodeId) + ' (declares ' + area(p.originNodeId) + ')';
      o.name = 'Community update'; o.priority = 'Lowest priority: yields to urgent requests';
    }
    o.policyText = rt.policy === 'flood' ? (p.type === 'broadcast' ? 'Spreads to every Relay phone it can reach through other Relay phones, after urgent requests.' : p.type === 'request' ? 'Spreads in every direction: Relay can\u2019t know in advance where a helper is.' : 'Spreads to every Relay phone it can reach: Relay doesn\u2019t know where the recipient is.')
      : rt.policy === 'directed' ? 'Steered toward ' + targetNames(rt) + ' using each phone\'s declared neighbourhood, with a limited number of detours.'
      : 'No target area: handed to a few neighbours only.';
    return o;
  }

  /* ---------- who holds it, who could, who cannot (potential reach is NOT receipt) ---------- */
  function groupsFor(pid) {
    var s = S(), on = {}; s.order.forEach(function (id) { on[id] = M.canRelay(id); });
    var comp = M.components(on), hc = {};
    if (pid) M.holders(pid).forEach(function (id) { if (on[id]) hc[comp[id]] = 1; });
    var out = { holders: [], reachable: [], cutOff: [], noRelay: [], groups: [], comp: comp, on: on }, size = {}, holds = {};
    s.order.forEach(function (id) {
      if (!on[id]) { out.noRelay.push(id); return; }
      size[comp[id]] = (size[comp[id]] || 0) + 1;
      if (pid && M.nodeHas(id, pid)) out.holders.push(id); else if (pid && hc[comp[id]]) out.reachable.push(id); else out.cutOff.push(id);
    });
    Object.keys(size).forEach(function (c) { out.groups.push({ id: +c, size: size[c], holds: !!hc[c] }); });
    out.groups.sort(function (a, b) { return b.size - a.size; });
    return out;
  }

  /* ---------- one decision: may src hand pid to dst next step, and why / why not ----------
     Everything here is read from Mesh.classify(), the engine's own classification of every neighbour (the same object step() acts on), so the reason
     given for a neighbour is the reason the engine used, never a second implementation of the rule.
     Not being selected is a statement about THIS phone's choice at THIS minute. `lasting` says how long it holds:
       'now'   this minute only (the situation can change: neighbours move on, time passes)
       'while' for as long as this phone keeps the same closer neighbours; time can lift it (`retryAt`)
       'copy'  for this copy of the message (its detour allowance is spent)
       'phone' for this phone (its copy limit is spent); another phone may still pass it to this neighbour. */
  function minute(t) { return 'minute ' + t; }
  function mins(n) { return n + (n === 1 ? ' minute' : ' minutes'); }
  function decide(src, dst, pid) { var d = decide0(src, dst, pid); if (d && d.verdict !== 'none' && !d.brief) d.brief = briefOf(d, src, dst, pid); return d; }
  /* one short sentence for small spaces (Story); the full reason stays in .text */
  function briefOf(d, src, dst, pid) {
    var rt = S().packets[pid].route, T = targetNames(rt), a = area(dst), c = M.classify(src, pid), row = c.rows.filter(function (r) { return r.d === dst; })[0] || {};
    var dd = row.s === null || row.s === undefined ? 'unknown' : steps(row.s), ds = c.ds === null || c.ds === undefined ? 'unknown' : steps(c.ds), other = ' ' + a + ' may still get it from another phone.';
    switch (d.code) {
      case 'closer': case 'equal': case 'same-area': return d.text;
      case 'detour': return 'Detour: ' + a + ' is ' + dd + ' from ' + T + ' (this phone: ' + ds + '). Used because this phone has nothing closer to hand it to.';
      case 'closer-exists': return 'Not selected now: ' + a + ' is ' + dd + ' from ' + T + ' (this phone: ' + ds + '). This phone has closer neighbours, so Relay does not send copies away from the target.' + other;
      case 'fanout': case 'detour-fanout': return 'Not selected: this phone has used its copy limit.' + other;
      case 'detour-used': return 'Not selected: ' + a + ' is ' + dd + ' from ' + T + ' (this phone: ' + ds + '), and this copy has used its detour.' + other;
      case 'too-far': return 'Not selected now: ' + a + ' is ' + dd + ' from ' + T + ' (this phone: ' + ds + '), farther than a detour may go.' + other;
      case 'inside-target': return 'Not selected: this copy is inside the target area and does not go outward.';
    }
    return d.text;
  }
  function decide0(src, dst, pid) {
    var s = S(), p = s.packets[pid], e = s.inbox[src][pid], rt = p.route;
    if (!e || !M.canRelay(src) || !M.canRelay(dst) || M.nodeHas(dst, pid)) return { verdict: 'none', code: 'n/a', text: '' };
    var c = M.classify(src, pid);
    if (c.stop === 'expired') return { verdict: 'stop', code: 'expired', text: 'The message has expired (it lives ' + (p.expiresTick - p.createdTick) + ' simulated minutes), so phones stop passing it on.' };
    if (c.stop === 'superseded') return { verdict: 'stop', code: 'superseded', text: 'A newer version of this request is already on this phone, so the old one is no longer passed on.' };
    if (c.stop === 'hoplimit') return { verdict: 'stop', code: 'hoplimit', text: 'The message has used its hop limit (' + rt.maxHops + ' phone-to-phone hops), so it is not passed further.' };
    var row = c.rows.filter(function (r) { return r.d === dst; })[0]; if (!row) return { verdict: 'none', code: 'n/a', text: '' };
    var T = targetNames(rt), ds = c.ds === undefined ? null : c.ds, dd = row.s;
    if (row.sel) {
      if (rt.policy === 'flood') return { verdict: 'send', code: 'flood', text: p.type === 'broadcast' ? 'Community updates go to every Relay neighbour, behind urgent requests.' : p.type === 'request' ? 'Emergency and general requests go to every Relay neighbour: no one knows in advance where a helper is.' : 'This packet goes to every Relay neighbour: Relay doesn\u2019t know where its recipient is.' };
      if (rt.policy === 'opportunistic') return { verdict: 'send', code: 'opportunistic', text: 'No target area was given, so this copy goes to up to ' + rt.fanout + ' neighbours (' + (c.sent + 1) + ' of ' + rt.fanout + ').' };
      if (row.det) return { verdict: 'detour', code: 'detour', lasting: 'now', text: 'Permitted detour: ' + area(dst) + ' is not closer to ' + T + ' (' + (dd === null ? 'area unknown' : steps(dd)) + ' away; this phone: ' + (ds === null ? 'unknown' : steps(ds)) + '). ' +
        (c.mode === 'waited' ? 'This phone has held the message for ' + mins(S().tick - c.heldSince) + ' and every closer neighbour already has it.' : 'This phone has no closer or equally close neighbour to hand it to.') + ' Detour ' + (c.used + 1) + ' of ' + c.dmax + ' for this copy.' };
      if (dd < ds) return { verdict: 'send', code: 'closer', text: 'Closer to the target: ' + area(dst) + ' is ' + steps(dd) + ' from ' + T + ' (this phone: ' + steps(ds) + ').' };
      if (dd === ds) return { verdict: 'send', code: 'equal', text: 'Equally close to ' + T + ' (' + steps(dd) + '), so it may pass.' };
      return { verdict: 'send', code: 'same-area', text: 'Same-area forwarding: both phones declare areas within 1 step of ' + T + ', so it keeps circulating there.' };
    }
    /* not selected: say which rule, from the engine's own classification */
    if (rt.policy === 'opportunistic') return { verdict: 'withhold', code: 'fanout', lasting: 'phone', text: 'Not selected: this copy already went to ' + rt.fanout + ' neighbours (its fan-out limit).' };
    var where = dd === null ? 'of unknown area' : steps(dd) + ' from ' + T, far = ds === null ? 'unknown' : steps(ds);
    var later = c.retryAt != null ? ' If the message is still waiting on this phone at ' + minute(c.retryAt) + ' (' + mins(c.patience) + ' after it arrived), the detour allowance widens and this neighbour may be used then.' : '';
    var other = ' ' + area(dst) + ' can still get it from another phone.';
    switch (row.code) {
      case 'fanout': return { verdict: 'withhold', code: 'fanout', lasting: 'phone', text: 'Not selected: this phone already handed the message to ' + rt.fanout + ' closer neighbours (its limit).' + other };
      case 'detour-fanout': return { verdict: 'withhold', code: 'detour-fanout', lasting: 'phone', text: 'Not selected: this phone has already used its ' + c.detourFanout + ' detour copies.' + other };
      case 'closer-exists': return { verdict: 'withhold', code: 'closer-exists', lasting: c.retryAt != null ? 'while' : 'while',
        text: 'Not selected now: ' + area(dst) + ' is ' + where + ' (this phone: ' + far + '). This phone has ' + c.forward + ' closer or equally close neighbour' + (c.forward === 1 ? '' : 's') + (c.forwardHolding ? ' (' + c.forwardHolding + ' already ' + (c.forwardHolding === 1 ? 'has' : 'have') + ' it)' : '') + ', so Relay does not send copies away from the target while those are available.' + (c.retryAt != null ? later.replace('this neighbour may be used then.', 'this neighbour may be used then, if nothing closer is left to hand it to.') : '') + other };
      case 'detour-used': return { verdict: 'withhold', code: 'detour-used', lasting: 'copy', text: 'Not selected: ' + area(dst) + ' is ' + where + ', not closer than this phone (' + far + '), and this copy has already used its ' + (c.used === 1 ? 'detour' : c.used + ' detours') + '.' + (c.retryAt != null ? later : other) };
      case 'too-far': return { verdict: 'withhold', code: 'too-far', lasting: 'now', text: 'Not selected now: ' + area(dst) + ' is ' + where + ', more than ' + c.away + ' step' + (c.away === 1 ? '' : 's') + ' farther than this phone (' + far + '), which is the most a detour may add.' + (c.retryAt != null ? later : other) };
      case 'inside-target': return { verdict: 'withhold', code: 'inside-target', lasting: 'copy', text: 'Not selected: this copy is already inside the target area, so it is not sent farther away. ' + area(dst) + ' is ' + where + '.' };
    }
    return { verdict: 'withhold', code: 'other', text: '' };
  }

  /* ---------- the frontier: holders that will hand it on next step, and neighbours that are deliberately held back ---------- */
  function frontier(pid) {
    var s = S(), out = { next: [], held: [], stop: null, frontierNodes: {} };
    M.holders(pid).forEach(function (src) {
      if (!M.canRelay(src)) return;
      s.adj[src].forEach(function (dst) {
        var d = decide(src, dst, pid);
        if (d.verdict === 'send' || d.verdict === 'detour') { out.next.push({ from: src, to: dst, det: d.verdict === 'detour', code: d.code, text: d.text, brief: d.brief }); out.frontierNodes[src] = 1; }
        else if (d.verdict === 'withhold') out.held.push({ from: src, to: dst, code: d.code, text: d.text, brief: d.brief, lasting: d.lasting || 'now' });
        else if (d.verdict === 'stop' && !out.stop) out.stop = d;
      });
    });
    return out;
  }
  /* What kind of encounter link is this? ('local' contact inside a cluster, 'stretched' = longer than the radius, kept only so a cluster stays connected, 'connector' = a modelled
     long-range link between clusters). The drawing is schematic: only these links carry messages, whatever the distances look like. */
  var LINKTXT = { local: '', stretched: 'Longer link, kept so this cluster stays connected (a modelled exception).', connector: 'Long-range link between clusters (modelled: people who travel between areas).' };
  function linkKind(a, b) { var e = S().edges.filter(function (x) { return (x.from === a && x.to === b) || (x.from === b && x.to === a); })[0]; return e ? (e.kind || 'local') : null; }
  function linkText(a, b) { return LINKTXT[linkKind(a, b)] || ''; }
  /* every neighbour of one phone, with the verdict for the selected message */
  function neighbours(id, pid) {
    var s = S(), p = pid && s.packets[pid], has = p && M.nodeHas(id, pid);
    return s.adj[id].map(function (o) {
      var row = { id: o, name: nm(o), area: area(o), relay: M.canRelay(o), has: !!(p && M.nodeHas(o, pid)), verdict: 'info', text: '', link: linkText(id, o) };
      if (!row.relay) { row.verdict = 'norelay'; row.text = 'No Relay: cannot carry or pass on messages.'; }
      else if (p && row.has) { row.verdict = 'has'; var e = s.inbox[o][pid]; row.text = e.via === id ? 'Received it from this phone.' : (s.inbox[id][pid] && s.inbox[id][pid].via === o ? 'Gave it to this phone.' : 'Already holds it.'); }
      else if (p && has && M.canRelay(id)) { var d = decide(id, o, pid); row.verdict = d.verdict; row.text = d.text; row.code = d.code; }
      else if (p && !has) { row.verdict = 'lacks'; row.text = 'Does not hold the message yet.'; }
      return row;
    });
  }
  /* who handed it to whom, all the way back to the origin (the real forwarding chain) */
  function chain(pid, id) {
    var s = S(), out = [], cur = id, guard = 0;
    while (cur && s.inbox[cur][pid] && guard++ < 100) { out.unshift(cur); cur = s.inbox[cur][pid].via; }
    return out;
  }

  /* ---------- a step, explained from the engine's own plan ---------- */
  function snapshotPlan() {
    var s = S(), plans = {}, tick = s.tick;
    s.order.forEach(function (src) {
      if (!M.canRelay(src)) return;
      Object.keys(s.inbox[src]).forEach(function (pid) {
        var pl = M.plan(src, pid); if (!pl.length) return;
        plans[src + '|' + pid] = pl.map(function (c) { var d = decide(src, c.d, pid); return { to: c.d, det: !!c.det, code: d.code, text: d.text, prio: s.packets[pid].prio }; });
      });
    });
    return { tick: tick, plans: plans };
  }
  function report(before) {
    var s = S(), moved = {}, byLink = {}, rep = { tick: s.tick, moves: [], waited: [], planned: 0 };
    s.lastHops.forEach(function (m) { moved[m.from + '|' + m.to + '|' + m.packetId] = 1; (byLink[m.from + '>' + m.to] = byLink[m.from + '>' + m.to] || []).push(m.packetId); });
    var gotBy = {}; s.lastHops.forEach(function (m) { gotBy[m.to + '|' + m.packetId] = m.from; });
    Object.keys(before.plans).forEach(function (key) {
      var parts = key.split('|'), src = parts[0], pid = parts[1];
      before.plans[key].forEach(function (c) {
        rep.planned++;
        if (moved[src + '|' + c.to + '|' + pid]) { rep.moves.push({ from: src, to: c.to, pid: pid, det: c.det, code: c.code, text: c.text }); return; }
        var other = (byLink[src + '>' + c.to] || [])[0], racer = gotBy[c.to + '|' + pid];
        if (other) rep.waited.push({ from: src, to: c.to, pid: pid, code: 'capacity', winner: other, text: 'Waited: a link carries ' + M.CAP + ' message per step, and ' + packetInfo(other).name.toLowerCase() + ' went first.' });
        else if (racer && racer !== src) rep.waited.push({ from: src, to: c.to, pid: pid, code: 'raced', winner: null, text: 'Not needed: ' + nm(c.to) + ' received it from another phone in the same step.' });
        else rep.waited.push({ from: src, to: c.to, pid: pid, code: 'unexplained', winner: null, text: '' });
      });
    });
    return rep;
  }

  /* ---------- the bridge and what installing it changes ---------- */
  function connectivity(pid) {
    var g = groupsFor(pid), hold = g.groups.filter(function (x) { return x.holds; });
    return { groups: g.groups.length, largest: g.groups.length ? g.groups[0].size : 0, holderGroupSize: hold.reduce(function (a, x) { return a + x.size; }, 0),
      holders: g.holders.length, reachable: g.reachable.length, cutOff: g.cutOff.length, relay: g.holders.length + g.reachable.length + g.cutOff.length, tick: S().tick };   // 'reachable' = connected to a holder, not holding it
  }
  function liveLinks(id) { return S().adj[id].filter(M.canRelay); }
  function bridge(pid) {
    var st = M.stats(pid), c = st.candidates[0]; if (!c || st.expired) return null;   // an expired message is stopped by its lifetime, not by a gap
    var g = groupsFor(pid), s = S(), side = { hold: 0, other: [] }, seen = {};
    s.adj[c].forEach(function (o) { if (!g.on[o]) return; var gr = g.comp[o]; if (seen[gr]) return; seen[gr] = 1; var grp = g.groups.filter(function (x) { return x.id === gr; })[0]; if (grp.holds) side.hold = grp.size; else side.other.push(grp.size); });
    return { id: c, name: nm(c), area: area(c), unlock: st.unlock[c], holdSide: side.hold, otherSides: side.other, links: s.adj[c].filter(function (o) { return g.on[o]; }).length, all: st.candidates.slice() };
  }

  /* ---------- connected is not eligible ----------
     groupsFor() says who is connected to a holder through Relay phones. That is physics of the network, not a promise about this packet: a directed or capped packet
     may never be handed to some of them. reach() splits the connected, not-yet-holding phones by what the engine's own plan says about them right now. */
  function reach(pid) {
    var g = groupsFor(pid), fr = frontier(pid), st = M.stats(pid), nextTo = {}, heldTo = {};
    fr.next.forEach(function (e) { nextTo[e.to] = 1; }); fr.held.forEach(function (e) { heldTo[e.to] = 1; });
    var o = { holders: g.holders, eligibleNext: [], heldBack: [], connectedOther: [], cutOff: g.cutOff, noRelay: g.noRelay, canMove: st.canMove, expired: st.expired, policy: S().packets[pid].route.policy };
    var fixedTo = {}; fr.held.forEach(function (e) { if (fixedTo[e.to] === undefined) fixedTo[e.to] = true; if (e.lasting !== 'copy') fixedTo[e.to] = false; });
    o.heldNow = []; o.heldFixed = [];
    g.reachable.forEach(function (i) { if (nextTo[i]) o.eligibleNext.push(i); else if (heldTo[i]) { o.heldBack.push(i); (fixedTo[i] ? o.heldFixed : o.heldNow).push(i); } else o.connectedOther.push(i); });
    o.connected = o.eligibleNext.concat(o.heldBack, o.connectedOther);   // connected to a holder, not holding it (what v4 called "reachable")
    return o;
  }
  /* Why is a packet not moving? Lifetime, routing policy, a missing bridge, or nothing left to reach. Both counts are always reported:
     a stopped directed packet can have connected phones the policy withholds AND a few phones cut off behind a gap. */
  function stopReason(pid) {
    var st = M.stats(pid), p = S().packets[pid], r = reach(pid), o = { code: '', connected: r.connected.length, heldBack: r.heldBack.length, notAdjacent: r.connectedOther.length, cutOff: r.cutOff.length, bridge: null };
    if (st.expired) { o.code = 'expired'; o.lifetime = p.expiresTick - p.createdTick; return o; }
    if (st.canMove) { o.code = 'moving'; return o; }
    o.waiting = !!st.waiting; o.wakeTick = st.wakeTick;   // nothing moves this minute, but a time-based detour allowance will (if nothing else changes): not a final stop
    if (st.candidates.length && r.cutOff.length) o.bridge = st.candidates[0];
    o.code = !o.connected && !o.cutOff ? 'complete' : (o.bridge && o.cutOff >= o.connected) ? 'gap' : o.connected ? 'policy' : 'cut-off';   // the larger cause leads; the other count is still reported
    return o;
  }
  /* A before/after pair of connectivity snapshots, so "newly connected" is a real set difference. */
  function snapshotConn(pid) { var g = groupsFor(pid); return { holders: g.holders.slice(), connected: g.reachable.slice(), tick: S().tick }; }
  function diffConn(before, after, bridgeId) {
    var was = {}; before.holders.concat(before.connected).forEach(function (i) { was[i] = 1; });
    return { newlyConnected: after.connected.filter(function (i) { return !was[i] && i !== bridgeId; }), alreadyConnected: before.connected.slice(), bridge: bridgeId,
      bridgeWasHolder: before.holders.indexOf(bridgeId) >= 0, connectedBefore: before.holders.length + before.connected.length, connectedAfter: after.holders.length + after.connected.length };
  }
  /* The next-step forwarding choice (one phone, a neighbour that gets it, a neighbour that does not), always computed from the CURRENT engine state. */
  function decisionPair(pid) {
    if (!pid) return null; var fr = frontier(pid), by = {};
    fr.next.forEach(function (e) { var o = by[e.from] = by[e.from] || {}; if (e.code === 'closer' || e.code === 'equal' || e.code === 'same-area') { if (!o.a || (e.code === 'closer' && o.a.code !== 'closer')) o.a = e; } else if (e.det && !o.b) o.b = e; });
    fr.held.forEach(function (e) { var o = by[e.from] = by[e.from] || {}; if (!o.b || o.b.det) o.b = e; });
    var best = null; Object.keys(by).sort().forEach(function (src) { var o = by[src]; if (o.a && o.b && (!best || (o.a.code === 'closer' && best.a.code !== 'closer'))) best = { src: src, a: o.a, b: o.b, tick: S().tick, pid: pid }; });
    return best;
  }

  /* ---------- the neighbourhood graph used by directed routing (counts are real engine data) ---------- */
  function hoodGraph(pid) {
    var s = S(), p = pid && s.packets[pid], targets = (p && p.route.targets) || [], rows = {};
    M.NEIGHBORHOODS.forEach(function (h) { rows[h.id] = { id: h.id, name: h.name, dist: targets.length ? distSet(h.id, targets) : null, relay: 0, holders: 0 }; });
    s.order.forEach(function (id) { if (!M.canRelay(id)) return; var h = trusted(id); if (!h || !rows[h]) return; rows[h].relay++; if (p && M.nodeHas(id, pid)) rows[h].holders++; });
    return { targets: targets, rows: M.NEIGHBORHOODS.map(function (h) { return rows[h.id]; }), edges: M.NEIGH_EDGES.slice() };
  }

  global.SimExplain = { nm: nm, area: area, who: who, packetInfo: packetInfo, groupsFor: groupsFor, decide: decide, frontier: frontier, neighbours: neighbours, chain: chain,
    snapshotPlan: snapshotPlan, report: report, connectivity: connectivity, bridge: bridge, hoodGraph: hoodGraph, reach: reach, stopReason: stopReason, snapshotConn: snapshotConn, diffConn: diffConn, decisionPair: decisionPair, liveLinks: liveLinks, linkKind: linkKind, linkText: linkText, hoodName: hoodName, targetNames: targetNames };
})(typeof window !== 'undefined' ? window : global);
