import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../../src/components/outreach/AutoFillFiltersButton.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('AutoFillFiltersButton.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'handleAutoFill') {
    assert.ok(ts.isCallExpression(node.initializer));
    callback = node.initializer.arguments[0];
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(callback && ts.isArrowFunction(callback), 'execute the real auto-fill callback body');
const output = ts.transpileModule('exports.run = ' + callback.getText(ast), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const plain = value => JSON.parse(JSON.stringify(value));

async function run(api, { currentLocation = [], delay = false } = {}) {
  let apply;
  let finish;
  const providerRequests = [];
  const context = {
    exports: {}, selectedJob: { id: 'test-job', title: 'Engineer' }, accountId: 'test-account', organizationId: 'test-org',
    currentLocation, api, searchSource: 'linkedin', selectedModel: null, projectId: null,
    generationRef: { current: 0 }, contextRef: { current: 'test-context' }, contextKey: 'test-context',
    buildJobContext: job => job.title, setLoading() {}, setDebugData() {},
    invokeWithCredits: async () => {
      if (delay) await new Promise(resolve => { finish = resolve; });
      return { data: { success: true, filters: { keywords: 'Engineer', role: [], seniority: [],
        years_of_experience_min: 0, years_of_experience_max: 8, location_within_area: 25,
        location_keywords: ['Paris'], company_keywords: [], school: [], skills_keywords: [], industry_keywords: [],
      } } };
    },
    requireGeneratedFilters: data => data.filters,
    requireGeneratedSearchMemoryContext: () => undefined,
    invokeUnipile: async args => {
      providerRequests.push(args.body);
      return { data: { success: true, items: [{ id: '105015875', title: 'Paris' }] } };
    },
    onApplyFilters: value => { apply = value; }, onSuggestionsGenerated() {}, onMemoryContextGenerated() {},
    toast: { error() {}, success() {} }, console: { log() {}, warn() {}, error() {} },
  };
  vm.runInNewContext(output, context);
  const pending = context.exports.run();
  if (delay) {
    context.contextRef.current = 'different-api-context';
    finish();
  }
  await pending;
  return { apply: plain(apply ?? null), providerRequests };
}

test('auto-fill keeps generated experience in calculated ranges, including a zero minimum', async () => {
  for (const api of ['classic', 'recruiter', 'sales_navigator']) {
    const { apply } = await run(api);
    assert.equal(apply.calculated_experience_min, 0);
    assert.equal(apply.calculated_experience_max, 8);
    assert.equal(apply.years_of_experience_min, null);
    assert.equal(apply.years_of_experience_max, null);
  }
});

test('auto-fill resolves locations using the selected licence and only adds radius or mobility for Recruiter', async () => {
  for (const [api, service] of [['classic', 'CLASSIC'], ['recruiter', 'RECRUITER'], ['sales_navigator', 'SALES_NAVIGATOR']]) {
    const { apply, providerRequests } = await run(api);
    assert.equal(providerRequests.length, 1);
    assert.equal(providerRequests[0].service, service);
    assert.equal(apply.location_within_area, api === 'recruiter' ? 25 : null);
    assert.equal(apply.location[0].scope, api === 'recruiter' ? 'CURRENT_OR_OPEN_TO_RELOCATE' : 'CURRENT');
  }
});

test('auto-fill preserves the existing selected location and a changed licence context blocks stale results', async () => {
  const existing = [{ id: '105015875', name: 'Paris', priority: 'CAN_HAVE', scope: 'CURRENT' }];
  const kept = await run('recruiter', { currentLocation: existing });
  assert.equal(kept.providerRequests.length, 0);
  assert.equal(kept.apply.location, undefined, 'the existing location is not overwritten');
  const stale = await run('classic', { delay: true });
  assert.equal(stale.apply, null);
  assert.equal(stale.providerRequests.length, 0);
});
