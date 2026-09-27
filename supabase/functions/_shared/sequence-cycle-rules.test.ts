// Règles pures du cycle d'envoi (audit séquences 2026-09-25, lot E1b).
//
//   deno test --no-check supabase/functions/_shared/sequence-cycle-rules.test.ts

import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  dormantResumeRoute, executionChannel, hasTimeToLock, heartbeatStatusFor, isConditionRetry,
  isStaleTemplateSnapshot, nextLocalDayAt, normalizeEmailForSuppression, normalizeReplyCheck,
  pickSendingTimezone, quotaBlockedRetryAt, reEnrollTracking, selectCycleBatch, sequencesToAutoPause,
  withContentOrigin, CYCLE_BUDGET_MS, EMAIL_UNCERTAIN_MESSAGE, TEMPLATE_SNAPSHOT_ORIGIN,
} from './sequence-cycle-rules.ts';

// ─── SEQ-074
Deno.test('budget : jamais de verrou visible à moins de 20 s, ni d\'IA à moins de 30 s', () => {
  const start = 1_000_000;
  const deadline = start + CYCLE_BUDGET_MS;
  strictEqual(hasTimeToLock(deadline, start + 5_000, { visible: true, needsAi: true }), true);
  strictEqual(hasTimeToLock(deadline, start + 15_000, { visible: true, needsAi: true }), false, '25 s restantes : pas d\'IA');
  strictEqual(hasTimeToLock(deadline, start + 15_000, { visible: true, needsAi: false }), true);
  strictEqual(hasTimeToLock(deadline, start + 25_000, { visible: true, needsAi: false }), false, '15 s restantes : pas d\'envoi');
  strictEqual(hasTimeToLock(deadline, start + 25_000, { visible: false, needsAi: false }), true, 'étape invisible');
  strictEqual(hasTimeToLock(deadline, start + 32_000, { visible: false, needsAi: false }), false, 'moins de 10 s : pas même une lecture de profil');
  strictEqual(hasTimeToLock(deadline, start + 41_000, { visible: false, needsAi: false }), false, 'échéance passée');
});

// ─── SEQ-187
Deno.test('cadence : 3 envois visibles PAR compte, e-mails hors plafond, invisibles plafonnés', () => {
  const li = (account: string) => ({ step: { action_type: 'message' }, enrollment: { account_id: account } });
  const batch = [li('A'), li('A'), li('A'), li('A'), li('A'), li('B'),
    { step: { action_type: 'email', step_channel: 'email' }, enrollment: { account_id: 'A' } },
    { step: { action_type: 'message', step_channel: 'email' }, enrollment: { account_id: 'A' } },
    { step: { action_type: 'profile_visit' }, enrollment: { account_id: 'A' } }];
  const r = selectCycleBatch(batch);
  strictEqual(r.visible, 4, '3 pour A, 1 pour B');
  strictEqual(r.email, 2);
  strictEqual(r.invisible, 1);
  strictEqual(r.selected.includes(batch[5]), true, 'le compte B n\'attend plus la file de A');
  strictEqual(r.selected.includes(batch[3]), false);
  // Rotation : l'expéditeur attribué, puis celui de l'étape, font foi.
  const rot = selectCycleBatch([
    { step: { action_type: 'inmail' }, enrollment: { assigned_sender_id: 'R1', account_id: 'A' } },
    { step: { action_type: 'inmail', sender_id: 'S' }, enrollment: { account_id: 'A' } },
    li('A'), li('A'), li('A'),
  ]);
  strictEqual(rot.visible, 5);
  strictEqual(selectCycleBatch(Array.from({ length: 20 }, () => ({ step: { action_type: 'check_connection' }, enrollment: {} }))).invisible, 15);
});

// ─── SEQ-195
Deno.test('canal de l\'exécution', () => {
  strictEqual(executionChannel({ action_type: 'message' }), 'linkedin');
  strictEqual(executionChannel({ action_type: 'whatsapp_message' }), 'whatsapp');
  strictEqual(executionChannel({ action_type: 'message', step_channel: 'email' }), 'email');
  strictEqual(executionChannel({ action_type: 'message', step_channel: 'manual' }), 'manual');
  strictEqual(executionChannel({ action_type: 'inmail', step_channel: 'bidon' }), 'linkedin');
});

