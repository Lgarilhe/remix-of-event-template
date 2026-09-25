/**
 * Audit séquences 2026-09-25, lot B6 — base de données (migration, audit RLS,
 * scripts SQL).
 *
 * Lecture du SQL, commentaires retirés : on vérifie l'état FINAL que produit la
 * suite des migrations (dernière définition d'une fonction ou d'une contrainte),
 * pas un nom de fichier. Le comportement réel est rejoué par
 * supabase/tests/rls_two_orgs_audit.sql (bloc « séquences ») dans la CI e2e,
 * sur une base reconstruite depuis les migrations.
 *
 * Lancer : node --test tests/ux/seq-audit-b6.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

// Commentaires SQL retirés (lignes « -- ... ») : on teste le code.
const stripSql = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const MIGRATIONS = readdirSync(new URL('supabase/migrations/', ROOT))
  .filter((f) => f.endsWith('.sql'))
  .sort();
const migration = (f) => stripSql(read(`supabase/migrations/${f}`));

/** Contenu (sans commentaires) de la DERNIÈRE migration qui contient `re`. */
const latest = (re) => {
  for (let i = MIGRATIONS.length - 1; i >= 0; i -= 1) {
    const sql = migration(MIGRATIONS[i]);
    if (re.test(sql)) return { file: MIGRATIONS[i], sql };
  }
  return { file: null, sql: '' };
};

/** Découpe de `start` jusqu'au premier `end` qui suit (chaîne vide sinon). */
const between = (src, start, end) => {
  const from = src.indexOf(start);
  if (from === -1) return '';
  const to = src.indexOf(end, from + start.length);
  return to === -1 ? src.slice(from) : src.slice(from, to);
};

const B6_FILES = MIGRATIONS.filter((f) => /_sequences_audit_lot_b6\.sql$/.test(f));
const b6 = B6_FILES.length === 1 ? migration(B6_FILES[0]) : '';

/** Texte d'une policy : de « CREATE POLICY name ON public.table » au « ; » suivant. */
const policy = (name, table) => between(b6, `CREATE POLICY ${name} ON public.${table}`, ';');

// ---------------------------------------------------------------- discipline
test('B6 — une seule migration, version réelle, unique et postérieure au départ', () => {
  assert.equal(B6_FILES.length, 1, 'un seul fichier *_sequences_audit_lot_b6.sql');
  const version = B6_FILES[0].split('_')[0];
  assert.match(version, /^\d{14}$/);
  assert.ok(version > '20260924060053', 'postérieure à la dernière migration au départ du lot');
  assert.equal(MIGRATIONS.filter((f) => f.startsWith(`${version}_`)).length, 1, 'version unique');
  assert.doesNotMatch(b6, /notion_api_cache/);
});

