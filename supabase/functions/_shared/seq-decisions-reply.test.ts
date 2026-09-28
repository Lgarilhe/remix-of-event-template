// Décisions produit du lot « réponses » (docs/audit-2026-09-25-sequences.md,
// « Décisions produit en attente ») : règles pures de
// _shared/candidate-reply-closure.ts.
//
// - Décision 8 : un message reçu après la fin de la séquence est une réponse à
//   la dernière relance ; seule l'inscription close la plus récente de
//   l'organisation compte, jamais une clôture par rendez-vous ni un candidat
//   effacé. La date de fin gardée borne l'arrêt des autres inscriptions, aussi
//   au rejeu (contrat §8).
// - Décision 27 : l'annulation des InMails porte le motif de son appelant
//   (rendez-vous, partagé par calendly-webhook et l'arrêt du moteur).
//
//   deno test --no-check --import-map=e2e/local-stack/import_map.json supabase/functions/_shared/seq-decisions-reply.test.ts

import { deepStrictEqual as assertEquals, strictEqual } from 'node:assert';
import {
  MEETING_INMAIL_CANCEL_REASON,
  REPLY_INMAIL_CANCEL_REASON,
  cancelScheduledInMails,
  closedContactEnd,
  lateReplyEnrollments,
  replySiblingScope,
} from './candidate-reply-closure.ts';
import { isActionable, notificationKind } from '../../../src/lib/notificationKinds.ts';

type Row = Record<string, unknown>;

/** Faux client : eq, in, lt et update appliqués comme la base, sans réseau. */
function fakeClient(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    const run = () => {
      const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (patch) for (const r of rows) Object.assign(r, patch);
      return { data: rows.map((r) => ({ ...r })), error: null };
    };
    const builder = {
      select: () => builder,
      update: (values: Row) => { patch = values; return builder; },
      eq: (col: string, value: unknown) => { filters.push((r) => r[col] === value); return builder; },
      in: (col: string, values: unknown[]) => { filters.push((r) => values.includes(r[col])); return builder; },
      lt: (col: string, value: string) => { filters.push((r) => String(r[col]) < value); return builder; },
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve(run()),
    };
    return builder;
  };
  // deno-lint-ignore no-explicit-any
  return { from } as any;
}

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const D1 = '2026-06-01T10:00:00.000Z';
const D2 = '2026-09-20T10:00:00.000Z';
const D3 = '2026-09-27T10:00:00.000Z';

const closed = (id: string, o: Row = {}) => ({
  id, organization_id: ORG_A, status: 'completed', completed_at: D2, replied_at: null, tracking_data: null, ...o,
}) as { id: string; organization_id: string | null; status: string; completed_at: string | null; replied_at: string | null; tracking_data: unknown };

// ─── Décision 8 : fin du contact clos ────────────────────────────────────────

Deno.test('décision 8 : fin d’un contact clos = la plus ancienne des dates de fin et de réponse, null sans date lisible', () => {
  strictEqual(closedContactEnd({ completed_at: D2, replied_at: null }), D2);
  strictEqual(closedContactEnd({ completed_at: null, replied_at: D3 }), D3);
  // Terminée puis « A répondu » : la date de fin reste la borne.
  strictEqual(closedContactEnd({ completed_at: D2, replied_at: D3 }), D2);
  strictEqual(closedContactEnd({ completed_at: D3, replied_at: D2 }), D2);
  strictEqual(closedContactEnd({ completed_at: 'pas une date', replied_at: null }), null);
  strictEqual(closedContactEnd({}), null);
});

Deno.test('décision 8 : au rejeu, l’inscription terminée puis « A répondu » borne toujours l’arrêt à sa date de fin', () => {
  // Premier passage : inscription terminée le D2. Rejeu : la même, passée
  // « répondu » le D3 par le premier passage. La portée ne s'élargit pas.
  const firstPass = replySiblingScope([{ live: false, endedAt: closedContactEnd({ completed_at: D2, replied_at: null }) }]);
  const replay = replySiblingScope([{ live: false, endedAt: closedContactEnd({ completed_at: D2, replied_at: D3 }) }]);
  assertEquals(firstPass, { kind: 'created_before', before: D2 });
  assertEquals(replay, firstPass);
});

// ─── Décision 8 : inscription qui reçoit la réponse tardive ─────────────────

Deno.test('décision 8 : l’inscription terminée la plus récente de l’organisation passe « A répondu »', () => {
  const recent = closed('recent', { completed_at: D2 });
  const old = closed('old', { completed_at: D1 });
  assertEquals(lateReplyEnrollments([old, recent]).map((e) => e.id), ['recent']);
  assertEquals(lateReplyEnrollments([recent, old]).map((e) => e.id), ['recent']);
});

