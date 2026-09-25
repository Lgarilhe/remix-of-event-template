// Reprise d'une inscription (audit 2026-09-25, SEQ-004).
//
//   deno test --no-check supabase/functions/_shared/sequence-resume.test.ts

import { deepStrictEqual, strictEqual } from 'node:assert';
import { ACCOUNT_DISCONNECTED_SKIP_REASON } from './linkedin-quotas.ts';
import { countOutcomes, planResume, resumeDate, type ResumeExecutionRow } from './sequence-resume.ts';

const NOW = Date.parse('2026-09-25T10:00:00Z');
const inMinutes = (m: number) => new Date(NOW + m * 60_000).toISOString();
const row = (over: Partial<ResumeExecutionRow> & { id: string; status: string }): ResumeExecutionRow => ({
  step_id: `step-${over.id}`, step_order: 0, skip_reason: null, error_message: null,
  scheduled_at: inMinutes(-60), created_at: inMinutes(-120), ...over,
});

Deno.test('reprise : exécution en attente gardée, avec sa date future', () => {
  const plan = planResume('resume', 'paused', 2, [
    row({ id: 'a', status: 'sent', step_order: 0 }),
    row({ id: 'b', status: 'scheduled', step_order: 1, scheduled_at: '2026-09-28T08:00:00.000Z' }),
  ], NOW);
  deepStrictEqual(plan, { kind: 'keep_pending', executionId: 'b', newScheduledAt: null });
});

Deno.test('reprise : exécution échue repoussée à maintenant + 1 min, jamais avant', () => {
  const plan = planResume('resume', 'paused', 1, [row({ id: 'b', status: 'quota_blocked', scheduled_at: inMinutes(-600) })], NOW);
  deepStrictEqual(plan, { kind: 'keep_pending', executionId: 'b', newScheduledAt: inMinutes(1) });
  strictEqual(resumeDate(inMinutes(90), NOW), inMinutes(90));
});

Deno.test('reprise : une attente reste une attente', () => {
  const plan = planResume('resume', 'paused', 1, [row({ id: 'w', status: 'waiting_event' })], NOW);
  deepStrictEqual(plan, { kind: 'keep_pending', executionId: 'w', newScheduledAt: null });
});

Deno.test('reprise : réarme la plus récente annulée par une pause, pas une plus ancienne', () => {
  const plan = planResume('resume', 'paused', 2, [
    row({ id: 'old', status: 'cancelled', step_order: 1, skip_reason: 'Arrêt manuel', created_at: inMinutes(-5000) }),
    row({ id: 'sent1', status: 'sent', step_order: 1, step_id: 'step-old', created_at: inMinutes(-4000) }),
    row({ id: 'new', status: 'cancelled', step_order: 2, skip_reason: ACCOUNT_DISCONNECTED_SKIP_REASON, created_at: inMinutes(-100), scheduled_at: inMinutes(3000) }),
  ], NOW);
  deepStrictEqual(plan, { kind: 'rearm', executionId: 'new', fromStatus: 'cancelled', scheduledAt: inMinutes(3000) });
});

Deno.test('reprise : jamais une étape déjà partie (message livré marqué annulé, ou renvoyé depuis)', () => {
  // L'étape 1 annulée « Arrêt manuel » a été re-planifiée et envoyée depuis : on ne la réarme pas.
  const plan = planResume('resume', 'paused', 2, [
    row({ id: 'c1', status: 'cancelled', step_order: 1, step_id: 's1', skip_reason: 'Arrêt manuel', created_at: inMinutes(-5000) }),
    row({ id: 'x1', status: 'sent', step_order: 1, step_id: 's1', created_at: inMinutes(-4000) }),
  ], NOW);
  deepStrictEqual(plan, { kind: 'schedule_next', fromStepOrder: 1, fromStepId: 's1' });
  // BUG-095 : annulée « pendant l'envoi » = livrée, jamais réarmée, et la suite part après elle.
  const plan2 = planResume('resume', 'paused', 1, [
    row({ id: 'd', status: 'cancelled', step_order: 1, step_id: 's1', skip_reason: 'Enrollment became paused during execution' }),
  ], NOW);
  deepStrictEqual(plan2, { kind: 'schedule_next', fromStepOrder: 1, fromStepId: 's1' });
});

Deno.test('reprise : une annulation qui n\'est pas une pause n\'est pas réarmée', () => {
  const plan = planResume('resume', 'paused', 1, [
    row({ id: 's0', status: 'sent', step_order: 0, step_id: 's0' }),
    row({ id: 'j', status: 'cancelled', step_order: 1, step_id: 's1', skip_reason: 'Annulé manuellement', created_at: inMinutes(-10) }),
  ], NOW);
  deepStrictEqual(plan, { kind: 'schedule_next', fromStepOrder: 0, fromStepId: 's0' });
});

Deno.test('reprise après échec : un envoi incertain n\'est jamais rejoué', () => {
  const plan = planResume('resume', 'paused', 1, [
    row({ id: 's0', status: 'sent', step_order: 0, step_id: 's0' }),
    row({ id: 'f1', status: 'failed', step_order: 1, step_id: 's1', error_message: "Interrompu pendant l'envoi (inmail) — relance auto désactivée" }),
  ], NOW);
  deepStrictEqual(plan, { kind: 'schedule_next', fromStepOrder: 1, fromStepId: 's1' });
  // Échec ordinaire : l'étape échouée est retentée (suite de la dernière terminée).
  const plan2 = planResume('resume', 'paused', 1, [
    row({ id: 's0', status: 'sent', step_order: 0, step_id: 's0' }),
    row({ id: 'f1', status: 'failed', step_order: 1, step_id: 's1', error_message: 'Profil introuvable' }),
  ], NOW);
  deepStrictEqual(plan2, { kind: 'schedule_next', fromStepOrder: 0, fromStepId: 's0' });
});

Deno.test('reprise : étape échue pendant une pause (ancien moteur) réarmée', () => {
  const plan = planResume('resume', 'paused', 1, [
    row({ id: 's0', status: 'sent', step_order: 0, step_id: 's0', created_at: inMinutes(-9000) }),
    row({ id: 'i1', status: 'skipped', step_order: 1, step_id: 's1', skip_reason: 'Enrollment inactive', created_at: inMinutes(-100), scheduled_at: inMinutes(-50) }),
  ], NOW);
  deepStrictEqual(plan, { kind: 'rearm', executionId: 'i1', fromStatus: 'skipped', scheduledAt: inMinutes(1) });
});

Deno.test('éligibilité : reprise seulement en pause, relance seulement après une fin', () => {
  strictEqual(planResume('resume', 'active', 0, [], NOW).kind, 'not_eligible');
  const reEnrollPaused = planResume('re_enroll', 'paused', 0, [], NOW);
  strictEqual(reEnrollPaused.kind === 'not_eligible' && reEnrollPaused.outcome, 'error');
  deepStrictEqual(planResume('re_enroll', 'replied', 3, [], NOW), { kind: 'schedule_next', fromStepOrder: 2, fromStepId: null });
});

Deno.test('compteurs : toutes les clés présentes', () => {
  deepStrictEqual(countOutcomes([{ outcome: 'resumed' }, { outcome: 'resumed' }, { outcome: 'account_unlinked' }]), {
    resumed: 2, nothing_to_resume: 0, account_unlinked: 1, not_paused: 0, error: 0,
  });
});
