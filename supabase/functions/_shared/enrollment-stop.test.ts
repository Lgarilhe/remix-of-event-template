// Arrêt manuel et annulation (refonte mission, lot 5b, décision 3).
//
//   deno test --no-check supabase/functions/_shared/enrollment-stop.test.ts

import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  MANUAL_STOP_SKIP_REASON, MANUAL_STOP_COMPLETION_REASON, STOP_UNDO_WINDOW_MS, STOP_BATCH_MAX, STOPPABLE_STATUSES,
  stopTracking, readManualStop, isManualStop, undoExpiresAt, isUndoWindowOpen, pauseReasonAfterUndo,
  undoTracking, withoutManualStop, decideStop, decideUndo, replyAfterStop, countStopOutcomes, countUndoOutcomes,
  undoResumeRefusedMessage, STOP_MESSAGES, UNDO_MESSAGES, EVENT_LIFTED_PAUSE_REASONS, pauseCauseHolds, type ManualStop,
} from './enrollment-stop.ts';
import { RESUMABLE_SKIP_REASONS } from './sequence-resume.ts';

const NOW = Date.parse('2026-10-05T10:00:00Z');
const at = (seconds: number) => new Date(NOW + seconds * 1000).toISOString();
const TOKEN = '6f1c2a0e-5b7d-4c11-9a3e-0d2b8e4f7a10';
const USER = 'user-guillaume';

const stop = (over: Partial<ManualStop> = {}): ManualStop => ({
  token: TOKEN, by: USER, at: at(-30), previous_status: 'active', previous_pause_reason: null, ...over,
});
const stoppedTracking = (over: Partial<ManualStop> = {}, extra: Record<string, unknown> = {}) =>
  stopTracking({ re_enrolled_at: at(-3600), ...extra }, stop(over));
const undoInput = (over: Partial<Parameters<typeof decideUndo>[0]> = {}) => ({
  status: 'completed', trackingData: stoppedTracking(), token: TOKEN, callerUserId: USER,
  nowMs: NOW, gdprErased: false, canAct: true, ...over,
});

Deno.test('constantes : motif « Arrêt manuel » réarmable, 2 minutes, 200 au plus, actif ou en pause', () => {
  strictEqual(MANUAL_STOP_SKIP_REASON, 'Arrêt manuel');
  strictEqual(RESUMABLE_SKIP_REASONS.includes(MANUAL_STOP_SKIP_REASON), true);
  strictEqual(MANUAL_STOP_COMPLETION_REASON, 'manual_stop');
  strictEqual(STOP_UNDO_WINDOW_MS, 120_000);
  strictEqual(STOP_BATCH_MAX, 200);
  deepStrictEqual([...STOPPABLE_STATUSES], ['active', 'paused']);
});

Deno.test('stopTracking : garde les clés relues, ajoute la raison de fin et la trace complète', () => {
  const tracking = stopTracking({ re_enrolled_at: 'x', message_overrides: { s1: 'Bonjour' } }, stop({ previous_status: 'paused', previous_pause_reason: 'quota_reached' }));
  deepStrictEqual(tracking, {
    re_enrolled_at: 'x',
    message_overrides: { s1: 'Bonjour' },
    completion_reason: 'manual_stop',
    manual_stop: { token: TOKEN, by: USER, at: at(-30), previous_status: 'paused', previous_pause_reason: 'quota_reached' },
  });
  // tracking_data absent ou illisible : objet neuf.
  deepStrictEqual(Object.keys(stopTracking(null, stop())), ['completion_reason', 'manual_stop']);
  deepStrictEqual(Object.keys(stopTracking(['x'], stop())), ['completion_reason', 'manual_stop']);
});

Deno.test('readManualStop : relit la trace, refuse une trace incomplète', () => {
  deepStrictEqual(readManualStop(stoppedTracking()), stop());
  strictEqual(readManualStop(null), null);
  strictEqual(readManualStop({}), null);
  strictEqual(readManualStop({ manual_stop: { ...stop(), token: '' } }), null);
  strictEqual(readManualStop({ manual_stop: { ...stop(), at: 'pas une date' } }), null);
  strictEqual(readManualStop({ manual_stop: { ...stop(), previous_status: 'completed' } }), null);
  // Auteur absent (appel en clé de service) : null.
  deepStrictEqual(readManualStop({ manual_stop: { ...stop(), by: undefined } })?.by, null);
});

Deno.test('isManualStop : terminée ET raison manual_stop', () => {
  strictEqual(isManualStop('completed', stoppedTracking()), true);
  strictEqual(isManualStop('replied', stoppedTracking()), false);
  strictEqual(isManualStop('completed', { completion_reason: 'meeting_booked' }), false);
  strictEqual(isManualStop('completed', null), false);
});

