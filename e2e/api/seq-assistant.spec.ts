/**
 * Lot « assistant » du module séquences : outils de l'assistant IA qui lisent
 * la prospection (get_sequences_status, get_candidate_outreach), créent une
 * séquence (create_sequence), inscrivent (enroll_in_sequence) ou écrivent un
 * message LinkedIn ponctuel (send_linkedin_message).
 *
 * Harnais, faute d'IA scriptable (search-agent-chat lit un flux SSE que le
 * faux prestataire ne produit pas) :
 * - approbation : ligne agent_tool_executions « proposed » insérée en clé de
 *   service, puis POST agent-tool-action { approve } avec le JWT du membre,
 *   comme le bouton « Approuver » du bandeau ;
 * - lecture : ligne « approved » échue, puis POST process-scheduled-actions
 *   avec le secret du cron (ce chemin enregistre aussi les outils de lecture et
 *   rejoue verifyAccess avant l'exécution).
 *
 * Dimanche : checkLinkedInQuota refuse tout envoi le samedi et le dimanche
 * dans le fuseau du membre, sans option de forçage. Les tests d'envoi posent
 * donc une plage 0 h-24 h dans un fuseau où l'on est un jour ouvré
 * (Pacific/Kiritimati le dimanche après-midi UTC) ; sans fuseau possible ils
 * s'ignorent. Le moteur, lui, tourne avec force: true.
 *
 * Lot 5a (garde-fous d'envoi) : la politique d'autonomie et l'aperçu de la
 * carte d'approbation se jouent dans handleProposedToolCall, que seul le chat
 * appelle. La sonde Deno e2e/helpers/agent-tool-probe.ts l'appelle comme le
 * chat le fait pour un appel d'outil du modèle (proposeLikeChat).
 *
 * Lot 5e : create_sequence rédige la séquence d'une mission sur la forme
 * commune de la rédaction par l'IA (invitation ou InMail, 1 à 3 relances),
 * jamais automatique, textes contrôlés à la proposition et à l'approbation
 * (blocs « create_sequence » et « create_sequence réaligné »). Le modèle de la
 * conversation rédige à partir des seuls faits de get_sequence_draft_facts ;
 * un texte qui reprend la rémunération, un critère d'évaluation, un contact
 * ou une entreprise ciblée du poste est refusé. draft_outreach_message
 * (correctif 3) : client anonymisé sous alias, brouillon qui tutoie refusé.
 *
 * Ignoré sans la stack locale (e2e/local-stack/up.sh).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, expect, request } from '@playwright/test';
import { E2E } from '../helpers/env';
import {
  addMember,
  admin,
  createOrg,
  deleteOrg,
  seedLinkedInAccount,
  seedMission,
  seedSequence,
  signIn,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import {
  CRON_SECRET,
  ENGINE_SKIP_REASON,
  MOCK_URL,
  callFunction,
  engineAvailable,
  enrollmentRow,
  executionsOf,
  messageSequence,
  minutesFromNow,
  mockCalls,
  postJson,
  rand,
  runCycle,
  runEngine,
  sendingOrg,
  sentInvites,
  setMockMode,
  webhook,
  type MockCall,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.setTimeout(240_000);

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const cleanups: Array<() => PromiseLike<unknown>> = [];

test.afterEach(async () => {
  while (cleanups.length) {
    try {
      await cleanups.pop()!();
    } catch {
      // best-effort
    }
  }
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    // Tables sans cascade utile (l'organisation elle-même survit, voir deleteOrg).
    for (const table of [
      'agent_tool_executions',
      'agent_tool_policies',
      'job_candidate_status',
      'inmail_queue',
      'message_analysis_cache',
      'member_quotas',
      'organization_integrations',
    ]) {
      await admin().from(table).delete().eq('organization_id', org.orgId);
    }
    await deleteOrg(org, extra);
  }
});

function track(org: TestOrg, ...extra: TestUser[]) {
  orgsToDelete.push({ org, extra });
}

// ─── Aides ──────────────────────────────────────────────────────────────────

type ToolResult = { success?: boolean; error?: string; data?: Record<string, any> };

async function tokenOf(user: TestUser): Promise<string> {
  return (await signIn(user.email, user.password)).access_token;
}

const newProfileId = () => `ACoAAE2E${rand()}${rand()}`;

/** Ligne « proposée » par l'assistant, telle que search-agent-chat l'écrit. */
async function propose(
  orgId: string,
  userId: string,
  tool: string,
  params: Record<string, unknown>,
  details: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin()
    .from('agent_tool_executions')
    .insert({
      user_id: userId,
      organization_id: orgId,
      tool_name: tool,
      params,
      status: 'proposed',
      dry_run_result: { summary: `Test e2e ${tool}`, details },
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`propose: ${error?.message}`);
  return data.id as string;
}

/** Clic « Approuver » du bandeau. */
function approve(token: string, executionId: string) {
  return callFunction('agent-tool-action', token, { execution_id: executionId, action: 'approve' });
}

interface ExecRow {
  status: string;
  real_result: ToolResult | null;
  scheduled_for: string | null;
  approved_at: string | null;
  executed_at: string | null;
}

async function execRow(id: string): Promise<ExecRow> {
  const { data } = await admin()
    .from('agent_tool_executions')
    .select('status, real_result, scheduled_for, approved_at, executed_at')
    .eq('id', id)
    .single();
  return data as ExecRow;
}

function cronScheduled() {
  return postJson('/functions/v1/process-scheduled-actions', {}, { Authorization: `Bearer ${CRON_SECRET}` });
}

/** Passages du cron jusqu'à ce que ces lignes ne soient plus « approved ». */
async function runScheduledUntilDone(ids: string[]) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await cronScheduled();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { data } = await admin().from('agent_tool_executions').select('id, status').in('id', ids);
    if ((data ?? []).every((r) => r.status !== 'approved')) return;
  }
  throw new Error('actions programmées jamais traitées par process-scheduled-actions');
}

/** Outil de lecture exécuté pour ce membre (harnais lecture). */
async function readTool(orgId: string, userId: string, tool: string, params: Record<string, unknown>) {
  const { data, error } = await admin()
    .from('agent_tool_executions')
    .insert({
      user_id: userId,
      organization_id: orgId,
      tool_name: tool,
      params,
      status: 'approved',
      approved_at: new Date().toISOString(),
      scheduled_for: minutesFromNow(-1),
      dry_run_result: { summary: `Lecture e2e ${tool}`, details: {} },
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`readTool: ${error?.message}`);
  await runScheduledUntilDone([data.id as string]);
  const row = await execRow(data.id as string);
  return { id: data.id as string, status: row.status, result: (row.real_result ?? {}) as ToolResult };
}

const WEEKDAY_ZONES = [
  'Europe/Paris', 'Pacific/Kiritimati', 'Pacific/Apia', 'Pacific/Auckland', 'Asia/Tokyo',
  'America/New_York', 'America/Los_Angeles', 'Pacific/Honolulu', 'Pacific/Pago_Pago',
];

/** Fuseau où l'on est un jour ouvré, loin de minuit. */
function weekdayZone(): string | null {
  for (const tz of WEEKDAY_ZONES) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hourCycle: 'h23' })
      .formatToParts(new Date());
    const weekday = parts.find((p) => p.type === 'weekday')?.value;
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    if (weekday !== 'Sat' && weekday !== 'Sun' && hour >= 1 && hour <= 22) return tz;
  }
  return null;
}
const SEND_ZONE = weekdayZone();
const NO_WEEKDAY_REASON = 'aucun fuseau en jour ouvré : checkLinkedInQuota refuse tout envoi le week-end, sans forçage';

/** Plage horaire 0 h-24 h du membre, dans un fuseau où l'on est un jour ouvré. */
async function openBusinessHours(orgId: string, userId: string) {
  const { error } = await admin().from('member_quotas').upsert(
    { organization_id: orgId, user_id: userId, business_hours_start: 0, business_hours_end: 24, timezone: SEND_ZONE },
    { onConflict: 'organization_id,user_id' },
  );
  if (error) throw new Error(`member_quotas: ${error.message}`);
}

async function seedCandidate(
  orgId: string,
  createdBy: string,
  o: { id?: string; name?: string; url?: string | null; projectId?: string | null } = {},
): Promise<string> {
  const candidateId = o.id ?? newProfileId();
  const { error } = await admin().from('job_candidate_status').insert({
    organization_id: orgId,
    created_by: createdBy,
    candidate_id: candidateId,
    candidate_name: o.name ?? 'Camille Martin',
    linkedin_profile_url: o.url ?? null,
    job_id: o.projectId ? `project:${o.projectId}` : `job_${rand()}`,
    project_id: o.projectId ?? null,
    status: 'new',
    pipeline_stage: 'Nouveau',
  });
  if (error) throw new Error(`seedCandidate: ${error.message}`);
  return candidateId;
}

