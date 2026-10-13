import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { outputFiles } = await build({
  entryPoints: [path.join(root, 'src/hooks/useInboxCandidateRecord.ts')],
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'record-services', setup(b) {
    const stubs = {
      '@tanstack/react-query': 'export const useQuery = options => { globalThis.recordOptions = options; return { queryKey: options.queryKey }; }; export const useMutation = () => ({}); export const useQueryClient = () => ({});',
      '@/hooks/useAuthReady': 'export const useAuthReady = () => ({ user: globalThis.recordUser ? {id:globalThis.recordUser} : null, isReady:globalThis.recordReady });',
      '@/hooks/useOrganization': 'export const useOrganization = () => ({organizationId:globalThis.recordOrg});',
      '@/integrations/supabase/client': 'export const supabase = {from: table => globalThis.recordQuery(table)};',
    };
    b.onResolve({ filter: /.*/ }, ({ path: name }) => {
      if (name in stubs) return { path: name, namespace: 'stub' };
      if (name.startsWith('@/')) {
        const base = path.join(root, 'src', name.slice(2));
        return { path: [base + '.ts', base + '.tsx'].find(existsSync) };
      }
    });
    b.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path: name }) => ({ contents: stubs[name], loader: 'js' }));
  } }],
});
const records = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const input = values => ({ chatId: 'chat-a', profileId: 'ACo-candidate', name: 'Camille', ...values });
const row = values => ({
  id: 'row-a', organization_id: 'org-a', candidate_id: 'ACo-candidate', candidate_name: 'Camille',
  candidate_headline: 'Ingénieure', linkedin_profile_url: 'https://linkedin.com/in/camille',
  linkedin_profile_data: { summary: 'Profil enregistré' }, project_id: 'project-a', job_id: 'project:project-a',
  mission_name: 'Mission A', general_stage: 'sourced', process_step_id: null, stage_entered_at: null,
  status: 'shortlisted', pipeline_stage: null, score: 82, recommendation: 'yes', tags: ['Cloud'],
  updated_at: '2026-10-13T12:00:00Z', created_at: '2026-10-01T12:00:00Z', scoring_details: null,
  contacted_at: null, replied_at: null, first_interview_at: null, hired_at: null, rejected_from_stage: null,
  is_unopened: false, group_ids: ['row-a', 'row-alias'], picture: 'photo.svg', picture_large: null,
  ...values,
});

let requests;
function fixture(rows = [], options = {}) {
  requests = [];
  globalThis.recordQuery = table => {
    const operations = [];
    const query = { then(resolve, reject) {
      requests.push({ table, operations });
      if (options.error) return Promise.resolve({ data: null, error: options.error }).then(resolve, reject);
      let received = [...rows];
      if (!options.unfiltered) {
        for (const [method, args] of operations) {
          if (method === 'eq') received = received.filter(row => row[args[0]] === args[1]);
          if (method === 'in') received = received.filter(row => args[1].includes(row[args[0]]));
          // ILIKE is a broad SQL prefilter; exact URL verification belongs to the resolver.
          if (method === 'ilike') received = received.filter(row => row.linkedin_profile_url);
        }
      }
      const range = operations.find(([method]) => method === 'range')?.[1];
      if (range) received = received.slice(range[0], range[1] + 1);
      const response = { data: received, error: null };
      return options.defer ? options.defer(response).then(resolve, reject) : Promise.resolve(response).then(resolve, reject);
    } };
    for (const method of ['select', 'eq', 'in', 'ilike', 'order', 'range']) query[method] = (...args) => { operations.push([method, args]); return query; };
    return query;
  };
}

test('Un identifiant exact retrouve la ligne canonique et le même candidat que le pipeline', async () => {
  fixture([row(), row({ id: 'other', candidate_id: 'other-person', candidate_name: 'Camille' })]);
  const result = await records.fetchInboxCandidateRecord('org-a', input());
  assert.equal(result.pipelineAttached, true);
  assert.equal(result.requiresChoice, false);
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.id, 'local-row-a');
  assert.equal(candidate.sourceId, 'row-a');
  assert.equal(candidate.candidateId, 'ACo-candidate');
  assert.equal(candidate.projectId, 'project-a');
  assert.equal(candidate.jobTitle, 'Mission A');
  assert.equal(candidate.score, 82);
  assert.deepEqual(candidate.groupIds, ['row-a', 'row-alias']);
  assert.deepEqual(candidate.linkedinProfileData, { summary: 'Profil enregistré' });
  assert.ok(requests.every(request => request.table === 'mission_candidate_rows'));
  assert.ok(requests.every(request => request.operations.some(([method, args]) => method === 'eq' && args[0] === 'organization_id' && args[1] === 'org-a')));
  assert.ok(requests.every(request => !request.operations.some(([, args]) => args[0] === 'candidate_name')));
});

