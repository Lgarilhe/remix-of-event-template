// Conservation des rappels et tâches : 24 mois après la dernière activité
// (décision du propriétaire du 12/10/2026, rgpd-purge étape 9).
//
//   deno test --no-check supabase/functions/_shared/reminder-retention.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import {
  REMINDER_ACTIVITY_COLUMNS, REMINDER_RETENTION_MONTHS, isReminderExpired, reminderAgeFilters,
  reminderLastActivity, reminderRetentionCutoff,
} from './reminder-retention.ts';

const NOW = new Date('2026-10-12T12:00:00Z');
const CUTOFF = reminderRetentionCutoff(NOW);
const OLD = '2023-01-15T09:00:00.000Z';
const before = (ms: number) => new Date(CUTOFF.getTime() - ms).toISOString();
const after = (ms: number) => new Date(CUTOFF.getTime() + ms).toISOString();

Deno.test('durée : 24 mois, borne un jour avant les 24 mois, jamais en deçà', () => {
  strictEqual(REMINDER_RETENTION_MONTHS, 24);
  strictEqual(CUTOFF.toISOString(), '2024-10-11T12:00:00.000Z');
  // 29 février : la borne ne se rapproche pas de la dernière activité.
  strictEqual(reminderRetentionCutoff(new Date('2028-02-29T08:00:00Z')).toISOString(), '2026-02-27T08:00:00.000Z');
  for (const now of [NOW, new Date('2028-02-29T08:00:00Z'), new Date('2027-03-31T23:59:59Z')]) {
    const floor = new Date(now);
    floor.setUTCMonth(floor.getUTCMonth() - 24);
    ok(reminderRetentionCutoff(now).getTime() < floor.getTime(), now.toISOString());
  }
});

Deno.test('dernière activité : la plus tardive des quatre dates', () => {
  deepStrictEqual([...REMINDER_ACTIVITY_COLUMNS], ['created_at', 'updated_at', 'due_at', 'completed_at']);
  const base = { created_at: OLD, updated_at: OLD, due_at: OLD, completed_at: OLD };
  strictEqual(reminderLastActivity(base)?.toISOString(), OLD);
  for (const column of REMINDER_ACTIVITY_COLUMNS) {
    const recent = '2026-06-01T10:00:00.000Z';
    strictEqual(reminderLastActivity({ ...base, [column]: recent })?.toISOString(), recent, column);
  }
  // Décalage horaire lu comme un instant, pas comme un texte.
  strictEqual(
    reminderLastActivity({ created_at: '2026-01-01T23:30:00-02:00', updated_at: '2026-01-02T00:30:00Z' })?.toISOString(),
    '2026-01-02T01:30:00.000Z',
  );
});

Deno.test('champs nuls ou illisibles : ignorés ; aucune date lisible : jamais purgé', () => {
  strictEqual(reminderLastActivity({ created_at: OLD, updated_at: OLD, due_at: OLD, completed_at: null })?.toISOString(), OLD);
  strictEqual(reminderLastActivity({ created_at: OLD })?.toISOString(), OLD);
  strictEqual(reminderLastActivity({ created_at: OLD, due_at: '', completed_at: 'pas une date' })?.toISOString(), OLD);
  strictEqual(reminderLastActivity({}), null);
  strictEqual(reminderLastActivity({ created_at: null, updated_at: null, due_at: null, completed_at: null }), null);
  strictEqual(reminderLastActivity({ created_at: 'illisible', due_at: '' }), null);
  strictEqual(isReminderExpired({}, CUTOFF), false);
  strictEqual(isReminderExpired({ created_at: null, updated_at: null, due_at: null, completed_at: null }, CUTOFF), false);
  strictEqual(isReminderExpired({ created_at: 'illisible' }, CUTOFF), false);
  strictEqual(isReminderExpired({ created_at: OLD, updated_at: OLD, due_at: OLD, completed_at: null }, CUTOFF), true);
});

Deno.test('bornes : strictement avant la borne, purgé ; à la borne ou après, gardé', () => {
  const at = (iso: string) => ({ created_at: OLD, updated_at: OLD, due_at: iso, completed_at: null });
  strictEqual(isReminderExpired(at(before(1)), CUTOFF), true);
  strictEqual(isReminderExpired(at(CUTOFF.toISOString()), CUTOFF), false);
  strictEqual(isReminderExpired(at(after(1)), CUTOFF), false);
});

Deno.test('une seule date récente garde le rappel, quelle qu\'elle soit', () => {
  const old = { created_at: OLD, updated_at: OLD, due_at: OLD, completed_at: OLD };
  strictEqual(isReminderExpired(old, CUTOFF), true);
  // Échéance encore à venir, rappel modifié, ou réalisé récemment.
  strictEqual(isReminderExpired({ ...old, due_at: '2027-01-01T09:00:00.000Z' }, CUTOFF), false);
  strictEqual(isReminderExpired({ ...old, updated_at: after(60_000) }, CUTOFF), false);
  strictEqual(isReminderExpired({ ...old, completed_at: after(60_000) }, CUTOFF), false);
  strictEqual(isReminderExpired({ ...old, created_at: after(60_000) }, CUTOFF), false);
});

Deno.test('filtres PostgREST : chaque date absente ou antérieure à la borne, une par colonne', () => {
  const iso = CUTOFF.toISOString();
  deepStrictEqual(reminderAgeFilters(iso), [
    `created_at.is.null,created_at.lt."${iso}"`,
    `updated_at.is.null,updated_at.lt."${iso}"`,
    `due_at.is.null,due_at.lt."${iso}"`,
    `completed_at.is.null,completed_at.lt."${iso}"`,
  ]);
});
