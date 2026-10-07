import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const compiled = await build({
  entryPoints: [`${root}supabase/functions/_shared/candidate-actions/context.ts`],
  bundle: true, format: 'esm', platform: 'node', write: false,
  plugins: [{ name: 'read-only-transports', setup(builder) {
    builder.onResolve({ filter: /\/transport\.ts$/ }, () => ({ path: 'transport', namespace: 'test' }));
    builder.onResolve({ filter: /\/get-or-fetch-contact\.ts$/ }, () => ({ path: 'erasure', namespace: 'erasure-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'erasure-test' }, () => ({ contents: 'export const isCandidateErasedForOrg = (...args) => globalThis.contextTestTransport.erased(...args);' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `
      export const validateCandidateActionChat = (...args) => globalThis.contextTestTransport.validate(...args);
      export const candidateActionStoredEmailSource = (...args) => globalThis.contextTestTransport.emailSource(...args);
      export const loadCandidateActionTargets = (...args) => globalThis.contextTestTransport.targets(...args);
      export const readCandidateActionChatContext = (...args) => globalThis.contextTestTransport.chat(...args);
      export const readCandidateActionEmailContext = (...args) => globalThis.contextTestTransport.email(...args);
    ` }));
  } }],
});
const { loadCandidateActionContext, normalizeActionLinkedInUrl, candidateActionContextVersion } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const MISSION = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const candidate = { id: 'candidate-row', candidate_id: 'ACo-candidate', organization_id: ORG, project_id: MISSION, candidate_name: 'Camille Martin', linkedin_profile_url: 'https://www.linkedin.com/in/camille-martin/', linkedin_profile_data: { summary: 'Développeuse' }, created_by: USER, updated_at: '2026-10-01T09:00:00Z' };
const scope = { organization_id: ORG, candidate_id: candidate.candidate_id, project_id: MISSION };

function client(tables, fail = []) {
  const calls = [];
  return {
    calls,
    from(table) {
      const filters = []; let maximum; let single = false;
      const query = {
        select() { return query; },
        eq(key, value) { filters.push(r => r[key] === value); return query; },
        in(key, values) { filters.push(r => values.includes(r[key])); return query; },
        not(key, operator, value) { assert.equal(operator, 'in'); const ids = value.slice(1, -1).split(','); filters.push(r => !ids.includes(r[key])); return query; },
        or(expression) { const match = /^effect_id\.is\.null,effect_id\.not\.in\.\(([^)]*)\)$/.exec(expression); assert.ok(match, 'filtre de reçu SQL préservant les effect_id NULL'); const ids = match[1].split(','); filters.push(r => r.effect_id == null || !ids.includes(r.effect_id)); return query; },
        is(key, value) { filters.push(r => (r[key] ?? null) === value); return query; },
        overlaps(key, values) { filters.push(r => Array.isArray(r[key]) && r[key].some(v => values.includes(v))); return query; },
        ilike(key, pattern) { const term = pattern.replaceAll('%', '').replaceAll('\\', '').toLowerCase(); filters.push(r => String(r[key] || '').toLowerCase().includes(term)); return query; },
        order() { return query; },
        limit(n) { maximum = n; return query; },
        maybeSingle() { single = true; return query; },
        insert() { throw new Error('Contexte ne doit jamais écrire'); },
        update() { throw new Error('Contexte ne doit jamais écrire'); },
        delete() { throw new Error('Contexte ne doit jamais écrire'); },
        then(resolve, reject) {
          calls.push(table);
          const data = (tables[table] || []).filter(r => filters.every(f => f(r))).slice(0, maximum);
          return Promise.resolve({ data: single ? data[0] ?? null : data, error: fail.includes(table) ? { message: 'Source en panne' } : null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

function fixture(overrides = {}, fail = []) {
  globalThis.contextTestTransport = {
    validate: async () => ({ candidateIds: ['ACo-candidate'], linkedinUrl: candidate.linkedin_profile_url, candidateName: candidate.candidate_name }),
    targets: async () => [],
    chat: async () => ({ messages: [], complete: false }),
    email: async () => ({ messages: [], complete: false }),
    emailSource: () => null,
    erased: async () => false,
  };
  const admin = client({ organization_members: [{ user_id: USER, organization_id: ORG }], profiles: [{ user_id: USER, active_organization_id: ORG }] });
  const user = client({
    job_candidate_status: [candidate],
    sourcing_projects: [{ id: MISSION, organization_id: ORG, name: 'Développeur', job_id: 'external-job', updated_at: '2026-10-01T09:00:00Z' }],
    organization_members: [{ user_id: USER, organization_id: ORG }],
    profiles: [{ user_id: USER, display_name: 'Laurent' }],
    ...overrides,
  }, fail);
  return { admin, user, load: (s = scope, options) => loadCandidateActionContext(admin, user, USER, s, options) };
}

test('identité canonique et sources métier restent sous le JWT ; service-role limité aux autorisations', async () => {
  const f = fixture();
  const result = await f.load();
  assert.equal(result.scope.candidate_id, candidate.candidate_id);
  assert.equal(result.scope.project_id, MISSION);
  assert.equal(result.candidateName, candidate.candidate_name);
  assert.deepEqual(f.admin.calls, ['organization_members', 'profiles']);
  assert.ok(f.user.calls.includes('candidate_evaluations'));
});

test('deux missions exigent un choix explicite ; la mission inaccessible est refusée', async () => {
  const f = fixture({ job_candidate_status: [candidate, { ...candidate, id: 'row-2', project_id: OTHER }] });
  await assert.rejects(f.load({ ...scope, project_id: null }), e => e.code === 'MISSION_AMBIGUOUS');
  await assert.rejects(f.load({ ...scope, project_id: OTHER }), e => e.code === 'MISSION_ACCESS_DENIED');
});

test('un canal non connecté et un ledger privé ne constituent jamais une preuve d’absence d’échanges', async () => {
  const f = fixture();
  globalThis.contextTestTransport.chat = async () => ({ messages: [], complete: true });
  globalThis.contextTestTransport.email = async () => ({ messages: [], complete: true });
  const result = await f.load();
  assert.equal(result.targets.length, 0);
  assert.equal(result.sourceStates.linkedinMessages, 'unavailable');
  assert.equal(result.sourceStates.emailMessages, 'unavailable');
  assert.equal(result.sourceStates.recordedMessages, 'partial');
  assert.ok(result.warnings.some(warning => warning.includes('E-mails : lecture indisponible')));
});

test('un rendez-vous ou une grille d’une autre mission ne deviennent pas un contexte de la mission ouverte', async () => {
  const f = fixture({
    candidate_evaluations: [
      { id: 'mine', organization_id: ORG, candidate_id: candidate.candidate_id, project_id: MISSION, created_by: USER, criteria: [{ id: 'B2B' }], ratings: {}, updated_at: '2026-10-02' },
      { id: 'colleague', organization_id: ORG, candidate_id: candidate.candidate_id, project_id: MISSION, created_by: OTHER },
      { id: 'other-mission', organization_id: ORG, candidate_id: candidate.candidate_id, project_id: OTHER, created_by: USER },
      { id: 'legacy', organization_id: ORG, candidate_id: candidate.candidate_id, project_id: null, created_by: USER },
    ],
  });
  const result = await f.load();
  assert.deepEqual(result.ownEvaluationIds, ['mine']);
  assert.equal(result.facts.evaluations.length, 2);
  assert.ok(!result.sources.some(s => s.reference?.id === 'other-mission'));
  assert.ok(result.warnings.some(w => w.includes('anciens entretiens')));
});

test('une erreur de lecture ou une collecte plafonnée n’est pas une preuve d’absence', async () => {
  const failed = await fixture({}, ['qualification_sessions']).load();
  assert.equal(failed.sourceStates.interviews, 'unavailable');
  const partial = await fixture({ candidate_notes: Array.from({ length: 101 }, (_, i) => ({ id: `note-${i}`, organization_id: ORG, candidate_id: candidate.candidate_id, content: 'Note' })) }).load();
  assert.equal(partial.sourceStates.notes, 'partial');
  assert.ok(partial.warnings.some(w => w.includes('partiel')));
});

test('un candidat hors pipeline exige un participant validé du compte personnel', async () => {
  const f = fixture({ job_candidate_status: [] });
  await assert.rejects(f.load({ ...scope, project_id: null }), e => e.code === 'CANDIDATE_UNVERIFIED');
  const result = await f.load({ ...scope, project_id: null, chat_id: 'own-chat' });
  assert.equal(result.scope.candidate_id, 'ACo-candidate');
  assert.equal(result.scope.project_id, null);
});

test('URL : hôte et slug exacts, jamais une inclusion ni un domaine imitant LinkedIn', async () => {
  assert.equal(normalizeActionLinkedInUrl('https://fr.linkedin.com/in/CAMILLE-MARTIN/?utm=x'), 'https://www.linkedin.com/in/camille-martin');
  assert.equal(normalizeActionLinkedInUrl('https://linkedin.com.example.test/in/camille-martin'), null);
  const f = fixture({ job_candidate_status: [{ ...candidate, linkedin_profile_url: 'https://www.linkedin.com/in/camille-martin-other' }] });
  await assert.rejects(f.load({ ...scope, candidate_id: 'unknown', linkedin_url: candidate.linkedin_profile_url }), e => e.code === 'CANDIDATE_UNVERIFIED');
});

test('versions : ordre neutre, contenu entrant et droits/source disponibles font changer le contexte', async () => {
  const a = { id: 'message:1', type: 'inbound_message', title: 'Question', author: 'Candidat', timestamp: '2026-10-01', summary: 'Quel salaire ?', detail: 'Quel salaire ?', reference: { table: 'messages', id: '1' } };
  const b = { ...a, id: 'message:2', reference: { table: 'messages', id: '2' } };
  const v = await candidateActionContextVersion(scope, [a, b], { messages: 'available' }, []);
  assert.equal(v, await candidateActionContextVersion(scope, [b, a], { messages: 'available' }, []));
  assert.notEqual(v, await candidateActionContextVersion(scope, [a, { ...b, detail: 'Je ne suis plus disponible' }], { messages: 'available' }, []));
  assert.notEqual(v, await candidateActionContextVersion(scope, [a, b], { messages: 'unavailable' }, []));
});

test('les notes et reçus de ses effets validés n’invalident pas le plan en cours', async () => {
  const f = fixture();
  const baseline = await f.load();
  f.user = client({
    job_candidate_status: [candidate], sourcing_projects: [{ id: MISSION, organization_id: ORG, name: 'Développeur', job_id: 'external-job', updated_at: '2026-10-01T09:00:00Z' }],
    organization_members: [{ user_id: USER, organization_id: ORG }], profiles: [{ user_id: USER, display_name: 'Laurent' }],
    candidate_notes: [{ id: 'own-note', candidate_id: candidate.candidate_id, organization_id: ORG, content: 'Brief préparé', created_by: USER }],
    candidate_action_effects: [{ id: 'effect-1', organization_id: ORG, plan_id: 'plan-1', result: { referenceId: 'own-note', providerId: 'sent-1' } }],
    candidate_action_plans: [{ id: 'plan-1', candidate_id: candidate.candidate_id, organization_id: ORG, user_id: USER, project_id: MISSION }],
  });
  globalThis.contextTestTransport.chat = async () => ({ messages: [{ id: 'sent-1', type: 'outbound_message', title: 'Envoyé', author: 'Vous', timestamp: '2026-10-07', detail: 'Message validé', summary: 'Message validé', reference: { table: 'messages', id: 'sent-1' } }], complete: false });
  const applied = await loadCandidateActionContext(f.admin, f.user, USER, scope, { excludeEffectIds: ['effect-1'] });
  assert.equal(applied.contextVersion, baseline.contextVersion);
  assert.equal(applied.facts.notes.length, 0);
});

test('seuls les horodatages de ses propres sorties sont neutralisés ; les réponses et échanges d’un collègue changent la version', async () => {
  const source = { id: 'conversation:1', type: 'team_intervention', title: 'Derniers échanges', author: 'Vous', timestamp: '2026-10-01', summary: 'Initial', detail: JSON.stringify({ accountId: 'own-account', createdAt: '2026-10-01', lastInboundAt: null, lastOutboundAt: '2026-10-01' }), reference: { table: 'mission_conversations', id: '1', version: '2026-10-01' } };
  const targets = [{ id: 'own-target', senderAccountId: 'own-account' }];
  const baseline = await candidateActionContextVersion(scope, [source], {}, targets);
  const outgoing = { ...source, timestamp: '2026-10-07', detail: JSON.stringify({ accountId: 'own-account', createdAt: '2026-10-01', lastInboundAt: null, lastOutboundAt: '2026-10-07', lastSendKind: 'assistant' }), reference: { ...source.reference, version: '2026-10-07' } };
  assert.equal(await candidateActionContextVersion(scope, [outgoing], {}, targets), baseline);
  const reply = { ...outgoing, detail: JSON.stringify({ accountId: 'own-account', createdAt: '2026-10-01', lastInboundAt: '2026-10-07', lastOutboundAt: '2026-10-07' }) };
  assert.notEqual(await candidateActionContextVersion(scope, [reply], {}, targets), baseline);
  const other = { ...outgoing, detail: JSON.stringify({ accountId: 'other-account', lastOutboundAt: '2026-10-07' }) };
  assert.notEqual(await candidateActionContextVersion(scope, [other], {}, targets), baseline);
});

test('historique partagé : coordination attribuée, autre mission exclue, échange non rattaché visible sans preuve mission', async () => {
  const base = { organization_id: ORG, candidate_id: candidate.candidate_id, channel: 'email', service: 'outlook', occurred_at: '2026-10-07T10:00:00Z' };
  const f = fixture({
    organization_members: [{ user_id: USER, organization_id: ORG }, { user_id: OTHER, organization_id: ORG }],
    profiles: [{ user_id: USER, display_name: 'Laurent' }, { user_id: OTHER, display_name: 'Guillaume' }],
    candidate_action_messages: [
      { ...base, id: 'team', project_id: MISSION, owner_user_id: OTHER, audience: 'team', direction: 'outbound', content: 'Demande au manager', provider_message_id: 'provider-team' },
      { ...base, id: 'unassigned', project_id: null, audience: 'candidate', direction: 'inbound', content: 'Une question dont la mission est inconnue', provider_message_id: 'provider-unassigned' },
      { ...base, id: 'other-mission', project_id: OTHER, audience: 'candidate', direction: 'inbound', content: 'Autre mission', provider_message_id: 'provider-other' },
    ],
  });
  const result = await f.load();
  assert.equal(result.sources.find(s => s.reference?.id === 'team')?.author, 'Guillaume');
  assert.equal(result.sources.find(s => s.reference?.id === 'team')?.type, 'team_message');
  assert.ok(!result.sources.some(s => s.reference?.id === 'other-mission'));
  const ambiguous = result.sources.find(s => s.reference?.id === 'unassigned');
  assert.equal(ambiguous.type, 'ambiguous_message');
  assert.equal(ambiguous.projectId, null);
  assert.equal(result.facts.incomingSources.length, 0);
  assert.equal(result.facts.ambiguousMessages.length, 1);
  assert.ok(result.warnings.some(w => w.includes('pas rattachés à une mission')));
});

test('ses propres écritures sont exclues avant la limite : une centième note reste un contexte disponible', async () => {
  const existing = Array.from({ length: 100 }, (_, i) => ({
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`,
    candidate_id: candidate.candidate_id, organization_id: ORG,
    content: `Fait historique ${i}`, created_by: USER, created_at: '2026-10-01T10:00:00Z',
  }));
  const before = await fixture({ candidate_notes: existing }).load();
  const ownId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const after = await fixture({
    candidate_notes: [{ ...existing[0], id: ownId, content: 'Note issue du plan', created_at: '2026-10-07T12:00:00Z' }, ...existing],
    candidate_action_effects: [{ id: 'effect-own', plan_id: 'plan-own', result: { referenceId: ownId } }],
    candidate_action_plans: [{ id: 'plan-own', candidate_id: candidate.candidate_id, organization_id: ORG, user_id: USER, project_id: MISSION }],
  }).load(scope, { excludeEffectIds: ['effect-own'] });
  assert.equal(before.sourceStates.notes, 'available');
  assert.equal(after.sourceStates.notes, 'available');
  assert.equal(after.contextVersion, before.contextVersion);
  assert.equal(after.facts.notes.length, 100);
});

test('la première hydratation e-mail et la collecte suivante ont une référence canonique unique et la même version', async () => {
  const journal = [];
  const f = fixture({ candidate_action_messages: journal });
  const source = { id: 'email-mailbox-provider-1', type: 'inbound_message', title: 'Disponibilités', author: 'camille@example.test', timestamp: '2026-10-07T09:00:00.000Z', summary: 'Mardi matin', detail: 'Mardi matin', service: 'gmail', projectId: MISSION, reference: { table: 'provider_emails', id: 'provider-1', version: '2026-10-07T09:00:00.000Z' } };
  globalThis.contextTestTransport.targets = async () => [{ id: 'target-email', audience: 'candidate', channel: 'email', senderAccountId: 'mailbox' }];
  globalThis.contextTestTransport.emailSource = row => row.id === 'hydrated-row' ? source : null;
  globalThis.contextTestTransport.email = async () => {
    if (!journal.length) journal.push({ id: 'hydrated-row', organization_id: ORG, candidate_id: candidate.candidate_id, project_id: MISSION, channel: 'email', audience: 'candidate', direction: 'inbound', account_id: 'mailbox', provider_message_id: 'provider-1', content: 'Mardi matin', occurred_at: '2026-10-07T09:00:00+00:00' });
    return { messages: [source], complete: true };
  };
  const initial = await f.load();
  const next = await f.load();
  assert.equal(initial.contextVersion, next.contextVersion);
  assert.equal(initial.sources.filter(s => s.reference?.id === 'provider-1').length, 1);
  assert.equal(next.sources.filter(s => s.reference?.id === 'provider-1').length, 1);
  assert.equal(initial.sourceStates.recordedMessages, 'partial');
  assert.equal(initial.facts.incomingSources[0].id, source.id);
});

test('un reçu concurrent créé avant le résultat de son effet conserve le contexte ; une vraie réponse reste visible', async () => {
  const effectId = '55555555-5555-4555-8555-555555555555';
  const planId = '66666666-6666-4666-8666-666666666666';
  const journal = [];
  const f = fixture({
    candidate_action_messages: journal,
    candidate_action_effects: [{ id: effectId, plan_id: planId, result: null, status: 'running' }],
    candidate_action_plans: [{ id: planId, candidate_id: candidate.candidate_id, organization_id: ORG, user_id: USER, project_id: MISSION }],
  });
  const sent = { id: 'email-mailbox-own-provider', type: 'outbound_message', title: 'Disponibilités', author: 'recruiter@example.test', timestamp: '2026-10-07T09:00:00.000Z', summary: 'Merci pour vos disponibilités', detail: 'Merci pour vos disponibilités', service: 'gmail', projectId: MISSION, reference: { table: 'provider_emails', id: 'own-provider', version: '2026-10-07T09:00:00.000Z' } };
  const received = { ...sent, id: 'email-mailbox-real-reply', type: 'inbound_message', author: 'candidate@example.test', summary: 'Je ne suis plus disponible', detail: 'Je ne suis plus disponible', reference: { ...sent.reference, id: 'real-reply' } };
  globalThis.contextTestTransport.targets = async () => [{ id: 'target-email', audience: 'candidate', channel: 'email', senderAccountId: 'mailbox' }];
  globalThis.contextTestTransport.emailSource = row => row.provider_message_id === 'own-provider' ? sent : row.provider_message_id === 'real-reply' ? received : null;
  globalThis.contextTestTransport.email = async () => ({ messages: [], complete: true });
  const baseline = await f.load(scope, { excludeEffectIds: [effectId] });
  globalThis.contextTestTransport.email = async () => {
    // The effect lookup already returned result=null. A simultaneous sender
    // commits its own receipt while this request is reading the mailbox.
    if (!journal.length) journal.push({ id: '77777777-7777-4777-8777-777777777777', organization_id: ORG, candidate_id: candidate.candidate_id, project_id: MISSION, owner_user_id: USER, action_plan_id: planId, effect_id: effectId, channel: 'email', audience: 'candidate', direction: 'outbound', account_id: 'mailbox', provider_message_id: 'own-provider', content: sent.detail, occurred_at: sent.timestamp });
    return { messages: [sent], complete: true };
  };
  const duringSend = await f.load(scope, { excludeEffectIds: [effectId] });
  assert.equal(duringSend.contextVersion, baseline.contextVersion);
  assert.equal(duringSend.facts.messages.length, 0, 'le reçu propre est exclu du ledger et de sa projection provider');
  journal.push({ ...journal[0], id: '88888888-8888-4888-8888-888888888888', effect_id: null, action_plan_id: null, direction: 'inbound', provider_message_id: 'real-reply', content: received.detail });
  globalThis.contextTestTransport.email = async () => ({ messages: [sent, received], complete: true });
  const afterReply = await f.load(scope, { excludeEffectIds: [effectId] });
  assert.notEqual(afterReply.contextVersion, baseline.contextVersion);
  assert.deepEqual(afterReply.facts.incomingSources.map(source => source.reference.id), ['real-reply']);
  const colleagueCopy = { ...sent, id: 'email-colleague-mailbox-own-provider', author: 'colleague@example.test' };
  journal.push({ ...journal[0], id: 'colleague-copy', owner_user_id: OTHER, effect_id: null, action_plan_id: null, account_id: 'colleague-mailbox' });
  globalThis.contextTestTransport.emailSource = row => row.account_id === 'colleague-mailbox' ? colleagueCopy : row.provider_message_id === 'own-provider' ? sent : row.provider_message_id === 'real-reply' ? received : null;
  const withColleague = await f.load(scope, { excludeEffectIds: [effectId] });
  assert.ok(withColleague.sources.some(source => source.id === colleagueCopy.id), 'un provider ID identique dans un autre compte ne doit pas être masqué');
});

test('un reçu propre est exclu dès la première page avant de couper les cent échanges réels', async () => {
  const effectId = '55555555-5555-4555-8555-555555555555';
  const planId = '66666666-6666-4666-8666-666666666666';
  const journal = Array.from({ length: 100 }, (_, i) => ({ id: `message-${i}`, organization_id: ORG, candidate_id: candidate.candidate_id, project_id: MISSION, direction: 'inbound', effect_id: null, action_plan_id: null, content: `Échange réel ${i}`, occurred_at: '2026-10-01T09:00:00Z', provider_message_id: `real-${i}`, channel: 'email', account_id: 'mailbox' }));
  const f = fixture({
    candidate_action_messages: journal,
    candidate_action_effects: [{ id: effectId, plan_id: planId, result: null }],
    candidate_action_plans: [{ id: planId, candidate_id: candidate.candidate_id, organization_id: ORG, user_id: USER, project_id: MISSION }],
  });
  const baseline = await f.load(scope, { excludeEffectIds: [effectId] });
  journal.unshift({ ...journal[0], id: 'own-receipt', owner_user_id: USER, direction: 'outbound', effect_id: effectId, action_plan_id: planId, content: 'Mon envoi concurrent', provider_message_id: 'own-provider' });
  // Without a connected mailbox there is no second ledger page to repair an
  // omitted SQL filter; the first page itself must keep the 100 real records.
  const duringSend = await f.load(scope, { excludeEffectIds: [effectId] });
  assert.equal(duringSend.contextVersion, baseline.contextVersion);
  assert.equal(duringSend.facts.messages.length, 100);
  assert.ok(duringSend.facts.messages.every(source => source.type === 'inbound_message'));
});

test('des IDs d’effets d’un collègue ou d’un autre candidat ne peuvent masquer leurs échanges', async () => {
  const ownEffect = '55555555-5555-4555-8555-555555555555';
  const colleagueEffect = '77777777-7777-4777-8777-777777777777';
  const otherCandidateEffect = '88888888-8888-4888-8888-888888888888';
  const journal = [];
  const f = fixture({
    candidate_action_messages: journal,
    candidate_action_plans: [
      { id: 'own-plan', candidate_id: candidate.candidate_id, organization_id: ORG, user_id: USER, project_id: MISSION },
      { id: 'colleague-plan', candidate_id: candidate.candidate_id, organization_id: ORG, user_id: OTHER, project_id: MISSION },
      { id: 'other-candidate-plan', candidate_id: 'another-candidate', organization_id: ORG, user_id: USER, project_id: MISSION },
    ],
    candidate_action_effects: [
      { id: ownEffect, plan_id: 'own-plan', result: null },
      { id: colleagueEffect, plan_id: 'colleague-plan', result: null },
      { id: otherCandidateEffect, plan_id: 'other-candidate-plan', result: null },
    ],
  });
  const options = { excludeEffectIds: [ownEffect, colleagueEffect, otherCandidateEffect] };
  const baseline = await f.load(scope, options);
  const common = { organization_id: ORG, candidate_id: candidate.candidate_id, project_id: MISSION, channel: 'email', direction: 'outbound', audience: 'team', account_id: 'mailbox', content: 'Information reçue du manager', occurred_at: '2026-10-07T09:00:00Z' };
  journal.push(
    { ...common, id: 'own-receipt', owner_user_id: USER, action_plan_id: 'own-plan', effect_id: ownEffect, provider_message_id: 'own-provider' },
    { ...common, id: 'colleague-receipt', owner_user_id: OTHER, action_plan_id: 'colleague-plan', effect_id: colleagueEffect, provider_message_id: 'colleague-provider' },
    { ...common, id: 'outside-plan-receipt', owner_user_id: USER, action_plan_id: 'other-candidate-plan', effect_id: otherCandidateEffect, provider_message_id: 'outside-plan-provider' },
  );
  const updated = await f.load(scope, options);
  assert.notEqual(updated.contextVersion, baseline.contextVersion);
  assert.deepEqual(updated.facts.messages.map(source => source.reference.id), ['colleague-receipt', 'outside-plan-receipt']);
});

test('un ID d’effet d’un autre auteur ne peut masquer sa nouvelle note', async () => {
  const f = fixture({
    candidate_notes: [{ id: 'their-note', candidate_id: candidate.candidate_id, organization_id: ORG, content: 'Retour manager reçu', created_by: OTHER }],
    candidate_action_effects: [{ id: 'their-effect', organization_id: ORG, plan_id: 'their-plan', result: { referenceId: 'their-note' } }],
    candidate_action_plans: [{ id: 'their-plan', candidate_id: candidate.candidate_id, organization_id: ORG, user_id: OTHER, project_id: MISSION }],
  });
  const result = await f.load(scope, { excludeEffectIds: ['their-effect'] });
  assert.ok(result.sources.some(s => s.reference?.id === 'their-note'));
});

test('un effacement bloque aussi les plans internes ; une vérification en panne bloque sans supposer une autorisation', async () => {
  const f = fixture({ candidate_contacts: [{ candidate_id: candidate.candidate_id, organization_id: ORG, email: 'trusted@example.test' }] });
  globalThis.contextTestTransport.erased = async () => true;
  await assert.rejects(f.load(), e => e.code === 'CANDIDATE_ERASED' && e.status === 403);
  assert.ok(!f.user.calls.includes('candidate_notes'));
  globalThis.contextTestTransport.erased = async () => { throw new Error('Registre indisponible'); };
  await assert.rejects(f.load(), e => e.code === 'GDPR_UNVERIFIED' && e.status === 503);
  let checks = 0;
  globalThis.contextTestTransport.erased = async (_admin, input) => {
    if (++checks === 1) return false;
    assert.deepEqual(input.emails, ['trusted@example.test'], 'la vérification finale conserve les contacts réellement lus côté serveur');
    return true;
  };
  await assert.rejects(f.load(), e => e.code === 'CANDIDATE_ERASED' && e.status === 403);
});

test('un changement d’organisation bloque avant les lectures RLS pour éviter de prendre des lignes invisibles pour des absences', async () => {
  const f = fixture();
  const admin = client({ organization_members: [{ user_id: USER, organization_id: ORG }], profiles: [{ user_id: USER, active_organization_id: OTHER }] });
  await assert.rejects(loadCandidateActionContext(admin, f.user, USER, scope), e => e.code === 'ORGANIZATION_CHANGED');
  assert.deepEqual(f.user.calls, []);
});
