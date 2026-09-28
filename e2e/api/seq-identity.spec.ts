/**
 * Lot « identity » du module séquences : un même candidat LinkedIn porte
 * plusieurs identifiants (Recruiter « AE… », classique « ACo… », slug public
 * /in/{slug}). Réponse reçue, arrêt des autres inscriptions du candidat,
 * « Marquer comme répondu », détection par le moteur, anti-doublon de
 * l'assistant : chacun doit reconnaître le candidat sous tous ses
 * identifiants, et seulement dans son organisation.
 *
 * Contrat : CLAUDE.md, « Séquences : règles du moteur et de l'interface »
 * (une clôture annule toutes les exécutions en attente, jamais 'sending') ;
 * docs/audit-2026-09-25-sequences.md, SEQ-012, SEQ-046, SEQ-110, SEQ-111,
 * SEQ-128, SEQ-212 (« une réponse arrête toutes les séquences du candidat
 * dans l'organisation, quel que soit le compte »), SEQ-006, D3.
 *
 * Le moteur, le webhook LinkedIn et l'assistant tournent pour de vrai contre
 * la stack locale ; LinkedIn est simulé par e2e/local-stack/vendor-mock.mjs.
 * Ignoré sans la stack locale (e2e/local-stack/up.sh).
 *
 * Harnais : le faux prestataire ne rattache GET /chats/{id}/messages à aucun
 * compte (pas d'account_id dans la requête), donc une réponse du candidat ne
 * se scripte qu'avec la clé '*', interdite entre suites parallèles. Le test de
 * détection par le moteur donne à la conversation un identifiant qui porte le
 * compte (« chat…/messages?account_id=…# ») : le moteur l'insère tel quel dans
 * l'URL, le fragment est retiré par fetch, la route scriptée du compte répond.
 */