// ─── SEQ-073
Deno.test('auto-pause : taux par séquence, minimum d\'actions', () => {
  const stats = new Map([
    ['seqA', { actioned: 5, failed: 5 }],   // organisation A : compte restreint
    ['seqB', { actioned: 2, failed: 1 }],   // organisation B : un échec passager
    ['seqC', { actioned: 10, failed: 3 }],  // 30 % pile : pas au-delà
    ['seqD', { actioned: 10, failed: 4 }],
  ]);
  deepStrictEqual(sequencesToAutoPause(stats).sort(), ['seqA', 'seqD']);
  deepStrictEqual(sequencesToAutoPause(new Map([['x', { actioned: 6, failed: 0 }]])), []);
});

// ─── SEQ-193
Deno.test('refus du plafond : +30 min, début de plage du lendemain, +24 h', () => {
  const now = new Date('2026-09-25T10:00:00Z'); // 12:00 à Paris
  strictEqual(quotaBlockedRetryAt('infrastructure', now, 'Europe/Paris', 8).toISOString(), '2026-09-25T10:30:00.000Z');
  strictEqual(quotaBlockedRetryAt('daily', now, 'Europe/Paris', 8).toISOString(), '2026-09-26T06:00:00.000Z', '08:00 à Paris le 26');
  strictEqual(quotaBlockedRetryAt('weekly', now, 'Europe/Paris', 8).toISOString(), '2026-09-26T10:00:00.000Z');
  strictEqual(quotaBlockedRetryAt('inmail_credits', now, 'Europe/Paris', 8).toISOString(), '2026-09-26T10:00:00.000Z');
  strictEqual(quotaBlockedRetryAt(undefined, now, 'Europe/Paris', 8).toISOString(), '2026-09-26T10:00:00.000Z', 'forme historique');
  // Passage à l'heure d'hiver à Paris dans la nuit du 24 au 25 octobre 2026.
  strictEqual(nextLocalDayAt(new Date('2026-10-24T12:00:00Z'), 'Europe/Paris', 8).toISOString(), '2026-10-25T07:00:00.000Z');
  strictEqual(nextLocalDayAt(now, 'America/New_York', 9).toISOString(), '2026-09-26T13:00:00.000Z');
});

// ─── SEQ-077 / SEQ-078
Deno.test('retours à trois états : un doute n\'est jamais « pas de réponse »', () => {
  strictEqual(normalizeReplyCheck(true), 'replied');
  strictEqual(normalizeReplyCheck('replied'), 'replied');
  strictEqual(normalizeReplyCheck(false), 'no_reply');
  strictEqual(normalizeReplyCheck('no_reply'), 'no_reply');
  strictEqual(normalizeReplyCheck('unknown'), 'unknown');
  strictEqual(normalizeReplyCheck(undefined), 'unknown');
  strictEqual(isConditionRetry('retry'), true);
  strictEqual(isConditionRetry(false), false);
  strictEqual(isConditionRetry('wait'), false);
});

// ─── SEQ-080
Deno.test('e-mail sans preuve : message reconnu comme envoi incertain par la reprise', () => {
  strictEqual(EMAIL_UNCERTAIN_MESSAGE.startsWith('Envoi incertain'), true);
});

// ─── SEQ-090
Deno.test('snapshot du modèle au verrou : régénéré, une vraie modification reste prioritaire', () => {
  const td = withContentOrigin({ opens: 1 }, TEMPLATE_SNAPSHOT_ORIGIN);
  deepStrictEqual(td, { opens: 1, content_origin: TEMPLATE_SNAPSHOT_ORIGIN });
  strictEqual(isStaleTemplateSnapshot({ trackingData: td, finalMessage: 'Salut {{first_name}}', messageTemplate: 'Salut {{first_name}}', finalSubject: '', subjectTemplate: null }), true);
  strictEqual(isStaleTemplateSnapshot({ trackingData: td, finalMessage: 'Texte corrigé', messageTemplate: 'Salut {{first_name}}' }), false, 'modifié dans le Journal');
  strictEqual(isStaleTemplateSnapshot({ trackingData: null, finalMessage: 'Salut', messageTemplate: 'Salut' }), false, 'sans marqueur');
  strictEqual(isStaleTemplateSnapshot({ trackingData: withContentOrigin(td, 'resolved'), finalMessage: 'Salut', messageTemplate: 'Salut' }), false);
  deepStrictEqual(withContentOrigin(td, null), { opens: 1 });
});

