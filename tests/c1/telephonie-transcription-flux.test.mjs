/**
 * Téléphonie : phone-call-insights exécutée pour de bon.
 *
 * La vraie fonction (supabase/functions/phone-call-insights/index.ts, avec ses
 * modules partagés) tourne sous Node, sans runtime Deno ni réseau :
 *   - Deno.serve et Deno.env sont remplacés par de petits doublures ;
 *   - le client Supabase du CDN est redirigé vers celui de node_modules ;
 *   - fetch est remplacé par un faux réseau qui joue PostgREST, Aircall et le
 *     modèle, et garde le journal des requêtes.
 * On vérifie l'enchaînement (transcription, verrou, crédits, modèle, débit,
 * écriture), les refus d'accès et les états rendus, jamais le texte du modèle.
 *
 * Demande le typage effaçable de Node (22.6 et plus) pour lire les .ts :
 *   node --experimental-strip-types --test tests/c1/telephonie-transcription-flux.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre (ex. une extraction de HEAD).
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));

const ORG = '11111111-1111-4111-8111-111111111111';
const CALL = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const INSIGHT = '44444444-4444-4444-8444-444444444444';

// ---- doublures de Deno et du client Supabase du CDN ------------------------
const env = {
  SUPABASE_URL: 'http://fake.supabase', SB_SECRET_KEY: 'svc-key', SUPABASE_SERVICE_ROLE_KEY: 'svc-key',
  SUPABASE_ANON_KEY: 'anon-key', ANTHROPIC_API_KEY: 'sk-fake',
};
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { globalThis.__phoneCallInsights = h; } };

const hooks = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('https://esm.sh/@supabase/supabase-js') || specifier.startsWith('npm:@supabase/supabase-js')) {
    return nextResolve('@supabase/supabase-js', { ...context, parentURL: ${JSON.stringify(pathToFileURL(join(ROOT, 'package.json')).href)} });
  }
  return nextResolve(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);

// ---- faux réseau -----------------------------------------------------------
let state;
let requests;
let scenario;

const rows = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  const headers = new Headers(init.headers);
  const accept = headers.get('accept') || '';
  const prefer = headers.get('prefer') || '';
  requests.push({ method, host: url.host, path: url.pathname, search: decodeURIComponent(url.search), body });

  if (url.host === 'api.aircall.io') {
    return scenario.aircallStatus === 200 ? rows(scenario.aircallBody) : new Response('{}', { status: scenario.aircallStatus });
  }
  if (url.host === 'api.anthropic.com') {
    if (scenario.llmFails) return new Response('{"error":"boom"}', { status: 500 });
    return rows({
      id: 'msg_1', model: 'claude-haiku-4-5-20251001', stop_reason: 'tool_use',
      usage: { input_tokens: 1200, output_tokens: 300 },
      content: [{ type: 'tool_use', id: 'tu_1', name: 'return_call_insights', input: scenario.llmInput }],
    });
  }
  const table = url.pathname.replace('/rest/v1/', '').split('/')[0];
  const single = (v) => (accept.includes('vnd.pgrst.object') ? rows(v) : rows(v === null ? [] : [v]));

  if (url.pathname.includes('/auth/v1/user')) return rows({ id: USER, aud: 'authenticated', email: 'u@test.fr' });
  if (url.pathname.includes('/rpc/check_rate_limit')) return rows(!scenario.rateLimited);
  if (table === 'ai_credit_balances' && method === 'GET' && scenario.balance) return single(scenario.balance);
  if (table === 'phone_calls') return single(state.call);
  if (table === 'organization_members') return single(scenario.notMember ? null : { id: 'm1', user_id: USER });
  if (table === 'telephony_connections') return single({ connected_by: USER });
  if (table === 'organization_integrations') {
    return single(scenario.noCredentials ? null : { aircall_api_id: 'id', aircall_api_token: 'tok' });
  }
  if (table === 'phone_call_insights') {
    if (method === 'POST') return new Response(null, { status: 201 });
    if (method === 'GET') return single(state.insight);
    if (method === 'PATCH') {
      if (prefer.includes('return=representation')) {
        if (scenario.claimTaken) return rows([]);
        Object.assign(state.insight, body);
        return rows([{ id: INSIGHT }]);
      }
      Object.assign(state.insight, body);
      return new Response(null, { status: 204 });
    }
  }
  if (table === 'phone_call_task_suggestions') {
    if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': `*/${state.suggestions.length}` } });
    if (method === 'POST') { state.suggestions.push(...body); return new Response(null, { status: 201 }); }
  }
  // ai_credit_balances, ai_credit_transactions, profiles : réponses neutres.
  return method === 'GET' ? rows([]) : new Response(null, { status: 204 });
};

// ---- chargement de la fonction ---------------------------------------------
let handler;
before(async () => {
  await import(pathToFileURL(join(ROOT, 'supabase/functions/phone-call-insights/index.ts')).href);
  handler = globalThis.__phoneCallInsights;
});

const TRANSCRIPT = {
  transcription: { call_id: 123, content: { language: 'fr', utterances: [
    { start_time: 1, text: 'Bonjour, je vous appelle au sujet du poste de directeur produit chez notre client, avez-vous deux minutes ?', participant_type: 'internal', user_id: 7 },
    { start_time: 9, text: "Oui bonjour, je suis intéressé mais je ne suis disponible qu'en janvier et je vise environ cinquante-cinq mille euros.", participant_type: 'external', phone_number: '+33612345678' },
    { start_time: 20, text: 'Parfait, je vous envoie la fiche de poste demain et on se rappelle vendredi pour fixer un entretien avec le client.', participant_type: 'internal', user_id: 7 },
  ] } },
};

function fresh(overrides = {}) {
  state = {
    call: {
      id: CALL, organization_id: ORG, provider: 'aircall', external_id: '123', direction: 'outbound',
      answered_at: '2026-10-06T08:00:10Z', started_at: '2026-10-06T08:00:00Z', talk_seconds: 95,
      contact_name: 'Camille Durand', agent_name: 'Laurent G.',
    },
    insight: { id: INSIGHT, status: 'pending', transcript: null, summary: null, summary_started_at: null },
    suggestions: [],
  };
  requests = [];
  scenario = {
    aircallStatus: 200, aircallBody: TRANSCRIPT,
    llmInput: {
      summary: "Appel sortant d'environ 2 minutes. Le candidat est intéressé, disponible en janvier, vise 55 k€.",
      tasks: [{ title: 'Envoyer la fiche de poste', reason: 'Promis au candidat.', due_in_days: 1 }, { title: 'Rappeler vendredi', due_in_days: 3 }],
    },
    ...overrides,
  };
}
const call = (body, token = 'svc-key') => handler(new Request('http://fn/phone-call-insights', {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
}));
const external = () => requests.filter((r) => r.host === 'api.aircall.io' || r.host === 'api.anthropic.com');
const modelCalls = () => requests.filter((r) => r.host === 'api.anthropic.com');

// ---------------------------------------------------------------------
test('serveur : transcription, verrou, crédits, modèle, débit, écriture, dans cet ordre', async () => {
  fresh();
  const res = await call({ phone_call_id: CALL, organization_id: ORG });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, status: 'ready', suggestions: 2 });

  assert.equal(state.insight.status, 'ready');
  assert.match(state.insight.summary, /55 k€/);
  assert.equal(state.insight.transcript.length, 3);
  assert.equal(state.insight.transcript[0].speaker, 'agent');
  assert.equal(state.insight.transcript[1].speaker, 'contact');
  assert.equal(state.insight.summary_started_at, null, 'verrou rendu');
  assert.deepEqual(
    state.suggestions.map((s) => [s.title, s.due_in_days, s.organization_id, s.phone_call_id]),
    [['Envoyer la fiche de poste', 1, ORG, CALL], ['Rappeler vendredi', 3, ORG, CALL]],
  );

  const aircall = requests.find((r) => r.host === 'api.aircall.io');
  assert.equal(aircall.path, '/v1/calls/123/transcription');
  const iAircall = requests.indexOf(aircall);
  const claim = requests.find((r) => r.method === 'PATCH' && r.search.includes('summary_started_at.is.null'));
  assert.ok(claim, 'verrou doux demandé');
  assert.match(claim.search, /summary=is\.null/, 'verrou : seulement sans résumé');
  const model = requests.find((r) => r.host === 'api.anthropic.com');
  const iClaim = requests.indexOf(claim);
  const iModel = requests.indexOf(model);
  const iGuard = requests.findIndex((r) => r.path.includes('ai_credit_balances'));
  assert.ok(iAircall < iClaim && iClaim < iModel, 'Aircall, puis verrou, puis modèle');
  assert.ok(iGuard > -1 && iGuard < iModel, 'solde de crédits lu avant le modèle');
  assert.ok(requests.some((r, i) => i > iModel && /ai_credit_(balances|transactions)/.test(r.path)), 'débit après le modèle');

  // Le modèle ne reçoit aucun numéro de téléphone, et la transcription est encadrée.
  assert.doesNotMatch(JSON.stringify(model.body), /\+33612345678|contact_number/);
  assert.match(JSON.stringify(model.body), /<transcription>/);
});

test('rejeu : un résumé déjà gardé ne rappelle ni Aircall ni le modèle', async () => {
  fresh();
  await call({ phone_call_id: CALL, organization_id: ORG });
  requests = [];
  const res = await call({ phone_call_id: CALL, organization_id: ORG });
  assert.deepEqual(await res.json(), { ok: true, status: 'ready', already: true });
  assert.equal(external().length, 0);
});

test('Aircall sans transcription (module absent ou appel non enregistré) : état « unavailable », pas de modèle', async () => {
  for (const status of [403, 404]) {
    fresh({ aircallStatus: status });
    const res = await call({ phone_call_id: CALL, organization_id: ORG });
    assert.deepEqual(await res.json(), { ok: true, status: 'unavailable', error_code: 'unavailable' });
    assert.equal(state.insight.status, 'unavailable');
    assert.equal(modelCalls().length, 0);
  }
});

test('Aircall en panne : état « failed », réessayable', async () => {
  fresh({ aircallStatus: 500 });
  const res = await call({ phone_call_id: CALL, organization_id: ORG });
  assert.deepEqual(await res.json(), { ok: false, status: 'failed', error_code: 'aircall_error' });
  assert.equal(modelCalls().length, 0);
});

test('forme de réponse inconnue : « format », sans écrire le contenu dans les journaux', async () => {
  fresh({ aircallBody: { surprise: { nouvelle: 'forme', secret: 'contenu de la conversation' } } });
  const logged = [];
  const warn = console.warn;
  console.warn = (...args) => logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  try {
    const res = await call({ phone_call_id: CALL, organization_id: ORG });
    assert.deepEqual(await res.json(), { ok: false, status: 'failed', error_code: 'format' });
  } finally {
    console.warn = warn;
  }
  assert.ok(logged.some((l) => l.includes('surprise')), 'les noms de champs sont journalisés');
  assert.ok(logged.every((l) => !l.includes('contenu de la conversation')), 'jamais le contenu');
});

test('identifiants Aircall manquants : « no_credentials », aucun appel à Aircall', async () => {
  fresh({ noCredentials: true });
  const res = await call({ phone_call_id: CALL, organization_id: ORG });
  assert.deepEqual(await res.json(), { ok: false, status: 'failed', error_code: 'no_credentials' });
  assert.equal(external().length, 0);
});

test('appel trop court : transcription gardée, pas de modèle', async () => {
  fresh({ aircallBody: { utterances: [{ text: 'Allô ?', participant_type: 'external' }, { text: 'Oui bonjour.', participant_type: 'internal' }] } });
  const res = await call({ phone_call_id: CALL, organization_id: ORG });
  assert.deepEqual(await res.json(), { ok: true, status: 'ready', error_code: 'too_short' });
  assert.equal(state.insight.transcript.length, 2);
  assert.equal(modelCalls().length, 0);
});

test('appel manqué : aucun appel externe', async () => {
  fresh();
  state.call.answered_at = null;
  state.call.talk_seconds = 0;
  const res = await call({ phone_call_id: CALL, organization_id: ORG });
  assert.deepEqual(await res.json(), { ok: true, status: 'unavailable', error_code: 'unavailable' });
  assert.equal(external().length, 0);
});

test('modèle en panne : transcription gardée, verrou rendu, rien débité', async () => {
  fresh({ llmFails: true });
  const res = await call({ phone_call_id: CALL, organization_id: ORG });
  assert.deepEqual(await res.json(), { ok: false, status: 'transcribed', error_code: 'llm' });
  assert.equal(state.insight.summary_started_at, null);
  assert.equal(state.insight.transcript.length, 3);
  const iModel = requests.findIndex((r) => r.host === 'api.anthropic.com');
  assert.ok(!requests.some((r, i) => i > iModel && /ai_credit_/.test(r.path)), 'rien débité si le modèle échoue');
  assert.equal(state.suggestions.length, 0);
});

test('sortie du modèle invalide : aucun résumé, aucune tâche gardés', async () => {
  fresh({ llmInput: { summary: 'court', tasks: 'pas une liste' } });
  const res = await call({ phone_call_id: CALL, organization_id: ORG });
  assert.deepEqual(await res.json(), { ok: false, status: 'transcribed', error_code: 'llm' });
  assert.equal(state.insight.summary, null);
  assert.equal(state.suggestions.length, 0);
});

test('verrou déjà pris par un autre traitement : un seul résumé à la fois', async () => {
  fresh({ claimTaken: true });
  const res = await call({ phone_call_id: CALL, organization_id: ORG });
  assert.deepEqual(await res.json(), { ok: true, status: 'in_progress' });
  assert.equal(modelCalls().length, 0);
});

test('tâches proposées une seule fois par appel', async () => {
  fresh();
  state.suggestions.push({ phone_call_id: CALL, title: 'Déjà là' });
  const res = await call({ phone_call_id: CALL, organization_id: ORG });
  assert.deepEqual(await res.json(), { ok: true, status: 'ready', suggestions: 0 });
  assert.equal(state.suggestions.length, 1);
});

// ---------------------------------------------------------------------
test('accès : appelant sans autorisation, identifiant invalide, appel inconnu, mauvaise organisation', async () => {
  fresh();
  assert.equal((await handler(new Request('http://fn/', { method: 'POST', body: '{}' }))).status, 401);
  assert.equal((await call({ phone_call_id: 'pas-un-uuid' })).status, 400);
  assert.equal((await call({ phone_call_id: CALL, organization_id: '99999999-9999-4999-8999-999999999999' })).status, 403);
  assert.equal(external().length, 0);
  state.call = null;
  assert.equal((await call({ phone_call_id: CALL, organization_id: ORG })).status, 404);
});

test('navigateur : un membre déclenche, un non-membre est refusé, la limite de débit s\'applique', async () => {
  fresh();
  let res = await call({ phone_call_id: CALL }, 'jwt-of-member');
  assert.deepEqual(await res.json(), { ok: true, status: 'ready', suggestions: 2 });
  assert.ok(requests.some((r) => r.path.includes('/rpc/check_rate_limit')));

  fresh({ notMember: true });
  res = await call({ phone_call_id: CALL, organization_id: ORG }, 'jwt-of-member');
  assert.equal(res.status, 403);
  assert.equal(external().length, 0, 'aucun appel externe pour un non-membre');

  fresh({ rateLimited: true });
  res = await call({ phone_call_id: CALL }, 'jwt-of-member');
  assert.equal(res.status, 429);
});

test('crédits insuffisants : 402 au navigateur, état « credits » au serveur, jamais d\'appel au modèle', async () => {
  const poor = { plan_credits: 0, topup_credits: 0, period_start: '2026-10-01T00:00:00Z', period_end: '2099-01-01T00:00:00Z', updated_at: null };
  fresh({ balance: poor });
  let res = await call({ phone_call_id: CALL }, 'jwt-of-member');
  assert.equal(res.status, 402);
  assert.equal((await res.json()).error_code, 'INSUFFICIENT_CREDITS');
  assert.equal(modelCalls().length, 0);
  assert.equal(state.insight.status, 'transcribed', 'la transcription est gardée');
  assert.equal(state.insight.summary_started_at, null);

  fresh({ balance: poor });
  res = await call({ phone_call_id: CALL, organization_id: ORG });
  assert.deepEqual(await res.json(), { ok: true, status: 'transcribed', error_code: 'credits' });
  assert.equal(modelCalls().length, 0);
});