import { test, expect } from '@playwright/test';
import {
  addMember,
  admin,
  createOrg,
  deleteOrg,
  seedLinkedInAccount,
  seedMission,
  signIn,
  type SeededStep,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import {
  ENGINE_SKIP_REASON,
  callFunction,
  engineAvailable,
  enroll,
  messageSequence,
  minutesFromNow,
  mockCalls,
  rand,
  runCycle,
  schedule,
  sendingOrg,
  sentTexts,
  setMockMode,
  webhook,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.setTimeout(180_000);

/**
 * Un test par comportement, chacun dans son bloc série : les tests tournent
 * l'un après l'autre (cycle du moteur global), et un défaut laissé rouge
 * n'empêche pas les suivants de tourner.
 */
function scenario(key: string, title: string, body: () => Promise<void>) {
  test.describe(key, () => {
    test.describe.configure({ mode: 'serial' });
    test(title, body);
  });
}

// Même texte que unipile-webhook et _shared/sequence-engine-rules.ts.
const SIBLING_REPLY_SKIP_REASON = "Le candidat a répondu sur un autre compte de l'organisation";
const PENDING = ['scheduled', 'waiting_event', 'quota_blocked'];

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
test.afterEach(async () => {
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    for (const table of ['agent_tool_executions', 'job_candidate_status', 'inmail_queue', 'member_quotas']) {
      await admin().from(table).delete().eq('organization_id', org.orgId);
    }
    await deleteOrg(org, extra);
  }
});

function track(org: TestOrg, ...extra: TestUser[]) {
  orgsToDelete.push({ org, extra });
}

// ─── Aides ──────────────────────────────────────────────────────────────────

/** Identifiant classique (ACo…) ou Recruiter (AEM…) unique au test. */
const aco = (tag: string) => `ACoAAID${tag}${rand()}${rand()}`;
const aem = (tag: string) => `AEMAAID${tag}${rand()}${rand()}`;

/** Réponse LinkedIn du candidat reçue sur `accountId` (format message_received). */
function replyFrom(accountId: string, senderId: string, messageId = `msg_${rand()}`) {
  return webhook({
    event: 'message_received',
    account_id: accountId,
    account_type: 'LINKEDIN',
    chat_id: `chat_${rand()}`,
    message_id: messageId,
    message: 'Bonjour, oui avec plaisir',
    sender: { attendee_provider_id: senderId, attendee_id: 'att_candidate', attendee_name: 'Jean Dupont' },
  });
}

/** Premier message déjà parti il y a `days` jours. */
function sentStep(org: TestOrg, enrollmentId: string, step: SeededStep, days = 2) {
  const at = minutesFromNow(-days * 24 * 60);
  return schedule(org, enrollmentId, step, { status: 'sent', scheduled_at: at, executed_at: at, final_message: 'Bonjour' });
}

/** Relance programmée demain (pas due : un cycle concurrent n'y touche pas). */
function laterStep(org: TestOrg, enrollmentId: string, step: SeededStep, overrides: Record<string, unknown> = {}) {
  return schedule(org, enrollmentId, step, { scheduled_at: minutesFromNow(24 * 60), ...overrides });
}

interface EnrollmentState {
  status: string;
  pause_reason: string | null;
  resolved_profile_id: string | null;
  replied_at: string | null;
  completed_at: string | null;
}

async function state(id: string): Promise<EnrollmentState> {
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .select('status, pause_reason, resolved_profile_id, replied_at, completed_at')
    .eq('id', id)
    .single();
  if (error || !data) throw new Error(`state(${id}): ${error?.message}`);
  return data as EnrollmentState;
}

async function execution(id: string) {
  const { data, error } = await admin()
    .from('sequence_step_executions')
    .select('status, skip_reason, scheduled_at')
    .eq('id', id)
    .single();
  if (error || !data) throw new Error(`execution(${id}): ${error?.message}`);
  return data as { status: string; skip_reason: string | null; scheduled_at: string };
}

/** Réponses comptées pour une séquence (toutes dates). */
async function repliesReceived(sequenceId: string): Promise<number> {
  const { data } = await admin().from('sequence_analytics').select('replies_received').eq('sequence_id', sequenceId);
  return (data ?? []).reduce((sum: number, r: { replies_received: number | null }) => sum + (r.replies_received ?? 0), 0);
}

async function setDisplayName(userId: string, displayName: string) {
  const { error } = await admin().from('profiles').update({ display_name: displayName }).eq('user_id', userId);
  if (error) throw new Error(`display_name: ${error.message}`);
}

/** Ligne « proposée » par l'assistant, telle que search-agent-chat l'écrit. */
async function propose(orgId: string, userId: string, tool: string, params: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin()
    .from('agent_tool_executions')
    .insert({
      user_id: userId,
      organization_id: orgId,
      tool_name: tool,
      params,
      status: 'proposed',
      dry_run_result: { summary: `Test e2e ${tool}`, details: {} },
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`propose: ${error?.message}`);
  return data.id as string;
}

/** Clic « Approuver » du bandeau de l'assistant. */
async function approve(user: TestUser, executionId: string) {
  const token = (await signIn(user.email, user.password)).access_token;
  return callFunction('agent-tool-action', token, { execution_id: executionId, action: 'approve' });
}

/** Inscriptions de la séquence qui désignent ce candidat, sous n'importe lequel de ses identifiants. */
async function rowsForPerson(sequenceId: string, ids: string[]): Promise<number> {
  const list = ids.join(',');
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .select('id')
    .eq('sequence_id', sequenceId)
    .or(`profile_id.in.(${list}),provider_id.in.(${list}),resolved_profile_id.in.(${list})`);
  if (error) throw new Error(`rowsForPerson: ${error.message}`);
  return (data ?? []).length;
}

const parisDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' });

// ═══ Webhook : réponse reçue ════════════════════════════════════════════════

test.describe('Identité du candidat : réponse reçue par le webhook LinkedIn', () => {
  // webhook-reponse-identifiants-exacts (SEQ-012, SEQ-013, SEQ-191)
  scenario('webhook-reponse-identifiants-exacts', 'une réponse clôt les inscriptions ouvertes du compte receveur trouvées par provider_id ou resolved_profile_id, rotation comprise, et n’est comptée qu’une fois', async () => {
    const { org, accountId } = await sendingOrg('E2E Identité réponse exacte');
    track(org);
    const owner = org.owner.userId;
    const s1 = await messageSequence(org, owner, ['Bonjour', 'Relance']);
    const s2 = await messageSequence(org, owner, ['Bonjour', 'Relance']);
    const [aco1, aem1, aco2, aem2] = [aco('R1'), aem('R1'), aco('R2'), aem('R2')];

    // E1 : inscrit sous son identifiant Recruiter, identifiant classique en provider_id.
    const e1 = await enroll(org, s1.sequenceId, owner, accountId, { profile_id: aem1, provider_id: aco1, current_step_order: 1 });
    // E2 : inscription d'un autre compte, relayée par le compte receveur
    // (assigned_sender_id), identifiant classique résolu, en pause.
    const e2 = await enroll(org, s2.sequenceId, owner, `acc_rot_${rand()}`, {
      profile_id: aem2, resolved_profile_id: aco2, assigned_sender_id: accountId,
      status: 'paused', pause_reason: 'manual', current_step_order: 1,
    });
    await sentStep(org, e1.enrollmentId, s1.steps[0]);
    await sentStep(org, e2.enrollmentId, s2.steps[0]);
    const f1 = await laterStep(org, e1.enrollmentId, s1.steps[1]);
    const f2 = await laterStep(org, e2.enrollmentId, s2.steps[1]);

    const firstMessage = `msg_${rand()}`;
    await replyFrom(accountId, aco1, firstMessage);
    const afterFirst = await state(e1.enrollmentId);
    expect(afterFirst.status, 'E1 close par la réponse (provider_id)').toBe('replied');
    expect(afterFirst.replied_at).not.toBeNull();
    expect((await execution(f1)).status, 'relance de E1 annulée').toBe('cancelled');
    expect((await state(e2.enrollmentId)).status, 'E2 ne concerne pas cet expéditeur').toBe('paused');

    await replyFrom(accountId, aco2);
    const afterSecond = await state(e2.enrollmentId);
    expect(afterSecond.status, 'E2 close via assigned_sender_id et resolved_profile_id, même en pause').toBe('replied');
    expect(afterSecond.pause_reason, 'plus de raison de pause sur une inscription close').toBeNull();
    expect((await execution(f2)).status, 'relance de E2 annulée').toBe('cancelled');

    expect(await repliesReceived(s1.sequenceId), 'une réponse comptée pour S1').toBe(1);
    expect(await repliesReceived(s2.sequenceId), 'une réponse comptée pour S2').toBe(1);

    // Rejeu du même événement, puis nouveaux messages des mêmes candidats : rien ne change.
    await replyFrom(accountId, aco1, firstMessage);
    await replyFrom(accountId, aco1);
    await replyFrom(accountId, aco2);
    expect((await state(e1.enrollmentId)).status).toBe('replied');
    expect((await state(e2.enrollmentId)).status).toBe('replied');
    expect(await repliesReceived(s1.sequenceId), 'rejeu : S1 toujours à 1').toBe(1);
    expect(await repliesReceived(s2.sequenceId), 'rejeu : S2 toujours à 1').toBe(1);
  });

  // webhook-reponse-identifiants-alternatifs (SEQ-110)
  scenario('webhook-reponse-identifiants-alternatifs', 'une réponse d’un identifiant classique à une inscription Recruiter est rattachée par les identifiants du prestataire : inscription close, resolved_profile_id mémorisé', async () => {
    const { org, accountId } = await sendingOrg('E2E Identité réponse alternative');
    track(org);
    const owner = org.owner.userId;
    const seq = await messageSequence(org, owner, ['Bonjour', 'Relance']);
    const recruiterId = aem('S');
    const senderId = aco('S');
    const e = await enroll(org, seq.sequenceId, owner, accountId, { profile_id: recruiterId, current_step_order: 1 });
    await sentStep(org, e.enrollmentId, seq.steps[0]);
    const followUp = await laterStep(org, e.enrollmentId, seq.steps[1]);
    // LinkedIn : l'expéditeur classique correspond à l'identifiant Recruiter inscrit.
    await setMockMode(accountId, {
      routes: [{
        method: 'GET', path: `^/api/v1/users/${senderId}$`, status: 200,
        body: { object: 'UserProfile', provider: 'LINKEDIN', provider_id: senderId, id: recruiterId, public_identifier: `jean-dupont-${rand()}` },
      }],
    });

    await replyFrom(accountId, senderId);

    const after = await state(e.enrollmentId);
    expect(after.status, 'inscription Recruiter close par la réponse classique').toBe('replied');
    expect(after.resolved_profile_id, 'identifiant de l’expéditeur mémorisé').toBe(senderId);
    expect((await execution(followUp)).status, 'relance annulée').toBe('cancelled');
    const lookups = (await mockCalls(accountId)).filter((c) => c.method === 'GET' && c.path === `/api/v1/users/${senderId}`);
    expect(lookups.length, 'identifiants alternatifs demandés au prestataire').toBeGreaterThan(0);
    expect(await repliesReceived(seq.sequenceId)).toBe(1);
  });
});

// ═══ Webhook : arrêt des autres inscriptions du candidat (SEQ-212) ══════════

test.describe('Identité du candidat : arrêt des autres inscriptions après une réponse', () => {
  // webhook-soeurs-autres-identifiants (SEQ-212)
  scenario('webhook-soeurs-autres-identifiants', 'les autres inscriptions vivantes du candidat (autre compte, autre séquence, autre créateur) passent « arrêtée » sous provider_id ou resolved_profile_id, étapes en attente annulées, envoi en cours intact, réponse comptée une fois', async () => {
    const { org, accountId: c1 } = await sendingOrg('E2E Identité sœurs');
    const colleague = await addMember(org.orgId, 'member', 'collegue');
    track(org, colleague);
    const c2 = await seedLinkedInAccount(org.orgId, colleague.userId, `acc_${rand()}`, 'OK');
    const owner = org.owner.userId;
    const s1 = await messageSequence(org, owner, ['Bonjour', 'Relance']);
    const s2 = await messageSequence(org, colleague.userId, ['Bonjour', 'Relance 1', 'Relance 2', 'Relance 3', 'Relance 4']);
    const s3 = await messageSequence(org, colleague.userId, ['Bonjour', 'Relance']);
    const candidate = aco('X');

    const e1 = await enroll(org, s1.sequenceId, owner, c1, { profile_id: candidate, current_step_order: 1 });
    const e2 = await enroll(org, s2.sequenceId, colleague.userId, c2, {
      profile_id: aem('XA'), provider_id: candidate, status: 'paused', pause_reason: 'manual', current_step_order: 1,
    });
    const e3 = await enroll(org, s3.sequenceId, colleague.userId, c2, {
      profile_id: aem('X9'), resolved_profile_id: candidate, current_step_order: 1,
    });
    await sentStep(org, e1.enrollmentId, s1.steps[0]);
    await sentStep(org, e2.enrollmentId, s2.steps[0]);
    await sentStep(org, e3.enrollmentId, s3.steps[0]);
    const f1 = await laterStep(org, e1.enrollmentId, s1.steps[1]);
    const e2Scheduled = await laterStep(org, e2.enrollmentId, s2.steps[1]);
    const e2Waiting = await laterStep(org, e2.enrollmentId, s2.steps[2], { status: 'waiting_event' });
    const e2Quota = await laterStep(org, e2.enrollmentId, s2.steps[3], { status: 'quota_blocked' });
    const e2Sending = await laterStep(org, e2.enrollmentId, s2.steps[4], { status: 'sending', scheduled_at: minutesFromNow(-1) });
    const f3 = await laterStep(org, e3.enrollmentId, s3.steps[1]);

    await replyFrom(c1, candidate);

    expect((await state(e1.enrollmentId)).status, 'inscription qui a reçu la réponse').toBe('replied');
    expect((await execution(f1)).status).toBe('cancelled');
    for (const [label, id] of [['E2 (provider_id, en pause, collègue)', e2.enrollmentId], ['E3 (resolved_profile_id)', e3.enrollmentId]] as const) {
      const s = await state(id);
      expect(s.status, `${label} arrêtée`).toBe('stopped');
      expect(s.pause_reason, `${label} : pas de raison de pause`).toBeNull();
      expect(s.completed_at, `${label} : date de fin posée`).not.toBeNull();
    }
    for (const id of [e2Scheduled, e2Waiting, e2Quota, f3]) {
      const x = await execution(id);
      expect(x.status, `exécution ${id} annulée`).toBe('cancelled');
      expect(x.skip_reason).toBe(SIBLING_REPLY_SKIP_REASON);
    }
    expect((await execution(e2Sending)).status, 'un envoi en cours n’est jamais annulé').toBe('sending');

    expect(await repliesReceived(s1.sequenceId), 'réponse comptée sur la séquence qui l’a reçue').toBe(1);
    expect(await repliesReceived(s2.sequenceId), 'pas de réponse comptée sur S2').toBe(0);
    expect(await repliesReceived(s3.sequenceId), 'pas de réponse comptée sur S3').toBe(0);
  });

  // webhook-soeurs-slug-seul (SEQ-212), variante slug de profile_url
  scenario('webhook-soeurs-slug-seul (slug)', 'une inscription du candidat reliée seulement par le slug de son URL est arrêtée après sa réponse, et sa relance ne part pas', async () => {
    const { org, accountId: c1 } = await sendingOrg('E2E Identité sœur slug');
    const colleague = await addMember(org.orgId, 'member', 'collegue');
    track(org, colleague);
    const c2 = await seedLinkedInAccount(org.orgId, colleague.userId, `acc_${rand()}`, 'OK');
    const owner = org.owner.userId;
    const s1 = await messageSequence(org, owner, ['Bonjour', 'Relance']);
    const s2 = await messageSequence(org, colleague.userId, ['Bonjour', 'Relance']);
    const candidate = aco('J');
    const slug = `jean-dupont-${rand()}`;

    const e1 = await enroll(org, s1.sequenceId, owner, c1, {
      profile_id: candidate, profile_url: `https://www.linkedin.com/in/${slug}`, current_step_order: 1,
    });
    const e2 = await enroll(org, s2.sequenceId, colleague.userId, c2, {
      profile_id: aem('Z'), profile_url: `https://www.linkedin.com/in/${slug}/`, current_step_order: 1,
    });
    await sentStep(org, e1.enrollmentId, s1.steps[0]);
    await sentStep(org, e2.enrollmentId, s2.steps[0]);
    await laterStep(org, e1.enrollmentId, s1.steps[1]);
    const e2FollowUp = await laterStep(org, e2.enrollmentId, s2.steps[1]);

    await replyFrom(c1, candidate);
    expect((await state(e1.enrollmentId)).status).toBe('replied');

    // DÉFAUT webhook-soeur-slug-non-arretee : closeSiblingEnrollments ne compare que profile_id, resolved_profile_id et provider_id, jamais le slug de profile_url.
    expect.soft((await state(e2.enrollmentId)).status, 'même candidat (même slug) : inscription arrêtée').toBe('stopped');
    expect.soft((await execution(e2FollowUp)).status, 'relance de la sœur annulée').toBe('cancelled');

    // La relance arrive à échéance : rien ne doit partir vers le candidat qui a répondu.
    await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) })
      .eq('id', e2FollowUp).eq('status', 'scheduled');
    await runCycle();
    expect(await sentTexts(c2), 'aucune relance au candidat qui a répondu').toEqual([]);
  });

  // webhook-soeurs-slug-seul (SEQ-212), variante identifiant alternatif du prestataire
  scenario('webhook-soeurs-slug-seul (identifiant alternatif)', 'une inscription du candidat reliée seulement par un identifiant alternatif du prestataire est arrêtée après sa réponse', async () => {
    const { org, accountId: c1 } = await sendingOrg('E2E Identité sœur alternative');
    const colleague = await addMember(org.orgId, 'member', 'collegue');
    track(org, colleague);
    const c2 = await seedLinkedInAccount(org.orgId, colleague.userId, `acc_${rand()}`, 'OK');
    const owner = org.owner.userId;
    const s1 = await messageSequence(org, owner, ['Bonjour', 'Relance']);
    const s2 = await messageSequence(org, colleague.userId, ['Bonjour', 'Relance']);
    const candidate = aco('K');
    const recruiterId = aem('K');
    // LinkedIn : l'identifiant classique et l'identifiant Recruiter sont la même personne.
    await setMockMode(c1, {
      routes: [{
        method: 'GET', path: `^/api/v1/users/${candidate}$`, status: 200,
        body: { object: 'UserProfile', provider: 'LINKEDIN', provider_id: candidate, id: recruiterId, public_identifier: `jean-${rand()}` },
      }],
    });

    const e1 = await enroll(org, s1.sequenceId, owner, c1, { profile_id: candidate, current_step_order: 1 });
    const e2 = await enroll(org, s2.sequenceId, colleague.userId, c2, { profile_id: recruiterId, current_step_order: 1 });
    await sentStep(org, e1.enrollmentId, s1.steps[0]);
    await sentStep(org, e2.enrollmentId, s2.steps[0]);
    const e2FollowUp = await laterStep(org, e2.enrollmentId, s2.steps[1]);

    await replyFrom(c1, candidate);
    expect((await state(e1.enrollmentId)).status).toBe('replied');
    // DÉFAUT webhook-soeur-alternative-non-arretee : les identifiants alternatifs ne sont résolus que si le rattachement exact échoue, donc jamais passés à closeSiblingEnrollments quand E1 est trouvée.
    expect.soft((await state(e2.enrollmentId)).status, 'même candidat (identifiant Recruiter) : inscription arrêtée').toBe('stopped');
    expect((await execution(e2FollowUp)).status, 'relance de la sœur annulée').toBe('cancelled');
  });

  // webhook-isolation-organisations (SEQ-006, SEQ-111)
  scenario('webhook-isolation-organisations', 'une réponse reçue par l’organisation A ne touche ni les inscriptions, ni le pipeline, ni les InMails du même candidat dans l’organisation B', async () => {
    const a = await sendingOrg('E2E Identité isolation A');
    track(a.org);
    const b = await sendingOrg('E2E Identité isolation B');
    track(b.org);
    const shared = aco('SH');
    const missionA = await seedMission(a.org.orgId, a.org.owner.userId);
    const missionB = await seedMission(b.org.orgId, b.org.owner.userId);

    const seed = async (side: typeof a, missionId: string) => {
      const owner = side.org.owner.userId;
      const s = await messageSequence(side.org, owner, ['Bonjour', 'Relance']);
      const s2 = await messageSequence(side.org, owner, ['Bonjour', 'Relance']);
      const main = await enroll(side.org, s.sequenceId, owner, side.accountId, { profile_id: shared, current_step_order: 1, job_id: missionId });
      const sibling = await enroll(side.org, s2.sequenceId, owner, side.accountId, { profile_id: aem('SH'), provider_id: shared, current_step_order: 1 });
      await sentStep(side.org, main.enrollmentId, s.steps[0]);
      await sentStep(side.org, sibling.enrollmentId, s2.steps[0]);
      const mainNext = await laterStep(side.org, main.enrollmentId, s.steps[1]);
      const siblingNext = await laterStep(side.org, sibling.enrollmentId, s2.steps[1]);
      const { error: jcsError } = await admin().from('job_candidate_status').insert({
        organization_id: side.org.orgId, created_by: owner, candidate_id: shared, candidate_name: 'Jean Dupont',
        job_id: `project:${missionId}`, project_id: missionId, status: 'contacted', pipeline_stage: 'Contacté',
      });
      if (jcsError) throw new Error(`job_candidate_status: ${jcsError.message}`);
      const { data: inmail, error: inmailError } = await admin().from('inmail_queue').insert({
        account_id: side.accountId, recipient_profile_id: shared, subject: 'Objet', message: 'Texte',
        status: 'sent', sent_at: minutesFromNow(-3 * 24 * 60), organization_id: side.org.orgId, created_by: owner,
      }).select('id').single();
      if (inmailError || !inmail) throw new Error(`inmail_queue: ${inmailError?.message}`);
      return { main, sibling, mainNext, siblingNext, inmailId: inmail.id as string };
    };
    const sideA = await seed(a, missionA);
    const sideB = await seed(b, missionB);

    await replyFrom(a.accountId, shared);

    // Témoin : l'organisation A traite la réponse. Ses deux inscriptions sont
    // sur le compte receveur : toutes deux closes comme « répondu » (profile_id
    // puis provider_id égal à l'expéditeur).
    expect((await state(sideA.main.enrollmentId)).status).toBe('replied');
    expect((await state(sideA.sibling.enrollmentId)).status).toBe('replied');
    const jcsA = await admin().from('job_candidate_status').select('status, pipeline_stage').eq('organization_id', a.org.orgId).eq('candidate_id', shared).single();
    expect(jcsA.data, 'pipeline de A passé « Répondu »').toEqual({ status: 'replied', pipeline_stage: 'Répondu' });
    expect((await admin().from('inmail_queue').select('status').eq('id', sideA.inmailId).single()).data?.status).toBe('replied');

    // Organisation B intacte.
    expect((await state(sideB.main.enrollmentId)).status, 'inscription de B (même profile_id) intacte').toBe('active');
    expect((await state(sideB.sibling.enrollmentId)).status, 'sœur de B (provider_id) intacte').toBe('active');
    for (const id of [sideB.mainNext, sideB.siblingNext]) {
      expect((await execution(id)).status, 'relances de B toujours programmées').toBe('scheduled');
    }
    const jcsB = await admin().from('job_candidate_status').select('status, pipeline_stage').eq('organization_id', b.org.orgId).eq('candidate_id', shared).single();
    expect(jcsB.data, 'pipeline de B inchangé').toEqual({ status: 'contacted', pipeline_stage: 'Contacté' });
    expect((await admin().from('inmail_queue').select('status').eq('id', sideB.inmailId).single()).data?.status, 'InMail de B toujours « envoyé »').toBe('sent');
  });
});

