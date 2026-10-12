import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const source = readFileSync(new URL('src/hooks/useFilteredLinkedInAccounts.ts', root), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Run the complete production hook. Only its context boundaries and React's
// render/effect scheduler are replaced; selection and permission logic are real.
function scheduler() {
  const slots = [], effects = [];
  let index = 0, dirty = false;
  const changed = (previous, next) => !previous || !next || previous.length !== next.length
    || previous.some((value, i) => !Object.is(value, next[i]));
  const memo = (factory, deps) => {
    const i = index++;
    if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { deps, value: factory() };
    return slots[i].value;
  };
  const hooks = {
    useState(initial) {
      const i = index++;
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, value => {
        const next = typeof value === 'function' ? value(slots[i].value) : value;
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; }
      }];
    },
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useEffect(callback, deps) {
      const i = index++;
      if (!slots[i]) slots[i] = {};
      if (changed(slots[i].deps, deps)) effects.push({ slot: slots[i], callback, deps });
    },
  };
  return {
    hooks,
    render(callback) {
      let count = 0;
      do {
        assert.ok(++count < 30, 'account selection did not settle');
        dirty = false; index = 0; callback();
        for (const { slot, callback: effect, deps } of effects.splice(0)) {
          slot.cleanup?.(); slot.deps = deps; slot.cleanup = effect();
        }
      } while (dirty);
    },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

function harness() {
  let react, hook, options = { selectionScope: 'search-a' };
  let context = {
    accounts: [{ id: 'own', status: 'OK' }, { id: 'other', status: 'OK' }],
    accountsLoading: false,
    organization: { organizationId: 'org-a', isAdmin: true, isOwner: true, isCollaborator: false, isLoading: false },
    auth: { isReady: true, user: { id: 'user-a' } },
    mappingsReady: true, mappingsFailed: false, mappingsLoading: false,
    links: { 'user-a': 'own' },
  };
  const services = {
    react: new Proxy({}, { get: (_target, name) => (...args) => react.hooks[name](...args) }),
    '@/components/outreach/LinkedInAccountManager': { applySubscriptionOverrides: account => account },
    '@/contexts/LinkedInAccountsContext': { useLinkedInAccounts: () => ({ accounts: context.accounts, loading: context.accountsLoading }) },
    '@/hooks/useOrganization': { useOrganization: () => context.organization },
    '@/hooks/useAuthReady': { useAuthReady: () => context.auth },
    '@/hooks/useMemberLinkedInAccounts': { useMemberLinkedInAccounts: () => ({
      getUserLinkedAccountId: userId => context.links[userId] ?? null,
      isLoading: context.mappingsLoading, isReady: context.mappingsReady, isError: context.mappingsFailed,
    }) },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => {
    assert.ok(Object.hasOwn(services, name), `unexpected boundary ${name}`);
    return services[name];
  } }, { filename: 'useFilteredLinkedInAccounts.ts' });
  const render = () => react.render(() => { hook = exports.useFilteredLinkedInAccounts(options); });
  const mount = () => { react = scheduler(); render(); };
  mount();
  return {
    get hook() { return hook; },
    render,
    change(patch) { context = { ...context, ...patch }; render(); },
    scope(selectionScope) { options = selectionScope === undefined ? undefined : { selectionScope }; render(); },
    choose(id) { hook.setSelectedAccount(id); render(); },
    remount() { react.unmount(); mount(); },
    unmount() { react.unmount(); },
  };
}

test('sourcing resumes a permitted chosen account after unmount while other callers keep their own account default', () => {
  const h = harness();
  assert.equal(h.hook.selectedAccount, 'own');
  h.choose('other');
  h.remount();
  assert.equal(h.hook.selectedAccount, 'other');
  h.scope(undefined); h.remount();
  assert.equal(h.hook.selectedAccount, 'own', 'the sending-account callers do not opt into sourcing preferences');
  h.scope('search-a'); h.remount();
  assert.equal(h.hook.selectedAccount, 'other');
});

test('switching searches never records the previous selection under the new search or lets an old callback change it', () => {
  const h = harness();
  h.choose('other');
  const previousSearchSetter = h.hook.setSelectedAccount;
  h.scope('search-b');
  assert.equal(h.hook.selectedAccount, 'own');
  previousSearchSetter('other'); h.render();
  assert.equal(h.hook.selectedAccount, 'own');
  h.remount();
  assert.equal(h.hook.selectedAccount, 'own');
  h.scope('search-a');
  assert.equal(h.hook.selectedAccount, 'other');
});

