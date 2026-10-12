// Enrichissement de profil par le worker de la file (API v2 du prestataire).
//
// - buildEnrichedData : la forme `enriched_data` du cache (candidate_enrichment_cache), construite
//   depuis un profil normalisé, sans « [object Object] » (l'éducation est une liste de lignes).
// - enrichProfileToCache : compte courant (acc_...) et relié à l'organisation AVANT toute action
//   au registre ou au prestataire, une seule lecture, aucune visite de profil, hard-limit du
//   prestataire = pause du compte.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/profile-enrichment.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import profileFull from './unipile/fixtures/profile-full.json' with { type: 'json' };
import profileMinimal from './unipile/fixtures/profile-minimal.json' with { type: 'json' };
import { toKonektProfile } from './unipile/normalize/profile.ts';
import { jsonResponse, withMockTransport } from './unipile/testing.ts';
import { buildEnrichedData, ENRICH_SECTIONS, enrichProfileToCache } from './profile-enrichment.ts';

const NOW = new Date('2026-10-11T10:00:00Z');
const ACCOUNT = 'acc_enrich01';
const PROVIDER_ID = 'ACoAAB1234567';
const PROFILE_URL = 'https://www.linkedin.com/in/marie-dupont-123';

// ---------------------------------------------------------------------------
// buildEnrichedData
// ---------------------------------------------------------------------------

Deno.test('buildEnrichedData : profil complet, les neuf sections et la forme du cache', () => {
  const { enrichedData, sectionsFilled } = buildEnrichedData(toKonektProfile(profileFull.input), NOW);
  deepStrictEqual(sectionsFilled, [
    'experience', 'about', 'skills', 'education', 'recommendations', 'projects', 'certifications',
    'volunteer_experience', 'languages',
  ]);
  ok(!JSON.stringify(enrichedData).includes('[object Object]'));

  strictEqual(String(enrichedData.summary).startsWith('Dix ans'), true, 'À propos = bio (racine du profil)');
  // Éducation : lignes de texte (la forme de ProfileData.education), jamais les objets du prestataire.
  deepStrictEqual(enrichedData.education, ['HEC Paris - Master - Management, Finance (2011)']);
  deepStrictEqual(enrichedData.certifications, [{ name: 'PSPO I', organization: 'Scrum.org' }]);
  deepStrictEqual(enrichedData.skills, ['Product Management', 'SaaS']);
  deepStrictEqual((enrichedData.skillsWithEndorsements as unknown[])[0], { name: 'Product Management', endorsements: 42 });
  deepStrictEqual(enrichedData.recommendations, [{
    text: 'Une cheffe de produit remarquable, rigoureuse et à l’écoute.',
    author: 'Paul Martin',
    authorHeadline: 'CEO chez Acme',
  }]);
  deepStrictEqual(enrichedData.languages, [
    { name: 'Français', proficiency: 'native_or_bilingual' },
    { name: 'Anglais', proficiency: 'full_professional' },
  ]);
  deepStrictEqual(enrichedData.volunteering, [{ role: 'Bénévole', company: 'Croix-Rouge', description: 'Aide aux sans-abri' }]);
  deepStrictEqual(enrichedData.projects, [{ name: 'Lancement V2', description: 'Refonte complète', skills: ['UX'] }]);

  const experience = enrichedData.workExperience as Array<Record<string, unknown>>;
  strictEqual(experience[0].role, 'Directrice Produit');
  strictEqual(experience[0].company, 'Acme', 'la société est un texte, pas l’objet du prestataire');
  deepStrictEqual(experience[0].skills, ['Roadmap', 'OKR']);
  // 03/2019 jusqu'à octobre 2026 (poste en cours) : 91 mois.
  strictEqual(experience[0].durationMonths, 91);
  strictEqual(experience[0].duration, '7 ans 7 mois');
  // 09/2014 à 02/2019 : 53 mois (les dates « MM/DD/YYYY » sont comprises).
  strictEqual(experience[1].durationMonths, 53);
  strictEqual(experience[1].duration, '4 ans 5 mois');
});

