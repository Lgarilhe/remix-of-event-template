// Aperçu du premier message d'une inscription par l'assistant (refonte mission, lot 5a).
//
//   deno test --no-check supabase/functions/_shared/enroll-preview.test.ts

import { deepStrictEqual as assertEquals, ok as assert, strictEqual } from 'node:assert';
import {
  buildFirstStepPreview,
  drawRankVariant,
  ENROLLMENT_CANDIDATE_COLUMNS,
  firstTextSteps,
  hasAiPersonalizedStep,
  missingDataNotes,
  missionCandidateFields,
  type PreviewStep,
} from './enroll-preview.ts';
import { clearSenderCache } from './sequence-sender.ts';

const step = (id: string, step_order: number, action_type: string, over: Partial<PreviewStep> = {}): PreviewStep => ({
  id, step_order, action_type, parent_step_id: null, branch: null, if_true_goto_step: null,
  if_false_goto_step: null, timeout_branch_step_id: null, next_step_id: null,
  message_template: null, subject_template: null, use_ai_personalization: false, variant_group: null, ...over,
});

const ids = (r: ReturnType<typeof firstTextSteps>) => r.texts.map((t) => t.step.id);

// ─── Choix du texte ──────────────────────────────────────────────────────

Deno.test('visite puis invitation : le texte retenu est la note', () => {
  const r = firstTextSteps([
    step('visit', 0, 'profile_visit'),
    step('invite', 1, 'connection_request', { message_template: 'Bonjour {{prenom}}' }),
    step('msg', 2, 'message', { message_template: 'Merci' }),
  ]);
  assertEquals(ids(r), ['invite']);
  strictEqual(r.texts[0].condition, null);
  strictEqual(r.firstAction?.id, 'visit');
});

Deno.test('invitation sans note puis message : le texte retenu est le message, l’invitation est la première action', () => {
  const steps = [
    step('visit', 0, 'profile_visit'),
    step('invite', 1, 'connection_request', { message_template: '  ' }),
    step('wait', 2, 'wait_connection'),
    step('msg', 3, 'message', { message_template: 'Bonjour {{prenom}}, merci d’avoir accepté.' }),
  ];
  const r = firstTextSteps(steps);
  assertEquals(ids(r), ['msg']);
  strictEqual(r.texts[0].condition, null);
  strictEqual(r.firstAction?.id, 'visit');
  // Invitation sans note en tête du parcours : elle est la première action.
  const fromInvite = firstTextSteps(steps.slice(1));
  assertEquals(ids(fromInvite), ['msg']);
  strictEqual(fromInvite.firstAction?.id, 'invite');
  // Fourche : la branche « Sinon » passe l’invitation sans note et montre le message suivant.
  const fork = firstTextSteps([
    step('check', 0, 'check_connection'),
    step('yes-msg', 1, 'message', { parent_step_id: 'check', branch: 'yes', message_template: 'Déjà en relation' }),
    step('no-invite', 1, 'connection_request', { parent_step_id: 'check', branch: 'no' }),
    step('no-wait', 2, 'wait_connection', { parent_step_id: 'check', branch: 'no' }),
    step('no-msg', 3, 'message', { parent_step_id: 'check', branch: 'no', message_template: 'Merci d’avoir accepté' }),
  ]);
  assertEquals(fork.texts.map((t) => [t.step.id, t.condition]), [
    ['yes-msg', 'Si déjà en relation'],
    ['no-msg', 'Sinon'],
  ]);
});

Deno.test('fourche « Vérifier la relation » (sauts explicites) : deux textes avec leur condition', () => {
  const r = firstTextSteps([
    step('check', 0, 'check_connection', { if_true_goto_step: 'msg', if_false_goto_step: 'invite' }),
    step('msg', 1, 'message', { message_template: 'Déjà en relation' }),
    step('invite', 2, 'connection_request', { message_template: 'Invitation' }),
  ]);
  assertEquals(r.texts.map((t) => [t.step.id, t.condition]), [
    ['msg', 'Si déjà en relation'],
    ['invite', 'Sinon'],
  ]);
});

