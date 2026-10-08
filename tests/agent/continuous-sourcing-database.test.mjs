import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import test from 'node:test';

// Opt-in integration test, restricted to the Unix socket and a named local
// audit container. It clones the local schema and always drops its own DB.
// No remote credentials, LinkedIn, AI, or production data are used.
const container = process.env.CONTINUOUS_SOURCING_AUDIT_CONTAINER;
const dockerEnv = { ...process.env };
for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete dockerEnv[key];
const literal = (value) => "'" + String(value).replaceAll("'", "''") + "'";

function docker(command, source = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['--host=unix:///var/run/docker.sock', 'exec', '-i', '-e', 'PGPASSWORD=postgres',
      container, ...command],
    { env: dockerEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `psql exited ${code}`)));
    child.stdin.end(source);
  });
}
const sql = (database, source, user = 'postgres') => docker(['psql', '-h', '127.0.0.1', '-U', user, '-d', database,
  '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], source);

test('continuous sourcing SQL enforces scopes, calibration and concurrent leases/budgets/alias dedupe',
  { skip: !container && 'Set CONTINUOUS_SOURCING_AUDIT_CONTAINER to an isolated local audit container.' }, async (t) => {
    assert.match(container, /^konekt-[a-z0-9-]+-db$/, 'Only an explicitly named local audit container is accepted.');
    assert.equal(await sql('postgres', 'SHOW cron.launch_active_jobs;'), 'off', 'The audit cluster must have cron execution disabled.');
    const database = 'continuous_sourcing_test_' + process.pid;
    // A schema dump leaves the pg_cron/pg_net background sessions alone. Those
    // two extensions are deliberately omitted from the disposable database.
    const schema = (await docker(['pg_dump', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres',
      '--schema-only', '--exclude-schema=cron', '--exclude-schema=net']))
      .replace(/^CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net) .*;$/gm, '')
      .replace(/^COMMENT ON EXTENSION (pg_cron|pg_net) .*;$/gm, '')
      .replace(/^(GRANT|REVOKE) .* ON (SCHEMA (cron|net)|(?:FUNCTION|TABLE|SEQUENCE) (cron|net)\.).*;$/gm, '')
      .replace(/^(GRANT|REVOKE) .* ON FUNCTION graphql_public\.graphql\(.*;$/gm, '');
    const planSeed = await docker(['pg_dump', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres',
      '--data-only', '--no-owner', '--table=public.subscription_plans']);
    await sql('postgres', `CREATE DATABASE ${database} TEMPLATE template0;`);
    try {
      // Supabase extensions retain their original owners and ACLs. The local
      // bootstrap superuser restores them only inside this disposable database.
      await sql(database, schema, 'supabase_admin');
      await sql(database, planSeed);
      await t.test('transactional functional and authorization audit', async () => {
        const audit = readFileSync(new URL('../../supabase/tests/continuous_sourcing_agent_audit.sql', import.meta.url), 'utf8');
        await sql(database, audit);
      });
      const actor = randomUUID(); const organization = randomUUID(); const project = randomUUID();
      const configured = await sql(database, `
        INSERT INTO auth.users(id,email,aud,role,instance_id,raw_user_meta_data)
          VALUES(${literal(actor)},'concurrency@continuous-local.test','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}');
        INSERT INTO public.organizations(id,name,slug,created_by,org_type)
          VALUES(${literal(organization)},'Concurrent SQL audit',${literal('cs-' + organization)},${literal(actor)},'agency');
        INSERT INTO public.profiles(user_id,active_organization_id) VALUES(${literal(actor)},${literal(organization)})
          ON CONFLICT(user_id) DO UPDATE SET active_organization_id=EXCLUDED.active_organization_id;
        INSERT INTO public.sourcing_projects(id,organization_id,created_by,name)
          VALUES(${literal(project)},${literal(organization)},${literal(actor)},'Concurrent mission');
        SET ROLE service_role;
        SELECT public.mutate_sourcing_agent(${literal(actor)},${literal(project)},0,'configure',
          '{"source":"pool","settings":{"daily_profile_limit":5,"daily_credit_limit":12}}');`);
      const agent = JSON.parse(configured.split('\n').at(-1));
      await sql(database, `SET ROLE service_role; SELECT public.mutate_sourcing_agent(${literal(actor)},${literal(project)},1,
        'start_calibration','{"context_snapshot":{"context_key":"concurrent-context"}}');`);
      let lease;
      await t.test('two independent claim transactions return one lease', async () => {
        const outputs = await Promise.all([sql(database, 'SET ROLE service_role; SELECT to_jsonb(a) FROM public.claim_sourcing_agent() a;'),
          sql(database, 'SET ROLE service_role; SELECT to_jsonb(a) FROM public.claim_sourcing_agent() a;')]);
        const rows = outputs.filter(Boolean).map((output) => JSON.parse(output));
        assert.equal(rows.length, 1);
        assert.equal(rows[0].id, agent.id);
        lease = rows[0].lease_token;
      });
      await t.test('concurrent reservations cannot both consume the last budget', async () => {
        const query = `SET ROLE service_role; SELECT public.reserve_sourcing_agent_budget(${literal(agent.id)},${literal(lease)},0,7);`;
        const results = await Promise.all([sql(database, query), sql(database, query)]);
        assert.deepEqual(results.sort(), ['f', 't']);
        assert.equal(await sql(database, `SELECT credits_reserved FROM public.sourcing_agents WHERE id=${literal(agent.id)};`), '7.0000');
      });
      await t.test('different person keys sharing a stable alias create one item concurrently', async () => {
        const write = (id) => `SET ROLE service_role; SELECT public.sourcing_agent_candidate_write(${literal(agent.id)},${literal(lease)},
          ${literal('pid:' + id)},${literal(JSON.stringify({ candidate_id: id, context_key: 'concurrent-context', source_aliases: ['shared-person-slug'] }))}::jsonb);`;
        const results = await Promise.all([sql(database, write('identity-one')), sql(database, write('identity-two'))]);
        assert.equal(JSON.parse(results[0]).id, JSON.parse(results[1]).id);
        assert.equal(await sql(database, `SELECT count(*) FROM public.sourcing_agent_candidates WHERE agent_id=${literal(agent.id)};`), '1');
      });
      const waitForTransaction = async (name) => {
        for (let attempt = 0; attempt < 20; attempt++) {
          if (await sql(database, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=${literal(database)}
            AND application_name=${literal(name)} AND wait_event='PgSleep');`) === 't') return;
        }
        assert.fail('Concurrent privacy transaction did not reach its synchronization point.');
      };
      const privacyWrite = (identity, url) => `SELECT public.sourcing_agent_candidate_write(${literal(agent.id)},${literal(lease)},
        ${literal('pid:' + identity)},${literal(JSON.stringify({ candidate_id: identity, context_key: 'concurrent-context',
          profile: { public_profile_url: url } }))}::jsonb);`;
      const privacyErase = (url) => `INSERT INTO public.gdpr_erasures(linkedin_url_hash,source)
        VALUES(encode(sha256(convert_to(${literal(url)},'UTF8')),'hex'),'continuous-concurrency-local-test');`;
      await t.test('an erasure waits for an uncommitted discovery then deletes it', async () => {
        const name = 'continuous-discovery-first'; const url = 'https://linkedin.com/in/continuous-race-one';
        const discovery = sql(database, `SET application_name=${literal(name)}; SET ROLE service_role; BEGIN;
          ${privacyWrite('privacy-race-one', url)} SELECT pg_sleep(1); COMMIT;`);
        await waitForTransaction(name);
        const erasure = sql(database, `SET ROLE service_role; ${privacyErase(url)}`);
        await Promise.all([discovery, erasure]);
        assert.equal(await sql(database, `SELECT count(*) FROM public.sourcing_agent_candidates
          WHERE agent_id=${literal(agent.id)} AND candidate_id='privacy-race-one';`), '0');
      });
      await t.test('a discovery waits for an uncommitted erasure then refuses recreation', async () => {
        const name = 'continuous-erasure-first'; const url = 'https://linkedin.com/in/continuous-race-two';
        const erasure = sql(database, `SET application_name=${literal(name)}; SET ROLE service_role; BEGIN;
          ${privacyErase(url)} SELECT pg_sleep(1); COMMIT;`);
        await waitForTransaction(name);
        const discovery = sql(database, `SET ROLE service_role; ${privacyWrite('privacy-race-two', url)}`);
        await assert.rejects(discovery, /Candidate erased/);
        await erasure;
        assert.equal(await sql(database, `SELECT count(*) FROM public.sourcing_agent_candidates
          WHERE agent_id=${literal(agent.id)} AND candidate_id='privacy-race-two';`), '0');
      });
      const prepareScoreRace = async (identity) => {
        const url = 'https://linkedin.com/in/' + identity;
        const source = JSON.parse(await sql(database, `SET ROLE service_role; ${privacyWrite(identity, url)}`));
        const result = { scoringContext: { inputVersionKey: JSON.stringify({ job: { calibrationProfiles: [
          { name: 'Private reference', linkedinUrl: url, sourcing_agent_candidate_id: source.id },
        ] } }) } };
        const dependentId = identity + '-dependent';
        await sql(database, `SET ROLE service_role; INSERT INTO public.job_candidate_status
          (candidate_id,job_id,organization_id,project_id,created_by,candidate_name)
          VALUES(${literal(dependentId)},${literal('project:' + project)},${literal(organization)},${literal(project)},${literal(actor)},'Another person');`);
        const write = `INSERT INTO public.match_scores(candidate_id,job_id,organization_id,created_by,score,scoring_result)
          VALUES(${literal(dependentId)},${literal('project:' + project)},${literal(organization)},${literal(actor)},88,${literal(JSON.stringify(result))}::jsonb);
          UPDATE public.job_candidate_status SET score=88,scoring_details=${literal(JSON.stringify(result))}::jsonb
          WHERE organization_id=${literal(organization)} AND project_id=${literal(project)} AND candidate_id=${literal(dependentId)};`;
        const verify = async () => {
          assert.equal(await sql(database, `SELECT count(*) FROM public.match_scores
            WHERE organization_id=${literal(organization)} AND candidate_id=${literal(dependentId)};`), '0');
          const pipeline = JSON.parse(await sql(database, `SELECT to_jsonb(j) FROM public.job_candidate_status j
            WHERE organization_id=${literal(organization)} AND project_id=${literal(project)} AND candidate_id=${literal(dependentId)};`));
          assert.equal(pipeline.score, null); assert.equal(pipeline.scoring_details, null);
          assert.equal(pipeline.general_stage, 'to_sort');
        };
        return { url, write, verify };
      };
      await t.test('erasure sees a cache writer that held the privacy lock before committing', async () => {
        const race = await prepareScoreRace('continuous-cache-first'); const name = 'continuous-cache-writer-first';
        const writer = sql(database, `SET application_name=${literal(name)}; SET ROLE service_role; BEGIN;
          ${race.write} SELECT pg_sleep(1); COMMIT;`);
        await waitForTransaction(name);
        await Promise.all([writer, sql(database, `SET ROLE service_role; ${privacyErase(race.url)}`)]);
        await race.verify();
      });
      await t.test('late service and authenticated cache writers cannot recreate erased references during or after erasure', async () => {
        const race = await prepareScoreRace('continuous-cache-after'); const name = 'continuous-erasure-before-cache';
        const erasure = sql(database, `SET application_name=${literal(name)}; SET ROLE service_role; BEGIN;
          ${privacyErase(race.url)} SELECT pg_sleep(1); COMMIT;`);
        await waitForTransaction(name);
        await Promise.all([erasure, sql(database, `SET ROLE service_role; ${race.write}`)]);
        await race.verify();
        await sql(database, `SELECT set_config('request.jwt.claims',${literal(JSON.stringify({ sub: actor, role: 'authenticated' }))},false);
          SELECT set_config('request.jwt.claim.sub',${literal(actor)},false); SET ROLE authenticated; ${race.write}`);
        await race.verify();
        assert.equal(await sql(database, `SELECT credits_reserved FROM public.sourcing_agents WHERE id=${literal(agent.id)};`), '7.0000');
        assert.equal(await sql(database, `SELECT credits_used FROM public.sourcing_agents WHERE id=${literal(agent.id)};`), '0.0000');
      });
      await t.test('human pause fences the previously claimed worker', async () => {
        await sql(database, `SET ROLE service_role; SELECT public.sourcing_agent_candidate_write(${literal(agent.id)},${literal(lease)},
          'pid:timeout-uncertain','{"candidate_id":"timeout-uncertain","context_key":"concurrent-context","credits_reserved":7,"provenance":{"scoring_started_at":"2026-10-08T12:00:00Z"}}');`);
        await sql(database, `SET ROLE service_role; SELECT public.mutate_sourcing_agent(${literal(actor)},${literal(project)},2,'pause','{}');`);
        await assert.rejects(sql(database, `SET ROLE service_role; SELECT public.sourcing_agent_checkpoint(${literal(agent.id)},${literal(lease)},'{"checkpoint":{"cursor":"stale"}}');`), /Stale lease/);
        assert.equal(await sql(database, `SELECT status FROM public.sourcing_agents WHERE id=${literal(agent.id)};`), 'paused');
      });
      await t.test('an explicit timeout resolution is actor scoped and concurrent double clicks settle once', async () => {
        const candidate = await sql(database, `SELECT id FROM public.sourcing_agent_candidates
          WHERE agent_id=${literal(agent.id)} AND candidate_id='timeout-uncertain';`);
        const foreignAdmin = randomUUID();
        await sql(database, `INSERT INTO auth.users(id,email,aud,role,instance_id,raw_user_meta_data)
          VALUES(${literal(foreignAdmin)},'foreign-admin@continuous-local.test','authenticated','authenticated','00000000-0000-0000-0000-000000000000','{}');
          INSERT INTO public.organization_members(organization_id,user_id,role) VALUES(${literal(organization)},${literal(foreignAdmin)},'admin');
          INSERT INTO public.profiles(user_id,active_organization_id) VALUES(${literal(foreignAdmin)},${literal(organization)})
            ON CONFLICT(user_id) DO UPDATE SET active_organization_id=EXCLUDED.active_organization_id;`);
        const payload = literal(JSON.stringify({ candidate_id: candidate, context_key: 'concurrent-context', reason: 'Do not retry this uncertain paid evaluation.' }));
        const resolve = (user, revision) => `SET ROLE service_role; SELECT public.mutate_sourcing_agent(${literal(user)},${literal(project)},${revision},'skip_uncertain',${payload}::jsonb);`;
        await assert.rejects(sql(database, resolve(foreignAdmin, 3)), /Resolution belongs to another actor/);
        const results = await Promise.allSettled([sql(database, resolve(actor, 3)), sql(database, resolve(actor, 3))]);
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
        assert.match(results.find(result => result.status === 'rejected').reason.message, /Configuration changed/);
        const resolved = JSON.parse(await sql(database, `SELECT to_jsonb(a) FROM public.sourcing_agents a WHERE id=${literal(agent.id)};`));
        assert.equal(resolved.status, 'paused'); assert.equal(resolved.revision, 4);
        assert.equal(resolved.credits_reserved, 0); assert.equal(resolved.credits_used, 7);
        const row = JSON.parse(await sql(database, `SELECT to_jsonb(c) FROM public.sourcing_agent_candidates c WHERE id=${literal(candidate)};`));
        assert.equal(row.state, 'skipped'); assert.equal(row.credits_used, 7); assert.equal(row.credits_reserved, 0);
        assert.equal(row.reason, null); assert.equal(row.provenance.skip_reason, 'HUMAN_SKIP_UNCERTAIN');
        await assert.rejects(sql(database, resolve(actor, 3)), /Configuration changed/);
        await assert.rejects(sql(database, resolve(actor, 4)), /Candidate is not an uncertain evaluation/);
        assert.equal(await sql(database, `SELECT credits_used FROM public.sourcing_agents WHERE id=${literal(agent.id)};`), '7.0000');
      });
    } finally {
      await sql('postgres', `DROP DATABASE ${database} WITH (FORCE);`);
    }
  });
