/**
 * Lot « scheduled-1 » du module séquences : le cron process-scheduled-actions,
 * qui exécute les actions de l'assistant approuvées et programmées
 * (agent_tool_executions « approved », scheduled_for échu, executed_at NULL).
 * Authentification du cron, sélection des lignes échues, budget de 40 s,
 * réservations interrompues (SEQ-114), exécution unique sous concurrence,
 * identité et paramètres relus à l'exécution, annulation, compte déconnecté,
 * effacement RGPD entre l'approbation et l'échéance (D5, SEQ-054).
 *
 * Contrat : CLAUDE.md, section « Séquences : règles du moteur et de
 * l'interface », et docs/audit-2026-09-25-sequences.md (D1 à D6, registre).
 *
 * Harnais :
 * - lignes agent_tool_executions seedées en clé de service ; les échéances
 *   « il y a cinq ans » passent en tête de la sélection (tri par
 *   scheduled_for, lot de 10), devant d'éventuelles lignes d'autres suites ;
 * - une ligne n'est rendue échue qu'en dernier (règle de la stack partagée) ;
 * - POST process-scheduled-actions avec le secret du cron ;
 * - envoi : dimanche, checkLinkedInQuota refuse tout envoi le week-end dans le
 *   fuseau du membre, sans forçage. Les tests qui ont besoin d'un envoi réussi
 *   posent une plage 0 h-24 h dans un fuseau où l'on est un jour ouvré
 *   (Pacific/Kiritimati le dimanche après-midi UTC) ; sans fuseau possible,
 *   ils s'ignorent ;
 * - l'outil inexistant « outil_inexistant » échoue vite, sans appel externe,
 *   pour les tests de sélection et de budget.
 *
 * Ignoré sans la stack locale (e2e/local-stack/up.sh).
 */
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { E2E } from '../helpers/env';
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

// ─── Textes du contrat (process-scheduled-actions, agent-tools.ts, agent-tools-mutations.ts) ───
const DENIED = "Accès refusé à l'exécution : ";
const SEND_DISCONNECTED = "Votre compte LinkedIn est déconnecté : reconnectez-le dans Paramètres > Mon compte avant d'envoyer.";
const STALE = "Délai dépassé : l'action a pu partir, vérifiez avant de relancer";
const GDPR_ENROLL = "Ce candidat a demandé l'effacement de ses données : inscription impossible.";
const UNKNOWN_TOOL = 'outil_inexistant';
const notLinked = (accountId: string) =>
  `Le compte LinkedIn ${accountId} n'est pas rattaché à votre profil dans cette organisation.`;
/** Réponses d'un passage perdant (réservation atomique, agent-tools.ts). */
const LOSER_ERRORS = ['Already executing', 'Already executed', 'Cannot execute scheduled from status executed'];

// ─── Ménage ─────────────────────────────────────────────────────────────────
const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const erasureHashes: string[] = [];
test.afterEach(async () => {
  while (orgsToDelete.length) {
    const { org, extra } = orgsToDelete.pop()!;
    // Tables sans cascade utile (l'organisation elle-même survit, voir deleteOrg).
    for (const table of ['agent_tool_executions', 'agent_conversations', 'member_quotas', 'organization_subscriptions']) {
      await admin().from(table).delete().eq('organization_id', org.orgId);
    }
    await deleteOrg(org, extra);
  }
  for (const hash of erasureHashes.splice(0)) {
    await admin().from('gdpr_erasures').delete().eq('linkedin_url_hash', hash);
  }
});
function track(org: TestOrg, ...extra: TestUser[]) {
  orgsToDelete.push({ org, extra });
  return org;
}

// ─── Aides ──────────────────────────────────────────────────────────────────
type Json = Record<string, any>;

/** Échéance très ancienne : la ligne passe en tête de la sélection du cron (tri croissant, 10 lignes). */
const longAgo = (offsetSeconds = 0) => new Date(Date.now() - 5 * 365 * 86_400_000 + offsetSeconds * 1000).toISOString();
const newProfileId = () => `ACoAAE2ES1${rand()}${rand()}`;
const TEXT = 'Bonjour, je reviens vers vous au sujet du poste.';

async function tokenOf(user: TestUser): Promise<string> {
  return (await signIn(user.email, user.password)).access_token;
}