// ═══ Moteur : « Marquer comme répondu » et détection de réponse ═════════════

test.describe('Identité du candidat : réponses traitées par le moteur', () => {
  // moteur-mark-replied-soeurs-autres-identifiants (SEQ-212, contrat §8)
  scenario('moteur-mark-replied-soeurs-autres-identifiants', '« Marquer comme répondu » arrête les autres inscriptions vivantes du candidat sous provider_id ou resolved_profile_id, jamais celles d’une autre organisation, et annonce le nombre exact', async () => {
    const { org, accountId: c1 } = await sendingOrg('E2E Identité marquer répondu');
    const colleague = await addMember(org.orgId, 'member', 'collegue');
    track(org, colleague);
    const c2 = await seedLinkedInAccount(org.orgId, colleague.userId, `acc_${rand()}`, 'OK');
    const other = await sendingOrg('E2E Identité marquer répondu autre');
    track(other.org);
    const owner = org.owner.userId;
    const candidate = aco('M');
    const s1 = await messageSequence(org, owner, ['Bonjour', 'Relance']);
    const s2 = await messageSequence(org, colleague.userId, ['Bonjour', 'Relance']);
    const s3 = await messageSequence(org, owner, ['Bonjour', 'Relance']);
    const sOther = await messageSequence(other.org, other.org.owner.userId, ['Bonjour', 'Relance']);

    const e = await enroll(org, s1.sequenceId, owner, c1, { profile_id: candidate, current_step_order: 1 });
    const e2 = await enroll(org, s2.sequenceId, colleague.userId, c2, { profile_id: aem('M1'), provider_id: candidate, current_step_order: 1 });
    const e3 = await enroll(org, s3.sequenceId, owner, c1, {
      profile_id: aem('M9'), resolved_profile_id: candidate, status: 'paused', pause_reason: 'manual', current_step_order: 1,
    });
    const e4 = await enroll(other.org, sOther.sequenceId, other.org.owner.userId, other.accountId, { profile_id: candidate, current_step_order: 1 });
    const x2 = await laterStep(org, e2.enrollmentId, s2.steps[1]);
    const x3 = await laterStep(org, e3.enrollmentId, s3.steps[1]);
    const x4 = await laterStep(other.org, e4.enrollmentId, sOther.steps[1]);

    const token = (await signIn(org.owner.email, org.owner.password)).access_token;
    const res = await callFunction('process-sequences', token, { action: 'mark_replied', enrollment_id: e.enrollmentId, organization_id: org.orgId });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.changed).toBe(true);
    expect(res.body.stopped_siblings, 'deux autres inscriptions du candidat arrêtées').toBe(2);
    expect((await state(e.enrollmentId)).status).toBe('replied');
    for (const [label, id, exec] of [['E2 (provider_id)', e2.enrollmentId, x2], ['E3 (resolved_profile_id, en pause)', e3.enrollmentId, x3]] as const) {
      const s = await state(id);
      expect(s.status, `${label} arrêtée`).toBe('stopped');
      expect(s.pause_reason).toBeNull();
      const x = await execution(exec);
      expect(x.status, `${label} : étape en attente annulée`).toBe('cancelled');
      expect(x.skip_reason).toBe(SIBLING_REPLY_SKIP_REASON);
    }
    expect((await state(e4.enrollmentId)).status, 'autre organisation intacte').toBe('active');
    expect((await execution(x4)).status).toBe('scheduled');
  });

  // moteur-detection-reponse-soeurs (SEQ-212, SEQ-078)
  scenario('moteur-detection-reponse-soeurs', 'une réponse trouvée par la vérification avant relance clôt l’inscription, la relance ne part pas et les inscriptions sœurs du candidat sous un autre identifiant s’arrêtent', async () => {
    const { org, accountId: c1 } = await sendingOrg('E2E Identité détection moteur');
    const colleague = await addMember(org.orgId, 'member', 'collegue');
    track(org, colleague);
    const c2 = await seedLinkedInAccount(org.orgId, colleague.userId, `acc_${rand()}`, 'OK');
    const owner = org.owner.userId;
    const candidate = aco('D');
    const s1 = await messageSequence(org, owner, ['Bonjour', 'Relance']);
    const s2 = await messageSequence(org, colleague.userId, ['Bonjour', 'Relance']);

    const e1 = await enroll(org, s1.sequenceId, owner, c1, { profile_id: candidate, current_step_order: 1 });
    const e2 = await enroll(org, s2.sequenceId, colleague.userId, c2, { profile_id: aem('D'), provider_id: candidate, current_step_order: 1 });
    await sentStep(org, e1.enrollmentId, s1.steps[0], 3);
    await sentStep(org, e2.enrollmentId, s2.steps[0], 3);
    const e2FollowUp = await laterStep(org, e2.enrollmentId, s2.steps[1]);

    // LinkedIn : une conversation avec le candidat, qui a répondu hier.
    const chat = `chatid${rand()}`;
    await setMockMode(c1, {
      routes: [
        {
          method: 'GET', path: `^/api/v1/chat_attendees/${candidate}/chats$`, status: 200,
          body: { object: 'ChatList', items: [{ id: `${chat}/messages?account_id=${c1}#` }], cursor: null },
        },
        {
          method: 'GET', path: `^/api/v1/chats/${chat}/messages$`, status: 200,
          body: {
            object: 'MessageList', cursor: null,
            items: [{ id: `msg_${rand()}`, is_sender: 0, text: 'Merci, je suis intéressé', timestamp: minutesFromNow(-24 * 60) }],
          },
        },
      ],
    });
    // Relance due, insérée en dernier.
    const e1FollowUp = await schedule(org, e1.enrollmentId, s1.steps[1]);

    await runCycle();

    const checked = (await mockCalls(c1)).filter((c) => c.method === 'GET' && c.path === `/api/v1/chats/${chat}/messages`);
    expect(checked.length, 'la conversation du candidat a été relue avant la relance').toBeGreaterThan(0);
    expect((await state(e1.enrollmentId)).status, 'inscription close par la réponse détectée').toBe('replied');
    expect((await execution(e1FollowUp)).status, 'relance annulée').toBe('cancelled');
    expect(await sentTexts(c1), 'aucune relance envoyée').toEqual([]);
    const sibling = await state(e2.enrollmentId);
    expect(sibling.status, 'sœur (provider_id) arrêtée').toBe('stopped');
    expect(sibling.pause_reason).toBeNull();
    const siblingExec = await execution(e2FollowUp);
    expect(siblingExec.status, 'relance de la sœur annulée').toBe('cancelled');
    expect(siblingExec.skip_reason).toBe(SIBLING_REPLY_SKIP_REASON);
    expect(await sentTexts(c2)).toEqual([]);
  });
});

