import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Run the real tool with in-memory DB/HTTP doubles; no service is reachable.
const source = readFileSync(new URL('../../supabase/functions/_shared/agent-tools-mutations.ts', import.meta.url), 'utf8');
const start = source.indexOf('const regenerateSearchFilters: AgentTool = {');
const end = source.indexOf('// ─── Tool 13', start);
assert.ok(start >= 0 && end > start, 'regenerate_search_filters tool exists');
const compiled = ts.transpileModule(source.slice(start, end) + '\nexports.tool = regenerateSearchFilters;', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'regenerate-search-filters.ts', reportDiagnostics: true,
});
assert.equal(compiled.diagnostics?.length ?? 0, 0);

const missionId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const initialUpdatedAt = '2026-10-07T18:00:00.123456+00:00';
const plain = value => JSON.parse(JSON.stringify(value));
const memoryContext = { fingerprint: 'confirmed-rules', versionKey: 'current-rules', effect: 'search', provenance: [] };
const generated = { success: true, filters: { keywords: 'Python', role: [{ keywords: 'Data Engineer', priority: 'MUST_HAVE', scope: 'CURRENT' }] },
  suggestions: { alt_skills: ['Spark'] }, memory_context: memoryContext };

function harness(project, { response = generated, status = 200, fetchError = null, onGenerate } = {}) {
  const storedProject = project ? { updated_at: initialUpdatedAt, organization_id: organizationId, ...plain(project) } : null;
  const calls = { reads: [], requests: [], updates: [], saved: [] };
  const adminClient = {
    from(table) {
      assert.equal(table, 'sourcing_projects');
      let operation;
      const query = {
        select(fields) {
          if (operation?.value) operation.returning = fields;
          else { operation = { fields, filters: {} }; calls.reads.push(operation); }
          return query;
        },
        update(value) { operation = { value: plain(value), filters: {} }; calls.updates.push(operation); return query; },
        eq(column, value) { operation.filters[column] = value; return query; },
        single: async () => ({ data: plain(storedProject), error: fetchError }),
        maybeSingle: async () => {
          const matches = storedProject && Object.entries(operation.filters).every(([key, value]) => storedProject[key] === value);
          if (!matches) return { data: null, error: null };
          Object.assign(storedProject, plain(operation.value));
          calls.saved.push(plain(operation));
          return { data: { id: storedProject.id }, error: null };
        },
      };
      return query;
    },
  };
  const context = {
    exports: {},
    Deno: { env: { get: name => ({ SUPABASE_URL: 'http://local.test', SB_SECRET_KEY: 'fake-service-key' })[name] } },
    fetch: async (url, options) => {
      assert.equal(url, 'http://local.test/functions/v1/generate-search-filters');
      calls.requests.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      onGenerate?.(storedProject);
      return new Response(JSON.stringify(response), { status });
    },
    Response,
  };
  vm.runInNewContext(compiled.outputText, context, { filename: 'regenerate-search-filters.ts' });
  return { calls, storedProject, execute: () => context.exports.tool.execute({ job_id: missionId }, { adminClient, organizationId, userId }) };
}

test('regeneration sends the complete mission brief, distinct criterion levels and trusted memory context', async () => {
  const criteria = {
    contract_type: 'cdi', remote_days: 0, salary_min: 65000, salary_max: 80000, salary_currency: 'EUR', salary_type: 'annual',
    skills_to_avoid: ['COBOL'], languages: [{ language: 'Français', level: 'courant' }], certifications: ['AWS souhaitée'],
    target_companies: [{ category: 'SaaS souhaité', companies: [{ name: 'Acme' }] }],
    calibration_profiles: [{ name: 'Profil repère', why_good_fit: ['Data B2B'] }],
    evaluation_criteria: [{ id: 'criterion-a', label: 'SQL', weight: 3, deal_breaker: true }],
    evaluation_weights: { technical: 60, experience: 40 },
    pedigree_requirements: { topSchool: false }, restrict_search_to_competitors: false,
  };
  const h = harness({ id: missionId, name: 'Nom de mission', job_title: 'Ancien titre', client_name: 'Ancien client',
    description: 'Texte libre de la mission.',
    job_details: { ...criteria, title: 'Data Engineer', client: { name: 'Client confirmé', sector: 'SaaS' }, remote_policy: 'full_remote',
      mission_description: 'Développer la plateforme.', context: 'Équipe B2B.', raw_brief: 'Brief initial : pas de profils COBOL.',
      voice_transcript: 'Le recruteur confirme Python obligatoire, Spark souhaité.',
      skills_must_have: [' Python ', 'SQL'], skills_should_have: ['Spark'], skills_nice_to_have: ['Rust'],
      experience_min: 0, experience_max: 5, location: 'France', seniority: 'confirmé' } });
  const result = await h.execute();
  assert.equal(result.success, true);
  assert.equal(h.calls.requests.length, 1);
  const request = h.calls.requests[0];
  assert.equal(request.headers.Authorization, 'Bearer fake-service-key');
  assert.equal(request.body.organization_id, organizationId);
  assert.equal(request.body.project_id, missionId);
  assert.equal(request.body.user_id_override, userId);
  const job = request.body.job;
  assert.equal(job.id, 'project:' + missionId);
  assert.equal(job.title, 'Data Engineer');
  assert.deepEqual(job.client, { name: 'Client confirmé', sector: 'SaaS' });
  assert.equal(job.remotePolicy, 'full_remote');
  for (const text of ['Développer la plateforme.', 'Équipe B2B.', 'Brief initial : pas de profils COBOL.',
    'Le recruteur confirme Python obligatoire, Spark souhaité.', 'Texte libre de la mission.']) assert.ok(job.description.includes(text), text);
  assert.deepEqual(job.skills, ['Python', 'SQL']);
  assert.equal(job.mustHave, 'Python, SQL');
  assert.equal(job.shouldHave, 'Spark');
  assert.equal(job.niceToHave, 'Rust');
  assert.equal(job.xpMin, 0);
  assert.equal(job.xpMax, 5);
  assert.equal(job.location, 'France');
  const serializedCriteria = JSON.parse(job.sourcingCriteria.slice(job.sourcingCriteria.indexOf('\n') + 1));
  assert.deepEqual(serializedCriteria, criteria);
  assert.deepEqual(h.calls.reads[0].filters, { id: missionId, organization_id: organizationId });
  assert.ok(h.calls.reads[0].fields.includes('client_name'));
  assert.ok(h.calls.reads[0].fields.includes('description'));
  assert.ok(h.calls.reads[0].fields.includes('updated_at'));
  assert.equal(h.calls.updates.length, 1);
  assert.deepEqual(h.calls.updates[0].filters, { id: missionId, organization_id: organizationId, updated_at: initialUpdatedAt });
  assert.equal(h.calls.saved.length, 1);
  const saved = h.calls.updates[0].value.filters_snapshot;
  assert.deepEqual(saved.keywords, generated.filters.keywords);
  assert.deepEqual(saved.role, generated.filters.role);
  assert.deepEqual(saved.suggestions, generated.suggestions);
  assert.deepEqual(saved.memory_context, memoryContext);
  assert.equal(typeof saved.generated_at, 'string');
  assert.equal(saved.filters, undefined, 'snapshot stays in the existing flattened format');
});

