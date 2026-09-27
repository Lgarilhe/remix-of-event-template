/**
 * Lot « scheduled-2 » du module séquences : actions de l'assistant approuvées
 * maintenant et exécutées plus tard par le cron process-scheduled-actions
 * (send_linkedin_message, enroll_in_sequence, pause_sequence,
 * resume_sequence). Entre l'approbation et l'échéance, le monde change
 * (compte dissocié ou déconnecté, plafond atteint, membre retiré ou
 * rétrogradé, séquence désactivée, offre expirée, doublon apparu) : le cron
 * rejoue verifyAccess avant execute (SEC-002) et doit refuser sans rien
 * écrire ni envoyer.
 *
 * Contrat : CLAUDE.md, section « Séquences : règles du moteur et de
 * l'interface », et docs/audit-2026-09-25-sequences.md (D1 à D6, registre).
 *
 * Harnais :
 * - approbation : ligne agent_tool_executions « proposed » insérée en clé de
 *   service, dont l'aperçu porte details.scheduled_for dans deux heures, puis
 *   POST agent-tool-action { approve } avec le JWT du membre (bouton
 *   « Approuver ») : la ligne passe « approved », programmée, sans exécution.
 *   Seul l'aperçu de send_linkedin_message pose scheduled_for (hors plage) ;
 *   pour enroll/pause/resume, le chemin générique de mise en file de
 *   confirmToolExecution est emprunté avec un aperçu qui le porte.
 * - échéance : scheduled_for ramené à il y a une minute, en dernier, puis
 *   POST process-scheduled-actions avec le secret du cron jusqu'à ce que la
 *   ligne ne soit plus « approved ».
 * - envoi : dimanche, checkLinkedInQuota refuse tout envoi le week-end dans le
 *   fuseau du membre, sans forçage. Les tests d'envoi posent une plage
 *   0 h-24 h dans un fuseau où l'on est un jour ouvré (Pacific/Kiritimati le
 *   dimanche après-midi UTC) ; sans fuseau possible ils s'ignorent.
 *
 * Ignoré sans la stack locale (e2e/local-stack/up.sh).
 */