// ─── SEQ-082
Deno.test('inscription dormante : branche de délai et résultat de « Vérifier connexion »', () => {
  const timeoutStep = { action_type: 'wait_connection', timeout_branch_step_id: 'inmail-10' };
  deepStrictEqual(dormantResumeRoute({ status: 'skipped', skip_reason: 'Timeout 3d', step: timeoutStep }, 'pending_invite'), { kind: 'branch', stepId: 'inmail-10' });
  deepStrictEqual(dormantResumeRoute({ status: 'skipped', skip_reason: 'Timeout 3d', step: { action_type: 'wait_connection' } }, null), { kind: 'linear' });
  const check = { action_type: 'check_connection', if_true_goto_step: 'msg-2', if_false_goto_step: 'invite-5' };
  deepStrictEqual(dormantResumeRoute({ status: 'sent', step: check }, 'connected'), { kind: 'branch', stepId: 'msg-2' });
  deepStrictEqual(dormantResumeRoute({ status: 'sent', step: check }, 'not_connected'), { kind: 'branch', stepId: 'invite-5' });
  deepStrictEqual(dormantResumeRoute({ status: 'sent', step: { action_type: 'check_connection' } }, 'connected'), { kind: 'condition', result: 'yes' });
  deepStrictEqual(dormantResumeRoute({ status: 'sent', step: check }, 'unknown'), { kind: 'unknown_connection' });
  deepStrictEqual(dormantResumeRoute({ status: 'sent', step: { action_type: 'message' } }, 'connected'), { kind: 'linear' });
});

// ─── SEQ-194 / SEQ-188 / SEQ-197 / SEQ-220
Deno.test('battement de cœur, désinscription, fuseau, relance', () => {
  strictEqual(heartbeatStatusFor({ success: true, skipped_reason: 'lock_held' }), 'skipped');
  strictEqual(heartbeatStatusFor({ success: true, results: {} }), 'ok');
  strictEqual(normalizeEmailForSuppression('  Jean.Dupont@Acme.COM '), 'jean.dupont@acme.com');
  strictEqual(normalizeEmailForSuppression(''), null);
  strictEqual(pickSendingTimezone('America/Montreal', 'Europe/Paris'), 'America/Montreal');
  strictEqual(pickSendingTimezone(null, 'Europe/London'), 'Europe/London');
  strictEqual(pickSendingTimezone('Pas/UnFuseau', null), 'Europe/Paris');
  deepStrictEqual(reEnrollTracking({ a: 1 }, '2026-09-01T10:00:00Z', '2026-09-25T10:00:00Z'),
    { a: 1, previous_replied_at: '2026-09-01T10:00:00Z', re_enrolled_at: '2026-09-25T10:00:00Z' });
  deepStrictEqual(reEnrollTracking({ previous_replied_at: 'x' }, null, 'n'), { previous_replied_at: 'x', re_enrolled_at: 'n' });
});

// ─── Vague finale (audit 2026-09-25, lot E1) ────────────────────────────────

import {
  dedupeByProfile, isInvalidTextRepresentation, rotationUnavailablePlan, shouldReadNextSelectionPage,
  stepUsesLinkedInSender, ROTATION_LOOKUP_RETRY_MESSAGE,
} from './sequence-cycle-rules.ts';

Deno.test('SEQ-187 : les exécutions d\'inscriptions closes n\'occupent pas la place d\'envoi de leur compte', () => {
  const msg = { action_type: 'message' };
  const batch = selectCycleBatch([
    { id: 'c1', step: msg, enrollment: { account_id: 'A', status: 'replied' } },
    { id: 'c2', step: msg, enrollment: { account_id: 'A', status: 'completed' } },
    { id: 'c3', step: msg, enrollment: { account_id: 'A', status: 'stopped' } },
    { id: 'v1', step: msg, enrollment: { account_id: 'A', status: 'active' } },
    { id: 'v2', step: msg, enrollment: { account_id: 'A', status: 'active' } },
    { id: 'v3', step: msg, enrollment: { account_id: 'A', status: 'active' } },
    { id: 'v4', step: msg, enrollment: { account_id: 'A', status: 'active' } },
  ]);
  deepStrictEqual(batch.selected.map((e) => e.id), ['c1', 'c2', 'c3', 'v1', 'v2', 'v3']);
  strictEqual(batch.closed, 3);
  strictEqual(batch.visible, 3);
});

