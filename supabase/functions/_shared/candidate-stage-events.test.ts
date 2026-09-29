// Refonte mission, lot 0b-2a : aides des écrivains serveur de l'étape
// candidat. candidateRef et missionIdFrom (entrées des fonctions SQL),
// classifyStageRpcError (décision 9), et appels typés : chaque appel transmet
// exactement les paramètres de la dernière définition SQL de sa fonction
// (lue dans supabase/migrations), aucun ne lève.
//
//   deno test --no-check --allow-read supabase/functions/_shared/candidate-stage-events.test.ts

import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  candidateRef,
  classifyStageRpcError,
  missionIdFrom,
  recordInbound,
  recordMeeting,
  recordOutbound,
  recordOwnMessage,
  recordReplySummary,
  resolveMeetingMission,
  type StageRpcClient,
} from './candidate-stage-events.ts';

type Args = Record<string, unknown>;
type Reply = { data: unknown; error: unknown };

/** Faux client : enregistre chaque appel et rend la réponse scriptée (ou lève). */
function fakeClient(reply: (fn: string, args: Args) => Reply = () => ({ data: null, error: null })) {
  const calls: Array<{ fn: string; args: Args }> = [];
  const client: StageRpcClient = {
    rpc(fn: string, args: Args = {}) {
      calls.push({ fn, args });
      return Promise.resolve().then(() => reply(fn, args));
    },
  };
  return { client, calls };
}

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const ENROLLMENT = '44444444-4444-4444-8444-444444444444';

// ─── candidateRef ──────────────────────────────────────────────────────────

Deno.test('candidateRef : identifiants sans espaces, sans vide ni doublon, ordre gardé', () => {
  deepStrictEqual(
    candidateRef({ ids: [' ACoAAB ', 'ACoAAB', '', '   ', null, undefined, 'AEMAAC', 'x'.repeat(513), 'ACoAAB'] }),
    { ids: ['ACoAAB', 'AEMAAC'] },
  );
  deepStrictEqual(candidateRef({}), { ids: [] });
  strictEqual(candidateRef({ ids: ['x'.repeat(512)] }).ids.length, 1, '512 caractères : gardé, comme candidate_ref_ids');
});

Deno.test('candidateRef : slug en minuscules, tiré de l\'URL de profil s\'il manque', () => {
  strictEqual(candidateRef({ slug: ' Camille-D ' }).slug, 'camille-d');
  strictEqual(candidateRef({ slug: 'https://www.linkedin.com/in/Camille-D/?utm_source=share' }).slug, 'camille-d');
  deepStrictEqual(candidateRef({ profileUrl: ' https://fr.linkedin.com/in/CAMILLE ' }), {
    ids: [], slug: 'camille', profile_url: 'https://fr.linkedin.com/in/CAMILLE',
  });
  strictEqual(candidateRef({ slug: 'camille', profileUrl: 'https://www.linkedin.com/in/autre' }).slug, 'camille', 'slug explicite d\'abord');
  deepStrictEqual(candidateRef({ profileUrl: 'https://example.com/camille' }), { ids: [], profile_url: 'https://example.com/camille' });
  deepStrictEqual(candidateRef({ slug: '  ', profileUrl: '' }), { ids: [] });
  strictEqual(candidateRef({ slug: 'linkedin.com/in/', profileUrl: 'https://www.linkedin.com/in/camille' }).slug, 'camille', 'URL sans slug : repli sur le profil');
});

Deno.test('candidateRef : nom et titre sans espaces, champs vides retirés', () => {
  deepStrictEqual(candidateRef({ ids: ['ACoAAB'], name: ' Camille Durand ', headline: ' CTO ' }), {
    ids: ['ACoAAB'], name: 'Camille Durand', headline: 'CTO',
  });
  deepStrictEqual(Object.keys(candidateRef({ ids: ['a'], name: '', headline: null, slug: undefined })), ['ids']);
});

