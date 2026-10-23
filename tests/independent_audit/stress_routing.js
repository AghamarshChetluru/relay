'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');const context={window:{},console};vm.runInNewContext(fs.readFileSync(__dirname+'/mesh.js','utf8'),context);const M=context.window.Mesh;const all=[];
M.reset();const o=M.state().order.filter(id=>M.canRelay(id)),hs=M.NEIGHBORHOODS.map(x=>x.id);
const t0=Date.now();let total=0,passed=0,failed=0,delivered=0,holes=0;
for(let i=0;i<Math.min(12,o.length);i++)for(let j=0;j<hs.length;j++){
  M.reset();let s=M.state();s.opts.autoConfirm=true; const D=s.keys.D, sharer=M.sharers(D)[0];if(sharer)M.join(D,sharer);const id=o[i],target=hs[j];if(!M.canRelay(id))continue;
  const r=M.createRequest(id,{kind:'missing',category:'Missing',title:'Search case',description:'description',area:'last known place',areaHood:target,targets:[target],validity:1440,urgent:false});
  if(!r.ok){failed++;continue}
  let p=s.packets[r.packetId],policy=p.route.policy;assert.equal(policy,'directed');
  for(let n=0;n<80;n++)M.step();
  const h=M.holders(r.packetId).filter(x=>M.canRelay(x));assert(h.includes(id));assert(new Set(h).size===h.length);
  const tgt=h.some(x=>M.state().nodes[x].hood===target);
  if(tgt)delivered++;
  if(h.length===1)holes++;
  const st=M.state();const cap=Object.keys(st.inbox).reduce((max,id)=>Math.max(max,Object.keys(st.inbox[id]).length),0);
  assert(cap<100);passed++;total++;
}
console.log(JSON.stringify({scenarios:total,passed,failed,targetAreaReached:delivered,sourceOnlyCases:holes,elapsedMs:Date.now()-t0},null,2));if(failed) process.exitCode=1;
