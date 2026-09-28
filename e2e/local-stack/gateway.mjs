// Passerelle locale façon Kong : /rest/v1 -> PostgREST, /auth/v1 -> auth, /functions/v1 -> Deno.
import http from 'node:http';
const routes = [
  ['/rest/v1', 3000, ''],
  ['/auth/v1', 9999, ''],
  ['/functions/v1', 54331, ''],
  ['/graphql/v1', 3000, '/rpc/graphql'],
];
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer, range, accept-profile, content-profile, x-supabase-api-version, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-retry-count',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
  'Access-Control-Expose-Headers': 'content-range, content-profile, x-total-count',
};
http.createServer((req, res) => {
  const r = routes.find(([p]) => req.url === p || req.url.startsWith(p + '/') || req.url.startsWith(p + '?'));
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (!r) { res.writeHead(404, { ...cors, 'content-type': 'application/json' }); return res.end('{"message":"no route"}'); }
  const [prefix, port, repl] = r;
  const path = (repl || '') + (req.url.slice(prefix.length) || '/');
  const headers = { ...req.headers, host: `127.0.0.1:${port}` };
  if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
  const up = http.request({ host: '127.0.0.1', port, path, method: req.method, headers }, (ur) => {
    const h = { ...ur.headers };
    for (const [k, v] of Object.entries(cors)) if (!Object.keys(h).some((x) => x.toLowerCase() === k.toLowerCase())) h[k] = v;
    res.writeHead(ur.statusCode, h);
    ur.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502, { ...cors, 'content-type': 'application/json' }); res.end(JSON.stringify({ message: 'upstream error', detail: String(e) })); });
  req.pipe(up);
}).listen(54321, '127.0.0.1', () => console.log('gateway on 54321'));
