global.window=global;require(require('path').resolve(process.argv[2]||'../relay-prototype','mesh.js'));const M=Mesh;
function run(kind,src,targets,steps){
  M.reset();const S=M.state();M.join(S.keys.D,M.sharers(S.keys.D)[0]);
  const r=M.createRequest(src,{kind:kind,title:'t',description:'d',area:'x',urgent:kind!=='missing',targets:targets,validity:1440});
  let moved=0;for(let i=0;i<steps;i++){moved+=M.step();}
  const hs=M.holders(r.packetId);return {hs:hs,S:S,moved:moved,pid:r.packetId};
}
M.reset();const S0=M.state();const srcs=S0.order.filter(i=>S0.nodes[i].hasApp&&i!==S0.keys.D);
const hoods=M.NEIGHBORHOODS.map(h=>h.id);
let stuck=[],tot=0,ratio=[],noPhones=0,detail={};
hoods.forEach(h=>{
  const inTarget=S0.order.filter(i=>S0.nodes[i].hood===h&&S0.nodes[i].hasApp);
  if(!inTarget.length){noPhones++;return}
  let reached=0,cnt=0,fl=0,dr=0;
  srcs.forEach(s=>{
    const f=run('missing',s,[],0); // placeholder to reset
    const flood=run('urgent',s,[],120);const fh=flood.hs.filter(i=>S0.nodes[i].hood===h).length;
    const dir=run('missing',s,[h],120);const dh=dir.hs.filter(i=>dir.S.nodes[i].hood===h).length;
    tot++;cnt++;
    if(fh>0&&dh===0)stuck.push(s+'->'+h);
    if(dh>0)reached++;
    fl+=flood.hs.length;dr+=dir.hs.length;
  });
  detail[h]={targetPhones:inTarget.length,sourcesReaching:reached+'/'+cnt,avgFloodHolders:Math.round(fl/cnt),avgDirectedHolders:Math.round(dr/cnt)};
});
console.log(JSON.stringify(detail,null,1));
console.log('stuck (flood reaches target, directed does not):',stuck.length,'of',tot,stuck.slice(0,12).join(' '));
