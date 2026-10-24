/* Routing audit library (read-only against the engine's public API). Used by tests/sim_routing_test.js and tests/routing_audit_report.js.
   Works on any prototype directory, so the SAME audit can be run on the pre-V4.2 engine for the before/after tables.
   Every number comes from running the real engine (Mesh.createRequest + Mesh.step), never from a model of it. */
module.exports = function (dir) {
  global.window = global;
  for (const k of Object.keys(require.cache)) if (k.indexOf('/prototype') >= 0 || k.indexOf(dir) >= 0) delete require.cache[k];
  delete global.Mesh; delete global.SimExplain;
  require(dir + '/mesh.js'); require(dir + '/sim_explain.js');
  const M = global.Mesh, X = global.SimExplain, S = () => M.state(), K = () => S().keys;
  const HOODS = M.NEIGHBORHOODS.map(h => h.id);
  const num = id => +String(id).slice(1);
  const dxy = (a, b) => Math.hypot(S().nodes[a].x - S().nodes[b].x, S().nodes[a].y - S().nodes[b].y);
  function bfs(from, ok) { const D = { [from]: 0 }, q = [from]; while (q.length) { const c = q.shift(); for (const o of S().adj[c]) if (D[o] == null && (!ok || ok(o))) { D[o] = D[c] + 1; q.push(o); } } return D; }
  const relayDist = (a, b) => { const D = bfs(a, M.canRelay); return D[b] == null ? null : D[b]; };
  const graphDist = (a, b) => { const D = bfs(a); return D[b] == null ? null : D[b]; };

  /* ---------- 1. topology audit: every pair inside one encounter cluster ---------- */
  function clusterPairs(R) {
    const s = S(), out = [];
    for (const z of s.hoods.map(h => h.id)) {
      const ids = s.order.filter(i => s.nodes[i].zone === z);
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i], b = ids[j], d = dxy(a, b), adj = s.adj[a].indexOf(b) >= 0, both = M.canRelay(a) && M.canRelay(b);
        out.push({ a, b, zone: z, d, adj, both, relayPath: both ? relayDist(a, b) : null, graphPath: graphDist(a, b), within: d < R });
      }
    }
    return out;
  }
  /* ---------- 2. one directed request, run to quiescence ---------- */
  function newMissing(origin, target, o) {
    o = o || {};
    return M.createRequest(origin, { kind: 'missing', category: 'Missing', title: 'Looking for someone', description: 'd', area: 'x', urgent: false, targets: [target], lastKnown: 'x', validity: o.validity || 1440 });
  }
  function hoodDistOf(id, target) { const h = M.hoodState(id); return h.reliable ? M.hoodDistance(h.id, target) : null; }
  function run(origin, target, o) {
    o = o || {}; const r = newMissing(origin, target, o), pid = r.packetId, s = S(), max = o.max || 400, log = [];
    let i = 0, lastMove = s.tick;
    for (; i < max; i++) {
      const before = {}; if (o.trace) s.order.forEach(id => { if (s.inbox[id][pid] && M.canRelay(id)) before[id] = M.plan(id, pid).map(c => ({ d: c.d, s: c.s, det: !!c.det })); });
      if (M.isExpired(s.packets[pid])) break;
      if (!M.stats(pid).canMove && s.tick - lastMove > (M.ROUTE.patience || 16) + 2) break;   /* quiet for longer than any time-based allowance */
      M.step(); if (s.lastHops.some(h => h.packetId === pid)) lastMove = s.tick;
      if (o.trace) log.push({ tick: s.tick, plans: before, moves: s.lastHops.filter(h => h.packetId === pid).map(h => ({ from: h.from, to: h.to })) });
    }
    return Object.assign(summary(pid, origin, target), { pid, ticks: s.tick, steps: i, log });
  }
  function summary(pid, origin, target) {
    const s = S(), hs = M.holders(pid).filter(M.canRelay), p = s.packets[pid];
    const declaring = s.order.filter(id => M.canRelay(id) && s.nodes[id].hood === target), hit = declaring.filter(id => M.nodeHas(id, pid));
    const comp = M.components(Object.fromEntries(s.order.map(id => [id, M.canRelay(id)])));
    const originDist = hoodDistOf(origin, target);
    let detourHops = 0, backward = 0, maxExcess = 0, maxHops = 0;
    hs.forEach(id => { const e = s.inbox[id][pid]; detourHops += e.detours > 0 && e.via ? 1 : 0; maxHops = Math.max(maxHops, e.hops);
      const d = hoodDistOf(id, target); if (d != null && originDist != null && d > originDist) { backward++; maxExcess = Math.max(maxExcess, d - originDist); } });
    const targetInComponent = declaring.filter(id => comp[id] === comp[origin]);
    const st = M.stats(pid), sr = X.stopReason ? X.stopReason(pid) : null;
    const firstTarget = hit.length ? Math.min.apply(null, hit.map(id => s.inbox[id][pid].tick)) : null, hopsToTarget = hit.length ? Math.min.apply(null, hit.map(id => s.inbox[id][pid].hops)) : null;
    return { origin, target, holders: hs.length, relay: M.participating().length, declaring: declaring.length, reached: hit.length, delivered: hit.length > 0,
      targetInComponent: targetInComponent.length, componentSize: Object.keys(comp).filter(id => comp[id] === comp[origin]).length, expired: M.isExpired(p), canMove: st.canMove,
      stop: sr ? sr.code : null, stopInfo: sr, backward, maxExcess, detourHops, maxHops, originDist, hs, firstTarget, hopsToTarget, created: p.createdTick };
  }
  /* the real predecessor chain of a phone for a packet, and the graph-shortest relay path from the origin */
  function chainOf(pid, id) { const s = S(), out = []; let c = id, g = 0; while (c && s.inbox[c][pid] && g++ < 200) { out.unshift(c); c = s.inbox[c][pid].via; } return out; }
  function pathAudit(pid, origin) {
    const s = S(), D = bfs(origin, M.canRelay), rows = [];
    M.holders(pid).filter(id => id !== origin && M.canRelay(id)).forEach(id => { const ch = chainOf(pid, id), hops = ch.length - 1; rows.push({ id, hops, shortest: D[id], extra: hops - D[id], chain: ch }); });
    return rows;
  }
  /* ---------- synthetic networks (isolate named phones with exactly the links given; everything else is silent) ---------- */
  function synth(spec) {
    M.reset(); const s = S(); s.opts.userNode = null;
    s.order.forEach(id => { s.adj[id] = []; s.nodes[id].hasApp = false; }); s.edges.length = 0;
    Object.keys(spec.nodes).forEach(id => { const n = spec.nodes[id]; s.nodes[id].hasApp = n.relay !== false; M.setHood(id, n.hood); });
    spec.edges.forEach(([a, b]) => { s.adj[a].push(b); s.adj[b].push(a); s.edges.push({ from: a, to: b, enabled: true, kind: 'test' }); });
    return s;
  }
  /* ---------- per-step audit of the engine against its own contract ---------- */
  function auditRun(origin, target, o) {
    o = o || {}; const s = S(), viol = [], R = M.ROUTE, r = newMissing(origin, target, o), pid = r.packetId, p = s.packets[pid], steps = [];
    let lastMove = s.tick, i = 0, finalAt = null;   /* finalAt: the minute the engine first said "cannot move, not waiting" since the last hand-off */
    for (; i < (o.max || 400); i++) {
      if (M.isExpired(p)) break;
      const st = M.stats(pid); if (!st.canMove && !st.waiting && s.tick - lastMove > R.patience + 2) break;
      const before = {}; M.holders(pid).forEach(id => { if (M.canRelay(id)) before[id] = M.classify(id, pid); });
      const t0 = s.tick, hadMove = M.stats(pid).canMove; M.step();
      const hops = s.lastHops.filter(h => h.packetId === pid); if (hops.length) lastMove = s.tick;
      if (!st.canMove && !st.waiting && finalAt === null) finalAt = t0;
      if (hops.length) { if (finalAt !== null && finalAt < t0) viol.push('t' + t0 + ': the engine said "cannot move, not waiting" at minute ' + finalAt + ', then handed it on at minute ' + t0 + ' with nothing else changing'); finalAt = null; }
      /* a packet that reports "cannot move, not waiting" must not move; one that reports waiting must not move before its announced minute and must at it */
      if (!st.canMove && !st.waiting && hops.length) viol.push('t' + t0 + ': stopped (not waiting) but ' + hops.length + ' hand-offs happened');
      if (!st.canMove && st.waiting) { if (t0 < st.wakeTick && hops.length) viol.push('t' + t0 + ': waiting until ' + st.wakeTick + ' but moved early'); if (t0 === st.wakeTick && !hops.length) viol.push('t' + t0 + ': announced a detour for this minute that did not happen'); }
      if (st.canMove && !hops.length) viol.push('t' + t0 + ': canMove but nothing moved');
      hops.forEach(h => {
        const c = before[h.from], row = c && c.rows.filter(x => x.d === h.to)[0];
        if (s.adj[h.from].indexOf(h.to) < 0) viol.push('t' + t0 + ': ' + h.from + '>' + h.to + ' is not an encounter link');
        if (!M.canRelay(h.from) || !M.canRelay(h.to)) viol.push('t' + t0 + ': ' + h.from + '>' + h.to + ' involves a phone without Relay');
        if (!row || !row.sel) viol.push('t' + t0 + ': ' + h.from + '>' + h.to + ' was not selected by the engine plan');
        else if (row.det) {
          const ok = c.mode === 'detour' || (c.mode === 'waited' && t0 - c.heldSince >= R.patience);
          if (!ok) viol.push('t' + t0 + ': detour ' + h.from + '>' + h.to + ' from a phone in mode ' + c.mode);
          if (c.mode === 'waited' && c.forward && c.forwardHolding !== c.forward) viol.push('t' + t0 + ': detour while a closer neighbour still lacked it');
        } else if (!(row.code === 'closer' || row.code === 'equal' || row.code === 'same-area' || row.code === 'flood' || row.code === 'opportunistic')) viol.push('t' + t0 + ': odd forward code ' + row.code);
      });
      steps.push({ tick: s.tick, hops });
    }
    const maxHops = p.route.maxHops, bad = [];
    s.order.forEach(id => { const e = s.inbox[id][pid]; if (!e) return;
      if (e.hops > maxHops) bad.push(id + ' hops ' + e.hops); if (e.detours > p.route.detourMax + R.patientExtra) bad.push(id + ' detours ' + e.detours);
      const ob = s.outbox[id][pid]; if (ob && p.route.fanout && ob.good > p.route.fanout) bad.push(id + ' sent ' + ob.good + ' preferred copies'); if (ob && (ob.dets || 0) > R.detourFanout) bad.push(id + ' sent ' + ob.dets + ' detour copies'); });
    bad.forEach(b => viol.push('budget: ' + b));
    return { pid, viol, steps, ticks: s.tick, summary: summary(pid, origin, target) };
  }
  return { synth, auditRun, M, X, S, K, HOODS, num, dxy, bfs, relayDist, graphDist, clusterPairs, newMissing, run, summary, chainOf, pathAudit, hoodDistOf };
};
