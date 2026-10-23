global.window=global;require(require('path').resolve('../relay-prototype','mesh.js'));const M=Mesh;
M.reset();const S0=M.state();const srcs=S0.order.filter(i=>S0.nodes[i].hasApp&&i!==S0.keys.D);
const hoods=['HK','CP','LC','VV','LN','JS','GP','SE'];
function first(kind,src,h,targets){M.reset();const S=M.state();M.join(S.keys.D,M.sharers(S.keys.D)[0]);
  const r=M.createRequest(src,{kind:kind,title:'t',area:'x',urgent:kind!=='missing',targets:targets,validity:1440});
  for(let i=1;i<=160;i++){M.step();const hs=M.holders(r.packetId);if(hs.some(id=>S.nodes[id].hood===h)){return {t:i,n:hs.length}}}return null}
const cache={};function flood(s,h){const k=s+h;if(!cache[k])cache[k]=first('urgent',s,h,[]);return cache[k]}
function evalCfg(c){M.ROUTE.directedFanout=c[0];M.ROUTE.detourMax=c[1];M.ROUTE.detourAway=1;M.ROUTE.patience=c[2];M.ROUTE.patientExtra=2;
  let n=0,stuck=0,sumT=0,sumN=0,fT=0,fN=0;
  hoods.forEach(h=>srcs.forEach(s=>{const f=flood(s,h);if(!f)return;const d=first('missing',s,h,[h]);n++;fT+=f.t;fN+=f.n;if(!d){stuck++;return}sumT+=d.t;sumN+=d.n}));
  return {cfg:c.join('/'),pairs:n,stuck,avgStepsToTarget:(sumT/(n-stuck)).toFixed(1),avgPhonesCarrying:(sumN/(n-stuck)).toFixed(1),floodSteps:(fT/n).toFixed(1),floodPhones:(fN/n).toFixed(1)}}
[[3,1,16]].forEach(c=>console.log(JSON.stringify(evalCfg(c))));