// ═══ Assistant : enroll_in_sequence ═════════════════════════════════════════

test.describe('Identité du candidat : inscription par l’assistant', () => {
  // agent-refus-autre-identifiant (SEQ-046, SEQ-128)
  scenario('agent-refus-autre-identifiant', 'enroll_in_sequence refuse un candidat inscrit par un collègue sous un autre identifiant (provider_id, resolved_profile_id ou slug seul), avec « Déjà contacté par … »', async () => {
    const { org, accountId: ownerAccount } = await sendingOrg('E2E Identité assistant refus');
    const member = await addMember(org.orgId, 'member', 'membre');
    track(org, member);
    await seedLinkedInAccount(org.orgId, member.userId, `acc_${rand()}`, 'OK');
    await setDisplayName(org.owner.userId, 'Claire Dubois');
    const owner = org.owner.userId;
    const mission = await seedMission(org.orgId, owner);
    const colleagueSeq = await messageSequence(org, owner, ['Bonjour']);
    const target = await messageSequence(org, owner, ['Bonjour']);

    const byProvider = { classic: aco('P'), recruiter: aem('P') };
    const byResolved = { classic: aco('R'), recruiter: aem('R') };
    const slug = `jean-dupont-${rand()}`;
    const e1 = await enroll(org, colleagueSeq.sequenceId, owner, ownerAccount, { profile_id: byProvider.recruiter, provider_id: byProvider.classic });
    await enroll(org, colleagueSeq.sequenceId, owner, ownerAccount, { profile_id: byResolved.recruiter, resolved_profile_id: byResolved.classic });
    await enroll(org, colleagueSeq.sequenceId, owner, ownerAccount, { profile_id: aem('S'), profile_url: `https://www.linkedin.com/in/${slug}` });
    const { data: e1Row } = await admin().from('sequence_enrollments').select('created_at').eq('id', e1.enrollmentId).single();
    const expectedLabel = `Déjà contacté par Claire le ${parisDate(e1Row!.created_at as string)}`;

    const cases: Array<{ label: string; params: Record<string, unknown>; ids: string[] }> = [
      { label: 'provider_id', params: { candidate_id: byProvider.classic }, ids: [byProvider.classic, byProvider.recruiter] },
      { label: 'resolved_profile_id', params: { candidate_id: byResolved.classic }, ids: [byResolved.classic, byResolved.recruiter] },
      {
        label: 'slug seul',
        params: { candidate_id: aco('SL'), profile_url: `https://www.linkedin.com/in/${slug.replace('jean-dupont', 'Jean-Dupont')}/` },
        ids: [],
      },
    ];
    for (const c of cases) {
      const executionId = await propose(org.orgId, member.userId, 'enroll_in_sequence', {
        sequence_id: target.sequenceId, job_id: mission, profile_name: 'Jean Dupont', ...c.params,
      });
      const res = await approve(member, executionId);
      expect(res.status, `${c.label} : ${JSON.stringify(res.body)}`).toBe(400);
      expect(String(res.body.error ?? ''), `${c.label} : motif du refus`).toContain(expectedLabel);
      const { data: row } = await admin().from('agent_tool_executions').select('status').eq('id', executionId).single();
      expect(row?.status, `${c.label} : action notée en échec`).toBe('failed');
    }
    const { data: created } = await admin().from('sequence_enrollments').select('id').eq('sequence_id', target.sequenceId);
    expect(created ?? [], 'aucune inscription créée dans la séquence visée').toEqual([]);
  });

  // agent-force-meme-sequence-autre-identifiant (SEQ-046)
  scenario('agent-force-meme-sequence-autre-identifiant', 'avec force: true, un propriétaire n’inscrit jamais une seconde fois dans la même séquence un candidat déjà inscrit sous un autre identifiant, même si son dernier contact est ailleurs', async () => {
    const { org, accountId } = await sendingOrg('E2E Identité assistant dérogation');
    track(org);
    const owner = org.owner.userId;
    const mission = await seedMission(org.orgId, owner);
    const seq = await messageSequence(org, owner, ['Bonjour']);
    const classic = aco('F');
    const recruiter = aem('F');
    await enroll(org, seq.sequenceId, owner, accountId, {
      profile_id: recruiter, provider_id: classic, created_at: minutesFromNow(-20 * 24 * 60),
    });

    // Témoin : dernier contact = l'inscription dans cette séquence, refus même forcé.
    const control = await approve(org.owner, await propose(org.orgId, owner, 'enroll_in_sequence', {
      sequence_id: seq.sequenceId, candidate_id: classic, job_id: mission, profile_name: 'Jean Dupont', force: true,
    }));
    expect(control.status, JSON.stringify(control.body)).toBe(400);
    expect(String(control.body.error ?? '')).toContain('déjà inscrit dans cette séquence');
    expect(await rowsForPerson(seq.sequenceId, [classic, recruiter])).toBe(1);

    // InMail groupé plus récent vers l'identifiant classique : le dernier contact est ailleurs.
    const { error: inmailError } = await admin().from('inmail_queue').insert({
      account_id: accountId, recipient_profile_id: classic, subject: 'Objet', message: 'Texte', status: 'sent',
      sent_at: minutesFromNow(-2 * 24 * 60), created_at: minutesFromNow(-2 * 24 * 60),
      organization_id: org.orgId, created_by: owner,
    });
    if (inmailError) throw new Error(`inmail_queue: ${inmailError.message}`);

    const forced = await approve(org.owner, await propose(org.orgId, owner, 'enroll_in_sequence', {
      sequence_id: seq.sequenceId, candidate_id: classic, job_id: mission, profile_name: 'Jean Dupont', force: true,
    }));
    // DÉFAUT agent-force-double-inscription-meme-sequence : verifyAccess ne compare à la séquence que le contact le plus récent ; l'InMail plus récent masque l'inscription de S et force: true passe.
    expect.soft(forced.status, `refus attendu : ${JSON.stringify(forced.body)}`).toBe(400);
    expect.soft(String(forced.body.error ?? ''), 'motif : déjà dans cette séquence').toContain('déjà inscrit dans cette séquence');
    expect(await rowsForPerson(seq.sequenceId, [classic, recruiter]), 'une seule inscription du candidat dans la séquence').toBe(1);
  });
});