/** Inscription (dans sa propre séquence) : la clé (séquence, profil) reste unique. */
async function seedEnrollmentRow(orgId: string, createdBy: string, overrides: Record<string, unknown> = {}) {
  const { sequenceId } = await seedSequence(orgId, createdBy, [{ action_type: 'message' }]);
  const profileId = (overrides.profile_id as string | undefined) ?? newProfileId();
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .insert({
      sequence_id: sequenceId,
      organization_id: orgId,
      created_by: createdBy,
      profile_id: profileId,
      provider_id: profileId,
      profile_name: 'Camille Martin',
      account_id: `acc_${rand()}`,
      status: 'active',
      current_step_order: 0,
      ...overrides,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedEnrollmentRow: ${error?.message}`);
  return { enrollmentId: data.id as string, sequenceId, profileId };
}

/** Empreinte du registre gdpr_erasures (même normalisation que get-or-fetch-contact). */
function linkedinUrlHash(url: string): string {
  const normalized = url.toLowerCase().replace(/[?#].*$/, '').replace(/\/$/, '').trim();
  return createHash('sha256').update(normalized).digest('hex');
}

async function eraseLinkedInUrl(url: string) {
  const { data, error } = await admin()
    .from('gdpr_erasures')
    .insert({ linkedin_url_hash: linkedinUrlHash(url), reason: 'user_request', source: 'e2e-seq-assistant' })
    .select('id')
    .single();
  if (error || !data) throw new Error(`gdpr_erasures: ${error?.message}`);
  cleanups.push(() => admin().from('gdpr_erasures').delete().eq('id', data.id));
}

/** Nouvelles conversations ouvertes depuis ce compte vers ce destinataire. */
async function newChatsTo(accountId: string, recipient: string): Promise<MockCall[]> {
  return (await mockCalls(accountId)).filter((c) => c.method === 'POST' && c.path === '/api/v1/chats'
    && (c.body as Record<string, unknown>)?.attendees_ids === recipient);
}

async function postsFrom(accountId: string): Promise<MockCall[]> {
  return (await mockCalls(accountId)).filter((c) => c.method === 'POST');
}

/**
 * Propriétaire d'une conversation scripté sur un compte du test. Le faux
 * prestataire range un appel sous un compte d'après account_id de la requête ;
 * GET /chats/{id} n'en porte pas et la clé '*' est interdite sur la stack
 * partagée. Des identifiants LinkedIn propres à l'organisation
 * (organization_integrations, lus par unipile-search) dont l'adresse finit par
 * « /api/v1/chats/<chat>?account_id=<compte>&suite= » amènent tous les appels
 * de cette organisation sur ce chemin, sous ce compte : GET /chats/<chat>
 * répond alors { account_id: <compte> }, et un envoi éventuel est journalisé
 * sous ce même compte (POST sur ce chemin).
 */
async function scriptChatOwner(orgId: string, chatId: string, ownerAccountId: string) {
  const { error } = await admin().from('organization_integrations').upsert({
    organization_id: orgId,
    unipile_connected: true,
    unipile_api_key: `e2e-${rand()}`,
    unipile_dsn: `e2e-${rand()}.mock.test/api/v1/chats/${chatId}?account_id=${ownerAccountId}&suite=`,
  }, { onConflict: 'organization_id' });
  if (error) throw new Error(`organization_integrations: ${error.message}`);
  await setMockMode(ownerAccountId, {
    routes: [{ method: 'GET', path: `^/api/v1/chats/${chatId}$`, status: 200, body: { object: 'Chat', id: chatId, account_id: ownerAccountId } }],
  });
}

async function actionLogCount(accountId: string): Promise<number> {
  const { count } = await admin().from('linkedin_action_log').select('id', { count: 'exact', head: true }).eq('account_id', accountId);
  return count ?? 0;
}

async function pullDue(enrollmentIds: string[]) {
  await admin().from('sequence_step_executions').update({ scheduled_at: minutesFromNow(-1) })
    .in('enrollment_id', enrollmentIds).eq('status', 'scheduled');
}

async function stepsOf(sequenceId: string) {
  const { data } = await admin()
    .from('sequence_steps')
    .select('step_order, action_type, wait_for_event, timeout_days, delay_days, message_template')
    .eq('sequence_id', sequenceId)
    .order('step_order');
  return (data ?? []) as Array<{ step_order: number; action_type: string; wait_for_event: string | null; timeout_days: number | null; delay_days: number | null; message_template: string | null }>;
}

// ═══ send_linkedin_message ═══════════════════════════════════════════════════

test.describe('@critical Assistant : send_linkedin_message', () => {
  test.describe('slm-refus-rgpd', () => {
    test.describe.configure({ mode: 'serial' });
    // slm-refus-rgpd (cas A registre global, cas B marqueur d'inscription)
    test('@critical refuse d’écrire à un candidat effacé (registre RGPD ou marqueur d’inscription), écrit aux autres', async () => {
      test.skip(!SEND_ZONE, NO_WEEKDAY_REASON);
      const { org, accountId } = await sendingOrg('E2E Assistant RGPD');
      track(org);
      await openBusinessHours(org.orgId, org.owner.userId);
      const token = await tokenOf(org.owner);

      // Témoin : même montage sans effacement, le message part.
      const control = await seedCandidate(org.orgId, org.owner.userId, { url: `https://www.linkedin.com/in/temoin-${rand()}/` });
      const controlRes = await approve(token, await propose(org.orgId, org.owner.userId, 'send_linkedin_message', {
        recipient_provider_id: control, text: 'Bonjour, seriez-vous disponible cette semaine ?',
      }));
      expect(controlRes.body.success, JSON.stringify(controlRes.body)).toBe(true);
      expect(await newChatsTo(accountId, control)).toHaveLength(1);

      // Cas A : l'adresse LinkedIn du candidat est au registre global des effacements.
      const erasedUrl = `https://www.linkedin.com/in/efface-${rand()}/`;
      const erased = await seedCandidate(org.orgId, org.owner.userId, { url: erasedUrl });
      await eraseLinkedInUrl(erasedUrl);
      const aId = await propose(org.orgId, org.owner.userId, 'send_linkedin_message', {
        recipient_provider_id: erased, text: 'Bonjour, seriez-vous disponible cette semaine ?',
      });
      const aRes = await approve(token, aId);

      // Cas B : une inscription de l'organisation porte le marqueur durable D5.
      const marked = newProfileId();
      await seedEnrollmentRow(org.orgId, org.owner.userId, {
        profile_id: marked, provider_id: marked, status: 'stopped',
        tracking_data: { gdpr_erased_at: new Date().toISOString() },
      });
      const bId = await propose(org.orgId, org.owner.userId, 'send_linkedin_message', {
        recipient_provider_id: marked, text: 'Bonjour, seriez-vous disponible cette semaine ?',
      });
      const bRes = await approve(token, bId);

      // DÉFAUT slm-rgpd-non-controle : send_linkedin_message ne consulte ni gdpr_erasures ni tracking_data.gdpr_erased_at.
      expect.soft(aRes.body.success, `cas A (registre) : ${JSON.stringify(aRes.body)}`).toBe(false);
      expect.soft(String(aRes.body.error ?? ''), 'cas A : motif effacement').toMatch(/effac|supprim|RGPD/i);
      expect.soft(await newChatsTo(accountId, erased), 'cas A : aucun envoi').toHaveLength(0);
      expect.soft(bRes.body.success, `cas B (marqueur) : ${JSON.stringify(bRes.body)}`).toBe(false);
      expect.soft(String(bRes.body.error ?? ''), 'cas B : motif effacement').toMatch(/effac|supprim|RGPD/i);
      expect.soft(await newChatsTo(accountId, marked), 'cas B : aucun envoi').toHaveLength(0);
    });
  });

  test.describe('slm-refus-rgpd (programmé)', () => {
    test.describe.configure({ mode: 'serial' });
    // slm-refus-rgpd (cas C : envoi programmé, effacement avant l'heure)
    test('@critical message programmé : un effacement survenu avant l’heure bloque l’envoi au recontrôle du cron', async () => {
      test.skip(!SEND_ZONE, NO_WEEKDAY_REASON);
      const { org, accountId } = await sendingOrg('E2E Assistant RGPD programmé');
      track(org);
      const token = await tokenOf(org.owner);
      const url = `https://www.linkedin.com/in/efface-plus-tard-${rand()}/`;
      const recipient = await seedCandidate(org.orgId, org.owner.userId, { url });

      const id = await propose(org.orgId, org.owner.userId, 'send_linkedin_message', {
        recipient_provider_id: recipient, text: 'Bonjour, je reviens vers vous.',
      }, { scheduled_for: minutesFromNow(120) });
      const res = await approve(token, id);
      expect(res.body.success, JSON.stringify(res.body)).toBe(true);
      expect((await execRow(id)).status).toBe('approved');

      // Effacement après l'approbation, puis l'heure d'envoi arrive.
      await eraseLinkedInUrl(url);
      await openBusinessHours(org.orgId, org.owner.userId);
      await admin().from('agent_tool_executions').update({ scheduled_for: minutesFromNow(-1) }).eq('id', id);
      await runScheduledUntilDone([id]);

      const row = await execRow(id);
      // DÉFAUT slm-rgpd-programme-non-recontrole : le recontrôle du cron (verifyAccess rejoué) ignore l'effacement.
      expect.soft(await newChatsTo(accountId, recipient), 'aucun envoi après effacement').toHaveLength(0);
      expect.soft(row.status).toBe('failed');
      expect.soft(String(row.real_result?.error ?? '')).toMatch(/effac|supprim|RGPD/i);
    });
  });

  test.describe('slm-conversation-collegue-refusee', () => {
    test.describe.configure({ mode: 'serial' });
    // slm-conversation-collegue-refusee
    test('@critical refuse une conversation portée par le compte LinkedIn d’un collègue : rien ne part de son compte, aucun quota compté', async () => {
      test.skip(!SEND_ZONE, NO_WEEKDAY_REASON);
      const { org, accountId } = await sendingOrg('E2E Assistant conversation collègue');
      const colleague = await addMember(org.orgId, 'member', 'collegue');
      track(org, colleague);
      const colleagueAccount = await seedLinkedInAccount(org.orgId, colleague.userId, `acc_${rand()}`, 'OK');
      const chatId = `chat_col_${rand()}`;
      await scriptChatOwner(org.orgId, chatId, colleagueAccount);
      await openBusinessHours(org.orgId, org.owner.userId);

      const id = await propose(org.orgId, org.owner.userId, 'send_linkedin_message', {
        chat_id: chatId, recipient_name: 'Candidat du collègue', text: 'Bonjour, je prends le relais.',
      });
      const res = await approve(await tokenOf(org.owner), id);

      // DÉFAUT slm-envoi-depuis-compte-collegue : unipile-search envoie depuis le compte propriétaire du chat (gateAccountId), sans le comparer au compte de l'appelant.
      expect.soft(await postsFrom(colleagueAccount), 'aucun envoi depuis le compte du collègue').toEqual([]);
      expect.soft(res.body.success, JSON.stringify(res.body)).toBe(false);
      expect.soft((await execRow(id)).status).toBe('failed');
      expect.soft(await actionLogCount(colleagueAccount), 'aucun quota compté sur le compte du collègue').toBe(0);
      expect.soft(await actionLogCount(accountId), 'rien n’est parti : aucun quota compté sur le compte de l’appelant').toBe(0);
    });
  });

  test.describe('slm-refus-desinscrit', () => {
    test.describe.configure({ mode: 'serial' });
    // slm-refus-desinscrit — attente alignée (réfutée par les deux relecteurs) : une désinscription
    // e-mail (suppressed_emails) arrête les séquences et les e-mails (SEQ-089, SEQ-202, page
    // /unsubscribe : « Vous ne recevrez plus d'e-mails »), pas un message LinkedIn ponctuel approuvé
    // par le recruteur ; la messagerie n'applique pas non plus cette liste. Le message part donc.
    test('désinscription e-mail (adresse de son inscription supprimée) : le message LinkedIn ponctuel part quand même, comme au témoin', async () => {
      test.skip(!SEND_ZONE, NO_WEEKDAY_REASON);
      const { org, accountId } = await sendingOrg('E2E Assistant désinscrit');
      track(org);
      await openBusinessHours(org.orgId, org.owner.userId);
      const token = await tokenOf(org.owner);

      // Témoin : inscription arrêtée avec une adresse non supprimée, le message part.
      const control = newProfileId();
      await seedEnrollmentRow(org.orgId, org.owner.userId, {
        profile_id: control, provider_id: control, status: 'stopped', email_used: `temoin-${rand()}@ex.test`,
      });
      const controlRes = await approve(token, await propose(org.orgId, org.owner.userId, 'send_linkedin_message', {
        recipient_provider_id: control, text: 'Bonjour, un poste pourrait vous intéresser.',
      }));
      expect(controlRes.body.success, JSON.stringify(controlRes.body)).toBe(true);
      expect(await newChatsTo(accountId, control)).toHaveLength(1);

      const email = `desinscrit-${rand()}@ex.test`;
      const { error } = await admin().from('suppressed_emails').insert({ email, reason: 'unsubscribe' });
      if (error) throw new Error(`suppressed_emails: ${error.message}`);
      cleanups.push(() => admin().from('suppressed_emails').delete().eq('email', email));
      const unsubscribed = newProfileId();
      await seedEnrollmentRow(org.orgId, org.owner.userId, {
        profile_id: unsubscribed, provider_id: unsubscribed, status: 'stopped', email_used: email,
      });
      const id = await propose(org.orgId, org.owner.userId, 'send_linkedin_message', {
        recipient_provider_id: unsubscribed, text: 'Bonjour, un poste pourrait vous intéresser.',
      });
      const res = await approve(token, id);

      // Pas un refus : suppressed_emails est une liste d'envoi e-mail (voir l'en-tête du test).
      expect(await newChatsTo(accountId, unsubscribed), 'message LinkedIn ponctuel envoyé').toHaveLength(1);
      expect(res.body.success, JSON.stringify(res.body)).toBe(true);
      expect((await execRow(id)).status).toBe('executed');
    });
  });

  test.describe('slm-conversation-autre-organisation', () => {
    test.describe.configure({ mode: 'serial' });
    // slm-conversation-autre-organisation
    test('conversation d’un compte d’une autre organisation : échec sans envoi, message en français', async () => {
      test.skip(!SEND_ZONE, NO_WEEKDAY_REASON);
      const { org, accountId } = await sendingOrg('E2E Assistant conversation autre org');
      track(org);
      const other = await createOrg('agency', 'E2E Assistant autre org');
      track(other);
      const otherAccount = await seedLinkedInAccount(other.orgId, other.owner.userId, `acc_${rand()}`, 'OK');
      const chatId = `chat_b_${rand()}`;
      await scriptChatOwner(org.orgId, chatId, otherAccount);
      await openBusinessHours(org.orgId, org.owner.userId);

      const id = await propose(org.orgId, org.owner.userId, 'send_linkedin_message', {
        chat_id: chatId, text: 'Bonjour, je reviens vers vous.',
      });
      const res = await approve(await tokenOf(org.owner), id);

      expect(res.body.success, JSON.stringify(res.body)).toBe(false);
      const row = await execRow(id);
      expect(row.status).toBe('failed');
      expect(String(row.real_result?.error ?? '')).toContain("n'appartient pas à un compte LinkedIn de votre organisation");
      expect(await postsFrom(otherAccount), 'aucun envoi depuis le compte de l’autre organisation').toEqual([]);
      expect(await postsFrom(accountId), 'aucun envoi depuis le compte de l’appelant').toEqual([]);
    });
  });

  test.describe('slm-compte-parametre-autre-membre', () => {
    test.describe.configure({ mode: 'serial' });
    // slm-compte-parametre-autre-membre
    test('refuse un account_id qui n’est pas relié à l’appelant (collègue, autre organisation)', async () => {
      test.skip(!SEND_ZONE, NO_WEEKDAY_REASON);
      const { org, accountId } = await sendingOrg('E2E Assistant compte paramètre');
      const colleague = await addMember(org.orgId, 'member', 'collegue');
      track(org, colleague);
      const colleagueAccount = await seedLinkedInAccount(org.orgId, colleague.userId, `acc_${rand()}`, 'OK');
      const other = await createOrg('agency', 'E2E Assistant compte autre org');
      track(other);
      const otherAccount = await seedLinkedInAccount(other.orgId, other.owner.userId, `acc_${rand()}`, 'OK');
      await openBusinessHours(org.orgId, org.owner.userId);
      const token = await tokenOf(org.owner);

      for (const foreign of [colleagueAccount, otherAccount]) {
        const id = await propose(org.orgId, org.owner.userId, 'send_linkedin_message', {
          account_id: foreign, recipient_provider_id: newProfileId(), text: 'Bonjour, un échange cette semaine ?',
        });
        const res = await approve(token, id);
        expect(res.body.success, JSON.stringify(res.body)).toBe(false);
        expect(String(res.body.error ?? '')).toContain("n'est pas rattaché à votre profil dans cette organisation");
        expect((await execRow(id)).status).toBe('failed');
      }
      expect(await postsFrom(colleagueAccount)).toEqual([]);
      expect(await postsFrom(otherAccount)).toEqual([]);
      expect(await postsFrom(accountId)).toEqual([]);
    });
  });

  test.describe('slm-hors-plage-programme', () => {
    test.describe.configure({ mode: 'serial' });
    // slm-hors-plage-programme
    // L'aperçu (dryRun, nextBusinessHoursStart) n'est joignable que par search-agent-chat : la
    // ligne proposée porte details.scheduled_for comme l'aperçu l'écrirait hors plage.
    test('hors plage : l’approbation programme sans envoyer, le cron envoie une fois à l’heure dite, une annulation avant l’heure n’envoie rien', async () => {
      test.skip(!SEND_ZONE, NO_WEEKDAY_REASON);
      const { org, accountId } = await sendingOrg('E2E Assistant hors plage');
      track(org);
      const token = await tokenOf(org.owner);
      const recipient = newProfileId();
      const cancelledRecipient = newProfileId();
      const scheduledFor = minutesFromNow(120);

      const id = await propose(org.orgId, org.owner.userId, 'send_linkedin_message', {
        recipient_provider_id: recipient, text: 'Bonjour, je vous écris de la part du cabinet.',
      }, { scheduled_for: scheduledFor });
      const res = await approve(token, id);
      expect(res.body.success, JSON.stringify(res.body)).toBe(true);
      expect((res.body.data as Record<string, unknown>)?.scheduled).toBe(true);
      let row = await execRow(id);
      expect(row.status).toBe('approved');
      expect(row.approved_at).not.toBeNull();
      expect(row.executed_at).toBeNull();
      expect(Math.abs(new Date(row.scheduled_for!).getTime() - new Date(scheduledFor).getTime())).toBeLessThan(2_000);
      expect(await postsFrom(accountId), 'rien ne part à l’approbation').toEqual([]);

      // Un passage du cron avant l'heure n'envoie rien.
      expect((await cronScheduled()).status).toBe(200);
      expect((await execRow(id)).executed_at).toBeNull();
      expect(await postsFrom(accountId)).toEqual([]);

      // Seconde action programmée, annulée par le membre avant l'heure (bandeau).
      const cancelledId = await propose(org.orgId, org.owner.userId, 'send_linkedin_message', {
        recipient_provider_id: cancelledRecipient, text: 'Bonjour, message annulé.',
      }, { scheduled_for: scheduledFor });
      expect((await approve(token, cancelledId)).body.success).toBe(true);
      const ctx = await request.newContext();
      const patch = await ctx.patch(`${E2E.supabaseUrl}/rest/v1/agent_tool_executions?id=eq.${cancelledId}`, {
        headers: { apikey: E2E.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        data: { status: 'rejected' },
      });
      expect(patch.status(), await patch.text()).toBe(200);
      await ctx.dispose();

      // L'heure arrive (plage 0 h-24 h en jour ouvré).
      await openBusinessHours(org.orgId, org.owner.userId);
      await admin().from('agent_tool_executions').update({ scheduled_for: minutesFromNow(-1) }).in('id', [id, cancelledId]);
      await runScheduledUntilDone([id]);
      row = await execRow(id);
      expect(row.status, JSON.stringify(row.real_result)).toBe('executed');
      expect(await newChatsTo(accountId, recipient)).toHaveLength(1);

      // Un second passage n'envoie rien de plus ; l'action annulée ne part jamais.
      expect((await cronScheduled()).status).toBe(200);
      expect(await newChatsTo(accountId, recipient)).toHaveLength(1);
      expect(await newChatsTo(accountId, cancelledRecipient)).toHaveLength(0);
      expect((await execRow(cancelledId)).status).toBe('rejected');
    });
  });

  test.describe('slm-envoi-unique', () => {
    test.describe.configure({ mode: 'serial' });
    // slm-envoi-unique
    test('un message n’est envoyé qu’une fois : deux approbations simultanées, puis deux passages simultanés du cron', async () => {
      test.skip(!SEND_ZONE, NO_WEEKDAY_REASON);
      const { org, accountId } = await sendingOrg('E2E Assistant envoi unique');
      track(org);
      await openBusinessHours(org.orgId, org.owner.userId);
      const token = await tokenOf(org.owner);

      const first = newProfileId();
      const id = await propose(org.orgId, org.owner.userId, 'send_linkedin_message', {
        recipient_provider_id: first, text: 'Bonjour, double clic.',
      });
      const both = await Promise.all([approve(token, id), approve(token, id)]);
      const ok = both.filter((r) => r.body.success === true);
      const refused = both.filter((r) => r.body.success !== true);
      // Décision 33 : un seul succès, l'autre approbation est refusée (« déjà en cours » ou « déjà traitée »).
      expect(ok.length, JSON.stringify(both.map((r) => r.body))).toBe(1);
      for (const r of refused) expect(String(r.body.error)).toMatch(/^Action déjà (en cours ou déjà )?traitée$/);
      expect(await newChatsTo(accountId, first), 'un seul envoi pour deux approbations').toHaveLength(1);
      expect((await execRow(id)).status).toBe('executed');

      const second = newProfileId();
      const scheduledId = await propose(org.orgId, org.owner.userId, 'send_linkedin_message', {
        recipient_provider_id: second, text: 'Bonjour, deux passages du cron.',
      }, { scheduled_for: minutesFromNow(120) });
      expect((await approve(token, scheduledId)).body.success).toBe(true);
      await admin().from('agent_tool_executions').update({ scheduled_for: minutesFromNow(-1) }).eq('id', scheduledId);
      const crons = await Promise.all([cronScheduled(), cronScheduled()]);
      for (const c of crons) expect(c.status).toBe(200);
      await runScheduledUntilDone([scheduledId]);
      expect(await newChatsTo(accountId, second), 'un seul envoi pour deux passages du cron').toHaveLength(1);
      expect((await execRow(scheduledId)).status).toBe('executed');
    });
  });

  test.describe('slm-envoi-trace', () => {
    test.describe.configure({ mode: 'serial' });
    // slm-envoi-trace
    test('un message envoyé est tracé comme le message direct de l’interface (inmail_queue « sent ») : anti-doublon et historique le voient', async () => {
      test.skip(!SEND_ZONE, NO_WEEKDAY_REASON);
      const { org, accountId } = await sendingOrg('E2E Assistant trace');
      track(org);
      await openBusinessHours(org.orgId, org.owner.userId);
      const token = await tokenOf(org.owner);
      const mission = await seedMission(org.orgId, org.owner.userId);
      const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour {{first_name}}']);
      const recipient = await seedCandidate(org.orgId, org.owner.userId, { name: 'Julie Morel', projectId: mission });

      const res = await approve(token, await propose(org.orgId, org.owner.userId, 'send_linkedin_message', {
        recipient_provider_id: recipient, recipient_name: 'Julie Morel', text: 'Bonjour Julie, un poste pourrait vous intéresser.',
      }));
      expect(res.body.success, JSON.stringify(res.body)).toBe(true);
      expect(await newChatsTo(accountId, recipient)).toHaveLength(1);

      const { data: traces } = await admin().from('inmail_queue')
        .select('organization_id, created_by, recipient_profile_id, status')
        .eq('recipient_profile_id', recipient);
      // Historique lu avant la tentative d'inscription (qui, acceptée à tort, fausserait « contacté »).
      const outreach = await readTool(org.orgId, org.owner.userId, 'get_candidate_outreach', { candidate_id: recipient });
      const enroll = await approve(token, await propose(org.orgId, org.owner.userId, 'enroll_in_sequence', {
        sequence_id: sequenceId, candidate_id: recipient, profile_name: 'Julie Morel', job_id: mission,
      }));

      // DÉFAUT slm-envoi-non-trace : send_linkedin_message n'écrit aucune ligne inmail_queue ; ni l'anti-doublon ni get_candidate_outreach ne voient l'envoi.
      expect.soft(traces ?? [], 'trace inmail_queue du message direct').toEqual([
        { organization_id: org.orgId, created_by: org.owner.userId, recipient_profile_id: recipient, status: 'sent' },
      ]);
      expect.soft(outreach.result.data?.contacted, `get_candidate_outreach : ${JSON.stringify(outreach.result)}`).toBe(true);
      expect.soft(enroll.body.success, `inscription sans force : ${JSON.stringify(enroll.body)}`).toBe(false);
      expect.soft(String(enroll.body.error ?? '')).toContain('Déjà contacté');
    });
  });
});

