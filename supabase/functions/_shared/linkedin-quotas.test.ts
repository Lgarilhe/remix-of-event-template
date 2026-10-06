// Tests de la table des paliers de montée en charge (lot P0-D).
// Miroir de linkedin_ramp_factor(timestamptz) en SQL (migration 20260906193347).
//
//   deno test --no-check supabase/functions/_shared/linkedin-quotas.test.ts
//
// --no-check : le module n'a qu'un import de types distant (supabase-js), le
// test tourne donc hors réseau ; avec réseau, `deno test` seul fonctionne aussi.

import { strictEqual } from 'node:assert';
import { linkedInRampFactor, rampCap, RAMP_MATURITY_CUTOFF_MS, RAMP_STAGES, WEEKLY_INVITE_LIMIT } from './linkedin-quotas.ts';

const DAY_MS = 24 * 3600 * 1000;
const CUTOFF = RAMP_MATURITY_CUTOFF_MS;

/** Instant "maintenant" fictif : compte rattaché à `ageDays` jours, rattachement après la borne. */
function linkedAgo(ageDays: number, now: number): string {
  return new Date(now - ageDays * DAY_MS).toISOString();
}

Deno.test('borne de maturité : 2026-09-14T00:00:00Z, comme en SQL', () => {
  strictEqual(CUTOFF, Date.parse('2026-09-14T00:00:00Z'));
});

Deno.test('sans linked_at ou valeur invalide : 100 %', () => {
  strictEqual(linkedInRampFactor(null), 1);
  strictEqual(linkedInRampFactor(undefined), 1);
  strictEqual(linkedInRampFactor(''), 1);
  strictEqual(linkedInRampFactor('pas-une-date'), 1);
});

Deno.test('rattaché avant la mise en prod : mature quel que soit l\'âge', () => {
  const now = CUTOFF + 2 * DAY_MS;
  strictEqual(linkedInRampFactor(new Date(CUTOFF - 1).toISOString(), now), 1);
  strictEqual(linkedInRampFactor('2026-06-01T10:00:00Z', now), 1);
  strictEqual(linkedInRampFactor(new Date(CUTOFF - DAY_MS), now), 1);
});

Deno.test('table des paliers : 25 / 50 / 75 / 100 % par semaine', () => {
  const now = CUTOFF + 60 * DAY_MS;
  strictEqual(linkedInRampFactor(linkedAgo(0, now), now), 0.25);
  strictEqual(linkedInRampFactor(linkedAgo(6.99, now), now), 0.25);
  strictEqual(linkedInRampFactor(linkedAgo(7, now), now), 0.5);
  strictEqual(linkedInRampFactor(linkedAgo(13.99, now), now), 0.5);
  strictEqual(linkedInRampFactor(linkedAgo(14, now), now), 0.75);
  strictEqual(linkedInRampFactor(linkedAgo(20.99, now), now), 0.75);
  strictEqual(linkedInRampFactor(linkedAgo(21, now), now), 1);
  strictEqual(linkedInRampFactor(linkedAgo(45, now), now), 1);
});

Deno.test('rattaché exactement à la borne : le palier s\'applique', () => {
  strictEqual(linkedInRampFactor(new Date(CUTOFF).toISOString(), CUTOFF + DAY_MS), 0.25);
  strictEqual(linkedInRampFactor(new Date(CUTOFF).toISOString(), CUTOFF + 8 * DAY_MS), 0.5);
});

Deno.test('linked_at dans le futur (horloge) : palier 1, comme now() - linked_at < 7 jours en SQL', () => {
  const now = CUTOFF + 10 * DAY_MS;
  strictEqual(linkedInRampFactor(new Date(now + DAY_MS).toISOString(), now), 0.25);
});

Deno.test('accepte une instance Date', () => {
  const now = CUTOFF + 30 * DAY_MS;
  strictEqual(linkedInRampFactor(new Date(now - 10 * DAY_MS), now), 0.5);
});

Deno.test('paliers déclarés dans l\'ordre croissant', () => {
  for (let i = 1; i < RAMP_STAGES.length; i += 1) {
    strictEqual(RAMP_STAGES[i].maxDays > RAMP_STAGES[i - 1].maxDays, true);
    strictEqual(RAMP_STAGES[i].factor > RAMP_STAGES[i - 1].factor, true);
  }
});

Deno.test('plafonds par défaut après palier : Math.ceil(cap × facteur)', () => {
  // Valeurs par défaut de member_quotas : 80 visibles, 100 visites, 100 recherches, 40 InMails, 100 invitations / 7 j.
  strictEqual(rampCap(80, 0.25), 20);
  strictEqual(rampCap(100, 0.25), 25);
  strictEqual(rampCap(40, 0.25), 10);
  strictEqual(rampCap(WEEKLY_INVITE_LIMIT, 0.25), 25);
  strictEqual(rampCap(80, 0.5), 40);
  strictEqual(rampCap(40, 0.75), 30);
  strictEqual(rampCap(80, 1), 80);
  // Arrondi vers le haut : un cap personnalisé bas ne tombe jamais à 0.
  strictEqual(rampCap(1, 0.25), 1);
  strictEqual(rampCap(3, 0.25), 1);
  strictEqual(rampCap(5, 0.75), 4);
});
