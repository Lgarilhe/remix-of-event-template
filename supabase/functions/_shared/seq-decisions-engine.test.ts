// Décisions produit du lot moteur (docs/audit-2026-09-25-sequences.md,
// « Décisions produit en attente »), règles pures.
//
// Décision 22 : un seul envoi par personne et par cycle, toutes identités
// confondues (identifiant d'origine, identifiant résolu, identifiant du
// fournisseur, slug exact de l'adresse du profil).
// Décisions 1 et 2 : un envoi incertain ou une lecture de profil impossible
// n'est pas noté en échec ; l'auto-pause ne lit que les échecs notés.
// Décision 4 : report au lendemain dans le fuseau et à l'heure de début du
// titulaire (quotaBlockedRetryAt, fuseau et heure passés par le moteur).
// Décision 9 : la scrutation de secours ne passe « répondu » une inscription
// terminée que si elle reste la dernière prise de contact sur son compte.
//
//   deno test --no-check supabase/functions/_shared/seq-decisions-engine.test.ts

import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  candidateIdentityKeys, dedupeByProfile, quotaBlockedRetryAt, readCycleSelection, sequencesToAutoPause,
} from './sequence-cycle-rules.ts';
import { isLastContactOnAccount } from './sequence-engine-rules.ts';

type Row = { id: string; step?: { action_type: string } | null; enrollment?: Record<string, string | null> | null };

// ─── Décision 22 ────────────────────────────────────────────────────────────

Deno.test('décision 22 : identités d\'une inscription, slug de l\'adresse compris, en minuscules', () => {
  deepStrictEqual(candidateIdentityKeys({
    profile_id: 'AEMAAB12', resolved_profile_id: 'ACoAAX9', provider_id: 'ACoAAX9',
    profile_url: 'https://fr.linkedin.com/in/Camille-Martin/?utm_source=share',
  }), ['aemaab12', 'acoaax9', 'camille-martin']);
  deepStrictEqual(candidateIdentityKeys({ profile_id: 'p1', profile_url: 'https://www.linkedin.com/company/acme' }), ['p1']);
  deepStrictEqual(candidateIdentityKeys(null), []);
});

Deno.test('décision 22 : une exécution par personne et par cycle, toutes identités confondues', () => {
  const out = dedupeByProfile<Row>([
    // Même personne : identifiant Recruiter et identifiant classique résolu.
    { id: 'a1', enrollment: { profile_id: 'ACoAAP1' } },
    { id: 'a2', enrollment: { profile_id: 'AEMAAP1', resolved_profile_id: 'ACoAAP1' } },
    // Même personne : slug enregistré comme identifiant, et même slug dans l'adresse d'une autre inscription.
    { id: 'b1', enrollment: { profile_id: 'ACoAAQ2', profile_url: 'https://www.linkedin.com/in/lea-dupont/' } },
    { id: 'b2', enrollment: { profile_id: 'lea-dupont' } },
    // Même personne par l'identifiant du fournisseur.
    { id: 'c1', enrollment: { profile_id: 'AEMAAR3', provider_id: 'ACoAAR3' } },
    { id: 'c2', enrollment: { profile_id: 'ACoAAR3' } },
    // Personnes distinctes.
    { id: 'd1', enrollment: { profile_id: 'ACoAAS4', profile_url: 'https://www.linkedin.com/in/lea-dupont-77' } },
    { id: 'e1', enrollment: { profile_id: null, resolved_profile_id: 'ACoAAT5' } },
  ]);
  deepStrictEqual(out.map((e) => e.id), ['a1', 'b1', 'c1', 'd1'], 'la plus ancienne de chaque personne, jamais sans profile_id');
});