// ═══ get_sequences_status ════════════════════════════════════════════════════

test.describe('Assistant : get_sequences_status', () => {
  test.describe('gss-scope-organisation', () => {
    test.describe.configure({ mode: 'serial' });
    // gss-scope-organisation
    test('ne compte que les inscriptions de l’organisation de l’appelant (pas celles d’un partenaire sur le même job_id)', async () => {
      const a = await createOrg('agency', 'E2E GSS A');
      track(a);
      const b = await createOrg('agency', 'E2E GSS B');
      track(b);
      const mission = await seedMission(a.orgId, a.owner.userId);
      for (let i = 0; i < 2; i++) await seedEnrollmentRow(a.orgId, a.owner.userId, { job_id: mission });
      for (let i = 0; i < 3; i++) await seedEnrollmentRow(b.orgId, b.owner.userId, { job_id: mission });

      const r = await readTool(a.orgId, a.owner.userId, 'get_sequences_status', { mission_id: mission });
      expect(r.status, JSON.stringify(r.result)).toBe('executed');
      const byStatus = (r.result.data?.by_status ?? {}) as Record<string, number>;
      // DÉFAUT gss-autres-organisations-comptees : la requête filtre sur job_id seul, en clé de service, sans organization_id.
      expect.soft(r.result.data?.total_enrolled, JSON.stringify(r.result.data)).toBe(2);
      expect.soft(Object.values(byStatus).reduce((s, n) => s + n, 0)).toBe(2);
    });
  });

  test.describe('gss-acces-collaborateur', () => {
    test.describe.configure({ mode: 'serial' });
    // gss-acces-collaborateur
    test('collaborateur : refus sur une mission qu’il n’a ni créée ni rejointe, réponse sur les siennes', async () => {
      const org = await createOrg('agency', 'E2E GSS collaborateur');
      const collab = await addMember(org.orgId, 'collaborator', 'collab');
      track(org, collab);
      const foreign = await seedMission(org.orgId, org.owner.userId);
      const joined = await seedMission(org.orgId, org.owner.userId);
      const own = await seedMission(org.orgId, collab.userId);
      const { error } = await admin().from('mission_team').insert({ project_id: joined, user_id: collab.userId, role: 'sourcer' });
      if (error) throw new Error(`mission_team: ${error.message}`);
      for (const m of [foreign, joined, own]) await seedEnrollmentRow(org.orgId, org.owner.userId, { job_id: m });

      const refused = await readTool(org.orgId, collab.userId, 'get_sequences_status', { mission_id: foreign });
      expect(refused.status).toBe('failed');
      expect(refused.result.success).toBe(false);
      expect(String(refused.result.error)).toContain("Tu n'as pas accès à cette mission");
      expect(refused.result.data).toBeUndefined();

      for (const m of [joined, own]) {
        const r = await readTool(org.orgId, collab.userId, 'get_sequences_status', { mission_id: m });
        expect(r.status, JSON.stringify(r.result)).toBe('executed');
        expect(r.result.success).toBe(true);
        expect(r.result.data?.total_enrolled).toBe(1);
      }
    });
  });

  test.describe('gss-mission-autre-organisation', () => {
    test.describe.configure({ mode: 'serial' });
    // gss-mission-autre-organisation
    test('mission d’une autre organisation : rien, ni par UUID ni par nom', async () => {
      const a = await createOrg('agency', 'E2E GSS mission A');
      track(a);
      const b = await createOrg('agency', 'E2E GSS mission B');
      track(b);
      const name = `Mission confidentielle ${rand()}`;
      const mission = await seedMission(a.orgId, a.owner.userId, { name });
      for (let i = 0; i < 3; i++) await seedEnrollmentRow(a.orgId, a.owner.userId, { job_id: mission });

      const byId = await readTool(b.orgId, b.owner.userId, 'get_sequences_status', { mission_id: mission });
      expect(byId.status).toBe('failed');
      expect(String(byId.result.error)).toContain("Tu n'as pas accès");
      expect(byId.result.data).toBeUndefined();

      const byName = await readTool(b.orgId, b.owner.userId, 'get_sequences_status', { mission_name: name });
      expect(byName.status).toBe('failed');
      expect(String(byName.result.error)).toMatch(/introuvable/);
      expect(byName.result.data).toBeUndefined();
    });
  });
});