/** Client REST avec le JWT de l'utilisateur (comme le navigateur). */
async function userClient(user: TestUser): Promise<SupabaseClient> {
  const token = await tokenOf(user);
  return createClient(E2E.supabaseUrl, E2E.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function conversation(orgId: string, userId: string): Promise<string> {
  const { data, error } = await admin()
    .from('agent_conversations')
    .insert({ organization_id: orgId, created_by: userId, title: `Conversation e2e scheduled-1 ${rand()}` })
    .select('id')
    .single();
  if (error || !data) throw new Error(`agent_conversations: ${error?.message}`);
  return data.id as string;
}

interface ExecSeed {
  orgId: string;
  userId: string;
  tool: string;
  params?: Json;
  status?: string;
  scheduledFor?: string | null;
  approvedAt?: string | null;
  executedAt?: string | null;
  realResult?: Json | null;
  summary?: string;
  details?: Json;
  conversationId?: string | null;
}

async function seedExecution(s: ExecSeed): Promise<string> {
  const { data, error } = await admin()
    .from('agent_tool_executions')
    .insert({
      organization_id: s.orgId,
      user_id: s.userId,
      tool_name: s.tool,
      params: s.params ?? {},
      status: s.status ?? 'approved',
      scheduled_for: s.scheduledFor === undefined ? minutesFromNow(120) : s.scheduledFor,
      approved_at: s.approvedAt === undefined ? minutesFromNow(-30) : s.approvedAt,
      executed_at: s.executedAt ?? null,
      real_result: s.realResult ?? null,
      dry_run_result: { summary: s.summary ?? `Test e2e ${s.tool}`, details: s.details ?? {} },
      conversation_id: s.conversationId ?? null,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`agent_tool_executions: ${error?.message}`);
  return data.id as string;
}

interface ExecRow {
  id: string;
  status: string;
  real_result: Json | null;
  scheduled_for: string | null;
  approved_at: string | null;
  executed_at: string | null;
  updated_at: string;
}

async function execRow(id: string): Promise<ExecRow> {
  const { data, error } = await admin()
    .from('agent_tool_executions')
    .select('id, status, real_result, scheduled_for, approved_at, executed_at, updated_at')
    .eq('id', id)
    .single();
  if (error || !data) throw new Error(`execRow: ${error?.message}`);
  return data as ExecRow;
}

async function execRows(ids: string[]): Promise<Map<string, ExecRow>> {
  const { data, error } = await admin()
    .from('agent_tool_executions')
    .select('id, status, real_result, scheduled_for, approved_at, executed_at, updated_at')
    .in('id', ids);
  if (error) throw new Error(`execRows: ${error.message}`);
  return new Map(((data ?? []) as ExecRow[]).map((r) => [r.id, r]));
}

/** Rend une ligne échue (en dernier : un passage concurrent la prendrait). */
async function makeDue(id: string, scheduledFor = longAgo()) {
  const { error } = await admin().from('agent_tool_executions').update({ scheduled_for: scheduledFor }).eq('id', id);
  if (error) throw new Error(`makeDue: ${error.message}`);
}

function cron(token: string = CRON_SECRET) {
  return postJson('/functions/v1/process-scheduled-actions', {}, { Authorization: `Bearer ${token}` });
}

interface CronResult { id: string; tool: string; success: boolean; error?: string }
const resultsOf = (body: Json): CronResult[] => (Array.isArray(body.results) ? body.results : []) as CronResult[];

/** Passages du cron jusqu'à ce que la ligne ne soit plus « approved ». */
async function runUntilDone(id: string): Promise<{ row: ExecRow; bodies: Json[] }> {
  const bodies: Json[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    const res = await cron();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    bodies.push(res.body);
    const row = await execRow(id);
    if (row.status !== 'approved') return { row, bodies };
  }
  throw new Error('action programmée jamais traitée par process-scheduled-actions');
}

interface AgentMessage { id: string; role: string; content: string; metadata: Json | null }

async function messagesOf(conversationId: string): Promise<AgentMessage[]> {
  const { data } = await admin()
    .from('agent_messages')
    .select('id, role, content, metadata')
    .eq('conversation_id', conversationId)
    .order('created_at');
  return (data ?? []) as AgentMessage[];
}
const outcomeOf = (msgs: AgentMessage[], executionId: string) =>
  msgs.filter((m) => m.metadata?.agent_action_result?.execution_id === executionId);

/** Appels d'écriture reçus par le faux prestataire pour ce compte. */
async function postsFrom(accountId: string): Promise<MockCall[]> {
  return (await mockCalls(accountId)).filter((c) => c.method === 'POST');
}
async function newChatsTo(accountId: string, recipient: string): Promise<MockCall[]> {
  return (await mockCalls(accountId)).filter((c) => c.method === 'POST' && c.path === '/api/v1/chats'
    && (c.body as Json)?.attendees_ids === recipient);
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
  if (!SEND_ZONE) return;
  const { error } = await admin().from('member_quotas').upsert(
    { organization_id: orgId, user_id: userId, business_hours_start: 0, business_hours_end: 24, timezone: SEND_ZONE },
    { onConflict: 'organization_id,user_id' },
  );
  if (error) throw new Error(`member_quotas: ${error.message}`);
}

/** Organisation qui envoie : offre payante, compte OK du propriétaire, plage ouverte, conversation. */
async function sendingWorkspace(label: string) {
  const { org, accountId } = await sendingOrg(label);
  track(org);
  await openBusinessHours(org.orgId, org.owner.userId);
  const conversationId = await conversation(org.orgId, org.owner.userId);
  return { org, accountId, conversationId };
}

/** Empreinte du registre RGPD, calculée comme get-or-fetch-contact.ts (URL normalisée). */
function linkedinUrlHash(url: string): string {
  const normalized = url.toLowerCase().replace(/[?#].*$/, '').replace(/\/$/, '').trim();
  return createHash('sha256').update(normalized).digest('hex');
}

/** Effacement RGPD demandé par le propriétaire, limité à son organisation (SEQ-055). */
async function eraseInOrg(owner: TestUser, orgId: string, linkedinUrl: string) {
  // Adresse de rappel propre au test : la limite de rgpd-erase-contact est par IP, partagée par toute la stack.
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const res = await postJson('/functions/v1/rgpd-erase-contact', { linkedin_url: linkedinUrl, organization_id: orgId }, {
    Authorization: `Bearer ${await tokenOf(owner)}`,
    'x-forwarded-for': ip,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.scope).toBe('organization');
  return res.body;
}

/** Inscription seedée (hors outil) d'un candidat, identifiants LinkedIn et URL de profil. */
async function seedEnrollment(org: TestOrg, sequenceId: string, accountId: string, profileId: string, profileUrl: string) {
  const { data, error } = await admin().from('sequence_enrollments').insert({
    sequence_id: sequenceId,
    organization_id: org.orgId,
    created_by: org.owner.userId,
    profile_id: profileId,
    provider_id: profileId,
    profile_url: profileUrl,
    profile_name: 'Camille Martin',
    account_id: accountId,
    status: 'active',
    current_step_order: 0,
    user_timezone: 'Europe/Paris',
  }).select('id').single();
  if (error || !data) throw new Error(`seedEnrollment: ${error?.message}`);
  return data.id as string;
}

async function enrollmentsOfCandidate(orgId: string, providerId: string) {
  const { data } = await admin().from('sequence_enrollments')
    .select('id, sequence_id, status, tracking_data')
    .eq('organization_id', orgId).eq('provider_id', providerId);
  return (data ?? []) as Array<{ id: string; sequence_id: string; status: string; tracking_data: Json | null }>;
}

// ════════════════════════════════════════════════════════════════════════════
// Authentification du cron
// ════════════════════════════════════════════════════════════════════════════
test.describe('Cron des actions programmées : authentification', () => {
  test.describe.configure({ mode: 'serial' });

  // auth-secret-cron-accepte
  test('le secret du cron (PROCESS_SEQUENCES_SECRET) est accepté : 200, l’action échue est traitée et close en échec pour un outil inconnu', async () => {
    const { org } = await sendingOrg('E2E S1 secret cron');
    track(org);
    const conversationId = await conversation(org.orgId, org.owner.userId);
    const id = await seedExecution({
      orgId: org.orgId, userId: org.owner.userId, tool: UNKNOWN_TOOL, conversationId, summary: 'Outil inconnu',
      scheduledFor: minutesFromNow(120),
    });
    await makeDue(id);

    const res = await cron(CRON_SECRET);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);
    const mine = resultsOf(res.body).filter((r) => r.id === id);
    expect(mine, JSON.stringify(res.body)).toEqual([
      { id, tool: UNKNOWN_TOOL, success: false, error: `Tool ${UNKNOWN_TOOL} not registered` },
    ]);
    expect(res.body.processed).toBe(resultsOf(res.body).length);
    expect(res.body.processed as number).toBeGreaterThanOrEqual(1);

    const row = await execRow(id);
    expect(row.status).toBe('failed');
    expect(row.real_result).toEqual({ error: `Tool ${UNKNOWN_TOOL} not registered` });
    expect(row.executed_at).not.toBeNull();
    const msgs = outcomeOf(await messagesOf(conversationId), id);
    expect(msgs.map((m) => m.content)).toEqual([
      `❌ Action échouée : ${UNKNOWN_TOOL} — Outil inconnu → Tool ${UNKNOWN_TOOL} not registered`,
    ]);
  });

  // auth-refus-sans-jeton-valide
  test('sans jeton valide (aucun en-tête, Bearer vide, clé anon, JWT du propriétaire, secret faux de même longueur, préfixe du secret) : 401 et aucune action touchée', async () => {
    const { org, accountId, conversationId } = await sendingWorkspace('E2E S1 jeton');
    const recipient = newProfileId();
    const params = { account_id: accountId, recipient_provider_id: recipient, text: TEXT };
    const staleAt = minutesFromNow(-11);
    const staleId = await seedExecution({
      orgId: org.orgId, userId: org.owner.userId, tool: 'send_linkedin_message', params, conversationId,
      summary: 'Réservation interrompue', scheduledFor: minutesFromNow(-20), executedAt: staleAt,
    });
    const dueId = await seedExecution({
      orgId: org.orgId, userId: org.owner.userId, tool: 'send_linkedin_message', params, conversationId,
      summary: 'Message échu', scheduledFor: minutesFromNow(120),
    });
    await makeDue(dueId);
    const before = await execRows([dueId, staleId]);

    const wrongSameLength = CRON_SECRET.split('').map((c) => (c === 'x' ? 'y' : 'x')).join('');
    const variants: Array<{ label: string; headers: Record<string, string> | null }> = [
      { label: 'aucun en-tête', headers: null },
      { label: 'Bearer vide', headers: { Authorization: 'Bearer ' } },
      { label: 'clé anon', headers: { Authorization: `Bearer ${E2E.anonKey}` } },
      { label: 'JWT du propriétaire', headers: { Authorization: `Bearer ${await tokenOf(org.owner)}` } },
      { label: 'secret faux de même longueur', headers: { Authorization: `Bearer ${wrongSameLength}` } },
      { label: 'préfixe du secret', headers: { Authorization: `Bearer ${CRON_SECRET.slice(0, Math.max(1, CRON_SECRET.length - 4))}` } },
    ];
    for (const v of variants) {
      let status: number;
      let body: Json;
      if (v.headers === null) {
        // Ni Authorization ni apikey : la passerelle locale ne complète rien.
        const res = await fetch(`${E2E.supabaseUrl}/functions/v1/process-scheduled-actions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        });
        status = res.status;
        body = (await res.json().catch(() => ({}))) as Json;
      } else {
        const res = await postJson('/functions/v1/process-scheduled-actions', {}, v.headers);
        status = res.status;
        body = res.body;
      }
      expect.soft(status, `${v.label} : ${JSON.stringify(body)}`).toBe(401);
      expect.soft(body, v.label).toEqual({ error: 'Unauthorized' });
    }

    const after = await execRows([dueId, staleId]);
    const due = after.get(dueId)!;
    expect(due.status, 'la ligne échue reste approuvée').toBe('approved');
    expect(due.executed_at).toBeNull();
    expect(due.real_result).toBeNull();
    expect(due.updated_at).toBe(before.get(dueId)!.updated_at);
    const stale = after.get(staleId)!;
    expect(stale.status, 'la réservation périmée n’est pas close').toBe('approved');
    expect(Date.parse(stale.executed_at!)).toBe(Date.parse(staleAt));
    expect(stale.updated_at).toBe(before.get(staleId)!.updated_at);
    expect(await postsFrom(accountId), 'aucun envoi').toEqual([]);
    expect(await messagesOf(conversationId), 'aucun message de dénouement').toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Sélection, réservations interrompues, budget de temps
// ════════════════════════════════════════════════════════════════════════════
test.describe('Cron des actions programmées : sélection, réservations interrompues, budget de 40 s', () => {
  test.describe.configure({ mode: 'serial' });

  // selection-echues-seulement
  test('seule la ligne approuvée, échue et non réservée est exécutée : échéance future, sans échéance, autres statuts et réservation récente restent intacts', async () => {
    const { org } = await sendingOrg('E2E S1 sélection');
    track(org);
    const base = { orgId: org.orgId, userId: org.owner.userId, tool: UNKNOWN_TOOL };
    const others: Record<string, string> = {
      'B échéance dans 1 h': await seedExecution({ ...base, scheduledFor: minutesFromNow(60) }),
      'C sans échéance (approbation immédiate)': await seedExecution({ ...base, scheduledFor: null }),
      'D1 proposed': await seedExecution({ ...base, status: 'proposed', scheduledFor: longAgo(1), approvedAt: null }),
      'D2 rejected': await seedExecution({ ...base, status: 'rejected', scheduledFor: longAgo(2) }),
      'D3 executed': await seedExecution({
        ...base, status: 'executed', scheduledFor: longAgo(3), executedAt: minutesFromNow(-3), realResult: { success: true },
      }),
      'D4 failed': await seedExecution({
        ...base, status: 'failed', scheduledFor: longAgo(4), executedAt: minutesFromNow(-3), realResult: { success: false, error: 'x' },
      }),
      'E réservation récente (2 min)': await seedExecution({ ...base, scheduledFor: longAgo(5), executedAt: minutesFromNow(-2) }),
    };
    const a = await seedExecution({ ...base, scheduledFor: minutesFromNow(120) });
    await makeDue(a, longAgo(0));
    const before = await execRows(Object.values(others));

    const res = await cron();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ids = resultsOf(res.body).map((r) => r.id);
    expect(ids, 'A traitée').toContain(a);
    for (const [label, id] of Object.entries(others)) expect(ids, `${label} ignorée`).not.toContain(id);

    expect((await execRow(a)).status).toBe('failed');
    const after = await execRows(Object.values(others));
    for (const [label, id] of Object.entries(others)) {
      const b = before.get(id)!;
      const c = after.get(id)!;
      expect({ status: c.status, executed_at: c.executed_at, real_result: c.real_result, scheduled_for: c.scheduled_for, updated_at: c.updated_at }, label)
        .toEqual({ status: b.status, executed_at: b.executed_at, real_result: b.real_result, scheduled_for: b.scheduled_for, updated_at: b.updated_at });
    }
  });

  // reservation-perimee-failed
  test('réservation interrompue (executed_at vieux de 11 min) : close en échec « Délai dépassé », jamais rejouée, dénouement tracé une seule fois dans la conversation', async () => {
    const { org, accountId, conversationId } = await sendingWorkspace('E2E S1 réservation périmée');
    const summary = `Envoyer à Camille ${rand()}`;
    const staleAt = minutesFromNow(-11);
    const id = await seedExecution({
      orgId: org.orgId, userId: org.owner.userId, tool: 'send_linkedin_message',
      params: { account_id: accountId, recipient_provider_id: newProfileId(), text: TEXT },
      summary, conversationId, scheduledFor: minutesFromNow(-20), approvedAt: minutesFromNow(-20), executedAt: staleAt,
    });

    const res = await cron();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.stale_failed as number).toBeGreaterThanOrEqual(1);
    expect(resultsOf(res.body).map((r) => r.id), 'jamais rejouée').not.toContain(id);

    const row = await execRow(id);
    expect(row.status).toBe('failed');
    expect(row.real_result).toEqual({ success: false, error: STALE, source: 'process-scheduled-actions-timeout' });
    expect(Date.parse(row.executed_at!), 'executed_at inchangé').toBe(Date.parse(staleAt));
    expect(await postsFrom(accountId), 'aucun envoi').toEqual([]);
    const msgs = outcomeOf(await messagesOf(conversationId), id);
    expect(msgs.map((m) => ({ role: m.role, content: m.content, result: m.metadata?.agent_action_result }))).toEqual([{
      role: 'assistant',
      content: `❌ Action échouée : send_linkedin_message — ${summary} → ${STALE}`,
      result: { execution_id: id, tool_name: 'send_linkedin_message', status: 'failed' },
    }]);

    // Passage suivant : rien ne bouge, aucun second message.
    const again = await cron();
    expect(again.status).toBe(200);
    expect(resultsOf(again.body).map((r) => r.id)).not.toContain(id);
    const row2 = await execRow(id);
    expect({ status: row2.status, real_result: row2.real_result, executed_at: row2.executed_at })
      .toEqual({ status: row.status, real_result: row.real_result, executed_at: row.executed_at });
    expect(outcomeOf(await messagesOf(conversationId), id)).toHaveLength(1);
    expect(await postsFrom(accountId)).toEqual([]);
  });

  // budget-40s-reliquat-intact
  test('budget de 40 s : 10 actions échues, le reliquat reste approuvé sans executed_at, annoncé dans « deferred », et part aux passages suivants sans doublon', async () => {
    const { org } = await sendingOrg('E2E S1 budget');
    track(org);
    const conversationId = await conversation(org.orgId, org.owner.userId);
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(await seedExecution({
        orgId: org.orgId, userId: org.owner.userId, tool: UNKNOWN_TOOL, conversationId, summary: `Action ${i + 1}`,
        scheduledFor: minutesFromNow(120),
      }));
    }
    // Échéances distinctes et très anciennes : ces 10 lignes forment le lot du passage.
    for (const [i, id] of ids.entries()) await makeDue(id, longAgo(i));
    const mine = new Set(ids);

    const t0 = Date.now();
    const first = await cron();
    const elapsed = Date.now() - t0;
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(elapsed, 'réponse avant la coupure de 60 s').toBeLessThan(45_000);
    const firstIds = resultsOf(first.body).map((r) => r.id);
    expect(firstIds.every((id) => mine.has(id)), `lot composé des 10 lignes du test : ${JSON.stringify(first.body)}`).toBe(true);
    expect(first.body.processed).toBe(firstIds.length);
    expect(firstIds.length).toBeGreaterThanOrEqual(1);
    expect(first.body.deferred as number).toBeGreaterThan(0);
    expect((first.body.processed as number) + (first.body.deferred as number)).toBe(10);

    let rows = await execRows(ids);
    const leftover = ids.filter((id) => !firstIds.includes(id));
    expect(leftover).toHaveLength(first.body.deferred as number);
    for (const id of leftover) {
      const r = rows.get(id)!;
      expect({ status: r.status, executed_at: r.executed_at, real_result: r.real_result }, `ligne différée ${id}`)
        .toEqual({ status: 'approved', executed_at: null, real_result: null });
    }
    for (const id of firstIds) expect(rows.get(id)!.status).toBe('failed');

    // Passages suivants : le reliquat baisse, aucune ligne traitée deux fois.
    const seen = [...firstIds];
    let remaining = leftover.length;
    for (let pass = 0; pass < 5 && remaining > 0; pass++) {
      const res = await cron();
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const passIds = resultsOf(res.body).map((r) => r.id).filter((id) => mine.has(id));
      expect(passIds.length, `passage ${pass + 2} : le reliquat baisse`).toBeGreaterThanOrEqual(1);
      for (const id of passIds) expect(seen, `ligne ${id} traitée deux fois`).not.toContain(id);
      seen.push(...passIds);
      rows = await execRows(ids);
      remaining = ids.filter((id) => rows.get(id)!.status === 'approved').length;
      expect(remaining).toBe(10 - seen.length);
    }
    expect(remaining).toBe(0);
    expect(new Set(seen).size).toBe(10);
    const msgs = await messagesOf(conversationId);
    for (const id of ids) expect(outcomeOf(msgs, id), `un seul dénouement pour ${id}`).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Exécution unique, identité de la ligne, annulation, compte déconnecté
// ════════════════════════════════════════════════════════════════════════════
test.describe('Cron des actions programmées : exécution unique, identité, annulation, compte', () => {
  test.describe.configure({ mode: 'serial' });

  // execution-unique-concurrente
  test('trois passages simultanés sur un message échu : un seul envoi, un seul « ✅ Action exécutée », les perdants n’écrivent rien @critical', async () => {
    test.skip(!SEND_ZONE, NO_WEEKDAY_REASON);
    const { org, accountId, conversationId } = await sendingWorkspace('E2E S1 concurrence');
    const recipient = newProfileId();
    const summary = `Envoyer un message LinkedIn à Camille ${rand()}`;
    const id = await seedExecution({
      orgId: org.orgId, userId: org.owner.userId, tool: 'send_linkedin_message',
      params: { account_id: accountId, recipient_provider_id: recipient, text: TEXT },
      summary, conversationId, scheduledFor: minutesFromNow(120),
    });
    await makeDue(id);

    const responses = await Promise.all([cron(), cron(), cron()]);
    for (const r of responses) expect(r.status, JSON.stringify(r.body)).toBe(200);

    const mine = responses.flatMap((r) => resultsOf(r.body).filter((x) => x.id === id));
    const winners = mine.filter((x) => x.success);
    expect(winners, JSON.stringify(mine)).toHaveLength(1);
    for (const loser of mine.filter((x) => !x.success)) expect(LOSER_ERRORS, JSON.stringify(loser)).toContain(loser.error);

    const chats = await newChatsTo(accountId, recipient);
    expect(chats, 'exactement un envoi').toHaveLength(1);
    expect((chats[0].body as Json).text).toBe(TEXT);
    const row = await execRow(id);
    expect(row.status).toBe('executed');
    expect(row.real_result?.success).toBe(true);
    const msgs = outcomeOf(await messagesOf(conversationId), id);
    expect(msgs.map((m) => m.content)).toEqual([
      `✅ Action exécutée : send_linkedin_message — ${summary} → Message LinkedIn envoyé (nouvelle conversation créée).`,
    ]);
    const { count } = await admin().from('linkedin_action_log').select('id', { count: 'exact', head: true })
      .eq('account_id', accountId);
    expect(count, 'une seule action au registre des quotas').toBe(1);
  });

  // contexte-ligne-et-params-relus
  test('identité de la ligne et params relus : le compte d’un collègue glissé dans params avant l’approbation est refusé à l’exécution ; la ligne du collègue part de son propre compte', async () => {
    const { org, accountId: ownerAccount } = await sendingOrg('E2E S1 params relus');
    const member = await addMember(org.orgId, 'member', 'membre');
    track(org, member);
    const memberAccount = await seedLinkedInAccount(org.orgId, member.userId, `acc_s1_${rand()}`, 'OK');
    await openBusinessHours(org.orgId, org.owner.userId);
    await openBusinessHours(org.orgId, member.userId);
    const recipient = newProfileId();

    // Proposition de l'assistant au propriétaire, aperçu programmé dans deux heures.
    const id = await seedExecution({
      orgId: org.orgId, userId: org.owner.userId, tool: 'send_linkedin_message', status: 'proposed',
      params: { account_id: ownerAccount, recipient_provider_id: recipient, text: TEXT },
      details: { account_id: ownerAccount, scheduled_for: minutesFromNow(120) }, scheduledFor: null, approvedAt: null,
    });
    // Le propriétaire réécrit params (autorisé tant que la ligne est « proposed ») vers le compte du collègue.
    const client = await userClient(org.owner);
    const { data: edited, error: editError } = await client.from('agent_tool_executions')
      .update({ params: { account_id: memberAccount, recipient_provider_id: recipient, text: TEXT } })
      .eq('id', id).select('id');
    expect(editError, editError?.message).toBeNull();
    expect(edited).toHaveLength(1);
    // Clic « Approuver » : mise en file, rien n'est exécuté.
    const approve = await callFunction('agent-tool-action', await tokenOf(org.owner), { execution_id: id, action: 'approve' });
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    expect((approve.body.data as Json | undefined)?.scheduled).toBe(true);
    expect((await execRow(id)).executed_at).toBeNull();

    await makeDue(id);
    const { row } = await runUntilDone(id);
    expect(row.status, JSON.stringify(row.real_result)).toBe('failed');
    expect(row.real_result?.error).toBe(DENIED + notLinked(memberAccount));
    expect(await postsFrom(memberAccount), 'rien ne part du compte du collègue').toEqual([]);
    expect(await postsFrom(ownerAccount), 'ni du compte du propriétaire').toEqual([]);

    // Témoin : la ligne du collègue s'exécute avec SON identité, depuis son compte.
    if (SEND_ZONE) {
      const recipient2 = newProfileId();
      const own = await seedExecution({
        orgId: org.orgId, userId: member.userId, tool: 'send_linkedin_message',
        params: { recipient_provider_id: recipient2, text: TEXT }, scheduledFor: minutesFromNow(120),
      });
      await makeDue(own);
      const done = await runUntilDone(own);
      expect(done.row.status, JSON.stringify(done.row.real_result)).toBe('executed');
      expect(await newChatsTo(memberAccount, recipient2)).toHaveLength(1);
      expect(await postsFrom(ownerAccount)).toEqual([]);
    }
  });

  // annulation-apres-reservation-refusee (a)
  test('action réservée par le cron (executed_at posé) : l’annulation par le propriétaire est refusée « transition approved vers rejected interdite »', async () => {
    const { org } = await sendingOrg('E2E S1 annulation réservée');
    track(org);
    const reservedAt = new Date().toISOString();
    const id = await seedExecution({
      orgId: org.orgId, userId: org.owner.userId, tool: UNKNOWN_TOOL, scheduledFor: minutesFromNow(-1), executedAt: reservedAt,
    });
    const client = await userClient(org.owner);
    const { data, error } = await client.from('agent_tool_executions')
      .update({ status: 'rejected', user_note: 'annulée', scheduled_for: null })
      .eq('id', id).select('id');
    expect(data ?? null).toBeNull();
    expect(error?.message).toContain('transition approved vers rejected interdite');
    const row = await execRow(id);
    expect(row.status).toBe('approved');
    expect(Date.parse(row.executed_at!)).toBe(Date.parse(reservedAt));
  });

  // annulation-apres-reservation-refusee (b)
  test('annulation entre la sélection et l’exécution (pendant la pause humanisante du cron) : l’envoi n’a pas lieu, la ligne reste rejetée', async () => {
    const { org, accountId, conversationId } = await sendingWorkspace('E2E S1 annulation en course');
    const recipient = newProfileId();
    const first = await seedExecution({
      orgId: org.orgId, userId: org.owner.userId, tool: UNKNOWN_TOOL, conversationId, scheduledFor: minutesFromNow(120),
    });
    const second = await seedExecution({
      orgId: org.orgId, userId: org.owner.userId, tool: 'send_linkedin_message', conversationId, summary: 'Message à annuler',
      params: { account_id: accountId, recipient_provider_id: recipient, text: TEXT }, scheduledFor: minutesFromNow(120),
    });
    await makeDue(second, longAgo(1));
    await makeDue(first, longAgo(0));

    // Le passage sélectionne les deux lignes, traite la première puis dort 5 à 15 s.
    const pending = cron();
    const deadline = Date.now() + 30_000;
    while ((await execRow(first)).status === 'approved') {
      if (Date.now() > deadline) throw new Error('première ligne jamais traitée');
      await new Promise((r) => setTimeout(r, 150));
    }
    // Pendant la pause : « Annuler la programmation » (même écriture que l'interface).
    const client = await userClient(org.owner);
    const { data: cancelled, error } = await client.from('agent_tool_executions')
      .update({ status: 'rejected', user_note: '[Annulée depuis Settings — programmation annulée]', scheduled_for: null })
      .eq('id', second).eq('status', 'approved').is('executed_at', null).select('id');
    expect(error, error?.message).toBeNull();
    expect(cancelled, 'annulation passée avant la réservation').toHaveLength(1);

    const res = await pending;
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(resultsOf(res.body).filter((r) => r.id === second), JSON.stringify(res.body)).toEqual([
      { id: second, tool: 'send_linkedin_message', success: false, error: 'Cannot execute scheduled from status rejected' },
    ]);
    const row = await execRow(second);
    expect({ status: row.status, executed_at: row.executed_at, real_result: row.real_result })
      .toEqual({ status: 'rejected', executed_at: null, real_result: null });
    expect(await postsFrom(accountId), 'aucun envoi').toEqual([]);
    expect(outcomeOf(await messagesOf(conversationId), second), 'aucun dénouement écrit pour la ligne annulée').toEqual([]);
  });

  // envoi-compte-deconnecte-a-l-execution
  test('compte d’envoi passé CREDENTIALS puis DISCONNECTED après l’approbation : échec « compte déconnecté », rien ne part, message ❌', async () => {
    const { org, accountId, conversationId } = await sendingWorkspace('E2E S1 compte déconnecté');
    for (const status of ['CREDENTIALS', 'DISCONNECTED']) {
      const summary = `Message avec compte ${status}`;
      const id = await seedExecution({
        orgId: org.orgId, userId: org.owner.userId, tool: 'send_linkedin_message', conversationId, summary,
        params: { account_id: accountId, recipient_provider_id: newProfileId(), text: TEXT }, scheduledFor: minutesFromNow(120),
      });
      const { error } = await admin().from('member_linkedin_accounts').update({ account_status: status })
        .eq('linkedin_account_id', accountId);
      expect(error, error?.message).toBeNull();
      await makeDue(id);
      const { row } = await runUntilDone(id);
      expect(row.status, `${status} : ${JSON.stringify(row.real_result)}`).toBe('failed');
      expect(row.real_result?.error).toBe(DENIED + SEND_DISCONNECTED);
      expect(outcomeOf(await messagesOf(conversationId), id).map((m) => m.content)).toEqual([
        `❌ Action échouée : send_linkedin_message — ${summary} → ${DENIED}${SEND_DISCONNECTED}`,
      ]);
    }
    expect(await postsFrom(accountId), 'aucun envoi depuis le compte déconnecté').toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Réservation réarmée par le client (écriture de executed_at)
// Bloc à part : en mode série, un échec saute les tests suivants du bloc.
// ════════════════════════════════════════════════════════════════════════════
test.describe('Cron des actions programmées : réservation interrompue réarmée depuis le client', () => {
  test.describe.configure({ mode: 'serial' });

  // file-infalsifiable-cote-client (conséquence de bout en bout de l'écriture de executed_at par le client)
  test('réservation interrompue : le propriétaire efface executed_at par l’API REST, le cron ne doit pas la rejouer @critical', async () => {
    test.skip(!SEND_ZONE, NO_WEEKDAY_REASON);
    const { org, accountId, conversationId } = await sendingWorkspace('E2E S1 réarmement');
    const recipient = newProfileId();
    const id = await seedExecution({
      orgId: org.orgId, userId: org.owner.userId, tool: 'send_linkedin_message',
      params: { account_id: accountId, recipient_provider_id: recipient, text: TEXT },
      summary: 'Envoi interrompu', conversationId, scheduledFor: longAgo(), approvedAt: minutesFromNow(-20),
      executedAt: minutesFromNow(-11),
    });

    const client = await userClient(org.owner);
    const { data: rearmed, error } = await client.from('agent_tool_executions')
      .update({ executed_at: null }).eq('id', id).select('id');
    // DÉFAUT agent-executions-executed-at-nullable : le trigger guard_agent_tool_execution_update ne bloque que les valeurs non nulles d'executed_at
    expect.soft(error !== null || (rearmed ?? []).length === 0,
      `executed_at effacé par le client : ${JSON.stringify({ rearmed, error })}`).toBe(true);

    await cron();
    // DÉFAUT agent-executions-executed-at-nullable : la réservation réarmée est rejouée et le message part une seconde fois
    expect(await newChatsTo(accountId, recipient), 'la réservation interrompue ne doit jamais repartir').toEqual([]);
    const row = await execRow(id);
    expect(row.status).toBe('failed');
    expect(row.real_result?.error).toBe(STALE);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Effacement RGPD entre l'approbation et l'échéance (D5, SEQ-054)
// ════════════════════════════════════════════════════════════════════════════
test.describe('Cron des actions programmées : candidat effacé (RGPD) avant l’échéance', () => {
  test.describe.configure({ mode: 'serial' });

  // inscription-rgpd-a-l-execution (a)
  test('inscription programmée d’un candidat inscrit entre-temps au registre global des effacements : refus, aucune inscription @critical', async () => {
    const { org, accountId } = await sendingWorkspace('E2E S1 RGPD registre');
    const missionId = await seedMission(org.orgId, org.owner.userId);
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour {{first_name}}']);
    const candidate = newProfileId();
    const url = `https://www.linkedin.com/in/E2E-S1-${rand()}/`;
    const id = await seedExecution({
      orgId: org.orgId, userId: org.owner.userId, tool: 'enroll_in_sequence',
      params: { sequence_id: sequenceId, candidate_id: candidate, profile_url: url, profile_name: 'Camille Martin', job_id: missionId },
      scheduledFor: minutesFromNow(120),
    });
    const hash = linkedinUrlHash(url);
    erasureHashes.push(hash);
    const { error } = await admin().from('gdpr_erasures')
      .insert({ linkedin_url_hash: hash, reason: 'user_request', source: 'e2e-scheduled-1' });
    expect(error, error?.message).toBeNull();

    await makeDue(id);
    const { row } = await runUntilDone(id);
    expect(row.status, JSON.stringify(row.real_result)).toBe('failed');
    expect(row.real_result?.error).toBe(GDPR_ENROLL);
    expect(await enrollmentsOfCandidate(org.orgId, candidate), 'aucune inscription').toEqual([]);
    expect(await postsFrom(accountId)).toEqual([]);
  });
});

// Blocs à part pour les défauts : en mode série, un échec saute les tests suivants du bloc.
test.describe('Cron des actions programmées : message à un candidat effacé (RGPD) avant l’échéance', () => {
  test.describe.configure({ mode: 'serial' });

  // envoi-destinataire-efface-rgpd
  test('message programmé vers un candidat effacé par l’organisation entre-temps : il ne part pas @critical', async () => {
    test.skip(!SEND_ZONE, NO_WEEKDAY_REASON);
    const { org, accountId } = await sendingWorkspace('E2E S1 RGPD message');
    const candidate = newProfileId();
    const url = `https://www.linkedin.com/in/e2e-s1-${rand()}`;
    const { sequenceId } = await messageSequence(org, org.owner.userId, ['Bonjour {{first_name}}']);
    const enrollmentId = await seedEnrollment(org, sequenceId, accountId, candidate, url);
    const id = await seedExecution({
      orgId: org.orgId, userId: org.owner.userId, tool: 'send_linkedin_message',
      params: { account_id: accountId, recipient_provider_id: candidate, text: TEXT }, scheduledFor: minutesFromNow(120),
    });

    await eraseInOrg(org.owner, org.orgId, url);
    const erased = (await enrollmentsOfCandidate(org.orgId, candidate)).find((e) => e.id === enrollmentId)!;
    expect(erased.status).toBe('stopped');
    expect(typeof erased.tracking_data?.gdpr_erased_at).toBe('string');

    await makeDue(id);
    const { row } = await runUntilDone(id);
    // DÉFAUT rgpd-message-programme-envoye : send_linkedin_message ne consulte ni gdpr_erasures ni le marqueur gdpr_erased_at
    expect(await newChatsTo(accountId, candidate), 'aucun message au candidat effacé').toEqual([]);
    expect(row.status, JSON.stringify(row.real_result)).toBe('failed');
  });
});

test.describe('Cron des actions programmées : inscription d’un candidat effacé par l’organisation avant l’échéance', () => {
  test.describe.configure({ mode: 'serial' });

  // inscription-rgpd-a-l-execution (b)
  test('inscription programmée d’un candidat effacé entre-temps par l’organisation (marqueur gdpr_erased_at, sans registre global) : refus, aucune nouvelle inscription @critical', async () => {
    const { org, accountId } = await sendingWorkspace('E2E S1 RGPD organisation');
    const missionId = await seedMission(org.orgId, org.owner.userId);
    const first = await messageSequence(org, org.owner.userId, ['Bonjour {{first_name}}']);
    const second = await messageSequence(org, org.owner.userId, ['Bonjour à nouveau {{first_name}}']);
    const candidate = newProfileId();
    const url = `https://www.linkedin.com/in/e2e-s1-org-${rand()}`;
    const previous = await seedEnrollment(org, first.sequenceId, accountId, candidate, url);
    const id = await seedExecution({
      orgId: org.orgId, userId: org.owner.userId, tool: 'enroll_in_sequence',
      params: { sequence_id: second.sequenceId, candidate_id: candidate, profile_url: url, profile_name: 'Camille Martin', job_id: missionId },
      scheduledFor: minutesFromNow(120),
    });

    await eraseInOrg(org.owner, org.orgId, url);
    const marked = (await enrollmentsOfCandidate(org.orgId, candidate)).find((e) => e.id === previous)!;
    expect(typeof marked.tracking_data?.gdpr_erased_at, 'marqueur D5 posé').toBe('string');
    const { count: registry } = await admin().from('gdpr_erasures').select('id', { count: 'exact', head: true })
      .eq('linkedin_url_hash', linkedinUrlHash(url));
    expect(registry, 'effacement limité à l’organisation : pas de ligne au registre global').toBe(0);

    await makeDue(id);
    const { row } = await runUntilDone(id);
    // DÉFAUT rgpd-inscription-effacement-organisation : enroll_in_sequence ne lit que le registre global (isGdprBlocked), jamais le marqueur gdpr_erased_at de l'organisation
    expect(await enrollmentsOfCandidate(org.orgId, candidate), 'aucune nouvelle inscription du candidat effacé')
      .toEqual([expect.objectContaining({ id: previous, status: 'stopped' })]);
    expect(row.status, JSON.stringify(row.real_result)).toBe('failed');
    expect(String(row.real_result?.error ?? '')).toContain('effacement');
  });
});

test.describe('Cron des actions programmées : inscription sans URL de profil d’un candidat effacé avant l’échéance', () => {
  test.describe.configure({ mode: 'serial' });

  // inscription-rgpd-a-l-execution (c)
  test('inscription programmée sans profile_url d’un candidat effacé par l’organisation (même identifiant LinkedIn) : refus, aucune nouvelle inscription @critical', async () => {
    const { org, accountId } = await sendingWorkspace('E2E S1 RGPD sans URL');
    const missionId = await seedMission(org.orgId, org.owner.userId);
    const first = await messageSequence(org, org.owner.userId, ['Bonjour {{first_name}}']);
    const second = await messageSequence(org, org.owner.userId, ['Bonjour à nouveau {{first_name}}']);
    const candidate = newProfileId();
    const url = `https://www.linkedin.com/in/e2e-s1-sans-url-${rand()}`;
    const previous = await seedEnrollment(org, first.sequenceId, accountId, candidate, url);
    const id = await seedExecution({
      orgId: org.orgId, userId: org.owner.userId, tool: 'enroll_in_sequence',
      params: { sequence_id: second.sequenceId, candidate_id: candidate, profile_name: 'Camille Martin', job_id: missionId },
      scheduledFor: minutesFromNow(120),
    });

    await eraseInOrg(org.owner, org.orgId, url);
    const marked = (await enrollmentsOfCandidate(org.orgId, candidate)).find((e) => e.id === previous)!;
    expect(typeof marked.tracking_data?.gdpr_erased_at).toBe('string');

    await makeDue(id);
    const { row } = await runUntilDone(id);
    // DÉFAUT rgpd-inscription-sans-url : sans profile_url, enroll_in_sequence ne fait aucun contrôle d'effacement
    expect(await enrollmentsOfCandidate(org.orgId, candidate), 'aucune nouvelle inscription du candidat effacé')
      .toEqual([expect.objectContaining({ id: previous, status: 'stopped' })]);
    expect(row.status, JSON.stringify(row.real_result)).toBe('failed');
  });
});