test('a sparse legacy mission retains its description and client without promoting desired skills', async () => {
  const h = harness({ id: missionId, name: 'Mission', job_title: 'Legacy Engineer', client_name: 'Client historique',
    description: 'Brief libre conservé.', job_details: { skills_should_have: ['Go'], skills_nice_to_have: ['Rust'] } });
  assert.equal((await h.execute()).success, true);
  const job = h.calls.requests[0].body.job;
  assert.equal(job.title, 'Legacy Engineer');
  assert.equal(job.description, 'Brief libre conservé.');
  assert.deepEqual(job.client, { name: 'Client historique' });
  assert.deepEqual(job.skills, []);
  assert.equal(job.mustHave, '');
  assert.equal(job.shouldHave, 'Go');
  assert.equal(job.niceToHave, 'Rust');
});

test('an incomplete analysis or a memory conflict never replaces the existing filters', async () => {
  for (const settings of [
    { response: { ...generated, degraded: true } },
    { response: { success: true } },
    { response: { success: false, error: 'Clarifier une règle confirmée.', code: 'MEMORY_CONFLICT' }, status: 409 },
  ]) {
    const h = harness({ id: missionId, name: 'Mission', job_details: {} }, settings);
    assert.equal((await h.execute()).success, false);
    assert.equal(h.calls.updates.length, 0);
  }
});

test('a mission load failure stops before any generation or snapshot write', async () => {
  const h = harness(null, { fetchError: { message: 'Mission indisponible' } });
  assert.deepEqual(plain(await h.execute()), { success: false, error: 'Mission indisponible' });
  assert.equal(h.calls.requests.length, 0);
  assert.equal(h.calls.updates.length, 0);
});

test('concurrent brief or filter changes survive a long generation and return an actionable refusal', async () => {
  for (const change of [
    { job_details: { title: 'Nouveau brief', skills_must_have: ['Go'] } },
    { filters_snapshot: { keywords: 'Filtre édité manuellement' } },
  ]) {
    const project = { id: missionId, name: 'Mission', job_details: { title: 'Brief initial' },
      filters_snapshot: { keywords: 'Filtres initiaux' } };
    const h = harness(project, { onGenerate(current) {
      Object.assign(current, plain(change), { updated_at: '2026-10-07T18:01:00.000001+00:00' });
    } });
    const result = await h.execute();
    assert.equal(result.success, false);
    assert.match(result.error, /modifiés pendant la génération/);
    assert.match(result.error, /conservés.*Relance/);
    assert.equal(h.calls.requests[0].body.job.title, 'Brief initial');
    assert.equal(h.calls.saved.length, 0, 'conditional UPDATE matches no stale version');
    assert.deepEqual(h.storedProject.job_details, change.job_details ?? project.job_details);
    assert.deepEqual(h.storedProject.filters_snapshot, change.filters_snapshot ?? project.filters_snapshot);
  }
});

test('a missing mission version blocks before paid generation', async () => {
  const h = harness({ id: missionId, name: 'Mission', job_details: {}, updated_at: null });
  assert.equal((await h.execute()).success, false);
  assert.equal(h.calls.requests.length, 0);
  assert.equal(h.calls.saved.length, 0);
});