// ═══ get_candidate_outreach ══════════════════════════════════════════════════

test.describe('Assistant : get_candidate_outreach', () => {
  test.describe('gco-scope-organisation', () => {
    test.describe.configure({ mode: 'serial' });
    // gco-scope-organisation
    test('ne montre ni inscription, ni InMail, ni analyse d’une autre organisation pour le même identifiant LinkedIn', async () => {
      const a = await createOrg('agency', 'E2E GCO A');
      track(a);
      const b = await createOrg('agency', 'E2E GCO B');
      track(b);
      const name = `Lucie Bernard ${rand()}`;
      const candidate = await seedCandidate(a.orgId, a.owner.userId, { name });
      await seedEnrollmentRow(b.orgId, b.owner.userId, {
        profile_id: candidate, provider_id: candidate, profile_name: name, status: 'replied', replied_at: new Date().toISOString(),
      });
      const { error: inmailErr } = await admin().from('inmail_queue').insert({
        organization_id: b.orgId, created_by: b.owner.userId, account_id: `acc_${rand()}`, recipient_profile_id: candidate,
        recipient_name: name, subject: 'Poste', message: 'Bonjour', status: 'sent', sent_at: new Date().toISOString(),
      });
      if (inmailErr) throw new Error(`inmail_queue: ${inmailErr.message}`);
      const { error: analysisErr } = await admin().from('message_analysis_cache').insert({
        organization_id: b.orgId, chat_id: `chat_${rand()}`, account_id: `acc_${rand()}`, recipient_name: name,
        analysis: { intent: 'interested', sentiment: 'positive', summary: 'Analyse de l’organisation B' },
      });
      if (analysisErr) throw new Error(`message_analysis_cache: ${analysisErr.message}`);

      const r = await readTool(a.orgId, a.owner.userId, 'get_candidate_outreach', { candidate_id: candidate });
      expect(r.status, JSON.stringify(r.result)).toBe('executed');
      expect(r.result.data?.enrollments).toEqual([]);
      expect(r.result.data?.inmails).toEqual([]);
      expect(r.result.data?.message_analyses).toEqual([]);
      expect(r.result.data?.contacted).toBe(false);
      expect(r.result.data?.replied).toBe(false);
    });
  });

  test.describe('gco-portee-collaborateur', () => {
    test.describe.configure({ mode: 'serial' });
    // gco-portee-collaborateur
    test('collaborateur : candidat hors de ses missions introuvable ; sur ses missions, ses inscriptions et celles de ses missions (toutes formes de job_id), pas les InMails des autres', async () => {
      const org = await createOrg('agency', 'E2E GCO collaborateur');
      const collab = await addMember(org.orgId, 'collaborator', 'collab');
      const member = await addMember(org.orgId, 'member', 'membre');
      track(org, collab, member);
      const own = await seedMission(org.orgId, collab.userId);
      const others = await seedMission(org.orgId, org.owner.userId);
      const tag = rand();
      const hiddenName = `Yann Perrin ${tag}`;
      const hidden = await seedCandidate(org.orgId, org.owner.userId, { name: hiddenName, projectId: others });
      const visible = await seedCandidate(org.orgId, collab.userId, { name: `Xavier Perrin ${tag}`, projectId: own });

      await seedEnrollmentRow(org.orgId, collab.userId, { profile_id: visible, provider_id: visible, job_id: null, job_title: 'inscription du collaborateur' });
      await seedEnrollmentRow(org.orgId, member.userId, { profile_id: visible, provider_id: visible, job_id: own, job_title: 'mission du collaborateur (uuid)' });
      await seedEnrollmentRow(org.orgId, member.userId, { profile_id: visible, provider_id: visible, job_id: `project:${own}`, job_title: 'mission du collaborateur (project:)' });
      await seedEnrollmentRow(org.orgId, member.userId, { profile_id: visible, provider_id: visible, job_id: others, job_title: 'mission d’un autre' });
      const { error } = await admin().from('inmail_queue').insert({
        organization_id: org.orgId, created_by: member.userId, account_id: `acc_${rand()}`, recipient_profile_id: visible,
        subject: 'Poste', message: 'Bonjour', status: 'sent', sent_at: new Date().toISOString(),
      });
      if (error) throw new Error(`inmail_queue: ${error.message}`);

      const byId = await readTool(org.orgId, collab.userId, 'get_candidate_outreach', { candidate_id: hidden });
      expect(byId.status).toBe('failed');
      expect(String(byId.result.error)).toContain('Candidat introuvable');
      expect(JSON.stringify(byId.result)).not.toContain(hiddenName);

      const byName = await readTool(org.orgId, collab.userId, 'get_candidate_outreach', { candidate_name: `Perrin ${tag}` });
      expect(JSON.stringify(byName.result), 'aucune liste d’ambiguïté ne révèle le candidat caché').not.toContain(hidden);
      expect(JSON.stringify(byName.result)).not.toContain(hiddenName);

      const r = await readTool(org.orgId, collab.userId, 'get_candidate_outreach', { candidate_id: visible });
      expect(r.status, JSON.stringify(r.result)).toBe('executed');
      expect(r.result.data?.inmails, 'InMail d’un autre membre').toEqual([]);
      const missions = ((r.result.data?.enrollments ?? []) as Array<{ mission: string }>).map((e) => e.mission).sort();
      // DÉFAUT gco-job-id-project-ecarte : le filtre collaborateur compare job_id aux UUID de ses missions, la forme « project:<uuid> » est écartée.
      expect(missions).toEqual([
        'inscription du collaborateur',
        'mission du collaborateur (project:)',
        'mission du collaborateur (uuid)',
      ]);
    });
  });

  test.describe('gco-fil-comptes-appelant', () => {
    test.describe.configure({ mode: 'serial' });
    // gco-fil-comptes-appelant
    test('ne lit le fil LinkedIn que dans les comptes de l’appelant, jamais dans la boîte d’un collègue', async () => {
      const org = await createOrg('agency', 'E2E GCO fil');
      const collab = await addMember(org.orgId, 'collaborator', 'collab');
      const member = await addMember(org.orgId, 'member', 'membre');
      track(org, collab, member);
      await seedLinkedInAccount(org.orgId, collab.userId, `acc_${rand()}`, 'OK');
      const memberAccount = await seedLinkedInAccount(org.orgId, member.userId, `acc_${rand()}`, 'OK');
      const mission = await seedMission(org.orgId, collab.userId);
      const candidate = await seedCandidate(org.orgId, collab.userId, { projectId: mission });
      const chatId = `chat_m_${rand()}`;
      await setMockMode(memberAccount, {
        routes: [
          { method: 'GET', path: `^/api/v1/chat_attendees/${candidate}/chats$`, body: { object: 'ChatList', items: [{ id: chatId, account_id: memberAccount }], cursor: null } },
          { method: 'GET', path: `^/api/v1/chats/${chatId}/messages$`, body: { object: 'MessageList', items: [
            { id: 'm1', text: 'Conversation privée du collègue', is_sender: 1, timestamp: minutesFromNow(-60) },
            { id: 'm2', text: 'Réponse du candidat au collègue', is_sender: 0, timestamp: minutesFromNow(-30) },
          ], cursor: null } },
        ],
      });

      const r = await readTool(org.orgId, collab.userId, 'get_candidate_outreach', { candidate_id: candidate });
      expect(r.status, JSON.stringify(r.result)).toBe('executed');
      expect(r.result.data?.linkedin_thread).toBeNull();
      // DÉFAUT gco-boite-collegue-lue : resolveOrgLinkedInAccounts ajoute les comptes des collègues, get_chats part sur le compte du membre.
      expect(await mockCalls(memberAccount), 'aucun appel sur le compte LinkedIn du collègue').toEqual([]);
    });
  });

  test.describe('gco-analyses-par-identite', () => {
    test.describe.configure({ mode: 'serial' });
    // gco-analyses-par-identite
    test('ne rattache pas l’analyse d’un homonyme approchant ; « répondu » n’est pas déduit d’une telle analyse', async () => {
      const org = await createOrg('agency', 'E2E GCO analyses');
      track(org);
      const candidate = await seedCandidate(org.orgId, org.owner.userId, { name: 'Marie Martin' });
      const { error } = await admin().from('message_analysis_cache').insert({
        organization_id: org.orgId, chat_id: `chat_${rand()}`, account_id: `acc_${rand()}`, recipient_name: 'Marie Martinez',
        analysis: { intent: 'interested', sentiment: 'positive', summary: 'Marie Martinez est intéressée' },
      });
      if (error) throw new Error(`message_analysis_cache: ${error.message}`);

      const r = await readTool(org.orgId, org.owner.userId, 'get_candidate_outreach', { candidate_id: candidate });
      expect(r.status, JSON.stringify(r.result)).toBe('executed');
      // DÉFAUT gco-analyse-par-nom : message_analysis_cache est rapproché par ilike '%Marie Martin%', l'homonyme est rattaché et replied passe à vrai.
      expect.soft(r.result.data?.message_analyses).toEqual([]);
      expect.soft(r.result.data?.replied).toBe(false);
    });
  });

  test.describe('gco-resultat-audit-non-expose', () => {
    test.describe.configure({ mode: 'serial' });
    // gco-resultat-audit-non-expose
    // Harnais : le résultat est écrit par executeScheduledAction (cron), qui n'applique jamais
    // redactResultInAudit ; en production une lecture passe par handleProposedToolCall (exécution
    // directe), seul chemin qui masque. Un correctif limité à ce drapeau ne serait pas vu ici.
    test('le résultat (inscriptions d’un collègue) n’est pas lisible en clair par un collaborateur dans agent_tool_executions', async () => {
      const org = await createOrg('agency', 'E2E GCO audit');
      const collab = await addMember(org.orgId, 'collaborator', 'collab');
      track(org, collab);
      const mission = await seedMission(org.orgId, org.owner.userId);
      const candidate = await seedCandidate(org.orgId, org.owner.userId, { name: 'Paul Lambert', projectId: mission });
      await seedEnrollmentRow(org.orgId, org.owner.userId, {
        profile_id: candidate, provider_id: candidate, job_id: mission, job_title: 'Mission confidentielle',
        status: 'replied', replied_at: new Date().toISOString(),
      });
      const r = await readTool(org.orgId, org.owner.userId, 'get_candidate_outreach', { candidate_id: candidate });
      expect(r.status).toBe('executed');
      expect(r.result.data?.enrollments, 'le propriétaire voit l’inscription (précondition)').toHaveLength(1);

      const ctx = await request.newContext();
      const res = await ctx.get(`${E2E.supabaseUrl}/rest/v1/agent_tool_executions?id=eq.${r.id}&select=real_result`, {
        headers: { apikey: E2E.anonKey, Authorization: `Bearer ${await tokenOf(collab)}` },
      });
      expect(res.status()).toBe(200);
      const rows = (await res.json()) as Array<{ real_result: ToolResult | null }>;
      await ctx.dispose();
      const exposed = rows.filter((row) => {
        const d = row.real_result?.data ?? {};
        return (d.enrollments?.length ?? 0) > 0 || (d.message_analyses?.length ?? 0) > 0 || !!d.linkedin_thread;
      });
      // DÉFAUT gco-audit-lisible-organisation : policy org_members_select sur toute l'organisation et aucun masquage du résultat de cet outil.
      expect(exposed, JSON.stringify(rows)).toEqual([]);
    });
  });
});

