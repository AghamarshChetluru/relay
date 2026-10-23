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
  function nm(id) { var n = S().nodes[id]; return n.key ? n.label : 'Phone ' + id; }
  function area(id) { return S().nodes[id].area || 'unknown area'; }
  function who(id) { var n = S().nodes[id]; return nm(id) + (n.key ? '' : '') + ' (' + area(id) + ')'; }
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
  function packetInfo(pid) {
    var s = S(), p = s.packets[pid]; if (!p) return null;
    var r = p.requestId && s.requests[p.requestId], pl = p.payload || {}, rt = p.route, o = { id: pid, type: p.type, policy: rt.policy };
    o.origin = p.originNodeId; o.originName = nm(p.originNodeId); o.expiresInMin = Math.max(0, p.expiresTick - s.tick); o.lifetimeMin = p.expiresTick - p.createdTick;
    o.maxHops = rt.maxHops; o.fanout = rt.fanout || null; o.targets = rt.targets || [];
    if (p.type === 'request') {
      var missing = r.kind === 'missing';
      o.badge = missing ? 'Missing person' : (r.urgent ? 'Urgent' : 'Request'); o.tone = missing ? 'info' : (r.urgent ? 'urgent' : 'info');
      o.title = r.title; o.body = r.description; o.where = r.area; o.from = 'Posted by ' + nm(p.originNodeId) + ' in ' + area(p.originNodeId);
      o.name = missing ? 'Missing-person request' : (r.urgent ? 'Urgent ' + r.category.toLowerCase() + ' request' : r.category + ' request');
      o.priority = p.urgent ? 'Urgent: forwarded before ordinary traffic' : 'Normal: forwarded after urgent traffic';
    } else if (p.type === 'reply') {
      var sight = pl.kind === 'sighting';
      o.badge = 'Unverified'; o.tone = 'warn'; o.title = sight ? 'Possible sighting' : 'Offer of help'; o.body = pl.note; o.where = pl.area;
      o.from = (sight ? 'Submitted by ' : 'Sent by ') + nm(p.originNodeId) + ' in ' + area(p.originNodeId); o.name = sight ? 'Possible sighting (unverified)' : 'Offer of help (unverified)';
      o.priority = 'Travels with its request';
    } else if (p.type === 'ack') {
      o.badge = 'Acknowledgment'; o.tone = 'info'; o.title = 'Offer acknowledged'; o.body = 'The requester accepted the offer of help.'; o.from = 'Sent by ' + nm(p.originNodeId); o.name = 'Acknowledgment'; o.priority = 'Travels with its request';
    } else if (p.type === 'resolve') {
      o.badge = 'Resolved'; o.tone = 'info'; o.title = 'Request marked resolved'; o.body = ''; o.from = 'Sent by ' + nm(p.originNodeId); o.name = 'Resolution notice'; o.priority = 'Travels with its request';
    } else {
      o.badge = 'Community update'; o.tone = 'neutral'; o.title = pl.category + ' update'; o.body = pl.text; o.where = pl.area; o.from = 'Posted by ' + nm(p.originNodeId) + ' in ' + area(p.originNodeId);
      o.name = 'Community update'; o.priority = 'Lowest priority: yields to urgent requests';
    }
    o.policyText = rt.policy === 'flood' ? (p.type === 'broadcast' ? 'Spreads to every Relay phone nearby (after urgent requests).' : 'Spreads in every direction: nobody can know where a helper is.')
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

  /* ---------- one decision: may src hand pid to dst next step, and why / why not ---------- */
  function budget(src, pid) {
    var s = S(), p = s.packets[pid], e = s.inbox[src][pid], rt = p.route, R = M.ROUTE;
    var patient = !e.tgt && s.tick - e.tick >= R.patience;
    var dmax = e.tgt ? 0 : (rt.detourMax || 0) + (patient ? R.patientExtra : 0), away = (rt.detourAway || 0) + (patient ? 1 : 0);
    var ob = s.outbox[src][pid], sentGood = ob ? ob.good || 0 : 0;
    return { dmax: dmax, away: away, used: e.detours, patient: patient, sentGood: sentGood, left: rt.fanout ? rt.fanout - sentGood : Infinity, hops: e.hops };
  }
  function decide(src, dst, pid) {
    var s = S(), p = s.packets[pid], e = s.inbox[src][pid], rt = p.route;
    if (!e || !M.canRelay(src) || !M.canRelay(dst) || M.nodeHas(dst, pid)) return { verdict: 'none', code: 'n/a', text: '' };
    if (M.isExpired(p)) return { verdict: 'stop', code: 'expired', text: 'The message has expired (it lives ' + (p.expiresTick - p.createdTick) + ' simulated minutes), so phones stop passing it on.' };
    if (superseded(src, p)) return { verdict: 'stop', code: 'superseded', text: 'A newer version of this request is already on this phone, so the old one is no longer passed on.' };
    if (e.hops >= rt.maxHops) return { verdict: 'stop', code: 'hoplimit', text: 'The message has used its hop limit (' + rt.maxHops + ' phone-to-phone hops), so it is not passed further.' };
    var pl = M.plan(src, pid), hit = null; pl.forEach(function (c) { if (c.d === dst) hit = c; });
    var b = budget(src, pid), T = targetNames(rt);
    if (hit) {
      if (rt.policy === 'flood') return { verdict: 'send', code: 'flood', text: p.type === 'broadcast' ? 'Community updates go to every Relay neighbour, behind urgent requests.' : 'Emergency and general requests go to every Relay neighbour: no one knows in advance where a helper is.' };
      if (rt.policy === 'opportunistic') return { verdict: 'send', code: 'opportunistic', text: 'No target area was given, so this copy goes to up to ' + rt.fanout + ' neighbours (' + (b.sentGood + 1) + ' of ' + rt.fanout + ').' };
      var ds = distSet(trusted(src), rt.targets), dd = distSet(trusted(dst), rt.targets);
      if (hit.det) return { verdict: 'detour', code: 'detour', text: 'Permitted detour: ' + area(dst) + ' is not closer to ' + T + ' (' + (dd === null ? 'area unknown' : steps(dd)) + ' away; this phone: ' + (ds === null ? 'unknown' : steps(ds)) + '). Detour ' + (b.used + 1) + ' of ' + b.dmax + ' for this copy.' };
      if (dd !== null && ds !== null && dd < ds) return { verdict: 'send', code: 'closer', text: 'Closer to the target: ' + area(dst) + ' is ' + steps(dd) + ' from ' + T + ' (this phone: ' + steps(ds) + ').' };
      if (dd !== null && ds !== null && dd === ds) return { verdict: 'send', code: 'equal', text: 'Equally close to ' + T + ' (' + steps(dd) + '), so it may pass.' };
      return { verdict: 'send', code: 'same-area', text: 'Same-area forwarding: both phones declare areas within 1 step of ' + T + ', so it keeps circulating there.' };
    }
    /* not in the engine's plan: say why, from the same quantities the engine uses */
    if (rt.policy === 'opportunistic') return { verdict: 'withhold', code: 'fanout', text: 'This copy already went to ' + rt.fanout + ' neighbours (its fan-out limit), so it waits.' };
    if (rt.policy === 'directed') {
      var ds2 = distSet(trusted(src), rt.targets), dd2 = distSet(trusted(dst), rt.targets), inArea = dd2 !== null && dd2 <= 1 && ds2 !== null && ds2 <= 1;
      var isGood = dd2 !== null && ds2 !== null && (dd2 <= ds2 || inArea);
      if (isGood) return { verdict: 'withhold', code: 'fanout', text: 'This phone already handed the message to ' + rt.fanout + ' closer neighbours (its fan-out limit), so this neighbour waits.' };
      if (b.dmax === 0 && e.tgt) return { verdict: 'withhold', code: 'farther', text: 'Not forwarded: this copy is already inside the target area and detours are off there. ' + area(dst) + ' is ' + (dd2 === null ? 'unknown' : steps(dd2)) + ' from ' + T + '.' };
      if (b.used >= b.dmax) return { verdict: 'withhold', code: 'farther', text: 'Not forwarded: ' + area(dst) + ' is ' + (dd2 === null ? 'of unknown area' : steps(dd2) + ' from ' + T) + ', not closer than this phone (' + (ds2 === null ? 'unknown' : steps(ds2)) + '), and this copy has used its ' + b.dmax + ' detour' + (b.dmax === 1 ? '' : 's') + '.' };
      return { verdict: 'withhold', code: 'too-far', text: 'Not forwarded: ' + area(dst) + ' is ' + (dd2 === null ? 'of unknown area' : steps(dd2) + ' from ' + T) + ', more than ' + b.away + ' step' + (b.away === 1 ? '' : 's') + ' farther than this phone (' + (ds2 === null ? 'unknown' : steps(ds2)) + '), beyond a permitted detour.' };
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
        if (d.verdict === 'send' || d.verdict === 'detour') { out.next.push({ from: src, to: dst, det: d.verdict === 'detour', code: d.code, text: d.text }); out.frontierNodes[src] = 1; }
        else if (d.verdict === 'withhold') out.held.push({ from: src, to: dst, code: d.code, text: d.text });
        else if (d.verdict === 'stop' && !out.stop) out.stop = d;
      });
    });
    return out;
  }
  /* every neighbour of one phone, with the verdict for the selected message */
  function neighbours(id, pid) {
    var s = S(), p = pid && s.packets[pid], has = p && M.nodeHas(id, pid);
    return s.adj[id].map(function (o) {
      var row = { id: o, name: nm(o), area: area(o), relay: M.canRelay(o), has: !!(p && M.nodeHas(o, pid)), verdict: 'info', text: '' };
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
      holders: g.holders.length, reachable: g.reachable.length, cutOff: g.cutOff.length, relay: g.holders.length + g.reachable.length + g.cutOff.length, tick: S().tick };
  }
  function liveLinks(id) { return S().adj[id].filter(M.canRelay); }
  function bridge(pid) {
    var st = M.stats(pid), c = st.candidates[0]; if (!c) return null;
    var g = groupsFor(pid), s = S(), side = { hold: 0, other: [] }, seen = {};
    s.adj[c].forEach(function (o) { if (!g.on[o]) return; var gr = g.comp[o]; if (seen[gr]) return; seen[gr] = 1; var grp = g.groups.filter(function (x) { return x.id === gr; })[0]; if (grp.holds) side.hold = grp.size; else side.other.push(grp.size); });
    return { id: c, name: nm(c), area: area(c), unlock: st.unlock[c], holdSide: side.hold, otherSides: side.other, links: s.adj[c].filter(function (o) { return g.on[o]; }).length, all: st.candidates.slice() };
  }

  /* ---------- the neighbourhood graph used by directed routing (counts are real engine data) ---------- */
  function hoodGraph(pid) {
    var s = S(), p = pid && s.packets[pid], targets = (p && p.route.targets) || [], rows = {};
    M.NEIGHBORHOODS.forEach(function (h) { rows[h.id] = { id: h.id, name: h.name, dist: targets.length ? distSet(h.id, targets) : null, relay: 0, holders: 0 }; });
    s.order.forEach(function (id) { if (!M.canRelay(id)) return; var h = trusted(id); if (!h || !rows[h]) return; rows[h].relay++; if (p && M.nodeHas(id, pid)) rows[h].holders++; });
    return { targets: targets, rows: M.NEIGHBORHOODS.map(function (h) { return rows[h.id]; }), edges: M.NEIGH_EDGES.slice() };
  }

  global.SimExplain = { nm: nm, area: area, who: who, packetInfo: packetInfo, groupsFor: groupsFor, decide: decide, frontier: frontier, neighbours: neighbours, chain: chain,
    snapshotPlan: snapshotPlan, report: report, connectivity: connectivity, bridge: bridge, hoodGraph: hoodGraph, liveLinks: liveLinks, hoodName: hoodName, targetNames: targetNames, budget: budget };
})(typeof window !== 'undefined' ? window : global);
