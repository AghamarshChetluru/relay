global.window=global;require(require('path').resolve('../relay-prototype','mesh.js'));const M=Mesh;
M.ROUTE.patientExtra=0;M.ROUTE.patience=999;
M.reset();const S0=M.state();const srcs=S0.order.filter(i=>S0.nodes[i].hasApp&&i!==S0.keys.D);
function run(kind,src,t,steps){M.reset();const S=M.state();M.join(S.keys.D,M.sharers(S.keys.D)[0]);const r=M.createRequest(src,{kind:kind,title:'t',area:'x',urgent:kind!=='missing',targets:[t],validity:1440});for(let i=0;i<steps;i++)M.step();return {hs:M.holders(r.packetId),S:S,pid:r.packetId}}
const stuck=[];
['CP','LC','VV','JS','LN','HK','GP','SE','CK','BS'].forEach(t=>srcs.forEach(s=>{const f=run('urgent',s,t,100);if(!f.hs.some(i=>f.S.nodes[i].hood===t))return;const d=run('missing',s,t,100);if(!d.hs.some(i=>d.S.nodes[i].hood===t))stuck.push([s,t,d.S.nodes[s].zone+'/'+d.S.nodes[s].hood,d.hs.length])}));
console.log('stuck without escalation:',stuck.length);stuck.slice(0,20).forEach(x=>console.log(x.join(' ')));
// diagnose first stuck
if(stuck.length){const [s,t]=stuck[0];const d=run('missing',s,t,100);const S=d.S;console.log('diagnose',s,'->',t);d.hs.forEach(h=>{const e=S.inbox[h][d.pid];const lack=S.adj[h].filter(x=>M.canRelay(x)&&!M.nodeHas(x,d.pid));if(lack.length)console.log(h,S.nodes[h].hood,'det',e.detours,'tgt',!!e.tgt,'sentGood',(S.outbox[h][d.pid]||{}).good,'lacking',lack.map(x=>x+':'+S.nodes[x].hood).join(','))})}
