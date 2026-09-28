/**
 * Lot « reply-paths » du module séquences : une réponse du candidat, quel que
 * soit le chemin qui la voit, aboutit au même état. Quatre chemins :
 *   - le webhook LinkedIn (unipile-webhook, message_received) ;
 *   - check_replies, la scrutation de secours du moteur (process-sequences) ;
 *   - la vérification de réponse avant une relance (cycle `process`) ;
 *   - « Marquer comme répondu » (action membre mark_replied).
 * Plus l'étape d'attente de réponse et la condition « Si pas de réponse »,
 * et la réponse par e-mail (mail_received).
 *
 * Contrat : CLAUDE.md, section « Séquences : règles du moteur et de
 * l'interface » (clôture = annulation des étapes en attente, reprise jamais
 * automatique), et docs/audit-2026-09-25-sequences.md : SEQ-006 (pipeline
 * « Répondu » borné à l'organisation ET à la mission), SEQ-191 (réponse
 * comptée une fois), SEQ-212 (une réponse arrête toutes les séquences du
 * candidat dans l'organisation), SEQ-221 (« Marquer comme répondu » met à jour
 * le pipeline et les compteurs).
 *
 * Données réalistes : l'inscription depuis l'interface écrit
 * job_candidate_status en « messaged », job_id nu, sans pipeline_stage
 * (markCandidatesMessaged, src/components/outreach/enrollment-preview/
 * enrollmentHelpers.ts). Les tests existants partaient de « contacted ».
 * L'étape de pipeline vue par le recruteur est calculée comme dans
 * src/hooks/useATSData.ts (computeEffectiveStage) : pipeline_stage explicite
 * prioritaire, sinon dérivée du statut.
 *
 * Harnais : le faux prestataire rattache un appel à un compte par le paramètre
 * account_id. La lecture des messages d'une conversation n'en porte pas :
 * l'identifiant de conversation renvoyé porte « /messages?account_id=<compte>&x= »,
 * que le moteur insère tel quel dans l'URL (même contournement que
 * seq-steps-2.spec.ts). Jamais la clé '*'.
 *
 * `force: true` lève la fenêtre d'envoi (jours ouvrés 8 h-19 h).
 *
 * @critical
 */