Deno.test('buildEnrichedData : profil sans section, rien n’est inventé', () => {
  const { enrichedData, sectionsFilled } = buildEnrichedData(toKonektProfile(profileMinimal.input), NOW);
  deepStrictEqual(sectionsFilled, []);
  deepStrictEqual(enrichedData.workExperience, []);
  strictEqual(enrichedData.education, undefined);
  strictEqual(enrichedData.skills, undefined);
});

Deno.test('buildEnrichedData : les sections limitées à cinq expériences, quatre recommandations', () => {
  const experience = Array.from({ length: 8 }, (_, i) => ({
    job_title: `Poste ${i}`, company: { name: `Société ${i}` }, started_on: '01/01/2015', ended_on: '01/01/2016',
  }));
  const received = Array.from({ length: 6 }, (_, i) => ({ text: `Une recommandation suffisamment longue numéro ${i}`, user: { first_name: 'A', last_name: 'B' } }));
  const { enrichedData } = buildEnrichedData(
    toKonektProfile({ id: 'ACoAAx', specifics: { experience, recommendations: { received, given: [] } } }),
    NOW,
  );
  strictEqual((enrichedData.workExperience as unknown[]).length, 5);
  strictEqual((enrichedData.recommendations as unknown[]).length, 4);
});

Deno.test('ENRICH_SECTIONS : huit sections du prestataire, « à propos » n’en est pas une', () => {
  strictEqual(ENRICH_SECTIONS.length, 8);
  ok(ENRICH_SECTIONS.every((s) => s.startsWith('linkedin_')));
  ok(!ENRICH_SECTIONS.some((s) => s.includes('about')));
});

// ---------------------------------------------------------------------------
// enrichProfileToCache
// ---------------------------------------------------------------------------

interface DbOptions {
  linked?: boolean;
  gateAllowed?: boolean;
  gateScope?: string;
}

// deno-lint-ignore no-explicit-any
function fakeDb(options: DbOptions = {}): { client: any; log: { rpc: string[]; upserts: any[]; updates: any[]; tables: string[] } } {
  // deno-lint-ignore no-explicit-any
  const log = { rpc: [] as string[], upserts: [] as any[], updates: [] as any[], tables: [] as string[] };
  const client = {
    from(table: string) {
      log.tables.push(table);
      // deno-lint-ignore no-explicit-any
      const query: any = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        upsert: (row: unknown, opts: unknown) => {
          log.upserts.push({ table, row, opts });
          return Promise.resolve({ error: null });
        },
        update: (row: unknown) => {
          log.updates.push({ table, row });
          return query;
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({
            data: table === 'member_linkedin_accounts' && options.linked !== false ? [{ id: 'row-1', user_id: 'user-1' }] : [],
            error: null,
          }).then(resolve, reject),
      };
      return query;
    },
    rpc(name: string) {
      log.rpc.push(name);
      return Promise.resolve({
        data: { allowed: options.gateAllowed !== false, scope: options.gateScope, reason: options.gateAllowed === false ? 'plafond' : undefined },
        error: null,
      });
    },
  };
  return { client, log };
}

const deps = (client: unknown, patch: Record<string, unknown> = {}) => ({
  supabase: client,
  accountId: ACCOUNT,
  organizationId: 'org-1',
  userId: 'user-1',
  providerId: PROVIDER_ID,
  profileUrl: PROFILE_URL,
  profileName: 'Marie',
  ...patch,
});