test('Les alias et identifiants canoniques sont lus directement, sans recherche par nom ni filtre SQL assemblé', async () => {
  fixture([row({ candidate_id: 'known-person' }), row({ id: 'alias-row', candidate_id: 'AEM-recruiter', project_id: 'project-b' })]);
  const result = await records.fetchInboxCandidateRecord('org-a', input({ candidateId: 'known-person', aliases: ['AEM-recruiter', 'known-person'] }));
  assert.equal(result.candidates.length, 2);
  assert.equal(result.requiresChoice, true);
  assert.deepEqual(requests[0].operations.find(([method]) => method === 'in')[1], ['candidate_id', ['known-person', 'ACo-candidate', 'AEM-recruiter']]);
});

test('Une URL LinkedIn rapproche le slug exact, jamais un suffixe voisin, un homonyme ou un domaine trompeur', async () => {
  fixture([
    row(),
    row({ id: 'neighbor', candidate_id: 'other', linkedin_profile_url: 'https://linkedin.com/in/camille-junior' }),
    row({ id: 'evil', candidate_id: 'other', linkedin_profile_url: 'https://evil-linkedin.com/in/camille' }),
    row({ id: 'homonym', candidate_id: 'other', linkedin_profile_url: 'https://linkedin.com/in/another' }),
  ], { unfiltered: true });
  const result = await records.fetchInboxCandidateRecord('org-a', input({ profileId: null, profileUrl: 'https://fr.linkedin.com/in/Camille/?trk=inbox' }));
  assert.deepEqual(result.candidates.map(candidate => candidate.sourceId), ['row-a']);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].operations.find(([method]) => method === 'ilike')[1][0], 'linkedin_profile_url');
});

test('Les caractères de joker du slug sont échappés, puis la personne reste comparée exactement', async () => {
  fixture([row({ linkedin_profile_url: 'https://linkedin.com/in/camille_durand' }), row({ id: 'wildcard-neighbor', candidate_id: 'other', linkedin_profile_url: 'https://linkedin.com/in/camille-durand' })], { unfiltered: true });
  const result = await records.fetchInboxCandidateRecord('org-a', input({ profileId: null, profileUrl: 'https://linkedin.com/in/camille_durand' }));
  assert.equal(result.candidates.length, 1);
  assert.equal(requests[0].operations.find(([method]) => method === 'ilike')[1][1], '%/in/camille\\_durand%');
});

test('Les mêmes lignes trouvées par identifiant et par URL ne créent pas de choix artificiel', async () => {
  fixture([row()]);
  const result = await records.fetchInboxCandidateRecord('org-a', input({ profileUrl: 'https://linkedin.com/in/camille' }));
  assert.equal(requests.length, 2);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.requiresChoice, false);
});

test('Une mission confirmée sélectionne uniquement sa candidature visible', async () => {
  fixture([row(), row({ id: 'row-b', project_id: 'project-b', mission_name: 'Mission B' })]);
  const result = await records.fetchInboxCandidateRecord('org-a', input({ projectId: 'project-b' }));
  assert.deepEqual(result.candidates.map(candidate => candidate.projectId), ['project-b']);
  assert.equal(result.requiresChoice, false);
});

test('Plusieurs missions et une mission confirmée absente demandent un choix explicite', async () => {
  fixture([row(), row({ id: 'row-b', project_id: 'project-b' })]);
  const multiple = await records.fetchInboxCandidateRecord('org-a', input());
  assert.equal(multiple.candidates.length, 2);
  assert.equal(multiple.requiresChoice, true);
  fixture([row()]);
  const missing = await records.fetchInboxCandidateRecord('org-a', input({ projectId: 'missing-project' }));
  assert.equal(missing.pipelineAttached, true);
  assert.equal(missing.requiresChoice, true);
  assert.equal(missing.candidates[0].projectId, 'project-a');
});

test('Une personne inconnue garde une identité temporaire sans ligne ni mission inventée', async () => {
  fixture();
  const result = await records.fetchInboxCandidateRecord('org-a', input({ projectId: 'project-a', headline: 'Ingénieure', photo: 'photo.svg', profileUrl: 'https://linkedin.com/in/camille' }));
  assert.equal(result.pipelineAttached, false);
  assert.equal(result.requiresChoice, false);
  const candidate = result.candidates[0];
  assert.equal(candidate.id, 'inbox:chat-a');
  assert.equal(candidate.candidateId, 'ACo-candidate');
  assert.equal(candidate.headline, 'Ingénieure');
  assert.equal(candidate.pictureUrl, 'photo.svg');
  assert.equal(candidate.linkedin, 'https://linkedin.com/in/camille');
  assert.equal(candidate.projectId, null);
  assert.equal(candidate.jobId, null);
  assert.equal(candidate.linkedinProfileData, null);
  assert.ok(requests.every(request => request.operations.every(([method]) => !['insert', 'update', 'upsert', 'delete'].includes(method))));
});

