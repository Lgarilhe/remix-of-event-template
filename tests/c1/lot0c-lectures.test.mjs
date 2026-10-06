/**
 * Refonte mission, lot 0c : garde-fous statiques des lectures (plan final,
 * section 10.1).
 *
 * Même forme que lot0b-ecrivains.test.mjs : lecture du source et assertions
 * sur les motifs, sans navigateur, sans base ni runtime Deno. Chaque sous-lot
 * ajoute ici ses assertions, pour que la CI de chaque PR reste verte.
 *
 * Lancer : node --test tests/c1/lot0c-lectures.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre (ex. une extraction de HEAD) : c'est
 * ainsi qu'on vérifie que ces tests échouent sur le code d'origine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// Corps d'un objet ou d'une fonction de premier niveau : de sa déclaration à
// la première accolade fermante en colonne 0.
function topLevelBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `${signature} introuvable`);
  const rest = src.slice(start);
  const end = rest.search(/\n\};?\n/);
  assert.ok(end > 0, `fin de ${signature} introuvable`);
  return rest.slice(0, end);
}

// Chaque requête sur une table : du .from('<table>') au point-virgule suivant,
// ou à la requête suivante d'un même Promise.all.
function queriesOn(src, table) {
  const out = [];
  const re = new RegExp(`\\.from\\(['"]${table}['"]\\)`, 'g');
  let m;
  while ((m = re.exec(src))) {
    const rest = src.slice(m.index);
    const end = rest.search(/;|,\s*\n\s*(ctx\.)?adminClient\b|,\s*\n\s*missionStageCounts\(/);
    out.push(end < 0 ? rest : rest.slice(0, end));
  }
  return out;
}

// Migration du lot 0c-1 (écrite par la piste SQL) : un seul fichier.
function migration0c1() {
  const files = readdirSync(join(ROOT, 'supabase/migrations'))
    .filter((f) => /^\d{14}_refonte_mission_lot0c_lectures\.sql$/.test(f));
  assert.equal(files.length, 1, `une seule migration *_refonte_mission_lot0c_lectures.sql attendue, trouvé : ${files.join(', ')}`);
  return read(join('supabase/migrations', files[0]));
}

// ─── 0c-1 : socle SQL ───────────────────────────────────────────────────────

test('0c-1 : vue mission_candidate_rows en security_invoker, fermée à anon', () => {
  const sql = migration0c1();
  assert.match(sql, /CREATE OR REPLACE VIEW public\.mission_candidate_rows\s+WITH \(security_invoker = true\)/);
  assert.match(sql, /REVOKE ALL ON public\.mission_candidate_rows FROM PUBLIC, anon, authenticated\b/);
  assert.match(sql, /GRANT SELECT ON public\.mission_candidate_rows TO authenticated, service_role;/);
});

test('0c-1 : les stats_* lisent get_mission_stage_counts, recalcul sans updated_at', () => {
  const sql = migration0c1();
  const recompute = sql.slice(sql.indexOf('FUNCTION public.recompute_mission_stats('));
  assert.match(recompute.slice(0, 1500), /FROM public\.get_mission_stage_counts\(p_mission_ids\)/);
  assert.match(sql, /DISABLE TRIGGER update_sourcing_projects_updated_at/);
  assert.match(sql, /DISABLE TRIGGER trg_auto_ingest_sourcing_projects/);
});

// ─── 0c-1 : libellés « au total » des lecteurs de stats_* ───────────────────

test('0c-1 : recherches, résumé du matin et tableau de bord disent « au total »', () => {
  // /sourcing (2148cfab) ne montre plus que les profils trouvés : ni retenus ni contactés.
  const searches = read('src/pages/SourcingSearches.tsx');
  assert.doesNotMatch(searches, /shortlistés/);
  assert.doesNotMatch(searches, /stats_shortlisted|stats_messaged/);

  const digest = read('supabase/functions/agent-daily-digest/index.ts');
  assert.doesNotMatch(digest, /shortlistés/);
  assert.match(digest, /\$\{shortlisted\} retenus au total, \$\{messaged\} contactés au total/);
  const email = read('supabase/functions/_shared/transactional-email-templates/daily-digest.tsx');
  assert.doesNotMatch(email, /shortlistés/);
  assert.match(email, /\{m\.shortlisted\} retenus au total, \{m\.messaged\} contactés au total/);

  const dashboard = read('src/components/dashboard/DashboardMissionsPanel.tsx');
  assert.match(dashboard, /\{plural\(shortlisted, 'retenu'\)\} au total · \{plural\(messaged, 'contacté'\)\} au total/);
  assert.match(dashboard, /label="Retenus au total"/);
  assert.match(dashboard, /label="Contactés au total"/);
  assert.doesNotMatch(dashboard, /label="Contactés"|label="Retenus"/);

  const overview = read('src/components/missions/v2/MissionOverviewV2.tsx');
  assert.match(overview, /\{ label: 'Contactés au total', value: project\.stats_messaged \|\| 0 \}/);
  assert.doesNotMatch(overview, /\{ label: 'Contactés', value: project\.stats_messaged/);
});

// ─── 0c-2 : outils de l'assistant ───────────────────────────────────────────

const READS = 'supabase/functions/_shared/agent-tools-reads.ts';
const MUTATIONS = 'supabase/functions/_shared/agent-tools-mutations.ts';

test('0c-2 : get_my_missions compte par get_mission_stage_counts, plus sur 5 000 lignes brutes', () => {
  const reads = read(READS);
  const tool = topLevelBody(reads, 'const getMyMissions: AgentTool = {');
  assert.match(tool, /missionStageCounts\(ctx, missionIds\)/);
  assert.match(reads, /\.rpc\('get_mission_stage_counts', \{ p_project_ids: missionIds \}\)/);
  assert.equal(queriesOn(tool, 'job_candidate_status').length, 0);
  assert.doesNotMatch(tool, /\.limit\(5000\)/);
  assert.match(tool, /m\.unopened_profiles = /);
});

test('0c-2 : get_mission_overview et get_mission_candidates lisent la vue, sur l\'étape générale', () => {
  const reads = read(READS);
  const overview = topLevelBody(reads, 'const getMissionOverview: AgentTool = {');
  assert.equal(queriesOn(overview, 'job_candidate_status').length, 0);
  assert.match(overview, /missionStageCounts\(ctx, \[missionId\]\)/);
  assert.doesNotMatch(overview, /r\.pipeline_stage/);

  const candidates = topLevelBody(reads, 'const getMissionCandidates: AgentTool = {');
  assert.equal(queriesOn(candidates, 'job_candidate_status').length, 0);
  const [q] = queriesOn(candidates, 'mission_candidate_rows');
  assert.ok(q, 'get_mission_candidates lit mission_candidate_rows');
  assert.match(q, /\.eq\('organization_id', ctx\.organizationId\)/);
  assert.match(q, /\.eq\('is_unopened', false\)/);
  assert.match(candidates, /q = q\.eq\('general_stage', stage\)/);
  // pipeline_stage ne sert qu'au libellé précis d'une colonne d'entretien.
  assert.equal(candidates.match(/\.eq\('pipeline_stage'/g)?.length, 1);
  assert.match(candidates, /if \(subStage\) q = q\.eq\('pipeline_stage', subStage\);/);
});

test('0c-2 : assign_candidate_to_member cherche le candidat par project_id et organisation', () => {
  const tool = topLevelBody(read(MUTATIONS), 'const assignCandidateToMember: AgentTool = {');
  const lookups = queriesOn(tool, 'job_candidate_status');
  assert.equal(lookups.length, 3);
  for (const q of lookups) {
    assert.doesNotMatch(q, /\.eq\('job_id'/);
    assert.match(q, /\.eq\('organization_id', ctx\.organizationId\)/);
    assert.match(q, /\.eq\('project_id', jobId\)/);
    assert.match(q, /\.limit\(1\)/);
  }
  assert.match(tool, /const jobId = missionIdParam\(params\) \?\? '';/);
});

test('0c-2 : draft_outreach_message lit la ligne de toute l\'organisation, par project_id', () => {
  const src = read(MUTATIONS);
  const ctxFn = topLevelBody(src, 'async function draftContext(');
  const [q] = queriesOn(ctxFn, 'job_candidate_status');
  assert.match(q, /\.eq\('organization_id', ctx\.organizationId\)/);
  assert.match(q, /\.eq\('project_id', projectId\)/);
  assert.doesNotMatch(q, /created_by|\.eq\('job_id'/);
  const [p] = queriesOn(ctxFn, 'sourcing_projects');
  assert.match(p, /\.eq\('organization_id', ctx\.organizationId\)/);
  const tool = topLevelBody(src, 'const draftOutreachMessage: AgentTool = {');
  assert.equal(queriesOn(tool, 'job_candidate_status').length, 0);
  // Sans new_stage, le contrôle de update_candidate_stage refusait tout appel.
  assert.doesNotMatch(tool, /updateCandidateStage\.verifyAccess/);
  assert.match(tool, /verifyAccess: \(params, ctx\) => verifySingleCandidate\(params, ctx\)/);
});

test('0c-2 : countUnscoredProfiles a le périmètre du worker (organisation et job_id échantillon)', () => {
  const fn = topLevelBody(read(MUTATIONS), 'async function countUnscoredProfiles(');
  const [sample, count] = queriesOn(fn, 'job_candidate_status');
  assert.match(sample, /\.eq\('organization_id', ctx\.organizationId\)/);
  assert.match(sample, /\.order\('created_at', \{ ascending: true \}\)/);
  assert.match(count, /\.eq\('organization_id', ctx\.organizationId\)/);
  assert.match(count, /\.eq\('job_id', jobId\)/);
  assert.match(fn, /\|\| `project:\$\{projectId\}`/);
  // Même repli que le worker.
  assert.match(read('supabase/functions/process-agent-tasks/index.ts'), /sampleRow\?\.job_id \|\| `project:\$\{projectId\}`/);
});

// ─── 0c-2 : purge RGPD en « compte seulement » ──────────────────────────────

test('0c-2 : rgpd-purge passe par rgpd_purge_candidate_rows, compte seulement par défaut', () => {
  const purge = read('supabase/functions/rgpd-purge/index.ts');
  assert.doesNotMatch(purge, /\.is\("status", null\)/);
  assert.doesNotMatch(purge, /"refused", "withdrawn", "rejected", "declined"/);
  assert.match(purge, /\.rpc\("rgpd_purge_candidate_rows", \{/);
  assert.match(purge, /p_dry_run: dryRun,/);
  assert.match(purge, /const dryRun = body\?\.dry_run !== false;/);
  assert.equal(queriesOn(purge, 'job_candidate_status').filter((q) => /\.delete\(\)/.test(q)).length, 0);
  // Fragments de connaissance : toujours par organisation.
  const chunks = queriesOn(purge, 'knowledge_chunks');
  assert.ok(chunks.length >= 2);
  for (const q of chunks) assert.match(q, /\.eq\("organization_id", orgId\)/);
  // Aucune suppression en compte seulement.
  assert.match(purge, /for \(let i = 0; !dryRun && i < ids\.length; i \+= 100\) \{/);
  assert.equal(purge.match(/!dryRun && i < ids\.length/g)?.length, 3);
  assert.match(purge, /if \(oldFiles\.length > 0 && dryRun\) \{/);
  assert.match(purge, /dry_run: dryRun,\n\s+purge_date:/);
});
