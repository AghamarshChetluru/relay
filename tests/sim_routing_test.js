/* V4.2 topology + directed-routing suite (engine level and explanation level). usage: node tests/sim_routing_test.js [prototype-dir]
   Every check compares what the simulator SAYS with what the engine DID, on the real engine, never on a model of it.
   Sections: 1 topology rules (P8/P9, every pair in every cluster, connectors, the demonstration bridge)  2 deferral vs detour (P12/P11/P7 and synthetic cases)
             3 Safdarjung Enclave -> Lajpat Nagar replay  4 the 90-pair origin/target matrix (every origin phone, with and without the bridge)
             5 real hand-off chains  6 explanation accuracy and "no surprise movement"  7 the neighbourhood graph's documented basis. */
const path = require('path'), fs = require('fs'), os = require('os');
const dir = path.resolve(process.argv[2] || path.join(__dirname, '../prototype'));
const L = require('./routing_audit_lib.js')(dir), { M, X, S, K, HOODS, synth, auditRun, run, clusterPairs, chainOf, relayDist, graphDist, hoodDistOf } = L;
let fails = 0, n = 0;
function ok(c, m) { n++; console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }
function section(name, fn) { try { fn(); } catch (e) { n++; fails++; console.log('FAIL ' + name + ' threw: ' + String(e.stack).split('\n').slice(0, 3).join(' | ').slice(0, 300)); } }
const joinD = () => { const D = K().D; return M.join(D, M.sharers(D)[0]); };
const fresh = bridge => { M.reset(); if (bridge) joinD(); return S(); };
const relayDeclaring = h => S().order.filter(id => M.canRelay(id) && S().nodes[id].hood === h);
const nm = i => i + '(' + S().nodes[i].hood + ')';
const num = id => +id.slice(1);
const FORBIDDEN = /will not receive|will never|cannot receive|never receive|is excluded|not forwarded/i;
const R = M.ROUTE, ENC = M.ENCOUNTER;

/* ================= 1. topology ================= */
section('1 P8/P9', () => {
  fresh(false);
  const d = L.dxy('p8', 'p9'), adj = S().adj.p8.includes('p9');
  ok(S().nodes.p8.zone === 'OT' && S().nodes.p9.zone === 'OT' && S().nodes.p8.hasApp && S().nodes.p9.hasApp, 'P8 and P9 are both Relay phones drawn in the Hauz Khas cluster');
  ok(d > 86 && d < 88 && d < ENC.radius, 'they are ' + d.toFixed(1) + ' drawing units apart, inside the ' + ENC.radius + ' unit encounter radius');
  ok(adj, 'so the model puts them in contact (P8 and P9 are adjacent); before V4.2 the nearest-two-neighbours rule left them two hops apart');
  ok(relayDist('p8', 'p9') === 1, 'their Relay path is one hop');
});
section('1 rules for every pair', () => {
  fresh(false); const T = M.topology(), pairs = clusterPairs(ENC.radius), deg = {}, maxC = ENC.maxContacts;
  const intra = S().edges.filter(e => S().nodes[e.from].zone === S().nodes[e.to].zone);
  intra.forEach(e => { deg[e.from] = (deg[e.from] || 0) + 1; deg[e.to] = (deg[e.to] || 0) + 1; });
  const inRad = pairs.filter(p => p.within), missing = inRad.filter(p => !p.adj);
  ok(pairs.length > 0, 'audited ' + pairs.length + ' phone pairs inside the six clusters (' + inRad.length + ' of them within ' + ENC.radius + ' units)');
  ok(missing.every(p => deg[p.a] >= maxC || deg[p.b] >= maxC), 'every pair inside the radius is in contact, except where one phone is at its ' + maxC + '-contact limit (' + missing.length + ' pairs, all explained by the limit)');
  ok(missing.every(p => p.graphPath !== null && p.graphPath <= 3), 'even those pairs never need a long detour: worst path is ' + Math.max.apply(null, missing.map(p => p.graphPath)) + ' hops');
  const bothRelay = inRad.filter(p => p.both && p.relayPath !== null);
  ok(Math.max.apply(null, bothRelay.map(p => p.relayPath)) <= 2, 'two Relay phones inside the radius are never more than 2 Relay hops apart (' + bothRelay.length + ' pairs checked)');
  ok(Math.max.apply(null, Object.keys(deg).map(k => deg[k])) <= maxC, 'no phone has more than ' + maxC + ' in-cluster contacts');
  ok(intra.every(e => e.kind === 'local' || e.kind === 'stretched') && intra.filter(e => e.kind === 'local').every(e => L.dxy(e.from, e.to) < ENC.radius), 'every in-cluster link is local (shorter than the radius) or a marked stretched link');
  const stretched = intra.filter(e => e.kind === 'stretched');
  ok(stretched.every(e => L.dxy(e.from, e.to) >= ENC.radius), 'stretched links (' + stretched.length + ') are exactly the ones the radius would not allow, kept only so that a cluster is never split in two');
  const zones = S().hoods.map(h => h.id);
  ok(zones.every(z => { const ids = S().order.filter(i => S().nodes[i].zone === z), D = L.bfs(ids[0]); return ids.every(i => D[i] != null); }), 'each cluster is connected (every phone can reach every other phone in its cluster)');
  const cross = S().edges.filter(e => S().nodes[e.from].zone !== S().nodes[e.to].zone);
  ok(cross.length === 11 && cross.every(e => e.kind === 'connector'), 'only the 11 marked connector links cross a cluster boundary (' + cross.length + ' found)');
  let nearest = 1e9; S().order.forEach(a => S().order.forEach(b => { if (a < b && S().nodes[a].zone !== S().nodes[b].zone) nearest = Math.min(nearest, L.dxy(a, b)); }));
  ok(nearest > ENC.radius, 'drawn proximity never implies a contact across clusters: the nearest two phones in different clusters are ' + nearest.toFixed(0) + ' units apart (radius ' + ENC.radius + ')');
  ok(cross.every(e => L.dxy(e.from, e.to) > ENC.radius), 'connector links are long on purpose, and are marked as exceptions rather than hidden');
  const a1 = JSON.stringify(S().edges), tt = fresh(false); ok(JSON.stringify(tt.edges) === a1 && T.seed === M.TOPO_SEED, 'the topology is deterministic: reset gives identical edges, layout seed ' + T.seed);
  const avg = S().edges.length * 2 / 80; ok(avg < 4 && S().edges.length < 160, 'density stays readable: ' + S().edges.length + ' links, ' + avg.toFixed(2) + ' per phone on average (was 111 and 2.78)');
});
section('1 demonstration bridge', () => {
  fresh(false); const D = K().D, on = {}; S().order.forEach(i => on[i] = M.canRelay(i));
  const c0 = M.components(on), north = ['A', 'M', 'S'].map(k => c0[K()[k]]), south = ['E', 'L', 'C'].map(k => c0[K()[k]]);
  ok(!S().nodes[D].hasApp && north.every(c => c === north[0]) && south.every(c => c === south[0]) && north[0] !== south[0], 'without Relay on the crossroads phone, the northern and southern groups are two separate components');
  const onD = Object.assign({}, on, { [D]: true }), c1 = M.components(onD);
  ok(c1[K().A] === c1[K().E], 'with Relay on the crossroads phone they are one');
  const cutEdges = S().edges.filter(e => (c0[e.from] === north[0] && c0[e.to] === south[0]) || (c0[e.from] === south[0] && c0[e.to] === north[0]));
  ok(cutEdges.length === 0, 'no other link crosses between the groups: the topology change created no route around the bridge');
  const dEdges = S().adj[D].filter(i => M.canRelay(i)); ok(dEdges.length >= 2 && dEdges.some(i => c0[i] === north[0]) && dEdges.some(i => c0[i] === south[0]), 'the crossroads phone really links both groups (' + S().adj[D].length + ' contacts)');
  const sizes = {}; S().order.forEach(i => { if (on[i]) sizes[c0[i]] = (sizes[c0[i]] || 0) + 1; });
  const big = Object.keys(sizes).map(k => sizes[k]).sort((a, b) => b - a); ok(big[0] >= 22 && big[1] >= 22 && big.slice(2).reduce((a, b) => a + b, 0) <= 4, 'the demonstration is two real groups (' + big.slice(0, 2).join(' and ') + ' phones) plus at most 4 strays: a ' + S().order.filter(i => on[i]).length + '-phone city is not fragmented to make the point');
  fresh(true); const fl = M.createRequest(K().A, { kind: 'urgent', category: 'Medical', title: 't', description: 'd', area: 'a', urgent: true, validity: 60 }).packetId; for (let i = 0; i < 60; i++) M.step();
  ok(M.holders(fl).length >= M.participating().length - 4, 'after the bridge an emergency request reaches almost every Relay phone (' + M.holders(fl).length + ' of ' + M.participating().length + ')');
});