Deno.test('fourche en arbre (branches oui / non) : deux textes avec leur condition', () => {
  const r = firstTextSteps([
    step('check', 0, 'check_connection'),
    step('yes-wait', 1, 'wait_reply', { parent_step_id: 'check', branch: 'yes' }),
    step('yes-msg', 2, 'message', { parent_step_id: 'check', branch: 'yes', message_template: 'Oui' }),
    step('no-invite', 1, 'connection_request', { parent_step_id: 'check', branch: 'no', message_template: 'Non' }),
  ]);
  assertEquals(r.texts.map((t) => [t.step.id, t.condition]), [
    ['yes-msg', 'Si déjà en relation'],
    ['no-invite', 'Sinon'],
  ]);
});

Deno.test('fourche dont les deux branches mènent au même texte : une seule entrée, sans condition', () => {
  const r = firstTextSteps([
    step('check', 0, 'check_connection'),
    step('msg', 1, 'message', { message_template: 'Bonjour' }),
  ]);
  assertEquals(r.texts.map((t) => [t.step.id, t.condition]), [['msg', null]]);
});

Deno.test('test A/B : version A, puis version B selon le tirage', () => {
  const r = firstTextSteps([
    step('visit', 0, 'profile_visit'),
    step('msg-b', 1, 'message', { variant_group: 'B', message_template: 'Texte B' }),
    step('msg-a', 1, 'message', { variant_group: 'A', message_template: 'Texte A' }),
  ]);
  assertEquals(r.texts.map((t) => [t.step.id, t.condition]), [
    ['msg-a', 'Version A'],
    ['msg-b', 'Version B selon le tirage'],
  ]);
});

Deno.test('séquence sans texte : aucun texte, première action nommée', async () => {
  const steps = [step('visit', 0, 'profile_visit'), step('check', 1, 'check_connection')];
  const r = firstTextSteps(steps);
  assertEquals(r.texts, []);
  strictEqual(r.firstAction?.id, 'visit');
  const preview = await buildFirstStepPreview(fakeClient({}) as never, {
    steps, enrollment: { profile_name: 'Claire Dubois' }, candidateInMission: true,
  });
  assertEquals(preview.texts, []);
  strictEqual(preview.first_action, 'Visite de profil');
});

Deno.test('canal fermé (e-mail) : l’étape est sautée comme par le moteur, le texte suivant est retenu', () => {
  const r = firstTextSteps([
    step('mail', 0, 'email', { message_template: 'Un e-mail' }),
    step('msg', 1, 'message', { message_template: 'Un message' }),
  ]);
  assertEquals(ids(r), ['msg']);
});

Deno.test('fin de séquence explicite : rien après', () => {
  const r = firstTextSteps([
    step('visit', 0, 'profile_visit', { ends_sequence: true }),
    step('msg', 1, 'message', { message_template: 'Jamais envoyé' }),
  ]);
  assertEquals(r.texts, []);
});

// ─── Étapes rédigées par l'IA ────────────────────────────────────────────

Deno.test('hasAiPersonalizedStep : vrai pour un message IA, faux pour une invitation', () => {
  strictEqual(hasAiPersonalizedStep([step('m', 0, 'message', { use_ai_personalization: true })]), true);
  strictEqual(hasAiPersonalizedStep([step('s', 0, 'smart_message', { use_ai_personalization: true })]), true);
  strictEqual(hasAiPersonalizedStep([step('i', 0, 'inmail', { use_ai_personalization: true })]), true);
  // Le moteur ne rédige jamais la note d'invitation.
  strictEqual(hasAiPersonalizedStep([step('c', 0, 'connection_request', { use_ai_personalization: true })]), false);
  strictEqual(hasAiPersonalizedStep([step('v', 0, 'profile_visit', { use_ai_personalization: true })]), false);
  strictEqual(hasAiPersonalizedStep([step('m', 0, 'message', { use_ai_personalization: false })]), false);
  strictEqual(hasAiPersonalizedStep([]), false);
});

Deno.test('étape IA en premier texte : annoncée sans texte inventé', async () => {
  const steps = [step('m', 0, 'message', { use_ai_personalization: true, message_template: 'Modèle' })];
  assertEquals(firstTextSteps(steps).texts.map((t) => t.ai), [true]);
  const preview = await buildFirstStepPreview(fakeClient({}) as never, {
    steps, enrollment: { profile_name: 'Claire Dubois' }, candidateInMission: true,
  });
  strictEqual(preview.texts[0].ai, true);
  strictEqual(preview.texts[0].text, '');
});