// ═══ create_sequence + enroll_in_sequence ════════════════════════════════════

// Lot 5e : create_sequence rédige la séquence de la mission sur la forme commune
// (serveur : invitation avec note, attente de l'acceptation pendant 14 jours,
// messages « Si connecté » à 0, 4 puis 7 jours ; ou InMail). L'assistant
// n'écrit que les textes, contrôlés comme ceux de la rédaction par l'IA.
const CS_NOTE = "Bonjour {{prenom}}, je recrute pour un poste de {{poste_recherche}}. Votre parcours m'a donné envie d'échanger. {{mon_prenom}}";
const CS_FIRST = "Bonjour {{prenom}},\n\nJe vous écris au sujet d'un poste de {{poste_recherche}} dans une équipe en croissance. Cela vous parlerait-il ?\n\n{{mon_prenom}}";
const CS_RELANCE_1 = "Bonjour {{prenom}}, je reviens vers vous au sujet du poste de {{poste_recherche}}. Seriez-vous curieux d'en savoir plus ?\n\n{{mon_prenom}}";
const CS_RELANCE_2 = "Bonjour {{prenom}}, un dernier mot sur ce poste de {{poste_recherche}} : je reste disponible si le sujet vous intéresse.\n\n{{mon_prenom}}";

function csParams(missionId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mission_id: missionId,
    first_contact: 'invitation',
    relances: 2,
    profile_visit: false,
    invitation_note: CS_NOTE,
    first_message: CS_FIRST,
    relance_1: CS_RELANCE_1,
    relance_2: CS_RELANCE_2,
    ...over,
  };
}