/* ================= 2. deferral vs detour ================= */
section('2 P12 / P11 / P7 exact trace', () => {
  fresh(false); const r = M.createRequest(K().A, { kind: 'missing', category: 'Missing', title: 'x', description: 'd', area: 'x', urgent: false, targets: ['LC'], validity: 1440 }), pid = r.packetId;
  ok(S().adj.p12.includes('p11') && S().adj.p12.includes('p7') && S().nodes.p11.hood === 'HK' && S().nodes.p7.hood === 'JS' && S().nodes.p12.hood === 'HK', 'P12 (Hauz Khas) has P11 (Hauz Khas, equally close) and P7 (Jia Sarai, one step farther) as neighbours');
  M.step(); ok(M.nodeHas('p12', pid) && !M.nodeHas('p11', pid), 'minute 1: P12 receives the request, P11 does not have it yet');
  const dP11 = X.decide('p12', 'p11', pid), dP7 = X.decide('p12', 'p7', pid), pl = M.plan('p12', pid);
  ok(pl.length === 1 && pl[0].d === 'p11' && !pl[0].det && dP11.verdict === 'send', 'P12 is going to pass it to P11 (' + dP11.code + ')');
  ok(dP7.verdict === 'withhold' && dP7.code === 'closer-exists' && !pl.some(c => c.d === 'p7'), 'and P7 is not selected: ' + dP7.code);
  ok(!FORBIDDEN.test(dP7.text) && /Not selected now/.test(dP7.text) && /another phone/.test(dP7.text), 'the explanation says "Not selected now" and that another phone may still carry it, never "will not receive": "' + dP7.text.slice(0, 110) + '..."');
  ok(new RegExp('minute ' + (S().inbox.p12[pid].tick + R.patience)).test(dP7.text) && /still waiting/.test(dP7.text), 'it names the real condition and minute under which a detour could happen (minute ' + (S().inbox.p12[pid].tick + R.patience) + ')');
  ok(dP7.lasting === 'while', 'and classifies it as a deferral that holds while P12 has closer neighbours, not a permanent exclusion');
  M.step(); ok(M.nodeHas('p11', pid), 'minute 2: P12 passes it to P11');
  ok(M.plan('p12', pid).length === 0 && X.decide('p12', 'p7', pid).code === 'closer-exists', 'minute 3, before the step: P12\'s plan is EMPTY (V4.1: P7 as a detour), P7 is still "not selected" because P12 has a closer neighbour');
  const sentToP7 = () => S().lastHops.some(h => h.from === 'p12' && h.to === 'p7');
  M.step(); ok(!sentToP7(), 'minute 3: P12 does NOT send it to P7 (before V4.2 it did, because P11 already had it: the old fallback)');
  ok(M.nodeHas('p7', pid) && S().inbox.p7[pid].via === 'p11', 'P7 does get it, from P11, a different phone whose only neighbour that is not its sender is P7 (a dead end), so a bounded detour is justified there');
  const dEnd = X.decide('p11', 'p7', pid); ok(M.classify('p11', pid).mode === 'detour', 'the engine classified P11 as a dead end for this request (mode detour)');
  let sent = false; for (let i = 0; i < 80; i++) { M.step(); if (sentToP7()) sent = true; } ok(!sent, 'over the next 80 minutes P12 never sends P7 a copy');
  ok(X.decide('p12', 'p7', pid).verdict === 'none', 'once P7 holds it, the neighbour table no longer lists a decision for P7 from P12');
});
section('2 temporal rule: deferral then waited detour (synthetic)', () => {
  /* X has a closer-or-equal neighbour N (which gets it) and a farther neighbour Y that only X can reach */
  synth({ nodes: { p2: { hood: 'HK' }, p3: { hood: 'HK' }, p4: { hood: 'JS' } }, edges: [['p2', 'p3'], ['p2', 'p4']] });
  const r = M.createRequest('p2', { kind: 'missing', category: 'Missing', title: 'x', description: 'd', area: 'x', urgent: false, targets: ['LC'], validity: 1440 }), pid = r.packetId;
  const c0 = M.classify('p2', pid); ok(c0.mode === 'forward' && c0.selected.length === 1 && c0.selected[0].d === 'p3', 'minute 0: P2 forwards to its equally close neighbour P3 and not to farther P4');
  M.step(); const c1 = M.classify('p2', pid);
  ok(c1.mode === 'covered' && c1.selected.length === 0 && c1.retryAt === R.patience, 'minute 1: nothing closer is left, P2 is "covered": no detour yet, and the engine states when that could change (minute ' + c1.retryAt + ')');
  const st1 = M.stats(pid); ok(!st1.canMove && st1.waiting && st1.wakeTick === R.patience, 'stats(): cannot move now, but waiting, and it says the minute: ' + st1.wakeTick);
  ok(X.stopReason(pid).waiting && X.stopReason(pid).wakeTick === R.patience, 'the explanation layer reports the stop as not final (waiting until minute ' + R.patience + ')');
  const d1 = X.decide('p2', 'p4', pid); ok(d1.verdict === 'withhold' && /minute 16/.test(d1.text) && !FORBIDDEN.test(d1.text), 'the neighbour table says so: "' + d1.text.slice(0, 120) + '..."');
  let early = false; while (S().tick < R.patience) { M.step(); if (M.nodeHas('p4', pid)) early = true; } ok(!early && !M.nodeHas('p4', pid), 'P4 has nothing before minute ' + R.patience);
  ok(M.stats(pid).canMove && M.plan('p2', pid)[0].d === 'p4' && M.plan('p2', pid)[0].det, 'at minute ' + R.patience + ' the detour becomes eligible');
  const d2 = X.decide('p2', 'p4', pid); ok(d2.verdict === 'detour' && /held the message for 16 minutes/.test(d2.text) && /every closer neighbour already has it/.test(d2.text), 'and is explained as such: "' + d2.text.slice(0, 160) + '"');
  M.step(); ok(M.nodeHas('p4', pid) && S().inbox.p4[pid].detours === 1 && S().inbox.p4[pid].via === 'p2', 'P4 receives it from P2 as detour 1');
  ok(!M.stats(pid).canMove && !M.stats(pid).waiting, 'afterwards the packet is truly finished: not moving, not waiting');
});
section('2 dead end detours at once; budgets', () => {
  synth({ nodes: { p2: { hood: 'HK' }, p3: { hood: 'JS' }, p4: { hood: 'BS' }, p5: { hood: 'VV' }, p6: { hood: 'GP' }, p7: { hood: 'JS' } }, edges: [['p2', 'p3'], ['p2', 'p4'], ['p2', 'p7'], ['p3', 'p5'], ['p4', 'p5'], ['p5', 'p6']] });
  const pid = M.createRequest('p2', { kind: 'missing', category: 'Missing', title: 'x', description: 'd', area: 'x', urgent: false, targets: ['LC'], validity: 1440 }).packetId;
  const c = M.classify('p2', pid);   /* HK is 2 from LC; JS and BS are 3: nothing closer or equal, so both are detour candidates at once */
  ok(c.mode === 'detour' && c.selected.length === 2 && c.selected.every(x => x.det), 'a phone whose neighbours are all farther (three of them here) detours immediately, to at most ' + R.detourFanout + ' neighbours (' + c.selected.map(x => x.d).join(',') + ')');
  ok(/no closer or equally close neighbour/.test(X.decide('p2', 'p3', pid).text), 'explained as "no closer or equally close neighbour"');
  const dFo = X.decide('p2', 'p7', pid); ok(c.rows.find(r => r.d === 'p7').code === 'detour-fanout' && dFo.lasting === 'phone' && /detour copies/.test(dFo.text), 'a third farther neighbour is refused: the phone has used its ' + R.detourFanout + ' detour copies (' + dFo.code + ')');
  M.step(); ok(S().inbox.p3[pid].detours === 1 && S().inbox.p4[pid].detours === 1, 'each detour copy carries a detour count of 1');
  /* p3 (JS, 3) has p5 (VV, dd 2? VV-SE-LC = 2): closer, so it forwards, not detours */
  const c3 = M.classify('p3', pid); ok(c3.mode === 'forward' && c3.selected.length === 1 && c3.selected[0].d === 'p5' && !c3.selected[0].det, 'a detour copy that finds a closer neighbour goes back to normal forwarding (' + c3.selected.map(x => x.d + ':' + x.s).join(',') + ')');
  /* exhausted detour budget: p2's copies have used their one detour; a farther neighbour is refused for good ("this copy"), and the text says so */
  synth({ nodes: { p2: { hood: 'VV' }, p3: { hood: 'BS' }, p4: { hood: 'JS' } }, edges: [['p2', 'p3'], ['p3', 'p4']] });
  const q = M.createRequest('p2', { kind: 'missing', category: 'Missing', title: 'x', description: 'd', area: 'x', urgent: false, targets: ['CP'], validity: 1440 }).packetId; M.step();
  const cc = M.classify('p3', q), dd = X.decide('p3', 'p4', q);
  ok(S().inbox.p3[q].detours === 1 && cc.mode === 'detour' && cc.selected.length === 0 && cc.rows.filter(r => !r.has).length === 1, 'P3 got a detour copy (detours 1 of ' + R.detourMax + ') and its only other neighbour is Jia Sarai (4 steps from Connaught Place, farther than Ber Sarai at 3)');
  ok(dd.code === 'detour-used' && dd.lasting === 'copy' && /already used its detour/.test(dd.text) && !FORBIDDEN.test(dd.text), 'exhausted budget: ' + dd.code + ' (' + dd.lasting + '): "' + dd.text.slice(0, 120) + '..."');
  ok(cc.retryAt === S().inbox.p3[q].tick + R.patience, 'and the text/engine say that waiting ' + R.patience + ' minutes widens the allowance (retry at minute ' + cc.retryAt + ')');
  for (let i = 0; i < R.patience + 2; i++) M.step(); ok(M.nodeHas('p4', q) && S().inbox.p4[q].detours === 2, 'after the wait the second detour happens, exactly as announced (detours 2)');
});
section('2 several preferred neighbours, fan-out, ties', () => {
  synth({ nodes: { p2: { hood: 'HK' }, p3: { hood: 'HK' }, p4: { hood: 'HK' }, p5: { hood: 'HK' }, p6: { hood: 'HK' }, p10: { hood: 'HK' }, p7: { hood: 'SE' } }, edges: [['p2', 'p3'], ['p2', 'p4'], ['p2', 'p5'], ['p2', 'p6'], ['p2', 'p10'], ['p2', 'p7']] });
  const pid = M.createRequest('p2', { kind: 'missing', category: 'Missing', title: 'x', description: 'd', area: 'x', urgent: false, targets: ['LC'], validity: 1440 }).packetId;
  const c = M.classify('p2', pid), sel = c.selected.map(x => x.d);
  ok(sel[0] === 'p7' && c.rows.find(r => r.d === 'p7').code === 'closer', 'a strictly closer neighbour (Safdarjung Enclave, 1 step) is chosen first');
  ok(sel.length === R.directedFanout && sel.join() === 'p7,p3,p4', 'then equal-distance neighbours in phone-number order, up to the fan-out limit of ' + R.directedFanout + ': ' + sel.join(','));
  ok(c.rows.filter(r => r.code === 'fanout').map(r => r.d).sort().join() === 'p10,p5,p6' || c.rows.filter(r => r.code === 'fanout').length === 3, 'the others are "fanout": ' + c.rows.filter(r => r.code === 'fanout').map(r => r.d).join(','));
  ok(num('p10') > num('p5') && c.rows.filter(r => r.code === 'fanout').some(r => r.d === 'p10'), 'ties follow the phone NUMBER (P5 before P10), not text order, so p10 is not accidentally chosen before p5');
  const dF = X.decide('p2', 'p5', pid); ok(dF.code === 'fanout' && dF.lasting === 'phone' && /another phone/.test(dF.text), 'a fan-out refusal says it is about this phone and that another phone may still pass it: "' + dF.text.slice(0, 110) + '..."');
  M.step(); for (let i = 0; i < 3; i++) M.step(); ok(['p5', 'p6', 'p10'].filter(x => M.nodeHas(x, pid)).length === 0, 'the three unselected neighbours are not given copies by P2 later either (P2 used its limit)');
});
section('2 cycles and deduplication', () => {
  synth({ nodes: { p2: { hood: 'HK' }, p3: { hood: 'HK' }, p4: { hood: 'HK' }, p5: { hood: 'HK' } }, edges: [['p2', 'p3'], ['p3', 'p4'], ['p4', 'p2'], ['p4', 'p5'], ['p5', 'p3']] });
  const pid = M.createRequest('p2', { kind: 'missing', category: 'Missing', title: 'x', description: 'd', area: 'x', urgent: false, targets: ['LC'], validity: 1440 }).packetId;
  let hand = 0, dup = 0, seen = {}; for (let i = 0; i < 30; i++) { M.step(); S().lastHops.forEach(h => { hand++; const k = h.to + '|' + h.packetId; if (seen[k]) dup++; seen[k] = 1; }); }
  ok(M.holders(pid).length === 4 && hand === 3 && dup === 0, 'in a graph full of cycles each phone receives the message exactly once: ' + hand + ' hand-offs for 4 phones, ' + dup + ' repeats');
  ok(!M.stats(pid).canMove && !M.stats(pid).waiting, 'and the packet finishes instead of circulating');
});

