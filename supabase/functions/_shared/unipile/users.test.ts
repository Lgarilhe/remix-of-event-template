// Personnes : profil (lecture silencieuse), visite explicite, relations, demandes
// de mise en relation (envoi, liste, acceptation, retrait), publications récentes
// et fiche société. Chaque appel est joué contre un transport factice qui vérifie
// l'URL, la méthode, la requête et le corps.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/unipile/users.test.ts

import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { isUnipileError } from './errors.ts';
import { OutdatedAccountIdError } from './ids.ts';
import { emptyResponse, fixtures, jsonResponse, networkError, withMockTransport } from './testing.ts';
import {
  acceptRelationRequest,
  cancelRelationRequest,
  getCompany,
  getProfile,
  listRelationRequests,
  listRelations,
  listSentRelationRequests,
  listUserPosts,
  notifyVisitToken,
  PROFILE_SECTIONS,
  sendRelationRequest,
  visitProfile,
  withdrawRelationRequest,
} from './users.ts';

const ACC = 'acc_01abc';
const PID = 'ACoAABBCCDDEE';

function profile(extra: Record<string, unknown> = {}) {
  return {
    object: 'UserProfile', id: PID, type: 'individual', display_name: 'Marie Dupont', public_identifier: 'marie-dupont',
    is_blocked: false, provider: 'linkedin', specifics: { notify_visit_token: 'tok_1', network_distance: 'SECOND_DEGREE' },
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Profil
// ---------------------------------------------------------------------------

Deno.test('getProfile : GET /{acc}/users/{slug}, aucune requête sans options', async () => {
  await withMockTransport(() => jsonResponse(profile()), async (mock) => {
    const p = await getProfile(ACC, 'marie-dupont');
    strictEqual(p.display_name, 'Marie Dupont');
    strictEqual(mock.calls[0].method, 'GET');
    strictEqual(mock.calls[0].path, `/${ACC}/users/marie-dupont`);
    strictEqual(mock.calls[0].url, `https://api.unipile.com/v2/${ACC}/users/marie-dupont`);
  });
});

Deno.test('getProfile : with_sections répété et variant ; URL de profil réduite au slug', async () => {
  await withMockTransport(() => jsonResponse(profile()), async (mock) => {
    await getProfile(ACC, 'https://www.linkedin.com/in/marie-dupont/', {
      sections: ['linkedin_experience', 'linkedin_education_preview', 'linkedin_*'], variant: 'linkedin_recruiter',
    });
    strictEqual(mock.calls[0].path, `/${ACC}/users/marie-dupont`);
    deepStrictEqual(mock.calls[0].query.getAll('with_sections'), ['linkedin_experience', 'linkedin_education_preview', 'linkedin_*']);
    strictEqual(mock.calls[0].query.get('variant'), 'linkedin_recruiter');
  });
});

Deno.test('getProfile : « me » désigne le titulaire du compte', async () => {
  await withMockTransport(() => jsonResponse(profile()), async (mock) => {
    await getProfile(ACC, 'me');
    strictEqual(mock.calls[0].path, `/${ACC}/users/me`);
  });
});

Deno.test('getProfile : section inconnue, référence vide ou ancien compte refusés avant tout appel', async () => {
  await withMockTransport(() => jsonResponse(profile()), async (mock) => {
    await rejects(() => getProfile(ACC, 'x', { sections: ['linkedin_about' as 'linkedin_*'] }), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
    await rejects(() => getProfile(ACC, '  '), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
    await rejects(() => getProfile('v1-id', 'marie'), OutdatedAccountIdError);
    strictEqual(mock.calls.length, 0);
  });
  strictEqual(PROFILE_SECTIONS.length, 22);
});

Deno.test('getProfile : slug introuvable, repli sur l\'identifiant fournisseur', async () => {
  await withMockTransport((req) => (req.path.endsWith('/marie-dupont') ? jsonResponse({ error: 'not found' }, 404) : jsonResponse(profile())), async (mock) => {
    const p = await getProfile(ACC, { slug: 'marie-dupont', providerId: PID });
    strictEqual(p.id, PID);
    deepStrictEqual(mock.calls.map((c) => c.path), [`/${ACC}/users/marie-dupont`, `/${ACC}/users/${PID}`]);
  });
});

Deno.test('getProfile : une erreur d\'authentification ou de limite ne change pas de forme', async () => {
  await withMockTransport(() => jsonResponse({ error: 'bad key' }, 401), async (mock) => {
    await rejects(() => getProfile(ACC, { slug: 'marie-dupont', providerId: PID }), (e: unknown) => isUnipileError(e) && e.kind === 'auth');
    strictEqual(mock.calls.length, 1);
  });
});

Deno.test('getProfile : toutes les formes refusées = dernière erreur ; réponse illisible = erreur serveur', async () => {
  await withMockTransport(() => jsonResponse({ error: 'not found' }, 404), async (mock) => {
    await rejects(() => getProfile(ACC, { slug: 'marie-dupont', providerId: PID }), (e: unknown) => isUnipileError(e) && e.kind === 'not_found');
    strictEqual(mock.calls.length, 2);
  });
  await withMockTransport(() => jsonResponse({ hello: 1 }), async () => {
    await rejects(() => getProfile(ACC, 'marie-dupont'), (e: unknown) => isUnipileError(e) && e.kind === 'server');
  });
});

Deno.test('notifyVisitToken : lit specifics.notify_visit_token', () => {
  strictEqual(notifyVisitToken({ specifics: { notify_visit_token: 'tok_1' } }), 'tok_1');
  strictEqual(notifyVisitToken({ specifics: {} }), null);
  strictEqual(notifyVisitToken({ specifics: null }), null);
  strictEqual(notifyVisitToken({ specifics: { notify_visit_token: '' } }), null);
});

// ---------------------------------------------------------------------------
// Visite
// ---------------------------------------------------------------------------

Deno.test('visitProfile : POST /{acc}/users/visit-profile?token= sans corps', async () => {
  await withMockTransport(() => jsonResponse({ object: 'ProfileVisited' }), async (mock) => {
    strictEqual(await visitProfile(ACC, 'tok_1 +/'), true);
    strictEqual(mock.calls[0].method, 'POST');
    strictEqual(mock.calls[0].path, `/${ACC}/users/visit-profile`);
    strictEqual(mock.calls[0].query.get('token'), 'tok_1 +/');
    strictEqual(mock.calls[0].body, null);
  });
  await withMockTransport(() => jsonResponse({ object: 'Other' }), async () => {
    strictEqual(await visitProfile(ACC, 'tok_1'), false);
  });
});

Deno.test('visitProfile : jeton vide refusé ; panne réseau rejouée (visite répétable), erreur réseau et non incertitude', async () => {
  await withMockTransport(() => networkError(), async (mock) => {
    await rejects(() => visitProfile(ACC, ' '), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
    strictEqual(mock.calls.length, 0);
    await rejects(() => visitProfile(ACC, 'tok_1'), (e: unknown) => isUnipileError(e) && e.kind === 'network');
    strictEqual(mock.calls.length, 3, 'une visite se répète sans effet de bord : trois essais');
  });
});

Deno.test('accept, cancel et withdraw : rejoués après un 503 (aucun doublon possible), au lieu d’une issue incertaine', async () => {
  for (const call of [
    () => acceptRelationRequest(ACC, 'rq1'),
    () => cancelRelationRequest(ACC, 'rq1'),
    () => withdrawRelationRequest(ACC, 'rq1'),
  ]) {
    let n = 0;
    await withMockTransport(() => (n++ === 0 ? new Response('boom', { status: 503 }) : jsonResponse({ object: 'RelationRequestCanceled' })), async (mock) => {
      strictEqual(await call(), undefined);
      strictEqual(mock.calls.length, 2);
    });
    n = 0;
  }
});

// ---------------------------------------------------------------------------
// Relations et demandes
// ---------------------------------------------------------------------------

Deno.test('listRelations : GET /{acc}/users/me/relations par défaut, search et pagination', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([{ id: 'r1', user: { id: PID } }], { nextCursor: 'n2' })), async (mock) => {
    const page = await listRelations(ACC, 'me', { search: 'marie', cursor: 'c1', limit: 50 });
    strictEqual(page.items[0].user.id, PID);
    strictEqual(page.nextCursor, 'n2');
    strictEqual(mock.calls[0].path, `/${ACC}/users/me/relations`);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), { search: 'marie', cursor: 'c1', limit: '50' });
    await listRelations(ACC);
    strictEqual(mock.calls[1].path, `/${ACC}/users/me/relations`);
  });
});

