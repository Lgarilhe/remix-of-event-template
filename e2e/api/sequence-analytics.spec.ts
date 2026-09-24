/**
 * H5 — Compteurs analytics atomiques (increment_sequence_analytics).
 *
 * Correctif couvert : l'ancien code faisait un `upsert` qui ÉCRASAIT le compteur
 * à 1 à chaque événement (perte de comptage). La RPC SECURITY DEFINER
 * public.increment_sequence_analytics doit désormais INCRÉMENTER de façon
 * atomique via INSERT ... ON CONFLICT (sequence_id, date) DO UPDATE
 * SET <field> = <field> + GREATEST(p_increment, 0), et la contrainte
 * UNIQUE(sequence_id, date) doit garantir l'unicité de la ligne journalière.
 *
 * On appelle la RPC en service-role (admin()) car EXECUTE est révoqué pour
 * anon/authenticated, puis on relit sequence_analytics pour prouver que le
 * compteur cumule bien au lieu d'être remis à 1.
 *
 * @critical
 */
import { test, expect } from '@playwright/test';
import { admin, createOrg, deleteOrg, type TestOrg } from '../helpers/supabase-admin';

type AnalyticsField =
  | 'invites_sent'
  | 'invites_accepted'
  | 'messages_sent'
  | 'replies_received'
  | 'profile_visits';

interface AnalyticsRow {
  sequence_id: string;
  date: string;
  invites_sent: number | null;
  invites_accepted: number | null;
  messages_sent: number | null;
  replies_received: number | null;
  profile_visits: number | null;
}

let org: TestOrg;
let sequenceId: string;

/** Crée une séquence minimale (name NOT NULL + scoping org/created_by). */
async function seedSequence(o: TestOrg): Promise<string> {
  const { data, error } = await admin()
    .from('outreach_sequences')
    .insert({
      name: `Seq analytics e2e ${Date.now()}`,
      organization_id: o.orgId,
      created_by: o.owner.userId,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`seedSequence: ${error?.message}`);
  return data.id as string;
}

/** Incrémente un champ via la RPC service-role. Renvoie l'erreur éventuelle (null si OK). */
async function increment(
  field: string,
  pIncrement?: number,
): Promise<{ message: string } | null> {
  const params: Record<string, unknown> = { p_sequence_id: sequenceId, p_field: field };
  if (pIncrement !== undefined) params.p_increment = pIncrement;
  const { error } = await admin().rpc('increment_sequence_analytics', params);
  return error ? { message: error.message } : null;
}

/**
 * Relit la ligne analytics de la séquence. La séquence est fraîchement seedée à
 * chaque test → une seule ligne journalière (date = aujourd'hui côté DB), donc
 * lire par sequence_id est robuste aux frontières de fuseau.
 */
async function readAnalytics(): Promise<AnalyticsRow | null> {
  const { data, error } = await admin()
    .from('sequence_analytics')
    .select('sequence_id, date, invites_sent, invites_accepted, messages_sent, replies_received, profile_visits')
    .eq('sequence_id', sequenceId);
  if (error) throw new Error(`readAnalytics: ${error.message}`);
  if (!data || data.length === 0) return null;
  expect(data.length, 'une seule ligne journalière par séquence (UNIQUE sequence_id,date)').toBe(1);
  return data[0] as AnalyticsRow;
}

const val = (row: AnalyticsRow | null, f: AnalyticsField): number => row?.[f] ?? 0;

test.beforeEach(async () => {
  org = await createOrg('agency', 'E2E SeqAnalytics');
  sequenceId = await seedSequence(org);
});

test.afterEach(async () => {
  // sequence_analytics + outreach_sequences ne sont pas couverts par deleteOrg → ménage explicite.
  await admin().from('sequence_analytics').delete().eq('sequence_id', sequenceId);
  await admin().from('outreach_sequences').delete().eq('id', sequenceId);
  await deleteOrg(org);
});

test.describe('@critical Compteurs analytics atomiques (increment_sequence_analytics)', () => {
  test('deux incréments donnent 2, pas 1 (régression upsert H5)', async () => {
    expect(await increment('replies_received'), '1er incrément sans erreur').toBeNull();
    expect(await increment('replies_received'), '2e incrément sans erreur').toBeNull();

    const row = await readAnalytics();
    expect(row, 'ligne analytics créée par le 1er incrément').not.toBeNull();
    // Le cœur du correctif : cumul (2) et non écrasement à 1.
    expect(
      val(row, 'replies_received'),
      'replies_received doit cumuler à 2 (ancien bug: écrasé à 1)',
    ).toBe(2);
  });

  test("champs distincts s'incrémentent indépendamment", async () => {
    expect(await increment('invites_accepted'), 'invites_accepted #1').toBeNull();
    expect(await increment('invites_accepted'), 'invites_accepted #2').toBeNull();
    expect(await increment('invites_accepted'), 'invites_accepted #3').toBeNull();
    expect(await increment('messages_sent'), 'messages_sent #1').toBeNull();

    const row = await readAnalytics();
    expect(row, 'ligne analytics présente').not.toBeNull();
    expect(val(row, 'invites_accepted'), 'invites_accepted cumulé à 3').toBe(3);
    expect(val(row, 'messages_sent'), 'messages_sent cumulé à 1').toBe(1);
    // Un champ jamais touché ne doit pas avoir été impacté par les autres incréments.
    expect(val(row, 'replies_received'), 'replies_received non touché reste 0/null').toBe(0);
  });

  test('un champ inconnu est rejeté', async () => {
    const err = await increment('not_a_column');
    expect(err, 'p_field hors liste blanche doit lever une exception').not.toBeNull();
    // Aucune ligne ne doit avoir été créée par l'appel rejeté.
    const row = await readAnalytics();
    expect(row, 'aucune ligne analytics créée par un champ invalide').toBeNull();
  });

  test('un p_increment négatif est borné à 0 et ne décrémente pas', async () => {
    // Baseline positive : profile_visits = 4.
    for (let i = 0; i < 4; i++) {
      expect(await increment('profile_visits', 1), `profile_visits +1 (#${i + 1})`).toBeNull();
    }
    const before = await readAnalytics();
    expect(val(before, 'profile_visits'), 'baseline profile_visits = 4').toBe(4);

    // GREATEST(p_increment, 0) → l'ajout d'un négatif vaut 0, pas de décrément.
    expect(await increment('profile_visits', -5), 'incrément négatif accepté sans erreur').toBeNull();

    const after = await readAnalytics();
    expect(
      val(after, 'profile_visits'),
      'compteur inchangé après incrément négatif (GREATEST borne à 0)',
    ).toBe(4);
  });
});