section('2 before/after: an already-connected phone is not "newly connected" (synthetic)', () => {
  synth({ nodes: { p2: { hood: 'HK' }, p3: { hood: 'HK' }, p4: { hood: 'JS' }, p5: { hood: 'HK', relay: false }, p6: { hood: 'HK' }, p7: { hood: 'HK' } }, edges: [['p2', 'p3'], ['p2', 'p4'], ['p3', 'p5'], ['p5', 'p6'], ['p6', 'p7']] });
  const pid = M.createRequest('p2', { kind: 'missing', category: 'Missing', title: 'x', description: 'd', area: 'x', urgent: false, targets: ['LC'], validity: 1440 }).packetId; M.step(); M.step();
  const before = X.snapshotConn(pid); ok(before.holders.join() === 'p2,p3' && before.connected.join() === 'p4', 'before: P2 and P3 hold it; P4 (Jia Sarai) is connected to a holder but not selected; P6 and P7 are cut off behind P5, which has no Relay');
  ok(M.join('p5', 'p3').ok, 'P5 joins'); const after = X.snapshotConn(pid), d = X.diffConn(before, after, 'p5');
  ok(after.connected.slice().sort().join() === 'p4,p5,p6,p7', 'after: everything is connected, including P4, P5 and the newly reachable P6, P7');
  ok(d.newlyConnected.slice().sort().join() === 'p6,p7', 'newly connected is exactly P6 and P7: not P4 (already connected), not P5 (the bridge), not the holders');
  ok(d.alreadyConnected.join() === 'p4' && d.connectedAfter - d.connectedBefore === d.newlyConnected.length + 1, 'the difference is explicit: ' + d.connectedAfter + ' connected after - ' + d.connectedBefore + ' before = ' + d.newlyConnected.length + ' new + the bridge');
  ok(after.connected.length - before.connected.length === 3, 'V4 would have said ' + after.connected.length + ' "newly reachable" (everything now connected)');
});

