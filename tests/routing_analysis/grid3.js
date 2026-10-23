global.window=global;require(require('path').resolve('../relay-prototype','mesh.js'));const M=Mesh;
M.reset();const S0=M.state();const srcs=S0.order.filter(i=>S0.nodes[i].hasApp&&i!==S0.keys.D);
const hoods=['HK','CP','LC','VV','LN','JS','GP','SE','CK','BS'];
function run(kind,src,targets){M.reset();const S=M.state();M.join(S.keys.D,M.sharers(S.keys.D)[0]);const r=M.createRequest(src,{kind:kind,title:'t',area:'x',urgent:kind!=='missing',targets:targets,validity:1440});let firstT=null;for(let i=1;i<=160;i++){M.step();if(firstT===null&&M.holders(r.packetId).some(id=>S.nodes[id].hood===targets[0]||false))firstT=i;}return {hs:M.holders(r.packetId),S:S,firstT:firstT}}
let n=0,stuck=0,dTot=0,fTot=0,inT=0;
hoods.forEach(h=>srcs.forEach(s=>{const f=run('urgent',s,[h]);const fReach=f.hs.some(i=>f.S.nodes[i].hood===h);if(!fReach)return;const d=run('missing',s,[h]);n++;fTot+=f.hs.length;dTot+=d.hs.length;if(!d.hs.some(i=>d.S.nodes[i].hood===h))stuck++;}));
console.log(JSON.stringify({pairs:n,stuck,avgHoldersAfter160_flood:(fTot/n).toFixed(1),avgHoldersAfter160_directed:(dTot/n).toFixed(1)}));