// ─── Tirage A/B à l'inscription ──────────────────────────────────────────

Deno.test('drawRankVariant : tirage pondéré entre les versions, étape seule hors test A/B', () => {
  const steps = [
    step('a', 0, 'message', { variant_group: 'A', variant_weight: 50 }),
    step('b', 0, 'message', { variant_group: 'B', variant_weight: 50 }),
  ];
  assertEquals(drawRankVariant(steps, steps[1], () => 0), { step: steps[0], variantAssigned: 'A' });
  assertEquals(drawRankVariant(steps, steps[0], () => 0.99), { step: steps[1], variantAssigned: 'B' });
  const plain = step('p', 0, 'message');
  assertEquals(drawRankVariant([plain], plain, () => 0.5), { step: plain, variantAssigned: null });
});

// ─── Champs du candidat ──────────────────────────────────────────────────

Deno.test('missionCandidateFields : mêmes champs que la charge d’insertion', () => {
  const fields = missionCandidateFields(
    {
      candidate_name: 'Claire Dubois',
      candidate_headline: 'Lead Developer',
      linkedin_profile_data: {
        work_experience: [
          { company: 'Ancienne SA', role: 'Dev', end: { year: 2020 } },
          { company: 'Qonto', role: 'Lead Developer', current: true },
        ],
      },
    },
    { profileName: 'C. Dubois', missionTitle: 'CTO' },
  );
  assertEquals(Object.keys(fields).sort(), [...ENROLLMENT_CANDIDATE_COLUMNS].sort());
  assertEquals(fields, {
    profile_name: 'Claire Dubois',
    profile_headline: 'Lead Developer',
    job_title: 'CTO',
    company_name: 'Qonto',
  });
});

Deno.test('missionCandidateFields : candidat absent de la mission, son seul nom', () => {
  assertEquals(missionCandidateFields(null, { profileName: 'Claire Dubois', missionTitle: 'CTO' }), {
    profile_name: 'Claire Dubois',
    profile_headline: null,
    job_title: 'CTO',
    company_name: null,
  });
});

Deno.test('missionCandidateFields : poste courant de la recherche, rien de deviné sans poste actuel', () => {
  strictEqual(
    missionCandidateFields({ linkedin_profile_data: { current_positions: [{ company: 'Alan', role: 'CTO' }] } }, {}).company_name,
    'Alan',
  );
  strictEqual(
    missionCandidateFields({ linkedin_profile_data: { work_experience: [{ company: 'Passée', end: '2021-01' }] } }, {}).company_name,
    null,
  );
});

// ─── Aperçu rendu (variables du moteur) ──────────────────────────────────

type Query = { table: string; cols: string; filters: Record<string, unknown> };
type Handler = (q: Query) => { data: unknown; error: { message: string } | null };

