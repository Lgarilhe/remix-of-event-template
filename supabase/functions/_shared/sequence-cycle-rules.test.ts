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
