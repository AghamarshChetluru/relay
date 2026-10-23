'use strict';
const fs = require('fs'); const vm = require('vm'); const assert = require('assert');
const ctx={window:{},console};vm.runInNewContext(fs.readFileSync(__dirname+'/mesh.js','utf8'),ctx,{filename:'mesh.js'});const M=ctx.window.Mesh;
let count=0, failed=[];function test(name,fn){try{M.reset();fn();count++; console.log('PASS',name);}catch(e){failed.push({name,error:e.stack});console.log('FAIL',name,e.message)}}
function advance(n){for(let i=0;i<n;i++) M.step()}
function req(n,f){return M.createRequest(n,Object.assign({kind:'urgent',category:'Medical',title:'Need help',description:'A medical need',area:'Somewhere',urgent:true,validity:60},f||{}))}
const ks=()=>M.state().keys;
test('80 simulated nodes and finite connectivity',()=>{const s=M.state();assert.equal(s.order.length,80);assert(s.edges.length>=79); assert(s.keys.A); assert(s.keys.D)});
test('all phones do not automatically have Relay',()=>{const s=M.state(); assert(s.order.filter(x=>s.nodes[x].hasApp).length<80);});
test('request persisted in origin inbox in simulation',()=>{let x=req(ks().A);assert(x.ok); assert(M.nodeHas(ks().A,x.packetId))});
test('urgent request uses flooding policy',()=>{let x=req(ks().A);assert.equal(M.state().packets[x.packetId].route.policy,'flood')});
test('missing known destination uses directed policy',()=>{let x=req(ks().A,{kind:'missing',urgent:false,validity:1440,targets:['CP']});assert.equal(M.state().packets[x.packetId].route.policy,'directed')});
test('missing unknown destination uses opportunistic fallback',()=>{let x=req(ks().A,{kind:'missing',urgent:false,validity:1440,targets:[]});assert.equal(M.state().packets[x.packetId].route.policy,'opportunistic')});
test('broadcast uses lower priority and 45 min expiry',()=>{let x=M.createBroadcast(ks().A,{text:'A local update'});assert(x.ok);let p=M.state().packets[x.packetId];assert.equal(p.prio,2);assert.equal(p.expiresTick,45)});
test('empty broadcast rejected',()=>{assert.equal(M.createBroadcast(ks().A,{text:'  '}).ok,false)});
test('overlimit broadcast rejected',()=>{assert.equal(M.createBroadcast(ks().A,{text:'x'.repeat(281)}).ok,false)});
test('urgent expiry after 30 steps',()=>{let x=req(ks().A,{validity:30});advance(30);assert(M.isExpired(M.state().packets[x.packetId]))});
test('expired request no longer advances',()=>{let x=req(ks().A,{validity:1});advance(1);let before=M.holders(x.packetId).length;advance(8);assert.equal(M.holders(x.packetId).length,before)});
test('renewal same case new packet',()=>{let x=req(ks().A,{validity:30});advance(30);let y=M.renewRequest(ks().A,x.caseId);assert(y.ok);assert.equal(y.caseId,x.caseId);assert.notEqual(y.packetId,x.packetId);assert.equal(M.state().requests[x.caseId].versions.length,2)});
test('renewal projects to one received case on original phone',()=>{let x=req(ks().A,{validity:30});advance(30);M.renewRequest(ks().A,x.caseId);assert.equal(M.receivedCases(ks().A).filter(z=>z.id===x.caseId).length,1)});
test('requests cannot be renewed from non-author',()=>{let x=req(ks().A);assert.equal(M.renewRequest(ks().E,x.caseId).ok,false)});
test('recent duplicate packets do not duplicate inbox',()=>{let x=req(ks().A);advance(12);for (const id of M.state().order) assert(Object.keys(M.state().inbox[id]).filter(p=>p===x.packetId).length<=1)});
test('request sent to one adjacent active phone',()=>{let x=req(ks().A);advance(12);assert(M.holders(x.packetId).length>1)});
test('no relaying to a non-installed phone',()=>{let x=req(ks().A);advance(15);assert(!M.nodeHas(ks().D,x.packetId))});
test('joining offline device requires a participating neighbour',()=>{let id=ks().D;let res=M.join(id,ks().A);assert.equal(res.ok,false)});
test('correctly joining bridge can unlock flow',()=>{let id=ks().D;let sh=M.sharers(id)[0];assert(sh);assert(M.join(id,sh).ok);let x=req(ks().A);advance(80);assert(M.holders(x.packetId).length>15)});
test('location turns stale after 61 minutes',()=>{let id=ks().A;advance(61);assert(M.hoodState(id).stale)});
test('confirming neighbourhood restores reliability',()=>{let id=ks().A;advance(61);M.confirmHood(id);assert(M.hoodState(id).reliable)});
test('case origin can access original exact address only',()=>{let x=req(ks().A,{privateAddress:{building:'Flat 202',directions:'White door'}});assert.equal(M.ownAddress(ks().A,x.caseId).building,'Flat 202'); assert.equal(M.ownAddress(ks().E,x.caseId),null)});
test('private address not in original request payload',()=>{let x=req(ks().A,{privateAddress:{building:'Flat 202',directions:'White door'}});const p=M.state().packets[x.packetId];assert(!JSON.stringify(p.payload).includes('Flat 202'))});
test('SECURITY AUDIT: exact address is exposed in plaintext address packet',()=>{let x=req(ks().A,{privateAddress:{building:'Flat 202',directions:'White door'}});advance(2);let volunteer=M.holders(x.packetId).find(v=>v!==ks().A);assert(volunteer);let r=M.createReply(volunteer,x.caseId,{note:'I can help'});assert(r.ok);advance(3);assert(M.nodeHas(ks().A,r.packetId));let share=M.shareAddress(ks().A,r.packetId);assert(share.ok);let pkt=M.state().packets[share.packetId];assert.equal(pkt.payload.building,'Flat 202');assert.equal(pkt.payload.directions,'White door');});
test('photo attachment is a separate low priority packet',()=>{let x=req(ks().A,{photo:{dataUrl:'data:image/jpeg;base64,AAECAwQ=',bytes:5,w:1,h:1,mime:'image/jpeg'}});let p=Object.values(M.state().packets).find(p=>p.type==='attachment');assert(p);assert.equal(p.prio,2);assert.equal(p.requestId,x.caseId)});
test('reply prohibited if no request was received',()=>{let x=req(ks().A);let r=M.createReply(ks().E,x.caseId,{note:'I can help'});assert.equal(r.ok,false)});
test('replies accepted from actual received devices',()=>{let x=req(ks().A);advance(8);let n=M.holders(x.packetId).find(n=>n!==ks().A);assert(n);let r=M.createReply(n,x.caseId,{note:'I can help'});assert(r.ok)});
test('resolved request author prevents renewal',()=>{let x=req(ks().A);let y=M.createResolve(ks().A,x.caseId);assert(y.ok);assert.equal(M.renewRequest(ks().A,x.caseId).ok,false)});
console.log(`\nRESULT ${count}/${count+failed.length} passing`);if(failed.length){for(let f of failed)console.log(f.error);process.exitCode=1;}