Deno.test('jeton : valable 2 minutes, pas au-delà ; date illisible ou trop future refusée', () => {
  strictEqual(isUndoWindowOpen(at(0), NOW), true);
  strictEqual(isUndoWindowOpen(at(-119), NOW), true);
  strictEqual(isUndoWindowOpen(at(-120), NOW), true);
  strictEqual(isUndoWindowOpen(at(-121), NOW), false);
  strictEqual(isUndoWindowOpen(at(30), NOW), true);
  strictEqual(isUndoWindowOpen(at(120), NOW), false);
  strictEqual(isUndoWindowOpen('pas une date', NOW), false);
  strictEqual(undoExpiresAt(at(0)), at(120));
});

Deno.test('pauseReasonAfterUndo : la raison d’avant, sinon manual', () => {
  strictEqual(pauseReasonAfterUndo({ previous_status: 'paused', previous_pause_reason: 'quota_reached' }), 'quota_reached');
  strictEqual(pauseReasonAfterUndo({ previous_status: 'paused', previous_pause_reason: 'sequence_inactive' }), 'sequence_inactive');
  strictEqual(pauseReasonAfterUndo({ previous_status: 'paused', previous_pause_reason: null }), 'manual');
  strictEqual(pauseReasonAfterUndo({ previous_status: 'paused', previous_pause_reason: 'inconnue' }), 'manual');
  // Active avant l'arrêt : pause manuelle (si la reprise refuse, elle y reste).
  strictEqual(pauseReasonAfterUndo({ previous_status: 'active', previous_pause_reason: 'quota_reached' }), 'manual');
});

Deno.test('pauseCauseHolds : une raison levée par un événement passé pendant l’arrêt n’est pas remise', () => {
  deepStrictEqual([...EVENT_LIFTED_PAUSE_REASONS].sort(), ['account_disconnected', 'auto_paused', 'sequence_inactive', 'subscription_required']);
  const known = { sequenceActive: true, accountOk: true, canSendSequences: true };
  for (const reason of EVENT_LIFTED_PAUSE_REASONS) strictEqual(pauseCauseHolds(reason, known), false, `${reason} levée`);
  strictEqual(pauseCauseHolds('sequence_inactive', { ...known, sequenceActive: false }), true);
  strictEqual(pauseCauseHolds('auto_paused', { ...known, sequenceActive: false }), true);
  strictEqual(pauseCauseHolds('account_disconnected', { ...known, accountOk: false }), true);
  strictEqual(pauseCauseHolds('subscription_required', { ...known, canSendSequences: false }), true);
  // Lecture impossible : la raison d'avant est remise.
  const unknown = { sequenceActive: null, accountOk: null, canSendSequences: null };
  for (const reason of EVENT_LIFTED_PAUSE_REASONS) strictEqual(pauseCauseHolds(reason, unknown), true, `${reason} inconnue`);
  // Raisons levées par une personne : toujours remises.
  for (const reason of ['manual', 'quota_reached', 'send_failed', 'blocked_by_candidate']) strictEqual(pauseCauseHolds(reason, known), true, reason);
});

Deno.test('undoTracking : raison de fin et trace retirées, date d’annulation gardée, autres clés intactes', () => {
  deepStrictEqual(undoTracking(stoppedTracking(), at(10)), { re_enrolled_at: at(-3600), manual_stop_undone_at: at(10) });
  // Une autre raison de fin n'est jamais effacée.
  deepStrictEqual(undoTracking({ completion_reason: 'meeting_booked', manual_stop: stop() }, at(10)), {
    completion_reason: 'meeting_booked', manual_stop_undone_at: at(10),
  });
  deepStrictEqual(undoTracking(null, at(10)), { manual_stop_undone_at: at(10) });
});

Deno.test('withoutManualStop (relance) : raison de fin et trace retirées, le reste gardé', () => {
  deepStrictEqual(withoutManualStop({ ...stoppedTracking(), re_enrolled_at: at(5) }), { re_enrolled_at: at(5) });
  deepStrictEqual(withoutManualStop({ completion_reason: 'meeting_booked', x: 1 }), { completion_reason: 'meeting_booked', x: 1 });
});

Deno.test('decideStop : collaborateur, effacement, statut, puis arrêt avec l’état d’avant', () => {
  const base = { status: 'active', pauseReason: null, gdprErased: false, canAct: true };
  deepStrictEqual(decideStop(base), { kind: 'stop', previousStatus: 'active', previousPauseReason: null });
  deepStrictEqual(decideStop({ ...base, status: 'paused', pauseReason: 'auto_paused' }), {
    kind: 'stop', previousStatus: 'paused', previousPauseReason: 'auto_paused',
  });
  // Une raison de pause traînante sur une inscription active n'est pas gardée.
  deepStrictEqual(decideStop({ ...base, pauseReason: 'manual' }), { kind: 'stop', previousStatus: 'active', previousPauseReason: null });
  deepStrictEqual(decideStop({ ...base, canAct: false, gdprErased: true }), { kind: 'refuse', outcome: 'forbidden' });
  deepStrictEqual(decideStop({ ...base, gdprErased: true }), { kind: 'refuse', outcome: 'gdpr_erased' });
  for (const status of ['completed', 'replied', 'stopped', 'cancelled', 'unsubscribed']) {
    deepStrictEqual(decideStop({ ...base, status }), { kind: 'refuse', outcome: 'not_eligible' });
  }
});

