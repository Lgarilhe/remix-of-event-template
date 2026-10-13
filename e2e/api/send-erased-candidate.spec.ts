/**
 * Correctif 4 du plan du lot 5, contre la stack locale (e2e/local-stack) : unipile-search
 * `send_message` exécutée pour de vrai, LinkedIn simulé par vendor-mock.mjs (API v2).
 *
 * Le destinataire d'un envoi est résolu et contrôlé (effacement RGPD) AVANT le plafond
 * LinkedIn, le marqueur (record_candidate_outbound) et l'appel au prestataire, pour tout
 * appelant (fenêtre de message et fiche, messagerie, assistant) :
 *   - candidat effacé dans l'organisation : 403 `CANDIDATE_ERASED` ;
 *   - registre d'effacement illisible : 503 `GDPR_UNVERIFIED` (échec fermé) ;
 *   - candidat inconnu (groupe) : le message part, sans enregistrement ;
 *   - candidat non effacé : l'envoi se déroule comme avant (marqueur, POST, « Contacté »).
 * Un refus ne laisse aucune trace : pas d'envoi au faux LinkedIn, pas de marqueur ni de lien, pas
 * de « Contacté », pas de place prise dans le plafond LinkedIn.
 *
 * Registre illisible : `isCandidateErasedForOrg` refuse de conclure quand une lecture est trop
 * volumineuse (200 inscriptions ou plus pour un même candidat, `contexte trop volumineux`).
 * Le test le provoque avec 200 inscriptions en pause, dans l'organisation du test seulement :
 * aucune table partagée n'est cassée.
 *
 * Garde statique : tests/c1/correctifs-envois.test.mjs ; unités : unipile-search/handlers.test.ts.
 *
 * @critical
 */
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { E2E } from '../helpers/env';
import {
  admin,
  candidateRowState,
  deleteOrg,
  seedCandidateRow,
  seedMission,
  seedMissionConversation,
  signIn,
  type TestOrg,
} from '../helpers/supabase-admin';
import {
  ENGINE_SKIP_REASON,
  callFunction,
  engineAvailable,
  expectNoV1Calls,
  expectNoViolations,
  mockCalls,
  postJson,
  rand,
  sendingOrg,
  sentTexts,
  setMockMode,
} from '../helpers/sequence-engine';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.setTimeout(240_000);

// ─── Ménage ─────────────────────────────────────────────────────────────────
const orgsToDelete: TestOrg[] = [];
const cleanups: Array<() => PromiseLike<unknown>> = [];
test.afterEach(async () => {
  while (cleanups.length) await Promise.resolve(cleanups.pop()!()).catch(() => undefined);
  while (orgsToDelete.length) {
    const org = orgsToDelete.pop()!;
    for (const table of ['sequence_enrollments', 'outreach_sequences', 'job_candidate_status', 'mission_conversations', 'linkedin_action_log']) {
      await admin().from(table).delete().eq('organization_id', org.orgId);
    }
    await deleteOrg(org, []);
  }
});

async function trackedSendingOrg(prefix: string) {
  const res = await sendingOrg(prefix);
  orgsToDelete.push(res.org);
  return res;
}
async function ownerToken(org: TestOrg) {
  return (await signIn(org.owner.email, org.owner.password)).access_token;
}

const newProfileId = () => `ACoAAE2ESND${rand()}${rand()}`;

// ─── Candidats ──────────────────────────────────────────────────────────────

/** Candidat Retenu dans une mission de l'organisation, effacé au registre global (par son adresse de profil). */
async function erasedCandidate(org: TestOrg) {
  const missionId = await seedMission(org.orgId, org.owner.userId);
  const candidateId = newProfileId();
  const slug = `lea-efface-envoi-${rand()}`;
  const url = `https://www.linkedin.com/in/${slug}`;
  const { id: rowId } = await seedCandidateRow({
    orgId: org.orgId, createdBy: org.owner.userId, candidateId, missionId, stage: 'retained', extra: { linkedin_profile_url: url },
  });
  const { data: erasure, error } = await admin().from('gdpr_erasures')
    .insert({ linkedin_url_hash: createHash('sha256').update(url).digest('hex'), source: 'e2e' }).select('id').single();
  if (error || !erasure) throw new Error(`gdpr_erasures: ${error?.message}`);
  cleanups.push(() => admin().from('gdpr_erasures').delete().eq('id', (erasure as { id: string }).id));
  return { missionId, candidateId, rowId, slug, url };
}