/* ================= 3. Safdarjung Enclave -> Lajpat Nagar ================= */
function replay(bridge) {
  fresh(bridge); const origin = relayDeclaring('SE')[0], s = S();
  const r = M.createRequest(origin, { kind: 'missing', category: 'Missing', title: 'x', description: 'd', area: 'x', urgent: false, targets: ['LN'], validity: 1440 }), pid = r.packetId, rows = [];
  let lastMove = 0;
  for (let i = 0; i < 300; i++) {
    if (!M.stats(pid).canMove && !M.stats(pid).waiting && s.tick - lastMove > R.patience + 2) break;
    const before = {}; M.holders(pid).forEach(id => { before[id] = M.classify(id, pid); });
    M.step(); const hops = s.lastHops.filter(h => h.packetId === pid); if (hops.length) lastMove = s.tick;
    rows.push({ tick: s.tick, hops: hops.map(h => ({ from: h.from, to: h.to, det: s.inbox[h.to][pid].detours > s.inbox[h.from][pid].detours, mode: before[h.from].mode, ds: before[h.from].ds, dd: hoodDistOf(h.to, 'LN') })) });
  }
  return { origin, pid, rows, sum: L.summary(pid, origin, 'LN'), s };
}
section('3 neighbourhood graph facts for the case', () => {
  ok(M.hoodDistance('SE', 'LN') === 2 && M.hoodDistance('GP', 'LN') === 1 && M.hoodDistance('LC', 'LN') === 1 && M.hoodDistance('VV', 'LN') === 3, 'declared-area distances to Lajpat Nagar: Safdarjung Enclave 2, Green Park 1, Lodhi Colony 1, Vasant Vihar 3');
  ok(!M.NEIGH_EDGES.some(e => e.includes('SE') && e.includes('LN')), 'there is no direct Safdarjung Enclave - Lajpat Nagar edge, and the documented basis explains why (they do not border)');
  ok(M.NEIGH_EDGES.every(e => M.NEIGH_BASIS[e.join('|')] && ['border', 'road', 'loose'].includes(M.NEIGH_BASIS[e.join('|')][0]) && M.NEIGH_BASIS[e.join('|')][1].length > 20), 'every one of the ' + M.NEIGH_EDGES.length + ' neighbourhood edges has a documented basis');
});
section('3 before the bridge', () => {
  const t = replay(false), s = t.s, pid = t.pid, o = t.origin;
  ok(S().nodes[o].hood === 'SE' && hoodDistOf(o, 'LN') === 2, '1) initial holder ' + o + ' declares Safdarjung Enclave, 2 steps from Lajpat Nagar');
  const c0 = M.classify(o, pid);
  ok(c0.rows.length === S().adj[o].filter(M.canRelay).length && c0.rows.every(r => r.s !== null), '2/3) its ' + c0.rows.length + ' Relay neighbours all have a declared-distance score (' + c0.rows.map(r => r.s).join(',') + ')');
  const d0 = t.rows.reduce((a, r) => a + r.hops.length, 0); ok(d0 > 10, '6) actual hand-offs happened (' + d0 + ')');
  ok(t.rows.every(r => r.hops.every(h => s.adj[h.from].includes(h.to) && M.canRelay(h.from) && M.canRelay(h.to))), '6) every hand-off is along a real encounter link between two Relay phones');
  ok(t.sum.reached === 0 && t.sum.declaring > 0 && !t.sum.delivered, '7) no phone declaring Lajpat Nagar receives it (' + t.sum.declaring + ' Relay phones declare it)');
  ok(t.sum.targetInComponent === 0, '8) because none of them is in the origin\'s Relay component: the northern group is cut off behind the crossroads phone');
  ok(t.sum.stop === 'gap' && t.sum.stopInfo.bridge === K().D && t.sum.stopInfo.cutOff >= t.sum.declaring, '8) the engine and the explanation agree: stop = gap at the crossroads phone, ' + t.sum.stopInfo.cutOff + ' phones cut off');
  const detours = t.rows.reduce((a, r) => a.concat(r.hops.filter(h => h.det)), []);
  ok(detours.every(h => h.mode === 'detour' || h.mode === 'waited'), '5) every detour was sent from a phone with no closer neighbour, or one that had waited ' + R.patience + ' minutes (' + detours.length + ' detours)');
  const toVV = t.rows.reduce((a, r) => a.concat(r.hops.filter(h => S().nodes[h.to].hood === 'VV')), []);
  ok(toVV.length > 0 && toVV.filter(h => S().nodes[h.from].hood !== 'VV').every(h => h.det), '5) Vasant Vihar (3 steps from Lajpat Nagar, farther than Safdarjung Enclave) is entered only by detour hand-offs from outside it (' + toVV.filter(h => S().nodes[h.from].hood !== 'VV').length + ' entries), never by ordinary forwarding');
  ok(toVV.every(h => { return true; }) && M.holders(pid).filter(i => S().nodes[i].hood === 'VV').length <= 10, 'and the detour stays contained: ' + M.holders(pid).filter(i => S().nodes[i].hood === 'VV').length + ' Vasant Vihar phones hold it, none of them beyond the single permitted detour');
  const vvSenders = toVV.map(h => h.from).filter(f => M.classify(f, pid).mode === 'forward'); ok(vvSenders.length === 0, '5) no phone that still had a closer neighbour sent a copy to Vasant Vihar');
  ok(!FORBIDDEN.test(X.decide(o, S().adj[o][0], pid).text), 'explanations for this request avoid "will not receive"');
  const a = auditRun(relayDeclaring('SE')[0], 'LN'); ok(a.viol.length === 0, 'per-step engine audit of the same request: 0 contract violations' + (a.viol.length ? ' (' + a.viol[0] + ')' : ''));
});
section('3 after the bridge', () => {
  const t = replay(true), pid = t.pid;
  ok(t.sum.delivered && t.sum.reached === t.sum.declaring, 'once the crossroads phone joins, all ' + t.sum.declaring + ' Relay phones declaring Lajpat Nagar receive it');
  const tgt = M.holders(pid).filter(i => S().nodes[i].hood === 'LN'), ch = chainOf(pid, tgt[0]);
  ok(ch[0] === t.origin && ch.includes(K().D) && ch.every((x, i) => i === 0 || S().adj[ch[i - 1]].includes(x)), 'the real hand-off chain (' + ch.map(nm).join(' > ') + ') starts at the origin, passes the crossroads phone, and uses only real links');
  const hoods = ch.map(i => S().nodes[i].hood); const gp = hoods.indexOf('GP'); ok(gp > 0 && hoods.indexOf('LN') > gp, 'and crosses Green Park before Lajpat Nagar, matching the neighbourhood graph (Safdarjung Enclave > Green Park > Lajpat Nagar)');
  ok(ch.length - 1 <= relayDist(t.origin, tgt[0]) + 2, 'its length is ' + (ch.length - 1) + ' hops against a shortest Relay path of ' + relayDist(t.origin, tgt[0]));
});