Deno.test('listRelationRequests : GET /{acc}/users/me/relation-requests?type=sent', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([{ object: 'RelationRequest', type: 'sent', id: 'rq1', created_at: 'd' }])), async (mock) => {
    const page = await listRelationRequests(ACC, 'sent', { offset: 10, limit: 25 });
    strictEqual(page.items[0].id, 'rq1');
    strictEqual(mock.calls[0].path, `/${ACC}/users/me/relation-requests`);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), { type: 'sent', offset: '10', limit: '25' });
    await listSentRelationRequests(ACC);
    deepStrictEqual(Object.fromEntries(mock.calls[1].query), { type: 'sent' });
    await rejects(() => listRelationRequests(ACC, 'both' as 'sent'), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
  });
});

Deno.test('sendRelationRequest : POST /{acc}/users/me/relation-requests {user_id, message}', async () => {
  await withMockTransport(() => jsonResponse({ object: 'RelationRequest', type: 'sent', id: 'rq9' }, 201), async (mock) => {
    const out = await sendRelationRequest({ accountId: ACC, user: PID, message: 'Bonjour Marie' });
    strictEqual(out.outcome, 'sent');
    if (out.outcome === 'sent') strictEqual(out.requestId, 'rq9');
    strictEqual(mock.calls[0].method, 'POST');
    strictEqual(mock.calls[0].path, `/${ACC}/users/me/relation-requests`);
    deepStrictEqual(mock.calls[0].body, { user_id: PID, message: 'Bonjour Marie' });
  });
});