function fakeClient(handlers: Record<string, Handler>) {
  return {
    from(table: string) {
      const q: Query = { table, cols: '', filters: {} };
      const answer = () => Promise.resolve(handlers[table]?.(q) ?? { data: null, error: null });
      const builder = {
        select(cols: string) { q.cols = cols; return builder; },
        eq(col: string, value: unknown) { q.filters[col] = value; return builder; },
        maybeSingle: answer,
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve(handlers[table]?.(q) ?? { data: [], error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

const client = () => fakeClient({
  sourcing_projects: () => ({ data: { name: 'CTO', job_details: { title: 'CTO' }, calendly_link: null, client_name: null }, error: null }),
  profiles: (q) => q.filters.user_id === '00000000-0000-4000-8000-000000000001'
    ? { data: { display_name: 'Laurent Garilhe', job_title: 'Recruteur' }, error: null }
    : { data: null, error: null },
  organizations: () => ({ data: { name: 'Talentis' }, error: null }),
  member_linkedin_accounts: () => ({ data: null, error: null }),
});

Deno.test('aperçu : variables résolues avec les champs écrits sur l’inscription', async () => {
  clearSenderCache();
  const fields = missionCandidateFields(
    { candidate_name: 'Claire Dubois', candidate_headline: 'Lead Developer chez Qonto' },
    { missionTitle: 'CTO' },
  );
  const preview = await buildFirstStepPreview(client() as never, {
    steps: [
      step('visit', 0, 'profile_visit'),
      step('inmail', 1, 'inmail', {
        subject_template: 'Poste de {{poste_recherche}}',
        message_template: 'Bonjour {{prenom}},\n\nVotre rôle de {{poste_actuel}} chez {{entreprise_actuelle}} m’intéresse.\n\n{{mon_prenom}}',
      }),
    ],
    enrollment: {
      job_id: 'p1', organization_id: 'org1', created_by: '00000000-0000-4000-8000-000000000001', account_id: 'ACC',
      ...fields,
    },
    candidateInMission: true,
  });
  strictEqual(preview.candidate_name, 'Claire Dubois');
  strictEqual(preview.candidate_in_mission, true);
  strictEqual(preview.texts.length, 1);
  const [text] = preview.texts;
  strictEqual(text.step_label, 'InMail');
  strictEqual(text.subject, 'Poste de CTO');
  strictEqual(text.text, 'Bonjour Claire,\n\nVotre rôle de Lead Developer chez Qonto m’intéresse.\n\nLaurent');
  assertEquals(text.missing, []);
});

Deno.test('aperçu : donnée absente signalée et retirée du texte', async () => {
  clearSenderCache();
  const preview = await buildFirstStepPreview(client() as never, {
    steps: [step('msg', 0, 'message', { message_template: 'Bonjour {{prenom}}, votre poste de {{poste_actuel}} m’intéresse.' })],
    enrollment: { job_id: 'p1', organization_id: 'org1', created_by: 'u1', ...missionCandidateFields(null, { profileName: 'Claire Dubois' }) },
    candidateInMission: false,
  });
  strictEqual(preview.candidate_in_mission, false);
  strictEqual(preview.texts[0].text, 'Bonjour Claire, votre poste de m’intéresse.');
  assertEquals(preview.texts[0].missing, ['Poste actuel inconnu : retiré du message.']);
  // Un message LinkedIn n'a pas d'objet.
  strictEqual(preview.texts[0].subject, null);
});

Deno.test('aperçu : note d’invitation coupée à 300 caractères comme par le moteur', async () => {
  clearSenderCache();
  const long = 'Bonjour. ' + 'Une phrase assez longue pour remplir la note. '.repeat(10);
  const preview = await buildFirstStepPreview(client() as never, {
    steps: [step('invite', 0, 'connection_request', { message_template: long })],
    enrollment: { profile_name: 'Claire Dubois' },
    candidateInMission: true,
  });
  assert(preview.texts[0].text.length <= 300);
  strictEqual(preview.texts[0].step_label, 'Invitation avec note');
});

Deno.test('aperçu : salutation et date annoncées, jamais résolues à l’heure de la proposition', async () => {
  clearSenderCache();
  const preview = await buildFirstStepPreview(client() as never, {
    steps: [step('msg', 0, 'message', {
      message_template: '{{salutation}} {{prenom}}, belle {{periode_jour}}. Écrit le {{date_courte}} ({{jour_semaine}}, {{aujourd_hui}}).',
    })],
    enrollment: { job_id: 'p1', organization_id: 'org1', created_by: 'u1', profile_name: 'Claire Dubois' },
    candidateInMission: true,
  });
  strictEqual(
    preview.texts[0].text,
    '[Bonjour ou Bonsoir, selon l’heure d’envoi] Claire, belle [matinée, après-midi ou soirée, selon l’heure d’envoi]. '
      + 'Écrit le [date d’envoi] ([jour d’envoi], [date d’envoi]).',
  );
  assertEquals(preview.texts[0].missing, []);
});

Deno.test('missingDataNotes : une phrase par donnée, filtres ignorés', () => {
  assertEquals(missingDataNotes(['{{ entreprise_actuelle | upper }}', '{{company}}', '{{inconnue}}']), [
    'Entreprise actuelle inconnue : retirée du message.',
    'Variable « inconnue » sans valeur : retirée du message.',
  ]);
});