Deno.test('décision 8 : contact le plus récent déjà « répondu » → aucune inscription terminée plus ancienne ne change', () => {
  const oldCompleted = closed('old-completed', { completed_at: D1 });
  const recentReplied = closed('recent-replied', { status: 'replied', completed_at: null, replied_at: D3 });
  assertEquals(lateReplyEnrollments([oldCompleted, recentReplied]), []);
  // Réponse plus ancienne, fin plus récente : c'est l'inscription terminée qui compte.
  const oldReplied = closed('old-replied', { status: 'replied', completed_at: null, replied_at: D1 });
  assertEquals(lateReplyEnrollments([oldReplied, closed('recent-completed', { completed_at: D2 })]).map((e) => e.id), ['recent-completed']);
});

Deno.test('décision 8 : ni une clôture par rendez-vous (déjà comptée) ni un candidat effacé (D5)', () => {
  assertEquals(lateReplyEnrollments([closed('meeting', { tracking_data: { completion_reason: 'meeting_booked' } })]), []);
  assertEquals(lateReplyEnrollments([closed('erased', { tracking_data: { gdpr_erased_at: D3 } })]), []);
  // Le rendez-vous le plus récent masque une fin plus ancienne : rien ne change.
  assertEquals(lateReplyEnrollments([
    closed('old', { completed_at: D1 }),
    closed('meeting', { completed_at: D2, tracking_data: { completion_reason: 'meeting_booked' } }),
  ]), []);
  // Une autre raison de fin ne bloque pas.
  assertEquals(lateReplyEnrollments([closed('other', { tracking_data: { re_enrolled_at: D1 } })]).map((e) => e.id), ['other']);
});

Deno.test('décision 8 : une inscription par organisation, chacune dans la sienne (compte relié à deux organisations)', () => {
  const a = closed('a', { organization_id: ORG_A, completed_at: D1 });
  const b = closed('b', { organization_id: ORG_B, completed_at: D2 });
  const bOld = closed('b-old', { organization_id: ORG_B, completed_at: D1 });
  assertEquals(lateReplyEnrollments([a, bOld, b]).map((e) => e.id).sort(), ['a', 'b']);
  assertEquals(lateReplyEnrollments([]), []);
});

// ─── Décision 10 : alerte au recruteur ──────────────────────────────────────

Deno.test('décision 10 : l’alerte écrite par unipile-webhook est classée « action » (Pour vous, chiffre d’À traiter)', () => {
  // Valeurs réellement écrites par alertSiblingStopFailure (unipile-webhook).
  const alert = {
    type: 'action', link: '/missions/p1?tab=outreach',
    metadata: { source: 'reply_sibling_stop_failed', event_key: 'unipile:message_received:m1', enrollment_ids: ['e1'], sequence_id: 's1', project_id: 'p1' },
  };
  strictEqual(notificationKind(alert), 'action');
  strictEqual(isActionable(alert), true);
  strictEqual(notificationKind({ ...alert, link: '/missions' }), 'action');
});

// ─── Décision 27 : motif des InMails annulés ────────────────────────────────

Deno.test('décision 27 : cancelScheduledInMails écrit le motif demandé, la réponse reste le motif par défaut', async () => {
  const inmail = (id: string, o: Row = {}) => ({
    id, organization_id: ORG_A, account_id: 'acc', recipient_profile_id: 'ACoCAND', status: 'scheduled',
    created_at: D2, error_message: null, ...o,
  });
  const tables = {
    inmail_queue: [
      inmail('scheduled'), inmail('pending', { status: 'pending' }), inmail('sending', { status: 'sending' }),
      inmail('sent', { status: 'sent' }), inmail('other-org', { organization_id: ORG_B }),
    ],
  };
  strictEqual(MEETING_INMAIL_CANCEL_REASON, 'Rendez-vous pris avec le candidat');
  strictEqual(await cancelScheduledInMails(fakeClient(tables), { organizationId: ORG_A }, ['ACoCAND'], { kind: 'all' }, MEETING_INMAIL_CANCEL_REASON), 2);
  assertEquals(Object.fromEntries(tables.inmail_queue.map((r) => [r.id, [r.status, r.error_message]])), {
    scheduled: ['cancelled', 'Rendez-vous pris avec le candidat'], pending: ['cancelled', 'Rendez-vous pris avec le candidat'],
    sending: ['sending', null], sent: ['sent', null], 'other-org': ['scheduled', null],
  });
  const replyTables = { inmail_queue: [inmail('x')] };
  strictEqual(await cancelScheduledInMails(fakeClient(replyTables), { organizationId: ORG_A }, ['ACoCAND']), 1);
  strictEqual(replyTables.inmail_queue[0].error_message, REPLY_INMAIL_CANCEL_REASON);
});
