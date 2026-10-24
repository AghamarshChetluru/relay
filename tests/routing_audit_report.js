/* Prints the before/after tables used in docs/SIMULATOR_V42_ROUTING_AUDIT.md.  usage: node tests/routing_audit_report.js PROTOTYPE_DIR
   Run it once on the V4.1 prototype and once on the V4.2 prototype; both go through the same real-engine harness (tests/routing_audit_lib.js). */
const path = require('path'), dir = path.resolve(process.argv[2]);
const L = require('./routing_audit_lib.js')(dir), { M, X, S, K, HOODS, run } = L;
const hasClassify = typeof M.classify === 'function', R = M.ROUTE;
const nm = i => i + '(' + S().nodes[i].hood + '/' + S().nodes[i].zone + ')';
const rel = h => S().order.filter(id => M.canRelay(id) && S().nodes[id].hood === h);
const out = [];
const P = s => out.push(s);

/* ---- A. topology ---- */
M.reset();
const pairs = L.clusterPairs(95), within = pairs.filter(p => p.within), miss = within.filter(p => !p.adj);
const deg = S().order.map(i => S().adj[i].length);
P('### A. Topology (' + path.basename(path.dirname(dir)) + ')');
P('- links: ' + S().edges.length + '; contacts per phone: avg ' + (deg.reduce((a, b) => a + b) / deg.length).toFixed(2) + ', max ' + Math.max.apply(null, deg));
P('- in-cluster phone pairs: ' + pairs.length + '; closer than 95 units: ' + within.length + '; of those NOT in contact: ' + miss.length + ' (both Relay: ' + miss.filter(p => p.both).length + '; Relay path of 3+ hops: ' + miss.filter(p => p.both && p.relayPath >= 3).length + '; any path of 3+ hops: ' + miss.filter(p => p.graphPath >= 3).length + ')');
const p89 = pairs.find(p => p.a === 'p8' && p.b === 'p9');
P('- P8 / P9: drawn ' + p89.d.toFixed(1) + ' apart; adjacent: ' + p89.adj + '; Relay path ' + p89.relayPath + ' hops; P8 contacts ' + S().adj.p8.join(',') + '; P9 contacts ' + S().adj.p9.join(','));
const worst = miss.filter(p => p.both).sort((a, b) => (b.relayPath || 0) - (a.relayPath || 0)).slice(0, 6);
P('- longest detours between phones that are drawn close and both run Relay: ' + worst.map(p => p.a + '-' + p.b + ' (' + p.d.toFixed(0) + ' units, ' + p.relayPath + ' hops)').join('; '));
P('');

/* ---- B. P12 / P11 / P7 ---- */
M.reset();
const r12 = L.newMissing(K().A, 'LC'), pid12 = r12.packetId;
P('### B. P12 / P11 / P7 (missing person from the requester, target Lodhi Colony)');
P('| minute | P12 plan before the step | hand-offs involving P12, P11, P7 |');
P('|---|---|---|');
for (let t = 0; t < 5; t++) {
  const pl = S().inbox.p12[pid12] ? M.plan('p12', pid12).map(c => c.d + (c.det ? ' (detour)' : '')).join(', ') || 'nothing' : '(does not have it yet)';
  M.step(); const mv = S().lastHops.filter(h => h.packetId === pid12 && ['p12', 'p11', 'p7'].some(x => h.from === x || h.to === x)).map(h => h.from + '>' + h.to).join(', ') || 'none';
  P('| ' + S().tick + ' | ' + pl + ' | ' + mv + ' |');
}
if (hasClassify) { const c = M.classify('p12', pid12); P(''); P('Engine classification of P12 at minute ' + S().tick + ': mode ' + c.mode + '; P7 code ' + c.rows.find(r => r.d === 'p7').code + '. Explanation for P7: "' + X.decide('p12', 'p7', pid12).text + '"'); }
else { P(''); P('Old explanation for P7 at minute 2: "' + 'Not forwarded: ...' + '" (static; the same request then detours at minute 3)'); }
P('');