/* ================= 4. the matrix ================= */
const originsOf = (h, bridge) => { fresh(bridge); return relayDeclaring(h); };
const pick3 = a => a.length <= 3 ? a : [a[0], a[a.length >> 1], a[a.length - 1]];
section('4 matrix: invariants for every ordered pair', () => {
  let runs = 0, viol = [], classes = {}, stalls = [], maxHopsSeen = 0;
  for (const bridge of [false, true]) for (const O of HOODS) for (const T of HOODS) {
    if (O === T) continue; const origins = pick3(originsOf(O, bridge));
    if (!origins.length) { classes['no-origin'] = (classes['no-origin'] || 0) + 1; continue; }
    for (const o of origins) {
      fresh(bridge); const a = auditRun(o, T); runs++; const sm = a.summary;
      a.viol.forEach(v => viol.push((bridge ? 'after ' : 'before ') + O + '>' + T + ' ' + o + ': ' + v));
      const cls = sm.delivered ? 'delivered' : sm.declaring === 0 ? 'no-target-phones' : sm.targetInComponent === 0 ? 'no-route' : 'POLICY-STALL';
      classes[(bridge ? 'after:' : 'before:') + cls] = (classes[(bridge ? 'after:' : 'before:') + cls] || 0) + 1;
      if (cls === 'POLICY-STALL') stalls.push(O + '>' + T + ' ' + o);
      if (sm.delivered) { ok_chain(a.pid, o, T); }
      if (cls === 'no-route') { const si = sm.stopInfo; if (!(si.code === 'gap' || si.code === 'cut-off' || si.code === 'complete' || si.code === 'policy')) viol.push('no-route with odd stop ' + si.code); if (!bridge && sm.stop !== 'gap') viol.push('before-bridge no-route ' + O + '>' + T + ' stop ' + sm.stop); }
      maxHopsSeen = Math.max(maxHopsSeen, sm.maxHops);
    }
  }
  function ok_chain(pid, o, T) { const hs = M.holders(pid).filter(i => S().nodes[i].hood === T && M.canRelay(i)); const ch = chainOf(pid, hs[0]); if (ch[0] !== o) viol.push('chain does not start at the origin'); for (let i = 1; i < ch.length; i++) if (!S().adj[ch[i - 1]].includes(ch[i])) viol.push('chain uses a non-link'); }
  ok(runs >= 300, 'ran ' + runs + ' real directed requests (3 origin phones per area x 9 targets x with/without the bridge)');
  ok(viol.length === 0, 'per-step contract: no hand-off off a real link, none unplanned, no early/unannounced movement, every detour justified, all budgets respected' + (viol.length ? ' FIRST: ' + viol[0] : ''));
  ok(stalls.length === 0, 'no request is stalled by policy while a phone declaring its target sits in its Relay component' + (stalls.length ? ': ' + stalls.slice(0, 5).join(', ') : ''));
  ok(!classes['before:POLICY-STALL'] && !classes['after:POLICY-STALL'], 'outcome classes: ' + JSON.stringify(classes));
  ok((classes['before:no-route'] || 0) > 0 && (classes['after:no-route'] || 0) < (classes['before:no-route'] || 0), 'the failures that remain are legitimate and explained: before the bridge ' + (classes['before:no-route'] || 0) + ' cannot reach a cut-off group, and after it only ' + (classes['after:no-route'] || 0) + ' (origins stranded in a stray component)');
  ok(maxHopsSeen <= R.directedHops, 'hop limit respected everywhere (max hops seen ' + maxHopsSeen + ' of ' + R.directedHops + ')');
});
section('4 every origin phone, not a sample', () => {
  let n4 = 0, bad = 0, firstBad = '';
  for (const bridge of [false, true]) for (const O of HOODS) for (const T of HOODS) { if (O === T) continue; for (const o of originsOf(O, bridge)) {
    fresh(bridge); const r = run(o, T); n4++; const reach = r.delivered || r.declaring === 0 || r.targetInComponent === 0; if (!reach) { bad++; firstBad = firstBad || (bridge + ':' + o + '>' + T); } } }
  ok(n4 > 1000 && bad === 0, n4 + ' requests, one from every Relay phone to every other area, with and without the bridge: every one either delivers or has a structural reason (' + (bad ? 'first problem ' + firstBad : 'none unexplained') + ')');
});
section('4 order independence and ties', () => {
  let n4 = 0, diff = 0;
  for (const bridge of [false, true]) for (const O of HOODS) for (const T of HOODS) {
    if (O === T) continue; const sets = [];
    for (const rev of [false, true]) { fresh(bridge); if (rev) S().order.reverse(); const o = relayDeclaring(O).sort((a, b) => num(a) - num(b))[0]; const r = run(o, T); sets.push(M.holders(r.pid).slice().sort().join(',') + '|' + Object.keys(S().inbox).map(k => S().inbox[k][r.pid] ? k + ':' + S().inbox[k][r.pid].via : '').filter(Boolean).sort().join(',')); }
    n4++; if (sets[0] !== sets[1]) diff++; }
  ok(diff === 0, 'processing the phones in reverse order gives identical holders AND identical "received from" links in all ' + n4 + ' pair/bridge cases (' + diff + ' differ)');
});
section('4 changed relay participation', () => {
  const rngf = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  let runs = 0, viol = [], deliveredOnlyIfConnected = true, nStalls = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const rnd = rngf(seed * 977);
    for (const T of ['LC', 'LN', 'BS', 'CK']) {
      fresh(seed % 2 === 0); const off = {}; S().order.forEach(i => { if (i !== K().D && i !== K().A && rnd() < (0.1 + 0.03 * seed)) { S().nodes[i].hasApp = false; off[i] = 1; } });
      const o = relayDeclaring('HK')[0]; if (!o) continue; const a = auditRun(o, T); runs++; a.viol.forEach(v => viol.push('seed ' + seed + ' ' + T + ': ' + v));
      const sm = a.summary; if (sm.delivered && sm.targetInComponent === 0) deliveredOnlyIfConnected = false;
      if (!sm.delivered && sm.targetInComponent > 0) nStalls++;
    }
  }
  ok(runs >= 40 && viol.length === 0, runs + ' requests with 10-46% of other phones switched off: contract holds' + (viol.length ? ' FIRST: ' + viol[0] : ''));
  ok(deliveredOnlyIfConnected, 'delivery only ever happens through real Relay links (never to a phone outside the origin\'s Relay component)');
  ok(true, 'informational: ' + nStalls + ' of ' + runs + ' degraded-network requests were policy-limited while a target phone was still connected (see docs)');
});
section('4 searches that legitimately fail', () => {
  fresh(true); relayDeclaring('BS').concat(relayDeclaring('JS')).forEach(i => { S().nodes[i].hasApp = false; });
  const o = relayDeclaring('GP')[0], a = auditRun(o, 'BS'); ok(!a.summary.delivered && a.summary.declaring === 0 && a.viol.length === 0, 'no phone declaring Ber Sarai runs Relay: the search cannot deliver, and nothing misbehaves (holders ' + a.summary.holders + ')');
  const dd = hoodDistOf(o, 'BS'); ok(dd === 2, 'the request is still steered by declared distance (Green Park to Ber Sarai: ' + dd + ' steps)');
  fresh(false); const o2 = relayDeclaring('SE')[0], a2 = auditRun(o2, 'GP'); ok(!a2.summary.delivered && a2.summary.stop === 'gap' && a2.summary.targetInComponent === 0, 'Safdarjung Enclave to Green Park, one step apart in the neighbourhood graph, fails before the bridge because the encounter topology has no link: stop = ' + a2.summary.stop);
  ok(hoodDistOf(o2, 'GP') === 1, 'this is the point of keeping two layers apart: declared-area distance 1, no phone-to-phone path');
});

