import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';

// Exercise the real listing with the SDK against local PostgREST. No fixture
// writes, agent invocation, LinkedIn request or model call is needed.
const url = process.env.E2E_SUPABASE_URL;
assert.ok(url && ['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'Local Supabase required');
assert.ok(process.env.E2E_SUPABASE_SERVICE_ROLE_KEY, 'Local service role required');
const source = readFileSync(new URL('../../supabase/functions/_shared/continuous-sourcing.ts', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} });
const sandbox = { exports: {} };
vm.runInNewContext(compiled.outputText, sandbox);
let requests = 0;
const admin = createClient(url, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => {
    assert.equal(new URL(String(input)).origin, new URL(url).origin);
    requests++;
    return fetch(input, init);
  } },
});
const rows = await sandbox.exports.listContinuousAgentCandidates(admin, {
  id: randomUUID(), organization_id: randomUUID(), created_by: randomUUID(),
});
assert.equal(rows.length, 0);
assert.equal(requests, 2, 'Recent history and unresolved evaluations both reach PostgREST');
console.log('Continuous sourcing: real SDK/PostgREST listing and uncertainty filters PASS');
