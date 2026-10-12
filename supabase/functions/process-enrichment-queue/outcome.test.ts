// deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/process-enrichment-queue/outcome.test.ts
import { deepStrictEqual } from 'node:assert';
import { MAX_ATTEMPTS, nextQueueStep } from './outcome.ts';

Deno.test('trop de requêtes ou compte dégradé : report sans tentative consommée, même à la dernière tentative', () => {
  for (const reason of ['profile_read_rate_limited', 'profile_read_account_degraded']) {
    deepStrictEqual(nextQueueStep(reason, 0), { action: 'defer', delayMs: 3_600_000 });
    deepStrictEqual(nextQueueStep(reason, MAX_ATTEMPTS - 1), { action: 'defer', delayMs: 3_600_000 });
  }
});

Deno.test('ancien identifiant de compte : la ligne attend la reprise des identifiants, elle n’est pas perdue', () => {
  deepStrictEqual(nextQueueStep('outdated_account_id', 0), { action: 'defer', delayMs: 6 * 3_600_000 });
});

Deno.test('compte non relié ou déconnecté : ligne close tout de suite', () => {
  deepStrictEqual(nextQueueStep('account_not_linked', 0), { action: 'fail', attempts: 1 });
  deepStrictEqual(nextQueueStep('profile_read_account_disconnected', 1), { action: 'fail', attempts: 2 });
});

Deno.test('autre échec : trois reports de 30 minutes puis échec à la quatrième tentative', () => {
  deepStrictEqual(nextQueueStep('profile_read_not_found', 0), { action: 'retry', attempts: 1, delayMs: 1_800_000 });
  deepStrictEqual(nextQueueStep('profile_read_server', 2), { action: 'retry', attempts: 3, delayMs: 1_800_000 });
  deepStrictEqual(nextQueueStep('profile_read_server', 3), { action: 'fail', attempts: 4 });
  deepStrictEqual(nextQueueStep(undefined, 0), { action: 'retry', attempts: 1, delayMs: 1_800_000 });
});