test.describe('Assistant : create_sequence', () => {
  test.describe('cs-offre-gratuite-desactivee', () => {
    test.describe.configure({ mode: 'serial' });
    // cs-offre-gratuite-desactivee
    test('crée la séquence désactivée, avec un message, quand l’offre n’autorise pas l’envoi ; active sur une offre payante', async () => {
      const free = await createOrg('agency', 'E2E CS gratuit');
      track(free);
      const { error } = await admin().from('organization_subscriptions')
        .upsert({ organization_id: free.orgId, plan_id: 'free', status: 'active' }, { onConflict: 'organization_id' });
      if (error) throw new Error(`organization_subscriptions: ${error.message}`);
      const { org: paid } = await sendingOrg('E2E CS payant');
      track(paid);
      const freeMission = await seedMission(free.orgId, free.owner.userId);
      const paidMission = await seedMission(paid.orgId, paid.owner.userId);

      const paidRes = await approve(await tokenOf(paid.owner), await propose(paid.orgId, paid.owner.userId, 'create_sequence', csParams(paidMission)));
      expect(paidRes.body.success, JSON.stringify(paidRes.body)).toBe(true);
      const paidSeq = await admin().from('outreach_sequences').select('is_active').eq('id', (paidRes.body.data as Record<string, unknown>).sequence_id).single();
      expect(paidSeq.data?.is_active, 'offre payante : séquence active').toBe(true);

      const freeRes = await approve(await tokenOf(free.owner), await propose(free.orgId, free.owner.userId, 'create_sequence', csParams(freeMission)));
      expect(freeRes.body.success, JSON.stringify(freeRes.body)).toBe(true);
      const freeData = freeRes.body.data as Record<string, unknown>;
      const freeSeq = await admin().from('outreach_sequences').select('is_active').eq('id', freeData.sequence_id).single();
      // DÉFAUT cs-active-offre-gratuite : create_sequence insère is_active: true en dur, sans consulter l'offre (SEQ-154).
      expect.soft(freeSeq.data?.is_active, 'offre gratuite : séquence créée désactivée').toBe(false);
      expect.soft(String(freeData.message ?? '')).toMatch(/offre|abonnement|désactivée/i);
    });
  });

  test.describe('cs-premiere-etape-envoyee', () => {
    test.describe.configure({ mode: 'serial' });
    // cs-premiere-etape-envoyee
    test('séquence rédigée puis inscription par l’assistant : l’invitation (étape 0) est planifiée et part avec sa note au cycle où elle est due, sans variable brute', async () => {
      const { org, accountId } = await sendingOrg('E2E CS première étape');
      track(org);
      // Candidat pas encore en relation : l'invitation part vraiment.
      await setMockMode(accountId, { distance: 'SECOND_DEGREE' });
      const token = await tokenOf(org.owner);
      const mission = await seedMission(org.orgId, org.owner.userId);
      const created = await approve(token, await propose(org.orgId, org.owner.userId, 'create_sequence', csParams(mission)));
      expect(created.body.success, JSON.stringify(created.body)).toBe(true);
      const sequenceId = (created.body.data as Record<string, unknown>).sequence_id as string;
      expect((await stepsOf(sequenceId)).map((s) => [s.step_order, s.action_type])).toEqual([
        [0, 'connection_request'], [1, 'wait_connection'], [2, 'message'], [3, 'message'], [4, 'message'],
      ]);

      const candidate = newProfileId();
      const enrolled = await approve(token, await propose(org.orgId, org.owner.userId, 'enroll_in_sequence', {
        sequence_id: sequenceId, candidate_id: candidate, profile_name: 'Marie Martin', job_id: mission,
        profile_url: `https://www.linkedin.com/in/marie-martin-${rand()}`,
      }));
      expect(enrolled.body.success, JSON.stringify(enrolled.body)).toBe(true);
      const enrollmentId = (enrolled.body.data as Record<string, unknown>).enrollment_id as string;

      const planned = await executionsOf(enrollmentId);
      expect(planned.map((e) => [e.step_order, e.status])).toEqual([[0, 'scheduled']]);
      // Première plage préférée du fuseau (9 h-18 h en jour ouvré) : au plus tard sous 4 jours.
      expect(new Date(planned[0].scheduled_at).getTime()).toBeLessThan(Date.now() + 4 * 24 * 3600_000);

      // Le temps passe jusqu'à l'échéance, un cycle du moteur.
      await pullDue([enrollmentId]);
      await runCycle();
      expect((await executionsOf(enrollmentId))[0].status).toBe('sent');
      const invites = (await sentInvites(accountId)).filter((c) => (c.body as Record<string, unknown>)?.provider_id === candidate);
      expect(invites).toHaveLength(1);
      const note = String((invites[0].body as Record<string, unknown>).message ?? '');
      expect(note.startsWith('Bonjour')).toBe(true);
      expect(note).not.toMatch(/[{}]/);
    });
  });

  test.describe('cs-attente-reponse', () => {
    test.describe.configure({ mode: 'serial' });
    // cs-attente-reponse
    test('les délais de la séquence rédigée attendent vraiment : la relance part 4 jours après le premier message sans réponse ; avec réponse l’inscription se clôt et rien ne part', async () => {
      const { org, accountId } = await sendingOrg('E2E CS attente');
      track(org);
      const token = await tokenOf(org.owner);
      const mission = await seedMission(org.orgId, org.owner.userId);
      const res = await approve(token, await propose(org.orgId, org.owner.userId, 'create_sequence', csParams(mission, { relances: 1 })));
      expect(res.body.success, JSON.stringify(res.body)).toBe(true);
      const sequenceId = (res.body.data as Record<string, unknown>).sequence_id as string;

      // Forme fixée par le serveur : attente de l'acceptation avec son événement et son délai.
      expect((await stepsOf(sequenceId)).map((s) => [s.step_order, s.action_type, s.wait_for_event, s.timeout_days, s.delay_days])).toEqual([
        [0, 'connection_request', null, null, 0],
        [1, 'wait_connection', 'connection_accepted', 14, 0],
        [2, 'message', null, null, 0],
        [3, 'message', null, null, 4],
      ]);

      const enrollOne = async () => {
        const candidate = newProfileId();
        const enrolled = await approve(token, await propose(org.orgId, org.owner.userId, 'enroll_in_sequence', {
          sequence_id: sequenceId, candidate_id: candidate, profile_name: 'Marie Martin', job_id: mission,
        }));
        expect(enrolled.body.success, JSON.stringify(enrolled.body)).toBe(true);
        return { candidate, enrollmentId: (enrolled.body.data as Record<string, unknown>).enrollment_id as string };
      };
      const silent = await enrollOne();
      const answering = await enrollOne();
      const ids = [silent.enrollmentId, answering.enrollmentId];

      // Candidats déjà en relation (faux LinkedIn par défaut) : invitation sautée,
      // attente franchie, puis le premier message part.
      const firstSent = async (id: string) => (await executionsOf(id)).find((e) => e.step_order === 2)?.status === 'sent';
      for (let attempt = 0; attempt < 8; attempt++) {
        if ((await firstSent(silent.enrollmentId)) && (await firstSent(answering.enrollmentId))) break;
        await pullDue(ids);
        await runCycle();
      }
      for (const id of ids) expect(await firstSent(id), `premier message de ${id}`).toBe(true);
      expect(await sentInvites(accountId), 'invitation sautée pour un candidat déjà en relation').toEqual([]);
      for (const who of [silent, answering]) expect(await newChatsTo(accountId, who.candidate)).toHaveLength(1);

      // La relance attend 4 jours après le premier message.
      for (const id of ids) {
        const relance = (await executionsOf(id)).find((e) => e.step_order === 3);
        expect(relance?.status, `relance de ${id}`).toBe('scheduled');
        expect(new Date(relance!.scheduled_at).getTime()).toBeGreaterThan(Date.now() + 3 * 24 * 3600_000);
      }

      // Le candidat répond : inscription « répondue », plus rien en attente.
      await webhook({
        event: 'message_received', account_id: accountId, account_type: 'LINKEDIN',
        chat_id: `chat_${rand()}`, message_id: `msg_${rand()}`, message: 'Bonjour, oui avec plaisir',
        sender: { attendee_provider_id: answering.candidate, attendee_id: 'att_candidate', attendee_name: 'Marie Martin' },
      });
      expect((await enrollmentRow(answering.enrollmentId)).status).toBe('replied');
      const answeringPending = (await executionsOf(answering.enrollmentId))
        .filter((e) => ['scheduled', 'waiting_event', 'quota_blocked'].includes(e.status));
      expect(answeringPending, 'relance annulée').toEqual([]);

      // Sans réponse : le délai passe, la relance part.
      await pullDue(ids);
      await runCycle();
      const silentTexts = (await newChatsTo(accountId, silent.candidate)).map((c) => String((c.body as Record<string, unknown>).text));
      expect(silentTexts).toHaveLength(2);
      expect(silentTexts[1]).toContain('je reviens vers vous');
      expect(silentTexts[1]).not.toMatch(/[{}]/);
      expect(await newChatsTo(accountId, answering.candidate), 'aucune relance après la réponse').toHaveLength(1);
    });
  });
});

// ═══ Lot 5a : garde-fous d'envoi ═════════════════════════════════════════════

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Binaire Deno : DENO_BIN, sinon deno du PATH, sinon npx deno (comme e2e/local-stack/up.sh). */
function denoCommand(): { cmd: string; pre: string[] } {
  if (process.env.DENO_BIN) return { cmd: process.env.DENO_BIN, pre: [] };
  try {
    execFileSync('deno', ['--version'], { stdio: 'ignore' });
    return { cmd: 'deno', pre: [] };
  } catch {
    return { cmd: 'npx', pre: ['-y', 'deno'] };
  }
}

interface ProposedCall {
  outcome: 'executed_inline' | 'awaiting_approval' | 'denied';
  executionId?: string;
  payload: { error?: unknown; details?: Record<string, unknown> } & Record<string, unknown>;
}

/** details.first_step_preview rendu par le dryRun d'enroll_in_sequence. */
interface FirstStepPreviewPayload {
  candidate_name: string;
  candidate_in_mission: boolean;
  texts: Array<{ step_label: string; text: string; condition: string | null; ai: boolean; missing: string[] }>;
}

/**
 * Appel d'outil du modèle traité comme search-agent-chat le traite
 * (handleProposedToolCall : politique de l'organisation, verifyAccess, dryRun,
 * puis exécution directe ou ligne « proposed »), par la sonde Deno.
 */
