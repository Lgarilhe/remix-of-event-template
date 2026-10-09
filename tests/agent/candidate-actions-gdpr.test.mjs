import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';

const compiled = await build({
  entryPoints: ['supabase/functions/_shared/get-or-fetch-contact.ts'],
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
});
const { recordGdprErasure, isCandidateErasedForOrg } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

function matchesLike(value, pattern) {
  let source = '^';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '\\' && index + 1 < pattern.length) {
      source += pattern[++index].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else if (char === '%' || char === '*') source += '.*';
    else if (char === '_') source += '.';
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${source}$`, 'i').test(String(value ?? ''));
}

function fixture(failPurge = false, overrides = {}, failedTable = null) {
  const calls = [];
  const tables = {
    candidate_contacts: [
      { organization_id: 'org-a', candidate_id: 'candidate-canonical', email: 'person@example.test', phone: null },
      { organization_id: 'org-b', candidate_id: 'candidate-other-org', email: 'person@example.test', phone: null },
    ],
    ...overrides,
  };
  const client = {
    from(table) {
      tables[table] ??= [];
      let rows = [...tables[table]];
      const query = {
        eq(key, value) { rows = rows.filter((row) => row[key] === value); return proxy; },
        in(key, values) { rows = rows.filter((row) => values.includes(row[key])); return proxy; },
        ilike(key, value) { rows = rows.filter((row) => matchesLike(row[key], value)); return proxy; },
        is(key, value) { rows = rows.filter((row) => (row[key] ?? null) === value); return proxy; },
        not(key) { rows = rows.filter((row) => row[key] !== null && row[key] !== undefined); return proxy; },
        insert(values) { tables[table].push(...(Array.isArray(values) ? values : [values])); return proxy; },
        upsert(values) {
          for (const value of Array.isArray(values) ? values : [values]) {
            const existing = tables[table].find((row) => row.organization_id === value.organization_id && row.candidate_id === value.candidate_id);
            if (existing) Object.assign(existing, value); else tables[table].push(value);
          }
          return proxy;
        },
        then(resolve, reject) {
          return Promise.resolve({ data: rows, error: table === failedTable ? { message: 'read unavailable' } : null }).then(resolve, reject);
        },
      };
      const proxy = new Proxy(query, { get(target, name) { return name in target ? target[name] : () => proxy; } });
      return proxy;
    },
    async rpc(name, params) {
      calls.push({ name, params });
      return { data: null, error: failPurge ? { message: 'storage unavailable' } : null };
    },
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  };
  return { client, calls, tables };
}

test('erasure includes exact saved-contact identity and preserves organization scope', async () => {
  const { client, calls } = fixture();
  const result = await recordGdprErasure(client, { organizationId: 'org-a', email: 'person@example.test' });
  assert.equal(result.success, true, result.error);
  const purge = calls.find((call) => call.name === 'candidate_actions_purge');
  assert.deepEqual(purge.params, {
    p_organization_id: 'org-a', p_candidate_ids: ['candidate-canonical'],
    p_linkedin_url: null, p_email: 'person@example.test',
  });
});

test('global erasure preserves the explicit global scope and all exact identities', async () => {
  const { client, calls } = fixture();
  const result = await recordGdprErasure(client, { organizationId: null, email: 'person@example.test' });
  assert.equal(result.success, true, result.error);
  const purge = calls.find((call) => call.name === 'candidate_actions_purge');
  assert.equal(purge.params.p_organization_id, null);
  assert.deepEqual(new Set(purge.params.p_candidate_ids), new Set(['candidate-canonical', 'candidate-other-org']));
});

test('erasure never claims success while action drafts or message bodies could remain', async () => {
  const { client, calls } = fixture(true);
  const result = await recordGdprErasure(client, { organizationId: 'org-a', email: 'person@example.test' });
  assert.equal(result.success, false);
  assert.match(result.error, /suppression des actions et échanges/);
  assert.equal(calls.filter((call) => call.name === 'candidate_actions_purge').length, 1);
});


test('email-only organization erasure leaves a durable marker and blocks regeneration from retained contacts', async () => {
  const { client, tables } = fixture();
  const result = await recordGdprErasure(client, { organizationId: 'org-a', email: 'person@example.test' });
  assert.equal(result.success, true, result.error);
  assert.deepEqual(tables.candidate_photos.map(({ organization_id, candidate_id, status }) => ({ organization_id, candidate_id, status })), [
    { organization_id: 'org-a', candidate_id: 'candidate-canonical', status: 'erased' },
  ]);
  assert.equal(await isCandidateErasedForOrg(client, { organizationId: 'org-a', linkedinIds: ['candidate-canonical'] }), true);
  assert.equal(await isCandidateErasedForOrg(client, { organizationId: 'org-b', linkedinIds: ['candidate-other-org'] }), false);
});

test('organization photo marker blocks a candidate who was never enrolled in a sequence', async () => {
  const { client } = fixture(false, { candidate_photos: [{ organization_id: 'org-a', candidate_id: 'candidate-canonical', status: 'erased' }] });
  assert.equal(await isCandidateErasedForOrg(client, { organizationId: 'org-a', linkedinIds: ['candidate-canonical'] }), true);
  assert.equal(await isCandidateErasedForOrg(client, { organizationId: 'org-b', linkedinIds: ['candidate-canonical'] }), false);
});

test('global email-only erasure is recognized through exact organization contacts and provider-resolved email', async () => {
  const hash = createHash('sha256').update('person@example.test').digest('hex');
  const { client } = fixture(false, { gdpr_erasures: [{ id: 'erasure', email_hash: hash }] });
  assert.equal(await isCandidateErasedForOrg(client, { organizationId: 'org-a', linkedinIds: ['candidate-canonical'] }), true);
  assert.equal(await isCandidateErasedForOrg(client, { organizationId: 'org-b', linkedinIds: ['candidate-canonical'] }), false);
  assert.equal(await isCandidateErasedForOrg(client, { organizationId: 'org-a', emails: [' PERSON@example.test '] }), true);
});

test('pipeline URL aliases are resolved exactly without conflating a similar LinkedIn slug', async () => {
  const { client, tables } = fixture(false, {
    job_candidate_status: [
      { organization_id: 'org-a', candidate_id: 'canonical', linkedin_profile_url: 'https://www.linkedin.com/in/person-profile/' },
      { organization_id: 'org-a', candidate_id: 'similar', linkedin_profile_url: 'https://www.linkedin.com/in/person-profile-extra' },
    ],
    candidate_photos: [{ organization_id: 'org-a', candidate_id: 'similar', status: 'erased' }],
  });
  const input = { organizationId: 'org-a', linkedinIds: ['provider-alias'], linkedinUrl: 'https://www.linkedin.com/in/person-profile' };
  assert.equal(await isCandidateErasedForOrg(client, input), false);
  tables.candidate_photos.push({ organization_id: 'org-a', candidate_id: 'canonical', status: 'erased' });
  assert.equal(await isCandidateErasedForOrg(client, input), true);
});

test('erasure guard refuses to proceed when a durable marker or exact email registry cannot be read', async () => {
  for (const table of ['job_candidate_status', 'candidate_photos', 'candidate_contacts', 'gdpr_erasures']) {
    const { client } = fixture(false, {}, table);
    await assert.rejects(() => isCandidateErasedForOrg(client, { organizationId: 'org-a', linkedinIds: ['candidate-canonical'] }), /read unavailable/);
  }
});
