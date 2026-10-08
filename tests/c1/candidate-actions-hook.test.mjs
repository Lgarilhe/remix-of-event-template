import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Exécuter le vrai hook avec un ordonnanceur de hooks et un transport contrôlés
// permet de vérifier les appels payants sans requête de production.
const fixtures = {
  react: `const f=()=>globalThis.__candidateActionsHookTest;
    export function useRef(initial){const s=f(),i=s.cursor++;return s.slots[i]??=( {current:initial} );}
    export function useState(initial){const s=f(),i=s.cursor++;if(!(i in s.slots))s.slots[i]=initial;return [s.slots[i],v=>s.slots[i]=typeof v==='function'?v(s.slots[i]):v];}`,
  '@tanstack/react-query': `export function useQuery(options){const s=globalThis.__candidateActionsHookTest;s.queryOptions=options;return s.query;}
    export function useQueryClient(){return {setQueryData(key,value){const s=globalThis.__candidateActionsHookTest;s.query.data=typeof value==='function'?value(s.query.data):value;},invalidateQueries:async()=>{}};}`,
  '@/hooks/useAuthReady': `export const useAuthReady=()=>({user:{id:'user-a'},isReady:true});`,
  '@/hooks/useOrganization': `export const useOrganization=()=>({organizationId:'org-a'});`,
  '@/lib/invokeEdgeFunction': `export const invokeEdgeFunction=async(name,body)=>globalThis.__candidateActionsHookTest.request(name,body);`,
  '@/lib/invokeWithCredits': `export const invokeWithCredits=async(name,action,body)=>{
    const s=globalThis.__candidateActionsHookTest;s.creditCalls.push(action);return s.request(name,body);
  };`,
};
const bundled = await build({
  entryPoints: ['src/hooks/useCandidateActions.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  alias: { '@': process.cwd() + '/src' },
  plugins: [{ name: 'hook-fixtures', setup(build) {
    build.onResolve({ filter: /.*/ }, args => args.path in fixtures ? { path: args.path, namespace: 'fixture' } : undefined);
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: fixtures[args.path], loader: 'js' }));
  } }],
});
const { useCandidateActions } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const scope = { candidate_id: 'candidate-a', project_id: 'project-a' };
const payload = (plans = []) => ({ success: true, plans, channels: [{ service: 'gmail', address: 'recruiter@example.test' }], warnings: [], generation: { estimated: 4, model: 'fixture-model' } });
function setup(data) {
  const state = { cursor: 0, slots: [], calls: [], creditCalls: [], query: { data, isError: false, isLoading: false, isFetching: false }, respond: async () => ({ data: payload(), error: null }) };
  state.request = async (name, body) => { state.calls.push({ name, ...body }); return state.respond(body); };
  state.read = async () => {
    try { state.query.data = await state.queryOptions.queryFn(); state.query.isError = false; state.query.error = null; }
    catch (error) { state.query.isError = true; state.query.error = error; }
    return { ...state.query };
  };
  state.query.refetch = state.read;
  globalThis.__candidateActionsHookTest = state;
  state.render = () => { state.cursor = 0; return useCandidateActions(scope); };
  return state;
}

test('failed first read cannot start paid preparation and explicit read retry remains free', async () => {
  const state = setup();
  state.respond = async () => ({ data: { success: false, error: 'Les actions enregistrées sont momentanément indisponibles.' }, error: null });
  state.render(); await state.read();
  const failed = state.render();
  assert.equal(failed.contextLoaded, false);
  assert.equal(failed.readError, 'Les actions enregistrées sont momentanément indisponibles.');
  assert.equal(failed.operationError, null);
  assert.equal(await failed.generate(), null);
  assert.equal(state.creditCalls.length, 0);
  assert.equal(state.calls.some(call => call.action === 'generate'), false);
  state.respond = async () => ({ data: payload(), error: null });
  await failed.refresh();
  assert.equal(state.render().contextLoaded, true);
  assert.equal(state.creditCalls.length, 0);
  assert.deepEqual(state.calls.map(call => call.action), ['list', 'list']);
});

test('failed preparation keeps saved proposals and only an explicit retry makes one new paid call', async () => {
  const previous = { id: 'saved-plan', status: 'draft', effects: [{ status: 'prepared' }] };
  const state = setup(payload([previous]));
  let release;
  state.respond = async body => body.action === 'generate'
    ? new Promise(resolve => { release = () => resolve({ data: { success: false, error: 'La préparation n’a pas pu être lue. Réessayez.' }, error: null }); })
    : ({ data: payload([previous]), error: null });
  const first = state.render();
  const pending = first.generate();
  await first.generate(); // Une double activation ne lance pas une seconde requête.
  release(); await pending;
  const failed = state.render();
  assert.deepEqual(failed.operationError, { type: 'generate', message: 'La préparation n’a pas pu être lue. Réessayez.' });
  assert.equal(failed.readError, null);
  assert.deepEqual(failed.plans, [previous]);
  assert.equal(state.creditCalls.length, 1);
  assert.equal(state.calls.length, 1);
  await failed.refresh();
  assert.equal(state.creditCalls.length, 1);
  const readAgain = state.render();
  assert.equal(readAgain.operationError, null);
  state.respond = async () => ({ data: payload([previous]), error: null });
  await readAgain.generate();
  assert.deepEqual(state.creditCalls, ['candidate_actions', 'candidate_actions']);
  assert.deepEqual(state.calls.map(call => call.action), ['generate', 'list', 'generate']);
  assert.equal(state.calls.some(call => ['approve', 'execute_effect'].includes(call.action)), false);
});

test('a failed background read retains the last confirmed proposals and known channel context', async () => {
  const previous = { id: 'saved-plan', status: 'draft', effects: [{ status: 'prepared' }] };
  const state = setup(payload([previous]));
  state.respond = async () => ({ data: null, error: new Error('Connexion interrompue : réessayez la lecture.') });
  state.render(); await state.read();
  const stale = state.render();
  assert.equal(stale.contextLoaded, true);
  assert.deepEqual(stale.plans, [previous]);
  assert.equal(stale.channels[0].service, 'gmail');
  assert.equal(stale.readError, 'Connexion interrompue : réessayez la lecture.');
  assert.equal(stale.operationError, null);
  assert.equal(state.creditCalls.length, 0);
});
