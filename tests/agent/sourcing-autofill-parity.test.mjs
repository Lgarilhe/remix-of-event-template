import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../../src/components/outreach/AutoFillFiltersButton.tsx', import.meta.url), 'utf8');
// Execute the shared production mapper; replace only the credit and provider
// boundaries so the parity check never performs a paid call or network request.
const mapperSource = readFileSync(new URL('../../src/components/outreach/search/generateFiltersFromJob.ts', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '');
function compile(source) {
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal(result.diagnostics?.length ?? 0, 0);
  return result.outputText;
}
const mapperOutput = compile(mapperSource);
function componentHarness(source, filename, callbackName) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  let contextKey;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (node.name.text === callbackName) {
        assert.ok(ts.isCallExpression(node.initializer));
        callback = node.initializer.arguments[0];
      }
      if (node.name.text === 'contextKey') contextKey = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(callback && ts.isArrowFunction(callback), 'execute the real ' + callbackName + ' callback body');
  assert.ok(contextKey, 'execute the real generation context key');
  return { filename, output: compile('exports.run = ' + callback.getText(ast)),
    contextOutput: compile('exports.contextKey = () => ' + contextKey.getText(ast)) };
}
const entries = {
  autofill: componentHarness(source, 'AutoFillFiltersButton.tsx', 'handleAutoFill'),
  prompt: componentHarness(readFileSync(new URL('../../src/components/outreach/search/SearchPromptBar.tsx', import.meta.url), 'utf8'),
    'SearchPromptBar.tsx', 'handleGenerate'),
};
const plain = value => JSON.parse(JSON.stringify(value));

async function run(api, { currentLocation = [], currentRoles = [], currentKeywords = '', delay = false, delayLocation = false,
  changedFilters = false, entry = 'autofill', filters = {} } = {}) {
  let apply;
  let finish;
  let finishLocation;
  let locationStarted;
  const locationPending = new Promise(resolve => { locationStarted = resolve; });
  const mapperCalls = [];
  const providerRequests = [];
  const errors = [];
  const context = {
    exports: {}, selectedJob: { id: 'test-job', title: 'Engineer' }, accountId: 'test-account', organizationId: 'test-org',
    currentLocation, currentRoles, currentKeywords, api, searchSource: 'linkedin', selectedModel: null, projectId: null,
    filtersKey: 'manual-filters-before', value: 'Engineer', stableScoringContextKey: value => JSON.stringify(value),
    generationRef: { current: 0 }, contextRef: { current: null }, contextKey: null,
    buildJobContext: job => job.title, setLoading() {}, setDebugData() {},
    invokeWithCredits: async () => {
      if (delay) await new Promise(resolve => { finish = resolve; });
      return { data: { success: true, filters: { keywords: 'Engineer', role: [], seniority: [],
        years_of_experience_min: 0, years_of_experience_max: 8, location_within_area: 25,
        location_keywords: ['Paris'], company_keywords: [], school: [], skills_keywords: [], industry_keywords: [],
        ...filters,
      } } };
    },
    invokeUnipile: async args => {
      providerRequests.push(args.body);
      if (delayLocation) {
        const pending = new Promise(resolve => { finishLocation = resolve; });
        locationStarted();
        await pending;
      }
      return { data: { success: true, items: [{ id: '105015875', title: 'Paris' }] } };
    },
    onApplyFilters: value => { apply = value; }, onSuggestionsGenerated() {}, onMemoryContextGenerated() {},
    isInsufficientCreditsError: () => false,
    toast: { error(message) { errors.push(message); }, success() {} }, console: { log() {}, warn() {}, error() {} },
  };
  vm.createContext(context);
  vm.runInContext(mapperOutput, context, { filename: 'generateFiltersFromJob.ts' });
  const mapper = context.exports.mapGeneratedFilters;
  context.mapGeneratedFilters = (...args) => { mapperCalls.push(args); return mapper(...args); };
  const harness = entries[entry];
  vm.runInContext(harness.contextOutput, context, { filename: harness.filename });
  context.contextKey = context.contextRef.current = context.exports.contextKey();
  vm.runInContext(harness.output, context, { filename: harness.filename });
  const changeContext = () => {
    if (changedFilters) {
      context.filtersKey = 'manual-filters-edited';
      context.contextRef.current = context.exports.contextKey();
      assert.notEqual(context.contextRef.current, context.contextKey, 'editing filters changes the production generation context');
    } else {
      context.contextRef.current = 'different-api-context';
    }
  };
  const pending = context.exports.run();
  if (delay) {
    changeContext();
    finish();
  }
  if (delayLocation) {
    await locationPending;
    changeContext();
    finishLocation();
  }
  await pending;
  return { apply: plain(apply ?? null), providerRequests, mapperCalls, errors };
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
  assert.equal(stale.mapperCalls.length, 0, 'stale generations never reach mapping');
  assert.equal(stale.providerRequests.length, 0);
});

