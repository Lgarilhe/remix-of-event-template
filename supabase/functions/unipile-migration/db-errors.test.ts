// Réduction des erreurs de la base à un code neutre.
//
//   deno test --no-check --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/unipile-migration/db-errors.test.ts

import { ok, strictEqual } from 'node:assert';
import { classifyDbError, isMissingFunctionError, remapErrorMessage, type RemapErrorCode } from './db-errors.ts';

Deno.test('classifyDbError : un code par HINT connu', () => {
  strictEqual(classifyDbError({ hint: 'REMAP_CONFLICT', code: '23505' }), 'conflict');
  strictEqual(classifyDbError({ hint: 'REMAP_CONCURRENT_CHANGE', code: '40001' }), 'concurrent_change');
  strictEqual(classifyDbError({ hint: 'REMAP_BATCH_UNKNOWN', code: 'P0002' }), 'batch_unknown');
  strictEqual(classifyDbError({ hint: 'REMAP_BATCH_ALREADY_ROLLED_BACK' }), 'batch_already_rolled_back');
  strictEqual(classifyDbError({ hint: 'REMAP_INVALID_NEW', code: '22023' }), 'invalid_input');
  strictEqual(classifyDbError({ hint: 'REMAP_KIND_UNKNOWN' }), 'invalid_input');
  strictEqual(classifyDbError({ hint: 'ENROLL_ACCOUNT_OF_OTHER_MEMBER', code: '42501' }), 'enrollment_guard');
  strictEqual(classifyDbError({ message: 'CROSS_TENANT_VIOLATION: linkedin_account_id x is already mapped', code: '42501' }), 'cross_tenant');
  strictEqual(classifyDbError({ code: '23505' }), 'conflict');
});

Deno.test('classifyDbError : le reste est « database », sans texte brut', () => {
  strictEqual(classifyDbError({ message: 'deadlock detected', code: '40P01' }), 'database');
  strictEqual(classifyDbError(null), 'database');
  strictEqual(classifyDbError(undefined), 'database');
});

Deno.test('messages : français, neutres, sans identifiant ni nom de prestataire', () => {
  const codes: RemapErrorCode[] = ['conflict', 'cross_tenant', 'enrollment_guard', 'concurrent_change', 'invalid_input', 'batch_unknown', 'batch_already_rolled_back', 'database'];
  for (const code of codes) {
    const message = remapErrorMessage(code);
    ok(message.length > 10);
    ok(!/unipile|acc_|—/i.test(message), message);
  }
});

Deno.test('isMissingFunctionError : fonction absente', () => {
  ok(isMissingFunctionError({ code: 'PGRST202' }));
  ok(isMissingFunctionError({ code: '42883' }));
  ok(!isMissingFunctionError({ code: '42501' }));
  ok(!isMissingFunctionError(null));
});