test('Sans identifiant ou URL valide, aucune lecture globale des candidats ne part', async () => {
  fixture([row()]);
  const result = await records.fetchInboxCandidateRecord('org-a', input({ profileId: null, profileUrl: 'https://evil-linkedin.com/in/camille' }));
  assert.equal(requests.length, 0);
  assert.equal(result.pipelineAttached, false);
  assert.equal(result.candidates[0].linkedin, null);
  assert.equal(records.buildTransientInboxCandidate(input({ profileId: null, profileUrl: 'https://linkedin.com/in/camille' })).candidateId, 'camille');
});

test('Les lignes d’une autre organisation ou sans identité exacte restent exclues même si une réponse les contient', async () => {
  fixture([row({ organization_id: 'org-b' }), row({ id: 'wrong-id', candidate_id: 'other' })], { unfiltered: true });
  const result = await records.fetchInboxCandidateRecord('org-a', input());
  assert.equal(result.pipelineAttached, false);
  assert.equal(result.candidates[0].candidateId, 'ACo-candidate');
});

test('Une lecture refusée ou interrompue ne devient jamais un prospect inconnu', async () => {
  fixture([], { error: { message: 'PostgREST secret diagnostic' } });
  await assert.rejects(() => records.fetchInboxCandidateRecord('org-a', input()), error => {
    assert.equal(error.name, 'InboxCandidateRecordError');
    assert.doesNotMatch(error.message, /PostgREST|secret/);
    assert.match(error.message, /fiche.*candidat/);
    return true;
  });
  await assert.rejects(() => records.fetchInboxCandidateRecord('', input()), /fiche.*candidat/);
});

test('Toutes les candidatures de la personne sont lues au-delà de la première page', async () => {
  fixture(Array.from({ length: 51 }, (_, index) => row({ id: `row-${index}`, project_id: `project-${index}` })));
  const result = await records.fetchInboxCandidateRecord('org-a', input());
  assert.equal(result.candidates.length, 51);
  assert.equal(result.requiresChoice, true);
  assert.deepEqual(requests.map(request => request.operations.find(([method]) => method === 'range')[1]), [[0, 49], [50, 99]]);
});

test('Une limite de lecture dépassée remonte une erreur au lieu de choisir une liste partielle', async () => {
  fixture(Array.from({ length: 1000 }, (_, index) => row({ id: `row-${index}`, project_id: `project-${index}` })));
  await assert.rejects(() => records.fetchInboxCandidateRecord('org-a', input()), /fiche.*candidat/);
  assert.equal(requests.length, 20);
});

test('Le cache suit utilisateur, organisation, personne, conversation et mission, et attend une session prête', () => {
  globalThis.recordUser = 'user-a'; globalThis.recordOrg = 'org-a'; globalThis.recordReady = true;
  const capture = values => { records.useInboxCandidateRecord(input(values)); return globalThis.recordOptions; };
  const initial = capture();
  assert.equal(initial.enabled, true);
  for (const values of [{ profileId: 'other' }, { chatId: 'other-chat' }, { projectId: 'project-b' }, { aliases: ['AEM-alias'] }]) assert.notDeepEqual(capture(values).queryKey, initial.queryKey);
  assert.notDeepEqual(capture({ profileId: 'a|b' }).queryKey, capture({ profileId: 'a', aliases: ['b'] }).queryKey);
  globalThis.recordOrg = 'org-b'; assert.notDeepEqual(capture().queryKey, initial.queryKey);
  globalThis.recordOrg = 'org-a'; globalThis.recordUser = 'user-b'; assert.notDeepEqual(capture().queryKey, initial.queryKey);
  globalThis.recordUser = null; assert.equal(capture().enabled, false);
  globalThis.recordUser = 'user-a'; globalThis.recordReady = false; assert.equal(capture().enabled, false);
});

test('Une résolution tardive conserve son entrée et son organisation malgré une nouvelle conversation', async () => {
  globalThis.recordUser = 'user-a'; globalThis.recordOrg = 'org-a'; globalThis.recordReady = true;
  let resolve;
  let started;
  const requestStarted = new Promise(done => { started = done; });
  fixture([row()], { defer: response => new Promise(done => { resolve = () => done(response); started(); }) });
  const originalInput = input({ aliases: ['AEM-old'] });
  records.useInboxCandidateRecord(originalInput);
  const original = globalThis.recordOptions;
  const pending = original.queryFn();
  await requestStarted;
  originalInput.aliases.push('injected-later');
  globalThis.recordOrg = 'org-b';
  records.useInboxCandidateRecord(input({ profileId: 'other', chatId: 'chat-b' }));
  resolve();
  const result = await pending;
  assert.equal(result.candidates[0].sourceId, 'row-a');
  assert.equal(original.queryKey[2], 'org-a');
  assert.equal(globalThis.recordOptions.queryKey[2], 'org-b');
  assert.deepEqual(requests[0].operations.find(([method]) => method === 'in')[1][1], ['ACo-candidate', 'AEM-old']);
});
