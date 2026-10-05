/**
 * Refonte scorecard et assistant en direct, lot 1 : rattachement des grilles et
 * des séances, droits d'auteur, conservation de la transcription.
 * Gardes sur le source ; l'audit SQL (supabase/tests/scorecard_live_lot1_audit.sql)
 * vérifie la base :
 *  - la migration pose les colonnes, les policies RESTRICTIVE et le garde de
 *    conservation ;
 *  - les deux UPDATE de reprise que l'audit rejoue sont ceux de la migration,
 *    mot pour mot ;
 *  - generate-call-report lit l'auteur de la séance avant d'appeler le modèle
 *    (SEC-023) ;
 *  - l'avis du portail s'écrit sous l'identifiant du profil, avec sa mission ;
 *  - la CI e2e joue l'audit.
 * Lancer : node --test tests/c1/scorecard-live-lot1.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const MIGRATION = 'supabase/migrations/20261005155516_scorecard_live_lot1_rattachement.sql';
const AUDIT = 'supabase/tests/scorecard_live_lot1_audit.sql';
const REPORT = 'supabase/functions/generate-call-report/index.ts';
const PORTAL = 'supabase/functions/client-portal-data/index.ts';
const E2E = '.github/workflows/e2e.yml';

const normalize = (sql) => sql.replace(/\s+/g, ' ').trim();

test('migration : mission et étape sur la grille, effacées sans supprimer l\'avis', () => {
  const sql = read(MIGRATION);
  assert.match(sql, /ALTER TABLE public\.candidate_evaluations\s+ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public\.sourcing_projects\(id\) ON DELETE SET NULL,\s+ADD COLUMN IF NOT EXISTS process_step_id uuid REFERENCES public\.mission_process_steps\(id\) ON DELETE SET NULL;/);
});

test('migration : la séance porte mission, étape, grille, événement, consentement, expiration', () => {
  const sql = read(MIGRATION);
  for (const col of [
    'project_id uuid REFERENCES public.sourcing_projects(id) ON DELETE SET NULL',
    'process_step_id uuid REFERENCES public.mission_process_steps(id) ON DELETE SET NULL',
    'evaluation_id uuid REFERENCES public.candidate_evaluations(id) ON DELETE SET NULL',
    'qualification_session_id uuid REFERENCES public.qualification_sessions(id) ON DELETE SET NULL',
    'candidate_consent_at timestamptz',
    'transcript_purged_at timestamptz',
  ]) {
    assert.ok(sql.includes(`ADD COLUMN IF NOT EXISTS ${col}`), `colonne attendue : ${col}`);
  }
  // L'expiration n'est posée qu'une fois : un rejeu ne repousse aucune échéance.
  assert.match(sql, /IF NOT EXISTS \(\s+SELECT 1 FROM information_schema\.columns[\s\S]*?column_name = 'transcript_expires_at'\s+\) THEN/);
  assert.match(sql, /ADD COLUMN transcript_expires_at timestamptz NOT NULL DEFAULT \(now\(\) \+ interval '90 days'\)/);
});

test('migration : auteur seul en écriture, policies RESTRICTIVE sur les deux tables', () => {
  const sql = read(MIGRATION);
  for (const [name, table, cmd] of [
    ['evaluations_author_insert', 'candidate_evaluations', 'INSERT'],
    ['evaluations_author_update', 'candidate_evaluations', 'UPDATE'],
    ['evaluations_author_delete', 'candidate_evaluations', 'DELETE'],
    ['mission_same_org_insert', 'candidate_evaluations', 'INSERT'],
    ['mission_same_org_update', 'candidate_evaluations', 'UPDATE'],
    ['coaching_author_insert', 'call_coaching_sessions', 'INSERT'],
    ['coaching_author_update', 'call_coaching_sessions', 'UPDATE'],
    ['coaching_author_delete', 'call_coaching_sessions', 'DELETE'],
    ['mission_same_org_insert', 'call_coaching_sessions', 'INSERT'],
    ['mission_same_org_update', 'call_coaching_sessions', 'UPDATE'],
  ]) {
    const re = new RegExp(`DROP POLICY IF EXISTS ${name} ON public\\.${table};\\s+CREATE POLICY ${name} ON public\\.${table}\\s+AS RESTRICTIVE FOR ${cmd} TO authenticated`);
    assert.match(sql, re, `${table} : policy RESTRICTIVE ${name} (${cmd})`);
  }
  // Une policy permissive de plus ne doit pas rouvrir l'écriture : aucune n'est créée ici.
  assert.doesNotMatch(sql, /CREATE POLICY \w+ ON public\.(?:candidate_evaluations|call_coaching_sessions)\s+FOR /);
});

test('migration : une étape exige sa mission, une grille et un événement liés restent dans l\'organisation', () => {
  const sql = normalize(read(MIGRATION));
  assert.ok(sql.includes('process_step_id IS NULL OR EXISTS ( SELECT 1 FROM public.mission_process_steps s WHERE s.id = call_coaching_sessions.process_step_id AND s.project_id = call_coaching_sessions.project_id'));
  assert.ok(sql.includes('evaluation_id IS NULL OR EXISTS ( SELECT 1 FROM public.candidate_evaluations e WHERE e.id = call_coaching_sessions.evaluation_id AND e.organization_id = call_coaching_sessions.organization_id'));
  assert.ok(sql.includes('qualification_session_id IS NULL OR EXISTS ( SELECT 1 FROM public.qualification_sessions q WHERE q.id = call_coaching_sessions.qualification_session_id AND q.organization_id = call_coaching_sessions.organization_id'));
  assert.ok(sql.includes('project_id IS NULL OR public.project_organization_id(project_id) = organization_id'));
});

test('migration : expiration et consentement posés par le serveur pour un utilisateur connecté', () => {
  const sql = read(MIGRATION);
  const guard = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.call_coaching_sessions_retention_guard()'));
  assert.match(guard, /IF current_user NOT IN \('authenticated', 'anon'\) THEN\s+RETURN NEW;/);
  assert.match(guard, /NEW\.transcript_expires_at := now\(\) \+ interval '90 days';/);
  assert.match(guard, /NEW\.transcript_expires_at := OLD\.transcript_expires_at;/);
  assert.match(guard, /NEW\.transcript_purged_at := OLD\.transcript_purged_at;/);
  assert.match(guard, /BEFORE INSERT OR UPDATE ON public\.call_coaching_sessions/);
  // SECURITY INVOKER : current_user est le rôle de la session, pas celui du propriétaire.
  assert.doesNotMatch(guard, /SECURITY DEFINER/);
});

test('audit : les deux UPDATE de reprise sont ceux de la migration, mot pour mot', () => {
  const migration = read(MIGRATION);
  const audit = normalize(read(AUDIT));
  const updates = migration.match(/UPDATE public\.candidate_evaluations ce[\s\S]*?;/g);
  assert.equal(updates?.length, 2, 'deux UPDATE de reprise attendus dans la migration');
  for (const stmt of updates) {
    assert.ok(audit.includes(normalize(stmt)), `l'audit rejoue une autre reprise que la migration : ${normalize(stmt).slice(0, 80)}…`);
  }
});

test('SEC-023 : generate-call-report lit l\'auteur de la séance avant l\'appel au modèle', () => {
  const src = read(REPORT);
  const lookup = src.indexOf('.from("call_coaching_sessions")');
  const gate = src.indexOf('await assertCredits(');
  const model = src.indexOf('await callClaudeCompat(');
  assert.ok(lookup > 0 && gate > 0 && model > 0, 'lecture, garde de crédits et appel au modèle attendus');
  assert.ok(lookup < gate && gate < model, 'la séance est vérifiée avant la garde de crédits et l\'appel au modèle');
  const check = src.slice(src.indexOf('if (session_id && auth.method !== "service_role")'), gate);
  assert.match(check, /\.select\("created_by"\)\s+\.eq\("id", session_id\)/);
  assert.match(check, /sessionRow\.created_by !== userId/);
  assert.match(check, /error: "Forbidden" \}\), \{ status: 403/);
  assert.match(check, /error: "Session unavailable" \}\), \{ status: 503/);
});

test('portail : l\'avis s\'écrit sous l\'identifiant du profil, lu par la fonction SQL, avec sa mission', () => {
  const src = read(PORTAL);
  const post = src.slice(src.indexOf('async function handleSubmitEvaluation('));
  const lookup = post.slice(post.indexOf('.rpc(\n    "client_portal_candidate_profile_id"'), post.indexOf('// 6. Insert evaluation'));
  assert.match(lookup, /\{ p_token: token, p_row_id: candidate\.id \}/);
  assert.match(lookup, /isMissingPortalFunction\(profileErr\)/);
  assert.match(lookup, /typeof profileId !== "string" \|\| profileId === ""/);
  const insert = post.slice(post.indexOf('.from("candidate_evaluations")'), post.indexOf('if (insertErr)'));
  assert.match(insert, /candidate_id: profileId,/);
  assert.match(insert, /project_id: candidate\.project_id,/);
  assert.doesNotMatch(insert, /candidate_id: evaluation\.candidate_id/, 'l\'identifiant de la ligne ne doit plus être écrit');
  // Pas de lecture directe de la table (règle R4) et l'identifiant du profil
  // ne part jamais dans une réponse : il désigne un candidat anonymisé.
  assert.doesNotMatch(src, /\.from\("job_candidate_status"\)/);
  assert.equal((src.match(/profileId/g) || []).length, (post.match(/profileId/g) || []).length, 'profileId reste dans le traitement de l\'avis');
  assert.doesNotMatch(post, /jsonResponse\([^)]*profileId/);
});

test('migration : la fonction du portail rend le profil par client_portal_candidates, réservée à service_role', () => {
  const sql = normalize(read(MIGRATION));
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.client_portal_candidate_profile_id(p_token text, p_row_id uuid) RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp'));
  assert.ok(sql.includes('FROM public.client_portal_candidates(p_token) c JOIN public.job_candidate_status j ON j.id = c.id WHERE c.id = p_row_id'));
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.client_portal_candidate_profile_id(text, uuid) FROM PUBLIC;'));
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.client_portal_candidate_profile_id(text, uuid) FROM anon, authenticated;'));
  assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.client_portal_candidate_profile_id(text, uuid) TO service_role;'));
  assert.doesNotMatch(sql, /client_portal_candidate_profile_id[^;]*SECURITY DEFINER/);
});

test('CI : l\'audit du lot 1 tourne sur la base reconstruite', () => {
  const yml = read(E2E);
  assert.match(yml, /-f supabase\/tests\/scorecard_live_lot1_audit\.sql/);
});
