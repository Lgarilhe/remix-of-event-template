import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Run the actual component handlers with local React state. No provider,
// database or model is called: the fixtures contain only invented filters.
const root = new URL('../../', import.meta.url);
const copy = value => JSON.parse(JSON.stringify(value));
const React = {
  Fragment: 'Fragment',
  createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }),
};
function compile(path, globals = {}, extra = '') {
  const source = readFileSync(new URL(path, root), 'utf8').replace(/^import[\s\S]*?;\r?\n/gm, '') + extra;
  const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    fileName: path, reportDiagnostics: true,
  });
  assert.equal(diagnostics?.length ?? 0, 0);
  const context = { exports: {}, React, Set, Error, console, ...globals };
  vm.runInNewContext(outputText, context, { filename: path });
  return context.exports;
}
const types = compile('src/components/outreach/types.ts');
const symbols = Object.fromEntries([
  'Button', 'Textarea', 'Input', 'Badge', 'Select', 'SelectContent', 'SelectItem', 'SelectTrigger', 'SelectValue',
  'Dialog', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogFooter', 'Search', 'Loader2', 'Pencil', 'Plus', 'X', 'Lock', 'AlertTriangle', 'JobSelector',
  'Switch', 'Alert', 'AlertDescription', 'AlertTitle', 'Tooltip', 'TooltipContent', 'TooltipProvider', 'TooltipTrigger',
  'SearchHistory', 'LinkedInFilters', 'BaseKonektDialog', 'FilterFacets', 'AutoFillFiltersButton', 'SearchPromptBar', 'QuotaDisplay',
].map(name => [name, name]));
const globals = { ...types, ...symbols, cn: (...args) => args.filter(Boolean).join(' '), plural: (_, singular) => singular };
const flow = compile('src/components/outreach/search/SourcingFlow.tsx', globals, '\nexport { buildChips };');
const base = overrides => ({ ...copy(types.INITIAL_FILTERS), api: 'recruiter', ...overrides });
const tokens = (priorities, key = 'role') => priorities.map((priority, i) => key === 'role'
  ? { keywords: ['Engineer', 'Architect', 'Intern'][i], priority, scope: 'CURRENT' }
  : { id: String(100 + i), name: ['Paris', 'Lyon', 'Nice'][i], priority, scope: 'CURRENT' });
function nodes(tree) {
  if (tree == null || typeof tree !== 'object') return [];
  return [tree, ...(tree.props?.children ?? []).flatMap(nodes)];
}
function text(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  return (tree.props?.children ?? []).map(text).join('');
}
function stateHarness(path, extraGlobals = {}, extra = '') {
  const state = [];
  let cursor = 0;
  const module = compile(path, {
    ...globals,
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
    },
    useRef: value => ({ current: value }), useCallback: fn => fn, useEffect() {},
    invokeUnipile() { throw new Error('No network expected'); },
    useBaseKonektState: () => ({ isEnabled: false, planAllows: false, isLoading: true }),
    toast: { error() { throw new Error('No toast expected'); } },
    ...extraGlobals,
  }, extra);
  return { render(name, props) { cursor = 0; return module[name](props); } };
}

test('Recruiter summaries distinguish all values, alternatives and exclusions', () => {
  for (const [priorities, expected] of [
    [['MUST_HAVE', 'MUST_HAVE'], 'tous'],
    [['CAN_HAVE', 'CAN_HAVE'], 'au moins un'],
    [['DOESNT_HAVE', 'DOESNT_HAVE'], 'exclut'],
    [['MUST_HAVE', 'CAN_HAVE'], 'selon règles'],
    [['CAN_HAVE', 'DOESNT_HAVE'], 'selon règles'],
  ]) {
    for (const [field, key] of [['role', 'poste'], ['location', 'lieu']]) {
      const filters = base({ [field]: tokens(priorities, field) });
      const chip = flow.buildChips(filters).find(c => c.key === key);
      assert.equal(chip.op, expected, `${field}: ${priorities}`);
    }
  }
});

test('Classic/Sales Navigator summaries do not offer AND when their inclusion list is OR', () => {
  for (const api of ['classic', 'sales_navigator']) {
    const chips = flow.buildChips(base({ api, job_title: tokens(['MUST_HAVE', 'MUST_HAVE'], 'location'), location: tokens(['MUST_HAVE', 'MUST_HAVE'], 'location') }));
    for (const key of ['poste', 'lieu']) {
      const chip = chips.find(c => c.key === key);
      assert.equal(chip.op, 'au moins un');
      assert.equal(chip.canCycle, false);
    }
  }
});