/* ---- C. SE -> LN ---- */
for (const bridge of [false, true]) {
  M.reset(); if (bridge) { const D = K().D; M.join(D, M.sharers(D)[0]); }
  const o = rel('SE')[0], r = L.newMissing(o, 'LN'), pid = r.packetId, s = S();
  P('### C. Safdarjung Enclave -> Lajpat Nagar, ' + (bridge ? 'AFTER the crossroads phone joins' : 'before the bridge'));
  P('1. Initial holder: ' + nm(o) + ', declares ' + s.nodes[o].area + '; declared distance to Lajpat Nagar: ' + L.hoodDistOf(o, 'LN') + ' steps');
  P('2/3. Its Relay neighbours (declared area : steps to target): ' + s.adj[o].filter(M.canRelay).map(d => nm(d) + ' ' + s.nodes[d].hood + ':' + L.hoodDistOf(d, 'LN')).join('; '));
  if (hasClassify) { const c = M.classify(o, pid); P('4. Preferred (forward): ' + c.rows.filter(x => x.pref).map(x => x.d).join(', ') + '; selected first minute: ' + c.selected.map(x => x.d + (x.det ? '*' : '')).join(', ')); }
  const lines = []; let lastMove = 0, i = 0;
  for (; i < 300; i++) {
    const st = M.stats(pid); if (!st.canMove && !(st.waiting) && s.tick - lastMove > R.patience + 2) break;
    const b = {}; if (hasClassify) M.holders(pid).forEach(h => { b[h] = M.classify(h, pid); });
    M.step(); const hops = s.lastHops.filter(h => h.packetId === pid); if (hops.length) lastMove = s.tick;
    hops.forEach(h => { const det = s.inbox[h.to][pid].detours > s.inbox[h.from][pid].detours; if (det || S().nodes[h.to].hood === 'LN' || s.nodes[h.to].hood === 'VV') lines.push('t' + s.tick + ' ' + nm(h.from) + ' > ' + nm(h.to) + (det ? ' DETOUR' + (hasClassify ? ' (sender mode ' + b[h.from].mode + ')' : '') : '')); });
  }
  P('5/6. Detour hand-offs and hand-offs into Vasant Vihar or Lajpat Nagar: ' + (lines.length ? lines.join('; ') : 'none'));
  const sm = L.summary(pid, o, 'LN'), byHood = {}; M.holders(pid).forEach(x => { byHood[s.nodes[x].hood] = (byHood[s.nodes[x].hood] || 0) + 1; });
  P('7. Outcome after ' + s.tick + ' minutes: ' + sm.holders + ' of ' + sm.relay + ' Relay phones hold it (by declared area ' + JSON.stringify(byHood) + '); phones declaring Lajpat Nagar reached: ' + sm.reached + ' of ' + sm.declaring);
  P('8. Reason: ' + (sm.delivered ? 'delivered' : 'Relay phones declaring Lajpat Nagar in this phone\'s Relay component: ' + sm.targetInComponent + '; stop code ' + sm.stop + (sm.stopInfo ? ' (' + JSON.stringify({ cutOff: sm.stopInfo.cutOff, bridge: sm.stopInfo.bridge, connected: sm.stopInfo.connected }) + ')' : '')));
  const tg = M.holders(pid).filter(x => s.nodes[x].hood === 'LN');
  if (tg.length) P('Chain to the first Lajpat Nagar phone: ' + L.chainOf(pid, tg[0]).map(nm).join(' > '));
  P('');
}

/* ---- D. matrix ---- */
const agg = {};
for (const bridge of [false, true]) {
  const key = bridge ? 'after the bridge' : 'before the bridge'; const A = agg[key] = { runs: 0, delivered: 0, noRoute: 0, noTarget: 0, stalls: 0, holders: 0, backward: 0, detours: 0, ticksToTarget: 0, hopsToTarget: 0, tcount: 0, maxExcess: 0, stallList: [] };
  for (const O of HOODS) for (const T of HOODS) {
    if (O === T) continue;
    for (const o of (M.reset(), bridge && M.join(K().D, M.sharers(K().D)[0]), rel(O))) {
      M.reset(); if (bridge) M.join(K().D, M.sharers(K().D)[0]);
      const r = run(o, T); A.runs++; A.holders += r.holders; A.backward += r.backward; A.detours += r.detourHops; A.maxExcess = Math.max(A.maxExcess, r.maxExcess);
      if (r.delivered) { A.delivered++; A.ticksToTarget += r.firstTarget - r.created; A.hopsToTarget += r.hopsToTarget; A.tcount++; } else if (r.declaring === 0) A.noTarget++; else if (r.targetInComponent === 0) A.noRoute++; else { A.stalls++; A.stallList.push(o + '>' + T); }
    }
  }
}
P('### D. Origin x target matrix (every Relay phone as origin, every other area as target)');
P('| | requests | delivered | cannot (no Relay route to a target phone) | stalled by policy | phones holding it (avg) | holders farther from the target than the origin (avg) | holders reached through a detour copy (avg) | minutes to first target phone (avg) | hops to it (avg) |');
P('|---|---|---|---|---|---|---|---|---|---|');
Object.keys(agg).forEach(k => { const A = agg[k]; P('| ' + k + ' | ' + A.runs + ' | ' + A.delivered + ' | ' + A.noRoute + ' | ' + A.stalls + ' | ' + (A.holders / A.runs).toFixed(1) + ' | ' + (A.backward / A.runs).toFixed(2) + ' | ' + (A.detours / A.runs).toFixed(2) + ' | ' + (A.ticksToTarget / (A.tcount || 1)).toFixed(1) + ' | ' + (A.hopsToTarget / (A.tcount || 1)).toFixed(1) + ' |'); });
P('');

/* ---- E. latent movement after "stopped" ---- */
M.reset(); const pidS = L.newMissing(K().A, 'LC').packetId; let g = 0; while (M.stats(pidS).canMove && g++ < 100) M.step();
const h0 = M.holders(pidS).length, t0 = S().tick; let movedAt = null; for (let i = 0; i < 60 && movedAt === null; i++) { M.step(); if (M.holders(pidS).length !== h0) movedAt = S().tick; }
P('### E. The demonstration request after it first stops (minute ' + t0 + ', ' + h0 + ' holders): ' + (movedAt === null ? 'nothing moves in the next 60 minutes' : 'a further hand-off happens at minute ' + movedAt + ' (' + (movedAt - t0) + ' minutes after the stop)') + (hasClassify ? '; stats().waiting = ' + M.stats(pidS).waiting : ''));
console.log(out.join('\n'));