Deno.test('decideUndo : annulation permise à l’auteur dans les 2 minutes', () => {
  deepStrictEqual(decideUndo(undoInput()), { kind: 'undo', previousStatus: 'active', pauseReason: 'manual', stopAt: at(-30) });
  deepStrictEqual(
    decideUndo(undoInput({ trackingData: stoppedTracking({ previous_status: 'paused', previous_pause_reason: 'sequence_inactive' }) })),
    { kind: 'undo', previousStatus: 'paused', pauseReason: 'sequence_inactive', stopAt: at(-30) },
  );
  // Arrêt posé en clé de service : annulable par la clé de service seulement.
  deepStrictEqual(decideUndo(undoInput({ trackingData: stoppedTracking({ by: null }), callerUserId: null })).kind, 'undo');
});

Deno.test('decideUndo : lecture des refus, dans l’ordre', () => {
  const refusal = (over: Partial<Parameters<typeof decideUndo>[0]>) => {
    const d = decideUndo(undoInput(over));
    return d.kind === 'refuse' ? d.outcome : d.kind;
  };
  strictEqual(refusal({ canAct: false, status: 'replied' }), 'forbidden');
  // Réponse arrivée après l'arrêt (statut passé à « répondu », trace gardée).
  strictEqual(refusal({ status: 'replied' }), 'replied');
  // Statut « répondu » sans ce jeton : la séquence a changé.
  strictEqual(refusal({ status: 'replied', token: 'autre' }), 'moved_since');
  strictEqual(refusal({ token: 'jeton-faux' }), 'moved_since');
  strictEqual(refusal({ token: '' }), 'moved_since');
  strictEqual(refusal({ status: 'active' }), 'moved_since');
  strictEqual(refusal({ status: 'paused' }), 'moved_since');
  strictEqual(refusal({ trackingData: { completion_reason: 'manual_stop' } }), 'moved_since');
  strictEqual(refusal({ trackingData: { ...stoppedTracking(), completion_reason: 'meeting_booked' } }), 'moved_since');
  strictEqual(refusal({ callerUserId: 'un-collegue' }), 'not_author');
  strictEqual(refusal({ callerUserId: null }), 'not_author');
  strictEqual(refusal({ trackingData: stoppedTracking({ at: at(-121) }) }), 'expired');
  strictEqual(refusal({ gdprErased: true }), 'gdpr_erased');
  // Délai passé et effacement : le délai d'abord.
  strictEqual(refusal({ trackingData: stoppedTracking({ at: at(-600) }), gdprErased: true }), 'expired');
});

Deno.test('replyAfterStop : une date postérieure à l’arrêt suffit', () => {
  strictEqual(replyAfterStop(at(-30), [null, undefined, at(-60)]), false);
  strictEqual(replyAfterStop(at(-30), [at(-30)]), false);
  strictEqual(replyAfterStop(at(-30), [at(-60), at(-29)]), true);
  strictEqual(replyAfterStop('pas une date', [at(0)]), false);
  strictEqual(replyAfterStop(at(-30), []), false);
});

Deno.test('compteurs : tous présents, même à zéro', () => {
  deepStrictEqual(countStopOutcomes([{ outcome: 'stopped' }, { outcome: 'stopped' }, { outcome: 'forbidden' }]), {
    stopped: 2, not_eligible: 0, gdpr_erased: 0, forbidden: 1, changed: 0, not_found: 0, error: 0,
  });
  deepStrictEqual(countUndoOutcomes([{ outcome: 'resume_refused' }, { outcome: 'expired' }]), {
    resumed: 0, paused: 0, resume_refused: 1, finished: 0, expired: 1, not_author: 0,
    moved_since: 0, gdpr_erased: 0, replied: 0, forbidden: 0, not_found: 0, error: 0,
  });
});

Deno.test('messages : français, sans tiret long, ceux du plan', () => {
  strictEqual(STOP_MESSAGES.changed, "Arrêt impossible pour l'instant : rien n'a changé.");
  strictEqual(UNDO_MESSAGES.expired, 'Annulation impossible : le délai est passé.');
  strictEqual(UNDO_MESSAGES.replied, 'Annulation impossible : le candidat a répondu entre-temps.');
  strictEqual(UNDO_MESSAGES.moved_since, 'Annulation impossible : la séquence du candidat a changé entre-temps.');
  strictEqual(undoResumeRefusedMessage('account_unlinked'), 'Arrêt annulé : le candidat reste en pause (compte LinkedIn non relié).');
  strictEqual(undoResumeRefusedMessage('sequence_inactive'), 'Arrêt annulé : le candidat reste en pause (séquence en pause).');
  const all = [...Object.values(STOP_MESSAGES), ...Object.values(UNDO_MESSAGES),
    ...(['account_unlinked', 'sequence_inactive', 'gdpr_registry_unavailable', 'gdpr_erased', 'other'] as const).map(undoResumeRefusedMessage)];
  for (const m of all) {
    strictEqual(m.includes('—'), false, m);
    strictEqual(/définitif/i.test(m), false, m);
  }
});