import { test, expect } from '@playwright/test';
import {
  addMember,
  admin,
  createOrg,
  deleteOrg,
  seedLinkedInAccount,
  seedMission,
  seedSequence,
  signIn,
  type SeededStep,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import {
  ENGINE_SKIP_REASON,
  WEBHOOK_SECRET,
  callFunction,
  engineAvailable,
  enroll,
  messageSequence,
  minutesFromNow,
  mockCalls,
  postJson,
  rand,
  runCycle,
  runEngine,
  schedule,
  sendingOrg,
  sentTexts,
  setMockMode,
  type MockRoute,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.setTimeout(240_000);

/**
 * Chaque test dans son propre groupe « serial » : le moteur balaie toute la
 * base sous un verrou global, rien ne doit tourner en parallèle, et un défaut
 * attendu (test laissé en échec) ne doit pas empêcher les tests suivants de
 * tourner.
 */
function isolated(key: string, title: string, body: () => Promise<void>) {
  test.describe(key, () => {
    test.describe.configure({ mode: 'serial' });
    test(title, body);
  });
}

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const tracked: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const track = (org: TestOrg, extra: TestUser[] = []) => tracked.push({ org, extra });

test.afterEach(async () => {
  while (tracked.length) {
    const { org, extra } = tracked.pop()!;
    // Lignes sans suppression en cascade depuis deleteOrg (l'organisation survit).
    await admin().from('job_candidate_status').delete().eq('organization_id', org.orgId);
    await admin().from('member_email_accounts').delete().eq('organization_id', org.orgId);
    await deleteOrg(org, extra);
  }
});

// ─── Constantes du code (textes exacts) ─────────────────────────────────────

const SIBLING_REPLY = "Le candidat a répondu sur un autre compte de l'organisation";
const PRE_SEND_REASON = 'Reply detected (pre-send check)';

type Path = 'webhook' | 'check_replies' | 'pre_send' | 'mark_replied';
const PATHS: Path[] = ['webhook', 'check_replies', 'pre_send', 'mark_replied'];
const PATH_LABEL: Record<Path, string> = {
  webhook: 'le webhook LinkedIn',
  check_replies: 'check_replies',
  pre_send: 'la vérification avant envoi',
  mark_replied: '« Marquer comme répondu »',
};

// ─── Lectures ───────────────────────────────────────────────────────────────

const STATUS_TO_STAGE: Record<string, string> = {
  discovered: 'Nouveau', untreated: 'Nouveau', scored: 'Nouveau', shortlisted: 'Pressenti',
  messaged: 'Contacté', replied: 'Répondu', interested: 'Répondu', not_interested: 'Répondu',
  qualification: 'Pré-qualif', dismissed: 'Perdu',
};
/** Étape affichée au kanban (copie de computeEffectiveStage, src/hooks/useATSData.ts). */
function effectiveStage(pipelineStage: string | null, status: string): string {
  if (!pipelineStage) return STATUS_TO_STAGE[status] || 'Nouveau';
  if (status === 'dismissed') return 'Perdu';
  return pipelineStage;
}

interface EnrollmentState {
  status: string;
  pause_reason: string | null;
  replied_at: string | null;
  completed_at: string | null;
  last_check_at: string | null;
}
async function enrollmentState(id: string): Promise<EnrollmentState> {
  const { data, error } = await admin().from('sequence_enrollments')
    .select('status, pause_reason, replied_at, completed_at, last_check_at').eq('id', id).single();
  if (error || !data) throw new Error(`enrollmentState: ${error?.message}`);
  return data as EnrollmentState;
}

async function execState(id: string) {
  const { data, error } = await admin().from('sequence_step_executions')
    .select('status, skip_reason, scheduled_at').eq('id', id).single();
  if (error || !data) throw new Error(`execState: ${error?.message}`);
  return data as { status: string; skip_reason: string | null; scheduled_at: string };
}

interface JcsRow { status: string; pipeline_stage: string | null; updated_at: string }
async function jcsRow(id: string): Promise<JcsRow> {
  const { data, error } = await admin().from('job_candidate_status')
    .select('status, pipeline_stage, updated_at').eq('id', id).single();
  if (error || !data) throw new Error(`jcsRow: ${error?.message}`);
  return data as JcsRow;
}

async function repliesReceived(sequenceId: string): Promise<number> {
  const { data } = await admin().from('sequence_analytics').select('replies_received').eq('sequence_id', sequenceId);
  return ((data ?? []) as Array<{ replies_received: number | null }>).reduce((s, r) => s + (r.replies_received ?? 0), 0);
}

/** Envois visibles (message, nouvelle conversation, invitation) partis de ce compte. */
async function sendsOf(accountId: string) {
  return (await mockCalls(accountId)).filter((c) => c.method === 'POST'
    && (c.path === '/api/v1/chats' || /^\/api\/v1\/chats\/[^/]+\/messages$/.test(c.path) || c.path === '/api/v1/users/invite'));
}

// ─── Seeds ──────────────────────────────────────────────────────────────────

/** Ligne de pipeline telle que l'écrit l'inscription (« messaged », job_id nu). */
async function seedJcs(
  orgId: string, createdBy: string, jobId: string, candidateId: string,
  status = 'messaged', pipelineStage: string | null = null, candidateName = 'Camille Martin',
): Promise<string> {
  const { data, error } = await admin().from('job_candidate_status').insert({
    organization_id: orgId, created_by: createdBy, job_id: jobId, candidate_id: candidateId,
    status, pipeline_stage: pipelineStage, candidate_name: candidateName,
  }).select('id').single();
  if (error || !data) throw new Error(`job_candidate_status: ${error?.message}`);
  return data.id as string;
}

/**
 * Fil LinkedIn scripté pour le compte : une conversation avec un message du
 * candidat (is_sender 0) daté `replyAt`. Voir l'en-tête pour le contournement.
 */
function replyRoutes(accountId: string, profileId: string, replyAt: string): MockRoute[] {
  const chatId = `cRP${rand()}${rand()}`;
  return [
    {
      method: 'GET',
      path: `^/api/v1/chat_attendees/${profileId}/chats$`,
      body: { object: 'ChatList', items: [{ id: `${chatId}/messages?account_id=${encodeURIComponent(accountId)}&x=` }], cursor: null },
    },
    {
      method: 'GET',
      path: `^/api/v1/chats/${chatId}/messages$`,
      body: { object: 'MessageList', items: [{ id: `m_${rand()}`, is_sender: 0, timestamp: replyAt, text: 'Oui, avec plaisir' }], cursor: null },
    },
  ];
}

const TWO_DAYS_AGO = () => minutesFromNow(-2 * 24 * 60);

/** Séquence de deux messages liée à la mission, inscription positionnée sur la relance, premier message parti il y a deux jours. */
async function followUpEnrollment(
  org: TestOrg, createdBy: string, accountId: string, profileId: string, missionId: string | null,
  overrides: Record<string, unknown> = {},
) {
  const seq = await messageSequence(org, createdBy, ['Bonjour', 'Relance'], 2);
  if (missionId) await admin().from('outreach_sequences').update({ project_id: missionId }).eq('id', seq.sequenceId);
  const { enrollmentId } = await enroll(org, seq.sequenceId, createdBy, accountId, {
    profile_id: profileId, job_id: missionId, current_step_order: 1, ...overrides,
  });
  const sentAt = TWO_DAYS_AGO();
  await schedule(org, enrollmentId, seq.steps[0], { status: 'sent', scheduled_at: sentAt, executed_at: sentAt, final_message: 'Bonjour' });
  return { ...seq, enrollmentId };
}

interface World {
  org: TestOrg;
  member: TestUser;
  acc1: string;
  acc2: string;
  profileId: string;
  m1: string;
  m2: string;
  s1: { sequenceId: string; steps: SeededStep[] };
  e1: string;
  step1Exec: string;
  jcsM1: string;
  jcsM2: string;
  e2: string;
  e2Exec: string;
}

/**
 * Seed commun : org qui envoie (compte acc1 du propriétaire), un membre avec
 * son compte acc2, missions M1 et M2, séquence S1 liée à M1, inscription E1
 * (job_id = M1 nu) dont le premier message est parti il y a deux jours,
 * pipeline (M1, « messaged », étape vide) et (M2, « messaged », « Contacté »),
 * même candidat inscrit par le membre sur acc2 (E2, relance dans 24 h).
 * La relance de E1 est due maintenant pour le chemin « avant envoi », dans
 * 24 h sinon ; elle est insérée en dernier.
 */
async function buildWorld(prefix: string, path: Path): Promise<World> {
  const { org, accountId: acc1 } = await sendingOrg(prefix);
  const member = await addMember(org.orgId, 'member', 'membre');
  track(org, [member]);
  const acc2 = await seedLinkedInAccount(org.orgId, member.userId, `acc_${rand()}`, 'OK');
  const profileId = `ACoAAE2ERP${rand()}${rand()}`;
  await setMockMode(acc1, { routes: replyRoutes(acc1, profileId, minutesFromNow(-60)) });
  const m1 = await seedMission(org.orgId, org.owner.userId, { name: `Mission M1 ${rand()}` });
  const m2 = await seedMission(org.orgId, org.owner.userId, { name: `Mission M2 ${rand()}` });
  const main = await followUpEnrollment(org, org.owner.userId, acc1, profileId, m1);
  const jcsM1 = await seedJcs(org.orgId, org.owner.userId, m1, profileId, 'messaged', null);
  const jcsM2 = await seedJcs(org.orgId, org.owner.userId, m2, profileId, 'messaged', 'Contacté');
  const s2 = await messageSequence(org, member.userId, ['Autre compte'], 2);
  const { enrollmentId: e2 } = await enroll(org, s2.sequenceId, member.userId, acc2, { profile_id: profileId });
  const e2Exec = await schedule(org, e2, s2.steps[0], { scheduled_at: minutesFromNow(24 * 60) });
  const step1Exec = await schedule(org, main.enrollmentId, main.steps[1], {
    scheduled_at: path === 'pre_send' ? minutesFromNow(-1) : minutesFromNow(24 * 60),
  });
  return {
    org, member, acc1, acc2, profileId, m1, m2,
    s1: { sequenceId: main.sequenceId, steps: main.steps }, e1: main.enrollmentId, step1Exec,
    jcsM1, jcsM2, e2, e2Exec,
  };
}

// ─── Déclencheurs ───────────────────────────────────────────────────────────

/** Réponse LinkedIn reçue par webhook (format message_received). Renvoie le statut HTTP. */
async function replyWebhook(accountId: string, profileId: string) {
  return postJson('/functions/v1/unipile-webhook', {
    event: 'message_received',
    account_id: accountId,
    account_type: 'LINKEDIN',
    chat_id: `chat_${rand()}`,
    message_id: `msg_${rand()}${rand()}`,
    message: 'Bonjour, oui avec plaisir',
    sender: { attendee_provider_id: profileId, attendee_id: 'att_candidate', attendee_name: 'Camille Martin' },
  }, { 'unipile-auth': WEBHOOK_SECRET });
}

async function tokenOf(user: TestUser) {
  return (await signIn(user.email, user.password)).access_token;
}

async function markReplied(org: TestOrg, enrollmentId: string, token?: string) {
  return callFunction('process-sequences', token ?? await tokenOf(org.owner), {
    action: 'mark_replied', enrollment_id: enrollmentId, organization_id: org.orgId,
  });
}

/**
 * check_replies ne regarde que 20 inscriptions par passage (les moins
 * récemment contrôlées d'abord) et se limite à un passage toutes les 4 h : la
 * marque est effacée avant chaque appel, jusqu'à ce que nos inscriptions aient
 * été examinées. Renvoie le total des réponses détectées.
 */
async function checkRepliesUntilExamined(...enrollmentIds: string[]) {
  const totals = { repliesDetected: 0, checkFailed: 0 };
  try {
    for (let i = 0; i < 8; i++) {
      await admin().from('internal_config').delete().eq('key', 'last_check_replies');
      const res = await runEngine({ action: 'check_replies' });
      totals.repliesDetected += Number(res.repliesDetected ?? 0);
      totals.checkFailed += Number(res.checkFailed ?? 0);
      const { data } = await admin().from('sequence_enrollments').select('id, last_check_at').in('id', enrollmentIds);
      if (((data ?? []) as Array<{ last_check_at: string | null }>).every((r) => !!r.last_check_at)) break;
    }
  } finally {
    await admin().from('internal_config').delete().eq('key', 'last_check_replies');
  }
  return totals;
}

/** Cycles jusqu'à ce que chaque exécution donnée ne soit plus due (cinq au plus). */
async function cycleFor(...execIds: string[]) {
  for (let i = 0; i < 5; i++) {
    await runCycle();
    const { data } = await admin().from('sequence_step_executions').select('id, status, scheduled_at').in('id', execIds);
    const pending = ((data ?? []) as Array<{ status: string; scheduled_at: string }>)
      .filter((r) => r.status === 'scheduled' && new Date(r.scheduled_at).getTime() <= Date.now());
    if (pending.length === 0) return;
  }
}

/** Fait voir la réponse de `profileId` sur `acc1` par le chemin demandé. */
async function trigger(path: Path, w: { org: TestOrg; acc1: string; profileId: string; e1: string; step1Exec: string }) {
  switch (path) {
    case 'webhook': {
      const res = await replyWebhook(w.acc1, w.profileId);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body;
    }
    case 'check_replies':
      return checkRepliesUntilExamined(w.e1);
    case 'pre_send':
      await cycleFor(w.step1Exec);
      return {};
    case 'mark_replied': {
      const res = await markReplied(w.org, w.e1);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Équivalence des quatre chemins
// ═══════════════════════════════════════════════════════════════════════════

test.describe('@critical Une réponse, quatre chemins, un seul état final', () => {
  for (const path of PATHS) {
    // equivalence-etat-final-quatre-chemins
    isolated('equivalence-etat-final-quatre-chemins', `@critical réponse vue par ${PATH_LABEL[path]} : inscription close, relance annulée, réponse comptée une fois, pipeline de la mission « Répondu », autre mission inchangée, inscription sœur arrêtée`, async () => {
      const w = await buildWorld(`E2E RP équiv ${path}`, path);
      const m2Before = await jcsRow(w.jcsM2);

      await trigger(path, w);

      const e1 = await enrollmentState(w.e1);
      expect.soft(e1.status, 'inscription « A répondu »').toBe('replied');
      expect.soft(e1.replied_at, 'date de réponse posée').not.toBeNull();
      expect.soft(e1.pause_reason, 'aucune raison de pause').toBeNull();
      expect.soft((await execState(w.step1Exec)).status, 'relance annulée').toBe('cancelled');
      expect.soft(await repliesReceived(w.s1.sequenceId), 'réponse comptée une fois').toBe(1);
      const m1 = await jcsRow(w.jcsM1);
      // DÉFAUT moteur-pipeline-ignore-messaged : check_replies, avant envoi et mark_replied laissent « messaged » (filtre de statut du moteur sans « messaged »).
      expect.soft(m1.status, 'pipeline de la mission M1 : statut « replied »').toBe('replied');
      expect.soft(effectiveStage(m1.pipeline_stage, m1.status), 'kanban de la mission M1 : « Répondu »').toBe('Répondu');
      const m2 = await jcsRow(w.jcsM2);
      // DÉFAUT webhook-pipeline-toutes-missions : le webhook passe « Répondu » toutes les missions de l'organisation (filtre sans job_id).
      expect.soft({ status: m2.status, pipeline_stage: m2.pipeline_stage, updated_at: m2.updated_at }, 'mission M2 (pas celle de l’inscription) inchangée')
        .toEqual({ status: m2Before.status, pipeline_stage: m2Before.pipeline_stage, updated_at: m2Before.updated_at });
      expect.soft((await enrollmentState(w.e2)).status, 'même candidat sur un autre compte : arrêté').toBe('stopped');
      expect.soft((await execState(w.e2Exec)).status, 'étape de l’inscription sœur annulée').toBe('cancelled');
      expect(await sendsOf(w.acc1), 'aucun envoi après la réponse').toEqual([]);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Une autre organisation n'est jamais touchée
// ═══════════════════════════════════════════════════════════════════════════

test.describe('@critical Réponse : aucune écriture dans une autre organisation', () => {
  for (const path of PATHS) {
    // autre-organisation-jamais-touchee
    isolated('autre-organisation-jamais-touchee', `@critical réponse vue par ${PATH_LABEL[path]} dans A : inscription, étapes, pipeline et compteur de B (même candidat) inchangés`, async () => {
      const w = await buildWorld(`E2E RP autre-org ${path}`, path);
      const { org: orgB, accountId: accB } = await sendingOrg(`E2E RP autre-org B ${path}`);
      track(orgB);
      const mB = await seedMission(orgB.orgId, orgB.owner.userId);
      const b = await followUpEnrollment(orgB, orgB.owner.userId, accB, w.profileId, mB);
      const jcsB = await seedJcs(orgB.orgId, orgB.owner.userId, mB, w.profileId, 'messaged', 'Contacté');
      const bExec = await schedule(orgB, b.enrollmentId, b.steps[1], { scheduled_at: minutesFromNow(24 * 60) });
      const before = {
        enrollment: (await enrollmentState(b.enrollmentId)).status,
        exec: await execState(bExec),
        jcs: await jcsRow(jcsB),
        replies: await repliesReceived(b.sequenceId),
      };

      await trigger(path, w);

      expect((await enrollmentState(w.e1)).status, 'la réponse est bien vue dans A').toBe('replied');
      const after = {
        enrollment: (await enrollmentState(b.enrollmentId)).status,
        exec: await execState(bExec),
        jcs: await jcsRow(jcsB),
        replies: await repliesReceived(b.sequenceId),
      };
      expect(after, 'organisation B inchangée').toEqual(before);
      expect(await sendsOf(accB), 'aucun envoi depuis B').toEqual([]);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Inscriptions sœurs (autre compte de l'organisation)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Réponse : autres inscriptions du candidat arrêtées sur tous les chemins (SEQ-212)', () => {
  for (const path of PATHS) {
    // soeurs-autre-compte-arretees-tous-chemins
    isolated('soeurs-autre-compte-arretees-tous-chemins', `réponse vue par ${PATH_LABEL[path]} : inscription active (rattachée par provider_id) et inscription en pause (par resolved_profile_id) du même candidat sur un autre compte arrêtées, étapes annulées`, async () => {
      const { org, accountId: acc1 } = await sendingOrg(`E2E RP sœurs ${path}`);
      const member = await addMember(org.orgId, 'member', 'membre');
      track(org, [member]);
      const acc2 = await seedLinkedInAccount(org.orgId, member.userId, `acc_${rand()}`, 'OK');
      const profileId = `ACoAAE2ERS${rand()}${rand()}`;
      await setMockMode(acc1, { routes: replyRoutes(acc1, profileId, minutesFromNow(-60)) });
      const main = await followUpEnrollment(org, org.owner.userId, acc1, profileId, null);
      // E2 : identifiant Recruiter en profile_id, identifiant classique en provider_id.
      const s2 = await messageSequence(org, member.userId, ['Autre compte actif'], 2);
      const { enrollmentId: e2 } = await enroll(org, s2.sequenceId, member.userId, acc2, {
        profile_id: `AEMAAE2E${rand()}${rand()}`, provider_id: profileId,
      });
      const e2Exec = await schedule(org, e2, s2.steps[0], { scheduled_at: minutesFromNow(24 * 60) });
      // E3 : en pause, rattachée par resolved_profile_id ; son étape garde sa date pendant la pause.
      const s3 = await messageSequence(org, member.userId, ['Autre compte en pause'], 2);
      const { enrollmentId: e3 } = await enroll(org, s3.sequenceId, member.userId, acc2, {
        profile_id: `e2e-slug-${rand()}`, resolved_profile_id: profileId, status: 'paused', pause_reason: 'manual',
      });
      const e3Exec = await schedule(org, e3, s3.steps[0], { scheduled_at: minutesFromNow(24 * 60) });
      const step1Exec = await schedule(org, main.enrollmentId, main.steps[1], {
        scheduled_at: path === 'pre_send' ? minutesFromNow(-1) : minutesFromNow(24 * 60),
      });

      const body = await trigger(path, { org, acc1, profileId, e1: main.enrollmentId, step1Exec });

      expect((await enrollmentState(main.enrollmentId)).status, 'inscription qui a reçu la réponse close').toBe('replied');
      for (const [label, enrollmentId, execId] of [['active', e2, e2Exec], ['en pause', e3, e3Exec]] as const) {
        const row = await enrollmentState(enrollmentId);
        expect.soft(row.status, `inscription sœur ${label} arrêtée`).toBe('stopped');
        expect.soft(row.completed_at, `inscription sœur ${label} : date de fin posée`).not.toBeNull();
        expect.soft(row.pause_reason, `inscription sœur ${label} : plus de raison de pause`).toBeNull();
        const exec = await execState(execId);
        expect.soft(exec.status, `étape de l’inscription sœur ${label} annulée`).toBe('cancelled');
        expect.soft(exec.skip_reason, `motif de l’annulation (${label})`).toBe(SIBLING_REPLY);
      }
      if (path === 'mark_replied') {
        expect.soft((body as Record<string, unknown>).stopped_siblings, 'bilan annoncé à l’interface').toBe(2);
      }
      expect(await sendsOf(acc1)).toEqual([]);
      expect(await sendsOf(acc2)).toEqual([]);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Chemins du moteur
// ═══════════════════════════════════════════════════════════════════════════

test.describe('@critical Chemins du moteur', () => {
  // pre-envoi-reponse-rien-ne-part
  isolated('pre-envoi-reponse-rien-ne-part', '@critical vérification avant envoi qui trouve une réponse : la relance ne part pas, inscription « replied », relance annulée avec son motif, réponse comptée, pipeline de la mission « Répondu »', async () => {
    const w = await buildWorld('E2E RP pré-envoi', 'pre_send');

    await cycleFor(w.step1Exec);

    expect(await sendsOf(w.acc1), 'aucune relance partie').toEqual([]);
    const checked = (await mockCalls(w.acc1)).filter((c) => c.method === 'GET' && c.path === `/api/v1/chat_attendees/${w.profileId}/chats`);
    expect(checked.length, 'la vérification de réponse a bien interrogé le fil').toBeGreaterThan(0);
    expect((await enrollmentState(w.e1)).status).toBe('replied');
    const exec = await execState(w.step1Exec);
    expect.soft(exec.status, 'relance annulée').toBe('cancelled');
    expect.soft(exec.skip_reason).toBe(PRE_SEND_REASON);
    expect.soft(await repliesReceived(w.s1.sequenceId), 'réponse comptée une fois').toBe(1);
    const m1 = await jcsRow(w.jcsM1);
    // DÉFAUT moteur-pipeline-ignore-messaged : la ligne « messaged » écrite à l'inscription n'est pas mise à jour.
    expect.soft(m1.status, 'pipeline de la mission : « replied » (candidat inscrit, donc « messaged »)').toBe('replied');
    expect.soft(effectiveStage(m1.pipeline_stage, m1.status), 'kanban de la mission : « Répondu »').toBe('Répondu');
  });

  // check-replies-reponse-cloture
  isolated('check-replies-reponse-cloture', 'check_replies : réponse postérieure au dernier envoi, inscription close sans envoi et comptée une fois ; message antérieur au dernier envoi, inscription laissée active', async () => {
    const replied = await sendingOrg('E2E RP check_replies réponse');
    track(replied.org);
    const quiet = await sendingOrg('E2E RP check_replies sans réponse');
    track(quiet.org);
    const pReplied = `ACoAAE2ERC${rand()}${rand()}`;
    const pQuiet = `ACoAAE2ERQ${rand()}${rand()}`;
    // Réponse une heure avant maintenant (dernier envoi il y a deux jours) ;
    // contre-cas : message du candidat trois jours avant, donc avant le dernier envoi.
    await setMockMode(replied.accountId, { routes: replyRoutes(replied.accountId, pReplied, minutesFromNow(-60)) });
    await setMockMode(quiet.accountId, { routes: replyRoutes(quiet.accountId, pQuiet, minutesFromNow(-3 * 24 * 60)) });
    const a = await followUpEnrollment(replied.org, replied.org.owner.userId, replied.accountId, pReplied, null);
    const aExec = await schedule(replied.org, a.enrollmentId, a.steps[1], { scheduled_at: minutesFromNow(24 * 60) });
    const q = await followUpEnrollment(quiet.org, quiet.org.owner.userId, quiet.accountId, pQuiet, null);
    const qExec = await schedule(quiet.org, q.enrollmentId, q.steps[1], { scheduled_at: minutesFromNow(24 * 60) });

    const totals = await checkRepliesUntilExamined(a.enrollmentId, q.enrollmentId);

    expect(totals.repliesDetected, 'réponse détectée').toBeGreaterThanOrEqual(1);
    const ra = await enrollmentState(a.enrollmentId);
    expect(ra.status).toBe('replied');
    expect(ra.replied_at).not.toBeNull();
    expect(ra.last_check_at, 'marque de rotation posée').not.toBeNull();
    expect((await execState(aExec)).status, 'étape en attente annulée').toBe('cancelled');
    expect(await repliesReceived(a.sequenceId), 'réponse comptée une fois').toBe(1);
    expect(await sendsOf(replied.accountId), 'aucun envoi').toEqual([]);

    const rq = await enrollmentState(q.enrollmentId);
    expect(rq.status, 'message antérieur au dernier envoi : pas une réponse').toBe('active');
    expect(rq.last_check_at, 'inscription examinée').not.toBeNull();
    expect((await execState(qExec)).status, 'relance gardée').toBe('scheduled');
    expect(await repliesReceived(q.sequenceId)).toBe(0);
    expect(await sendsOf(quiet.accountId)).toEqual([]);
  });

  // moteur-statut-messaged-passe-replied
  isolated('moteur-statut-messaged-passe-replied', 'réponse détectée par le moteur (« Marquer comme répondu », check_replies, avant envoi, étape d’attente) : le candidat inscrit (« messaged ») passe « replied » dans le pipeline de la mission', async () => {
    const results: Record<string, { status: string; stage: string; enrollment: string }> = {};
    const runs: Array<{ label: string; build: () => Promise<{ jcs: string; enrollmentId: string }> }> = [
      {
        label: 'mark_replied',
        build: async () => {
          const { org, accountId } = await sendingOrg('E2E RP messaged mark');
          track(org);
          const p = `ACoAAE2ERM${rand()}${rand()}`;
          const m = await seedMission(org.orgId, org.owner.userId);
          const e = await followUpEnrollment(org, org.owner.userId, accountId, p, m);
          await schedule(org, e.enrollmentId, e.steps[1], { scheduled_at: minutesFromNow(24 * 60) });
          const jcs = await seedJcs(org.orgId, org.owner.userId, m, p);
          const res = await markReplied(org, e.enrollmentId);
          expect(res.status, JSON.stringify(res.body)).toBe(200);
          return { jcs, enrollmentId: e.enrollmentId };
        },
      },
      {
        label: 'check_replies',
        build: async () => {
          const { org, accountId } = await sendingOrg('E2E RP messaged check');
          track(org);
          const p = `ACoAAE2ERM${rand()}${rand()}`;
          await setMockMode(accountId, { routes: replyRoutes(accountId, p, minutesFromNow(-60)) });
          const m = await seedMission(org.orgId, org.owner.userId);
          const e = await followUpEnrollment(org, org.owner.userId, accountId, p, m);
          await schedule(org, e.enrollmentId, e.steps[1], { scheduled_at: minutesFromNow(24 * 60) });
          const jcs = await seedJcs(org.orgId, org.owner.userId, m, p);
          await checkRepliesUntilExamined(e.enrollmentId);
          return { jcs, enrollmentId: e.enrollmentId };
        },
      },
      {
        label: 'avant envoi',
        build: async () => {
          const { org, accountId } = await sendingOrg('E2E RP messaged pré-envoi');
          track(org);
          const p = `ACoAAE2ERM${rand()}${rand()}`;
          await setMockMode(accountId, { routes: replyRoutes(accountId, p, minutesFromNow(-60)) });
          const m = await seedMission(org.orgId, org.owner.userId);
          const e = await followUpEnrollment(org, org.owner.userId, accountId, p, m);
          const jcs = await seedJcs(org.orgId, org.owner.userId, m, p);
          const exec = await schedule(org, e.enrollmentId, e.steps[1]);
          await cycleFor(exec);
          return { jcs, enrollmentId: e.enrollmentId };
        },
      },
      {
        label: 'étape d’attente de réponse',
        build: async () => {
          const { org, accountId } = await sendingOrg('E2E RP messaged attente');
          track(org);
          const p = `ACoAAE2ERM${rand()}${rand()}`;
          await setMockMode(accountId, { routes: replyRoutes(accountId, p, minutesFromNow(-60)) });
          const m = await seedMission(org.orgId, org.owner.userId);
          const seq = await seedSequence(org.orgId, org.owner.userId, [{ action_type: 'message' }, { action_type: 'wait_reply', delay_days: 1 }]);
          await admin().from('outreach_sequences').update({ project_id: m }).eq('id', seq.sequenceId);
          const { enrollmentId } = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { profile_id: p, job_id: m, current_step_order: 1 });
          const sentAt = TWO_DAYS_AGO();
          await schedule(org, enrollmentId, seq.steps[0], { status: 'sent', scheduled_at: sentAt, executed_at: sentAt, final_message: 'Bonjour' });
          const jcs = await seedJcs(org.orgId, org.owner.userId, m, p);
          const exec = await schedule(org, enrollmentId, seq.steps[1]);
          await cycleFor(exec);
          return { jcs, enrollmentId };
        },
      },
    ];
    for (const run of runs) {
      const { jcs, enrollmentId } = await run.build();
      const row = await jcsRow(jcs);
      results[run.label] = { status: row.status, stage: effectiveStage(row.pipeline_stage, row.status), enrollment: (await enrollmentState(enrollmentId)).status };
    }
    for (const run of runs) {
      expect(results[run.label].enrollment, `${run.label} : la réponse est bien vue`).toBe('replied');
    }
    for (const run of runs) {
      // DÉFAUT moteur-pipeline-ignore-messaged : statut « messaged » exclu du filtre du moteur (process-sequences, markCandidateRepliedInPipeline).
      // DÉFAUT attente-reponse-sans-pipeline : l'étape d'attente de réponse du cycle clôt sans reporter la réponse au pipeline.
      expect.soft(results[run.label].status, `${run.label} : statut du pipeline`).toBe('replied');
      expect.soft(results[run.label].stage, `${run.label} : colonne du kanban`).toBe('Répondu');
    }
  });

  // moteur-ecrit-pipeline-stage-repondu
  isolated('moteur-ecrit-pipeline-stage-repondu', 'chemins du moteur : étape de pipeline vide, « Nouveau » ou « Contacté » passe « Répondu » au kanban, comme avec le webhook', async () => {
    const { org, accountId } = await sendingOrg('E2E RP pipeline_stage');
    track(org);
    const mission = await seedMission(org.orgId, org.owner.userId);
    const observed: Record<string, { stage: string; status: string }> = {};
    // « Marquer comme répondu » : statut « scored » (dans le filtre du moteur), trois étapes de départ.
    for (const stage of [null, 'Nouveau', 'Contacté'] as const) {
      const p = `ACoAAE2ERK${rand()}${rand()}`;
      const e = await followUpEnrollment(org, org.owner.userId, accountId, p, mission);
      await schedule(org, e.enrollmentId, e.steps[1], { scheduled_at: minutesFromNow(24 * 60) });
      const jcs = await seedJcs(org.orgId, org.owner.userId, mission, p, 'scored', stage);
      const res = await markReplied(org, e.enrollmentId);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const row = await jcsRow(jcs);
      observed[`mark_replied depuis ${stage ?? 'vide'}`] = { stage: effectiveStage(row.pipeline_stage, row.status), status: row.status };
    }
    // check_replies, étape « Contacté ».
    {
      const other = await sendingOrg('E2E RP pipeline_stage check');
      track(other.org);
      const p = `ACoAAE2ERK${rand()}${rand()}`;
      await setMockMode(other.accountId, { routes: replyRoutes(other.accountId, p, minutesFromNow(-60)) });
      const m = await seedMission(other.org.orgId, other.org.owner.userId);
      const e = await followUpEnrollment(other.org, other.org.owner.userId, other.accountId, p, m);
      await schedule(other.org, e.enrollmentId, e.steps[1], { scheduled_at: minutesFromNow(24 * 60) });
      const jcs = await seedJcs(other.org.orgId, other.org.owner.userId, m, p, 'scored', 'Contacté');
      await checkRepliesUntilExamined(e.enrollmentId);
      expect((await enrollmentState(e.enrollmentId)).status).toBe('replied');
      const row = await jcsRow(jcs);
      observed['check_replies depuis Contacté'] = { stage: effectiveStage(row.pipeline_stage, row.status), status: row.status };
    }
    // Étape d'attente de réponse dans le cycle, étape « Contacté ».
    {
      const other = await sendingOrg('E2E RP pipeline_stage attente');
      track(other.org);
      const p = `ACoAAE2ERK${rand()}${rand()}`;
      await setMockMode(other.accountId, { routes: replyRoutes(other.accountId, p, minutesFromNow(-60)) });
      const m = await seedMission(other.org.orgId, other.org.owner.userId);
      const seq = await seedSequence(other.org.orgId, other.org.owner.userId, [{ action_type: 'message' }, { action_type: 'wait_reply', delay_days: 1 }]);
      const { enrollmentId } = await enroll(other.org, seq.sequenceId, other.org.owner.userId, other.accountId, { profile_id: p, job_id: m, current_step_order: 1 });
      const sentAt = TWO_DAYS_AGO();
      await schedule(other.org, enrollmentId, seq.steps[0], { status: 'sent', scheduled_at: sentAt, executed_at: sentAt, final_message: 'Bonjour' });
      const jcs = await seedJcs(other.org.orgId, other.org.owner.userId, m, p, 'scored', 'Contacté');
      const exec = await schedule(other.org, enrollmentId, seq.steps[1]);
      await cycleFor(exec);
      expect((await enrollmentState(enrollmentId)).status).toBe('replied');
      const row = await jcsRow(jcs);
      observed['étape d’attente depuis Contacté'] = { stage: effectiveStage(row.pipeline_stage, row.status), status: row.status };
    }
    for (const [label, row] of Object.entries(observed)) {
      // DÉFAUT attente-reponse-sans-pipeline : l'étape d'attente laisse le statut « scored » (aucun report au pipeline).
      expect.soft(row.status, `${label} : statut du pipeline`).toBe('replied');
      // DÉFAUT moteur-pipeline-stage-non-ecrit : le moteur n'écrit que le statut, l'étape « Nouveau » ou « Contacté » reste affichée.
      expect.soft(row.stage, `${label} : colonne du kanban`).toBe('Répondu');
    }
  });

  // condition-si-pas-de-reponse-clot-replied
  isolated('condition-si-pas-de-reponse-clot-replied', 'condition « Si pas de réponse » fausse parce que le candidat a répondu (dernière étape) : inscription « replied », réponse comptée, autre inscription du candidat arrêtée, rien ne part', async () => {
    const { org, accountId } = await sendingOrg('E2E RP si pas de réponse');
    const member = await addMember(org.orgId, 'member', 'membre');
    track(org, [member]);
    const acc2 = await seedLinkedInAccount(org.orgId, member.userId, `acc_${rand()}`, 'OK');
    const profileId = `ACoAAE2ERN${rand()}${rand()}`;
    await setMockMode(accountId, { routes: replyRoutes(accountId, profileId, minutesFromNow(-60)) });
    const seq = await seedSequence(org.orgId, org.owner.userId, [
      { action_type: 'message' },
      { action_type: 'message', condition_type: 'if_no_response', delay_days: 2 },
    ]);
    await admin().from('sequence_steps').update({ message_template: 'Relance sans réponse' }).eq('id', seq.steps[1].id);
    const { enrollmentId } = await enroll(org, seq.sequenceId, org.owner.userId, accountId, { profile_id: profileId, current_step_order: 1 });
    const sentAt = TWO_DAYS_AGO();
    await schedule(org, enrollmentId, seq.steps[0], { status: 'sent', scheduled_at: sentAt, executed_at: sentAt, final_message: 'Bonjour' });
    const s2 = await messageSequence(org, member.userId, ['Autre compte'], 2);
    const { enrollmentId: e2 } = await enroll(org, s2.sequenceId, member.userId, acc2, { profile_id: profileId });
    await schedule(org, e2, s2.steps[0], { scheduled_at: minutesFromNow(24 * 60) });
    const exec = await schedule(org, enrollmentId, seq.steps[1]);

    await cycleFor(exec);

    expect(await sendsOf(accountId), 'la relance conditionnelle ne part pas').toEqual([]);
    const checked = (await mockCalls(accountId)).filter((c) => c.method === 'GET' && c.path === `/api/v1/chat_attendees/${profileId}/chats`);
    expect(checked.length, 'la condition a bien interrogé le fil').toBeGreaterThan(0);
    const row = await enrollmentState(enrollmentId);
    // Relevé (sortie du test) : état de l'étape conditionnelle.
    console.log('[si-pas-de-reponse] étape conditionnelle :', JSON.stringify(await execState(exec)), '| inscription :', JSON.stringify(row));
    // DÉFAUT si-pas-de-reponse-termine-sans-clore : étape sautée « Condition: if_no_response », inscription « completed », réponse non comptée, autre inscription laissée active.
    expect.soft(row.status, 'inscription close « A répondu »').toBe('replied');
    expect.soft(await repliesReceived(seq.sequenceId), 'réponse comptée').toBe(1);
    expect.soft((await enrollmentState(e2)).status, 'même candidat sur un autre compte : arrêté (SEQ-212)').toBe('stopped');
    expect(await sendsOf(acc2)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Webhook : pipeline borné à la mission
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Webhook de réponse : pipeline borné à la mission de l’inscription', () => {
  // webhook-pipeline-borne-a-la-mission
  isolated('webhook-pipeline-borne-a-la-mission', 'réponse LinkedIn par webhook : « Répondu » dans la mission de l’inscription seulement, les deux autres missions du candidat inchangées', async () => {
    const { org, accountId } = await sendingOrg('E2E RP webhook missions');
    track(org);
    const profileId = `ACoAAE2ERW${rand()}${rand()}`;
    const [m1, m2, m3] = [
      await seedMission(org.orgId, org.owner.userId),
      await seedMission(org.orgId, org.owner.userId),
      await seedMission(org.orgId, org.owner.userId),
    ];
    const e = await followUpEnrollment(org, org.owner.userId, accountId, profileId, m1);
    await schedule(org, e.enrollmentId, e.steps[1], { scheduled_at: minutesFromNow(24 * 60) });
    const j1 = await seedJcs(org.orgId, org.owner.userId, m1, profileId, 'messaged', null);
    const j2 = await seedJcs(org.orgId, org.owner.userId, m2, profileId, 'messaged', 'Contacté');
    const j3 = await seedJcs(org.orgId, org.owner.userId, m3, profileId, 'scored', null);
    const before2 = await jcsRow(j2);
    const before3 = await jcsRow(j3);

    const res = await replyWebhook(accountId, profileId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expect((await enrollmentState(e.enrollmentId)).status).toBe('replied');
    const r1 = await jcsRow(j1);
    expect(r1.status).toBe('replied');
    expect(effectiveStage(r1.pipeline_stage, r1.status)).toBe('Répondu');
    // DÉFAUT webhook-pipeline-toutes-missions : M2 et M3 passent « replied » / « Répondu ».
    expect.soft(await jcsRow(j2), 'mission M2 inchangée').toEqual(before2);
    expect.soft(await jcsRow(j3), 'mission M3 inchangée').toEqual(before3);
  });

  // webhook-email-pipeline-borne-a-la-mission
  isolated('webhook-email-pipeline-borne-a-la-mission', 'réponse par e-mail (mail_received) : inscription close, « Répondu » dans la mission de l’inscription seulement', async () => {
    const { org, accountId } = await sendingOrg('E2E RP e-mail');
    track(org);
    const mailbox = `mail_${rand()}${rand()}`;
    const { error: mbErr } = await admin().from('member_email_accounts').insert({
      organization_id: org.orgId, user_id: org.owner.userId, linked_by: org.owner.userId,
      email_account_id: mailbox, email_address: 'recruteur@e2e.konekt.test', provider: 'GOOGLE',
    });
    if (mbErr) throw new Error(`member_email_accounts: ${mbErr.message}`);
    const profileId = `ACoAAE2ERE${rand()}${rand()}`;
    const email = `cand-${rand()}@e2e.konekt.test`;
    const m1 = await seedMission(org.orgId, org.owner.userId);
    const m2 = await seedMission(org.orgId, org.owner.userId);
    const e = await followUpEnrollment(org, org.owner.userId, accountId, profileId, m1, { email_used: email });
    const exec = await schedule(org, e.enrollmentId, e.steps[1], { scheduled_at: minutesFromNow(24 * 60) });
    const j1 = await seedJcs(org.orgId, org.owner.userId, m1, profileId, 'messaged', null);
    const j2 = await seedJcs(org.orgId, org.owner.userId, m2, profileId, 'messaged', 'Contacté');
    const before2 = await jcsRow(j2);

    const res = await postJson('/functions/v1/unipile-webhook', {
      event: 'mail_received',
      account_id: mailbox,
      email_id: `email_${rand()}${rand()}`,
      subject: 'Re: poste de développeur',
      from_attendee: { identifier: email, display_name: 'Camille Martin' },
      to_attendees: [{ identifier: 'recruteur@e2e.konekt.test', display_name: 'Recruteur' }],
    }, { 'unipile-auth': WEBHOOK_SECRET });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expect((await enrollmentState(e.enrollmentId)).status, 'inscription close').toBe('replied');
    expect((await execState(exec)).status, 'relance annulée').toBe('cancelled');
    expect(await repliesReceived(e.sequenceId)).toBe(1);
    const r1 = await jcsRow(j1);
    expect(r1.status).toBe('replied');
    expect(effectiveStage(r1.pipeline_stage, r1.status), 'mission de l’inscription : « Répondu » (SEQ-211)').toBe('Répondu');
    // DÉFAUT webhook-pipeline-toutes-missions : même filtre sans mission sur le chemin e-mail.
    expect.soft(await jcsRow(j2), 'autre mission inchangée').toEqual(before2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Course webhook / moteur
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Webhook et moteur voient la même réponse', () => {
  // course-webhook-moteur-meme-etat
  isolated('course-webhook-moteur-meme-etat', '« Marquer comme répondu » puis webhook, ou webhook puis « Marquer comme répondu » : même état final (pipeline, compteur, inscription sœur)', async () => {
    const snapshot = async (w: World) => {
      const m1 = await jcsRow(w.jcsM1);
      const m2 = await jcsRow(w.jcsM2);
      return {
        enrollment: (await enrollmentState(w.e1)).status,
        replies: await repliesReceived(w.s1.sequenceId),
        m1: { status: m1.status, stage: effectiveStage(m1.pipeline_stage, m1.status) },
        m2: { status: m2.status, stage: effectiveStage(m2.pipeline_stage, m2.status) },
        sibling: (await enrollmentState(w.e2)).status,
      };
    };
    // Ordre 1 : le moteur d'abord.
    const w1 = await buildWorld('E2E RP course moteur-webhook', 'mark_replied');
    const r1a = await markReplied(w1.org, w1.e1);
    expect(r1a.status, JSON.stringify(r1a.body)).toBe(200);
    const r1b = await replyWebhook(w1.acc1, w1.profileId);
    expect(r1b.status, JSON.stringify(r1b.body)).toBe(200);
    const s1 = await snapshot(w1);
    // Ordre 2 : le webhook d'abord.
    const w2 = await buildWorld('E2E RP course webhook-moteur', 'mark_replied');
    const r2a = await replyWebhook(w2.acc1, w2.profileId);
    expect(r2a.status, JSON.stringify(r2a.body)).toBe(200);
    const r2b = await markReplied(w2.org, w2.e1);
    expect(r2b.status, JSON.stringify(r2b.body)).toBe(200);
    const s2 = await snapshot(w2);

    const expected = {
      enrollment: 'replied',
      replies: 1,
      m1: { status: 'replied', stage: 'Répondu' },
      m2: { status: 'messaged', stage: 'Contacté' },
      sibling: 'stopped',
    };
    // DÉFAUT moteur-pipeline-ignore-messaged + webhook-pipeline-toutes-missions : l'état du pipeline dépend de l'ordre d'arrivée.
    expect.soft(s1, 'moteur puis webhook : même état que webhook puis moteur').toEqual(s2);
    expect.soft(s1, 'moteur puis webhook : état attendu').toEqual(expected);
    expect.soft(s2, 'webhook puis moteur : état attendu').toEqual(expected);
  });

  // course-webhook-moteur-meme-etat (variante concurrente, SEQ-191)
  isolated('course-webhook-moteur-meme-etat', 'webhook et « Marquer comme répondu » en même temps sur six candidats : chaque réponse comptée exactement une fois', async () => {
    const { org, accountId } = await sendingOrg('E2E RP course concurrente');
    track(org);
    const token = await tokenOf(org.owner);
    const cases: Array<{ enrollmentId: string; sequenceId: string; profileId: string }> = [];
    for (let i = 0; i < 6; i++) {
      const profileId = `ACoAAE2ERX${rand()}${rand()}`;
      const e = await followUpEnrollment(org, org.owner.userId, accountId, profileId, null);
      await schedule(org, e.enrollmentId, e.steps[1], { scheduled_at: minutesFromNow(24 * 60) });
      cases.push({ enrollmentId: e.enrollmentId, sequenceId: e.sequenceId, profileId });
    }

    const statuses = await Promise.all(cases.map(async (c) => {
      const [hook, mark] = await Promise.all([replyWebhook(accountId, c.profileId), markReplied(org, c.enrollmentId, token)]);
      return { hook: hook.status, mark: mark.status };
    }));

    expect(statuses.every((s) => s.mark === 200), JSON.stringify(statuses)).toBe(true);
    for (const c of cases) {
      expect((await enrollmentState(c.enrollmentId)).status).toBe('replied');
      expect(await repliesReceived(c.sequenceId), 'réponse comptée une seule fois').toBe(1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// « Marquer comme répondu » refusé
// ═══════════════════════════════════════════════════════════════════════════

test.describe('« Marquer comme répondu » refusé', () => {
  // mark-replied-refus-sans-effet
  isolated('mark-replied-refus-sans-effet', 'refusé (collaborateur sur l’inscription d’un autre, autre organisation, identifiant invalide, sans jeton) : aucun effet de bord', async () => {
    const { org, accountId } = await sendingOrg('E2E RP refus');
    const collaborator = await addMember(org.orgId, 'collaborator', 'collab');
    track(org, [collaborator]);
    const orgB = await createOrg('agency', 'E2E RP refus B');
    track(orgB);
    const profileId = `ACoAAE2ERR${rand()}${rand()}`;
    const mission = await seedMission(org.orgId, org.owner.userId);
    const e = await followUpEnrollment(org, org.owner.userId, accountId, profileId, mission);
    const sib = await messageSequence(org, org.owner.userId, ['Autre séquence'], 2);
    const { enrollmentId: sibling } = await enroll(org, sib.sequenceId, org.owner.userId, accountId, { profile_id: profileId });
    const siblingExec = await schedule(org, sibling, sib.steps[0], { scheduled_at: minutesFromNow(24 * 60) });
    const jcs = await seedJcs(org.orgId, org.owner.userId, mission, profileId);
    const exec = await schedule(org, e.enrollmentId, e.steps[1], { scheduled_at: minutesFromNow(24 * 60) });
    const snapshot = async () => ({
      enrollment: await enrollmentState(e.enrollmentId),
      exec: await execState(exec),
      sibling: (await enrollmentState(sibling)).status,
      siblingExec: await execState(siblingExec),
      jcs: await jcsRow(jcs),
      replies: await repliesReceived(e.sequenceId),
    });
    const before = await snapshot();

    const collabToken = await tokenOf(collaborator);
    const ownerBToken = await tokenOf(orgB.owner);
    const ownerAToken = await tokenOf(org.owner);
    const call = (token: string, body: Record<string, unknown>) => callFunction('process-sequences', token, { action: 'mark_replied', ...body });

    const collab = await call(collabToken, { enrollment_id: e.enrollmentId, organization_id: org.orgId });
    expect(collab.status, JSON.stringify(collab.body)).toBe(403);
    const foreignOwnOrg = await call(ownerBToken, { enrollment_id: e.enrollmentId, organization_id: orgB.orgId });
    expect(foreignOwnOrg.status, JSON.stringify(foreignOwnOrg.body)).toBe(404);
    const foreignNoOrg = await call(ownerBToken, { enrollment_id: e.enrollmentId });
    expect(foreignNoOrg.status, JSON.stringify(foreignNoOrg.body)).toBe(404);
    // Organisation A demandée par un non-membre : refus d'appartenance (403) ou introuvable (404).
    const foreignOrgA = await call(ownerBToken, { enrollment_id: e.enrollmentId, organization_id: org.orgId });
    expect([403, 404], JSON.stringify(foreignOrgA.body)).toContain(foreignOrgA.status);
    const invalid = await call(ownerAToken, { enrollment_id: 'x', organization_id: org.orgId });
    expect(invalid.status, JSON.stringify(invalid.body)).toBe(404);
    const anonymous = await postJson('/functions/v1/process-sequences', { action: 'mark_replied', enrollment_id: e.enrollmentId, organization_id: org.orgId });
    expect(anonymous.status).toBe(401);

    expect(await snapshot(), 'aucun effet de bord').toEqual(before);
  });
});
