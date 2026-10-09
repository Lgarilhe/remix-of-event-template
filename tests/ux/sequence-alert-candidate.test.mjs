import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { transformSync } from 'esbuild';

// Exécuter la branche réelle d'échec et l'écrivain de notification, sans lancer
// le serveur webhook. Seul le client de base est remplacé par une table mémoire.
const source = readFileSync(new URL('../../supabase/functions/unipile-webhook/index.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('webhook.ts', source, ts.ScriptTarget.Latest, true);
const fn = (name) => parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
const failure = fn('handleNewMessage').body.statements.find((node) => ts.isIfStatement(node) && node.expression.getText(parsed) === 'failures.length > 0');
assert.ok(failure, 'branche réelle d’échec retrouvée');
const { code } = transformSync(`
  const SIBLING_STOP_FAILED_SOURCE = 'reply_sibling_stop_failed';
  const console = { warn() {}, error() {} };
  ${fn('loadSequenceProjects').getText(parsed)}
  ${fn('alertSiblingStopFailure').getText(parsed)}
  export async function run(context) {
    const { supabase, failures, stopFailedOrgs, accountInMailsFailed, account_id, anchorRows,
      inmailMatches, senderId, resolvedAltIds, payload, eventKey } = context;
    ${failure.getText(parsed)}
  }
`, { loader: 'ts', format: 'esm' });
const { run } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

function setup(rows = [], { lookupError, inmailMatches = [], anchorRows = [] } = {}) {
  const failure = new Error('annulation impossible');
  const tables = {
    inmail_queue: rows,
    member_linkedin_accounts: [{ user_id: 'recruiter', organization_id: 'org-a', linkedin_account_id: 'account-a' }],
    notifications: [],
    outreach_sequences: [],
  };
  let lookups = 0;
  const supabase = { from(table) {
    if (table === 'inmail_queue') lookups++;
    const filters = [];
    let limit = Infinity;
    const query = {
      select() { return query; },
      eq(col, value) { filters.push((row) => row[col] === value); return query; },
      in(col, values) { filters.push((row) => values.includes(row[col])); return query; },
      limit(value) { limit = value; return query; },
      insert(values) { tables[table].push(...values); return Promise.resolve({ error: null }); },
      then(resolve) {
        if (table === 'inmail_queue' && lookupError) return resolve({ data: null, error: lookupError });
        return resolve({ data: tables[table].filter((row) => filters.every((filter) => filter(row))).slice(0, limit), error: null });
      },
    };
    return query;
  } };
  const context = {
    supabase, failures: [failure], stopFailedOrgs: new Set(), accountInMailsFailed: true,
    account_id: 'account-a', anchorRows, inmailMatches, senderId: 'ACo-candidate',
    resolvedAltIds: ['AEM-candidate'], payload: { sender: { attendee_name: 'Camille' } }, eventKey: 'event-1',
  };
  return { context, tables, failure, lookups: () => lookups };
}

const pending = (overrides = {}) => ({
  organization_id: 'org-a', account_id: 'account-a', status: 'scheduled', recipient_profile_id: 'AEM-candidate', ...overrides,
});

for (const status of ['pending', 'scheduled']) test(`L’InMail ${status} seul sous alias ouvre sa fiche, sans fabriquer une ancre`, async () => {
  const fixture = setup([pending({ status })]);
  await assert.rejects(run(fixture.context), (error) => error === fixture.failure);
  assert.equal(fixture.tables.notifications[0].link, '/pipeline?candidate=AEM-candidate');
  assert.deepEqual(fixture.tables.notifications[0].metadata.enrollment_ids, []);
  assert.deepEqual(fixture.context.anchorRows, []);
  assert.deepEqual(fixture.context.inmailMatches, []);
  assert.equal(fixture.tables.inmail_queue[0].status, status);
});

test('Le lien ne prend pas un InMail d’une autre organisation, d’un autre compte ou d’un autre candidat', async () => {
  const fixture = setup([
    pending({ organization_id: 'org-b' }), pending({ account_id: 'account-b' }),
    pending({ recipient_profile_id: 'AEM-other' }), pending({ status: 'sent' }),
  ]);
  await assert.rejects(run(fixture.context), (error) => error === fixture.failure);
  assert.equal(fixture.tables.notifications[0].link, '/pipeline?candidate=ACo-candidate');
});

test('Une identité déjà connue conserve son lien sans lecture supplémentaire', async () => {
  const fixture = setup([], { inmailMatches: [pending({ status: 'sent' })] });
  await assert.rejects(run(fixture.context), (error) => error === fixture.failure);
  assert.equal(fixture.tables.notifications[0].link, '/pipeline?candidate=AEM-candidate');
  assert.equal(fixture.lookups(), 0);
});

test('Une panne de lecture conserve l’alerte et l’erreur initiale qui demande le rejeu', async () => {
  const fixture = setup([], { lookupError: new Error('lecture indisponible') });
  await assert.rejects(run(fixture.context), (error) => error === fixture.failure);
  assert.equal(fixture.tables.notifications.length, 1);
  assert.equal(fixture.tables.notifications[0].link, '/pipeline?candidate=ACo-candidate');
});