Deno.test('enrichProfileToCache : une lecture, les huit sections, aucune visite, cache écrit', async () => {
  const db = fakeDb();
  await withMockTransport(() => jsonResponse(profileFull.input), async (mock) => {
    const result = await enrichProfileToCache(deps(db.client));
    strictEqual(result.ok, true);
    strictEqual(result.sectionsFilled.length, 9);
    strictEqual(result.usagePct, null);

    strictEqual(mock.calls.length, 1, 'une seule lecture, jamais de visite ni de publications');
    const call = mock.calls[0];
    strictEqual(call.method, 'GET');
    strictEqual(call.path, `/${ACCOUNT}/users/${PROVIDER_ID}`, 'identifiant du prestataire d’abord, comme avant la bascule');
    deepStrictEqual(call.query.getAll('with_sections'), [...ENRICH_SECTIONS]);
    ok(!call.path.includes('visit-profile'));
  });
  strictEqual(db.log.rpc.includes('check_linkedin_action_quota'), true, 'le registre profile_view est passé');
  const upsert = db.log.upserts.find((u) => u.table === 'candidate_enrichment_cache');
  ok(upsert, 'le cache est écrit');
  strictEqual(upsert.row.organization_id, 'org-1');
  strictEqual(upsert.row.linkedin_url, 'https://www.linkedin.com/in/marie-dupont-123');
  strictEqual(upsert.row.provider_id, PROVIDER_ID);
  deepStrictEqual(upsert.row.enriched_data.education, ['HEC Paris - Master - Management, Finance (2011)']);
  strictEqual(upsert.opts.onConflict, 'organization_id,linkedin_url');
});

Deno.test('enrichProfileToCache : une file portant un pseudo comme identifiant est lue par ce pseudo', async () => {
  const db = fakeDb();
  await withMockTransport(() => jsonResponse(profileFull.input), async (mock) => {
    const result = await enrichProfileToCache(deps(db.client, { providerId: 'marie-dupont-123', profileUrl: null }));
    strictEqual(result.ok, true);
    strictEqual(mock.calls[0].path, `/${ACCOUNT}/users/marie-dupont-123`);
  });
});

Deno.test('enrichProfileToCache : ancien identifiant de compte, refus avant tout registre et tout appel', async () => {
  const db = fakeDb();
  await withMockTransport(() => jsonResponse(profileFull.input), async (mock) => {
    const result = await enrichProfileToCache(deps(db.client, { accountId: 'v1AccountIdentifier123' }));
    strictEqual(result.ok, false);
    strictEqual(result.reason, 'outdated_account_id');
    strictEqual(mock.calls.length, 0);
  });
  strictEqual(db.log.rpc.length, 0, 'aucune action n’est journalisée');
  strictEqual(db.log.tables.length, 0);
});

