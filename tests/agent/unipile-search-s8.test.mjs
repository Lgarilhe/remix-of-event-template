import assert from 'node:assert/strict';
import test from 'node:test';
import { bootHandler, fakeDatabase } from './unipile-search-harness.mjs';

// Actions ajoutées à unipile-search par le lot S8 (recherche depuis une adresse, projets Recruiter, invitations
// envoyées), par le point d'entrée HTTP complet : authentification, rattachement du compte à l'organisation, règle
// « depuis son propre compte » pour le retrait, aucun plafond consommé, aucun nom de prestataire dans les réponses.
// Base et prestataire sont des doublures locales, aucun réseau.
const ACCOUNT = 'acc_mine';
const ENV = { SUPABASE_URL: 'https://supabase.local.test', SB_SECRET_KEY: 'service-key', SUPABASE_ANON_KEY: 'anon-key', UNIPILE_V2_API_KEY: 'provider-key' };
const RECRUITER = { body: { object: 'AvailableContracts', contracts: [{ object: 'Contract', id: 'c1', name: 'R', product: 'recruiter', selected: true }] } };

async function boot({ linked = [{ id: 'link-1', user_id: 'user-1' }], member = { id: 'member-1' } } = {}) {
  const quotaCalls = [];
  const { client, calls } = fakeDatabase({
    rows: table => table === 'member_linkedin_accounts' ? linked : [],
    single: table => table === 'organization_members' ? member : null,
    rpc: async name => ({ data: name === 'check_rate_limit' ? true : null, error: null }),
  });
  const h = await bootHandler({
    env: ENV,
    createClient: () => client,
    enforceLinkedInAction: async (_client, gate) => { quotaCalls.push(gate); return { allowed: true }; },
  });
  const provider = [];
  const state = { routes: {} };
  const handler = request => {
    provider.push(`${request.method} ${request.path}`);
    const entry = state.routes[`${request.method} ${request.path}`];
    return typeof entry === 'function' ? entry(request) : entry ?? { status: 404, body: {} };
  };
  async function post(body, { bearer = 'jwt-user' } = {}) {
    return h.withMockTransport(handler, async () => {
      const response = await h.handler(new Request('https://app.local.test/functions/v1/unipile-search', {
        method: 'POST',
        headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: 'org-1', account_id: ACCOUNT, ...body }),
      }));
      return { status: response.status, body: await response.json() };
    });
  }
  return { calls, quotaCalls, provider, state, post };
}

const noVendor = body => assert.doesNotMatch(JSON.stringify(body), /unipile/i, JSON.stringify(body));
const sent = id => ({ object: 'RelationRequest', type: 'sent', id, created_at: '2026-10-05T12:00:00.000Z', user: { id: 'ACoAAada', display_name: 'Ada', public_identifier: 'ada' } });

test('search_from_url rend les filtres de l\'adresse sans lancer de recherche ni consommer le plafond', async () => {
  const t = await boot();
  const response = await t.post({ action: 'search_from_url', url: 'https://www.linkedin.com/search/results/people/?keywords=cto&network=%5B%22F%22%5D' });
  assert.equal(response.status, 200);
  assert.equal(response.body.kind, 'classic');
  assert.deepEqual(response.body.filters, { api: 'classic', category: 'people', keywords: 'cto', network_distance: [1] });
  assert.deepEqual(response.body.warnings, []);
  assert.deepEqual(t.provider, [], 'aucun appel au prestataire pour une adresse Classic');
  assert.deepEqual(t.quotaCalls, [], 'ce n\'est pas une recherche : aucune unité consommée');
  noVendor(response.body);

  const refused = await t.post({ action: 'search_from_url', url: 'https://exemple.com/x' });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.errorType, 'INVALID_SEARCH_URL');
  noVendor(refused.body);
});

test('list_recruiter_projects : projets du contrat Recruiter, refus en français sans cette licence', async () => {
  const t = await boot();
  t.state.routes = {
    [`GET /${ACCOUNT}/linkedin/contracts`]: RECRUITER,
    [`GET /${ACCOUNT}/linkedin/recruiter/projects`]: { body: { data: [{ id: '101', name: 'CTO Fintech', archived: false, visibility: 'PRIVATE' }], total_count: 1 } },
  };
  const listed = await t.post({ action: 'list_recruiter_projects' });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.projects.map(p => [p.id, p.name]), [['101', 'CTO Fintech']]);
  assert.deepEqual(t.quotaCalls, []);

  const classic = await boot();
  classic.state.routes = { [`GET /${ACCOUNT}/linkedin/contracts`]: { body: { object: 'AvailableContracts', contracts: [] } } };
  const refused = await classic.post({ action: 'list_recruiter_projects' });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.errorType, 'LICENCE_UNAVAILABLE');
  assert.match(refused.body.error, /licence Recruiter/);
  noVendor(refused.body);
  assert.ok(!classic.provider.some(entry => entry.endsWith('/recruiter/projects')));
});

