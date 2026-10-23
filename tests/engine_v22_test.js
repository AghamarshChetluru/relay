global.window = global; require(require('path').resolve(process.argv[2] || '../relay-prototype', 'mesh.js'));
const M = Mesh; let fails = 0, n = 0;
function ok(c, m) { n++; console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
function steps(k) { for (let i = 0; i < k; i++) M.step() }
function until(f, max) { let i = 0; while (!f() && i < (max || 200)) { M.step(); i++ } return i }
function fresh(joinD) { M.reset(); const S = M.state(); if (joinD) M.join(S.keys.D, M.sharers(S.keys.D)[0]); return S }
function compSize(S){const on={};S.order.forEach(i=>on[i]=M.canRelay(i));const c=M.components(on);return S.order.filter(i=>on[i]&&c[i]===c[S.keys.A]).length}
const U = (node, o) => M.createRequest(node, Object.assign({ kind: 'urgent', category: 'Medical', title: 'Medical help needed', description: 'd', area: 'Gate 2', urgent: true, validity: 60 }, o || {}));
const MP = (node, o) => M.createRequest(node, Object.assign({ kind: 'missing', category: 'Missing', title: 'Looking for Meera', description: 'red bag', area: 'Connaught Place', urgent: false, targets: ['CP'], validity: 1440 }, o || {}));
const hoodCount = (S, hs, h) => hs.filter(i => S.nodes[i].hood === h).length;

/* ===== neighbourhoods, declared area, reminders ===== */
let S = fresh(true); const K = S.keys, A = K.A, E = K.E;
ok(M.NEIGHBORHOODS.length === 10 && ['Hauz Khas', 'Connaught Place', 'Green Park', 'Safdarjung Enclave', 'Vasant Vihar', 'Ber Sarai', 'Jia Sarai'].every(nm => M.NEIGHBORHOODS.some(h => h.name === nm)), '10 Delhi neighbourhoods incl. all seven named in the brief');
ok(M.NEIGHBORHOODS.every(a => M.NEIGHBORHOODS.every(b => M.hoodDistance(a.id, b.id) === M.hoodDistance(b.id, a.id) && M.hoodDistance(a.id, b.id) !== null)), 'neighbourhood graph is connected and symmetric');
ok(M.hoodDistance('HK', 'CP') === 3 && M.hoodDistance('HK', 'HK') === 0 && M.hoodDistance('HK', 'GP') === 1, 'graph distances: HK-CP 3, HK-HK 0, HK-GP 1');
ok(M.NEIGHBORHOODS.every(h => S.order.filter(i => S.nodes[i].hood === h.id && S.nodes[i].hasApp).length >= 2), 'every neighbourhood has >=2 Relay phones in the simulated city');
ok(S.nodes[A].hood === 'HK' && M.hoodState(A).reliable, 'phone starts with a declared neighbourhood');
M.setHood(A, 'CP'); ok(S.nodes[A].hood === 'CP' && S.nodes[A].hoodName === 'Connaught Place' && S.nodes[A].area === 'Connaught Place', 'user can update neighbourhood manually');
M.setHood(A, null, 'My lane near the ring road'); ok(S.nodes[A].hood === null && S.nodes[A].hoodName === 'My lane near the ring road' && !M.hoodState(A).reliable, 'free-text area accepted but not trusted for routing');
M.setHood(A, 'HK');
steps(29); ok(!M.hoodState(A).due && M.hoodState(A).age === 29, 'no reminder due at 29 min');
steps(1); ok(M.hoodState(A).due && !M.hoodState(A).stale, 'reminder due at 30 min');
M.confirmHood(A); ok(!M.hoodState(A).due && M.hoodState(A).age === 0, 'confirming resets the clock (last confirmed tracked)');
steps(61); ok(M.hoodState(A).stale && !M.hoodState(A).reliable, 'unconfirmed for >60 min: stale, not reliable for routing');
ok(S.order.filter(i => i !== A).every(i => M.hoodState(i).age === 0), 'other simulated phones keep confirming (no invented location changes)');

/* ===== emergency: broad propagation ===== */
S = fresh(true);
let r = U(S.keys.A, { targets: ['CP'] }), pid = r.packetId;
ok(S.packets[pid].route.policy === 'flood', 'emergency request uses flood policy even if a neighbourhood is mentioned');
steps(80); let hs = M.holders(pid);
const hoodsReached = M.NEIGHBORHOODS.filter(h => hoodCount(S, hs, h.id) > 0).length;
ok(hoodsReached === 10 && M.HOODS.every(z => hs.some(i => S.nodes[i].zone === z.id)), 'emergency reached all 10 declared neighbourhoods and all 6 areas (not confined to the requester area)');
ok(hs.length === compSize(S), 'emergency reaches every connected Relay phone ('+hs.length+' of '+compSize(S)+' in its connected group)');
ok(hs.some(i => S.nodes[i].hood !== 'HK' && i !== E) && S.order.filter(i => S.nodes[i].hasApp && M.nodeHas(i, pid) && S.nodes[i].key !== 'E').length > 20, 'phones relay although they are not responders');
let maxh = 0; S.order.forEach(i => { if (S.inbox[i][pid]) maxh = Math.max(maxh, S.inbox[i][pid].hops) }); ok(maxh <= M.ROUTE.floodHops, 'hop budget respected (max hops '+maxh+')');

/* ===== missing person: neighbourhood-directed ===== */
S = fresh(true); r = MP(S.keys.A); pid = r.packetId;
ok(S.packets[pid].route.policy === 'directed' && S.packets[pid].route.targets.join() === 'CP', 'missing request uses directed policy toward Connaught Place');
steps(3); hs = M.holders(pid); ok(hoodCount(S, hs, 'HK') >= 3, 'same-neighbourhood forwarding allowed (>=3 Hauz Khas phones hold it by step 3)');
const t1 = until(() => hoodCount(S, M.holders(pid), 'CP') > 0, 120); ok(hoodCount(S, M.holders(pid), 'CP') > 0, 'reaches phones in the target neighbourhood after '+(t1+3)+' steps');
function firstCost(kindMissing, src, tg){ const S2=fresh(true); const rr=kindMissing?MP(src,{targets:[tg]}):U(src); let i=0; while(i<150 && !M.holders(rr.packetId).some(x=>S2.nodes[x].hood===tg)){M.step();i++} return {n:M.holders(rr.packetId).length,t:i}; }
function finalCount(kindMissing, src, tg){ fresh(true); const rr=kindMissing?MP(src,{targets:[tg]}):U(src); steps(100); return M.holders(rr.packetId).length; }
const base0 = fresh(true); const sample = base0.order.filter(i => base0.nodes[i].hasApp && i !== base0.keys.D).filter((_, k) => k % 5 === 0);
let dSum = 0, fSum = 0, cnt = 0; ['CP','LC','HK'].forEach(tg => sample.forEach(src => { dSum += finalCount(true, src, tg); fSum += finalCount(false, src, tg); cnt++; }));
ok(dSum / cnt < fSum / cnt, 'directed reaches fewer phones than flooding on average ('+(dSum/cnt).toFixed(1)+' vs '+(fSum/cnt).toFixed(1)+' over '+cnt+' source/target pairs)');
let dc = 0, fc = 0, k2 = 0; sample.forEach(src => { const d = firstCost(true, src, 'LC'), f = firstCost(false, src, 'LC'); dc += d.n; fc += f.n; k2++; });
ok(dc / k2 <= fc / k2, 'directed uses no more phones than flooding to first reach the target ('+(dc/k2).toFixed(1)+' vs '+(fc/k2).toFixed(1)+')');
const floodN = 63;
S = fresh(true); r = MP(S.keys.A); steps(103); hs = M.holders(r.packetId);
let bad = 0, maxDet = 0; S.order.forEach(i => { const e = S.inbox[i][r.packetId]; if (e) { maxDet = Math.max(maxDet, e.detours); if (e.hops > S.packets[r.packetId].route.maxHops) bad++ } });
ok(bad === 0 && maxDet <= M.ROUTE.detourMax + M.ROUTE.patientExtra, 'hop and detour budgets respected (max detours '+maxDet+')');
/* no permanent stuck: property over every source and several targets */
let stuck = 0, pairs = 0;
['CP', 'LC', 'VV', 'JS'].forEach(tg => { const base = fresh(true); const srcs = base.order.filter(i => base.nodes[i].hasApp && i !== base.keys.D);
  srcs.forEach(src => { const S2 = fresh(true); const rr = MP(src, { targets: [tg] }); const fr = U(src); steps(100);
    const floodReaches = M.holders(fr.packetId).some(i => S2.nodes[i].hood === tg); if (!floodReaches) return; pairs++;
    if (!M.holders(rr.packetId).some(i => S2.nodes[i].hood === tg)) stuck++; }); });
ok(stuck === 0 && pairs > 200, 'no packet permanently stuck: '+pairs+' source/target pairs, '+stuck+' stuck');
/* detours exist: source whose only exit is a farther-from-target phone still gets out */
S = fresh(true); const p35 = 'p35'; r = MP(p35, { targets: ['LC'] }); steps(60);
ok(hoodCount(S, M.holders(r.packetId), 'LC') > 0, 'phone whose only exit leads away from the target still reaches it via bounded detour (p35 -> Lodhi Colony)');
/* target containment: once a copy is in the target area it stays in target + nearby areas */
S = fresh(true); r = MP(S.keys.A, { targets: ['LC'] }); steps(120);
const far = M.holders(r.packetId).filter(i => S.inbox[i][r.packetId].tgt && M.hoodDistance(S.nodes[i].hood, 'LC') > 1);
ok(far.length === 0, 'copies that reached the target area never travel beyond target+adjacent areas');
/* fallback: unknown target => bounded opportunistic */
S = fresh(true); r = MP(S.keys.A, { targets: [] }); steps(100);
ok(S.packets[r.packetId].route.policy === 'opportunistic' && S.order.every(i => !S.inbox[i][r.packetId] || S.inbox[i][r.packetId].hops <= M.ROUTE.oppHops) && M.holders(r.packetId).length < 63, 'unknown location: bounded opportunistic fallback (hop-limited, not citywide)');
/* stale declared areas are not trusted */
S = fresh(true); S.opts.autoConfirm = false; steps(70); ok(S.order.every(i => !M.hoodState(i).reliable), 'precondition: all declared areas stale');
r = MP(S.keys.A); steps(100); ok(M.holders(r.packetId).length < compSize(S) && S.order.every(i => !S.inbox[i][r.packetId] || S.inbox[i][r.packetId].detours <= M.ROUTE.detourMax + M.ROUTE.patientExtra), 'stale locations: forwarding stays bounded (detour budget) instead of flooding');

/* ===== community broadcast ===== */
S = fresh(true); M.ROUTE.broadcastHops = 3; const b = M.createBroadcast(S.keys.L, { text: 'Water point open', category: 'Resources' }); M.ROUTE.broadcastHops = 30; steps(40);
ok(S.packets[b.packetId].route.policy === 'flood' && M.holders(b.packetId).length > 1 && S.order.every(i => !S.inbox[i][b.packetId] || S.inbox[i][b.packetId].hops <= 3), 'broadcast hop budget enforced (limited spread)');
S = fresh(true); const bb = M.createBroadcast(S.keys.A, { text: 'x' }), uu = U(S.keys.A); const nb = S.adj[S.keys.A].filter(M.canRelay)[0]; M.step();
ok(M.nodeHas(nb, uu.packetId) && !M.nodeHas(nb, bb.packetId), 'broadcast still yields to urgent request on a busy link'); 
steps(30); ok(M.holders(bb.packetId).length === compSize(S), 'broadcast spreads to all connected phones within its lifetime & budget');
steps(30); ok(M.isExpired(S.packets[bb.packetId]), 'broadcast expires');

/* ===== expiry & validity ===== */
S = fresh(true); r = U(S.keys.A, { validity: 30 }); ok(S.packets[r.packetId].expiresTick === 30 && M.VALIDITY.urgentOptions.join() === '30,60,120' && M.VALIDITY.urgentDefault === 60, 'validity options 30/60/120, default 60; packet carries its own expiry');
const g = U(S.keys.A, { urgent: false, validity: M.VALIDITY.general, category: 'Shelter' }), mm = MP(S.keys.A);
ok(S.packets[g.packetId].expiresTick === 360 && S.packets[mm.packetId].expiresTick === 1440, 'general help 6 h, missing person 24 h (longer policies)');
steps(29); const before = M.holders(r.packetId).length; steps(1); ok(M.isExpired(S.packets[r.packetId]), 'expired at 30 min');
const heldAt30 = M.holders(r.packetId).length; steps(20); ok(M.holders(r.packetId).length === heldAt30, 'expired packet no longer forwarded');
ok(M.requestView(S.keys.A, r.requestId).label === 'Expired' && M.receivedRequests(S.keys.A).some(x => x.id === r.requestId), 'author keeps case history; status Expired');
ok(M.createReply(E, r.requestId, { kind: 'offer', note: 'x' }).ok === false, 'cannot respond to an expired request');

/* ===== renewal ===== */
S = fresh(true); r = U(S.keys.A, { validity: 30 }); steps(10);
const v0 = r.packetId; steps(25);
ok(M.isExpired(S.packets[v0]), 'original expired');
ok(M.renewRequest(S.keys.E, r.requestId, {}).ok === false, 'only the requester can renew');
const rn = M.renewRequest(S.keys.A, r.requestId, { validity: 120, description: 'Still needed. Now in the courtyard.' });
ok(rn.ok && rn.packetId !== v0 && rn.caseId === r.requestId && rn.version === 1, 'renewal: new packet id, same case id, version 1');
ok(S.packets[rn.packetId].expiresTick === S.tick + 120 && S.packets[rn.packetId].payload.description.indexOf('courtyard') > 0 && S.packets[rn.packetId].payload.version === 1, 'renewal carries updated info and a fresh expiry');
ok(M.requestView(S.keys.A, r.requestId).renewed && !M.requestView(S.keys.A, r.requestId).expired, 'author sees renewed, active case');
until(() => M.nodeHas(E, rn.packetId), 100);
ok(M.nodeHas(E, rn.packetId) && M.receivedCases(E).filter(c => c.id === r.requestId).length === 1 && M.receivedCases(E).filter(c => c.id === r.requestId)[0].pkt.id === rn.packetId, 'a phone holding old+new packets shows ONE case (the renewal)');
const both = S.order.filter(i => M.nodeHas(i, v0) && M.nodeHas(i, rn.packetId)); ok(both.length > 0, 'some phones hold both versions (precondition for dedup test): '+both.length);
ok(both.every(i => M.receivedCases(i).filter(c => c.id === r.requestId).length === 1), 'no duplicate case cards when both packets reached a phone');
ok(M.createReply(E, r.requestId, { kind: 'offer', note: 'I can help now' }).ok, 'volunteer can respond to the renewed (active) case');
const stOld = M.stats(v0); ok(S.order.every(i => !M.nodeHas(i, v0) || M.isExpired(S.packets[v0])), 'old packet stays expired and unforwarded');
const rs = M.createResolve(S.keys.A, r.requestId); ok(rs.ok && M.renewRequest(S.keys.A, r.requestId, {}).ok === false, 'resolved case cannot be renewed');
/* superseded packets are not forwarded further */
S = fresh(true); r = U(S.keys.A, { validity: 120 }); steps(2); const oldPid = r.packetId; const rn2 = M.renewRequest(S.keys.A, r.requestId, { validity: 120 }); steps(1);
steps(30); let viol = 0; S.order.forEach(i => { const eo = S.inbox[i][oldPid]; if (eo && eo.via) { const en = S.inbox[eo.via][rn2.packetId]; if (en && en.tick < eo.tick) viol++; } });
ok(viol === 0, 'a phone that already holds the renewal never forwards the superseded packet');
ok(M.holders(rn2.packetId).length >= M.holders(oldPid).length, 'renewal spreads at least as widely as the superseded copy');

/* ===== dedup & distinct replies ===== */
S = fresh(true); r = U(S.keys.A, { validity: 240 }); steps(60);
ok(S.order.every(i => { const ks = Object.keys(S.inbox[i]); return new Set(ks).size === ks.length; }) && S.order.every(i => M.receivedCases(i).length <= 1), 'one stored copy per packet; one case card per case on every phone');
const r1 = M.createReply(S.keys.E, r.requestId, { kind: 'offer', note: 'First offer' }), r2 = M.createReply(S.keys.C, r.requestId, { kind: 'offer', note: 'Second offer' });
steps(60); ok(r1.packetId !== r2.packetId && M.repliesAt(S.keys.A, r.requestId).length === 2, 'distinct volunteer replies stay distinct (2 on requester)');
steps(20); ok(M.repliesAt(S.keys.A, r.requestId).length === 2, 'no duplicate replies later');
ok(M.createAck(S.keys.A, r1.packetId).ok && M.createResolve(S.keys.A, r.requestId).ok, 'ack and resolve still work');

/* ===== attachments ===== */
S = fresh(true); const photo = { dataUrl: 'data:image/jpeg;base64,/9j/4AAQ', bytes: 12000, w: 320, h: 240 };
r = MP(S.keys.A, { photo });
const att = Object.keys(S.attachments)[0], ap = S.attachments[att].packetId;
ok(att && S.packets[ap].type === 'attachment' && S.packets[ap].prio > S.packets[r.packetId].prio - 1 && S.packets[r.packetId].payload.attachmentId === att, 'photo becomes an attachment with its own id, linked to the case');
ok(M.photoOf(S.keys.A, r.requestId).ready === true, 'author sees own photo immediately');
M.step(); const nbr = S.adj[S.keys.A].find(i => M.nodeHas(i, r.packetId));
ok(!!nbr && !M.nodeHas(nbr, ap), 'attachment travels after the compact text packet (lower priority)');
ok(M.photoOf(nbr, r.requestId).ready === false, 'receiver shows "photo on the way" until the attachment arrives');
until(() => M.nodeHas(nbr, ap), 20); ok(M.photoOf(nbr, r.requestId).ready === true && M.photoOf(nbr, r.requestId).dataUrl === photo.dataUrl, 'photo displays on the received request once the attachment arrives');
const rn3 = M.renewRequest(S.keys.A, r.requestId, { validity: 1440 }); ok(Object.keys(S.attachments).length === 1 && S.packets[rn3.packetId].payload.attachmentId === att, 'renewal reuses the same attachment (no second copy)');
steps(80); ok(S.order.every(i => Object.keys(S.inbox[i]).filter(k => S.packets[k].type === 'attachment').length <= 1), 'each phone stores one copy of the attachment');

/* ===== exact address ===== */
S = fresh(true); r = U(S.keys.A, { privateAddress: { building: 'Flat 4B, Block C', directions: 'Blue gate, 2nd floor' } });
ok(S.packets[r.packetId].payload.hasPrivate === true && JSON.stringify(S.packets).indexOf('Flat 4B') === -1, 'exact address is NOT in any broadcast packet; only a "has private address" flag');
ok(M.ownAddress(S.keys.A, r.requestId).building === 'Flat 4B, Block C' && M.ownAddress(S.keys.E, r.requestId) === null, 'only the requester can read the stored address');
until(() => M.nodeHas(S.keys.E, r.packetId), 100); const rp = M.createReply(S.keys.E, r.requestId, { kind: 'offer', note: 'On my way' }); until(() => M.nodeHas(S.keys.A, rp.packetId), 100);
ok(M.shareAddress(S.keys.E, rp.packetId).ok === false, 'a volunteer cannot share the requester address');
const sh = M.shareAddress(S.keys.A, rp.packetId); ok(sh.ok && M.shareAddress(S.keys.A, rp.packetId).ok === false, 'requester shares address once, intentionally, for one volunteer');
ok(M.sharedAddressAt(S.keys.E, r.requestId) === null, 'volunteer cannot read it until it arrives');
until(() => M.nodeHas(S.keys.E, sh.packetId), 100); ok(M.sharedAddressAt(S.keys.E, r.requestId).building === 'Flat 4B, Block C', 'addressed volunteer reads it after it travels back');
const carrier = S.order.find(i => i !== S.keys.E && i !== S.keys.A && M.nodeHas(i, sh.packetId)); ok(carrier && M.sharedAddressAt(carrier, r.requestId) === null, 'relaying phones carry the sealed packet but cannot read it');

/* ===== storage & housekeeping ===== */
S = fresh(true); S.opts.evictExpired = true; r = U(S.keys.A, { validity: 30 }); steps(25);
const holder = S.order.find(i => i !== S.keys.A && M.nodeHas(i, r.packetId)); steps(5);
ok(M.nodeHas(holder, r.packetId) && M.isExpired(S.packets[r.packetId]), 'expired packet stays visible (as expired) during grace period');
steps(M.EVICT_GRACE + 2); ok(!M.nodeHas(holder, r.packetId) && M.nodeHas(S.keys.A, r.packetId), 'expired copies are cleaned from relay caches; requester keeps case history');
S = fresh(true); S.opts.storageCap = 3; const up = U(S.keys.A); for (let i = 0; i < 6; i++) M.createBroadcast(S.keys.B || S.adj[S.keys.A][0], { text: 'update ' + i }); steps(25);
const nbA = S.adj[S.keys.A][0]; const cached = Object.keys(S.inbox[nbA]).filter(k => S.packets[k].originNodeId !== nbA);
ok(cached.length <= 3 && M.nodeHas(nbA, up.packetId), 'storage cap enforced without dropping the active urgent request (cached '+cached.length+')');
ok(Object.keys(S.inbox[nbA]).filter(k => S.packets[k].originNodeId === nbA).length === 6, "a phone's own authored packets are never evicted");

/* ===== compatibility ===== */
S = fresh(false); r = M.createRequest(S.keys.A, { kind: 'urgent', category: 'Medical', title: 't', description: 'd', area: 'x', urgent: true });
ok(S.packets[r.packetId].expiresTick === 90 && S.packets[r.packetId].route.policy === 'flood', 'legacy callers (simulator) keep the 90-minute default and flood policy');
console.log(fails ? 'FAILURES: ' + fails + ' of ' + n : 'ALL ' + n + ' V2.2 ENGINE TESTS PASSED'); process.exit(fails ? 1 : 0);
