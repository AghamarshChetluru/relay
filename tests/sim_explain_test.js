/* Truthfulness tests for the simulator's explanations (prototype/sim_explain.js) against the engine (prototype/mesh.js).
   usage: node tests/sim_explain_test.js [prototype-dir]
   The question each test answers: "could a networking engineer catch the explanation saying something the engine did not do?" */
global.window = global; const dir = require('path').resolve(process.argv[2] || require('path').join(__dirname, '../prototype'));
require(dir + '/mesh.js'); require(dir + '/sim_explain.js');
const M = Mesh, X = SimExplain; let fails = 0, n = 0;
function ok(c, m) { n++; console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const U = (node, o) => M.createRequest(node, Object.assign({ kind: 'urgent', category: 'Medical', title: 'Medical help needed near Hauz Khas Village', description: 'My mother needs medical assistance.', area: 'Hauz Khas Village', urgent: true }, o || {}));
const MP = (node, o) => M.createRequest(node, Object.assign({ kind: 'missing', category: 'Missing', title: 'Looking for Meera, 8, red school bag', description: 'Last seen near the bus stop.', area: 'Lodhi Road bus stop', urgent: false, targets: ['LC'], lastKnown: 'Lodhi Colony' }, o || {}));
const stats = { pairs: 0, sends: 0, detours: 0, withholds: 0, capacity: 0, raced: 0, unexplained: 0, other: 0, steps: 0, codes: {} };

/* one audited step: every pre-step decision is checked against Mesh.plan, every real hand-off against the pre-step plan */
function auditedStep() {
  const S = M.state(), pids = Object.keys(S.packets);
  /* (a) decision cascade is exhaustive and agrees with the engine's own plan */
  pids.forEach(pid => M.holders(pid).forEach(src => {
    if (!M.canRelay(src)) return;
    const planned = {}; M.plan(src, pid).forEach(c => planned[c.d] = c);
    S.adj[src].forEach(dst => {
      const d = X.decide(src, dst, pid); if (d.verdict === 'none') return; stats.pairs++;
      stats.codes[d.code] = (stats.codes[d.code] || 0) + 1;
      const inPlan = !!planned[dst], says = d.verdict === 'send' || d.verdict === 'detour';
      if (inPlan !== says) { ok(false, 'decision disagrees with Mesh.plan ' + src + '>' + dst + ' ' + pid + ': ' + JSON.stringify(d)); }
      if (inPlan && (d.verdict === 'detour') !== !!planned[dst].det) ok(false, 'detour flag disagrees with engine ' + src + '>' + dst);
      if (d.code === 'other' || !d.text) ok(false, 'no explanation for ' + src + '>' + dst + ' ' + pid + ' verdict=' + d.verdict);
      if (d.verdict === 'send') stats.sends++; else if (d.verdict === 'detour') stats.detours++; else if (d.verdict === 'withhold') stats.withholds++;
    });
  }));
  const before = X.snapshotPlan(), had = {}; pids.forEach(pid => had[pid] = M.holders(pid).length);
  const moved = M.step(), rep = X.report(before); stats.steps++;
  /* (b) every real hand-off was planned, and vice versa (no animation without an engine event, no engine event without an explanation) */
  const realKeys = S.lastHops.map(m => m.from + '|' + m.to + '|' + m.packetId).sort(), repKeys = rep.moves.map(m => m.from + '|' + m.to + '|' + m.pid).sort();
  if (JSON.stringify(realKeys) !== JSON.stringify(repKeys)) ok(false, 'report moves != engine lastHops at tick ' + S.tick);
  if (rep.moves.length !== moved) ok(false, 'report count != step() return');
  rep.moves.forEach(m => { const e = S.inbox[m.to][m.pid], f = S.inbox[m.from][m.pid]; if ((e.detours - f.detours === 1) !== m.det) ok(false, 'detour flag differs from inbox record ' + m.from + '>' + m.to); if (e.via !== m.from) ok(false, 'via differs'); });
  rep.waited.forEach(w => { stats[w.code] = (stats[w.code] || 0) + 1; if (w.code === 'unexplained') ok(false, 'a planned hand-off neither happened nor has a reason ' + w.from + '>' + w.to); });
  pids.forEach(pid => { const gained = M.holders(pid).length - had[pid]; if (gained !== rep.moves.filter(m => m.pid === pid).length) ok(false, 'holders gained != moves for ' + pid); });
  return rep;
}
function run(maxSteps, until) { let i = 0; while (i++ < maxSteps && !(until && until())) auditedStep(); }
function groupsAudit(pid, label) {
  const S = M.state(), g = X.groupsFor(pid), st = M.stats(pid), all = g.holders.length + g.reachable.length + g.cutOff.length + g.noRelay.length;
  if (all !== 80) ok(false, label + ': partition is not 80'); if (g.holders.length !== st.held) ok(false, label + ': holders != stats.held');
  if (g.holders.length + g.reachable.length + g.cutOff.length !== st.participating) ok(false, label + ': relay phones != stats.participating');
  if (g.noRelay.some(id => M.nodeHas(id, pid))) ok(false, label + ': a no-Relay phone holds the message');
  const fr = X.frontier(pid), canMove = fr.next.length > 0 && !M.isExpired(S.packets[pid]);
  if (canMove !== st.canMove) ok(false, label + ': frontier.next non-empty (' + canMove + ') != stats.canMove (' + st.canMove + ')');
  /* reachable-but-not-held phones must be Relay, in a holder's group, and NOT counted as received */
  if (g.reachable.some(id => !M.canRelay(id) || M.nodeHas(id, pid))) ok(false, label + ': reachable list contains a holder or non-Relay phone');
}

/* ===== 1. emergency (flood) from fresh load to final acknowledgment ===== */
M.reset(); let S = M.state(), K = S.keys;
let r = U(K.A), pid = r.packetId;
ok(X.packetInfo(pid).title === S.requests[r.requestId].title && X.packetInfo(pid).policy === 'flood', 'message card text comes from the engine request');
groupsAudit(pid, 'e0');
run(200, () => !M.stats(pid).canMove); groupsAudit(pid, 'e-stall');
let st = M.stats(pid), br = X.bridge(pid);
ok(!M.stats(pid).canMove && st.blocked && !M.nodeHas(K.E, pid), 'emergency stalls at the gap and does not reach the volunteer');
ok(br && br.id === K.D && br.unlock > 0 && br.holdSide > 0 && br.links >= 2, 'bridge phone identified from engine (' + (br && br.name) + ', unlocks ' + (br && br.unlock) + ')');
const fr0 = X.frontier(pid); ok(fr0.next.length === 0 && X.groupsFor(pid).cutOff.length > 0, 'stalled: no hand-off possible; cut-off phones are separate from reached ones');
ok(X.groupsFor(pid).reachable.length === 0, 'stalled flood: nothing is merely "reachable" (everything connected already holds it)');
const before = X.connectivity(pid), holdersBefore = M.holders(pid).length;
ok(M.join(K.D, M.sharers(K.D)[0]).ok, 'bridge installs via the engine join()');
const after = X.connectivity(pid);
ok(after.groups < before.groups && after.reachable > 0 && after.holders === before.holders, 'install: groups merge (' + before.groups + '->' + after.groups + '), newly REACHABLE ' + after.reachable + ' but received unchanged (' + after.holders + ')');
const fr1 = X.frontier(pid); ok(fr1.next.length > 0 && fr1.next.every(h => h.from === K.D || M.nodeHas(h.from, pid)), 'after install the frontier shows real next hand-offs');
run(300, () => M.nodeHas(K.E, pid)); groupsAudit(pid, 'e-cross');
ok(M.nodeHas(K.E, pid), 'message crosses the bridge and reaches the volunteer');
const ch = X.chain(pid, K.E); ok(ch[0] === K.A && ch[ch.length - 1] === K.E && ch.includes(K.D) && ch.every((id, i) => i === 0 || S.adj[id].includes(ch[i - 1])), 'forwarding chain from origin to volunteer is a real path through the bridge: ' + ch.length + ' phones');
let rp = M.createReply(K.E, r.requestId, { kind: 'offer', note: 'I can walk your mother to the clinic gate.', area: 'Clinic gate' }); ok(rp.ok, 'volunteer reply created by engine');
ok(X.packetInfo(rp.packetId).badge === 'Unverified' && /nurse|walk/.test(X.packetInfo(rp.packetId).body), 'reply card is the engine payload, labelled unverified');
run(300, () => M.nodeHas(K.A, rp.packetId)); ok(M.nodeHas(K.A, rp.packetId), 'reply travels back to the requester');
let ak = M.createAck(K.A, rp.packetId); run(300, () => M.nodeHas(K.E, ak.packetId)); ok(M.nodeHas(K.E, ak.packetId), 'acknowledgment reaches the volunteer');

/* ===== 2. missing person (directed): reasons must come from the neighbourhood graph ===== */
M.reset(); S = M.state(); K = S.keys; r = MP(K.A); pid = r.packetId;
ok(X.packetInfo(pid).policy === 'directed' && X.hoodName(X.packetInfo(pid).targets[0]) === 'Lodhi Colony', 'missing-person route is directed at Lodhi Colony');
run(250, () => !M.stats(pid).canMove); groupsAudit(pid, 'm-stall');
M.join(K.D, M.sharers(K.D)[0]); run(250, () => !M.stats(pid).canMove || M.nodeHas(K.E, pid)); groupsAudit(pid, 'm-cross');
const hg = X.hoodGraph(pid); const lc = hg.rows.filter(x => x.id === 'LC')[0];
ok(lc.dist === 0 && hg.rows.filter(x => x.id === 'SE')[0].dist === 1 && hg.rows.filter(x => x.id === 'HK')[0].dist === 2, 'neighbourhood graph distances come from the engine graph');
ok(hg.rows.reduce((a, x) => a + x.holders, 0) <= M.stats(pid).held, 'holders counted per declared area never exceed engine held count');
const gapReason = Object.keys(stats.codes);
ok(stats.codes.closer > 0 && (stats.codes['same-area'] || 0) + (stats.codes.equal || 0) > 0, 'directed explanations include "closer" and same-area/equal forwarding (' + JSON.stringify(stats.codes) + ')');
ok((stats.codes.detour || 0) + (stats.codes.farther || 0) + (stats.codes['too-far'] || 0) + (stats.codes.fanout || 0) > 0, 'directed run produced detour/held-back explanations too (not just the easy cases)');

/* ===== 3. community broadcast + urgent request: real priority ordering ===== */
M.reset(); S = M.state(); K = S.keys;
const b1 = M.createBroadcast(K.L, { text: 'Water collection point open at City Hall, north entrance.', category: 'Resources', area: 'Vasant Vihar' });
run(200, () => !M.stats(b1.packetId).canMove); ok(!M.nodeHas(K.A, b1.packetId), 'broadcast alone stalls at the gap'); M.join(K.D, M.sharers(K.D)[0]); run(300, () => M.nodeHas(K.A, b1.packetId)); groupsAudit(b1.packetId, 'b-cross');
const b2 = M.createBroadcast(K.L, { text: 'Second update: queue is moving slowly.', category: 'Community', area: 'Vasant Vihar' }); const u = U(K.L, { area: 'Vasant Vihar', title: 'Medical help needed near the market' });
ok(S.packets[u.packetId].prio < S.packets[b2.packetId].prio, 'urgent request has higher priority than a community update (engine prio ' + S.packets[u.packetId].prio + ' < ' + S.packets[b2.packetId].prio + ')');
let sawOrder = 0, wrong = 0;
for (let i = 0; i < 25; i++) {
  const rep = auditedStep();
  rep.waited.filter(w => w.code === 'capacity').forEach(w => { sawOrder++; if (S.packets[w.winner].prio > S.packets[w.pid].prio) wrong++; });
}
ok(sawOrder > 0, 'link capacity made some message wait in the broadcast+urgent run (' + sawOrder + ' waits)');
ok(wrong === 0, 'every time a link was contested, the higher-priority message went first (engine ordering shown, not asserted by the presentation)');
ok(M.holders(u.packetId).length >= M.holders(b2.packetId).length, 'urgent request reached at least as many phones as the contemporaneous update');

/* ===== 4. expiry / hop limit are reported, not hidden ===== */
M.reset(); S = M.state(); K = S.keys; r = U(K.A, { validity: 30 }); pid = r.packetId; run(3);
S.tick = S.packets[pid].expiresTick;   // test-only: let the lifetime run out while the message is still spreading
ok(M.isExpired(S.packets[pid]), 'message expires in engine'); const exp = X.frontier(pid);
ok(exp.next.length === 0 && exp.stop && exp.stop.code === 'expired', 'expired message: frontier empty and the reason is "expired"');
/* ===== 5. pure read-only: explanation calls never change engine state ===== */
M.reset(); S = M.state(); K = S.keys; r = U(K.A); run(5); const snap = JSON.stringify([S.tick, S.inbox, S.outbox, S.lastHops]);
X.frontier(r.packetId); X.groupsFor(r.packetId); X.neighbours(K.A, r.packetId); X.snapshotPlan(); X.bridge(r.packetId); X.hoodGraph(r.packetId);
ok(snap === JSON.stringify([S.tick, S.inbox, S.outbox, S.lastHops]), 'explanation functions are read-only');
console.log('audited steps=' + stats.steps + ' decision pairs=' + stats.pairs + ' sends=' + stats.sends + ' detours=' + stats.detours + ' withheld=' + stats.withholds + ' capacity-waits=' + (stats.capacity || 0) + ' codes=' + JSON.stringify(stats.codes));
console.log(fails ? ('FAILED ' + fails + ' of ' + n) : ('ALL ' + n + ' SIMULATOR EXPLANATION TESTS PASSED'));
process.exit(fails ? 1 : 0);