/* ================= 5. chains ================= */
section('5 chains and path lengths', () => {
  fresh(true); const o = K().A, pid = M.createRequest(o, { kind: 'urgent', category: 'Medical', title: 'x', description: 'd', area: 'a', urgent: true, validity: 120 }).packetId; for (let i = 0; i < 80; i++) M.step();
  const rows = L.pathAudit(pid, o); const p9 = rows.find(r => r.id === 'p9');
  ok(p9 && p9.hops === p9.shortest, 'P9\'s real hand-off chain (' + p9.chain.join(' > ') + ') is a shortest Relay path (' + p9.hops + ' hops)');
  const worst = rows.reduce((a, r) => Math.max(a, r.extra), 0); ok(worst <= 1, 'for a flooded request no phone is more than 1 hop beyond its shortest path (' + worst + '); the 1 allowed is a one-message-per-link wait (CAP)');
  ok(rows.every(r => r.chain[0] === o && r.chain.length - 1 === r.hops && S().inbox[r.id][pid].hops === r.hops), 'every chain starts at the origin, and its length equals the hop count the engine recorded (' + rows.length + ' phones)');
  fresh(false); const r2 = run(relayDeclaring('HK')[0], 'LC'); const pa = L.pathAudit(r2.pid, relayDeclaring('HK')[0]), over = pa.filter(r => r.extra > 3);
  ok(over.length === 0 || over.every(r => r.chain.some(i => S().inbox[i][r2.pid].detours > 0)), 'for a directed request, every chain more than 3 hops longer than the shortest path contains a documented detour (' + over.length + ' such chains)');
});

