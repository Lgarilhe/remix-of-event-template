// Valeurs de l'aperçu (refonte mission, lot 5d-1) : contexte du moteur,
// candidats effacés exclus, contrôle de la requête, variables personnelles
// d'un autre membre jamais données, lecture en échec sans aperçu, rotation
// multi-expéditeurs annoncée, et parité du rendu
// (tests/fixtures/template-render-cases.json, joué aussi côté navigateur par
// tests/ux/lot5d1-rendu-apercu.test.mjs).
//
//   deno test --no-check --import-map=e2e/local-stack/import_map.json supabase/functions/_shared/sequence-preview-values.test.ts

import { deepStrictEqual as assertEquals, ok as assert, strictEqual } from 'node:assert';
import fixture from '../../../tests/fixtures/template-render-cases.json' with { type: 'json' };
import {
  buildPreviewValues,
  DRAWN_SENDER_LABELS,
  DRAWN_SENDER_PERSONAL_LABEL,
  emptyTrace,
  engineContext,
  erasureStateOf,
  loadDrawnSenderSequences,
  missingPreviewKeys,
  OTHER_SENDER_PERSONAL_LABEL,
  parsePreviewRequest,
  PREVIEW_CONTEXT_KEYS,
  PREVIEW_ERASED_MESSAGE,
  PREVIEW_FAILED_MESSAGE,
  PREVIEW_MAX_CANDIDATES,
  PREVIEW_MAX_KEYS,
  PREVIEW_UNVERIFIED_MESSAGE,
  profileEnrollment,
  splitPreviewValues,
  type PreviewAudience,
  type PreviewItem,
} from './sequence-preview-values.ts';
import { SEND_TIME_VARIABLES } from './enroll-preview.ts';
import { smartTruncate } from './sequence-send-rules.ts';
import { buildSequenceContext, interpolateAndStrip } from './template-interpolation.ts';
import { clearSenderCache } from './sequence-sender.ts';

// ─── Faux client ──────────────────────────────────────────────────────────

type Query = { table: string; cols: string; filters: Record<string, unknown>; or: string | null };
type Answer = { data: unknown; error: { message: string } | null };
type Handler = (q: Query) => Answer;

/**
 * Faux client Supabase : chaque table répond via un handler (qui peut lever
 * une exception : la requête est alors rejetée), les requêtes sont gardées.
 */