Deno.test('décision 22 : la sélection du cycle garde la plus ancienne exécution de la personne, la suivante attend', async () => {
  const rows: Row[] = [
    { id: 'x1', step: { action_type: 'message' }, enrollment: { profile_id: 'ACoAAZ', account_id: 'acc1', status: 'active' } },
    { id: 'x2', step: { action_type: 'message' }, enrollment: { profile_id: 'AEMAAZ', resolved_profile_id: 'ACoAAZ', account_id: 'acc2', status: 'active' } },
    { id: 'y1', step: { action_type: 'message' }, enrollment: { profile_id: 'ACoAAW', account_id: 'acc2', status: 'active' } },
  ];
  const { selection } = await readCycleSelection<Row>(async () => ({ rows, error: null }));
  deepStrictEqual(selection.selected.map((e) => e.id), ['x1', 'y1']);
});

// ─── Décisions 1 et 2 ───────────────────────────────────────────────────────

Deno.test('décisions 1 et 2 : cinq actions sans échec noté (envois incertains, lectures impossibles) ne désactivent pas la séquence', () => {
  deepStrictEqual(sequencesToAutoPause(new Map([['seq', { actioned: 5, failed: 0 }]])), []);
  deepStrictEqual(sequencesToAutoPause(new Map([['seq', { actioned: 5, failed: 2 }]])), ['seq'], 'témoin : deux échecs notés sur cinq');
});

// ─── Décision 4 ─────────────────────────────────────────────────────────────

Deno.test('décision 4 : plafond du jour, report au lendemain à l\'heure de début dans le fuseau passé', () => {
  // Lundi 28 septembre 2026, 22 h 30 à Paris = 16 h 30 à New York.
  const now = new Date('2026-09-28T20:30:00Z');
  const ny = quotaBlockedRetryAt('daily', now, 'America/New_York', 10);
  strictEqual(ny.toISOString(), '2026-09-29T14:00:00.000Z', 'mardi 10 h à New York');
  const paris = quotaBlockedRetryAt('daily', now, 'Europe/Paris', 8);
  strictEqual(paris.toISOString(), '2026-09-29T06:00:00.000Z', 'mardi 8 h à Paris');
});

// ─── Décision 9 ─────────────────────────────────────────────────────────────

Deno.test('décision 9 : inscription terminée, dernière prise de contact sur le compte seulement', () => {
  const e1 = { created_at: '2026-09-10T08:00:00Z', completed_at: '2026-09-20T08:00:00Z', replied_at: null };
  strictEqual(isLastContactOnAccount(e1, []), true, 'seule inscription du candidat sur le compte');
  strictEqual(isLastContactOnAccount(e1, [
    { status: 'stopped', created_at: '2026-09-01T08:00:00Z', completed_at: '2026-09-05T08:00:00Z' },
    { status: 'replied', created_at: '2026-08-01T08:00:00Z', completed_at: null, replied_at: '2026-08-10T08:00:00Z' },
  ]), true, 'contacts plus anciens, clos avant elle');
  for (const status of ['active', 'paused']) {
    strictEqual(isLastContactOnAccount(e1, [{ status, created_at: '2026-09-01T08:00:00Z' }]), false, `autre inscription ${status}`);
  }
  strictEqual(isLastContactOnAccount(e1, [
    { status: 'replied', created_at: '2026-09-22T08:00:00Z', replied_at: '2026-09-26T08:00:00Z' },
  ]), false, 'inscription créée après sa fin, déjà « répondu » par le webhook');
  strictEqual(isLastContactOnAccount(e1, [{ status: 'stopped', created_at: '2026-09-15T08:00:00Z', completed_at: null }]), false, 'créée après elle');
  strictEqual(isLastContactOnAccount(e1, [
    { status: 'replied', created_at: '2026-09-01T08:00:00Z', completed_at: null, replied_at: '2026-09-25T08:00:00Z' },
  ]), false, 'plus ancienne mais close (réponse) après sa fin');
  strictEqual(isLastContactOnAccount({ created_at: '2026-09-10T08:00:00Z', completed_at: null }, []), false, 'date de fin illisible : écartée');
});
