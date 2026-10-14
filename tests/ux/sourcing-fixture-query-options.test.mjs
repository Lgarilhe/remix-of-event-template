import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';
import { QueryClient } from '@tanstack/react-query';

const require = createRequire(import.meta.url);
const compile = source => transformSync(source, { loader: 'tsx', format: 'cjs' }).code;
function contracts() {
  const state = { qaProjects: {}, qaState: {}, qaWrites: [] };
  const mockModule = { exports: {} };
  new Function('require', 'module', 'exports', 'window', compile(readFileSync('e2e/fixtures/sourcing-return/mocks.tsx', 'utf8')))(require, mockModule, mockModule.exports, state);
  const source = readFileSync('src/hooks/useSourcingProjects.ts', 'utf8');
  const start = source.indexOf('export function sourcingProjectQueryOptions(');
  const end = source.indexOf('// Hook to get a single project', start);
  const realModule = { exports: {} };
  new Function('module', 'exports', 'supabase', compile(source.slice(start, end)))(realModule, realModule.exports, mockModule.exports.supabase);
  return { state, mock: mockModule.exports.sourcingProjectQueryOptions, real: realModule.exports.sourcingProjectQueryOptions };
}

test('fixture and production share query identity and cache lifetimes', () => {
  const { mock, real } = contracts();
  for (const id of ['', 'mission-a', 'search-guided']) {
    const { queryFn: _mockFn, ...mockOptions } = mock(id, 'user-a');
    const { queryFn: _realFn, ...realOptions } = real(id, 'user-a');
    assert.deepEqual(mockOptions, realOptions);
  }
});

test('fixture preserves empty ID, unauthenticated and missing-project semantics', async () => {
  const { mock, real } = contracts();
  for (const options of [mock, real]) {
    assert.equal(await options('', null).queryFn(), null);
    await assert.rejects(options('mission-a', null).queryFn(), /Not authenticated/);
    assert.equal(await options('missing', 'user-a').queryFn(), null);
  }
});

test('query reads current fixture data, including complete brief and saved filters', async () => {
  const { state, mock, real } = contracts();
  const options = [mock('mission-a', 'user-a'), real('mission-a', 'user-a')];
  state.qaProjects['mission-a'] = { id: 'mission-a', job_details: { title: 'DevOps' }, filters_snapshot: { keywords: 'Python' } };
  for (const query of options) assert.deepEqual(await query.queryFn(), state.qaProjects['mission-a']);
  state.qaProjects['mission-a'] = { ...state.qaProjects['mission-a'], filters_snapshot: { keywords: 'Rust' } };
  for (const query of options) assert.deepEqual(await query.queryFn(), state.qaProjects['mission-a']);
});

test('React Query reuses the fixture key and rereads state after invalidation', async () => {
  const { state, mock } = contracts();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    state.qaProjects['mission-a'] = { id: 'mission-a', name: 'Before' };
    const options = mock('mission-a', 'user-a');
    assert.equal((await client.fetchQuery(options)).name, 'Before');
    state.qaProjects['mission-a'] = { id: 'mission-a', name: 'After' };
    assert.equal((await client.fetchQuery(options)).name, 'Before');
    await client.invalidateQueries({ queryKey: ['sourcing-project', 'mission-a'] });
    assert.equal((await client.fetchQuery(options)).name, 'After');
  } finally { client.clear(); }
});
