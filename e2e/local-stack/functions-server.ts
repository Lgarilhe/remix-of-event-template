// Serveur local des edge functions (remplace l'edge runtime de la CLI Supabase).
// Charge supabase/functions/<nom>/index.ts à la première requête et capte le
// handler passé à Deno.serve. Tout fetch vers un hôte autre que 127.0.0.1 ou
// localhost part vers le faux prestataire (vendor-mock.mjs) : aucun appel réel.
const ROOT = new URL('../../supabase/functions/', import.meta.url);
const MOCK = Deno.env.get('VENDOR_MOCK_URL') ?? 'http://127.0.0.1:54340';
const PORT = Number(Deno.env.get('FUNCTIONS_PORT') ?? 54331);

type Handler = (req: Request, info?: unknown) => Response | Promise<Response>;
const handlers = new Map<string, Handler>();
const loading = new Map<string, Promise<Handler>>();
let capture: ((h: Handler) => void) | null = null;
let chain: Promise<unknown> = Promise.resolve();

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : null;
  const url = new URL(req ? req.url : String(input));
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return realFetch(input as RequestInfo, init);
  const target = `${MOCK}${url.pathname}${url.search}`;
  const headers = new Headers(init?.headers ?? req?.headers);
  headers.set('x-original-host', url.host);
  return req ? realFetch(new Request(target, req), { ...init, headers }) : realFetch(target, { ...init, headers });
}) as typeof fetch;

const realServe = Deno.serve.bind(Deno);
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (...args: any[]) => {
  const h = args.find((a) => typeof a === 'function') ?? args.find((a) => a && typeof a.handler === 'function')?.handler;
  if (capture && h) capture(h);
  return { finished: new Promise(() => {}), shutdown: async () => {}, ref() {}, unref() {}, addr: { hostname: '127.0.0.1', port: 0, transport: 'tcp' } };
};

function load(name: string): Promise<Handler> {
  const ready = handlers.get(name);
  if (ready) return Promise.resolve(ready);
  const pending = loading.get(name);
  if (pending) return pending;
  // Chargements en série : la capture de Deno.serve est globale.
  const p = (chain = chain.then(async () => {
    let got: Handler | null = null;
    capture = (h) => { got = h; };
    try {
      await import(new URL(`${name}/index.ts`, ROOT).href);
    } finally {
      capture = null;
    }
    if (!got) throw new Error(`no Deno.serve handler in ${name}`);
    handlers.set(name, got);
    return got;
  })) as Promise<Handler>;
  loading.set(name, p);
  p.catch(() => loading.delete(name));
  return p;
}

realServe({ hostname: '127.0.0.1', port: PORT, onListen: () => console.log(`functions on ${PORT}`) }, async (request: Request) => {
  const name = new URL(request.url).pathname.split('/')[1];
  if (!/^[a-z0-9-]+$/.test(name ?? '')) return new Response('not found', { status: 404 });
  try {
    return await (await load(name))(request);
  } catch (e) {
    console.error(`[functions] ${name}:`, e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
});
