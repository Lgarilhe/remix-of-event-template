import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const bundled = buildSync({
  entryPoints: [new URL('supabase/functions/_shared/continuous-sourcing-filters.ts', root).pathname],
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022',
}).outputFiles[0].text;
const context = { module: { exports: {} }, exports: {} };
vm.runInNewContext(bundled, context);
const { buildContinuousSearchRequest: build, continuousCalculatedExperienceRange: calculated } = context.module.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const base = { keywords: 'Python', last_manual_edit: '2026-10-09', activity_messages: null };

test('company selections remain alternatives, explicit requirements and exclusions keep their scopes', () => {
  const request = plain(build({ ...base, company: [
    { id: '11', name: 'A' }, { id: '12', name: 'B' },
    { id: '13', priority: 'MUST_HAVE', scope: 'PAST' },
    { id: '14', priority: 'DOESNT_HAVE', scope: 'CURRENT' },
  ], company_keywords: [{ keywords: 'Client', priority: 'DOESNT_HAVE', scope: 'CURRENT_OR_PAST' }] }, 'recruiter'));
  assert.deepEqual(request.company, [
    { id: '11', priority: 'CAN_HAVE', scope: 'CURRENT_OR_PAST' },
    { id: '12', priority: 'CAN_HAVE', scope: 'CURRENT_OR_PAST' },
    { id: '13', priority: 'MUST_HAVE', scope: 'PAST' },
    { id: '14', priority: 'DOESNT_HAVE', scope: 'CURRENT' },
    { keywords: 'Client', priority: 'DOESNT_HAVE', scope: 'CURRENT_OR_PAST' },
  ]);
});

test('legacy include groups and company arrays compile to the same Recruiter alternatives', () => {
  assert.deepEqual(plain(build({ ...base, company: ['11', '12'] }, 'recruiter')),
    plain(build({ ...base, company: { include: ['11', '12'] } }, 'recruiter')));
});

test('Classic and Sales preserve native alternatives; unrepresentable AND and exclusions are refused', () => {
  const company = [{ id: '11', priority: 'CAN_HAVE' }, { id: '12', priority: 'CAN_HAVE' }];
  assert.deepEqual(plain(build({ ...base, company }, 'classic')).company, ['11', '12']);
  assert.deepEqual(plain(build({ ...base, company }, 'sales_navigator')).company, { include: ['11', '12'] });
  assert.deepEqual(plain(build({ ...base, company: company.map(item => ({ ...item, scope: 'CURRENT' })) }, 'sales_navigator')).company,
    { include: ['11', '12'] });
  assert.deepEqual(plain(build({ ...base, company: [...company, { id: '13', priority: 'DOESNT_HAVE' }] }, 'sales_navigator')).company,
    { include: ['11', '12'], exclude: ['13'] });
  assert.throws(() => build({ ...base, company: [{ id: '13', priority: 'DOESNT_HAVE' }] }, 'classic'), /exclusion/);
  for (const api of ['classic', 'sales_navigator']) {
    assert.throws(() => build({ ...base, company: [{ id: '11', priority: 'MUST_HAVE' }, { id: '12', priority: 'MUST_HAVE' }] }, api), /au moins une/);
  }
});

test('eligibility validates the same Boolean syntax without treating lowercase words as operators', () => {
  for (const api of ['classic', 'recruiter', 'sales_navigator']) {
    for (const keywords of ['Python AND (OR Java)', 'Python AND', 'Python ()', 'Python NOT )', '"Python']) {
      assert.throws(() => build({ ...base, keywords }, api), /guillemets|opérateurs/);
    }
    for (const keywords of ['Java or', '"Research (OR)" AND NOT Python', '(Python OR Java) AND "cloud engineer"']) {
      assert.equal(build({ ...base, keywords }, api).keywords, keywords);
    }
  }
});

test('generated and manually reviewed experience use the same local bounds as the UI loader', () => {
  assert.deepEqual(plain(calculated({ skills_keywords: [], years_of_experience_min: 3, years_of_experience_max: 8 })), { min: 3, max: 8 });
  assert.deepEqual(plain(calculated({ ...base, skills_keywords: [], years_of_experience_min: 1, years_of_experience_max: 2,
    calculated_experience_min: 5, calculated_experience_max: 10 })), { min: 5, max: 10 });
  assert.deepEqual(plain(calculated({ ...base, years_of_experience_min: 1 })), { min: null, max: null });
  assert.deepEqual(plain(calculated({ ...base, calculated_experience_max: 0 })), { min: null, max: 0 });
  assert.throws(() => calculated({ ...base, calculated_experience_min: 10, calculated_experience_max: 5 }), /minimale/);
});

test('new manual snapshots retain a reviewed native range; stale generated aliases remain inactive', () => {
  for (const api of ['recruiter', 'sales_navigator']) {
    const saved = { ...base, native_experience_reviewed: true,
      years_of_experience_min: 3, years_of_experience_max: 8,
      calculated_experience_min: 10, calculated_experience_max: 20 };
    const request = build(saved, api);
    assert.deepEqual(plain(api === 'recruiter' ? request.years_of_experience : request.tenure[0]), { min: 3, max: 8 });
    assert.deepEqual(plain(calculated(saved, api)), { min: null, max: null });
    assert.equal(build({ ...saved, native_experience_reviewed: false }, api).years_of_experience, undefined);
    assert.deepEqual(plain(calculated({ ...saved, native_experience_reviewed: false }, api)), { min: 10, max: 20 });
  }
  assert.throws(() => build({ ...base, native_experience_reviewed: true, years_of_experience_min: 3 }, 'classic'), /expérience/i);
});

test('generated filters preserve calculated experience and resolve geography for the selected licence', async () => {
  const path = 'src/components/outreach/search/generateFiltersFromJob.ts';
  const source = readFileSync(new URL(path, root), 'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const mapper = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'mapGeneratedFilters');
  assert.ok(mapper);
  const code = buildSync({ stdin: { contents: mapper.getText(ast), loader: 'ts' },
    write: false, platform: 'node', format: 'cjs', target: 'es2022' }).outputFiles[0].text;
  const local = { module: { exports: {} }, exports: {}, invokeUnipile() { throw new Error('Unexpected provider call'); } };
  vm.runInNewContext(code, local);
  const result = await local.module.exports.mapGeneratedFilters({ keywords: 'Python',
    years_of_experience_min: 3, years_of_experience_max: 8 }, { accountId: null });
  assert.equal(result.update.years_of_experience_min, null);
  assert.equal(result.update.years_of_experience_max, null);
  assert.deepEqual(plain({ min: result.update.calculated_experience_min, max: result.update.calculated_experience_max }),
    plain(calculated({ skills_keywords: [], years_of_experience_min: 3, years_of_experience_max: 8 })));
  const requests = [];
  local.invokeUnipile = async ({ body }) => {
    requests.push(body);
    return { data: { success: true, items: [{ id: '105015875', title: 'Paris' }] } };
  };
  for (const [api, service] of [['classic', 'CLASSIC'], ['sales_navigator', 'SALES_NAVIGATOR'], ['recruiter', 'RECRUITER']]) {
    const { update } = await local.module.exports.mapGeneratedFilters({ location_keywords: ['Paris'], location_within_area: 25 },
      { accountId: 'account-test', api });
    assert.equal(requests.at(-1).service, service);
    assert.equal(update.location[0].scope, api === 'recruiter' ? 'CURRENT_OR_OPEN_TO_RELOCATE' : 'CURRENT');
    assert.equal(update.location_within_area, api === 'recruiter' ? 25 : null);
  }
});
