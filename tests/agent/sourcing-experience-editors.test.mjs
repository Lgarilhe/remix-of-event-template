import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const plain = value => JSON.parse(JSON.stringify(value));
function compile(source, globals = {}) {
  const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
  });
  assert.equal(diagnostics?.length ?? 0, 0);
  const context = { exports: {}, ...globals };
  vm.runInNewContext(outputText, context);
  return context.exports;
}
const initial = compile(readFileSync(new URL('src/components/outreach/types.ts', root), 'utf8')).INITIAL_FILTERS;
const bundled = buildSync({ entryPoints: [new URL('supabase/functions/_shared/continuous-sourcing-filters.ts', root).pathname],
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' }).outputFiles[0].text;
const runtime = { module: { exports: {} }, exports: {} };
vm.runInNewContext(bundled, runtime);
const { buildContinuousSearchRequest: build, continuousCalculatedExperienceRange: calculated } = runtime.module.exports;

function callbacks(path) {
  const source = readFileSync(new URL(path, root), 'utf8');
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(file) === 'onChange' && node.initializer?.expression
      && ts.isArrowFunction(node.initializer.expression)) {
      const arrow = node.initializer.expression;
      const body = arrow.getText(file);
      if (/calculated_experience_(?:min|max):|years_of_experience_(?:min|max):/.test(body)) {
        const attributes = node.parent.properties;
        const value = attributes.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(file) === 'value')?.getText(file) || '';
        found.push({ body, kind: /filters\.years_of_experience/.test(value) ? 'native' : 'calculated' });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}
const editors = [
  'src/components/outreach/search/FilterFacets.tsx',
  'src/components/outreach/search/SourcingFlow.tsx',
  'src/components/outreach/LinkedInFilters.tsx',
].flatMap(path => callbacks(path).map(callback => ({ path, ...callback })));
function execute(editor) {
  let next;
  const current = { ...plain(initial), api: 'recruiter', keywords: 'Engineer', activity_messages: null,
    calculated_experience_min: 5, calculated_experience_max: 10, years_of_experience_min: 3, years_of_experience_max: 12,
    native_experience_reviewed: true, last_manual_edit: '2026-10-09' };
  const update = value => { next = typeof value === 'function' ? value(current) : value; };
  const callback = compile('export const run = ' + editor.body, { filters: current, setFilters: update, onFiltersEdit: update, onChange: update }).run;
  if (callback.length === 2) callback(6, 9);
  else callback({ target: { value: '6' } });
  return { next, before: current };
}

test('all seven calculated experience editors clear both native aliases, including edits after a native range', () => {
  const callbacks = editors.filter(editor => editor.kind === 'calculated');
  assert.equal(callbacks.length, 7, 'exercise each compact and advanced calculated editor');
  for (const editor of callbacks) {
    const { next } = execute(editor);
    assert.equal(next.years_of_experience_min, null, editor.path);
    assert.equal(next.years_of_experience_max, null, editor.path);
    for (const api of ['classic', 'recruiter', 'sales_navigator']) {
      const saved = { ...next, api, native_experience_reviewed: true };
      const request = build(saved, api);
      assert.equal(request.years_of_experience, undefined, editor.path);
      assert.equal(request.tenure, undefined, editor.path);
      assert.deepEqual(plain(calculated(saved, api)), { min: next.calculated_experience_min, max: next.calculated_experience_max });
    }
  }
});

test('explicit advanced native experience edits keep their other native bound and clear calculated bounds', () => {
  const callbacks = editors.filter(editor => editor.kind === 'native');
  assert.equal(callbacks.length, 2);
  for (const editor of callbacks) {
    const { next, before } = execute(editor);
    assert.equal(next.calculated_experience_min, null);
    assert.equal(next.calculated_experience_max, null);
    const editedMin = next.years_of_experience_min !== before.years_of_experience_min;
    assert.equal(editedMin ? next.years_of_experience_min : next.years_of_experience_max, 6);
    assert.equal(editedMin ? next.years_of_experience_max : next.years_of_experience_min,
      editedMin ? before.years_of_experience_max : before.years_of_experience_min);
    const request = build(next, 'recruiter');
    assert.deepEqual(plain(request.years_of_experience), { min: next.years_of_experience_min, max: next.years_of_experience_max });
    assert.deepEqual(plain(calculated(next, 'recruiter')), { min: null, max: null });
  }
});

test('natural language experience edits preserve effective untouched bounds and switch explicit native ranges to calculated ranges', async () => {
  const source = readFileSync(new URL('src/components/outreach/search/nlFilterEdit.ts', root), 'utf8').replace(/^import[\s\S]*?;\r?\n/gm, '');
  for (const [api, searchSource, set, expected, native] of [
    ['recruiter', 'linkedin', { years_of_experience_min: 5, years_of_experience_max: 10 }, [5, 10], [3, 12]],
    ['recruiter', 'linkedin', { years_of_experience_min: 6, years_of_experience_max: 10 }, [6, 10], [3, 12]],
    ['recruiter', 'linkedin', { years_of_experience_min: 0 }, [0, 12], [3, 12]],
    ['recruiter', 'linkedin', { years_of_experience_min: null, years_of_experience_max: 8 }, [3, 8], [3, 12]],
    ['sales_navigator', 'linkedin', { years_of_experience_min: 5 }, [5, 8], [3, 8]],
    ['classic', 'linkedin', { years_of_experience_min: 0 }, [0, 10], [3, 12]],
    ['database', 'database', { years_of_experience_min: 0 }, [0, 10], [3, 12]],
  ]) {
    let sent;
    const module = compile(source, {
      invokeWithCredits: async (_function, _action, body) => { sent = body; return { data: { success: true, ops: { set } } }; },
      invokeUnipile() { throw new Error('No provider call expected'); },
    });
    const { next, changed } = await module.nlFilterEdit({ instruction: 'Préciser l’expérience', accountId: null, searchSource,
      filters: { ...plain(initial), api, calculated_experience_min: 5, calculated_experience_max: 10,
        years_of_experience_min: native[0], years_of_experience_max: native[1] } });
    assert.equal(next.calculated_experience_min, expected[0]);
    assert.equal(next.calculated_experience_max, expected[1]);
    assert.equal(next.years_of_experience_min, null);
    assert.equal(next.years_of_experience_max, null);
    assert.equal(changed, true);
    assert.deepEqual([sent.current_filters.experience_min, sent.current_filters.experience_max],
      api === 'recruiter' || api === 'sales_navigator' ? native : [5, 10]);
  }
});

test('null experience fields mean unchanged and cannot clear XP during an unrelated language edit', async () => {
  const source = readFileSync(new URL('src/components/outreach/search/nlFilterEdit.ts', root), 'utf8').replace(/^import[\s\S]*?;\r?\n/gm, '');
  for (const unrelated of [false, true]) {
    const filters = { ...plain(initial), api: 'recruiter', calculated_experience_min: 5, calculated_experience_max: 10,
      years_of_experience_min: 3, years_of_experience_max: 12 };
    const module = compile(source, {
      invokeWithCredits: async () => ({ data: { success: true, ops: { set: {
        years_of_experience_min: null, years_of_experience_max: null,
        ...(unrelated ? { profile_language: ['en'] } : {}),
      } } } }),
      invokeUnipile() { throw new Error('No provider call expected'); },
    });
    const { next, changed } = await module.nlFilterEdit({ instruction: unrelated ? 'Ajouter anglais' : 'Conserver les filtres',
      accountId: null, searchSource: 'linkedin', filters });
    assert.equal(changed, unrelated);
    for (const key of ['calculated_experience_min', 'calculated_experience_max', 'years_of_experience_min', 'years_of_experience_max']) {
      assert.equal(next[key], filters[key], key);
    }
    assert.deepEqual(plain(next.profile_language), unrelated ? ['en'] : filters.profile_language);
  }
});

test('natural language geographical additions resolve through the selected licence without adding Recruiter mobility to other licences', async () => {
  const source = readFileSync(new URL('src/components/outreach/search/nlFilterEdit.ts', root), 'utf8').replace(/^import[\s\S]*?;\r?\n/gm, '');
  for (const [api, service] of [['classic', 'CLASSIC'], ['sales_navigator', 'SALES_NAVIGATOR'], ['recruiter', 'RECRUITER']]) {
    const requests = [];
    const module = compile(source, {
      invokeWithCredits: async () => ({ data: { success: true, ops: { set: { location_keywords: ['Paris'] } } } }),
      invokeUnipile: async value => { requests.push(value.body); return { data: { items: [{ id: '105015875', title: 'Paris' }] } }; },
    });
    const { next, changed } = await module.nlFilterEdit({ instruction: 'Ajouter Paris', accountId: 'test-account', searchSource: 'linkedin',
      filters: { ...plain(initial), api } });
    assert.equal(changed, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].service, service);
    assert.equal(next.location[0].scope, api === 'recruiter' ? 'CURRENT_OR_OPEN_TO_RELOCATE' : 'CURRENT');
  }
});