test('a licence context changed during shared location mapping blocks stale results', async () => {
  const stale = await run('classic', { delayLocation: true });
  assert.equal(stale.mapperCalls.length, 1);
  assert.equal(stale.providerRequests.length, 1);
  assert.equal(stale.providerRequests[0].service, 'CLASSIC');
  assert.equal(stale.apply, null, 'resolved location and generated filters cannot be applied to the new context');
});

test('auto-fill keeps canonical title alternatives and exclusions through the shared mapper for every licence', async () => {
  const role = [
    { keywords: 'Data engineer', priority: 'CAN_HAVE', scope: 'CURRENT_OR_PAST' },
    { keywords: 'Analytics engineer', priority: 'CAN_HAVE', scope: 'CURRENT_OR_PAST' },
    { keywords: 'Intern', priority: 'DOESNT_HAVE', scope: 'CURRENT' },
  ];
  for (const api of ['classic', 'recruiter', 'sales_navigator']) {
    const result = await run(api, { filters: { role } });
    assert.equal(result.mapperCalls.length, 1);
    assert.equal(result.mapperCalls[0][1].api, api);
    assert.deepEqual(result.apply.role, role, 'title adaptation happens at the request boundary without losing the original criteria');
  }
});

test('both generation entries keep manually selected title exclusions when the AI generates included titles', async () => {
  const exclusion = { keywords: 'Consultant', priority: 'DOESNT_HAVE', scope: 'CURRENT_OR_PAST' };
  const role = [{ keywords: 'Data engineer', priority: 'CAN_HAVE', scope: 'CURRENT_OR_PAST' }];
  for (const entry of ['autofill', 'prompt']) {
    for (const api of ['classic', 'recruiter', 'sales_navigator']) {
      const result = await run(api, { entry, currentRoles: [exclusion], filters: { role } });
      assert.equal(result.mapperCalls.length, 1);
      assert.deepEqual(plain(result.mapperCalls[0][1].currentRoles), [exclusion]);
      assert.deepEqual(result.apply.role, [...role, exclusion]);
    }
  }
});

test('both generation entries preserve manually required roles and keyword requirements alongside AI criteria', async () => {
  const required = { keywords: 'Cloud architect', priority: 'MUST_HAVE', scope: 'CURRENT_OR_PAST' };
  const role = [{ keywords: 'Data engineer', priority: 'CAN_HAVE', scope: 'CURRENT_OR_PAST' }];
  for (const entry of ['autofill', 'prompt']) {
    for (const api of ['classic', 'recruiter', 'sales_navigator']) {
      const result = await run(api, { entry, currentRoles: [required], currentKeywords: 'Terraform', filters: { role } });
      assert.equal(result.mapperCalls[0][1].currentKeywords, 'Terraform');
      assert.deepEqual(result.apply.role, [...role, required], 'a manual obligation cannot be removed by generation');
      assert.equal(result.apply.keywords, '(Terraform) AND (Engineer)', 'manual and generated keywords stay distinct requirements');
      assert.deepEqual(result.errors, []);
    }
  }
});

test('both generation entries explicitly reject differing manual and generated title alternatives before location calls', async () => {
  const currentRoles = [{ keywords: 'Cloud architect', priority: 'CAN_HAVE', scope: 'CURRENT_OR_PAST' }];
  const role = [{ keywords: 'Data engineer', priority: 'CAN_HAVE', scope: 'CURRENT_OR_PAST' }];
  for (const entry of ['autofill', 'prompt']) {
    const result = await run('classic', { entry, currentRoles, filters: { role } });
    assert.equal(result.apply, null);
    assert.equal(result.providerRequests.length, 0);
    assert.match(result.errors[0], /alternatives existantes et générées diffèrent/);
  }
});

test('manual filter edits invalidate both generation entries while awaiting AI or location resolution', async () => {
  for (const entry of ['autofill', 'prompt']) {
    for (const [delay, delayLocation] of [[true, false], [false, true]]) {
      const stale = await run('classic', { entry, delay, delayLocation, changedFilters: true });
      assert.equal(stale.apply, null, 'the pending generation cannot overwrite manual edits');
    }
  }
});
