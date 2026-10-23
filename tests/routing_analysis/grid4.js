global.window=global;require(require('path').resolve('../relay-prototype','mesh.js'));const M=Mesh;
M.reset();const S0=M.state();const srcs=S0.order.filter(i=>S0.nodes[i].hasApp&&i!==S0.keys.D);
function run(kind,src,t,steps){M.reset();const S=M.state();M.join(S.keys.D,M.sharers(S.keys.D)[0]);const r=M.createRequest(src,{kind:kind,title:'t',area:'x',urgent:kind!=='missing',targets:[t],validity:1440});let first=null;for(let i=1;i<=steps;i++){M.step();if(first===null&&M.holders(r.packetId).some(id=>S.nodes[id].hood===t))first=i}return {hs:M.holders(r.packetId),S:S,first:first}}
const T=['CP','LC','VV','JS','LN','HK','GP','SE','CK','BS'];
const flood={};T.forEach(t=>srcs.forEach(s=>{flood[s+t]=run('urgent',s,t,100)}));
function cfg(F,D,P,X,A){M.ROUTE.directedFanout=F;M.ROUTE.detourMax=D;M.ROUTE.patience=P;M.ROUTE.patientExtra=X;M.ROUTE.detourAway=A;
 let n=0,stuck=0,fin=0,ffin=0,fs=0,ds=0,m=0;
 T.forEach(t=>srcs.forEach(s=>{const f=flood[s+t];if(f.first===null)return;const d=run('missing',s,t,100);n++;ffin+=f.hs.length;fin+=d.hs.length;if(d.first===null){stuck++}else{ds+=d.first;fs+=f.first;m++}}));
 return {F,D,P,X,A,pairs:n,stuck,finalHolders:(fin/n).toFixed(1),floodFinal:(ffin/n).toFixed(1),stepsToTarget:(ds/m).toFixed(1),floodSteps:(fs/m).toFixed(1)}}
[[3,1,999,0,1],[3,1,8,1,1],[3,1,16,1,1],[3,1,30,1,1],[3,1,16,2,1],[3,2,999,0,1],[3,2,999,0,2],[2,2,999,0,2],[3,2,16,1,1]].forEach(c=>console.log(JSON.stringify(cfg.apply(null,c))));