test('search avec recruiter_project_id : le projet limite la recherche Recruiter', async () => {
  const t = await boot();
  let body;
  t.state.routes = {
    [`GET /${ACCOUNT}/linkedin/contracts`]: RECRUITER,
    [`POST /${ACCOUNT}/linkedin/recruiter/search/people`]: request => { body = request.body; return { body: { data: [] } }; },
  };
  const response = await t.post({ action: 'search', api: 'recruiter', keywords: 'CTO', recruiter_project_id: '123456' });
  assert.equal(response.status, 200);
  assert.deepEqual(body.project, { include: [{ id: '123456', title: '123456' }] });
  assert.deepEqual(t.quotaCalls.map(call => call.actionType), ['search']);

  const invalid = await t.post({ action: 'search', api: 'recruiter', recruiter_project_id: 'abc' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error_code, 'RECRUITER_PROJECT_INVALID');
});

test('list_sent_invitations : la liste d\'un compte de l\'organisation, lecture permise même sur le compte d\'un collègue', async () => {
  const colleague = await boot({ linked: [{ id: 'link-1', user_id: 'user-2' }] });
  colleague.state.routes = { [`GET /${ACCOUNT}/users/me/relation-requests`]: { body: { data: [sent('inv1')], total_count: 1 } } };
  const response = await colleague.post({ action: 'list_sent_invitations' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.invitations.map(i => i.id), ['inv1']);
  assert.deepEqual(colleague.quotaCalls, []);
  noVendor(response.body);
});

test('withdraw_invitation : seulement depuis son propre compte, jamais en appel interne, jamais pour un compte d\'une autre organisation', async () => {
  const routes = {
    [`GET /${ACCOUNT}/users/me/relation-requests`]: { body: { data: [sent('inv1')] } },
    [`POST /${ACCOUNT}/users/me/relation-requests/inv1/cancel`]: { body: { object: 'RelationRequestCanceled' } },
  };

  const colleague = await boot({ linked: [{ id: 'link-1', user_id: 'user-2' }] });
  colleague.state.routes = routes;
  const notYours = await colleague.post({ action: 'withdraw_invitation', request_id: 'inv1' });
  assert.equal(notYours.status, 403);
  assert.equal(notYours.body.errorType, 'ACCOUNT_NOT_YOURS');
  noVendor(notYours.body);
  assert.deepEqual(colleague.provider, [], 'aucun appel au prestataire');

  const internal = await colleague.post({ action: 'withdraw_invitation', request_id: 'inv1' }, { bearer: 'service-key' });
  assert.equal(internal.status, 403);
  assert.equal(internal.body.errorType, 'ACTION_UNAVAILABLE');
  assert.deepEqual(colleague.provider, []);

  const foreign = await boot({ linked: [] });
  foreign.state.routes = routes;
  const unlinked = await foreign.post({ action: 'withdraw_invitation', request_id: 'inv1' });
  assert.equal(unlinked.status, 403);
  assert.equal(unlinked.body.errorType, 'ACCOUNT_NOT_LINKED');
  assert.deepEqual(foreign.provider, []);

  const own = await boot();
  own.state.routes = routes;
  const done = await own.post({ action: 'withdraw_invitation', request_id: 'inv1' });
  assert.equal(done.status, 200);
  assert.equal(done.body.success, true);
  assert.equal(done.body.request_id, 'inv1');
  assert.deepEqual(own.provider, [`GET /${ACCOUNT}/users/me/relation-requests`, `POST /${ACCOUNT}/users/me/relation-requests/inv1/cancel`]);
  assert.deepEqual(own.quotaCalls, [], 'un retrait ne consomme aucune unité de plafond');
  // Une ligne au registre des actions LinkedIn, avec l'organisation, la personne et le compte.
  const ledger = own.calls.inserts.filter(entry => entry.table === 'linkedin_action_log');
  assert.equal(ledger.length, 1);
  assert.deepEqual(ledger[0].value, {
    organization_id: 'org-1', user_id: 'user-1', account_id: ACCOUNT, action_type: 'invitation_withdraw', source: 'manual_invitations',
  });
  noVendor(done.body);
});

test('withdraw_invitation : une demande reçue ou inconnue n\'est pas retirée', async () => {
  const t = await boot();
  t.state.routes = { [`GET /${ACCOUNT}/users/me/relation-requests`]: { body: { data: [{ ...sent('rec1'), type: 'received' }] } } };
  const response = await t.post({ action: 'withdraw_invitation', request_id: 'rec1' });
  assert.equal(response.status, 404);
  assert.equal(response.body.errorType, 'INVITATION_NOT_FOUND');
  assert.ok(!t.provider.some(entry => entry.includes('/cancel')));
  assert.equal(t.calls.inserts.length, 0);
});