Deno.test('sendRelationRequest : sans note, le champ message est absent ; identifiant fournisseur préféré au slug', async () => {
  await withMockTransport(() => jsonResponse({ object: 'RelationRequest', type: 'sent', id: 'rq9' }, 201), async (mock) => {
    await sendRelationRequest({ accountId: ACC, user: { slug: 'marie-dupont', providerId: PID }, message: '  ' });
    deepStrictEqual(mock.calls[0].body, { user_id: PID });
  });
});

Deno.test('sendRelationRequest : déjà en relation (refus) = refused ; aucune nouvelle tentative sur une autre erreur', async () => {
  await withMockTransport(() => jsonResponse({ error: 'invitation limit reached for this week' }, 429), async (mock) => {
    const out = await sendRelationRequest({ accountId: ACC, user: { slug: 'marie-dupont', providerId: PID } });
    strictEqual(out.outcome, 'refused');
    if (out.outcome === 'refused') strictEqual(out.kind, 'provider_limit');
    strictEqual(mock.calls.length, 1);
  });
});

Deno.test('sendRelationRequest : forme inconnue refusée, la seconde forme est tentée', async () => {
  await withMockTransport((req) => {
    const body = req.body as { user_id: string };
    return body.user_id === PID ? jsonResponse({ error: 'user not found' }, 404) : jsonResponse({ object: 'RelationRequest', type: 'sent', id: 'rq2' }, 201);
  }, async (mock) => {
    const out = await sendRelationRequest({ accountId: ACC, user: { slug: 'marie-dupont', providerId: PID } });
    strictEqual(out.outcome, 'sent');
    deepStrictEqual(mock.calls.map((c) => (c.body as { user_id: string }).user_id), [PID, 'marie-dupont']);
  });
});

Deno.test('sendRelationRequest : 5xx ou réponse sans identifiant = incertain, un seul appel', async () => {
  await withMockTransport(() => new Response('boom', { status: 504 }), async (mock) => {
    strictEqual((await sendRelationRequest({ accountId: ACC, user: PID })).outcome, 'uncertain');
    strictEqual(mock.calls.length, 1);
  });
  await withMockTransport(() => jsonResponse({ object: 'RelationRequest' }, 201), async () => {
    strictEqual((await sendRelationRequest({ accountId: ACC, user: PID })).outcome, 'uncertain');
  });
});

Deno.test('acceptRelationRequest et cancelRelationRequest : POST .../{request}/accept|cancel', async () => {
  await withMockTransport((req) => jsonResponse({ object: req.path.endsWith('/accept') ? 'RelationRequestConfirmed' : 'RelationRequestCanceled' }), async (mock) => {
    strictEqual(await acceptRelationRequest(ACC, 'rq 1'), undefined);
    strictEqual(await cancelRelationRequest(ACC, 'rq1'), undefined);
    strictEqual(await withdrawRelationRequest(ACC, 'rq2'), undefined);
    deepStrictEqual(mock.calls.map((c) => [c.method, c.path]), [
      ['POST', `/${ACC}/users/me/relation-requests/rq%201/accept`],
      ['POST', `/${ACC}/users/me/relation-requests/rq1/cancel`],
      ['POST', `/${ACC}/users/me/relation-requests/rq2/cancel`],
    ]);
    strictEqual(mock.calls[0].body, null);
    await rejects(() => cancelRelationRequest(ACC, ''), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
  });
});

Deno.test('cancelRelationRequest : un 204 sans corps est accepté', async () => {
  await withMockTransport(() => emptyResponse(204), async () => {
    strictEqual(await cancelRelationRequest(ACC, 'rq1'), undefined);
  });
});

// ---------------------------------------------------------------------------
// Publications et société
// ---------------------------------------------------------------------------

Deno.test('listUserPosts : GET /{acc}/users/{user}/posts?limit=5', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([{ id: 'p1', text: 'Bonjour', is_repost: false }])), async (mock) => {
    const page = await listUserPosts(ACC, 'marie-dupont', { limit: 5 });
    strictEqual(page.items[0].text, 'Bonjour');
    strictEqual(mock.calls[0].path, `/${ACC}/users/marie-dupont/posts`);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), { limit: '5' });
  });
});

Deno.test('getCompany : GET /{acc}/linkedin/company/{id}', async () => {
  await withMockTransport(() => jsonResponse({ object: 'CompanyProfile', id: '1337', name: 'Acme', industry: ['Software'] }), async (mock) => {
    const company = await getCompany(ACC, '1337');
    strictEqual(company.name, 'Acme');
    strictEqual(mock.calls[0].path, `/${ACC}/linkedin/company/1337`);
  });
  await withMockTransport(() => jsonResponse({ nope: true }), async () => {
    await rejects(() => getCompany(ACC, '1337'), (e: unknown) => isUnipileError(e) && e.kind === 'server');
  });
});