// ─── missionIdFrom ─────────────────────────────────────────────────────────

Deno.test('missionIdFrom : préfixe project: retiré, forme uuid exigée', () => {
  strictEqual(missionIdFrom(PROJECT), PROJECT);
  strictEqual(missionIdFrom(`project:${PROJECT}`), PROJECT);
  strictEqual(missionIdFrom(` project:${PROJECT.toUpperCase()} `), PROJECT);
  strictEqual(missionIdFrom('project:abc'), null);
  strictEqual(missionIdFrom('notion-job-12'), null);
  strictEqual(missionIdFrom(''), null);
  strictEqual(missionIdFrom(null), null);
  strictEqual(missionIdFrom(42), null);
});

// ─── classifyStageRpcError (décision 9) ────────────────────────────────────

Deno.test('classement : refus métier par code (22023, P0002, 42501)', () => {
  strictEqual(classifyStageRpcError({ code: '22023', message: 'Candidat sans identifiant', hint: 'STAGE_CANDIDATE_REQUIRED' }), 'business');
  strictEqual(classifyStageRpcError({ code: 'P0002', message: 'Mission introuvable', hint: 'STAGE_MISSION_NOT_FOUND' }), 'business');
  strictEqual(classifyStageRpcError({ code: '42501', message: 'permission denied for function record_own_message' }), 'business');
  strictEqual(classifyStageRpcError({ code: 'p0002' }), 'business');
});

Deno.test('classement : refus métier par indice STAGE_, MISSION_ ou LINK_', () => {
  strictEqual(classifyStageRpcError({ code: 'P0001', hint: 'STAGE_DIRECT_WRITE' }), 'business');
  strictEqual(classifyStageRpcError({ code: '', hint: 'MISSION_CONVERSATION_ORG_MISMATCH' }), 'business');
  strictEqual(classifyStageRpcError({ hint: ' LINK_SOURCE_UNKNOWN ' }), 'business');
  strictEqual(classifyStageRpcError({ code: '40001', hint: 'STAGEX' }), 'transient', 'indice sans le préfixe exact');
  strictEqual(classifyStageRpcError({ code: '40001', hint: 'Retry: STAGE_X' }), 'transient', 'préfixe en tête seulement');
});

Deno.test('classement : fonction absente (PGRST202, 42883)', () => {
  strictEqual(classifyStageRpcError({
    code: 'PGRST202',
    message: 'Could not find the function public.record_candidate_inbound(p_account_id, p_candidate) in the schema cache',
    hint: 'Perhaps you meant to call the function public.record_candidate_outbound',
  }), 'missing');
  strictEqual(classifyStageRpcError({ code: '42883', message: 'function public.record_own_message(uuid) does not exist' }), 'missing');
});

Deno.test('classement : tout le reste est transitoire (rejoué par le webhook)', () => {
  for (const code of ['40001', '40P01', '57014', '53300', '08006', 'PGRST000', 'PGRST001', '23505', '']) {
    strictEqual(classifyStageRpcError({ code, message: 'x', hint: null }), 'transient', code);
  }
  strictEqual(classifyStageRpcError(new TypeError('fetch failed')), 'transient');
  strictEqual(classifyStageRpcError({ message: 'TypeError: fetch failed', details: '', hint: '', code: '' }), 'transient');
  strictEqual(classifyStageRpcError('délai dépassé'), 'transient');
  strictEqual(classifyStageRpcError(null), 'transient');
});

// ─── Appels : paramètres exacts des fonctions SQL ──────────────────────────