function proposeLikeChat(orgId: string, user: TestUser, tool: string, params: Record<string, unknown>, userBearer?: string): ProposedCall {
  const { cmd, pre } = denoCommand();
  const out = execFileSync(cmd, [
    ...pre, 'run', '-A', '--no-check',
    `--import-map=${REPO_ROOT}e2e/local-stack/import_map.json`,
    `${REPO_ROOT}e2e/helpers/agent-tool-probe.ts`,
  ], {
    input: JSON.stringify({ tool, params, userId: user.userId, organizationId: orgId, userBearer: userBearer ?? null }),
    env: {
      ...process.env,
      SUPABASE_URL: E2E.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: E2E.serviceRoleKey,
      VENDOR_MOCK_URL: MOCK_URL,
      APP_URL: 'http://localhost:8080',
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
    },
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const line = out.split('\n').find((l) => l.startsWith('__PROBE__'));
  if (!line) throw new Error(`sonde sans résultat : ${out.slice(-2000)}`);
  return JSON.parse(line.slice('__PROBE__'.length)) as ProposedCall;
}

/** Politique d'autonomie enregistrée par l'organisation (Paramètres › Assistant). */
async function setToolPolicy(orgId: string, toolName: string, policy: 'auto' | 'approve' | 'off') {
  const { error } = await admin().from('agent_tool_policies').upsert(
    { organization_id: orgId, tool_name: toolName, policy },
    { onConflict: 'organization_id,tool_name' },
  );
  if (error) throw new Error(`agent_tool_policies: ${error.message}`);
}

async function enrollmentsOfSequence(sequenceId: string) {
  const { data } = await admin()
    .from('sequence_enrollments')
    .select('id, status, profile_id, profile_name, profile_headline, job_title, company_name')
    .eq('sequence_id', sequenceId);
  return (data ?? []) as Array<{ id: string; status: string; profile_id: string; profile_name: string | null; profile_headline: string | null; job_title: string | null; company_name: string | null }>;
}

test.describe('@critical Assistant : garde-fous d’envoi (lot 5a)', () => {
  test.describe('5a-politique-auto-inscription', () => {
    test.describe.configure({ mode: 'serial' });
    test('@critical politique « auto » enregistrée pour enroll_in_sequence : l’inscription est proposée, rien n’est inscrit ni envoyé avant l’approbation', async () => {
      const { org, accountId } = await sendingOrg('E2E 5a auto inscription');
      track(org);
      const token = await tokenOf(org.owner);
      const mission = await seedMission(org.orgId, org.owner.userId);
      const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour {{first_name}}, une question rapide.']);
      await setToolPolicy(org.orgId, 'enroll_in_sequence', 'auto');

      const candidate = newProfileId();
      const proposed = proposeLikeChat(org.orgId, org.owner, 'enroll_in_sequence', {
        sequence_id: sequenceId, candidate_id: candidate, profile_name: 'Marie Martin', job_id: mission,
      });
      expect(proposed.outcome, JSON.stringify(proposed.payload)).toBe('awaiting_approval');
      expect(proposed.executionId).toBeTruthy();
      expect((await execRow(proposed.executionId!)).status).toBe('proposed');
      expect(await enrollmentsOfSequence(sequenceId), 'aucune inscription sans clic').toEqual([]);
      expect(await postsFrom(accountId), 'aucun envoi').toEqual([]);

      // Le clic « Approuver » inscrit.
      const approved = await approve(token, proposed.executionId!);
      expect(approved.body.success, JSON.stringify(approved.body)).toBe(true);
      expect(await enrollmentsOfSequence(sequenceId)).toHaveLength(1);
    });
  });

  test.describe('5a-politique-auto-reprise', () => {
    test.describe.configure({ mode: 'serial' });
    test('@critical politique « auto » enregistrée pour resume_sequence : la reprise est proposée, la séquence et ses candidats restent en pause avant l’approbation', async () => {
      const { org } = await sendingOrg('E2E 5a auto reprise');
      track(org);
      const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour {{first_name}}']);
      await admin().from('outreach_sequences').update({ is_active: false }).eq('id', sequenceId);
      const profileId = newProfileId();
      const { data: paused, error } = await admin().from('sequence_enrollments').insert({
        sequence_id: sequenceId, organization_id: org.orgId, created_by: org.owner.userId,
        profile_id: profileId, provider_id: profileId, profile_name: 'Camille Martin',
        account_id: `acc_${rand()}`, status: 'paused', pause_reason: 'sequence_inactive', current_step_order: 0,
      }).select('id').single();
      if (error || !paused) throw new Error(`inscription en pause : ${error?.message}`);
      await setToolPolicy(org.orgId, 'resume_sequence', 'auto');

      const proposed = proposeLikeChat(org.orgId, org.owner, 'resume_sequence', { sequence_id: sequenceId });
      expect(proposed.outcome, JSON.stringify(proposed.payload)).toBe('awaiting_approval');
      expect((await execRow(proposed.executionId!)).status).toBe('proposed');
      const { data: seq } = await admin().from('outreach_sequences').select('is_active').eq('id', sequenceId).single();
      expect(seq?.is_active, 'séquence toujours désactivée').toBe(false);
      const row = await enrollmentRow(paused.id as string);
      expect([row.status, row.pause_reason], 'candidat toujours en pause').toEqual(['paused', 'sequence_inactive']);
    });
  });

  test.describe('5a-apercu-premier-message', () => {
    test.describe.configure({ mode: 'serial' });
    test('@critical la carte porte le premier message entier, construit avec la ligne de la mission ; le faux LinkedIn reçoit exactement ce texte', async () => {
      const { org, accountId } = await sendingOrg('E2E 5a aperçu');
      track(org);
      const token = await tokenOf(org.owner);
      const mission = await seedMission(org.orgId, org.owner.userId);
      const template = 'Bonjour {{prenom}}, votre rôle de {{poste_actuel}} chez {{entreprise_actuelle}} m’intéresse pour un poste de {{poste_recherche}}.';
      const { sequenceId } = await messageSequence(org, org.owner.userId, [template]);
      const url = `https://www.linkedin.com/in/claire-dubois-${rand()}`;
      const candidate = await seedCandidate(org.orgId, org.owner.userId, { name: 'Claire Dubois', url, projectId: mission });
      await admin().from('job_candidate_status').update({
        candidate_headline: 'Lead Developer chez Qonto',
        linkedin_profile_data: { work_experience: [{ company: 'Qonto', role: 'Lead Developer', current: true }] },
      }).eq('organization_id', org.orgId).eq('candidate_id', candidate);

      // Nom donné par le modèle volontairement différent : la ligne de la mission fait foi.
      const proposed = proposeLikeChat(org.orgId, org.owner, 'enroll_in_sequence', {
        sequence_id: sequenceId, candidate_id: candidate, profile_name: 'C. Dubois', job_id: mission, profile_url: url,
      });
      expect(proposed.outcome, JSON.stringify(proposed.payload)).toBe('awaiting_approval');
      const preview = proposed.payload.details?.first_step_preview as FirstStepPreviewPayload;
      const expected = 'Bonjour Claire, votre rôle de Lead Developer chez Qonto m’intéresse pour un poste de Senior Backend Engineer.';
      expect(preview.candidate_in_mission).toBe(true);
      expect(preview.candidate_name).toBe('Claire Dubois');
      expect(preview.texts).toHaveLength(1);
      expect(preview.texts[0]).toMatchObject({ step_label: 'Message', text: expected, condition: null, ai: false, missing: [] });
      // La même carte, lue en base (bandeau d'approbation).
      const { data: stored } = await admin().from('agent_tool_executions').select('dry_run_result').eq('id', proposed.executionId!).single();
      const storedDetails = (stored?.dry_run_result as { details?: { first_step_preview?: FirstStepPreviewPayload } } | null)?.details;
      expect(storedDetails?.first_step_preview?.texts?.[0]?.text).toBe(expected);

      // Approbation, puis un passage du moteur : ce texte, et lui seul, part.
      const approved = await approve(token, proposed.executionId!);
      expect(approved.body.success, JSON.stringify(approved.body)).toBe(true);
      const [enrollment] = await enrollmentsOfSequence(sequenceId);
      expect(enrollment).toMatchObject({
        profile_name: 'Claire Dubois',
        profile_headline: 'Lead Developer chez Qonto',
        job_title: 'Senior Backend Engineer',
        company_name: 'Qonto',
      });
      await pullDue([enrollment.id]);
      await runCycle();
      const sent = await newChatsTo(accountId, candidate);
      expect(sent).toHaveLength(1);
      expect(String((sent[0].body as Record<string, unknown>).text)).toBe(expected);
    });

    test('candidat absent de la mission : aperçu construit avec son seul nom, sans refus nouveau', async () => {
      const { org } = await sendingOrg('E2E 5a aperçu hors mission');
      track(org);
      const mission = await seedMission(org.orgId, org.owner.userId);
      const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour {{prenom}}, votre poste de {{poste_actuel}} m’intéresse.']);
      const proposed = proposeLikeChat(org.orgId, org.owner, 'enroll_in_sequence', {
        sequence_id: sequenceId, candidate_id: newProfileId(), profile_name: 'Marie Martin', job_id: mission,
      });
      expect(proposed.outcome, JSON.stringify(proposed.payload)).toBe('awaiting_approval');
      const preview = proposed.payload.details?.first_step_preview as FirstStepPreviewPayload;
      expect(preview.candidate_in_mission).toBe(false);
      expect(preview.texts[0].text).toBe('Bonjour Marie, votre poste de m’intéresse.');
      expect(preview.texts[0].missing).toEqual(['Poste actuel inconnu : retiré du message.']);
    });
  });

  test.describe('5a-sequence-ia-refusee', () => {
    test.describe.configure({ mode: 'serial' });
    test('@critical séquence avec un message rédigé par l’IA : refus rendu au modèle, et à l’approbation, aucune inscription', async () => {
      const { org, accountId } = await sendingOrg('E2E 5a séquence IA');
      track(org);
      const token = await tokenOf(org.owner);
      const mission = await seedMission(org.orgId, org.owner.userId);
      const { sequenceId, steps } = await messageSequence(org, org.owner.userId, ['Bonjour {{first_name}}', 'Relance {{first_name}}']);
      await admin().from('sequence_steps').update({ use_ai_personalization: true }).eq('id', steps[1].id);
      const refusal = /message rédigé par l'IA pour chaque candidat : inscrivez ce candidat depuis l'écran/;

      // Chemin du chat : refus, raison rendue au modèle, aucune ligne proposée.
      const proposed = proposeLikeChat(org.orgId, org.owner, 'enroll_in_sequence', {
        sequence_id: sequenceId, candidate_id: newProfileId(), profile_name: 'Marie Martin', job_id: mission,
      });
      expect(proposed.outcome).toBe('denied');
      expect(String(proposed.payload.error)).toMatch(refusal);

      // Ligne déjà proposée (avant le lot 5a) puis approuvée : verifyAccess rejoué refuse.
      const res = await approve(token, await propose(org.orgId, org.owner.userId, 'enroll_in_sequence', {
        sequence_id: sequenceId, candidate_id: newProfileId(), profile_name: 'Paul Durand', job_id: mission,
      }));
      expect(res.body.success, JSON.stringify(res.body)).toBe(false);
      expect(String(res.body.error ?? '')).toMatch(refusal);
      expect(await enrollmentsOfSequence(sequenceId), 'aucune inscription').toEqual([]);
      expect(await postsFrom(accountId), 'aucun envoi').toEqual([]);
    });
  });
});

// ═══ Lot 5e : create_sequence réaligné ══════════════════════════════════════

/** dry_run_result.details de create_sequence : étapes au format de l'éditeur, textes entiers. */
interface CreateSequenceDetails {
  name: string;
  mission_id: string;
  steps: Array<{ actionType: string; conditionType: string; delayDays: number; messageTemplate: string; useAiPersonalization: boolean }>;
  flags: unknown[];
}

test.describe('@critical Assistant : create_sequence réaligné (lot 5e)', () => {
  test.describe('5e-cs-jamais-automatique', () => {
    test.describe.configure({ mode: 'serial' });
    test('@critical politique « auto » enregistrée : la séquence est proposée avec ses textes entiers, rien n’est créé avant l’approbation', async () => {
      const { org } = await sendingOrg('E2E 5e cs auto');
      track(org);
      const token = await tokenOf(org.owner);
      const mission = await seedMission(org.orgId, org.owner.userId);
      await setToolPolicy(org.orgId, 'create_sequence', 'auto');
      // Premier message long : la carte le porte en entier.
      const longFirst = `${CS_FIRST.replace('\n\n{{mon_prenom}}', '')} L’équipe compte douze personnes, le produit sert des milliers de clients et la feuille de route des deux prochaines années est ambitieuse, avec une refonte complète de la plateforme. Votre parcours m’a donné envie de vous en parler.\n\n{{mon_prenom}}`;
      expect(longFirst.length).toBeGreaterThan(350);

      const proposed = proposeLikeChat(org.orgId, org.owner, 'create_sequence', csParams(mission, { first_message: longFirst }));
      expect(proposed.outcome, JSON.stringify(proposed.payload)).toBe('awaiting_approval');
      expect((await execRow(proposed.executionId!)).status).toBe('proposed');
      expect((await admin().from('outreach_sequences').select('id').eq('organization_id', org.orgId)).data ?? [], 'rien de créé sans clic').toEqual([]);
      // La carte : forme du serveur, textes entiers, jamais d'IA à l'envoi.
      const { data: stored } = await admin().from('agent_tool_executions').select('dry_run_result').eq('id', proposed.executionId!).single();
      const details = (stored?.dry_run_result as { details?: CreateSequenceDetails } | null)?.details;
      expect(details?.mission_id).toBe(mission);
      expect(details?.steps.map((s) => [s.actionType, s.conditionType, s.delayDays])).toEqual([
        ['connection_request', 'always', 0], ['wait_connection', 'always', 0],
        ['message', 'if_connected', 0], ['message', 'if_connected', 4], ['message', 'if_connected', 7],
      ]);
      expect(details?.steps.map((s) => s.messageTemplate)).toEqual([CS_NOTE, '', longFirst, CS_RELANCE_1, CS_RELANCE_2]);
      expect(details?.steps.every((s) => s.useAiPersonalization === false)).toBe(true);

      // Le clic « Approuver » crée la séquence, par save_sequence_steps, avec ces textes.
      const approved = await approve(token, proposed.executionId!);
      expect(approved.body.success, JSON.stringify(approved.body)).toBe(true);
      const sequenceId = (approved.body.data as Record<string, unknown>).sequence_id as string;
      expect((await stepsOf(sequenceId)).map((s) => s.message_template ?? '')).toEqual([CS_NOTE, '', longFirst, CS_RELANCE_1, CS_RELANCE_2]);
      expect((await enrollmentsOfSequence(sequenceId)), 'aucune inscription').toEqual([]);
    });
  });

  test.describe('5e-cs-textes-controles', () => {
    test.describe.configure({ mode: 'serial' });
    test('@critical texte refusé par les contrôles de la rédaction : raison rendue au modèle avec le champ ; un texte modifié à l’approbation est contrôlé de nouveau', async () => {
      const { org } = await sendingOrg('E2E 5e cs contrôles');
      track(org);
      const token = await tokenOf(org.owner);
      const mission = await seedMission(org.orgId, org.owner.userId);

      // Chemin du chat : refus, raison rendue au modèle, aucune ligne proposée.
      const refused = proposeLikeChat(org.orgId, org.owner, 'create_sequence', csParams(mission, {
        first_message: 'Bonjour {{prenom}}, poste de {{poste_recherche}} à 75 k€ fixe. Cela vous parlerait-il ?\n\n{{mon_prenom}}',
        relance_2: 'Bonjour {{prenom}}, je reviens vers vous pour {{client}}.\n\n{{mon_prenom}}',
      }));
      expect(refused.outcome).toBe('denied');
      const reason = String(refused.payload.error);
      expect(reason).toMatch(/^Séquence refusée : corrigez ces textes puis proposez-la de nouveau\./);
      expect(reason).toContain('- first_message : il citait une rémunération.');
      expect(reason).toContain('- relance_2 : la variable {{client}} pourrait révéler le nom du client.');
      expect(refused.executionId).toBeUndefined();

      // Ligne proposée puis modifiée (« Modifier ») avec une rémunération : l'approbation la refuse.
      const res = await approve(token, await propose(org.orgId, org.owner.userId, 'create_sequence', csParams(mission, {
        relance_1: 'Bonjour {{prenom}}, le salaire de 75 k€ est négociable.\n\n{{mon_prenom}}',
      })));
      expect(res.body.success, JSON.stringify(res.body)).toBe(false);
      expect(String(res.body.error ?? '')).toContain('- relance_1 : il citait une rémunération.');
      expect((await admin().from('outreach_sequences').select('id').eq('organization_id', org.orgId)).data ?? [], 'aucune séquence').toEqual([]);
    });
  });

  test.describe('5e-cs-faits-fermes', () => {
    test.describe.configure({ mode: 'serial' });
    test('@critical brief avec rémunération et critères : la lecture ne rend que les faits fermés, les textes qui les citent sont refusés', async () => {
      const { org } = await sendingOrg('E2E 5e cs faits');
      track(org);
      const mission = await seedMission(org.orgId, org.owner.userId, {
        name: 'Directeur financier',
        job_details: {
          title: 'Directeur financier',
          mission_description: 'Piloter deux acquisitions et structurer la direction financière du groupe.',
          skills_must_have: ['Consolidation', 'IFRS'],
          salary_min: 55000,
          salary_max: 65000,
          evaluation_criteria: [{ id: 'c1', label: 'Gestion de crise bancaire', description: 'Rédhibitoire', category: 'experience', weight: 3, deal_breaker: true }],
          client: { name: 'Acme Industries', hiring_manager: { name: 'Hélène Martinez', email: 'h.martinez@acme.fr', phone: '06 11 22 33 44' } },
          target_companies: [{ category: 'Concurrents', companies: [{ name: 'Durand Métallurgie' }] }],
          outreach_config: { recruitment_mode: 'client', anonymize_client: true, anonymized_alias: 'un groupe industriel' },
        },
      });

      // Lecture du modèle de la conversation : liste fermée, alias du client.
      const read = proposeLikeChat(org.orgId, org.owner, 'get_sequence_draft_facts', { mission_id: mission });
      expect(read.outcome, JSON.stringify(read.payload)).toBe('executed_inline');
      const facts = JSON.stringify(read.payload);
      expect(read.payload.company).toBe('un groupe industriel');
      expect(facts).toContain('Piloter deux acquisitions');
      for (const secret of ['55000', '65000', 'Gestion de crise bancaire', 'Hélène Martinez', 'h.martinez', '0611223344', 'Durand Métallurgie', 'Acme']) {
        expect(facts, secret).not.toContain(secret);
      }

      // Textes qui reprennent ce que le modèle aurait lu dans le brief complet : refusés.
      const refused = proposeLikeChat(org.orgId, org.owner, 'create_sequence', csParams(mission, {
        first_message: 'Bonjour {{prenom}},\n\nPoste ouvert entre 55 000 et 65 000 selon le profil, dans une équipe en croissance. Cela vous parlerait-il ?\n\n{{mon_prenom}}',
        relance_1: 'Bonjour {{prenom}}, la Gestion de crise bancaire est au cœur du poste. Seriez-vous curieux d’en savoir plus ?\n\n{{mon_prenom}}',
        relance_2: 'Bonjour {{prenom}}, Hélène Martinez serait ravie d’échanger avec vous sur ce poste.\n\n{{mon_prenom}}',
      }));
      expect(refused.outcome).toBe('denied');
      const reason = String(refused.payload.error);
      expect(reason).toContain('- first_message : il citait une rémunération.');
      expect(reason).toContain("- relance_1 : il reprenait une information interne du poste (contact, entreprise ciblée, critère d'évaluation ou profil de référence).");
      expect(reason).toContain("- relance_2 : il reprenait une information interne du poste (contact, entreprise ciblée, critère d'évaluation ou profil de référence).");
      expect(refused.executionId).toBeUndefined();
      expect((await admin().from('outreach_sequences').select('id').eq('organization_id', org.orgId)).data ?? [], 'aucune séquence').toEqual([]);
    });
  });
});

// ═══ draft_outreach_message (correctif 3, lot 5e) ═══════════════════════════

test.describe('Assistant : draft_outreach_message (correctif 3)', () => {
  test('client anonymisé : le vrai nom n’atteint pas le modèle ; un brouillon qui tutoie est refusé, jetons débités', async () => {
    const { org } = await sendingOrg('E2E 5e brouillon');
    track(org);
    const token = await tokenOf(org.owner);
    cleanups.push(() => admin().from('ai_credit_transactions').delete().eq('organization_id', org.orgId));
    cleanups.push(() => admin().from('ai_credit_balances').delete().eq('organization_id', org.orgId));
    const end = new Date(Date.now() + 20 * 86_400_000).toISOString();
    const { error: creditsError } = await admin().from('ai_credit_balances').upsert({
      organization_id: org.orgId, plan_credits: 60, topup_credits: 0, credits_total: 60, credits_remaining: 60,
      period_start: new Date().toISOString(), period_end: end,
    }, { onConflict: 'organization_id' });
    expect(creditsError).toBeNull();
    const mission = await seedMission(org.orgId, org.owner.userId, {
      name: 'Directeur financier',
      client_name: 'Acme Holding',
      job_details: {
        title: 'Directeur financier',
        mission_description: 'Structurer la direction financière d’Acme Holding et piloter deux acquisitions.',
        skills_must_have: ['Consolidation'],
        salary_min: 55000,
        client: { name: 'Acme Industries' },
        outreach_config: { recruitment_mode: 'client', anonymize_client: true, anonymized_alias: 'un groupe industriel' },
      },
    });
    const marker = `Brouillon${rand()}`;
    const candidateId = await seedCandidate(org.orgId, org.owner.userId, { name: `Camille ${marker}`, projectId: mission });
    const key = `ai-${marker}`;
    await setMockMode(key, { ai_markers: { [marker]: JSON.stringify({ subject: null, body: 'Salut Camille, tu serais parfait pour ce poste de directeur financier. On en parle ?' }) } });
    cleanups.push(() => setMockMode(key, { ai_markers: {} }));

    const res = await approve(token, await propose(org.orgId, org.owner.userId, 'draft_outreach_message', {
      candidate_id: candidateId, job_id: mission, tone: 'casual', channel: 'linkedin_dm',
    }));
    expect(res.body.success, JSON.stringify(res.body)).toBe(false);
    expect(String(res.body.error ?? '')).toBe('Brouillon refusé : le texte tutoie le candidat ; les messages vouvoient. Demandez une nouvelle proposition.');

    // La consigne envoyée au modèle : alias du client, ni ses deux noms ni la rémunération ; ton vouvoyé.
    const calls = (await mockCalls()).filter((c) => c.method === 'POST' && c.path === '/v1/messages' && JSON.stringify(c.body).includes(marker));
    expect(calls).toHaveLength(1);
    const prompt = JSON.stringify(calls[0].body);
    expect(prompt).toContain('un groupe industriel');
    for (const secret of ['Acme Holding', 'Acme Industries', '55000']) expect(prompt, secret).not.toContain(secret);
    expect(prompt).toContain('chaleureux');
    expect(prompt).not.toMatch(/Ton: casual|en casual/);
    // Jetons consommés débités, brouillon refusé ou non.
    const { data: debits } = await admin().from('ai_credit_transactions').select('id').eq('organization_id', org.orgId).eq('action', 'outreach_message');
    expect(debits ?? []).toHaveLength(1);
  });
});