Deno.test('SEQ-187 : sélection par pages tant que la page était pleine et le lot incomplet', () => {
  strictEqual(shouldReadNextSelectionPage(0, 200, 3), true);
  strictEqual(shouldReadNextSelectionPage(0, 150, 3), false, 'page incomplète : plus rien à lire');
  strictEqual(shouldReadNextSelectionPage(0, 200, 100), false, 'lot complet');
  strictEqual(shouldReadNextSelectionPage(4, 200, 3), false, 'plafond de pages');
});

Deno.test('SEQ-187 : une exécution par candidat et par cycle, jamais sans profil', () => {
  const out = dedupeByProfile([
    { id: 1, enrollment: { profile_id: 'p1' } },
    { id: 2, enrollment: { profile_id: 'p1' } },
    { id: 3, enrollment: { profile_id: null } },
    { id: 4, enrollment: { profile_id: 'p2' } },
  ]);
  deepStrictEqual(out.map((e) => e.id), [1, 4]);
});

Deno.test('SEQ-155 : suite selon la cause quand la rotation ne propose personne', () => {
  deepStrictEqual(rotationUnavailablePlan('capped'), { kind: 'block_until_tomorrow' });
  deepStrictEqual(rotationUnavailablePlan(undefined), { kind: 'block_until_tomorrow' });
  deepStrictEqual(rotationUnavailablePlan('lookup_failed'), { kind: 'retry_soon', delayMs: 15 * 60 * 1000, message: ROTATION_LOOKUP_RETRY_MESSAGE });
  deepStrictEqual(rotationUnavailablePlan('empty_pool'), { kind: 'use_enrollment_account' });
  deepStrictEqual(rotationUnavailablePlan('no_org'), { kind: 'use_enrollment_account' });
});

Deno.test('SEQ-155 : tirage seulement pour une étape qui passe par un compte LinkedIn', () => {
  strictEqual(stepUsesLinkedInSender({ action_type: 'message' }), true);
  strictEqual(stepUsesLinkedInSender({ action_type: 'inmail' }), true);
  strictEqual(stepUsesLinkedInSender({ action_type: 'connection_request' }), true);
  strictEqual(stepUsesLinkedInSender({ action_type: 'check_connection' }), true);
  strictEqual(stepUsesLinkedInSender({ action_type: 'email' }), false);
  strictEqual(stepUsesLinkedInSender({ action_type: 'message', step_channel: 'email' }), false);
  strictEqual(stepUsesLinkedInSender({ action_type: 'wait_reply' }), false);
  strictEqual(stepUsesLinkedInSender({ action_type: 'condition_branch' }), false);
  strictEqual(stepUsesLinkedInSender(null), false);
});

Deno.test('rotation sans migration B6 : 22P02 reconnu', () => {
  strictEqual(isInvalidTextRepresentation({ code: '22P02', message: 'invalid input syntax for type uuid' }), true);
  strictEqual(isInvalidTextRepresentation({ code: '23514' }), false);
  strictEqual(isInvalidTextRepresentation(null), false);
});

// ─── Dernière passe (audit 2026-09-25, lot E1) : famine entre organisations ──

import {
  accountExclusionFilter, accountsAtCycleCap, keptByAccountExclusion, readCycleSelection,
} from './sequence-cycle-rules.ts';

type SimRow = {
  id: string;
  step: { action_type: string; sender_id?: string | null };
  enrollment: { profile_id: string; status: string; account_id: string | null; assigned_sender_id: string | null; sequence_id: string };
};

const simRow = (id: string, account: string | null, action = 'connection_request', extra: Partial<SimRow['enrollment']> = {}): SimRow => ({
  id,
  step: { action_type: action },
  enrollment: { profile_id: `p-${id}`, status: 'active', account_id: account, assigned_sender_id: null, sequence_id: 's', ...extra },
});