/** 200 inscriptions en pause pour ce candidat (une par séquence) : le registre est alors trop volumineux pour être lu. */
async function overloadRegister(org: TestOrg, accountId: string, candidateId: string) {
  const sequences = Array.from({ length: 200 }, (_, i) => ({
    name: `Séquence volumineuse ${i} ${rand()}`, organization_id: org.orgId, created_by: org.owner.userId, is_active: false,
  }));
  const { data, error } = await admin().from('outreach_sequences').insert(sequences).select('id');
  if (error || !data) throw new Error(`outreach_sequences: ${error?.message}`);
  const { error: enrollError } = await admin().from('sequence_enrollments').insert(
    (data as Array<{ id: string }>).map((s) => ({
      sequence_id: s.id, organization_id: org.orgId, created_by: org.owner.userId, profile_id: candidateId,
      profile_name: 'Camille Martin', account_id: accountId, status: 'paused', pause_reason: 'manual', current_step_order: 0,
      user_timezone: 'Europe/Paris',
    })),
  );
  if (enrollError) throw new Error(`sequence_enrollments: ${enrollError.message}`);
}

// ─── Constats ───────────────────────────────────────────────────────────────

async function linksOf(orgId: string, candidateId: string) {
  const { data, error } = await admin().from('mission_conversations')
    .select('id, project_id, chat_id, source, outbound_pending_at, last_outbound_at')
    .eq('organization_id', orgId)
    .or(`candidate_id.eq.${candidateId},candidate_ids.cs.{${candidateId}}`);
  if (error) throw new Error(`mission_conversations: ${error.message}`);
  return data ?? [];
}
async function rowsOf(orgId: string, candidateId: string) {
  const { data } = await admin().from('job_candidate_status').select('id, general_stage').eq('organization_id', orgId).eq('candidate_id', candidateId);
  return (data ?? []) as Array<{ id: string; general_stage: string }>;
}
/** Places prises dans le plafond LinkedIn par ce compte. */
async function actionLog(accountId: string) {
  const { data } = await admin().from('linkedin_action_log').select('action_type, source').eq('account_id', accountId);
  return (data ?? []) as Array<{ action_type: string; source: string | null }>;
}
function sendMessage(token: string, org: TestOrg, accountId: string, body: Record<string, unknown>) {
  return callFunction('unipile-search', token, { action: 'send_message', organization_id: org.orgId, account_id: accountId, ...body });
}
/** Phrase française lisible telle quelle à l'écran : ni nombre, ni mot réécrit par humanizeError, ni nom de prestataire. */
function expectReadableRefusal(res: { status: number; body: Record<string, unknown> }, status: number, code: string, phrase: RegExp) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.success).toBe(false);
  expect(res.body.error_code).toBe(code);
  expect(String(res.body.error)).toMatch(phrase);
  expect(String(res.body.error)).not.toMatch(/\d|forbidden|not found|error|unipile|linkedin/i);
}
const expectErased = (res: { status: number; body: Record<string, unknown> }) =>
  expectReadableRefusal(res, 403, 'CANDIDATE_ERASED', /effacement de ses données/);
const expectUnverified = (res: { status: number; body: Record<string, unknown> }) =>
  expectReadableRefusal(res, 503, 'GDPR_UNVERIFIED', /n'a pas pu être vérifié/);

/** Témoin : le même envoi à un candidat non effacé part, s'enregistre et prend une place dans le plafond. */
async function expectWitnessSent(token: string, org: TestOrg, accountId: string, missionId: string) {
  const other = newProfileId();
  const text = `Bonjour ${rand()}`;
  const res = await sendMessage(token, org, accountId, { recipient_id: other, project_id: `project:${missionId}`, text });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.success).toBe(true);
  expect(await sentTexts(accountId), 'témoin envoyé au faux LinkedIn').toEqual([text]);
  const [link] = await linksOf(org.orgId, other);
  expect(link?.outbound_pending_at, 'témoin : marqueur posé avant le POST').not.toBeNull();
  expect((await rowsOf(org.orgId, other)).map((r) => r.general_stage), 'témoin « Contacté »').toEqual(['contacted']);
  expect((await actionLog(accountId)).map((r) => r.action_type), 'témoin : une place prise').toEqual(['message']);
}

// ════════════════════════════════════════════════════════════════════════════

