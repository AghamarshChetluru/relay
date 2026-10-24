/* Semantic regression suite (engine + explanation layer). usage: node tests/sim_semantic_test.js [prototype-dir]
   Question every test answers: do the words and numbers we show say what the engine state actually is, and nothing more?
   (The browser half is tests/sim_v41_test.html: the same questions asked through real clicks.) */
global.window = global; const dir = require('path').resolve(process.argv[2] || require('path').join(__dirname, '../prototype'));
require(dir + '/mesh.js'); require(dir + '/sim_explain.js');
const M = Mesh, X = SimExplain; let fails = 0, n = 0;
function ok(c, m) { n++; console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const S = () => M.state(), K = () => S().keys;
function untilStop(pid, max) { let i = 0; while (M.stats(pid).canMove && i++ < (max || 400)) M.step(); }
function until(f, max) { let i = 0; while (!f() && i++ < (max || 400)) M.step(); return f(); }
const EM = () => M.createRequest(K().A, { kind: 'urgent', category: 'Medical', title: 'Medical help needed', description: 'needs a doctor', area: 'Hauz Khas Village', urgent: true });
const MP = () => M.createRequest(K().A, { kind: 'missing', category: 'Missing', title: 'Looking for Meera', description: 'd', area: 'Lodhi Road bus stop', urgent: false, targets: ['LC'], lastKnown: 'Lodhi Colony' });
function join() { const D = K().D; return M.join(D, M.sharers(D)[0]); }
/* The expected wording lives HERE, independent of the implementation. */
const WORDS = {
  offer:    { saved: 'Offer saved on this phone', forwarded: 'Offer forwarded to a nearby phone', received: 'Offer received', acknowledged: 'Offer acknowledged', ackedByRequester: 'Requester acknowledged the offer' },
  sighting: { saved: 'Possible sighting saved on this phone', forwarded: 'Sighting report forwarded to a nearby phone', received: 'Possible sighting received', acknowledged: 'Sighting acknowledged', ackedByRequester: 'Requester acknowledged the sighting' }
};
const W = k => WORDS[k];
function section(name, fn) { try { fn(); } catch (e) { n++; fails++; console.log('FAIL ' + name + ' threw: ' + String(e.message).slice(0, 120)); } }

/* ================= A. message-type wording through every state ================= */
for (const kind of ['offer', 'sighting']) section('A ' + kind, () => {
  M.reset(); const r = kind === 'offer' ? EM() : MP(), pid = r.packetId, rid = r.requestId, A = K().A; untilStop(pid); join(); untilStop(pid, 400);
  const resp = M.holders(pid).filter(i => i !== A && i !== K().D && M.canRelay(i))[5], w = W(kind);
  ok(M.requestView(resp, rid).label === 'Received on this phone', kind + ': a phone that merely holds the request is not described as having replied');
  const rp = M.createReply(resp, rid, { kind, note: 'Example reply.', area: '' });
  ok(rp.ok && M.requestView(resp, rid).label === w.saved, kind + ' before forwarding, responder sees "' + w.saved + '"');
  ok(M.requestView(A, rid).label !== w.received, kind + ' before delivery, the requester is not told anything arrived');
  M.step();
  ok(M.requestView(resp, rid).label === w.forwarded, kind + ' after the first hand-off, responder sees "' + w.forwarded + '"');
  ok(until(() => M.nodeHas(A, rp.packetId)), kind + ' reply reaches the requester');
  ok(M.requestView(A, rid).label === w.received, kind + ' after delivery, requester sees "' + w.received + '"');
  ok(M.requestView(resp, rid).label === w.forwarded, kind + ' delivery does not tell the responder (no hidden receipt)');
  const ak = M.createAck(A, rp.packetId);
  ok(M.requestView(A, rid).label === w.acknowledged, kind + ' after acknowledging, requester sees "' + w.acknowledged + '"');
  ok(M.requestView(resp, rid).label !== w.ackedByRequester, kind + ' the responder is not told until the acknowledgment arrives');
  ok(until(() => M.nodeHas(resp, ak.packetId)) && M.requestView(resp, rid).label === w.ackedByRequester, kind + ' once it arrives, responder sees "' + w.ackedByRequester + '"');
  const other = kind === 'offer' ? 'sighting' : 'offer', words = [w.saved, w.forwarded, w.received, w.acknowledged, w.ackedByRequester].join(' ').toLowerCase();
  ok(!words.includes(other), kind + ' labels never use the other kind\'s noun');
  ok(!/accept|help is|on the way|dispatch|rescued/i.test(w.ackNote + ' ' + w.note), kind + ' notes claim no acceptance, dispatch or rescue');
  const info = X.packetInfo(ak.packetId);
  ok(/does not mean/.test(info.body) && !/accepted the offer|offer was accepted(?!.*not)/i.test(info.body.replace(/does not mean it was accepted/i,'')) && info.title === (kind === 'offer' ? 'Offer acknowledged' : 'Sighting acknowledged'), kind + ' acknowledgment packet is explained as "seen", not "accepted": ' + info.body);
  const ri = X.packetInfo(rp.packetId);
  ok(/new packet/i.test(ri.priority) && /not guaranteed/.test(ri.priority) && !/Travels with its request/.test(ri.priority), kind + ' reply is explained as its own packet with no guaranteed route');
  ok(!/helper/.test(ri.policyText) && /recipient/.test(ri.policyText), kind + ' reply policy text is about finding the requester, not "a helper"');
  const fr = X.snapshotPlan(); let txt = ''; Object.keys(fr.plans).forEach(k => { if (k.split('|')[1] === rp.packetId) txt = txt || fr.plans[k][0].text; });
  M.reset();
  const rr = kind === 'offer' ? EM() : MP(); untilStop(rr.packetId); join(); untilStop(rr.packetId, 400);
  const e2 = M.holders(rr.packetId).filter(i => i !== K().A && i !== K().D && M.canRelay(i))[5], rp2 = M.createReply(e2, rr.requestId, { kind, note: 'x', area: '' }), f2 = X.frontier(rp2.packetId);
  ok(f2.next.length > 0 && f2.next.every(e => !/Emergency and general requests/.test(e.text) && /recipient/.test(e.text)), kind + ' a reply\'s hop reason does not say "emergency requests go to every neighbour"');
});
M.reset(); { const r = EM(); const ph = M.holders(r.packetId); ok(ph.length === 1 && ph[0] === K().A && M.stats(r.packetId).held === 1, 'the sender holds its own request from creation (so "N phones have it" includes the sender)'); }

/* ================= B. names and places ================= */
M.reset();
ok(['E', 'M', 'S', 'L', 'C'].every(k => X.nm(K()[k]) === 'Phone ' + K()[k]), 'no scripted volunteer/clinic name survives in the normal experience (' + ['E', 'M', 'S', 'L', 'C'].map(k => X.nm(K()[k])).join(', ') + ')');
ok(X.nm(K().A) === 'My phone' && X.nm(K().D) === 'Crossroads phone', 'the requester and bridge phones keep descriptive names');
{ const bad = S().order.filter(i => /clinic|volunteer/i.test(X.nm(i) + X.who(i))); ok(bad.length === 0, 'no phone is named "clinic"/"volunteer" by the explanation layer (checked all 80)'); }
const ZH = {}; S().hoods.forEach(h => ZH[h.id] = h.hood);
const mism = S().order.filter(i => S().nodes[i].hood !== ZH[S().nodes[i].zone]);
section('B names', () => { ok(mism.length === 11 && mism.every(i => X.who(i).includes('declares ' + S().nodes[i].area)), '11 phones declare an area different from the cluster they are drawn in, and every one of them is described by what it declares (' + mism.slice(0, 3).map(i => i + ':' + S().nodes[i].area).join(', ') + '...)');
ok(mism.every(i => ['BS', 'JS', 'CP', 'CK'].includes(S().nodes[i].hood)), 'the mismatches are exactly the phones that declared a neighbouring area (the engine data was not altered to match the drawing)');
{ const p77 = mism.find(i => S().nodes[i].area === 'Connaught Place'); const trusted = M.hoodState(p77); ok(trusted.id === 'CP' && M.hoodDistance('CP', 'LC') === 1, 'routing sees p77 as Connaught Place, one step from Lodhi Colony (not "in" Lodhi Colony), whatever cluster it is drawn in'); }
{ M.reset(); const r = MP(); untilStop(r.packetId); join(); untilStop(r.packetId, 400); const g = X.groupsFor(r.packetId);
  const any = X.packetInfo(r.packetId); ok(/Posted by My phone \(declares Hauz Khas\)/.test(any.from), 'the sender line states what the phone declares, not where it "is": ' + any.from); } });

/* ================= C. before/after: newly connected is a set difference ================= */
for (const kind of ['emergency', 'missing']) section('C ' + kind, () => {
  M.reset(); const r = kind === 'missing' ? MP() : EM(), pid = r.packetId; untilStop(pid); const before = X.snapshotConn(pid), bid = K().D;
  ok(join().ok, kind + ': bridge joins through the engine'); const after = X.snapshotConn(pid), d = X.diffConn(before, after, bid);
  ok(!d.newlyConnected.includes(bid), kind + ': the bridge phone itself is not counted as "newly connected"');
  ok(d.newlyConnected.every(i => !before.connected.includes(i) && !before.holders.includes(i)), kind + ': no phone that was already connected or already held it is counted as new');
  ok(after.holders.length + after.connected.length === before.holders.length + before.connected.length + d.newlyConnected.length + 1, kind + ': connected-after = connected-before + newly connected + the bridge (' + (before.holders.length + before.connected.length) + ' + ' + d.newlyConnected.length + ' + 1 = ' + (after.holders.length + after.connected.length) + ')');
  ok(d.newlyConnected.length < after.connected.length || before.connected.length === 0, kind + ': newly connected (' + d.newlyConnected.length + ') is not the same as everything now connected (' + after.connected.length + ')' + (before.connected.length ? ', which would also count ' + before.connected.length + ' already-connected phone(s)' : ''));
  if (kind === 'missing') ok(d.newlyConnected.length === 31 && after.connected.length === 32 && before.connected.length === 0, 'missing person on the V4.2 topology: 0 already connected, 31 truly new, the bridge is the 32nd connected phone (V4.1 had 1 already connected and 31 new: counting everything now connected would have said 33)');
});

/* ================= D. connected is not eligible ================= */
section('D policy', () => { M.reset(); const r = MP(), pid = r.packetId; untilStop(pid); join(); untilStop(pid, 400); const q = X.reach(pid), sr = X.stopReason(pid);
  ok(!M.stats(pid).canMove && q.eligibleNext.length === 0 && q.connected.length > 0, 'missing person after the bridge: nothing is eligible next, yet ' + q.connected.length + ' phones are connected to a holder');
  ok(q.heldBack.length + q.connectedOther.length === q.connected.length && q.heldNow.length + q.heldFixed.length === q.heldBack.length && q.connectedOther.length > 0, 'those split by the routing plan: ' + q.heldNow.length + ' next to a holder that is not selecting them now, ' + q.heldFixed.length + ' blocked for this copy, ' + q.connectedOther.length + ' not next to any holder');
  ok(q.holders.length === 53 && q.connected.length === 10 && q.heldNow.length === 1 && q.heldFixed.length === 1 && q.connectedOther.length === 8 && q.cutOff.length === 1, 'engine snapshot for the shipped V4.2 topology: 53 hold it, 10 connected (1 not selected now, 1 blocked for this copy, 8 not adjacent), 1 cut off');
  ok(sr.code === 'policy' && sr.connected === q.connected.length && sr.cutOff === q.cutOff.length && sr.cutOff > 0 && sr.cutOff < sr.connected, 'the stop is classified as routing policy (' + sr.connected + ' connected, not eligible) with a separate ' + sr.cutOff + '-phone gap, not "a gap"');
  ok(sr.waiting && sr.wakeTick > M.state().tick, 'and it is reported as not final: a time-based detour is due at minute ' + sr.wakeTick);
  ok(q.cutOff.length === 1 && X.groupsFor(pid).cutOff.length === 1, 'only genuinely disconnected phones are called cut off');
  const e = X.neighbours(q.heldBack[0], pid); ok(e.length > 0, 'a held-back phone can be inspected');
});
section('D flood', () => { M.reset(); const r = EM(), pid = r.packetId; untilStop(pid); const sr = X.stopReason(pid); ok(sr.code === 'gap' && sr.bridge === K().D, 'emergency first stall: classified as a gap at the bridge phone');
  join(); const q = X.reach(pid); ok(q.eligibleNext.length > 0 && M.stats(pid).canMove, 'flood after the bridge: some phones are eligible next step, and the packet can move'); });
section('D invariant', () => { /* invariant over every step of both flows: eligible-next is exactly the engine plan; canMove iff something is eligible */
  let viol = 0, steps = 0; for (const kind of ['emergency', 'missing']) { M.reset(); const r = kind === 'missing' ? MP() : EM(), pid = r.packetId;
    for (let i = 0; i < 160; i++) { if (i === 25 && !S().nodes[K().D].hasApp) join(); const q = X.reach(pid), fr = X.frontier(pid), st = M.stats(pid), nxt = new Set(fr.next.map(e => e.to));
      const expired = M.isExpired(S().packets[pid]); if (!expired && ((q.eligibleNext.length > 0) !== st.canMove || q.eligibleNext.some(x => !nxt.has(x)) || [...nxt].some(x => !q.eligibleNext.includes(x)))) viol++;
      if (q.holders.length + q.connected.length + q.cutOff.length + q.noRelay.length !== 80) viol++; M.step(); steps++; } }
  ok(viol === 0, 'eligible-next equals the engine plan, canMove iff something is eligible, and the five groups always partition 80 phones (' + steps + ' steps)'); });

/* ================= E. a forwarding decision is a statement about ONE tick ================= */
section('E decision', () => { M.reset(); const r = MP(), pid = r.packetId; M.step();
  /* every forwarding verdict is computed from the engine at the moment it is asked, and says which kind of verdict it is */
  const f1 = X.frontier(pid); ok(f1.next.length > 0 && f1.next.every(e => M.plan(e.from, pid).some(c => c.d === e.to)), 'the next-step list is exactly the engine plan at this tick (' + f1.next.length + ' hand-offs)');
  ok(f1.held.every(e => X.decide(e.from, e.to, pid).verdict === 'withhold' && e.lasting && !/will not receive/i.test(e.text)), 'every not-selected neighbour carries a duration and never says "will not receive" (' + f1.held.length + ')');
  const before = JSON.stringify(f1.next.map(e => e.from + '>' + e.to)); M.step(); M.step();
  ok(JSON.stringify(X.frontier(pid).next.map(e => e.from + '>' + e.to)) !== before, 'two minutes later the list is different: it is recomputed, never remembered');
  M.reset(); const r2 = MP(), p2 = r2.packetId; let changed = 0, last = ''; for (let i = 0; i < 7; i++) { const f = X.frontier(p2), k = JSON.stringify([f.next.map(e => e.from + '>' + e.to + e.code), f.held.map(e => e.from + '>' + e.to + e.code)]); if (k !== last) changed++; last = k; M.step(); }
  ok(changed >= 5, 'the forwarding plan changes almost every tick, so a cached explanation would go stale (' + changed + ' distinct plans in 7 ticks)'); });

/* ================= F. expiry ================= */
section('F expiry', () => { M.reset(); const r = EM(), pid = r.packetId; let steps = 0; while (!M.isExpired(S().packets[pid]) && steps++ < 400) M.step();
  const sr = X.stopReason(pid); ok(M.isExpired(S().packets[pid]) && sr.code === 'expired' && sr.lifetime === 90, 'expiry is its own stop reason (lifetime ' + sr.lifetime + ' simulated minutes)');
  ok(X.bridge(pid) === null, 'an expired message has no "bridge" explanation (it was stopped by its lifetime, not by a gap)');
  ok(M.requestView(K().A, r.requestId).label === 'Expired' && M.createReply(M.holders(pid)[1], r.requestId, { kind: 'offer', note: 'x', area: '' }).ok === false, 'the author sees "Expired" and the engine refuses new replies'); });

/* ================= G. location and report framing in message text ================= */
{ M.reset(); const e = M.createRequest(K().A, { kind: 'urgent', category: 'Medical', title: 'Medical help needed in Hauz Khas', description: 'x', area: 'Hauz Khas', urgent: true });
  ok(X.packetInfo(e.packetId).from.includes('declares ' + S().nodes[K().A].area), 'request sender text matches the declared area'); }

console.log(fails ? ('FAILED ' + fails + ' of ' + n) : ('ALL ' + n + ' SEMANTIC (ENGINE LEVEL) TESTS PASSED'));
process.exit(fails ? 1 : 0);