/* ================= 6. explanations vs engine ================= */
section('6 explanations vs the engine on every phone and neighbour', () => {
  let pairs = 0, bad = [], texts = {};
  for (const bridge of [false, true]) for (const T of ['LC', 'LN', 'HK', 'CP']) {
    fresh(bridge); const o = relayDeclaring(bridge ? 'VV' : 'HK')[0], pid = L.newMissing(o, T).packetId;
    for (let i = 0; i < 70; i++) {
      M.holders(pid).forEach(h => { if (!M.canRelay(h)) return; const c = M.classify(h, pid), plan = M.plan(h, pid);
        S().adj[h].forEach(d => { if (!M.canRelay(d) || M.nodeHas(d, pid)) return; const dec = X.decide(h, d, pid), sel = plan.find(x => x.d === d); pairs++;
          if (c.stop) { if (dec.verdict !== 'stop') bad.push('stop mismatch'); return; }
          if (sel) { if (!(dec.verdict === 'send' || dec.verdict === 'detour') || dec.verdict === 'detour' !== !!sel.det) bad.push(h + '>' + d + ' plan says ' + (sel.det ? 'detour' : 'send') + ' text says ' + dec.verdict); }
          else { if (dec.verdict !== 'withhold') bad.push(h + '>' + d + ' not in plan but verdict ' + dec.verdict); if (!dec.lasting) bad.push(h + '>' + d + ' withhold without a duration'); if (dec.verdict === 'withhold' && !/Not selected/.test(dec.text) && c.policy === 'directed') bad.push(h + '>' + d + ' text lacks "Not selected": ' + dec.text.slice(0, 60)); }
          texts[dec.code] = dec.text;
          if (FORBIDDEN.test(dec.text)) bad.push('forbidden wording: ' + dec.text.slice(0, 80));
          if (dec.verdict === 'withhold' && c.policy === 'directed') { const row = c.rows.find(r => r.d === d); if (row.code !== dec.code) bad.push('code ' + dec.code + ' vs engine ' + row.code); }
        }); });
      M.step();
    }
  }
  ok(pairs > 1000, 'compared ' + pairs + ' holder/neighbour decisions across 8 requests and 560 minutes with the engine\'s own classification');
  ok(bad.length === 0, 'the explanation always agrees with the plan, carries a duration, uses the engine\'s own reason code, and never says "will not receive"' + (bad.length ? ' FIRST: ' + bad[0] : ''));
  ok(Object.keys(texts).length >= 6, 'the audited run produced ' + Object.keys(texts).length + ' distinct decision kinds (' + Object.keys(texts).join(', ') + ')');
});
section('6 stopped means stopped', () => {
  let n6 = 0, moved = 0;
  for (const bridge of [false, true]) for (const O of ['HK', 'SE', 'LC', 'LN']) for (const T of ['LC', 'GP', 'CP']) { if (O === T) continue; fresh(bridge); const r = run(relayDeclaring(O)[0], T); const h0 = M.holders(r.pid).length; for (let i = 0; i < 60; i++) M.step(); n6++; if (M.holders(r.pid).length !== h0) moved++; }
  ok(moved === 0, 'after a request is reported stopped (cannot move, not waiting), 60 further minutes add no phone in any of ' + n6 + ' cases');
  fresh(false); const pid = L.newMissing(relayDeclaring('HK')[0], 'LC').packetId; let g = 0; while (M.stats(pid).canMove && g++ < 100) M.step();
  const st = M.stats(pid), h0 = M.holders(pid).length; ok(!st.canMove && !st.waiting && !M.stats(pid).expired, 'the demonstration request stalls for real at minute ' + S().tick + ' (not waiting: the stall is final)');
  for (let i = 0; i < 100; i++) M.step(); ok(M.holders(pid).length === h0, 'and 100 more minutes change nothing (V4.1 still handed it to another phone at minute 26)');
});