function fakeClient(handlers: Record<string, Handler>) {
  const queries: Query[] = [];
  const client = {
    queries,
    from(table: string) {
      const q: Query = { table, cols: '', filters: {}, or: null };
      queries.push(q);
      const answer = (empty: unknown) => new Promise<Answer>((resolve) => resolve(handlers[table]?.(q) ?? { data: empty, error: null }));
      const builder = {
        select(cols: string) { q.cols = cols; return builder; },
        eq(col: string, value: unknown) { q.filters[col] = value; return builder; },
        in(col: string, values: unknown[]) { q.filters[col] = values; return builder; },
        is(col: string, value: unknown) { q.filters[col] = value; return builder; },
        or(expr: string) { q.or = expr; return builder; },
        limit() { return builder; },
        maybeSingle: () => answer(null),
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return answer([]).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return client;
}

const UUID_ORG = '11111111-1111-4111-8111-111111111111';
const UUID_MISSION = '22222222-2222-4222-8222-222222222222';
const UUID_SEQ = '44444444-4444-4444-8444-444444444444';
const UUID_SEQ_ROTATION = '55555555-5555-4555-8555-555555555555';
const UUID_LEGACY_USER = '66666666-6666-4666-8666-666666666666';
const enrollmentUuid = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;

async function sha256Hex(input: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const OWNERS: Record<string, string> = { ACC_LAURENT: 'u-laurent', ACC_CLAIRE: 'u-claire' };

/**
 * Monde de référence : deux membres (Laurent, Claire), un compte relié chacun,
 * une mission, des variables personnelles (Claire en a une définie dans une
 * autre organisation), une séquence simple et une séquence en rotation.
 */
function world(extra: Record<string, Handler> = {}) {
  return fakeClient({
    profiles: (q) => {
      if (q.filters.user_id === 'u-laurent') return { data: { display_name: 'Laurent Garilhe', job_title: 'Recruteur' }, error: null };
      if (q.filters.user_id === 'u-claire') return { data: { display_name: 'Claire Dubois', job_title: 'Talent Partner' }, error: null };
      return { data: null, error: null };
    },
    member_linkedin_accounts: (q) => {
      if (q.filters.organization_id !== UUID_ORG) return { data: Array.isArray(q.filters.linkedin_account_id) ? [] : null, error: null };
      const ids = q.filters.linkedin_account_id;
      if (Array.isArray(ids)) {
        return { data: ids.filter((id) => typeof id === 'string' && OWNERS[id]).map((id) => ({ linkedin_account_id: id, id: `mla-${id}` })), error: null };
      }
      const owner = OWNERS[String(ids)];
      if (q.cols === 'id') return { data: owner ? [{ id: `mla-${ids}` }] : [], error: null };
      return { data: owner ? { user_id: owner } : null, error: null };
    },
    member_email_accounts: () => ({ data: [], error: null }),
    organizations: (q) => ({ data: q.filters.id === UUID_ORG ? { name: 'Talentis' } : null, error: null }),
    sourcing_projects: (q) => ({
      data: q.filters.id === UUID_MISSION && q.filters.organization_id === UUID_ORG
        ? { name: 'Mission CDG', job_details: { title: 'Contrôleur de gestion', client: { name: 'Globex' }, location: 'Lyon' }, calendly_link: 'https://agenda.example/laurent', client_name: null }
        : null,
      error: null,
    }),
    user_template_variables: (q) => {
      if (q.filters.user_id === 'u-laurent') return { data: [{ key: 'ville', value: 'Lyon' }, { key: 'lien_demo', value: 'https://demo.example' }], error: null };
      if (q.filters.user_id === 'u-claire') {
        return { data: [{ key: 'tarif_negocie', value: '18 % (privé)' }, { key: 'lien_perso_org_b', value: 'https://org-b.example/secret' }, { key: 'ville', value: 'Nantes' }], error: null };
      }
      return { data: [], error: null };
    },
    outreach_sequences: (q) => ({
      data: [
        { id: UUID_SEQ, multi_sender_enabled: false, sender_accounts: [] },
        { id: UUID_SEQ_ROTATION, multi_sender_enabled: true, sender_accounts: [{ account_id: 'ACC_LAURENT' }, { account_id: 'ACC_CLAIRE', channel: 'linkedin' }] },
      ].filter((s) => q.filters.organization_id === UUID_ORG && (q.filters.id as string[]).includes(s.id)),
      error: null,
    }),
    sequence_step_executions: () => ({ data: [], error: null }),
    ...extra,
  });
}

const enrollmentRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: enrollmentUuid(1),
  organization_id: UUID_ORG,
  sequence_id: UUID_SEQ,
  created_by: 'u-laurent',
  account_id: 'ACC_LAURENT',
  assigned_sender_id: null,
  job_id: UUID_MISSION,
  job_title: 'Contrôleur de gestion',
  company_name: null,
  profile_id: 'ACoAAJulie',
  provider_id: null,
  resolved_profile_id: null,
  profile_name: 'Julie Martin',
  profile_headline: 'Directrice financière chez Acme | Ex-Big4',
  profile_url: 'https://www.linkedin.com/in/julie-martin-e2e/',
  network_distance: 'SECOND_DEGREE',
  tracking_data: {},
  ...over,
});

const ALL_KEYS = [
  ...PREVIEW_CONTEXT_KEYS, 'first_name', 'last_name', 'name', 'company', 'job_title', 'sender_name', 'calendly_link',
  'ville', 'city', 'lien_demo', 'tarif_negocie', 'lien_perso_org_b',
];

const audience = (over: Partial<PreviewAudience> = {}): PreviewAudience => ({
  organizationId: UUID_ORG,
  callerUserId: 'u-laurent',
  keys: ALL_KEYS,
  drawnSenderSequences: new Set(),
  ...over,
});

const enrollmentItem = (row: Record<string, unknown>): PreviewItem => ({ source: 'enrollment', id: String(row.id), enrollment: row });

// ─── Contexte identique à celui du moteur ─────────────────────────────────

Deno.test('contexte identique à celui du moteur pour une même inscription (variables demandées, heure d’envoi annoncée à part)', async () => {
  for (const row of [
    enrollmentRow(),
    // Mission absente : le titre écrit sur l'inscription.
    enrollmentRow({ id: enrollmentUuid(3), job_id: null, profile_headline: null }),
    enrollmentRow({ id: enrollmentUuid(4), profile_name: '🚀 Paul Roux', company_name: 'Initech' }),
  ]) {
    clearSenderCache();
    // Appel du moteur (process-sequences, interpolation de garde d'une étape LinkedIn).
    const engine = await buildSequenceContext(world() as never, { enrollment: row, senderUserId: (row.created_by as string) || null });
    clearSenderCache();
    const keys = [...Object.keys(engine), 'variable_inconnue'];
    const result = await buildPreviewValues(world() as never, audience({ keys }), [enrollmentItem(row)]);
    assertEquals(result.excluded, []);
    strictEqual(result.candidates.length, 1);
    const { values, missing, source, id, at_send } = result.candidates[0];
    strictEqual(source, 'enrollment');
    strictEqual(id, row.id);
    assertEquals(at_send, {}, 'expéditeur = l’appelant : rien à annoncer');
    const expected = Object.fromEntries(Object.entries(engine).filter(([k, v]) => v !== undefined && !(k in SEND_TIME_VARIABLES)));
    assertEquals(values, expected, `valeurs du moteur pour ${row.id}`);
    for (const key of Object.keys(SEND_TIME_VARIABLES)) assert(!(key in values), `${key} n'est jamais donnée avec sa valeur du moment`);
    assertEquals(result.send_time, { ...SEND_TIME_VARIABLES });
    assertEquals(missing, missingPreviewKeys(engine));
  }
});

Deno.test('le contexte suit les règles du moteur : prénom fiable, titre découpé, alias city / ville, expéditeur titulaire du compte', async () => {
  clearSenderCache();
  const trace = emptyTrace();
  const ctx = await engineContext(world() as never, enrollmentRow(), trace);
  const { values: plain } = splitPreviewValues(ctx, trace, { keys: ALL_KEYS, callerUserId: 'u-laurent', senderDrawnAtSend: false });
  strictEqual(plain.prenom, 'Julie');
  strictEqual(plain.poste_actuel, 'Directrice financière');
  strictEqual(plain.entreprise_actuelle, 'Acme');
  strictEqual(plain.city, 'Lyon');
  strictEqual(plain.poste_recherche, 'Contrôleur de gestion');
  strictEqual(plain.client, 'Globex');
  strictEqual(plain.ma_signature, 'Laurent Garilhe');
  strictEqual(plain.ma_societe, 'Talentis');
  strictEqual(plain.lien_demo, 'https://demo.example', 'variable personnelle de l’appelant, expéditeur');
  strictEqual(trace.senderUserId, 'u-laurent');
  assertEquals([...trace.personalKeys].sort(), ['city', 'lien_demo', 'ville']);
  clearSenderCache();
  const unreliable = await engineContext(world() as never, enrollmentRow({ profile_name: 'Dr. Paul Roux' }));
  strictEqual(unreliable.prenom, undefined, 'prénom non fiable : aucune valeur');
  assert(missingPreviewKeys(unreliable).includes('prenom'));
});

Deno.test('seules les variables demandées sont rendues', async () => {
  clearSenderCache();
  const result = await buildPreviewValues(world() as never, audience({ keys: ['prenom', 'client'] }), [enrollmentItem(enrollmentRow())]);
  assertEquals(result.candidates[0].values, { prenom: 'Julie', client: 'Globex' });
  assertEquals(result.candidates[0].at_send, {});
  // Les données absentes restent calculées sur toutes les variables du moteur.
  assert(result.candidates[0].missing.includes('type_contrat'));
  assert(!result.candidates[0].missing.includes('ma_signature'));
});

Deno.test('candidat pas encore inscrit : colonnes du navigateur, expéditeur = l’appelant', async () => {
  clearSenderCache();
  const enrollment = profileEnrollment(
    { id: 'ACoAAMarc', profile_name: 'Marc Lefèvre', profile_headline: 'Développeur Go · Freelance', profile_url: 'https://www.linkedin.com/in/marc-e2e', job_title: 'Lead Dev Go' },
    { organizationId: UUID_ORG, userId: 'u-claire', accountId: 'ACC_CLAIRE', missionId: null, sequenceId: UUID_SEQ },
  );
  assertEquals(enrollment, {
    organization_id: UUID_ORG, sequence_id: UUID_SEQ, created_by: 'u-claire', account_id: 'ACC_CLAIRE', job_id: null, job_title: 'Lead Dev Go',
    profile_id: 'ACoAAMarc', provider_id: null, profile_name: 'Marc Lefèvre', profile_headline: 'Développeur Go · Freelance',
    profile_url: 'https://www.linkedin.com/in/marc-e2e', company_name: null, network_distance: null,
  });
  const result = await buildPreviewValues(world() as never, audience({ callerUserId: 'u-claire' }), [{ source: 'profile', id: 'ACoAAMarc', enrollment }]);
  const { values, at_send, missing } = result.candidates[0];
  strictEqual(values.mon_prenom, 'Claire');
  strictEqual(values.poste_actuel, 'Développeur Go');
  strictEqual(values.entreprise_actuelle, undefined);
  strictEqual(values.poste_recherche, 'Lead Dev Go', 'sans mission : titre écrit sur l’inscription');
  strictEqual(values.tarif_negocie, '18 % (privé)', 'ses propres variables, à l’appelant');
  assertEquals(at_send, {});
  assert(missing.includes('entreprise_actuelle'));
  assert(!missing.includes('prenom'));
});

// ─── Variables personnelles d'un autre membre ─────────────────────────────

Deno.test('inscription d’un collègue : aucune de ses variables personnelles avec sa valeur, même demandée, ni hors des clés demandées', async () => {
  clearSenderCache();
  // Inscription créée par Claire depuis son compte ; Laurent demande l'aperçu.
  const row = enrollmentRow({ id: enrollmentUuid(5), created_by: 'u-claire', account_id: 'ACC_CLAIRE' });
  const keys = ['prenom', 'mon_prenom', 'ma_signature', 'tarif_negocie', 'city', 'variable_inconnue'];
  const result = await buildPreviewValues(world() as never, audience({ keys }), [enrollmentItem(row)]);
  const [candidate] = result.candidates;
  assertEquals(candidate.values, { prenom: 'Julie', mon_prenom: 'Claire', ma_signature: 'Claire Dubois' }, 'profil de l’expéditeur, visible de l’équipe');
  assertEquals(candidate.at_send, {
    tarif_negocie: OTHER_SENDER_PERSONAL_LABEL,
    city: OTHER_SENDER_PERSONAL_LABEL,
    // Clé hors du moteur, que Claire n'a pas : annoncée pareil (aucun indice de ce qui existe).
    variable_inconnue: OTHER_SENDER_PERSONAL_LABEL,
  });
  const body = JSON.stringify(result);
  for (const secret of ['18 % (privé)', 'https://org-b.example/secret', 'Nantes', 'lien_perso_org_b']) {
    assert(!body.includes(secret), `« ${secret} » jamais dans la réponse`);
  }
  // Variable d'une autre organisation de Claire, non demandée : absente.
  assert(!('lien_perso_org_b' in candidate.values) && !('lien_perso_org_b' in candidate.at_send));
});

Deno.test('compte d’envoi d’un collègue sur l’inscription de l’appelant : le titulaire signe, ses variables restent annoncées', async () => {
  clearSenderCache();
  const row = enrollmentRow({ id: enrollmentUuid(6), assigned_sender_id: 'ACC_CLAIRE' });
  const result = await buildPreviewValues(world() as never, audience({ keys: ['ma_signature', 'ville', 'lien_demo'] }), [enrollmentItem(row)]);
  assertEquals(result.candidates[0].values, { ma_signature: 'Claire Dubois' });
  assertEquals(result.candidates[0].at_send, { ville: OTHER_SENDER_PERSONAL_LABEL, lien_demo: OTHER_SENDER_PERSONAL_LABEL });
  assert(!JSON.stringify(result).includes('Nantes'));
});

// ─── Rotation multi-expéditeurs ───────────────────────────────────────────

Deno.test('rotation : séquence en rotation avec un compte relié = expéditeur choisi à l’envoi ; sans compte relié ou sans rotation : non', async () => {
  const seqs = await loadDrawnSenderSequences(world() as never, UUID_ORG, [UUID_SEQ, UUID_SEQ_ROTATION, null, 'pas-un-uuid']);
  assert(seqs.ok);
  assertEquals([...seqs.found].sort(), [UUID_SEQ, UUID_SEQ_ROTATION].sort());
  assertEquals([...seqs.drawn], [UUID_SEQ_ROTATION]);
  // Groupe sans compte LinkedIn relié à l'organisation : le moteur envoie depuis le compte de l'inscription.
  const unlinked = await loadDrawnSenderSequences(world({ member_linkedin_accounts: () => ({ data: [], error: null }) }) as never, UUID_ORG, [UUID_SEQ_ROTATION]);
  assert(unlinked.ok && unlinked.drawn.size === 0);
  // Entrée e-mail du groupe : jamais un expéditeur LinkedIn.
  const emailOnly = await loadDrawnSenderSequences(world({
    outreach_sequences: () => ({ data: [{ id: UUID_SEQ_ROTATION, multi_sender_enabled: true, sender_accounts: [{ account_id: 'ACC_LAURENT', channel: 'email' }] }], error: null }),
  }) as never, UUID_ORG, [UUID_SEQ_ROTATION]);
  assert(emailOnly.ok && emailOnly.drawn.size === 0);
  const failed = await loadDrawnSenderSequences(world({ outreach_sequences: () => ({ data: null, error: { message: 'boom' } }) }) as never, UUID_ORG, [UUID_SEQ]);
  strictEqual(failed.ok, false);
  const none = await loadDrawnSenderSequences(world() as never, UUID_ORG, []);
  assert(none.ok && none.found.size === 0);
});

Deno.test('rotation : prénom, signature, poste et variables personnelles de l’expéditeur annoncés, jamais ceux de l’appelant', async () => {
  clearSenderCache();
  const drawn = new Set([UUID_SEQ_ROTATION]);
  const enrollment = profileEnrollment(
    { id: 'ACoAAJulie', profile_name: 'Julie Martin', profile_headline: 'Directrice financière chez Acme' },
    { organizationId: UUID_ORG, userId: 'u-laurent', accountId: 'ACC_LAURENT', missionId: UUID_MISSION, sequenceId: UUID_SEQ_ROTATION },
  );
  const keys = ['prenom', 'mon_prenom', 'sender_name', 'mon_nom', 'ma_signature', 'mon_poste', 'ma_societe', 'city', 'lien_demo', 'client'];
  const result = await buildPreviewValues(world() as never, audience({ keys, drawnSenderSequences: drawn }), [{ source: 'profile', id: 'ACoAAJulie', enrollment }]);
  const [candidate] = result.candidates;
  assertEquals(candidate.values, { prenom: 'Julie', ma_societe: 'Talentis', client: 'Globex' });
  assertEquals(candidate.at_send, {
    mon_prenom: DRAWN_SENDER_LABELS.mon_prenom,
    sender_name: DRAWN_SENDER_LABELS.sender_name,
    mon_nom: DRAWN_SENDER_LABELS.mon_nom,
    ma_signature: DRAWN_SENDER_LABELS.ma_signature,
    mon_poste: DRAWN_SENDER_LABELS.mon_poste,
    city: DRAWN_SENDER_PERSONAL_LABEL,
    lien_demo: DRAWN_SENDER_PERSONAL_LABEL,
  });
  assert(!JSON.stringify(result).includes('Laurent'), 'aucune valeur de l’appelant pour l’expéditeur');
  assert(!candidate.missing.includes('mon_prenom'));

  // Expéditeur déjà attribué par le moteur : connu, rendu.
  clearSenderCache();
  const assigned = enrollmentRow({ id: enrollmentUuid(7), sequence_id: UUID_SEQ_ROTATION, assigned_sender_id: 'ACC_LAURENT' });
  const known = await buildPreviewValues(world() as never, audience({ keys, drawnSenderSequences: drawn }), [enrollmentItem(assigned)]);
  strictEqual(known.candidates[0].values.ma_signature, 'Laurent Garilhe');
  assertEquals(known.candidates[0].at_send, {});

  // Conversation déjà engagée sans expéditeur : figée sur le compte de l'inscription (SEQ-013).
  clearSenderCache();
  const engaged = enrollmentRow({ id: enrollmentUuid(8), sequence_id: UUID_SEQ_ROTATION });
  const engagedWorld = world({ sequence_step_executions: (q) => ({ data: q.filters.enrollment_id === enrollmentUuid(8) ? [{ id: 'x1' }] : [], error: null }) });
  const frozen = await buildPreviewValues(engagedWorld as never, audience({ keys, drawnSenderSequences: drawn }), [enrollmentItem(engaged)]);
  strictEqual(frozen.candidates[0].values.ma_signature, 'Laurent Garilhe');
  assertEquals(frozen.candidates[0].at_send, {});
  const pending = enrollmentRow({ id: enrollmentUuid(9), sequence_id: UUID_SEQ_ROTATION });
  const drawnLater = await buildPreviewValues(engagedWorld as never, audience({ keys, drawnSenderSequences: drawn }), [enrollmentItem(pending)]);
  strictEqual(drawnLater.candidates[0].at_send.ma_signature, DRAWN_SENDER_LABELS.ma_signature);
});

Deno.test('assigned_sender_id hérité (user_id non rattaché) ignoré comme le moteur : le titulaire du compte de l’inscription signe', async () => {
  clearSenderCache();
  // Inscription de Laurent, mais compte de Claire et assigned_sender_id hérité.
  const row = enrollmentRow({ id: enrollmentUuid(10), account_id: 'ACC_CLAIRE', assigned_sender_id: UUID_LEGACY_USER });
  const result = await buildPreviewValues(world() as never, audience({ keys: ['ma_signature'] }), [enrollmentItem(row)]);
  strictEqual(result.candidates[0].values.ma_signature, 'Claire Dubois', 'titulaire d’account_id, pas l’auteur');
  // Contrôle illisible : pas d'aperçu.
  clearSenderCache();
  const broken = world({ member_email_accounts: () => ({ data: null, error: { message: 'boom' } }) });
  const failed = await buildPreviewValues(broken as never, audience({ keys: ['ma_signature'] }), [enrollmentItem(row)]);
  assertEquals(failed.candidates, []);
  assertEquals(failed.excluded.map((e) => e.reason), ['preview_failed']);
});

// ─── Lecture en échec : pas d'aperçu, jamais un texte faux ────────────────

Deno.test('une lecture en échec (erreur ou exception) donne un candidat exclu, jamais des valeurs', async () => {
  const failing: Array<[string, Handler]> = [
    ['profiles', () => ({ data: null, error: { message: 'boom' } })],
    ['profiles', () => { throw new Error('réseau'); }],
    ['organizations', () => ({ data: null, error: { message: 'boom' } })],
    ['organizations', () => { throw new Error('réseau'); }],
    ['sourcing_projects', () => ({ data: null, error: { message: 'boom' } })],
    ['sourcing_projects', () => { throw new Error('réseau'); }],
    ['user_template_variables', () => ({ data: null, error: { message: 'boom' } })],
    ['user_template_variables', () => { throw new Error('réseau'); }],
    ['member_linkedin_accounts', () => ({ data: null, error: { message: 'boom' } })],
    ['sequence_step_executions', () => ({ data: null, error: { message: 'boom' } })],
  ];
  for (const [table, handler] of failing) {
    clearSenderCache();
    const row = enrollmentRow({ sequence_id: UUID_SEQ_ROTATION });
    const result = await buildPreviewValues(
      world({ [table]: handler }) as never,
      audience({ drawnSenderSequences: new Set([UUID_SEQ_ROTATION]) }),
      [enrollmentItem(row)],
    );
    assertEquals(result.candidates, [], `${table} : aucune valeur`);
    assertEquals(result.excluded, [{ source: 'enrollment', id: row.id, reason: 'preview_failed', message: PREVIEW_FAILED_MESSAGE }], table);
  }
});

// ─── Candidat effacé exclu ────────────────────────────────────────────────

Deno.test('candidat effacé exclu : marqueur de l’inscription, sans lecture de son contexte', async () => {
  clearSenderCache();
  const client = world();
  const erased = enrollmentRow({ tracking_data: { gdpr_erased_at: '2026-10-01T00:00:00Z' }, profile_name: null });
  const result = await buildPreviewValues(client as never, audience(), [
    enrollmentItem(erased),
    enrollmentItem(enrollmentRow({ id: enrollmentUuid(9) })),
  ]);
  assertEquals(result.excluded, [{ source: 'enrollment', id: erased.id, reason: 'gdpr_erased', message: PREVIEW_ERASED_MESSAGE }]);
  assertEquals(result.candidates.map((c) => c.id), [enrollmentUuid(9)]);
});

Deno.test('candidat effacé exclu : registre global (empreinte de l’URL) et marqueur d’une autre inscription de l’organisation', async () => {
  clearSenderCache();
  const erasedUrl = 'https://www.linkedin.com/in/efface-e2e';
  const erasedHash = await sha256Hex(erasedUrl);
  const client = world({
    gdpr_erasures: (q) => ({ data: (q.filters.linkedin_url_hash as string[] | undefined)?.includes(erasedHash) ? [{ id: 'g1' }] : [], error: null }),
    sequence_enrollments: (q) => ({
      data: q.filters.organization_id === UUID_ORG && q.or?.includes('ACoAAMarque')
        ? [{ id: 'old', profile_id: 'ACoAAMarque', provider_id: null, resolved_profile_id: null, profile_url: null, tracking_data: { gdpr_erased_at: '2026-09-01T00:00:00Z' } }]
        : [],
      error: null,
    }),
  });
  const ctx = { organizationId: UUID_ORG, userId: 'u-laurent', accountId: 'ACC_LAURENT', missionId: null };
  const result = await buildPreviewValues(client as never, audience(), [
    { source: 'profile', id: 'ACoAAEfface', enrollment: profileEnrollment({ id: 'ACoAAEfface', profile_name: 'Eve Efface', profile_url: `${erasedUrl}/` }, ctx) },
    { source: 'profile', id: 'ACoAAMarque', enrollment: profileEnrollment({ id: 'ACoAAMarque', profile_name: 'Marc Marque' }, ctx) },
    { source: 'profile', id: 'ACoAALibre', enrollment: profileEnrollment({ id: 'ACoAALibre', profile_name: 'Lina Libre', profile_url: 'https://www.linkedin.com/in/libre-e2e' }, ctx) },
  ]);
  assertEquals(result.excluded.map((e) => [e.id, e.reason]), [['ACoAAEfface', 'gdpr_erased'], ['ACoAAMarque', 'gdpr_erased']]);
  assertEquals(result.candidates.map((c) => c.id), ['ACoAALibre']);
});

Deno.test('registre illisible : aucun aperçu, raison rendue, jamais « non effacé »', async () => {
  clearSenderCache();
  const client = world({ gdpr_erasures: () => ({ data: null, error: { message: 'permission denied' } }) });
  const row = enrollmentRow();
  strictEqual(await erasureStateOf(client as never, UUID_ORG, row), 'unverified');
  const result = await buildPreviewValues(client as never, audience(), [enrollmentItem(row)]);
  assertEquals(result.candidates, []);
  assertEquals(result.excluded, [{ source: 'enrollment', id: row.id, reason: 'gdpr_unverified', message: PREVIEW_UNVERIFIED_MESSAGE }]);
  assert(!client.queries.some((q) => q.table === 'profiles' || q.table === 'user_template_variables'), 'aucun contexte construit');
});

// ─── Requête ──────────────────────────────────────────────────────────────

Deno.test('requête : 20 candidats au plus en tout, 21 refusés', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => enrollmentUuid(i + 1));
  const base = { action: 'preview_values', organization_id: UUID_ORG, keys: ['prenom'] };
  strictEqual(PREVIEW_MAX_CANDIDATES, 20);
  const ok = parsePreviewRequest({ ...base, enrollment_ids: ids(20) });
  assert(ok.ok && ok.request.enrollment_ids.length === 20);
  const tooMany = parsePreviewRequest({ ...base, enrollment_ids: ids(21) });
  assert(!tooMany.ok && tooMany.code === 'PREVIEW_TOO_MANY' && tooMany.status === 400);
  const mixed = parsePreviewRequest({ ...base, enrollment_ids: ids(11), profiles: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}` })) });
  assert(!mixed.ok && mixed.code === 'PREVIEW_TOO_MANY', 'inscriptions et profils comptés ensemble');
  const duplicates = parsePreviewRequest({ ...base, enrollment_ids: [...ids(20), enrollmentUuid(1)] });
  assert(!duplicates.ok && duplicates.code === 'PREVIEW_TOO_MANY', 'compté avant dédoublonnage');
  const deduped = parsePreviewRequest({ ...base, enrollment_ids: [enrollmentUuid(1), enrollmentUuid(1)] });
  assert(deduped.ok);
  assertEquals(deduped.request.enrollment_ids, [enrollmentUuid(1)]);
});

Deno.test('requête : action, organisation, mission, séquence, variables, identifiants et profils contrôlés', () => {
  const base = { action: 'preview_values', organization_id: UUID_ORG, enrollment_ids: [enrollmentUuid(1)], keys: ['prenom'] };
  const code = (body: unknown) => {
    const r = parsePreviewRequest(body);
    return r.ok ? 'ok' : r.code;
  };
  strictEqual(code(base), 'ok');
  strictEqual(code({ ...base, action: 'save' }), 'PREVIEW_UNKNOWN_ACTION');
  strictEqual(code({ ...base, organization_id: 'org-1' }), 'PREVIEW_INVALID_INPUT');
  strictEqual(code({ ...base, mission_id: 'project:abc' }), 'PREVIEW_INVALID_INPUT');
  strictEqual(code({ ...base, mission_id: UUID_MISSION }), 'ok');
  strictEqual(code({ ...base, sequence_id: 'seq-1' }), 'PREVIEW_INVALID_INPUT');
  strictEqual(code({ ...base, sequence_id: UUID_SEQ }), 'ok');
  strictEqual(code({ ...base, enrollment_ids: ['pas-un-uuid'] }), 'PREVIEW_INVALID_INPUT');
  strictEqual(code({ ...base, enrollment_ids: [] }), 'PREVIEW_INVALID_INPUT');
  strictEqual(code({ ...base, enrollment_ids: [], profiles: [{ id: '' }] }), 'PREVIEW_INVALID_INPUT');
  strictEqual(code({ ...base, enrollment_ids: [], profiles: [{ id: 'p1', profile_name: 42 }] }), 'PREVIEW_INVALID_INPUT');
  strictEqual(code({ ...base, enrollment_ids: [], profiles: [{ id: 'p1', profile_headline: 'x'.repeat(2001) }] }), 'PREVIEW_INVALID_INPUT');
  strictEqual(code([]), 'PREVIEW_INVALID_INPUT');
  // Variables : obligatoires (liste vide admise), 50 au plus, forme du moteur.
  strictEqual(code({ ...base, keys: undefined }), 'PREVIEW_INVALID_INPUT');
  strictEqual(code({ ...base, keys: [] }), 'ok');
  strictEqual(PREVIEW_MAX_KEYS, 50);
  strictEqual(code({ ...base, keys: Array.from({ length: 50 }, (_, i) => `k${i}`) }), 'ok');
  strictEqual(code({ ...base, keys: Array.from({ length: 51 }, (_, i) => `k${i}`) }), 'PREVIEW_INVALID_INPUT');
  strictEqual(code({ ...base, keys: ['prénom'] }), 'PREVIEW_INVALID_INPUT');
  strictEqual(code({ ...base, keys: [42] }), 'PREVIEW_INVALID_INPUT');
  const normalized = parsePreviewRequest({ ...base, keys: [' Prenom ', 'prenom', 'CITY'] });
  assert(normalized.ok);
  assertEquals(normalized.request.keys, ['prenom', 'city']);
  const parsed = parsePreviewRequest({ ...base, enrollment_ids: undefined, profiles: [{ id: 'p1', profile_name: 'Julie', extra: 'ignoré' }] });
  assert(parsed.ok);
  assertEquals(parsed.request.profiles, [{
    id: 'p1', provider_id: null, profile_name: 'Julie', profile_headline: null, profile_url: null,
    company_name: null, job_title: null, network_distance: null,
  }]);
  assertEquals(parsed.request.sequence_id, null);
});

Deno.test('données absentes : variables du moteur sans valeur', () => {
  assertEquals(missingPreviewKeys({ prenom: 'Julie', nom: '  ', ma_societe: 'Talentis' }),
    PREVIEW_CONTEXT_KEYS.filter((k) => k !== 'prenom' && k !== 'ma_societe'));
  assert(!missingPreviewKeys({}, true).includes('mon_prenom'), 'expéditeur choisi à l’envoi : pas une donnée absente');
});

// ─── Parité du rendu (jeu de cas commun) ──────────────────────────────────

interface RenderCase {
  name: string;
  text: string;
  values: Record<string, string>;
  expected: string;
  missing?: string[];
  enrollment?: Record<string, unknown>;
  sender?: { display_name: string; job_title?: string };
  organization_name?: string;
  mission?: Record<string, unknown>;
  custom_variables?: Array<{ key: string; value: string }>;
}

const CASES = (fixture as { cases: RenderCase[] }).cases;
const INVITE_CASES = (fixture as unknown as { invite_note_cases: Array<{ name: string; text: string; expected: string }> }).invite_note_cases;

const keyOf = (raw: string) => raw.replace(/^\{\{|\}\}$/g, '').split('|')[0].trim().toLowerCase();
const leftoverKeys = (leftover: string[]) => [...new Set(leftover.map(keyOf).filter(Boolean))];
const textKeys = (text: string) => [...new Set([...text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((m) => keyOf(`{{${m[1]}}}`)))];

function caseClient(c: RenderCase) {
  return fakeClient({
    profiles: () => ({ data: c.sender ?? null, error: null }),
    organizations: () => ({ data: c.organization_name ? { name: c.organization_name } : null, error: null }),
    sourcing_projects: (q) => ({ data: c.mission && q.filters.id === 'mission-1' ? c.mission : null, error: null }),
    user_template_variables: () => ({ data: c.custom_variables ?? [], error: null }),
  });
}

Deno.test('parité du rendu : interpolateAndStrip donne le texte attendu du jeu de cas commun', async () => {
  assert(CASES.length >= 10, 'jeu de cas chargé');
  for (const c of CASES) {
    const fromValues = interpolateAndStrip(c.text, c.values);
    strictEqual(fromValues.result, c.expected, c.name);
    if (c.missing) assertEquals(leftoverKeys(fromValues.leftover), c.missing, `${c.name} (variables retirées)`);
    if (!c.enrollment) continue;
    // Le contexte du moteur pour cette inscription donne le même texte, et
    // preview_values rend exactement les valeurs du jeu pour chaque variable du texte.
    clearSenderCache();
    const trace = emptyTrace();
    const ctx = await engineContext(caseClient(c) as never, c.enrollment, trace);
    strictEqual(interpolateAndStrip(c.text, ctx).result, c.expected, `${c.name} (contexte du moteur)`);
    const sender = typeof c.enrollment.created_by === 'string' ? c.enrollment.created_by : 'u-sender';
    const { values, at_send } = splitPreviewValues(ctx, trace, { keys: textKeys(c.text), callerUserId: sender, senderDrawnAtSend: false });
    assertEquals(at_send, {}, `${c.name} : expéditeur = appelant`);
    for (const key of textKeys(c.text)) {
      strictEqual((values[key] ?? '').trim() ? values[key] : undefined, c.values[key], `${c.name} : valeur de ${key}`);
    }
  }
});

Deno.test('parité de la note d’invitation : smartTruncate du moteur donne le texte attendu du jeu commun', () => {
  assert(INVITE_CASES.length >= 5, 'jeu de cas chargé');
  for (const c of INVITE_CASES) {
    strictEqual(smartTruncate(c.text, 300), c.expected, c.name);
    assert(c.expected.length <= 300, `${c.name} : 300 caractères au plus`);
  }
  assert(INVITE_CASES.some((c) => c.text.length > 300 && c.expected.length < c.text.length), 'une note coupée');
});