// ---------------------------------------------------------------- SEQ-002 / SEQ-121
test('SEQ-002 / SEQ-121 — la contrainte de pause admet toutes les raisons du vocabulaire commun', () => {
  const { sql } = latest(/ADD CONSTRAINT sequence_enrollments_pause_reason_check/);
  const check = between(sql, 'ADD CONSTRAINT sequence_enrollments_pause_reason_check', ';');
  const allowed = new Set([...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));

  const labels = read('src/lib/sequenceLabels.ts');
  const union = between(labels, 'export type PauseReason', ';');
  const reasons = [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(reasons.length >= 8, 'PauseReason lu dans sequenceLabels.ts');
  for (const r of reasons) assert.ok(allowed.has(r), `raison refusée par la base : ${r}`);
  assert.deepEqual([...allowed].sort(), [...reasons].sort(), 'la base et le front ont la même liste');

  // Rejouable : l'ancienne contrainte (posée sous IF NOT EXISTS) est remplacée.
  assert.match(b6, /DROP CONSTRAINT IF EXISTS sequence_enrollments_pause_reason_check/);
});

test('SEQ-121 — les pauses sans raison deviennent « manual » (jamais reprises par une réactivation)', () => {
  assert.match(
    b6,
    /UPDATE public\.sequence_enrollments\s+SET pause_reason = 'manual'\s+WHERE status = 'paused'\s+AND pause_reason IS NULL/,
  );
});

// ---------------------------------------------------------------- SEQ-003
test('SEQ-003 — les messages partis marqués « annulés » (BUG-095) repassent envoyés', () => {
  const fix = between(b6, 'UPDATE public.sequence_step_executions\nSET status = \'sent\'', ';');
  assert.ok(fix, 'réparation des lignes BUG-095 absente');
  assert.match(fix, /WHERE status = 'cancelled'/);
  assert.match(fix, /skip_reason LIKE 'Enrollment became % during execution'/);
  // Les annulations « before send (last-call check) » ne sont jamais parties.
  assert.doesNotMatch(fix, /last-call|before send/);
});

// ---------------------------------------------------------------- SEQ-009
test('SEQ-009 — une étape prend toujours l’organisation de sa séquence, et la policy l’exige', () => {
  const fn = between(b6, 'CREATE OR REPLACE FUNCTION public.sequence_steps_sync_org()', '$$;');
  assert.match(fn, /SECURITY DEFINER/);
  assert.match(fn, /SELECT s\.organization_id INTO NEW\.organization_id\s+FROM public\.outreach_sequences s\s+WHERE s\.id = NEW\.sequence_id/);
  assert.match(b6, /BEFORE INSERT OR UPDATE OF sequence_id, organization_id ON public\.sequence_steps/);

  for (const name of ['org_members_insert', 'org_members_update', 'org_members_delete', 'org_members_select']) {
    const p = policy(name, 'sequence_steps');
    assert.ok(p, `policy ${name} absente sur sequence_steps`);
    assert.match(p, /EXISTS \(\s*SELECT 1 FROM public\.outreach_sequences s\s+WHERE s\.id = sequence_steps\.sequence_id\s+AND s\.organization_id = public\.get_user_org_id\(auth\.uid\(\)\)/);
  }
});

test('SEQ-009 / SEQ-216 — toutes les policies des tables du module sont retirées avant le nouveau jeu', () => {
  const sweep = between(b6, 'SELECT tablename, policyname FROM pg_policies', 'END $$;');
  for (const t of ['outreach_sequences', 'sequence_steps', 'sequence_enrollments', 'sequence_step_executions',
    'sequence_templates', 'sequence_snippets', 'sequence_analytics', 'inmail_queue']) {
    assert.ok(sweep.includes(`'${t}'`), `table non balayée : ${t}`);
  }
  assert.match(sweep, /DROP POLICY IF EXISTS %I ON public\.%I/);
  // Contrôle final qui fait échouer la migration si un nom hérité survit.
  assert.match(b6, /RAISE EXCEPTION 'Séquences : policies inattendues/);
});

// ---------------------------------------------------------------- SEQ-011
test('SEQ-011 — inmail_queue : le navigateur ne note qu’un message envoyé, sans UPDATE ni DELETE', () => {
  const insert = policy('org_members_insert', 'inmail_queue');
  assert.match(insert, /FOR INSERT TO authenticated/);
  assert.match(insert, /organization_id = public\.get_user_org_id\(auth\.uid\(\)\)/);
  assert.match(insert, /created_by = auth\.uid\(\)/);
  assert.match(insert, /status = 'sent'/);

  const onInmail = [...b6.matchAll(/CREATE POLICY (\w+) ON public\.inmail_queue\s+FOR (\w+)(?: TO (\w+))?/g)]
    .map((m) => ({ name: m[1], cmd: m[2], role: m[3] ?? 'public' }));
  assert.deepEqual(onInmail.map((p) => p.name).sort(), ['org_members_insert', 'org_members_select', 'service_role_all']);
  assert.ok(!onInmail.some((p) => p.role === 'authenticated' && ['UPDATE', 'DELETE', 'ALL'].includes(p.cmd)),
    'aucune écriture UPDATE/DELETE pour authenticated');
});

// ---------------------------------------------------------------- SEQ-013
test('SEQ-013 — assigned_sender_id devient text, après remise à NULL des user_id hérités', () => {
  const block = between(b6, "AND column_name = 'assigned_sender_id'", 'END $$;');
  assert.match(block, /AND data_type = 'uuid'/, 'garde : ne rejoue pas sur une colonne déjà en text');
  const reset = block.indexOf('SET assigned_sender_id = NULL');
  const alter = block.indexOf('ALTER COLUMN assigned_sender_id TYPE text USING assigned_sender_id::text');
  assert.ok(reset !== -1 && alter !== -1, 'remise à NULL et changement de type attendus');
  assert.ok(reset < alter, 'remise à NULL avant le changement de type');
  // Conversation déjà engagée en rotation : figée sur le compte réellement utilisé.
  const freeze = block.slice(alter);
  assert.match(freeze, /SET assigned_sender_id = s\.sender_accounts->0->>'account_id'/);
  assert.match(freeze, /COALESCE\(s\.rotation_mode, 'round_robin'\) <> 'random'/);
  assert.match(freeze, /x\.status IN \('sent', 'opened', 'clicked', 'replied'\)/);
});

// ---------------------------------------------------------------- SEQ-056
test('SEQ-056 — exécution, inscription et séquence restent dans la même organisation', () => {
  const exec = between(b6, 'CREATE OR REPLACE FUNCTION public.sequence_step_executions_check_org()', '$$;');
  assert.match(exec, /IF FOUND AND v_step_seq IS DISTINCT FROM v_enr_seq THEN\s+RAISE EXCEPTION/);
  assert.match(exec, /NEW\.organization_id := v_enr_org;/);
  assert.match(b6, /BEFORE INSERT OR UPDATE OF enrollment_id, step_id, organization_id ON public\.sequence_step_executions/);

  const enr = between(b6, 'CREATE OR REPLACE FUNCTION public.sequence_enrollments_check_org()', '$$;');
  assert.match(enr, /IF NEW\.organization_id IS NULL THEN\s+NEW\.organization_id := v_seq_org;/);
  assert.match(enr, /ELSIF NEW\.organization_id IS DISTINCT FROM v_seq_org THEN\s+RAISE EXCEPTION/);

  const seq = between(b6, 'CREATE OR REPLACE FUNCTION public.outreach_sequences_check_project_org()', '$$;');
  assert.match(seq, /FROM public\.sourcing_projects p/);
  // Un partenaire de la mission garde le droit d'y rattacher sa séquence.
  assert.match(seq, /NOT public\.is_mission_team_member_for_project\(auth\.uid\(\), NEW\.project_id\)/);

  // La réparation passe AVANT les déclencheurs (sinon l'alignement des
  // exécutions incohérentes ferait échouer la migration).
  assert.ok(b6.indexOf('SET organization_id = e.organization_id') < b6.indexOf('CREATE TRIGGER sequence_step_executions_check_org'));
});

// ---------------------------------------------------------------- SEQ-057
test('SEQ-057 — la statistique porte l’organisation de sa séquence et n’est lisible que par elle', () => {
  const { sql } = latest(/CREATE OR REPLACE FUNCTION public\.increment_sequence_analytics/);
  const fn = between(sql, 'CREATE OR REPLACE FUNCTION public.increment_sequence_analytics', '$$;');
  assert.match(fn, /INSERT INTO public\.sequence_analytics AS a \(sequence_id, date, organization_id, %1\$I\)/);
  assert.match(fn, /SELECT s\.id, CURRENT_DATE, s\.organization_id, \$2\s+FROM public\.outreach_sequences s/);
  assert.match(fn, /organization_id = COALESCE\(a\.organization_id, EXCLUDED\.organization_id\)/);
  assert.match(b6, /UPDATE public\.sequence_analytics a\s+SET organization_id = s\.organization_id/);

  const onAnalytics = [...b6.matchAll(/CREATE POLICY (\w+) ON public\.sequence_analytics\s+FOR (\w+)/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(onAnalytics.sort(), ['org_members_select:SELECT', 'service_role_all:ALL']);
  assert.doesNotMatch(policy('org_members_select', 'sequence_analytics'), /IS NULL/);
});

// ---------------------------------------------------------------- SEQ-058
test('SEQ-058 — un modèle « système » ne se crée ni ne se modifie par l’API', () => {
  assert.match(policy('org_members_insert', 'sequence_templates'), /WITH CHECK \(organization_id = public\.get_user_org_id\(auth\.uid\(\)\) AND is_system IS NOT TRUE\)/);
  const update = policy('org_members_update', 'sequence_templates');
  assert.match(update, /USING \(organization_id = public\.get_user_org_id\(auth\.uid\(\)\) AND is_system IS NOT TRUE\)/);
  assert.match(update, /WITH CHECK \(organization_id = public\.get_user_org_id\(auth\.uid\(\)\) AND is_system IS NOT TRUE\)/);
  // Nettoyage : seuls les modèles d'origine gardent le badge.
  assert.match(b6, /UPDATE public\.sequence_templates t\s+SET is_system = false/);
});

// ---------------------------------------------------------------- SEQ-059
test('SEQ-059 — supprimer une étape déjà envoyée est refusé avant toute suppression', () => {
  const { sql } = latest(/CREATE OR REPLACE FUNCTION public\.save_sequence_steps/);
  const fn = between(sql, 'CREATE OR REPLACE FUNCTION public.save_sequence_steps', '\n$$;');
  const guard = fn.indexOf("HINT = 'STEP_HAS_HISTORY'");
  const del = fn.indexOf('DELETE FROM public.sequence_steps');
  assert.ok(guard !== -1, 'refus STEP_HAS_HISTORY absent de la dernière save_sequence_steps');
  assert.ok(del !== -1 && guard < del, 'le refus précède la suppression');
  const history = between(fn, 'x.status IN (', ')');
  for (const s of ['sent', 'opened', 'clicked', 'replied', 'bounced', 'failed', 'skipped', 'sending']) {
    assert.ok(history.includes(`'${s}'`), `statut d'historique oublié : ${s}`);
  }
  assert.match(fn, /SECURITY INVOKER/, 'reste soumise à la RLS de l’appelant');
  // Le front traduit ce HINT (lot F2).
  assert.match(read('src/components/outreach/SequencesList.tsx'), /STEP_HAS_HISTORY/);
});

// ---------------------------------------------------------------- SEQ-075
test('SEQ-075 — les contrôles ne tombent plus à la même minute que l’envoi', () => {
  const crons = [...b6.matchAll(/cron\.schedule\(\s*'([^']+)',\s*'([^']+)'/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(Object.fromEntries(crons), {
    'process-sequences-replies': '2-59/5 * * * *',
    'process-sequences-timeouts': '3-59/10 * * * *',
    'process-sequences-wait-events': '4-59/15 * * * *',
  });
  assert.doesNotMatch(b6, /cron\.(un)?schedule\(\s*'process-sequences-main'/, 'le cron d’envoi reste inchangé');
});

// ---------------------------------------------------------------- SEQ-117
test('SEQ-117 — index du moteur rattrapés et index des rattrapages', () => {
  for (const idx of ['idx_step_exec_scheduled', 'idx_step_exec_enrollment_status', 'idx_step_exec_step_id',
    'idx_enrollments_account_status', 'idx_enrollments_profile_id', 'idx_sequence_step_executions_org',
    'idx_step_exec_stuck_updated_at', 'idx_enrollments_active_updated_at']) {
    assert.match(b6, new RegExp(`CREATE INDEX IF NOT EXISTS ${idx}\\b`), `index absent : ${idx}`);
  }
  assert.match(b6, /WHERE status IN \('sending', 'quota_blocked'\)/);
  assert.match(b6, /ON public\.sequence_enrollments \(updated_at\)\s+WHERE status = 'active'/);
  assert.match(b6, /to_regclass\('public\.candidate_evaluations'\)/);
});

// ---------------------------------------------------------------- SEQ-119
test('SEQ-119 — un collaborateur ne modifie que ses inscriptions et ne lit que ses missions', () => {
  const upd = policy('org_members_update', 'sequence_enrollments');
  assert.match(upd, /created_by = auth\.uid\(\) OR NOT \(SELECT public\.is_active_org_collaborator\(auth\.uid\(\)\)\)/);
  const sel = policy('org_members_select', 'sequence_enrollments');
  assert.match(sel, /public\.is_mission_team_member_for_project\(auth\.uid\(\), s\.project_id\)/);
  const execUpd = policy('org_members_update', 'sequence_step_executions');
  assert.match(execUpd, /e\.created_by = auth\.uid\(\)/);
  const fn = between(b6, 'CREATE OR REPLACE FUNCTION public.is_active_org_collaborator', '$$;');
  assert.match(fn, /get_org_role\(_user_id, public\.get_user_org_id\(_user_id\)\) = 'collaborator'/);
});

// ---------------------------------------------------------------- SEQ-165
test('SEQ-165 — compteurs d’inscriptions calculés en base, sous la RLS de l’appelant', () => {
  const fn = between(b6, 'CREATE OR REPLACE FUNCTION public.get_sequence_enrollment_counts', '$$;');
  assert.match(fn, /RETURNS TABLE \(sequence_id uuid, status text, count bigint\)/);
  assert.match(fn, /SECURITY INVOKER/);
  assert.match(fn, /GROUP BY e\.sequence_id, e\.status/);
  assert.match(b6, /GRANT EXECUTE ON FUNCTION public\.get_sequence_enrollment_counts\(uuid\[\]\) TO authenticated/);
});

// ---------------------------------------------------------------- SEQ-214
test('SEQ-214 — une étape envoyée ne redevient pas programmée depuis le navigateur', () => {
  const fn = between(b6, 'CREATE OR REPLACE FUNCTION public.sequence_step_executions_client_guard()', '$$;');
  assert.match(fn, /IF COALESCE\(auth\.role\(\), ''\) <> 'authenticated' THEN\s+RETURN NEW;/, 'le moteur (service_role) n’est pas concerné');
  assert.match(fn, /OLD\.status IN \('sending', 'sent', 'opened', 'clicked', 'replied', 'bounced', 'skipped'\)/);
  assert.match(fn, /NEW\.enrollment_id IS DISTINCT FROM OLD\.enrollment_id/);
  assert.match(fn, /AND OLD\.status <> 'scheduled'/);
  assert.match(b6, /BEFORE UPDATE ON public\.sequence_step_executions\s+FOR EACH ROW EXECUTE FUNCTION public\.sequence_step_executions_client_guard\(\)/);
});

// ---------------------------------------------------------------- SEQ-215
test('SEQ-215 — CHECK de statut posés en NOT VALID, validation tentée sans casser le déploiement', () => {
  for (const c of ['sequence_step_executions_status_check', 'sequence_enrollments_status_check', 'inmail_queue_status_check']) {
    assert.ok(b6.includes(`'${c}'`), `contrainte absente : ${c}`);
  }
  assert.match(b6, /ADD CONSTRAINT %I CHECK \(%s\) NOT VALID/);
  assert.match(b6, /VALIDATE CONSTRAINT %I/);
  assert.match(b6, /EXCEPTION WHEN check_violation THEN\s+RAISE WARNING/);
  assert.match(b6, /ALTER COLUMN status SET DEFAULT 'scheduled'/);
});

// ---------------------------------------------------------------- SEQ-217
test('SEQ-217 — l’audit RLS à deux organisations couvre le module séquences', () => {
  const audit = stripSql(read('supabase/tests/rls_two_orgs_audit.sql'));
  const block = audit.slice(audit.indexOf("seq_a uuid := "));
  assert.ok(block.length > 100, 'bloc séquences absent');
  // B n'insère ni étape dans la séquence de A, ni exécution sur une inscription de A.
  assert.match(block, /INSERT INTO public\.sequence_steps \(sequence_id, organization_id, step_order, action_type, message_template\)\s+VALUES \(seq_a, org_b/);
  assert.match(block, /INSERT INTO public\.sequence_step_executions \(enrollment_id, step_id, step_order, scheduled_at, status, organization_id, final_message\)\s+VALUES \(enr_a, step_a1/);
  // Ni modèle système, ni InMail programmé.
  assert.match(block, /'Relance recommandée', '\[\]'::jsonb, true/);
  assert.match(block, /'scheduled', now\(\), org_b, u_b/);
  // B ne lit pas les inscriptions ni les exécutions de A ; A lit ses statistiques.
  assert.match(block, /FROM public\.sequence_enrollments WHERE id = enr_a/);
  assert.match(block, /FROM public\.sequence_analytics WHERE sequence_id = seq_a/);
  assert.match(block, /RAISE EXCEPTION 'rls_two_orgs_audit \(séquences\) : contrôles en échec %'/);
  // Deux utilisateurs seulement (chaque ligne auth.users coûte cher en prod).
  assert.doesNotMatch(block, /INSERT INTO auth\.users/);
});

// ---------------------------------------------------------------- SEQ-120
test('SEQ-120 — le script de réparation ne travaille que sur des ids vérifiés, dans leur organisation', () => {
  const raw = read('scripts/repair-false-replied-enrollments.sql');
  const code = stripSql(raw);
  // Hors commentaires : diagnostic en lecture seule, aucune écriture.
  assert.doesNotMatch(code, /\b(UPDATE|DELETE|INSERT)\b/);
  // Réparations (commentées) bornées à la liste vérifiée et au couple candidat + organisation.
  assert.match(raw, /CREATE TEMP TABLE verified/);
  assert.match(raw, /AND jcs\.organization_id = e\.organization_id/);
  assert.match(raw, /SELECT DISTINCT ON \(sse\.enrollment_id\)/);
  assert.doesNotMatch(raw, /candidate_id IN \(SELECT profile_id FROM/);
});

// ---------------------------------------------------------------- SEQ-218
test('SEQ-218 — les scripts de test exigent une organisation explicite et ne nettoient qu’elle', () => {
  for (const f of ['test-sequences-exhaustive', 'test-sequences-safe', 'test-sequences-part2-data']) {
    const raw = read(`scripts/${f}.sql`);
    const code = stripSql(raw);
    assert.doesNotMatch(code, /FROM organizations LIMIT 1/, `${f} : première organisation venue`);
    assert.match(code, /v_org_id uuid := NULL;/, `${f} : organisation à renseigner`);
    assert.match(code, /IF v_org_id IS NULL THEN\s+RAISE EXCEPTION/, `${f} : refus sans organisation`);
    assert.match(raw, /RÉSERVÉ À UNE BASE LOCALE/, `${f} : en-tête`);
    for (const del of code.matchAll(/DELETE FROM (\w+) WHERE[^;]*;/g)) {
      assert.match(del[0], /organization_id = v_org_id/, `${f} : nettoyage hors organisation (${del[1]})`);
    }
  }
});
