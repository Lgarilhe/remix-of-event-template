/**
 * Lot 5e : la forme d'une séquence rédigée par l'IA, jouée par le vrai moteur
 * (process-sequences) contre le faux LinkedIn de la stack locale.
 *
 * Parcours : rédaction réelle (draft-sequence, action draft, faux modèle par
 * marqueur), enregistrement comme l'éditeur (en-tête puis save_sequence_steps,
 * avec le jeton du membre et la charge de useSequenceSave), inscription comme
 * le navigateur (inscription active et sa première exécution, jeton du membre),
 * puis cycles du moteur. Contrat (docs/refonte-mission/lot5-plan.md, 5e,
 * buildDraftSkeleton) :
 * - le candidat accepte : invitation avec sa note, attente franchie, premier
 *   message aussitôt, relance au 4e jour, arrêt à la réponse ;
 * - le candidat n'accepte jamais : au bout des 14 jours, l'attente expire, les
 *   messages « Si connecté » sont sautés et l'inscription se termine, sans
 *   échec ni pause automatique, sans aucun message envoyé ;
 * - le candidat est déjà en relation : l'invitation est sautée, il reçoit le
 *   premier message.
 * La forme créée par l'assistant (create_sequence) est jouée de la même façon
 * dans e2e/api/seq-assistant.spec.ts (cs-premiere-etape-envoyee, cs-attente-reponse).
 *
 * Chaque test a sa propre organisation, son compte LinkedIn (journal isolé par
 * account_id) et son marqueur. Ignoré sans la stack locale.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { E2E } from '../helpers/env';
import { admin, deleteOrg, seedMission, signIn, type TestOrg } from '../helpers/supabase-admin';
import {
  ENGINE_SKIP_REASON,
  callFunction,
  engineAvailable,
  enrollmentRow,
  executionsOf,
  minutesFromNow,
  mockCalls,
  rand,
  runCycle,
  runEngine,
  sendingOrg,
  sentInvites,
  sentTexts,
  setMockMode,
  webhook,
  type ExecutionRow,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.setTimeout(240_000);

const JOB = {
  title: 'Directeur financier',
  mission_description: 'Piloter deux acquisitions dans les 18 mois et structurer la direction financière du groupe.',
  context: 'Création du poste dans un groupe industriel en croissance.',
  team_size: 14,
  reports_to: 'Président',
  seniority: 'Senior',
  location: 'Lyon',
  contract_type: 'cdi',
  skills_must_have: ['Consolidation', 'Fusions et acquisitions'],
};

const NOTE = 'Bonjour {{prenom}}, je recrute un directeur financier à Lyon pour un groupe industriel. Votre parcours m’a donné envie d’échanger. {{mon_prenom}}';
const FIRST = 'Bonjour {{prenom}},\n\nJ’accompagne un groupe industriel qui cherche son directeur financier, rattaché au président. Cela vous parlerait-il ?\n\n{{mon_prenom}}';
const RELANCE_1 = 'Bonjour {{prenom}}, je reviens vers vous au sujet du poste de {{poste_recherche}}. Seriez-vous curieux d’en savoir plus ?\n\n{{mon_prenom}}';
const RELANCE_2 = 'Bonjour {{prenom}}, dernier message de ma part sur ce poste de {{poste_recherche}}. Si le moment n’est pas le bon, je le comprends tout à fait.\n\n{{mon_prenom}}';
const DRAFT = JSON.stringify({
  invitation_note: NOTE,
  first_message: { body: FIRST },
  relances: [{ body: RELANCE_1 }, { body: RELANCE_2 }],
});

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const orgs: TestOrg[] = [];
const cleanups: Array<() => PromiseLike<unknown>> = [];

test.afterEach(async () => {
  while (cleanups.length) await Promise.resolve(cleanups.pop()!()).catch(() => undefined);
  while (orgs.length) {
    const org = orgs.pop()!;
    for (const table of ['ai_credit_transactions', 'ai_credit_balances', 'organization_subscriptions', 'job_candidate_status', 'mission_conversations', 'linkedin_action_log']) {
      await admin().from(table).delete().eq('organization_id', org.orgId);
    }
    await deleteOrg(org).catch(() => undefined);
  }
});

// ─── Aides ──────────────────────────────────────────────────────────────────

interface DraftStep {
  id: string;
  order: number;
  actionType: string;
  conditionType: string;
  conditionValue?: string | null;
  delayDays: number;
  delayHours: number;
  delayMinutes: number;
  preferredHourStart: number;
  preferredHourEnd: number;
  subjectTemplate: string;
  messageTemplate: string;
  useAiPersonalization: boolean;
  aiTone: string;
  timeoutDays?: number;
  waitForEvent?: string;
}

interface Drafted {
  org: TestOrg;
  accountId: string;
  missionId: string;
  user: SupabaseClient;
  sequenceId: string;
}

/** Client Supabase avec le jeton du membre : la RLS et les gardes du navigateur s'appliquent. */
function userClient(accessToken: string): SupabaseClient {
  return createClient(E2E.supabaseUrl, E2E.anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Charge de save_sequence_steps telle que l'éditeur la construit (useSequenceSave, buildStepsPayload). */
function editorPayload(steps: DraftStep[]) {
  return steps.map((step) => ({
    id: step.id,
    step_order: step.order,
    action_type: step.actionType,
    condition_type: step.conditionType,
    condition_value: step.conditionValue ?? null,
    delay_days: step.delayDays ?? 0,
    delay_hours: step.delayHours ?? 0,
    delay_minutes: step.delayMinutes ?? 0,
    preferred_hour_start: step.preferredHourStart ?? null,
    preferred_hour_end: step.preferredHourEnd ?? null,
    subject_template: step.subjectTemplate ?? null,
    message_template: step.messageTemplate ?? null,
    use_ai_personalization: step.useAiPersonalization ?? false,
    ai_tone: step.aiTone ?? null,
    timeout_days: step.timeoutDays ?? null,
    wait_for_event: step.waitForEvent ?? (step.actionType === 'wait_connection' ? 'connection_accepted' : null),
    variant_group: null,
    variant_weight: 100,
    ends_sequence: false,
    cc_emails: null,
    bcc_emails: null,
    include_unsubscribe: null,
    signature_id: null,
    if_true_goto_step: null,
    if_false_goto_step: null,
    timeout_branch_step_id: null,
    next_step_id: null,
  }));
}

/**
 * Rédaction réelle par draft-sequence, puis enregistrement comme l'éditeur :
 * en-tête de la séquence de la mission, puis étapes par save_sequence_steps.
 */
async function draftAndSave(prefix: string, profileVisit: boolean): Promise<Drafted> {
  const { org, accountId } = await sendingOrg(prefix);
  orgs.push(org);
  const end = new Date(Date.now() + 20 * 86_400_000).toISOString();
  const { error: creditError } = await admin().from('ai_credit_balances').upsert({
    organization_id: org.orgId, plan_credits: 60, topup_credits: 0, credits_total: 60, credits_remaining: 60,
    period_start: new Date().toISOString(), period_end: end,
  }, { onConflict: 'organization_id' });
  if (creditError) throw new Error(`ai_credit_balances : ${creditError.message}`);
  const marker = `Lumen${rand()}`;
  const key = `ai-${marker}`;
  await setMockMode(key, { ai_markers: { [marker]: DRAFT } });
  cleanups.push(() => setMockMode(key, { ai_markers: {} }));
  const { error: contextError } = await admin().from('organizations')
    .update({ ai_context: { free_text: `Cabinet ${marker}, recrutement de cadres.` } }).eq('id', org.orgId);
  if (contextError) throw new Error(`ai_context : ${contextError.message}`);
  const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Directeur financier', job_details: JOB });

  const token = (await signIn(org.owner.email, org.owner.password)).access_token;
  const drafted = await callFunction('draft-sequence', token, {
    action: 'draft', organization_id: org.orgId, mission_id: missionId,
    first_contact: 'invitation', relances: 2, profile_visit: profileVisit,
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
  const draft = drafted.body.draft as { name: string; description: string; steps: DraftStep[] };
  expect(drafted.body.flags, 'rédaction sans point à reprendre').toEqual([]);

  const user = userClient(token);
  const { data: sequence, error: sequenceError } = await user.from('outreach_sequences').insert({
    name: draft.name, description: draft.description, is_active: true,
    created_by: org.owner.userId, organization_id: org.orgId, project_id: missionId,
  }).select('id').single();
  if (sequenceError || !sequence) throw new Error(`outreach_sequences : ${sequenceError?.message}`);
  const { error: stepsError } = await user.rpc('save_sequence_steps', { p_sequence_id: sequence.id, p_steps: editorPayload(draft.steps) });
  if (stepsError) throw new Error(`save_sequence_steps : ${stepsError.message}`);
  return { org, accountId, missionId, user, sequenceId: sequence.id as string };
}

/** Inscription comme le navigateur : inscription active, puis la seule première exécution, due tout de suite. */
async function enrollLikeBrowser(d: Drafted): Promise<{ enrollmentId: string; profileId: string }> {
  const profileId = `ACoAAE2E${rand()}${rand()}`;
  const { data: enrollment, error } = await d.user.from('sequence_enrollments').insert({
    sequence_id: d.sequenceId,
    organization_id: d.org.orgId,
    created_by: d.org.owner.userId,
    profile_id: profileId,
    provider_id: profileId,
    profile_name: 'Camille Martin',
    profile_headline: 'Directrice administrative et financière',
    account_id: d.accountId,
    job_id: d.missionId,
    status: 'active',
    current_step_order: 0,
    user_timezone: 'Europe/Paris',
  }).select('id').single();
  if (error || !enrollment) throw new Error(`sequence_enrollments : ${error?.message}`);
  const { data: firstStep } = await admin().from('sequence_steps').select('id, step_order')
    .eq('sequence_id', d.sequenceId).eq('step_order', 0).single();
  const { error: execError } = await d.user.from('sequence_step_executions').insert({
    enrollment_id: enrollment.id,
    organization_id: d.org.orgId,
    step_id: firstStep!.id,
    step_order: 0,
    status: 'scheduled',
    scheduled_at: minutesFromNow(-1),
  });
  if (execError) throw new Error(`première exécution : ${execError.message}`);
  return { enrollmentId: enrollment.id as string, profileId };
}

/** Exécutions planifiées et dues tout de suite (le temps avance pour le moteur). */
async function pullDue(enrollmentId: string) {
  await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) })
    .eq('enrollment_id', enrollmentId).eq('status', 'scheduled');
}

/** Cycles du moteur, en avançant le temps, jusqu'à ce que la condition soit vraie (dix au plus). */
async function cycleUntil(enrollmentId: string, done: (execs: ExecutionRow[]) => boolean, label: string) {
  for (let i = 0; i < 10; i++) {
    const execs = await executionsOf(enrollmentId);
    if (done(execs)) return execs;
    await pullDue(enrollmentId);
    await runCycle();
  }
  const execs = await executionsOf(enrollmentId);
  expect(done(execs), `${label} : ${JSON.stringify(execs.map((e) => [e.step_order, e.status, e.skip_reason, e.error_message]))}`).toBe(true);
  return execs;
}

const at = (execs: ExecutionRow[], order: number) => execs.filter((e) => e.step_order === order);
const statusAt = (execs: ExecutionRow[], order: number) => at(execs, order).at(-1)?.status ?? null;

/** Messages envoyés à ce candidat (nouvelle conversation ou suite). */
async function chatsTo(accountId: string, profileId: string) {
  return (await mockCalls(accountId)).filter((c) => c.method === 'POST' && c.path === '/api/v1/chats'
    && (c.body as Record<string, unknown>)?.attendees_ids === profileId);
}

// ─── Forme enregistrée ──────────────────────────────────────────────────────

test.describe('Séquence rédigée par l’IA jouée par le moteur (lot 5e)', () => {
  test('@critical forme rédigée, enregistrée comme l’éditeur : visite, invitation, attente de 14 jours, messages « Si connecté » à 0, 4 et 7 jours, sans IA à l’envoi', async () => {
    const d = await draftAndSave('E2E forme rédigée', true);
    const { data: rows } = await admin().from('sequence_steps')
      .select('id, step_order, action_type, condition_type, delay_days, wait_for_event, timeout_days, message_template, use_ai_personalization')
      .eq('sequence_id', d.sequenceId).order('step_order');
    expect((rows ?? []).map((s) => [s.step_order, s.action_type, s.condition_type, s.delay_days, s.wait_for_event, s.timeout_days])).toEqual([
      [0, 'profile_visit', 'always', 0, null, null],
      [1, 'connection_request', 'always', 0, null, null],
      [2, 'wait_connection', 'always', 0, 'connection_accepted', 14],
      [3, 'message', 'if_connected', 0, null, null],
      [4, 'message', 'if_connected', 4, null, null],
      [5, 'message', 'if_connected', 7, null, null],
    ]);
    expect((rows ?? []).every((s) => s.use_ai_personalization === false)).toBe(true);
    expect((rows ?? []).map((s) => s.message_template ?? '')).toEqual(['', NOTE, '', FIRST, RELANCE_1, RELANCE_2]);
    const { data: seq } = await admin().from('outreach_sequences').select('project_id, is_active, name').eq('id', d.sequenceId).single();
    expect(seq).toMatchObject({ project_id: d.missionId, is_active: true, name: 'Approche Directeur financier' });
    expect((await admin().from('sequence_enrollments').select('id').eq('sequence_id', d.sequenceId)).data ?? [], 'aucune inscription à l’enregistrement').toEqual([]);
  });

  test('@critical le candidat accepte : invitation avec sa note, premier message aussitôt, relance au 4e jour, arrêt à la réponse', async () => {
    const d = await draftAndSave('E2E rédigée accepte', true);
    // Pas encore en relation : l'invitation part vraiment.
    await setMockMode(d.accountId, { distance: 'SECOND_DEGREE' });
    const { enrollmentId, profileId } = await enrollLikeBrowser(d);

    // Visite, puis invitation avec la note rédigée, puis attente de l'acceptation.
    await cycleUntil(enrollmentId, (e) => statusAt(e, 2) === 'waiting_event', 'attente de l’acceptation');
    const invites = (await sentInvites(d.accountId)).filter((c) => (c.body as Record<string, unknown>)?.provider_id === profileId);
    expect(invites).toHaveLength(1);
    const note = String((invites[0].body as Record<string, unknown>).message ?? '');
    expect(note).toMatch(/^Bonjour Camille, je recrute un directeur financier à Lyon pour un groupe industriel\./);
    expect(note).not.toMatch(/[{}]/);
    expect(await sentTexts(d.accountId), 'aucun message avant l’acceptation').toEqual([]);

    // Acceptation : le premier message part aussitôt, la première relance attend 4 jours.
    await setMockMode(d.accountId, { distance: 'FIRST_DEGREE' });
    await webhook({
      event: 'new_relation', account_id: d.accountId, account_type: 'LINKEDIN',
      user_provider_id: profileId, user_full_name: 'Camille Martin', user_public_identifier: `camille-${rand()}`,
    });
    // Attente franchie au cycle suivant ; le premier message est planifié dans la foulée (le moteur
    // espace seulement les actions d'un même compte de quelques minutes), sans délai en jours.
    let execs: ExecutionRow[] = [];
    for (let i = 0; i < 6 && at(execs, 3).length === 0; i++) {
      await runCycle();
      execs = await executionsOf(enrollmentId);
    }
    expect(statusAt(execs, 2), JSON.stringify(execs)).toBe('sent');
    const firstExec = at(execs, 3).at(-1);
    expect(firstExec, JSON.stringify(execs)).toBeTruthy();
    // Sans délai en jours : au prochain créneau d'envoi de l'étape (9 h-18 h, heure de Paris, jours ouvrés),
    // quelle que soit l'heure à laquelle le test tourne (un vendredi soir : le lundi matin), bien avant les 4 jours d'une relance.
    expect(new Date(firstExec!.scheduled_at).getTime(), 'premier message sans délai en jours').toBeLessThan(Date.now() + 3 * 86_400_000);
    execs = await cycleUntil(enrollmentId, (e) => statusAt(e, 3) === 'sent', 'premier message');
    const first = await chatsTo(d.accountId, profileId);
    expect(first).toHaveLength(1);
    const firstText = String((first[0].body as Record<string, unknown>).text);
    expect(firstText).toContain('cherche son directeur financier');
    expect(firstText).not.toMatch(/[{}]/);
    const relance = at(execs, 4).at(-1);
    expect(relance?.status).toBe('scheduled');
    expect(new Date(relance!.scheduled_at).getTime()).toBeGreaterThan(Date.now() + 3 * 86_400_000);

    // Le 4e jour : la relance part.
    await cycleUntil(enrollmentId, (e) => statusAt(e, 4) === 'sent', 'première relance');
    const texts = await sentTexts(d.accountId);
    expect(texts).toHaveLength(2);
    expect(texts[1]).toContain('je reviens vers vous au sujet du poste de Directeur financier');

    // Le candidat répond : inscription « répondue », la dernière relance est annulée.
    await webhook({
      event: 'message_received', account_id: d.accountId, account_type: 'LINKEDIN',
      chat_id: `chat_${rand()}`, message_id: `msg_${rand()}`, message: 'Bonjour, oui avec plaisir',
      sender: { attendee_provider_id: profileId, attendee_id: 'att_candidate', attendee_name: 'Camille Martin' },
    });
    expect((await enrollmentRow(enrollmentId)).status).toBe('replied');
    const pending = (await executionsOf(enrollmentId)).filter((e) => ['scheduled', 'waiting_event', 'quota_blocked'].includes(e.status));
    expect(pending, 'plus rien en attente').toEqual([]);
    await runCycle();
    expect(await sentTexts(d.accountId), 'rien ne part après la réponse').toHaveLength(2);
  });

  test('le candidat n’accepte jamais : au bout de 14 jours, fin de l’inscription sans échec ni pause automatique, aucun message', async () => {
    const d = await draftAndSave('E2E rédigée sans acceptation', false);
    await setMockMode(d.accountId, { distance: 'SECOND_DEGREE' });
    const { enrollmentId, profileId } = await enrollLikeBrowser(d);

    const waiting = await cycleUntil(enrollmentId, (e) => statusAt(e, 1) === 'waiting_event', 'attente de l’acceptation');
    expect(statusAt(waiting, 0)).toBe('sent');
    expect((await sentInvites(d.accountId)).filter((c) => (c.body as Record<string, unknown>)?.provider_id === profileId)).toHaveLength(1);

    // Treize jours plus tard, l'attente tient toujours.
    const waitId = at(waiting, 1).at(-1)!.id;
    await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-13 * 24 * 60) }).eq('id', waitId);
    await runEngine({ action: 'check_timeouts' });
    expect(statusAt(await executionsOf(enrollmentId), 1), 'attente tenue avant 14 jours').toBe('waiting_event');

    // Quinze jours : l'attente expire, les messages « Si connecté » sont sautés, l'inscription se termine.
    await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-15 * 24 * 60) }).eq('id', waitId);
    for (let i = 0; i < 3 && statusAt(await executionsOf(enrollmentId), 1) === 'waiting_event'; i++) {
      await runEngine({ action: 'check_timeouts' });
    }
    let row = await enrollmentRow(enrollmentId);
    for (let i = 0; i < 10 && row.status === 'active'; i++) {
      await pullDue(enrollmentId);
      await runCycle();
      row = await enrollmentRow(enrollmentId);
    }
    const execs = await executionsOf(enrollmentId);
    expect(row.status, JSON.stringify(execs.map((e) => [e.step_order, e.status, e.skip_reason, e.error_message]))).toBe('completed');
    expect(row.pause_reason, 'aucune pause automatique').toBeNull();
    expect(execs.filter((e) => e.status === 'failed'), 'aucun échec').toEqual([]);
    // L'attente expire à 14 jours ; chaque message « Si connecté » est sauté par sa condition.
    expect(at(execs, 1).at(-1)).toMatchObject({ status: 'skipped', skip_reason: 'Timeout 14d' });
    for (const order of [2, 3, 4]) {
      expect(at(execs, order).at(-1), `message ${order}`).toMatchObject({ status: 'skipped', skip_reason: 'Condition: if_connected' });
    }
    expect(execs.filter((e) => ['scheduled', 'waiting_event', 'quota_blocked', 'sending'].includes(e.status)), 'plus rien en attente').toEqual([]);
    expect(await sentTexts(d.accountId), 'aucun message sans acceptation').toEqual([]);
    expect((await sentInvites(d.accountId)).length, 'une seule invitation').toBe(1);
  });

  test('le candidat est déjà en relation : invitation sautée, il reçoit le premier message', async () => {
    const d = await draftAndSave('E2E rédigée déjà en relation', false);
    await setMockMode(d.accountId, { distance: 'FIRST_DEGREE' });
    const { enrollmentId, profileId } = await enrollLikeBrowser(d);

    const execs = await cycleUntil(enrollmentId, (e) => statusAt(e, 2) === 'sent', 'premier message');
    expect(statusAt(execs, 0)).toBe('skipped');
    expect(at(execs, 0).at(-1)?.skip_reason).toMatch(/relation/i);
    expect(statusAt(execs, 1), 'attente franchie').toBe('sent');
    expect(await sentInvites(d.accountId), 'aucune invitation').toEqual([]);
    const first = await chatsTo(d.accountId, profileId);
    expect(first).toHaveLength(1);
    expect(String((first[0].body as Record<string, unknown>).text)).toContain('cherche son directeur financier');
    expect((await enrollmentRow(enrollmentId)).status).toBe('active');
    expect(at(execs, 3).at(-1)?.status, 'relance planifiée').toBe('scheduled');
  });
});