/** Paramètres de la dernière définition de chaque fonction dans supabase/migrations (ordre des fichiers). */
async function sqlSignatures(names: string[]): Promise<Map<string, string[]>> {
  const dir = new URL('../../migrations/', import.meta.url);
  const files: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith('.sql')) files.push(entry.name);
  }
  files.sort();
  const out = new Map<string, string[]>();
  for (const file of files) {
    const sql = await Deno.readTextFile(new URL(file, dir));
    for (const name of names) {
      const re = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\(([\\s\\S]*?)\\)\\s*RETURNS`, 'gi');
      for (const m of sql.matchAll(re)) {
        out.set(name, m[1].split(',').map((p) => p.trim().split(/\s+/)[0]).filter((p) => p.length > 0));
      }
    }
  }
  return out;
}

const candidate = candidateRef({ ids: ['ACoAAB'], profileUrl: 'https://www.linkedin.com/in/camille' });

Deno.test('appels : chaque fonction reçoit exactement ses paramètres SQL, jamais undefined', async () => {
  const { client, calls } = fakeClient();
  await recordOutbound(client, { organizationId: ORG, accountId: 'acc-1', candidate, source: 'manual' });
  await recordInbound(client, { organizationId: ORG, candidate });
  await recordOwnMessage(client, { organizationId: ORG, accountId: 'acc-1', chatId: 'chat-1', messageId: null });
  await recordReplySummary(client, { organizationId: ORG, accountId: null, chatId: null, candidate, summary: 'Intéressé' });
  await resolveMeetingMission(client, { organizationId: ORG, candidate });
  await recordMeeting(client, { organizationId: ORG, projectId: PROJECT, candidate });

  const fns = calls.map((c) => c.fn);
  deepStrictEqual(fns, [
    'record_candidate_outbound', 'record_candidate_inbound', 'record_own_message',
    'record_reply_summary', 'resolve_meeting_mission', 'record_candidate_meeting',
  ]);
  const signatures = await sqlSignatures(fns);
  for (const { fn, args } of calls) {
    const params = signatures.get(fn);
    strictEqual(Array.isArray(params) && params.length > 0, true, `${fn} : définition SQL introuvable`);
    deepStrictEqual(Object.keys(args).sort(), [...params!].sort(), fn);
    for (const [key, value] of Object.entries(args)) strictEqual(value !== undefined, true, `${fn}.${key}`);
  }
});

Deno.test('recordOutbound : envoi par défaut (jamais p_pending NULL), marqueur explicite', async () => {
  const { client, calls } = fakeClient();
  await recordOutbound(client, { organizationId: ORG, accountId: 'acc-1', candidate, source: 'sequence' });
  deepStrictEqual(calls[0].args, {
    p_organization_id: ORG, p_account_id: 'acc-1', p_candidate: candidate, p_source: 'sequence',
    p_project_id: null, p_chat_id: null, p_message_id: null, p_enrollment_id: null, p_created_by: null,
    p_pending: false, p_send_kind: 'message',
  });
  await recordOutbound(client, {
    organizationId: ORG, accountId: 'acc-1', candidate, source: 'inmail_queue', projectId: PROJECT,
    chatId: 'chat-1', messageId: 'msg-1', enrollmentId: ENROLLMENT, createdBy: USER, pending: true, sendKind: 'inmail',
  });
  deepStrictEqual(calls[1].args, {
    p_organization_id: ORG, p_account_id: 'acc-1', p_candidate: candidate, p_source: 'inmail_queue',
    p_project_id: PROJECT, p_chat_id: 'chat-1', p_message_id: 'msg-1', p_enrollment_id: ENROLLMENT, p_created_by: USER,
    p_pending: true, p_send_kind: 'inmail',
  });
});

Deno.test('recordInbound : inscriptions nettoyées ; liste vide = recherche par le serveur (NULL)', async () => {
  const { client, calls } = fakeClient();
  await recordInbound(client, {
    organizationId: ORG, accountId: 'acc-1', candidate, chatId: 'chat-1',
    enrollmentIds: [' e1 ', 'e1', '', null, 'e2'], enrollmentFirst: true,
  });
  deepStrictEqual(calls[0].args, {
    p_organization_id: ORG, p_account_id: 'acc-1', p_candidate: candidate, p_chat_id: 'chat-1',
    p_enrollment_ids: ['e1', 'e2'], p_enrollment_first: true, p_received_at: null,
  });
  await recordInbound(client, { organizationId: ORG, candidate, enrollmentIds: ['', null], receivedAt: '2026-09-28T10:00:00.000Z' });
  deepStrictEqual(calls[1].args, {
    p_organization_id: ORG, p_account_id: null, p_candidate: candidate, p_chat_id: null,
    p_enrollment_ids: null, p_enrollment_first: false, p_received_at: '2026-09-28T10:00:00.000Z',
  });
});

Deno.test('recordOwnMessage : candidat inconnu transmis vide (celui de la conversation liée)', async () => {
  const { client, calls } = fakeClient();
  await recordOwnMessage(client, { organizationId: ORG, accountId: 'acc-1', chatId: 'chat-1', messageId: 'msg-9' });
  deepStrictEqual(calls[0].args, {
    p_organization_id: ORG, p_account_id: 'acc-1', p_chat_id: 'chat-1', p_message_id: 'msg-9', p_candidate: { ids: [] },
  });
});

// ─── Résultats ─────────────────────────────────────────────────────────────

Deno.test('résultat : données rendues telles quelles', async () => {
  const data = { project_id: PROJECT, via: 'chat', link_id: 'l1', contacted_rows: [], rows: [{ id: 'r1', changed: true, result: 'updated', general_stage: 'replied' }] };
  const { client } = fakeClient(() => ({ data, error: null }));
  deepStrictEqual(await recordInbound(client, { organizationId: ORG, candidate }), { ok: true, data });
});

Deno.test('résultat : erreur de la base classée, jamais levée', async () => {
  const { client } = fakeClient(() => ({
    data: null, error: { code: 'P0002', message: 'Mission introuvable', hint: 'STAGE_MISSION_NOT_FOUND', details: null },
  }));
  deepStrictEqual(await recordMeeting(client, { organizationId: ORG, projectId: PROJECT, candidate }), {
    ok: false, fn: 'record_candidate_meeting', kind: 'business',
    error: { code: 'P0002', message: 'Mission introuvable', hint: 'STAGE_MISSION_NOT_FOUND', details: null },
  });
  const missing = fakeClient(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function', hint: null, details: null } }));
  const res = await recordOwnMessage(missing.client, { organizationId: ORG, accountId: 'a', chatId: 'c', messageId: null });
  strictEqual(res.ok === false && res.kind, 'missing');
});

Deno.test('résultat : exception du client (réseau) transitoire, jamais levée', async () => {
  const { client } = fakeClient(() => { throw new TypeError('fetch failed'); });
  const res = await recordOutbound(client, { organizationId: ORG, accountId: 'acc-1', candidate, source: 'manual' });
  strictEqual(res.ok, false);
  if (!res.ok) {
    strictEqual(res.fn, 'record_candidate_outbound');
    strictEqual(res.kind, 'transient');
    strictEqual(res.error.message, 'fetch failed');
  }
});

Deno.test('resolveMeetingMission : première ligne de la table rendue, sinon null', async () => {
  const found = fakeClient(() => ({ data: [{ project_id: PROJECT, via: 'single_mission' }], error: null }));
  deepStrictEqual(await resolveMeetingMission(found.client, { organizationId: ORG, candidate }), {
    ok: true, data: { project_id: PROJECT, via: 'single_mission' },
  });
  const none = fakeClient(() => ({ data: [], error: null }));
  deepStrictEqual(await resolveMeetingMission(none.client, { organizationId: ORG, candidate }), { ok: true, data: null });
  const nullData = fakeClient(() => ({ data: null, error: null }));
  deepStrictEqual(await resolveMeetingMission(nullData.client, { organizationId: ORG, candidate }), { ok: true, data: null });
  const failed = fakeClient(() => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }));
  const res = await resolveMeetingMission(failed.client, { organizationId: ORG, candidate });
  strictEqual(res.ok === false && res.kind, 'transient');
});