test('user and organization selections are isolated and late callbacks cannot contaminate another context', () => {
  const h = harness();
  h.choose('other');
  const oldSetter = h.hook.setSelectedAccount;
  h.change({ organization: { organizationId: 'org-b', isAdmin: true, isOwner: true, isCollaborator: false, isLoading: false } });
  assert.equal(h.hook.selectedAccount, 'own');
  oldSetter('other'); h.render();
  assert.equal(h.hook.selectedAccount, 'own');
  h.change({ organization: { organizationId: 'org-a', isAdmin: true, isOwner: true, isCollaborator: false, isLoading: false } });
  assert.equal(h.hook.selectedAccount, 'other');
  h.change({ auth: { isReady: true, user: { id: 'user-b' } }, links: { 'user-a': 'own', 'user-b': 'own' } });
  assert.equal(h.hook.selectedAccount, 'own');
  h.remount();
  assert.equal(h.hook.selectedAccount, 'own');
  h.change({ auth: { isReady: true, user: { id: 'user-a' } } });
  assert.equal(h.hook.selectedAccount, 'other');
});

test('a remembered account removed from the current list is forgotten, including after a remount', () => {
  const h = harness();
  h.choose('other');
  h.change({ accounts: [{ id: 'own', status: 'OK' }] });
  assert.equal(h.hook.selectedAccount, 'own');
  h.remount();
  assert.equal(h.hook.selectedAccount, 'own');
  h.change({ accounts: [{ id: 'own', status: 'OK' }, { id: 'other', status: 'OK' }] });
  h.remount();
  assert.equal(h.hook.selectedAccount, 'own', 'a removed account must not be restored merely because it returns');
});

for (const role of ['member', 'collaborator']) test(`${role} cannot restore or select a colleague's account after permissions change`, () => {
  const h = harness();
  h.choose('other');
  h.change({ organization: { organizationId: 'org-a', isAdmin: false, isOwner: false, isCollaborator: role === 'collaborator', isLoading: false } });
  assert.deepEqual(Array.from(h.hook.accounts, account => account.id), ['own']);
  assert.equal(h.hook.selectedAccount, 'own');
  h.choose('other');
  assert.equal(h.hook.selectedAccount, 'own');
  h.remount();
  assert.equal(h.hook.selectedAccount, 'own');
  h.change({ links: {} });
  assert.equal(h.hook.accounts.length, 0);
  assert.equal(h.hook.selectedAccount, null);
});

test('late member links and account lists do not replace or erase the remembered sourcing account', () => {
  const h = harness();
  h.choose('other');
  h.change({ accounts: [], accountsLoading: true, mappingsReady: false, mappingsLoading: true, links: {} });
  h.remount();
  assert.equal(h.hook.accountsLoading, true);
  assert.equal(h.hook.selectedAccount, null);
  h.change({ accounts: [{ id: 'own', status: 'OK' }, { id: 'other', status: 'OK' }], accountsLoading: false });
  assert.equal(h.hook.accountsLoading, true);
  assert.equal(h.hook.selectedAccount, null);
  h.change({ mappingsReady: true, mappingsLoading: false, links: { 'user-a': 'own' } });
  assert.equal(h.hook.accountsLoading, false);
  assert.equal(h.hook.selectedAccount, 'other');
});

test('organization and authentication hydration must finish before a remembered account is exposed', () => {
  const h = harness();
  h.choose('other');
  h.change({ organization: { organizationId: 'org-a', isAdmin: false, isOwner: false, isCollaborator: false, isLoading: true } });
  h.remount();
  assert.equal(h.hook.accountsLoading, true);
  assert.equal(h.hook.selectedAccount, null);
  h.change({ organization: { organizationId: 'org-a', isAdmin: true, isOwner: true, isCollaborator: false, isLoading: false }, auth: { isReady: false, user: { id: 'user-a' } } });
  assert.equal(h.hook.selectedAccount, null);
  h.change({ auth: { isReady: true, user: { id: 'user-a' } } });
  assert.equal(h.hook.selectedAccount, 'other');
});

test('a disconnected chosen account remains selected to show its reconnection state', () => {
  const h = harness();
  h.choose('other');
  h.change({ accounts: [{ id: 'own', status: 'OK' }, { id: 'other', status: 'CREDENTIALS' }] });
  h.remount();
  assert.equal(h.hook.selectedAccount, 'other');
});

test('functional setters retain their existing API and cannot bypass the allowed account list', () => {
  const h = harness();
  h.hook.setSelectedAccount(() => 'other');
  h.hook.setSelectedAccount(current => current === 'other' ? 'own' : 'other');
  h.render();
  assert.equal(h.hook.selectedAccount, 'own');
  h.hook.setSelectedAccount(() => 'unknown-account'); h.render();
  assert.equal(h.hook.selectedAccount, 'own');
});