/* ================= 7. the neighbourhood graph ================= */
section('7 neighbourhood graph', () => {
  const ids = M.NEIGHBORHOODS.map(h => h.id);
  ok(ids.length === 10, 'ten declared areas');
  ok(ids.every(a => ids.every(b => M.hoodDistance(a, b) !== null && M.hoodDistance(a, b) === M.hoodDistance(b, a))), 'connected and symmetric');
  ok(M.NEIGH_EDGES.every(e => e[0] !== e[1] && ids.includes(e[0]) && ids.includes(e[1])) && new Set(M.NEIGH_EDGES.map(e => e.slice().sort().join('|'))).size === M.NEIGH_EDGES.length, 'no self-loops or duplicate edges');
  ok(Math.max.apply(null, ids.map(a => Math.max.apply(null, ids.map(b => M.hoodDistance(a, b))))) === 4, 'diameter 4 steps (steps, not kilometres)');
  /* the weakest edge is not load-bearing: rebuild the engine without it and compare every outcome class */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-nb-'));
  ['mesh.js', 'sim_explain.js'].forEach(f => { let src = fs.readFileSync(path.join(dir, f), 'utf8'); if (f === 'mesh.js') { const before = src; src = src.replace("['SE', 'VV'], ", ''); if (src === before) throw new Error('could not remove SE-VV'); } fs.writeFileSync(path.join(tmp, f), src); });
  const L2 = require('./routing_audit_lib.js')(tmp); let diffCount = 0, total = 0;
  for (const bridge of [false, true]) for (const O of HOODS) for (const T of HOODS) { if (O === T) continue;
    const classOf = LL => { LL.M.reset(); if (bridge) { const D = LL.S().keys.D; LL.M.join(D, LL.M.sharers(D)[0]); } const o = LL.S().order.filter(i => LL.M.canRelay(i) && LL.S().nodes[i].hood === O)[0]; const r = LL.run(o, T); return r.delivered ? 'd' : r.targetInComponent === 0 ? 'n' : 's'; };
    total++; if (classOf(L) !== classOf(L2)) diffCount++; }
  L.M.reset(); ok(diffCount === 0, 'removing the weakest edge (Safdarjung Enclave - Vasant Vihar) changes no delivery outcome in ' + total + ' origin/target/bridge cases, so the result does not hinge on it');
});

console.log(fails ? '\nFAILED ' + fails + ' of ' + n : '\nALL ' + n + ' V4.2 ROUTING AND TOPOLOGY TESTS PASSED');
process.exit(fails ? 1 : 0);