test('Classic/Sales additions route to supported controls without creating ignored keyword filters', () => {
  for (const api of ['classic', 'sales_navigator']) {
    for (const field of ['Poste', 'Entreprise']) {
      let edits = 0;
      let advanced = 0;
      const filters = base({ api });
      const h = stateHarness('src/components/outreach/search/SourcingFlow.tsx');
      const props = { filters, onFiltersEdit() { edits += 1; }, total: 0, loading: false, dirty: false,
        onRerun() {}, onOpenAdvanced() { advanced += 1; }, onFollowUp: async () => {}, accountId: null, searchSource: 'linkedin', variant: 'mission-v3' };
      let tree = h.render('FilterChipBar', props);
      nodes(tree).find(n => n.type === 'button' && text(n) === 'Filtre').props.onClick();
      tree = h.render('FilterChipBar', props);
      nodes(tree).find(n => n.type === 'button' && text(n) === field).props.onClick();
      assert.equal(advanced, 1, `${api}: ${field}`);
      assert.equal(edits, 0, `${api}: ${field}`);
      assert.deepEqual(copy(filters.role), []);
      assert.deepEqual(copy(filters.company_keywords), []);
    }
  }
});

test('location additions use the selected licence and do not invent mobility outside Recruiter', async () => {
  for (const api of ['recruiter', 'classic', 'sales_navigator']) {
    let filters = base({ api });
    const calls = [];
    const h = stateHarness('src/components/outreach/search/SourcingFlow.tsx', {
      invokeUnipile: async request => { calls.push(request.body); return { data: { items: [{ id: '100', title: 'Paris' }] } }; },
    });
    const props = () => ({ filters, onFiltersEdit: fn => { filters = fn(filters); }, total: 0, loading: false, dirty: false,
      onRerun() {}, onOpenAdvanced() {}, onFollowUp: async () => {}, accountId: 'account-a', searchSource: 'linkedin', variant: 'mission-v3' });
    let tree = h.render('FilterChipBar', props());
    nodes(tree).find(n => n.type === 'button' && text(n) === 'Filtre').props.onClick();
    tree = h.render('FilterChipBar', props());
    nodes(tree).find(n => n.type === 'button' && text(n) === 'Lieu').props.onClick();
    tree = h.render('FilterChipBar', props());
    nodes(tree).find(n => n.type === 'input' && n.props.placeholder === 'Valeur puis Entrée').props.onKeyDown({ key: 'Enter', target: { value: 'Paris' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls[0].service, api === 'recruiter' ? 'RECRUITER' : api === 'classic' ? 'CLASSIC' : 'SALES_NAVIGATOR');
    assert.equal(filters.location[0].scope, api === 'recruiter' ? 'CURRENT_OR_OPEN_TO_RELOCATE' : 'CURRENT');
  }
});

test('autofill adds only supported geographic defaults and preserves a location already chosen', async () => {
  for (const api of ['recruiter', 'classic', 'sales_navigator']) {
    const filtersRef = { current: base({ api }) };
    const calls = [];
    const hook = compile('src/hooks/useAutoFillFilters.ts', { ...globals, useCallback: fn => fn,
      console: { log() {}, warn() {}, error() {} },
      invokeUnipile: async request => { calls.push(request.body); return { data: { success: true, items: [{ id: '100', title: 'Paris' }] } }; },
    });
    const { handleAutoFillFilters } = hook.useAutoFillFilters({ selectedAccount: 'account-a', filtersRef, setFilters: fn => { filtersRef.current = fn(filtersRef.current); } });
    handleAutoFillFilters({ keywords: 'Engineer', location_keywords: ['Paris'], location_within_area: 25 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(filtersRef.current.location[0].scope, api === 'recruiter' ? 'CURRENT_OR_OPEN_TO_RELOCATE' : 'CURRENT');
    assert.equal(filtersRef.current.location_within_area, api === 'recruiter' ? 25 : null);
    assert.equal(calls[0].service, api === 'recruiter' ? 'RECRUITER' : api === 'classic' ? 'CLASSIC' : 'SALES_NAVIGATOR');
    filtersRef.current.location[0].scope = 'OPEN_TO_RELOCATE_ONLY';
    handleAutoFillFilters({ location_keywords: ['Lyon'] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(filtersRef.current.location[0].scope, 'OPEN_TO_RELOCATE_ONLY', 'explicit choices remain available for validation, never silently rewritten');
    assert.equal(calls.length, 1);
  }
});

test('explicit title logic toggle preserves exclusions/scopes and handles ID-only roles', () => {
  let filters = base({ job_title: tokens(['MUST_HAVE', 'DOESNT_HAVE'], 'location') });
  const h = stateHarness('src/components/outreach/search/SourcingFlow.tsx');
  const props = () => ({ filters, onFiltersEdit: fn => { filters = fn(filters); }, total: 0, loading: false, dirty: false,
    onRerun() {}, onOpenAdvanced() {}, onFollowUp: async () => {}, accountId: null, searchSource: 'linkedin', variant: 'mission-v3' });
  const tree = h.render('FilterChipBar', props());
  const button = nodes(tree).find(n => n.type === 'button' && n.props['aria-label']?.startsWith('Poste : Tous (ET)'));
  assert.ok(button);
  button.props.onClick();
  assert.equal(filters.job_title[0].priority, 'CAN_HAVE');
  assert.equal(filters.job_title[0].scope, 'CURRENT');
  assert.equal(filters.job_title[1].priority, 'DOESNT_HAVE');
});

test('company ID values are visible as alternatives, with explicit required/excluded entries preserved', () => {
  const plain = flow.buildChips(base({ company: [{ id: '100', name: 'Alpha' }, { id: '200', name: 'Beta' }] })).find(c => c.key === 'boite');
  assert.equal(plain.op, 'au moins un');
  const mixed = flow.buildChips(base({ company: [{ id: '100', name: 'Alpha', priority: 'MUST_HAVE', scope: 'PAST' }, { id: '200', name: 'Beta', priority: 'DOESNT_HAVE', scope: 'CURRENT' }] })).find(c => c.key === 'boite');
  assert.equal(mixed.op, 'selon règles');
  assert.deepEqual(copy(mixed.tokens.map(t => t.state)), ['must', 'exclude']);
});

test('company scope has its own control and cannot overwrite the priority', () => {
  const updates = [];
  const h = stateHarness('src/components/outreach/CompanyFilter.tsx', { AutocompleteInput: 'AutocompleteInput' });
  const tree = h.render('CompanyFilter', { idCompanies: [], keywordCompanies: [{ keywords: 'Alpha OR Beta', priority: 'MUST_HAVE', scope: 'PAST' }],
    onAddKeywordCompany() {}, onRemoveKeywordCompany() {}, onUpdateKeywordCompany: (index, update) => updates.push({ index, update }),
    searchValue: '', onSearchChange() {}, options: [], loading: false, isRecruiter: true });
  const scope = nodes(tree).find(n => n.type === 'Select' && n.props.value === 'PAST');
  assert.ok(scope);
  scope.props.onValueChange('PAST_NOT_CURRENT');
  assert.deepEqual(copy(updates), [{ index: 0, update: { scope: 'PAST_NOT_CURRENT' } }]);
});

test('schools to review do not promise a scoring effect and keep the stored CAN_HAVE value', () => {
  const chips = flow.buildChips(base({ school: [{ id: '100', name: 'École Alpha', priority: 'CAN_HAVE' }] }));
  assert.equal(chips.find(c => c.key === 'ecole').op, 'à examiner');
  const h = stateHarness('src/components/outreach/FilterComponents.tsx');
  const tree = h.render('PriorityBadges', { items: [{ id: '100', name: 'École Alpha', priority: 'CAN_HAVE' }], schoolContext: true, onRemove() {}, onUpdatePriority() {} });
  assert.match(text(tree), /À examiner/);
  assert.match(text(tree), /ajoutez-les aux critères du cadrage/);
  assert.equal(nodes(tree).find(n => n.type === 'Select').props.value, 'CAN_HAVE');
  assert.doesNotMatch(text(tree), /Préférence de notation/);
});

test('keyword editor retains a 330-character Recruiter query and warns before Classic/Sales submit', () => {
  for (const api of ['recruiter', 'classic', 'sales_navigator']) {
    let filters = base({ api });
    const h = stateHarness('src/components/outreach/search/SearchFiltersPanel.tsx');
    const props = () => ({ filters, setFilters: fn => { filters = fn(filters); }, accounts: [{ id: 'account-a' }], selectedAccount: 'account-a',
      onAccountChange() {}, selectedJob: { id: 'job-a' }, onJobChange() {}, onAutoFillFilters() {}, loading: false,
      needsReconnection: false, isApiModeAvailable: true, onSearch() {}, onClearFilters() {}, searchSource: 'linkedin' });
    let tree = h.render('SearchFiltersPanel', props());
    nodes(tree).find(n => n.type === 'Textarea' && n.props['aria-label'] === 'Requête de recherche').props.onChange({ target: { value: 'A'.repeat(330) } });
    tree = h.render('SearchFiltersPanel', props());
    const apply = nodes(tree).find(n => n.type === 'Button' && text(n) === 'Appliquer');
    assert.equal(apply.props.disabled, api !== 'recruiter');
    if (!apply.props.disabled) {
      apply.props.onClick();
      assert.equal(filters.keywords.length, 330);
      assert.match(text(tree), /conservée en entier/);
    } else {
      assert.match(text(tree), /330 caractères sur 200 pris en charge dans l'app/);
      assert.equal(filters.keywords, '');
    }
  }
});