/**
 * Base simulée : ordre d'ancienneté conservé, filtre `enrollment.or=(...)`
 * appliqué avec la sémantique SQL (réécrite ici, indépendante du code testé),
 * `range(from, to)`. Enregistre chaque lecture.
 */
function simDb(rows: SimRow[]) {
  const reads: Array<{ from: number; to: number; filter: string | null; ids: string[] }> = [];
  const readPage = ({ from, to, exclusionFilter }: { from: number; to: number; exclusionFilter: string | null }) => {
    const list = exclusionFilter?.match(/account_id\.not\.in\.\(([^)]*)\)/)?.[1].split(',') ?? [];
    const visible = rows.filter((r) => {
      if (!exclusionFilter) return true;
      const e = r.enrollment;
      return e.status !== 'active' || e.assigned_sender_id !== null || e.account_id === null || !list.includes(e.account_id);
    });
    const page = visible.slice(from, to + 1);
    reads.push({ from, to, filter: exclusionFilter, ids: page.map((r) => r.id) });
    return Promise.resolve({ rows: page, error: null });
  };
  return { readPage, reads };
}

Deno.test('SEQ-187 (fin) : 1 200 candidats d\'un compte ne cachent plus les autres organisations', async () => {
  const rows: SimRow[] = [];
  for (let i = 0; i < 1200; i++) rows.push(simRow(`a${String(i).padStart(4, '0')}`, 'acc_A'));
  for (let i = 0; i < 9; i++) rows.push(simRow(`b${i}`, `acc_B${i % 3}`, 'message'));
  const db = simDb(rows);
  const { selection, error } = await readCycleSelection<SimRow>(db.readPage);
  strictEqual(error, null);
  const picked = selection.selected.map((r) => r.enrollment.account_id);
  strictEqual(picked.filter((a) => a === 'acc_A').length, 3, 'plafond de 3 pour le compte engorgé');
  strictEqual(picked.filter((a) => a?.startsWith('acc_B')).length, 9, 'les autres comptes sont lus et retenus');
  // Deuxième page : compte A exclu en base, lue depuis le début du nouveau filtre.
  strictEqual(db.reads.length, 2);
  deepStrictEqual([db.reads[1].from, db.reads[1].filter], [0, 'status.neq.active,assigned_sender_id.not.is.null,account_id.is.null,account_id.not.in.(acc_A)']);
});

Deno.test('SEQ-187 (fin) : sans exclusion, pages contiguës comme avant ; avec exclusion, jamais de ligne relue ni sautée', async () => {
  const rows: SimRow[] = [];
  for (let i = 0; i < 150; i++) rows.push(simRow(`a${String(i).padStart(3, '0')}`, 'acc_A'));
  // 100 comptes à 3 exécutions chacun, puis un dernier compte.
  for (let c = 0; c < 100; c++) for (let k = 0; k < 3; k++) rows.push(simRow(`c${String(c).padStart(3, '0')}-${k}`, `acc_C${c}`, 'message'));
  const db = simDb(rows);
  const { selection, due } = await readCycleSelection<SimRow>(db.readPage);
  const allRead = db.reads.flatMap((r) => r.ids);
  strictEqual(new Set(allRead).size, allRead.length, 'aucune exécution relue');
  strictEqual(due.length, allRead.length);
  // Page 2 : reprend juste après les 50 exécutions C déjà lues en page 1.
  strictEqual(db.reads[1].from, 50);
  strictEqual(db.reads[1].ids[0], 'c016-2');
  strictEqual(selection.selected.length >= 100, true);

  // Arriéré sans compte au plafond : lecture contiguë, offsets 0, 200, 400 (comme avant).
  const flat: SimRow[] = [];
  for (let i = 0; i < 450; i++) flat.push(simRow(`f${String(i).padStart(3, '0')}`, `acc_F${i}`, 'message', { status: i < 30 ? 'replied' : 'active' }));
  const db2 = simDb(flat);
  await readCycleSelection<SimRow>(db2.readPage, { target: 10_000 });
  deepStrictEqual(db2.reads.map((r) => [r.from, r.filter]), [[0, null], [200, null], [400, null]]);

  // Étapes invisibles au plafond : les 40 premiers comptes écartés sont exclus,
  // la page suivante reprend juste après la première (offset 160 dans le filtre).
  const inv: SimRow[] = [];
  for (let i = 0; i < 450; i++) inv.push(simRow(`i${String(i).padStart(3, '0')}`, `acc_I${i}`, 'profile_visit'));
  const db3 = simDb(inv);
  await readCycleSelection<SimRow>(db3.readPage);
  const read3 = db3.reads.flatMap((r) => r.ids);
  strictEqual(new Set(read3).size, read3.length, 'aucune exécution relue');
  deepStrictEqual([db3.reads[1].from, db3.reads[1].ids[0]], [160, 'i200']);
});

