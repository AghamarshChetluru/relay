global.window = global; require(require('path').resolve(process.argv[2] || '../relay-prototype', 'mesh.js'));
const M = Mesh; let fails = 0, n = 0;
function ok(c, m) { n++; console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
function steps(k) { for (let i = 0; i < k; i++) M.step() }
function until(f, max) { let i = 0; while (!f() && i < (max || 200)) { M.step(); i++ } return i }
const R = (node, o) => M.createRequest(node, Object.assign({ kind: 'urgent', category: 'Medical', title: 't', description: 'd', area: 'Market Square', urgent: true }, o || {}));
function sizeKey() { const S = M.state(); return JSON.stringify([S.order.map(i => [i, S.nodes[i].x, S.nodes[i].y, S.nodes[i].hood, S.nodes[i].hasApp]), S.edges.map(e => [e.from, e.to])]) }

M.reset(); let S = M.state(); const K = S.keys; const A = K.A, E = K.E, D = K.D;
const k1 = sizeKey();
ok(S.order.length === 80, 'exactly 80 nodes');
ok(M.HOODS.length === 6 && M.HOODS.every(h => S.order.filter(i => S.nodes[i].zone === h.id).length === h.n), '6 neighbourhoods with fixed counts');
ok(M.participating().length < 80 && !S.nodes[D].hasApp, 'not all phones are relays; D has no app');
M.reset(); ok(sizeKey() === k1, 'topology deterministic across reset');
ok(Object.keys(K).length === 7, '7 key role phones');

// ---------- medical journey ----------
M.reset(); S = M.state();
let r = R(A); const pid = r.packetId;
ok(M.holders(pid).join() === A, 'request initially only on A');
ok(M.requestView(A, r.requestId).label === 'Saved on this phone', 'A status: Saved on this phone');
ok(M.requestView(E, r.requestId) === null, 'E has no view of the request');
M.step(); ok(M.requestView(A, r.requestId).label === 'Shared with a nearby phone', 'A status after first handoff: Shared with a nearby phone');
const used = until(() => !M.stats(pid).canMove, 100);
let st = M.stats(pid);
ok(used > 3 && used < 40, 'spread stalls after ' + used + ' steps (< TTL)');
ok(st.blocked && st.held >= 20 && st.held < st.participating, 'stalled with ' + st.held + '/' + st.participating + ' participating holding it');
ok(!M.nodeHas(E, pid), 'clinic volunteer E has NOT received it');
ok(st.candidates[0] === D && st.candidates.length === 1, 'only bridge candidate is the Crossroads phone');
ok(['Shared with a nearby phone'].includes(M.requestView(A, r.requestId).label), 'requester still sees only local info while blocked');
ok(M.canRelay(D) === false && S.adj[D].every(o => !M.nodeHas(D, pid)), 'D (no app) holds nothing and cannot forward');
ok(M.createReply(E, r.requestId, { kind: 'offer', note: 'x' }).ok === false, 'E cannot reply before receipt');
ok(M.join(D, A).ok === false, 'D cannot join via a non-adjacent phone');
const sh = M.sharers(D); ok(sh.length >= 1, 'D has adjacent Relay phones to share from');
ok(M.join(D, sh[0]).ok, 'D joins with consent'); ok(!M.nodeHas(D, pid), 'join alone delivers nothing');
const used2 = until(() => M.nodeHas(E, pid), 60); ok(M.nodeHas(E, pid) && used2 >= 1, 'E receives after ' + used2 + ' more steps');
ok(M.requestView(E, r.requestId).label === 'Received on this phone', 'E status: Received on this phone');
ok(M.requestView(A, r.requestId).label === 'Shared with a nearby phone', 'A still does NOT know E received it (no omniscient status)');
const rep = M.createReply(E, r.requestId, { kind: 'offer', note: 'I can walk you to the clinic gate', area: 'Clinic gate' });
ok(rep.ok, 'E submits offer'); ok(M.requestView(E, r.requestId).label === 'Your offer is saved on this phone', 'E status: offer saved locally');
const back = until(() => M.nodeHas(A, rep.packetId), 100);
ok(M.nodeHas(A, rep.packetId) && back > 3, 'reply physically reaches A after ' + back + ' steps (not instant)');
ok(M.requestView(A, r.requestId).label === 'Offer received', 'A status: Offer received');
ok(M.repliesAt(A, r.requestId).length === 1, 'A sees exactly one reply');
ok(M.createAck(E, rep.packetId).ok === false, 'only requester can ack');
const ack = M.createAck(A, rep.packetId); ok(ack.ok, 'A acknowledges the specific offer');
ok(M.createAck(A, rep.packetId).ok === false, 'cannot ack twice');
ok(M.requestView(A, r.requestId).label === 'Offer acknowledged', 'A status: Offer acknowledged');
ok(!M.nodeHas(E, ack.packetId) && M.requestView(E, r.requestId).label !== 'Requester acknowledged your offer', 'E not told until ack arrives');
until(() => M.nodeHas(E, ack.packetId), 100);
ok(M.requestView(E, r.requestId).label === 'Requester acknowledged your offer', 'E sees acknowledgement only after it arrives');
const rs = M.createResolve(A, r.requestId); ok(rs.ok && M.createResolve(A, r.requestId).ok === false, 'resolve once');
ok(M.requestView(A, r.requestId).label === 'Resolved on this phone', 'A: Resolved on this phone');
ok(M.requestView(E, r.requestId).label === 'Requester acknowledged your offer', 'E not resolved yet');
until(() => M.nodeHas(E, rs.packetId), 100);
ok(M.requestView(E, r.requestId).label === 'Resolved by requester', 'E: Resolved by requester after notice arrives');
ok(M.createReply(E, r.requestId, { kind: 'offer', note: 'again' }).ok === false, 'no replies after resolution');
steps(30);
let dup = true; S.order.forEach(i => { const ks = Object.keys(S.inbox[i]); if (new Set(ks).size !== ks.length) dup = false });
ok(dup && M.repliesAt(A, r.requestId).length === 1 && M.receivedRequests(A).length === 1, 'no duplicate packets or feed items after 30 extra steps');

// ---------- missing person sighting ----------
M.reset(); S = M.state();
let m = R(A, { kind: 'missing', category: 'Missing', urgent: false, title: 'Looking for Meera', targets: ['LC'] });
until(() => !M.stats(m.packetId).canMove, 100); M.join(D, M.sharers(D)[0]); until(() => M.nodeHas(E, m.packetId), 80);
ok(M.nodeHas(E, m.packetId), 'missing-person request reaches E after join');
let sg = M.createReply(E, m.requestId, { kind: 'sighting', note: 'Girl with red bag at clinic gate 10am', area: 'Clinic District' });
until(() => M.nodeHas(A, sg.packetId), 100);
ok(M.nodeHas(A, sg.packetId) && S.packets[sg.packetId].payload.kind === 'sighting', 'sighting reaches A with kind=sighting (UI labels unverified)');

// ---------- broadcast ----------
M.reset(); S = M.state();
const L = K.L, C = K.C, Mk = K.M;
let b = M.createBroadcast(L, { text: 'Water point open at City Hall', category: 'Resources', area: 'Civic Center' });
ok(b.ok && M.receivedBroadcasts(L).length === 1 && M.receivedBroadcasts(A).length === 0, 'broadcast visible on author only');
ok(M.requestView ? M.receivedRequests(L).length === 0 : true, 'broadcast is not a help request');
until(() => !M.stats(b.packetId).canMove, 100);
st = M.stats(b.packetId);
ok(M.nodeHas(E, b.packetId) && M.nodeHas(C, b.packetId), 'broadcast spreads through its (clinic-side) cluster');
ok(!M.nodeHas(A, b.packetId) && !M.nodeHas(Mk, b.packetId) && !M.nodeHas(K.S, b.packetId), 'broadcast held in disconnected cluster: not on A/M/S');
ok(M.receivedBroadcasts(A).length === 0, "A's community feed still empty");
M.join(D, M.sharers(D)[0]); const bj = until(() => M.nodeHas(A, b.packetId), 60);
ok(M.nodeHas(A, b.packetId), 'after bridge joins, broadcast crosses in subsequent steps (' + bj + ')');
steps(10); ok(M.receivedBroadcasts(A).length === 1, 'deduplicated: one copy on A');
ok(M.createBroadcast(A, { text: 'x'.repeat(281) }).ok === false && M.createBroadcast(A, { text: '   ' }).ok === false && M.createBroadcast(A, { text: 'x'.repeat(280) }).ok, '280-char limit and empty rejected');
// expiry
M.reset(); S = M.state(); b = M.createBroadcast(A, { text: 'old news', category: 'Community' }); const tt = M.TTL.broadcast;
ok(tt === 45 && M.TTL.request === 90, 'documented TTLs: broadcast 45, request 90');
steps(tt - 1); ok(!M.isExpired(S.packets[b.packetId]), 'broadcast not expired at TTL-1');
const before = M.holders(b.packetId).length; M.join(D, M.sharers(D)[0]); steps(1);
ok(M.isExpired(S.packets[b.packetId]), 'broadcast expired at TTL');
const after = M.holders(b.packetId).length; steps(10); ok(M.holders(b.packetId).length === after, 'expired broadcast no longer forwarded');
// request expiry blocks replies
M.reset(); S = M.state(); r = R(A); until(() => !M.stats(r.packetId).canMove, 100); M.join(D, M.sharers(D)[0]); until(() => M.nodeHas(E, r.packetId), 60);
steps(100); ok(M.isExpired(S.packets[r.packetId]) && M.createReply(E, r.requestId, { kind: 'offer', note: 'late' }).ok === false, 'cannot reply to expired request');
ok(M.requestView(E, r.requestId).expired === true, 'view reports expired');

// ---------- priority under capacity ----------
M.reset(); S = M.state();
const bc = M.createBroadcast(A, { text: 'general news' }), rq = R(A, { urgent: true });
const nb = S.adj[A].filter(M.canRelay)[0]; M.step();
ok(M.nodeHas(nb, rq.packetId) && !M.nodeHas(nb, bc.packetId), 'step 1: urgent request wins the single link slot; broadcast waits');
M.step(); ok(M.nodeHas(nb, bc.packetId), 'step 2: broadcast follows');
M.reset(); S = M.state(); const lo = R(A, { urgent: false }), hi = R(A, { urgent: true });
const nb2 = S.adj[A].filter(M.canRelay)[0]; M.step(); ok(M.nodeHas(nb2, hi.packetId) && !M.nodeHas(nb2, lo.packetId), 'urgent request beats older non-urgent request');

// ---------- non-participants / local views ----------
M.reset(); S = M.state(); r = R(A); steps(40);
const non = S.order.filter(i => !S.nodes[i].hasApp); ok(non.length >= 16 && non.every(i => !M.nodeHas(i, r.packetId)), 'no non-participant ever holds a packet (' + non.length + ' checked)');
ok(M.createRequest(non[0], { kind: 'urgent', title: 't', description: '', area: '', urgent: true }).ok === false, 'phone without app cannot author');
const outsiders = S.order.filter(i => !M.nodeHas(i, r.packetId)); ok(outsiders.every(i => M.receivedRequests(i).length === 0), 'phones not reached have empty feeds');
// reset
M.reset(); S = M.state(); ok(S.tick === 0 && !Object.keys(S.packets).length && !Object.keys(S.requests).length && !S.nodes[D].hasApp && sizeKey() === k1, 'reset restores initial network');
console.log(fails ? 'FAILURES: ' + fails + ' of ' + n : 'ALL ' + n + ' ENGINE TESTS PASSED'); process.exit(fails ? 1 : 0);
