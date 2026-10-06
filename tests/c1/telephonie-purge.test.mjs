/**
 * Téléphonie : purge des transcriptions d'appels (rgpd-purge, étape 6).
 *
 * Deux parties :
 *   - gardes statiques sur la migration et sur la fonction rgpd-purge ;
 *   - la vraie fonction rgpd-purge exécutée sous Node avec un faux réseau
 *     (Deno.serve et Deno.env remplacés, client Supabase du CDN redirigé vers
 *     node_modules, fetch remplacé par un journal de requêtes). On vérifie le
 *     mode « compte seulement » par défaut, la fenêtre envoyée à la base et
 *     l'absence de toute écriture directe sur les tables de téléphonie.
 * Le comportement SQL (fenêtre, date de l'appel, cascade, droits) est joué par
 * supabase/tests/telephony_audit.sql, contrôles 23 à 27.
 *
 * Demande le typage effaçable de Node (22.6 et plus) pour lire les .ts :
 *   node --experimental-strip-types --test tests/c1/telephonie-purge.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre (ex. une extraction de HEAD).
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// ---- gardes statiques -------------------------------------------------------
const MIGRATION = 'supabase/migrations/20261006113827_telephonie_purge_transcriptions.sql';

test('migration : fonction réservée à service_role, fenêtre minimale, compte seulement par défaut', () => {
  const sql = read(MIGRATION);
  // Le code sans ses commentaires : les commentaires parlent de ce qui reste.
  const code = sql.replace(/^\s*--.*$/gm, '');
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.rgpd_purge_phone_call_insights\(/);
  assert.match(sql, /p_dry_run boolean DEFAULT true/);
  assert.match(sql, /SECURITY INVOKER/);
  assert.match(sql, /SET search_path = public, pg_temp/);
  assert.match(sql, /p_before > now\(\) - interval '6 months'/);
  assert.match(sql, /HINT = 'PURGE_WINDOW_TOO_SHORT'/);
  assert.match(sql, /HINT = 'PURGE_LIMIT_INVALID'/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.rgpd_purge_phone_call_insights\(timestamptz, boolean, integer\)\s+FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.rgpd_purge_phone_call_insights\(timestamptz, boolean, integer\)\s+TO service_role;/);
  assert.doesNotMatch(sql, /GRANT[^;]*\b(anon|authenticated)\b/);
  // Chaque suppression est gardée par le mode compte seulement.
  const deletes = sql.match(/DELETE FROM[\s\S]*?RETURNING/g) ?? [];
  assert.equal(deletes.length, 2);
  for (const d of deletes) assert.match(d, /AND NOT p_dry_run/);
  // L'âge est celui de l'appel ; la ligne de l'appel et les tâches créées restent.
  assert.match(sql, /coalesce\(c\.started_at, c\.created_at\) < p_before/);
  assert.doesNotMatch(code, /DELETE FROM public\.phone_calls\b/);
  assert.doesNotMatch(code, /candidate_reminders/);
});

test('rgpd-purge : étape 6 par la fonction SQL, jamais par une écriture directe', () => {
  const purge = read('supabase/functions/rgpd-purge/index.ts');
  assert.match(purge, /\.rpc\("rgpd_purge_phone_call_insights", \{/);
  const call = purge.slice(purge.indexOf('.rpc("rgpd_purge_phone_call_insights"'));
  assert.match(call.slice(0, 220), /p_dry_run: dryRun,/);
  assert.match(purge, /phone_call_insights_purged: 0,/);
  for (const table of ['phone_call_insights', 'phone_call_task_suggestions', 'phone_calls', 'candidate_reminders']) {
    assert.doesNotMatch(purge, new RegExp(`\\.from\\("${table}"\\)`), `${table} n'est jamais lu ni écrit en direct`);
  }
  // Le mode par défaut ne change pas.
  assert.match(purge, /const dryRun = body\?\.dry_run !== false;/);
});

test('CLAUDE.md : la purge des transcriptions est documentée', () => {
  const doc = read('CLAUDE.md');
  assert.match(doc, /rgpd_purge_phone_call_insights/);
});

// ---- rgpd-purge exécutée pour de bon ---------------------------------------
const env = {
  SUPABASE_URL: 'http://fake.supabase', SB_SECRET_KEY: 'svc-key', SUPABASE_SERVICE_ROLE_KEY: 'svc-key',
};
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { globalThis.__rgpdPurge = h; } };

const hooks = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('https://esm.sh/@supabase/supabase-js') || specifier.startsWith('npm:@supabase/supabase-js')) {
    return nextResolve('@supabase/supabase-js', { ...context, parentURL: ${JSON.stringify(pathToFileURL(join(ROOT, 'package.json')).href)} });
  }
  return nextResolve(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);

let requests;
let scenario;
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  requests.push({ method, path: url.pathname, body });
  if (url.pathname.endsWith('/rpc/rgpd_purge_phone_call_insights')) {
    if (scenario.rpcError) return json({ code: '22023', message: 'Fenêtre de conservation trop courte', hint: 'PURGE_WINDOW_TOO_SHORT' }, 400);
    return json(scenario.insightRows);
  }
  // Toute autre lecture rend zéro ligne : les autres étapes n'ont rien à purger.
  return json([]);
};

let handler;
before(async () => {
  await import(pathToFileURL(join(ROOT, 'supabase/functions/rgpd-purge/index.ts')).href);
  handler = globalThis.__rgpdPurge;
});

const call = async (bodyText, token = 'svc-key') => {
  requests = [];
  const res = await handler(new Request('http://fake.functions/functions/v1/rgpd-purge', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: bodyText,
  }));
  return { status: res.status, body: await res.json() };
};
const insightsRpc = () => requests.filter((r) => r.path.endsWith('/rpc/rgpd_purge_phone_call_insights'));
const rows = (n) => Array.from({ length: n }, (_, i) => ({ insight_id: `i${i}`, phone_call_id: `c${i}`, organization_id: 'o1' }));
const DAY = 24 * 3600 * 1000;

test('sans corps : compte seulement, fenêtre de 12 mois moins un jour, rien n\'est supprimé', async () => {
  scenario = { insightRows: rows(3) };
  const { status, body } = await call(undefined);
  assert.equal(status, 200);
  assert.equal(body.dry_run, true);
  assert.equal(body.phone_call_insights_purged, 3);
  const [rpc] = insightsRpc();
  assert.equal(insightsRpc().length, 1);
  assert.equal(rpc.body.p_dry_run, true);
  assert.equal(rpc.body.p_limit, 500);
  // 12 mois moins un jour avant maintenant : entre 363 et 367 jours (mois de 28 à 31 jours).
  const ageDays = (Date.now() - Date.parse(rpc.body.p_before)) / DAY;
  assert.ok(ageDays > 363 && ageDays < 367, `fenêtre de ${ageDays} jours`);
  assert.deepEqual(requests.filter((r) => r.method === 'DELETE'), [], 'aucune suppression en compte seulement');
});

test('un corps illisible, dry_run texte ou absent : toujours compte seulement', async () => {
  scenario = { insightRows: rows(1) };
  for (const text of ['pas du json', '{"dry_run":"false"}', '{"dry_run":true}', '{}', 'null']) {
    const { body } = await call(text);
    assert.equal(body.dry_run, true, text);
    assert.equal(insightsRpc()[0].body.p_dry_run, true, text);
  }
});

test('{"dry_run": false} : la suppression est demandée à la base, une seule fois', async () => {
  scenario = { insightRows: rows(2) };
  const { status, body } = await call('{"dry_run": false}');
  assert.equal(status, 200);
  assert.equal(body.dry_run, false);
  assert.equal(body.phone_call_insights_purged, 2);
  assert.equal(insightsRpc().length, 1);
  assert.equal(insightsRpc()[0].body.p_dry_run, false);
});

test('aucune lecture ni écriture directe sur les tables de téléphonie ou les tâches', async () => {
  scenario = { insightRows: rows(2) };
  for (const text of [undefined, '{"dry_run": false}']) {
    await call(text);
    const touched = requests.filter((r) => /\/rest\/v1\/(phone_call_insights|phone_call_task_suggestions|phone_calls|candidate_reminders)\b/.test(r.path));
    assert.deepEqual(touched, []);
  }
});

test('refus de la base : l\'erreur est rendue, les autres étapes continuent', async () => {
  scenario = { insightRows: [], rpcError: true };
  const { status, body } = await call(undefined);
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.phone_call_insights_purged, 0);
  assert.ok(body.errors.some((e) => e.startsWith('phone call insights purge: ')), JSON.stringify(body.errors));
  // Les autres étapes ont bien tourné (la fonction des lignes candidat a été appelée).
  assert.ok(requests.some((r) => r.path.endsWith('/rpc/rgpd_purge_candidate_rows')));
});

test('sans la clé de service : 401, aucune requête', async () => {
  scenario = { insightRows: rows(1) };
  const { status } = await call('{"dry_run": false}', 'une-autre-cle');
  assert.equal(status, 401);
  assert.deepEqual(requests, []);
});