Deno.test('SEQ-187 (fin) : étapes invisibles au plafond du cycle, les autres comptes sont lus ensuite', async () => {
  const rows: SimRow[] = [];
  for (let i = 0; i < 1200; i++) rows.push(simRow(`v${String(i).padStart(4, '0')}`, 'acc_A', 'profile_visit'));
  for (let i = 0; i < 4; i++) rows.push(simRow(`m${i}`, `acc_M${i}`, 'message'));
  const db = simDb(rows);
  const { selection } = await readCycleSelection<SimRow>(db.readPage);
  strictEqual(selection.invisible, 15);
  strictEqual(selection.visible, 4, 'les envois des autres comptes entrent dans le lot');
});

Deno.test('SEQ-187 (fin) : erreur de lecture, première page renvoyée, suivantes tolérées', async () => {
  const first = await readCycleSelection<SimRow>(() => Promise.resolve({ rows: null, error: { code: '500' } }));
  deepStrictEqual(first.error, { code: '500' });
  const rows: SimRow[] = [];
  for (let i = 0; i < 200; i++) rows.push(simRow(`a${String(i).padStart(3, '0')}`, 'acc_A'));
  let calls = 0;
  const errors: number[] = [];
  const later = await readCycleSelection<SimRow>(({ from, to }) => {
    calls++;
    return Promise.resolve(calls === 1 ? { rows: rows.slice(from, to + 1), error: null } : { rows: null, error: { code: '57014' } });
  }, { onPageError: (p) => errors.push(p) });
  strictEqual(later.error, null);
  strictEqual(later.selection.selected.length, 3);
  deepStrictEqual(errors, [1]);
});

Deno.test('SEQ-187 (fin) : comptes exclus, filtre et règle côté code alignés, identifiants assainis', () => {
  const a = simRow('1', 'acc_A');
  const a2 = simRow('2', 'acc_A');
  const rot = simRow('3', 'acc_R', 'message', { assigned_sender_id: 'acc_X' });
  const rot2 = simRow('4', 'acc_R', 'message', { assigned_sender_id: 'acc_X' });
  const own = { ...simRow('5', 'acc_S'), step: { action_type: 'message', sender_id: 'acc_Z' } };
  const closed = simRow('6', 'acc_A', 'message', { status: 'replied' });
  const bad = simRow('7', 'acc),status.eq.(x');
  // Seules les exécutions écartées (non retenues) comptent ; closes et expéditeur propre jamais.
  deepStrictEqual(accountsAtCycleCap([a, a2, rot, rot2, own, closed, bad], [a, rot]), ['acc_A', 'acc_X']);
  deepStrictEqual(accountsAtCycleCap([a2, rot2], [], 1), ['acc_A'], 'borné');
  strictEqual(accountExclusionFilter([]), null);
  strictEqual(accountExclusionFilter(['acc_A', 'x),y']), 'status.neq.active,assigned_sender_id.not.is.null,account_id.is.null,account_id.not.in.(acc_A)');
  strictEqual(keptByAccountExclusion(a.enrollment, ['acc_A']), false);
  strictEqual(keptByAccountExclusion(closed.enrollment, ['acc_A']), true, 'inscription close : lue pour être annulée');
  strictEqual(keptByAccountExclusion(rot.enrollment, ['acc_R']), true, 'rotation : jamais exclue en base');
  strictEqual(keptByAccountExclusion(simRow('8', null).enrollment, ['acc_A']), true);
  strictEqual(keptByAccountExclusion(a.enrollment, []), true);
});
