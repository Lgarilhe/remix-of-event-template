// Banc commun des tests de unipile-search (API v2 seule).
//
// Les modules de la fonction et le client partagé du prestataire sont compilés ensemble par esbuild puis
// exécutés dans Node : le code testé est le vrai. Le prestataire est le transport factice du client
// (`withMockTransport`, aucun réseau) ; la base, les plafonds LinkedIn et la barrière de l'agent continu
// sont des doublures branchées sur `globalThis.__unipileSearch` par chaque test.
import { build } from 'esbuild';

const root = new URL('../../', import.meta.url).pathname;
const fn = path => `${root}supabase/functions/${path}`;

const STUBS = [
  [/(^|\/)linkedin-quotas\.ts$/, 'export const enforceLinkedInAction = (...a) => globalThis.__unipileSearch.enforceLinkedInAction(...a);'],
  [/(^|\/)continuous-sourcing\.ts$/, 'export const assertContinuousOperationContext = (...a) => globalThis.__unipileSearch.assertContinuousOperationContext(...a);'],
  [/(^|\/)get-or-fetch-contact\.ts$/, 'export const isCandidateErasedForOrg = (...a) => globalThis.__unipileSearch.isCandidateErasedForOrg(...a);'],
  [/^https:\/\/esm\.sh\/@supabase\/supabase-js/, 'export const createClient = (...a) => globalThis.__unipileSearch.createClient(...a);'],
];

const plugin = {
  name: 'unipile-search-stubs',
  setup(builder) {
    builder.onResolve({ filter: /.*/ }, ({ path }) => {
      const index = STUBS.findIndex(([pattern]) => pattern.test(path));
      return index >= 0 ? { path: String(index), namespace: 'stub' } : undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ contents: STUBS[Number(path)][1], loader: 'js' }));
  },
};

const built = new Map();
let instance = 0;

async function bundle(key, contents) {
  if (!built.has(key)) {
    const result = await build({
      stdin: { contents, resolveDir: root, loader: 'ts', sourcefile: `${key}.ts` },
      bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', plugins: [plugin],
    });
    built.set(key, result.outputFiles[0].text);
  }
  // Un module neuf à chaque appel : caches et états de module repartent de zéro.
  const text = `${built.get(key)}\n// instance ${++instance}`;
  return import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);
}

const quiet = { log() {}, warn() {}, error() {} };

/**
 * Le point d'entrée HTTP complet (index.ts) avec ses doublures.
 * `hooks` : createClient, enforceLinkedInAction, assertContinuousOperationContext, isCandidateErasedForOrg.
 * `env` : variables lues par la fonction.
 */
export async function bootHandler({ env = {}, ...hooks } = {}) {
  let handler;
  const previousDeno = globalThis.Deno;
  const previousConsole = { log: console.log, warn: console.warn, error: console.error };
  globalThis.__unipileSearch = {
    enforceLinkedInAction: async () => ({ allowed: true }),
    assertContinuousOperationContext: async () => {},
    isCandidateErasedForOrg: async () => false,
    ...hooks,
  };
  globalThis.Deno = { env: { get: name => env[name] }, serve: fn => { handler = fn; } };
  Object.assign(console, quiet);
  try {
    const module = await bundle('index', `
      import '${fn('unipile-search/index.ts')}';
      export * from '${fn('_shared/unipile/testing.ts')}';
      export { clearLicenceCache } from '${fn('unipile-search/licence.ts')}';
    `);
    module.clearLicenceCache();
    return {
      handler,
      withMockTransport: module.withMockTransport,
      jsonResponse: module.jsonResponse,
      restore() { globalThis.Deno = previousDeno; Object.assign(console, previousConsole); },
    };
  } catch (error) {
    globalThis.Deno = previousDeno;
    Object.assign(console, previousConsole);
    throw error;
  }
}

/** Modules purs (compilation de la requête, conversations) avec le transport factice. */
export async function bootModules() {
  const module = await bundle('modules', `
    export { compileSearchRequest } from '${fn('unipile-search/search-request.ts')}';
    export { handleGetChats, handleGetMessages } from '${fn('unipile-search/chats.ts')}';
    export { handleSearch } from '${fn('unipile-search/search.ts')}';
    export { clearLicenceCache } from '${fn('unipile-search/licence.ts')}';
    export * from '${fn('_shared/unipile/testing.ts')}';
  `);
  module.clearLicenceCache();
  return module;
}

/** Fabrique d'un faux client de base : tables lues par `rows(table)`, fonctions SQL enregistrées. */
export function fakeDatabase({ rows = () => [], single = () => null, rpc = async () => ({ data: null, error: null }), auth } = {}) {
  const calls = { rpc: [], inserts: [], tables: [] };
  const client = {
    auth: auth ?? { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from(table) {
      calls.tables.push(table);
      const q = {
        select() { return q; }, eq() { return q; }, in() { return q; }, ilike() { return q; }, or() { return q; },
        order() { return q; }, limit() { return q; },
        insert(value) { calls.inserts.push({ table, value }); return Promise.resolve({ error: null }); },
        maybeSingle: async () => ({ data: single(table), error: null }),
        single: async () => ({ data: single(table), error: null }),
        then(resolve, reject) { return Promise.resolve({ data: rows(table), error: null }).then(resolve, reject); },
      };
      return q;
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      return rpc(name, args);
    },
  };
  return { client, calls };
}