Deno.test('enrichProfileToCache : compte non relié à l’organisation ou au membre, refus sans appel', async () => {
  const db = fakeDb({ linked: false });
  await withMockTransport(() => jsonResponse(profileFull.input), async (mock) => {
    const result = await enrichProfileToCache(deps(db.client));
    strictEqual(result.ok, false);
    strictEqual(result.reason, 'account_not_linked');
    strictEqual(mock.calls.length, 0);
  });
  strictEqual(db.log.rpc.length, 0);

  const noOrg = fakeDb();
  await withMockTransport(() => jsonResponse(profileFull.input), async (mock) => {
    const result = await enrichProfileToCache(deps(noOrg.client, { organizationId: null }));
    strictEqual(result.reason, 'account_not_linked');
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('enrichProfileToCache : plafond du registre atteint, report avec sa portée, sans appel', async () => {
  const db = fakeDb({ gateAllowed: false, gateScope: 'profile_view' });
  await withMockTransport(() => jsonResponse(profileFull.input), async (mock) => {
    const result = await enrichProfileToCache(deps(db.client));
    strictEqual(result.ok, false);
    strictEqual(result.scope, 'profile_view');
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('enrichProfileToCache : aucun identifiant de profil exploitable', async () => {
  const db = fakeDb();
  await withMockTransport(() => jsonResponse(profileFull.input), async (mock) => {
    const result = await enrichProfileToCache(deps(db.client, { providerId: null, profileUrl: 'https://example.com/x' }));
    strictEqual(result.ok, false);
    strictEqual(result.reason, 'no profile identifier');
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('enrichProfileToCache : limite du réseau atteinte = compte mis en pause, sans texte du prestataire', async () => {
  const db = fakeDb();
  await withMockTransport(() => ({ status: 429, body: { error: 'Weekly invitation limit reached for this provider' } }), async () => {
    const result = await enrichProfileToCache(deps(db.client));
    strictEqual(result.ok, false);
    strictEqual(result.reason, 'profile_read_provider_limit');
    ok(!/unipile|limit reached/i.test(result.reason ?? ''));
  });
  const pause = db.log.updates.find((u) => u.table === 'member_linkedin_accounts');
  ok(pause, 'le compte est mis en pause');
  strictEqual(pause.row.last_usage_pct, 100);
  ok(typeof pause.row.quota_paused_until === 'string');
});

Deno.test('enrichProfileToCache : trop de requêtes sur la clé commune ne met PAS le compte du membre en pause', async () => {
  const db = fakeDb();
  await withMockTransport(() => ({ status: 429, body: { error: 'Too many requests' } }), async () => {
    const result = await enrichProfileToCache(deps(db.client));
    strictEqual(result.reason, 'profile_read_rate_limited');
  });
  strictEqual(db.log.updates.some((u) => u.table === 'member_linkedin_accounts'), false);
});

Deno.test('enrichProfileToCache : profil introuvable ou compte déconnecté, raison neutre', async () => {
  for (const [status, body, reason] of [
    [404, { error: 'User not found' }, 'profile_read_not_found'],
    [401, { error: 'Account session expired, please reconnect the account' }, 'profile_read_account_disconnected'],
  ] as const) {
    const db = fakeDb();
    await withMockTransport(() => ({ status, body }), async () => {
      const result = await enrichProfileToCache(deps(db.client, { profileUrl: PROFILE_URL }));
      strictEqual(result.ok, false);
      strictEqual(result.reason, reason);
    });
    strictEqual(db.log.upserts.length, 0);
  }
});

Deno.test('enrichProfileToCache : sections limitées par LinkedIn et rien d’utilisable, échec lisible et rien en cache', async () => {
  const db = fakeDb();
  const empty = { object: 'UserProfile', id: PROVIDER_ID, display_name: 'Marie', specifics: { throttled_sections: ['experience', 'education'] } };
  await withMockTransport(() => jsonResponse(empty), async () => {
    const result = await enrichProfileToCache(deps(db.client));
    strictEqual(result.ok, false);
    strictEqual(result.reason, 'no usable sections in response (throttled)');
  });
  strictEqual(db.log.upserts.length, 0);
});

Deno.test('enrichProfileToCache : sans adresse de profil, le cache se range par provider_id', async () => {
  const db = fakeDb();
  await withMockTransport(() => jsonResponse(profileFull.input), async () => {
    const result = await enrichProfileToCache(deps(db.client, { profileUrl: null }));
    strictEqual(result.ok, true);
  });
  const upsert = db.log.upserts.find((u) => u.table === 'candidate_enrichment_cache');
  strictEqual(upsert.opts.onConflict, 'organization_id,provider_id');
  strictEqual(upsert.row.linkedin_url, null);
});

Deno.test('enrichProfileToCache : une lecture manquée coûte UNE lecture au registre, jamais une seconde forme d’identifiant', async () => {
  for (const [status, reason] of [[404, 'profile_read_not_found'], [422, 'profile_read_validation']] as const) {
    const db = fakeDb();
    await withMockTransport(() => ({ status, body: { error: 'nope' } }), async (mock) => {
      const result = await enrichProfileToCache(deps(db.client));
      strictEqual(result.reason, reason);
      strictEqual(mock.calls.length, 1, `statut ${status} : une seule lecture`);
      strictEqual(mock.calls[0].path, `/${ACCOUNT}/users/${PROVIDER_ID}`);
    });
    strictEqual(db.log.rpc.filter((name) => name === 'check_linkedin_action_quota').length, 1, 'une entrée profile_view');
  }
});

Deno.test('enrichProfileToCache : sans identifiant du prestataire, la lecture se fait par le pseudo de l’adresse', async () => {
  const db = fakeDb();
  await withMockTransport(() => jsonResponse(profileFull.input), async (mock) => {
    const result = await enrichProfileToCache(deps(db.client, { providerId: null }));
    strictEqual(result.ok, true);
    strictEqual(mock.calls.length, 1);
    strictEqual(mock.calls[0].path, `/${ACCOUNT}/users/marie-dupont-123`);
  });
});
