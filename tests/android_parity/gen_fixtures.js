// Exports the browser engine's data so the Kotlin port can be checked against it (parity), not assumed.
// usage: node tests/android_parity/gen_fixtures.js > android/app/src/test/resources/parity.json
global.window = global; require(require('path').resolve(__dirname, '../../prototype/mesh.js')); const M = Mesh;
M.reset(); const S = M.state(); const hoods = M.NEIGHBORHOODS.map(h => h.id);
const dist = {}; hoods.forEach(a => { dist[a] = {}; hoods.forEach(b => dist[a][b] = M.hoodDistance(a, b)); });
const topo = { nodes: S.order.map(id => ({ id, hood: S.nodes[id].hood, hasApp: S.nodes[id].hasApp, key: S.nodes[id].key })),
  edges: S.edges.map(e => [e.from, e.to]), keys: S.keys };
console.log(JSON.stringify({ neighborhoods: M.NEIGHBORHOODS, edges: M.NEIGH_EDGES, distances: dist, route: M.ROUTE, validity: M.VALIDITY, ttl: M.TTL,
  remind: M.REMIND, stale: M.STALE, evictGrace: M.EVICT_GRACE, cap: M.CAP, maxBroadcast: M.MAX_BROADCAST, topology: topo }));
