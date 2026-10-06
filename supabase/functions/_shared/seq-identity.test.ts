// Module séquences, lot « identity » : règle pure qui désigne les autres
// inscriptions d'un candidat après une réponse (SEQ-212). « Marquer comme
// répondu », la vérification avant relance et la scrutation arrêtent les
// inscriptions dont profile_id, resolved_profile_id OU provider_id est l'un
// des identifiants LinkedIn du candidat (moteur-mark-replied-soeurs-autres-
// identifiants, moteur-detection-reponse-soeurs). Le filtre PostgREST ne doit
// jamais laisser passer une virgule, une parenthèse ni un guillemet.
//
//   deno test --no-check supabase/functions/_shared/seq-identity.test.ts

import { strictEqual } from 'node:assert';
import { siblingEnrollmentsFilter } from './sequence-engine-rules.ts';

Deno.test('siblingEnrollmentsFilter : les trois colonnes d’identité, avec chaque identifiant du candidat', () => {
  const filter = siblingEnrollmentsFilter(['ACoAAA1', 'ACoAAA1', 'AEMAAA1', null, undefined, '']);
  strictEqual(
    filter,
    'profile_id.in.(ACoAAA1,AEMAAA1),resolved_profile_id.in.(ACoAAA1,AEMAAA1),provider_id.in.(ACoAAA1,AEMAAA1)',
  );
});

Deno.test('siblingEnrollmentsFilter : aucun identifiant, aucun filtre (rien n’est arrêté au hasard)', () => {
  strictEqual(siblingEnrollmentsFilter([]), null);
  strictEqual(siblingEnrollmentsFilter([null, undefined, '']), null);
  strictEqual(siblingEnrollmentsFilter(['),(', '"']), null);
});

Deno.test('siblingEnrollmentsFilter : un identifiant forgé ne s’échappe pas du filtre', () => {
  const filter = siblingEnrollmentsFilter(['ACoAAA1),organization_id.neq.(x', 'urn:li:member:42']);
  strictEqual(
    filter,
    'profile_id.in.(ACoAAA1organization_idneqx,urn:li:member:42),resolved_profile_id.in.(ACoAAA1organization_idneqx,urn:li:member:42),provider_id.in.(ACoAAA1organization_idneqx,urn:li:member:42)',
  );
});