import { test, expect } from '@playwright/test';
import {
  addMember,
  admin,
  deleteOrg,
  seedLinkedInAccount,
  seedMission,
  signIn,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import {
  CRON_SECRET,
  ENGINE_SKIP_REASON,
  callFunction,
  engineAvailable,
  messageSequence,
  minutesFromNow,
  mockCalls,
  postJson,
  rand,
  sendingOrg,
  type MockCall,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.setTimeout(300_000);

// ─── Textes du contrat (agent-tools.ts, agent-tools-mutations.ts) ───────────
const DENIED = "Accès refusé à l'exécution : ";
const RIGHTS_UNVERIFIED = "Vos droits n'ont pas pu être vérifiés. Réessayez dans un instant.";
const NO_ACCOUNT = "Aucun compte LinkedIn n'est relié à votre profil. Reliez-en un depuis Paramètres > Mon compte.";
const SEND_DISCONNECTED = "Votre compte LinkedIn est déconnecté : reconnectez-le dans Paramètres > Mon compte avant d'envoyer.";
const ENROLL_DISCONNECTED = "Votre compte LinkedIn est déconnecté. Reconnectez-le avant d'inscrire des candidats.";
const ENROLL_PLAN = "Votre offre actuelle ne permet pas l'envoi de séquences. Choisissez une offre pour inscrire des candidats.";
const RESUME_PLAN = "Votre offre actuelle ne permet pas l'envoi de séquences. Choisissez une offre pour réactiver cette séquence.";
const ENROLL_COLLAB =
  "Vous ne pouvez inscrire des candidats que dans vos propres séquences ou dans celles des missions dont vous faites partie de l'équipe.";
const PAUSE_COLLAB =
  "En tant que collaborateur, vous ne pouvez pas mettre en pause une séquence entière : cela mettrait en pause les candidats de toute l'équipe. Mettez vos candidats en pause un par un depuis la liste des inscrits.";
const RESUME_NOT_OWN = 'Vous ne pouvez réactiver que les séquences que vous avez créées.';
const RESUME_NEEDS_CHAT =
  "La réactivation de votre séquence doit être validée depuis la conversation avec l'assistant : relancez-la depuis le chat.";
const notLinked = (accountId: string) =>
  `Le compte LinkedIn ${accountId} n'est pas rattaché à votre profil dans cette organisation.`;

// ─── Ménage ─────────────────────────────────────────────────────────────────
const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
test.afterEach(async () => {
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    // Tables sans cascade utile (l'organisation elle-même survit, voir deleteOrg).
    for (const table of ['agent_tool_executions', 'member_quotas', 'organization_subscriptions', 'inmail_queue']) {
      await admin().from(table).delete().eq('organization_id', org.orgId);
    }
    await deleteOrg(org, extra);
  }
});
function track(org: TestOrg, ...extra: TestUser[]) {
  orgsToDelete.push({ org, extra });
  return org;
}

// ─── Aides ──────────────────────────────────────────────────────────────────
type Json = Record<string, any>;
type ToolResult = { success?: boolean; error?: string; data?: Json };

async function tokenOf(user: TestUser): Promise<string> {
  return (await signIn(user.email, user.password)).access_token;
}

const newProfileId = () => `ACoAAE2ES2${rand()}${rand()}`;

/**
 * Proposition de l'assistant, puis clic « Approuver » du membre : l'aperçu
 * porte une échéance dans deux heures, la ligne est donc programmée et non
 * exécutée. Renvoie l'identifiant de la ligne.
 */
async function approveForLater(
  orgId: string,
  user: TestUser,
  tool: string,
  params: Json,
  details: Json = {},
): Promise<string> {
  const { data, error } = await admin()
    .from('agent_tool_executions')
    .insert({
      user_id: user.userId,
      organization_id: orgId,
      tool_name: tool,
      params,
      status: 'proposed',
      dry_run_result: { summary: `Test e2e ${tool}`, details: { ...details, scheduled_for: minutesFromNow(120) } },
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`agent_tool_executions: ${error?.message}`);
  const id = data.id as string;
  const res = await callFunction('agent-tool-action', await tokenOf(user), { execution_id: id, action: 'approve' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect((res.body.data as Json | undefined)?.scheduled, 'approbation mise en file').toBe(true);
  const row = await execRow(id);
  expect(row.status).toBe('approved');
  expect(row.executed_at, 'rien n’est exécuté à l’approbation').toBeNull();
  return id;
}

interface ExecRow {
  status: string;
  real_result: ToolResult | null;
  scheduled_for: string | null;
  executed_at: string | null;
}

async function execRow(id: string): Promise<ExecRow> {
  const { data } = await admin()
    .from('agent_tool_executions')
    .select('status, real_result, scheduled_for, executed_at')
    .eq('id', id)
    .single();
  return data as ExecRow;
}

function cronScheduled() {
  return postJson('/functions/v1/process-scheduled-actions', {}, { Authorization: `Bearer ${CRON_SECRET}` });
}

/** L'échéance arrive (en dernier), puis passages du cron jusqu'au traitement de la ligne. */
async function runWhenDue(id: string): Promise<ExecRow> {
  await admin().from('agent_tool_executions').update({ scheduled_for: minutesFromNow(-1) }).eq('id', id);
  for (let attempt = 0; attempt < 12; attempt++) {
    const res = await cronScheduled();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await execRow(id);
    if (row.status !== 'approved') return row;
  }
  throw new Error('action programmée jamais traitée par process-scheduled-actions');
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
async function openBusinessHours(orgId: string, userId: string, extra: Json = {}) {
  const { error } = await admin().from('member_quotas').upsert(
    { organization_id: orgId, user_id: userId, business_hours_start: 0, business_hours_end: 24, timezone: SEND_ZONE, ...extra },
    { onConflict: 'organization_id,user_id' },
  );
  if (error) throw new Error(`member_quotas: ${error.message}`);
}

/** Appels d'écriture reçus par le faux prestataire pour ce compte. */
async function postsFrom(accountId: string): Promise<MockCall[]> {
  return (await mockCalls(accountId)).filter((c) => c.method === 'POST');
}

async function newChatsTo(accountId: string, recipient: string): Promise<MockCall[]> {
  return (await mockCalls(accountId)).filter((c) => c.method === 'POST' && c.path === '/api/v1/chats'
    && (c.body as Json)?.attendees_ids === recipient);
}

async function mappingIdOf(accountId: string): Promise<string> {
  const { data } = await admin().from('member_linkedin_accounts').select('id').eq('linkedin_account_id', accountId).single();
  return data!.id as string;
}

async function setRole(orgId: string, userId: string, role: string) {
  const { data, error } = await admin().from('organization_members').update({ role })
    .eq('organization_id', orgId).eq('user_id', userId).select('id');
  if (error || (data ?? []).length !== 1) throw new Error(`rôle ${role} : ${error?.message ?? 'aucune ligne'}`);
}

async function removeMembership(orgId: string, userId: string) {
  const { data, error } = await admin().from('organization_members').delete()
    .eq('organization_id', orgId).eq('user_id', userId).select('id');
  if (error || (data ?? []).length !== 1) throw new Error(`retrait du membre : ${error?.message ?? 'aucune ligne'}`);
}

/** Inscriptions de ce candidat dans l'organisation (toutes séquences). */
async function enrollmentsOf(orgId: string, candidateId: string) {
  const { data } = await admin().from('sequence_enrollments')
    .select('id, sequence_id, account_id, created_by, status')
    .eq('organization_id', orgId).eq('provider_id', candidateId);
  return (data ?? []) as Array<{ id: string; sequence_id: string; account_id: string | null; created_by: string; status: string }>;
}

async function executionCountOf(enrollmentIds: string[]): Promise<number> {
  if (enrollmentIds.length === 0) return 0;
  const { count } = await admin().from('sequence_step_executions').select('id', { count: 'exact', head: true })
    .in('enrollment_id', enrollmentIds);
  return count ?? 0;
}

async function sequenceState(sequenceId: string) {
  const { data } = await admin().from('outreach_sequences').select('name, is_active').eq('id', sequenceId).single();
  return data as { name: string; is_active: boolean };
}

async function enrollmentStates(ids: string[]) {
  const { data } = await admin().from('sequence_enrollments').select('id, status, pause_reason').in('id', ids);
  return Object.fromEntries(((data ?? []) as Array<{ id: string; status: string; pause_reason: string | null }>)
    .map((r) => [r.id, `${r.status}/${r.pause_reason ?? '-'}`]));
}

/** Inscription seedée (hors outil), profil au format provider_id. */
async function seedEnrollment(org: TestOrg, sequenceId: string, createdBy: string, accountId: string, overrides: Json = {}) {
  const profileId = (overrides.profile_id as string | undefined) ?? newProfileId();
  const { data, error } = await admin().from('sequence_enrollments').insert({
    sequence_id: sequenceId,
    organization_id: org.orgId,
    created_by: createdBy,
    profile_id: profileId,
    provider_id: profileId,
    profile_name: 'Camille Martin',
    account_id: accountId,
    status: 'active',
    current_step_order: 0,
    user_timezone: 'Europe/Paris',
    ...overrides,
  }).select('id').single();
  if (error || !data) throw new Error(`seedEnrollment: ${error?.message}`);
  return data.id as string;
}

async function setSubscription(orgId: string, patch: Json) {
  const { error } = await admin().from('organization_subscriptions')
    .upsert({ organization_id: orgId, stripe_subscription_id: null, trial_ends_at: null, ...patch }, { onConflict: 'organization_id' });
  if (error) throw new Error(`organization_subscriptions: ${error.message}`);
}
const EXPIRED_TRIAL = () => ({ plan_id: 'cabinet', status: 'trialing', trial_ends_at: new Date(Date.now() - 86_400_000).toISOString() });

/** Mission et séquence d'un message rattachée à la mission, créée par `createdBy`. */
async function missionSequence(org: TestOrg, createdBy: string) {
  const missionId = await seedMission(org.orgId, org.owner.userId);
  const { sequenceId, steps } = await messageSequence(org, createdBy, ['Bonjour {{first_name}}']);
  await admin().from('outreach_sequences').update({ project_id: missionId }).eq('id', sequenceId);
  return { missionId, sequenceId, steps };
}

const TEXT = 'Bonjour, je reviens vers vous au sujet du poste.';

// ════════════════════════════════════════════════════════════════════════════
// send_linkedin_message programmé
// ════════════════════════════════════════════════════════════════════════════
test.describe('Assistant : message LinkedIn programmé, rejoué à l’échéance', () => {
  test.describe.configure({ mode: 'serial' });

  // envoi-compte-dissocie-a-l-execution (a)
  test('compte choisi explicitement puis « Dissocier » avant l’échéance : échec « non rattaché », rien ne part', async () => {
    test.skip(!SEND_ZONE, NO_WEEKDAY_REASON);
    const { org, accountId } = await sendingOrg('E2E S2 dissocier');
    track(org);
    await openBusinessHours(org.orgId, org.owner.userId);
    const recipient = newProfileId();
    const id = await approveForLater(org.orgId, org.owner, 'send_linkedin_message',
      { account_id: accountId, recipient_provider_id: recipient, text: TEXT },
      { account_id: accountId, account_auto_resolved: false });

    const unlink = await callFunction('unipile-accounts', await tokenOf(org.owner), {
      action: 'unlink_linkedin_account', organization_id: org.orgId, mapping_id: await mappingIdOf(accountId), expected_account_id: accountId,
    });
    expect(unlink.status, JSON.stringify(unlink.body)).toBe(200);
    expect(unlink.body.removed).toBe(1);

    const row = await runWhenDue(id);
    expect(row.status, JSON.stringify(row.real_result)).toBe('failed');
    expect(row.real_result?.error).toBe(DENIED + notLinked(accountId));
    expect(await postsFrom(accountId), 'aucun envoi depuis le compte dissocié').toEqual([]);
  });

  // envoi-compte-dissocie-a-l-execution (b)
  test('compte implicite, membre retiré par l’écran Équipe (stop_member_linkedin puis retrait) avant l’échéance : échec « aucun compte », rien ne part', async () => {
    test.skip(!SEND_ZONE, NO_WEEKDAY_REASON);
    const { org } = await sendingOrg('E2E S2 retrait équipe');
    const member = await addMember(org.orgId, 'member', 'membre');
    track(org, member);
    const memberAccount = await seedLinkedInAccount(org.orgId, member.userId, `acc_s2_${rand()}`, 'OK');
    await openBusinessHours(org.orgId, member.userId);
    const id = await approveForLater(org.orgId, member, 'send_linkedin_message',
      { recipient_provider_id: newProfileId(), text: TEXT },
      { account_id: memberAccount, account_auto_resolved: true });

    // Écran Équipe : arrêt des envois du membre, puis retrait de organization_members.
    const stop = await callFunction('unipile-accounts', await tokenOf(org.owner), {
      action: 'stop_member_linkedin', organization_id: org.orgId, member_user_id: member.userId,
    });
    expect(stop.status, JSON.stringify(stop.body)).toBe(200);
    expect(stop.body.removed_links).toBe(1);
    await removeMembership(org.orgId, member.userId);

    const row = await runWhenDue(id);
    expect(row.status, JSON.stringify(row.real_result)).toBe('failed');
    expect(row.real_result?.error).toBe(DENIED + NO_ACCOUNT);
    expect(await postsFrom(memberAccount), 'aucun envoi depuis le compte du membre retiré').toEqual([]);
  });

  // envoi-compte-change-en-silence (partie contractuelle : « ou échoue », jamais le compte d'un collègue)
  test('compte affiché à l’approbation passé déconnecté avant l’échéance : échec, rien ne part ni de ce compte ni de celui d’un collègue', async () => {
    test.skip(!SEND_ZONE, NO_WEEKDAY_REASON);
    const { org, accountId } = await sendingOrg('E2E S2 compte déconnecté');
    const colleague = await addMember(org.orgId, 'member', 'collegue');
    track(org, colleague);
    const colleagueAccount = await seedLinkedInAccount(org.orgId, colleague.userId, `acc_s2_${rand()}`, 'OK');
    await openBusinessHours(org.orgId, org.owner.userId);
    const id = await approveForLater(org.orgId, org.owner, 'send_linkedin_message',
      { recipient_provider_id: newProfileId(), text: TEXT },
      { account_id: accountId, account_auto_resolved: true });

    await admin().from('member_linkedin_accounts').update({ account_status: 'CREDENTIALS' }).eq('linkedin_account_id', accountId);

    const row = await runWhenDue(id);
    expect(row.status, JSON.stringify(row.real_result)).toBe('failed');
    expect(row.real_result?.error).toBe(DENIED + SEND_DISCONNECTED);
    expect(await postsFrom(accountId), 'rien ne part du compte déconnecté').toEqual([]);
    expect(await postsFrom(colleagueAccount), 'rien ne part du compte du collègue').toEqual([]);
  });

  // envoi-compte-change-en-silence (décision produit : l'utilisateur a relié un autre compte avant l'échéance)
  // member_linkedin_accounts est unique par (organisation, utilisateur) : les « deux comptes A et B » de
  // l'inventaire n'existent pas ; le seul changement possible est le remplacement de la liaison. Le
  // contrat (SEQ-041) interdit tout envoi depuis le compte quitté ; il ne dit pas si le message doit
  // suivre le nouveau compte ou échouer. Le test n'affirme que la partie contractuelle et note le reste.
  test('liaison remplacée par un autre compte avant l’échéance : rien ne part du compte quitté (comportement du nouveau compte noté, décision produit)', async () => {
    test.skip(!SEND_ZONE, NO_WEEKDAY_REASON);
    const { org, accountId } = await sendingOrg('E2E S2 compte remplacé');
    track(org);
    await openBusinessHours(org.orgId, org.owner.userId);
    const recipient = newProfileId();
    const id = await approveForLater(org.orgId, org.owner, 'send_linkedin_message',
      { recipient_provider_id: recipient, text: TEXT },
      { account_id: accountId, account_auto_resolved: true });

    // Même écriture que claim_linkedin_account sur la ligne existante (upsert organisation, utilisateur).
    const newAccount = `acc_s2_${rand()}`;
    const { error } = await admin().from('member_linkedin_accounts')
      .update({ linkedin_account_id: newAccount, linked_at: new Date().toISOString(), account_status: 'OK' })
      .eq('linkedin_account_id', accountId);
    expect(error).toBeNull();

    const row = await runWhenDue(id);
    expect(await postsFrom(accountId), 'rien ne part du compte quitté').toEqual([]);
    const fromNew = await newChatsTo(newAccount, recipient);
    test.info().annotations.push({
      type: 'décision',
      description: `statut=${row.status}, envois depuis le nouveau compte=${fromNew.length}, résultat=${JSON.stringify(row.real_result)}`,
    });
    console.log(`[envoi-compte-change-en-silence] statut=${row.status} envois_nouveau_compte=${fromNew.length} résultat=${JSON.stringify(row.real_result)}`);
  });

  // envoi-plafond-atteint-a-l-execution
  test('plafond du jour atteint entre l’approbation et l’échéance : échec avec le motif du quota, rien ne part, aucune reprogrammation', async () => {
    test.skip(!SEND_ZONE, NO_WEEKDAY_REASON);
    const { org, accountId } = await sendingOrg('E2E S2 plafond');
    track(org);
    // Compte mature (pas de palier de montée en charge) et plafond de deux actions par jour.
    await admin().from('member_linkedin_accounts').update({ linked_at: '2026-01-01T00:00:00Z' }).eq('linkedin_account_id', accountId);
    await openBusinessHours(org.orgId, org.owner.userId, { max_actions_per_day: 2 });
    const { error: logError } = await admin().from('linkedin_action_log').insert({
      organization_id: org.orgId, user_id: org.owner.userId, account_id: accountId, action_type: 'message', source: 'sequence',
    });
    expect(logError).toBeNull();

    // Deux messages approuvés alors qu'il reste une action sur deux.
    const first = newProfileId();
    const second = newProfileId();
    const firstId = await approveForLater(org.orgId, org.owner, 'send_linkedin_message', { recipient_provider_id: first, text: TEXT });
    const secondId = await approveForLater(org.orgId, org.owner, 'send_linkedin_message', { recipient_provider_id: second, text: TEXT });

    // Témoin : le premier part et consomme la dernière action du jour.
    const firstRow = await runWhenDue(firstId);
    expect(firstRow.status, JSON.stringify(firstRow.real_result)).toBe('executed');
    expect(await newChatsTo(accountId, first)).toHaveLength(1);

    const row = await runWhenDue(secondId);
    expect(row.status, JSON.stringify(row.real_result)).toBe('failed');
    expect(row.real_result?.error).toBe('Cap journalier actions LinkedIn atteint (2/2).');
    expect(await newChatsTo(accountId, second), 'rien ne part au-delà du plafond').toHaveLength(0);
    const { count } = await admin().from('linkedin_action_log').select('id', { count: 'exact', head: true }).eq('account_id', accountId);
    expect(count, 'le refus ne consomme pas d’action').toBe(2);

    // Pas de reprogrammation : un second passage ne reprend pas la ligne.
    const again = await cronScheduled();
    expect(again.status).toBe(200);
    expect(((again.body.results as Array<{ id: string }> | undefined) ?? []).map((r) => r.id)).not.toContain(secondId);
    const after = await execRow(secondId);
    expect(after.status).toBe('failed');
    expect(after.scheduled_for).toBe(row.scheduled_for);
    expect(await newChatsTo(accountId, second)).toHaveLength(0);
  });

  // envoi-membre-retire
  test('membre retiré de l’organisation (liaison LinkedIn restée) avant l’échéance : le message ne part jamais', async () => {
    test.skip(!SEND_ZONE, NO_WEEKDAY_REASON);
    const { org } = await sendingOrg('E2E S2 membre retiré');
    const member = await addMember(org.orgId, 'member', 'membre');
    track(org, member);
    const memberAccount = await seedLinkedInAccount(org.orgId, member.userId, `acc_s2_${rand()}`, 'OK');
    await openBusinessHours(org.orgId, member.userId);
    const recipient = newProfileId();
    const id = await approveForLater(org.orgId, member, 'send_linkedin_message',
      { recipient_provider_id: recipient, text: TEXT },
      { account_id: memberAccount, account_auto_resolved: true });

    // Retrait hors écran Équipe : la liaison member_linkedin_accounts reste en place.
    await removeMembership(org.orgId, member.userId);

    const row = await runWhenDue(id);
    // DÉFAUT s2-envoi-non-membre : send_linkedin_message ne vérifie pas l'appartenance à l'organisation, et unipile-search ne la contrôle pas sur un appel interne en clé de service.
    expect.soft(await newChatsTo(memberAccount, recipient), 'aucun envoi pour un non-membre').toHaveLength(0);
    expect.soft(row.status, JSON.stringify(row.real_result)).toBe('failed');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// enroll_in_sequence programmé
// ════════════════════════════════════════════════════════════════════════════
test.describe('Assistant : inscription programmée, rejouée à l’échéance', () => {
  test.describe.configure({ mode: 'serial' });

  // inscription-sequence-desactivee
  test('séquence désactivée entre l’approbation et l’échéance : refus (D1), aucune inscription ni exécution', async () => {
    const { org } = await sendingOrg('E2E S2 inscription séquence désactivée');
    track(org);
    const { missionId, sequenceId } = await missionSequence(org, org.owner.userId);
    const candidate = newProfileId();
    const id = await approveForLater(org.orgId, org.owner, 'enroll_in_sequence',
      { sequence_id: sequenceId, candidate_id: candidate, job_id: missionId, profile_name: 'Marie Martin' });

    await admin().from('outreach_sequences').update({ is_active: false }).eq('id', sequenceId);
    const { name } = await sequenceState(sequenceId);

    const row = await runWhenDue(id);
    expect(row.status, JSON.stringify(row.real_result)).toBe('failed');
    expect(row.real_result?.error).toBe(`${DENIED}La séquence "${name}" est désactivée`);
    const enrollments = await enrollmentsOf(org.orgId, candidate);
    expect(enrollments, 'aucune inscription').toEqual([]);
    expect(await executionCountOf(enrollments.map((e) => e.id))).toBe(0);
  });

  // inscription-role-retrograde (a)
  test('admin devenu collaborateur, hors équipe de la mission : refus sur la séquence d’un collègue ; ajouté à l’équipe : inscription créée depuis son compte', async () => {
    const { org } = await sendingOrg('E2E S2 inscription rétrogradé');
    const adminUser = await addMember(org.orgId, 'admin', 'admin');
    track(org, adminUser);
    const adminAccount = await seedLinkedInAccount(org.orgId, adminUser.userId, `acc_s2_${rand()}`, 'OK');
    const { missionId, sequenceId } = await missionSequence(org, org.owner.userId);
    const refused = newProfileId();
    const accepted = newProfileId();
    const refusedId = await approveForLater(org.orgId, adminUser, 'enroll_in_sequence',
      { sequence_id: sequenceId, candidate_id: refused, job_id: missionId, profile_name: 'Marie Martin' });
    const acceptedId = await approveForLater(org.orgId, adminUser, 'enroll_in_sequence',
      { sequence_id: sequenceId, candidate_id: accepted, job_id: missionId, profile_name: 'Paul Durand' });

    await setRole(org.orgId, adminUser.userId, 'collaborator');

    const row = await runWhenDue(refusedId);
    expect(row.status, JSON.stringify(row.real_result)).toBe('failed');
    expect(row.real_result?.error).toBe(DENIED + ENROLL_COLLAB);
    expect(await enrollmentsOf(org.orgId, refused)).toEqual([]);

    // Collaborateur membre de l'équipe de la mission de la séquence : autorisé (D3).
    const { error } = await admin().from('mission_team').insert({ project_id: missionId, user_id: adminUser.userId, role: 'sourcer' });
    expect(error).toBeNull();
    const ok = await runWhenDue(acceptedId);
    expect(ok.status, JSON.stringify(ok.real_result)).toBe('executed');
    const created = await enrollmentsOf(org.orgId, accepted);
    expect(created.map((e) => [e.sequence_id, e.account_id, e.created_by])).toEqual([[sequenceId, adminAccount, adminUser.userId]]);
  });

  // inscription-role-retrograde (b)
  test('dérogation force: true approuvée par un admin devenu membre : refus, aucune inscription', async () => {
    const { org, accountId } = await sendingOrg('E2E S2 inscription force rétrogradé');
    const adminUser = await addMember(org.orgId, 'admin', 'admin');
    track(org, adminUser);
    await seedLinkedInAccount(org.orgId, adminUser.userId, `acc_s2_${rand()}`, 'OK');
    const { missionId, sequenceId } = await missionSequence(org, org.owner.userId);
    const candidate = newProfileId();
    // Contact récent de l'organisation : le propriétaire, dans une autre séquence, il y a 10 jours.
    const other = await messageSequence(org, org.owner.userId, ['Bonjour']);
    await seedEnrollment(org, other.sequenceId, org.owner.userId, accountId, {
      profile_id: candidate, created_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    });
    const id = await approveForLater(org.orgId, adminUser, 'enroll_in_sequence',
      { sequence_id: sequenceId, candidate_id: candidate, job_id: missionId, profile_name: 'Marie Martin', force: true });

    await setRole(org.orgId, adminUser.userId, 'member');

    const row = await runWhenDue(id);
    expect(row.status, JSON.stringify(row.real_result)).toBe('failed');
    expect(String(row.real_result?.error)).toContain(DENIED);
    expect(String(row.real_result?.error)).toContain('La dérogation force: true est réservée aux propriétaires et administrateurs.');
    expect((await enrollmentsOf(org.orgId, candidate)).map((e) => e.sequence_id), 'seule l’inscription d’origine').toEqual([other.sequenceId]);
  });

  // inscription-role-retrograde (c)
  test('approbateur retiré de l’organisation avant l’échéance : droits non vérifiés, refus, aucune inscription', async () => {
    const { org } = await sendingOrg('E2E S2 inscription non-membre');
    const adminUser = await addMember(org.orgId, 'admin', 'admin');
    track(org, adminUser);
    await seedLinkedInAccount(org.orgId, adminUser.userId, `acc_s2_${rand()}`, 'OK');
    const { missionId, sequenceId } = await missionSequence(org, org.owner.userId);
    const candidate = newProfileId();
    const id = await approveForLater(org.orgId, adminUser, 'enroll_in_sequence',
      { sequence_id: sequenceId, candidate_id: candidate, job_id: missionId, profile_name: 'Marie Martin' });

    await removeMembership(org.orgId, adminUser.userId);

    const row = await runWhenDue(id);
    expect(row.status, JSON.stringify(row.real_result)).toBe('failed');
    expect(row.real_result?.error).toBe(DENIED + RIGHTS_UNVERIFIED);
    expect(await enrollmentsOf(org.orgId, candidate)).toEqual([]);
  });

  // inscription-offre-a-l-execution
  test('offre revérifiée à l’échéance : essai expiré puis plan gratuit depuis l’approbation, refus, aucune inscription', async () => {
    const { org } = await sendingOrg('E2E S2 inscription offre');
    track(org);
    const { missionId, sequenceId } = await missionSequence(org, org.owner.userId);
    const underTrial = newProfileId();
    const underFree = newProfileId();
    const trialId = await approveForLater(org.orgId, org.owner, 'enroll_in_sequence',
      { sequence_id: sequenceId, candidate_id: underTrial, job_id: missionId, profile_name: 'Marie Martin' });
    const freeId = await approveForLater(org.orgId, org.owner, 'enroll_in_sequence',
      { sequence_id: sequenceId, candidate_id: underFree, job_id: missionId, profile_name: 'Paul Durand' });

    await setSubscription(org.orgId, EXPIRED_TRIAL());
    const trialRow = await runWhenDue(trialId);
    expect(trialRow.status, JSON.stringify(trialRow.real_result)).toBe('failed');
    expect(trialRow.real_result?.error).toBe(DENIED + ENROLL_PLAN);
    expect(await enrollmentsOf(org.orgId, underTrial)).toEqual([]);

    await setSubscription(org.orgId, { plan_id: 'free', status: 'active' });
    const freeRow = await runWhenDue(freeId);
    expect(freeRow.status, JSON.stringify(freeRow.real_result)).toBe('failed');
    expect(freeRow.real_result?.error).toBe(DENIED + ENROLL_PLAN);
    expect(await enrollmentsOf(org.orgId, underFree)).toEqual([]);
  });

  // inscription-compte-a-l-execution (a) et (b)
  test('compte de l’approbateur déconnecté, puis liaison dissociée alors qu’un collègue a un compte OK : refus, aucune inscription', async () => {
    const { org, accountId } = await sendingOrg('E2E S2 inscription compte');
    const colleague = await addMember(org.orgId, 'member', 'collegue');
    track(org, colleague);
    const colleagueAccount = await seedLinkedInAccount(org.orgId, colleague.userId, `acc_s2_${rand()}`, 'OK');
    const { missionId, sequenceId } = await missionSequence(org, org.owner.userId);
    const whenDisconnected = newProfileId();
    const whenUnlinked = newProfileId();
    const disconnectedId = await approveForLater(org.orgId, org.owner, 'enroll_in_sequence',
      { sequence_id: sequenceId, candidate_id: whenDisconnected, job_id: missionId, profile_name: 'Marie Martin' });
    const unlinkedId = await approveForLater(org.orgId, org.owner, 'enroll_in_sequence',
      { sequence_id: sequenceId, candidate_id: whenUnlinked, job_id: missionId, profile_name: 'Paul Durand' });

    await admin().from('member_linkedin_accounts').update({ account_status: 'CREDENTIALS' }).eq('linkedin_account_id', accountId);
    const disconnected = await runWhenDue(disconnectedId);
    expect(disconnected.status, JSON.stringify(disconnected.real_result)).toBe('failed');
    expect(disconnected.real_result?.error).toBe(DENIED + ENROLL_DISCONNECTED);
    expect(await enrollmentsOf(org.orgId, whenDisconnected)).toEqual([]);

    const unlink = await callFunction('unipile-accounts', await tokenOf(org.owner), {
      action: 'unlink_linkedin_account', organization_id: org.orgId, mapping_id: await mappingIdOf(accountId), expected_account_id: accountId,
    });
    expect(unlink.status, JSON.stringify(unlink.body)).toBe(200);
    const unlinked = await runWhenDue(unlinkedId);
    expect(unlinked.status, JSON.stringify(unlinked.real_result)).toBe('failed');
    expect(unlinked.real_result?.error).toBe(DENIED + NO_ACCOUNT);
    expect(await enrollmentsOf(org.orgId, whenUnlinked), 'jamais inscrit depuis le compte du collègue').toEqual([]);
    const { count } = await admin().from('sequence_enrollments').select('id', { count: 'exact', head: true }).eq('account_id', colleagueAccount);
    expect(count).toBe(0);
  });

  // inscription-compte-a-l-execution (c)
  test('nominal : l’inscription créée porte le compte relié de l’approbateur ; un account_id de collègue est refusé', async () => {
    const { org, accountId: ownerAccount } = await sendingOrg('E2E S2 inscription compte nominal');
    const adminUser = await addMember(org.orgId, 'admin', 'admin');
    track(org, adminUser);
    const adminAccount = await seedLinkedInAccount(org.orgId, adminUser.userId, `acc_s2_${rand()}`, 'OK');
    const { missionId, sequenceId } = await missionSequence(org, org.owner.userId);
    const implicit = newProfileId();
    const colleagueAcc = newProfileId();
    const implicitId = await approveForLater(org.orgId, adminUser, 'enroll_in_sequence',
      { sequence_id: sequenceId, candidate_id: implicit, job_id: missionId, profile_name: 'Marie Martin' });
    const foreignId = await approveForLater(org.orgId, adminUser, 'enroll_in_sequence',
      { sequence_id: sequenceId, candidate_id: colleagueAcc, job_id: missionId, profile_name: 'Paul Durand', account_id: ownerAccount });

    const ok = await runWhenDue(implicitId);
    expect(ok.status, JSON.stringify(ok.real_result)).toBe('executed');
    expect((ok.real_result?.data?.sending_account as Json | undefined)?.account_id).toBe(adminAccount);
    const created = await enrollmentsOf(org.orgId, implicit);
    expect(created.map((e) => [e.account_id, e.created_by])).toEqual([[adminAccount, adminUser.userId]]);
    expect(await executionCountOf(created.map((e) => e.id)), 'première étape planifiée').toBe(1);

    const foreign = await runWhenDue(foreignId);
    expect(foreign.status, JSON.stringify(foreign.real_result)).toBe('failed');
    expect(foreign.real_result?.error).toBe(DENIED + notLinked(ownerAccount));
    expect(await enrollmentsOf(org.orgId, colleagueAcc)).toEqual([]);
  });

  // inscription-doublon-a-l-execution
  test('anti-doublon rejoué à l’échéance : déjà inscrit dans la séquence ou contacté par un collègue il y a 10 jours → refus ; force: true par le propriétaire → inscrit par dérogation', async () => {
    const { org, accountId: ownerAccount } = await sendingOrg('E2E S2 inscription doublon');
    const colleague = await addMember(org.orgId, 'member', 'collegue');
    track(org, colleague);
    const colleagueAccount = await seedLinkedInAccount(org.orgId, colleague.userId, `acc_s2_${rand()}`, 'OK');
    const { missionId, sequenceId } = await missionSequence(org, org.owner.userId);
    const colleagueSeq = await messageSequence(org, colleague.userId, ['Bonjour']);
    const sameSeq = newProfileId();
    const contacted = newProfileId();
    const forced = newProfileId();
    const enrollParams = (candidate: string, extra: Json = {}) =>
      ({ sequence_id: sequenceId, candidate_id: candidate, job_id: missionId, profile_name: 'Marie Martin', ...extra });
    const sameSeqId = await approveForLater(org.orgId, org.owner, 'enroll_in_sequence', enrollParams(sameSeq));
    const contactedId = await approveForLater(org.orgId, org.owner, 'enroll_in_sequence', enrollParams(contacted));
    const forcedId = await approveForLater(org.orgId, org.owner, 'enroll_in_sequence', enrollParams(forced, { force: true }));

    // Entre l'approbation et l'échéance : le collègue inscrit P1 dans la même séquence, et P2, P3 dans la sienne (il y a 10 jours).
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    await seedEnrollment(org, sequenceId, colleague.userId, colleagueAccount, { profile_id: sameSeq });
    await seedEnrollment(org, colleagueSeq.sequenceId, colleague.userId, colleagueAccount, { profile_id: contacted, created_at: tenDaysAgo });
    await seedEnrollment(org, colleagueSeq.sequenceId, colleague.userId, colleagueAccount, { profile_id: forced, created_at: tenDaysAgo });

    const a = await runWhenDue(sameSeqId);
    expect(a.status, JSON.stringify(a.real_result)).toBe('failed');
    expect(String(a.real_result?.error)).toContain(DENIED);
    expect(String(a.real_result?.error)).toContain('est déjà inscrit dans cette séquence');
    expect((await enrollmentsOf(org.orgId, sameSeq)).map((e) => e.created_by), 'seule l’inscription du collègue').toEqual([colleague.userId]);

    const b = await runWhenDue(contactedId);
    expect(b.status, JSON.stringify(b.real_result)).toBe('failed');
    expect(String(b.real_result?.error)).toContain(DENIED);
    expect(String(b.real_result?.error)).toContain('Inscription refusée pour éviter un double contact');
    expect((await enrollmentsOf(org.orgId, contacted)).map((e) => e.sequence_id)).toEqual([colleagueSeq.sequenceId]);

    const c = await runWhenDue(forcedId);
    expect(c.status, JSON.stringify(c.real_result)).toBe('executed');
    expect(String(c.real_result?.data?.message)).toContain('inscrit par dérogation');
    const forcedRows = await enrollmentsOf(org.orgId, forced);
    expect(forcedRows.find((e) => e.sequence_id === sequenceId)?.account_id, 'inscrit depuis le compte du propriétaire').toBe(ownerAccount);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// pause_sequence et resume_sequence programmés
// ════════════════════════════════════════════════════════════════════════════
test.describe('Assistant : pause et réactivation de séquence programmées, rejouées à l’échéance', () => {
  test.describe.configure({ mode: 'serial' });

  // pause-role-a-l-execution
  test('mise en pause approuvée par un admin devenu collaborateur, ou retiré : refus, inscriptions toujours actives, séquence active', async () => {
    const { org, accountId } = await sendingOrg('E2E S2 pause rôle');
    const demoted = await addMember(org.orgId, 'admin', 'admin');
    const removed = await addMember(org.orgId, 'admin', 'admin2');
    track(org, demoted, removed);
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    const e1 = await seedEnrollment(org, sequenceId, org.owner.userId, accountId);
    const e2 = await seedEnrollment(org, sequenceId, org.owner.userId, accountId);
    const demotedId = await approveForLater(org.orgId, demoted, 'pause_sequence', { sequence_id: sequenceId });
    const removedId = await approveForLater(org.orgId, removed, 'pause_sequence', { sequence_id: sequenceId });
    const ownerId = await approveForLater(org.orgId, org.owner, 'pause_sequence', { sequence_id: sequenceId });

    await setRole(org.orgId, demoted.userId, 'collaborator');
    const a = await runWhenDue(demotedId);
    expect(a.status, JSON.stringify(a.real_result)).toBe('failed');
    expect(a.real_result?.error).toBe(DENIED + PAUSE_COLLAB);
    expect(await enrollmentStates([e1, e2])).toEqual({ [e1]: 'active/-', [e2]: 'active/-' });
    expect((await sequenceState(sequenceId)).is_active).toBe(true);

    await removeMembership(org.orgId, removed.userId);
    const b = await runWhenDue(removedId);
    expect(b.status, JSON.stringify(b.real_result)).toBe('failed');
    expect(b.real_result?.error).toBe(DENIED + RIGHTS_UNVERIFIED);
    expect(await enrollmentStates([e1, e2])).toEqual({ [e1]: 'active/-', [e2]: 'active/-' });
    expect((await sequenceState(sequenceId)).is_active).toBe(true);

    // Témoin : la même mise en pause approuvée par le propriétaire s'exécute au cron.
    const c = await runWhenDue(ownerId);
    expect(c.status, JSON.stringify(c.real_result)).toBe('executed');
    expect(await enrollmentStates([e1, e2])).toEqual({ [e1]: 'paused/sequence_inactive', [e2]: 'paused/sequence_inactive' });
    expect((await sequenceState(sequenceId)).is_active).toBe(false);
  });

  // reprise-collaborateur-jamais-par-cron
  test('réactivation par un collaborateur de sa propre séquence : jamais exécutée par le cron (pas de JWT), séquence inactive, inscription toujours en pause', async () => {
    const { org } = await sendingOrg('E2E S2 reprise collaborateur');
    const collab = await addMember(org.orgId, 'collaborator', 'collab');
    track(org, collab);
    const collabAccount = await seedLinkedInAccount(org.orgId, collab.userId, `acc_s2_${rand()}`, 'OK');
    const { sequenceId } = await messageSequence(org, collab.userId, ['Bonjour']);
    await admin().from('outreach_sequences').update({ is_active: false }).eq('id', sequenceId);
    const mine = await seedEnrollment(org, sequenceId, collab.userId, collabAccount, { status: 'paused', pause_reason: 'sequence_inactive' });
    const id = await approveForLater(org.orgId, collab, 'resume_sequence', { sequence_id: sequenceId });

    const row = await runWhenDue(id);
    expect(row.status, JSON.stringify(row.real_result)).toBe('failed');
    expect(row.real_result?.error).toBe(DENIED + RESUME_NEEDS_CHAT);
    expect((await sequenceState(sequenceId)).is_active).toBe(false);
    expect(await enrollmentStates([mine])).toEqual({ [mine]: 'paused/sequence_inactive' });
  });

  // reprise-offre-a-l-execution
  test('réactivation approuvée puis offre expirée (essai échu) ou plan gratuit : refus, séquence inactive, inscriptions toujours en pause', async () => {
    const { org, accountId } = await sendingOrg('E2E S2 reprise offre');
    track(org);
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    await admin().from('outreach_sequences').update({ is_active: false }).eq('id', sequenceId);
    const e1 = await seedEnrollment(org, sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'sequence_inactive' });
    const e2 = await seedEnrollment(org, sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'auto_paused' });
    const trialId = await approveForLater(org.orgId, org.owner, 'resume_sequence', { sequence_id: sequenceId });
    const freeId = await approveForLater(org.orgId, org.owner, 'resume_sequence', { sequence_id: sequenceId });

    await setSubscription(org.orgId, EXPIRED_TRIAL());
    const a = await runWhenDue(trialId);
    expect(a.status, JSON.stringify(a.real_result)).toBe('failed');
    expect(a.real_result?.error).toBe(DENIED + RESUME_PLAN);
    expect((await sequenceState(sequenceId)).is_active).toBe(false);
    expect(await enrollmentStates([e1, e2])).toEqual({ [e1]: 'paused/sequence_inactive', [e2]: 'paused/auto_paused' });

    await setSubscription(org.orgId, { plan_id: 'free', status: 'active' });
    const b = await runWhenDue(freeId);
    expect(b.status, JSON.stringify(b.real_result)).toBe('failed');
    expect(b.real_result?.error).toBe(DENIED + RESUME_PLAN);
    expect((await sequenceState(sequenceId)).is_active).toBe(false);
    expect(await enrollmentStates([e1, e2])).toEqual({ [e1]: 'paused/sequence_inactive', [e2]: 'paused/auto_paused' });
  });

  // reprise-role-retrograde
  test('réactivation approuvée par un admin devenu collaborateur, sur la séquence d’un collègue : refus, séquence inactive ; le propriétaire la réactive', async () => {
    const { org, accountId } = await sendingOrg('E2E S2 reprise rétrogradé');
    const adminUser = await addMember(org.orgId, 'admin', 'admin');
    track(org, adminUser);
    await seedLinkedInAccount(org.orgId, adminUser.userId, `acc_s2_${rand()}`, 'OK');
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour']);
    await admin().from('outreach_sequences').update({ is_active: false }).eq('id', sequenceId);
    const paused = await seedEnrollment(org, sequenceId, org.owner.userId, accountId, { status: 'paused', pause_reason: 'sequence_inactive' });
    const id = await approveForLater(org.orgId, adminUser, 'resume_sequence', { sequence_id: sequenceId });
    const ownerId = await approveForLater(org.orgId, org.owner, 'resume_sequence', { sequence_id: sequenceId });

    await setRole(org.orgId, adminUser.userId, 'collaborator');
    const row = await runWhenDue(id);
    expect(row.status, JSON.stringify(row.real_result)).toBe('failed');
    expect(row.real_result?.error).toBe(DENIED + RESUME_NOT_OWN);
    expect((await sequenceState(sequenceId)).is_active).toBe(false);
    expect(await enrollmentStates([paused])).toEqual({ [paused]: 'paused/sequence_inactive' });

    // Témoin : la réactivation approuvée par le propriétaire s'exécute au cron.
    const ok = await runWhenDue(ownerId);
    expect(ok.status, JSON.stringify(ok.real_result)).toBe('executed');
    expect((await sequenceState(sequenceId)).is_active).toBe(true);
    expect(await enrollmentStates([paused])).toEqual({ [paused]: 'active/-' });
  });
});