test.describe('Envoi à un candidat effacé ou au registre illisible (correctif 4)', () => {
  test.describe.configure({ mode: 'serial' });

  test('@critical nouvelle conversation (message, InMail, nom court, adresse de profil) : 403 CANDIDATE_ERASED, aucun appel au prestataire, aucune place, aucun marqueur ; témoin non effacé envoyé', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E envoi effacé nouvelle');
    const token = await ownerToken(org);
    const { missionId, candidateId, rowId, slug, url } = await erasedCandidate(org);
    const before = await candidateRowState(rowId);

    const variants: Array<{ label: string; body: Record<string, unknown> }> = [
      { label: 'message', body: { recipient_id: candidateId } },
      { label: 'InMail', body: { recipient_id: candidateId, is_inmail: true, subject: 'Votre parcours' } },
      { label: 'nom court', body: { recipient_id: slug } },
      { label: 'adresse de profil', body: { recipient_id: url } },
      { label: 'adresse de profil à part', body: { recipient_id: newProfileId(), recipient_profile_url: url } },
      // L'envoi suit le nom public de recipient_id : l'adresse d'un autre profil, non effacé, ne doit pas masquer ce candidat.
      { label: 'nom court avec l\'adresse d\'un autre profil', body: { recipient_id: slug, recipient_profile_url: `https://www.linkedin.com/in/personne-non-effacee-${rand()}` } },
      { label: 'adresse de profil avec l\'adresse d\'un autre profil', body: { recipient_id: url, recipient_profile_url: `https://www.linkedin.com/in/personne-non-effacee-${rand()}` } },
    ];
    for (const variant of variants) {
      const res = await sendMessage(token, org, accountId, { project_id: `project:${missionId}`, text: `Bonjour ${rand()}`, ...variant.body });
      expect(res.status, `${variant.label} : ${JSON.stringify(res.body)}`).toBe(403);
      expectErased(res);
    }
    // Aucun appel au prestataire : ni envoi, ni lecture du contrat d'un InMail.
    expect(await mockCalls(accountId), 'journal du faux LinkedIn vide pour ce compte').toEqual([]);
    expect(await linksOf(org.orgId, candidateId), 'ni marqueur ni lien').toEqual([]);
    expect(await candidateRowState(rowId), 'aucun « Contacté »').toEqual(before);
    expect((await rowsOf(org.orgId, candidateId)).map((r) => r.id), 'aucune ligne créée').toEqual([rowId]);
    expect(await actionLog(accountId), 'aucune place prise dans le plafond LinkedIn').toEqual([]);

    await expectWitnessSent(token, org, accountId, missionId);
    await expectNoViolations(accountId);
  });

  test('@critical conversation existante, liée ou non, avec ou sans recipient_id d’un autre profil : refus avant tout envoi dans la conversation', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E envoi effacé messagerie');
    const token = await ownerToken(org);
    const { missionId, candidateId, rowId } = await erasedCandidate(org);
    const before = await candidateRowState(rowId);
    const unlinked = `chat_e2e_snd_${rand()}${rand()}`;
    const linked = `chat_e2e_snd_${rand()}${rand()}`;
    // Conversation non liée : l'interlocuteur est lu chez le prestataire (le faux LinkedIn répond avec ce profil).
    await setMockMode(accountId, { candidate_provider_id: candidateId });
    cleanups.push(() => setMockMode(accountId, {}));
    // Conversation liée à la mission : le candidat est celui du lien, sans lecture chez le prestataire.
    const linkId = await seedMissionConversation({ orgId: org.orgId, projectId: missionId, accountId, candidateId, chatId: linked });
    const [link] = await linksOf(org.orgId, candidateId);
    expect(link.id).toBe(linkId);

    // Avec chat_id, le message part dans la conversation (recipient_id n'achemine rien) : le destinataire
    // contrôlé est son interlocuteur, même si recipient_id désigne un autre profil, non effacé.
    const other = newProfileId();
    for (const chatId of [linked, unlinked]) {
      for (const body of [{ chat_id: chatId }, { chat_id: chatId, recipient_id: other }]) {
        const res = await sendMessage(token, org, accountId, { ...body, text: `Bonjour ${rand()}` });
        expectErased(res);
      }
    }
    const calls = await mockCalls(accountId);
    expect(calls.filter((c) => c.method !== 'GET'), 'aucun envoi dans une conversation').toEqual([]);
    // Seule lecture : la conversation non liée (le lien de l'autre répond sans prestataire).
    expect([...new Set(calls.map((c) => `${c.method} ${decodeURIComponent(c.path)}`))]).toEqual([`GET /v2/${accountId}/chats/${unlinked}`]);
    expect(await linksOf(org.orgId, candidateId), 'lien intact, aucun marqueur').toEqual([link]);
    expect(await candidateRowState(rowId), 'aucun « Contacté »').toEqual(before);
    expect(await linksOf(org.orgId, other), 'recipient_id : ni marqueur ni lien').toEqual([]);
    expect(await rowsOf(org.orgId, other), 'recipient_id : aucune ligne ni « Contacté »').toEqual([]);
    expect(await actionLog(accountId), 'aucune place prise dans le plafond LinkedIn').toEqual([]);
    await expectNoViolations(accountId);
  });

  test('assistant (appel interne) : même refus, rien ne part ni ne s’écrit', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E envoi effacé assistant');
    const { missionId, candidateId, rowId } = await erasedCandidate(org);
    const before = await candidateRowState(rowId);
    const res = await postJson('/functions/v1/unipile-search', {
      action: 'send_message', organization_id: org.orgId, account_id: accountId, recipient_id: candidateId,
      text: `Bonjour ${rand()}`, project_id: missionId, source: 'assistant', created_by: org.owner.userId,
    }, { Authorization: `Bearer ${E2E.serviceRoleKey}` });
    expectErased(res);
    expect(await mockCalls(accountId)).toEqual([]);
    expect(await linksOf(org.orgId, candidateId)).toEqual([]);
    expect(await candidateRowState(rowId)).toEqual(before);
    expect(await actionLog(accountId), 'les appels internes ne prennent pas de place, un refus non plus').toEqual([]);
  });

  test('@critical registre d’effacement illisible : 503 GDPR_UNVERIFIED (échec fermé), rien ne part ni ne s’écrit ; un autre candidat reste joignable', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E envoi registre illisible');
    const token = await ownerToken(org);
    const missionId = await seedMission(org.orgId, org.owner.userId);
    const candidateId = newProfileId();
    const { id: rowId } = await seedCandidateRow({ orgId: org.orgId, createdBy: org.owner.userId, candidateId, missionId, stage: 'retained' });
    const before = await candidateRowState(rowId);
    await overloadRegister(org, accountId, candidateId);
    const chatId = `chat_e2e_snd_${rand()}${rand()}`;
    await seedMissionConversation({ orgId: org.orgId, projectId: missionId, accountId, candidateId, chatId });
    const [link] = await linksOf(org.orgId, candidateId);

    // Nouvelle conversation, InMail, puis conversation liée.
    for (const body of [
      { recipient_id: candidateId },
      { recipient_id: candidateId, is_inmail: true, subject: 'Votre parcours' },
      { chat_id: chatId },
    ]) {
      expectUnverified(await sendMessage(token, org, accountId, { ...body, project_id: `project:${missionId}`, text: `Bonjour ${rand()}` }));
    }
    expect(await mockCalls(accountId), 'aucun appel au faux LinkedIn').toEqual([]);
    expect(await linksOf(org.orgId, candidateId), 'lien intact, aucun marqueur').toEqual([link]);
    expect(await candidateRowState(rowId), 'aucun « Contacté »').toEqual(before);
    expect(await actionLog(accountId), 'aucune place prise dans le plafond LinkedIn').toEqual([]);

    await expectWitnessSent(token, org, accountId, missionId);
  });

  test('conversation de groupe : le candidat est inconnu, le message part sans enregistrement, comme avant', async () => {
    const { org, accountId } = await trackedSendingOrg('E2E envoi groupe');
    const token = await ownerToken(org);
    const chatId = `chat_e2e_snd_${rand()}${rand()}`;
    await setMockMode(accountId, { routes: [{
      method: 'GET', op: 'getChat',
      body: { object: 'Chat', id: chatId, name: 'Groupe test', type: 'group', is_group: true, is_1to1: false, is_channel: false, provider: 'linkedin', folders: [], unread_count: 0 },
    }] });
    cleanups.push(() => setMockMode(accountId, {}));
    const text = `Bonjour ${rand()}`;
    const res = await sendMessage(token, org, accountId, { chat_id: chatId, text });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);
    expect(await sentTexts(accountId), 'le message part dans le groupe').toEqual([text]);
    const { data: links } = await admin().from('mission_conversations').select('id').eq('organization_id', org.orgId);
    expect(links ?? [], 'aucun marqueur ni lien').toEqual([]);
    expect((await actionLog(accountId)).map((r) => r.action_type), 'une place prise').toEqual(['message']);
    await expectNoV1Calls();
  });
});
