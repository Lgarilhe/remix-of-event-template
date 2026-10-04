/**
 * Refonte mission, lot 3 (carte « Maintenant ») : garde-fous statiques de la base.
 *
 * Même forme que lot0c-lectures.test.mjs : lecture du source et assertions
 * sur les motifs, sans base ni navigateur. Les audits SQL (supabase/tests/
 * mission_attention_audit.sql et mission_action_snoozes_audit.sql) prouvent le
 * comportement ; ce fichier garde la forme : une seule migration par sujet,
 * droits, absence de SECURITY DEFINER, noms de policy, cascades, types.ts à
 * jour, audits cités par la CI.
 *
 * Lancer : node --test tests/c1/lot3-base.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre (ex. une extraction de HEAD).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// Dernière migration du lot 0c-4 : celles du lot 3 doivent lui être postérieures.
const LAST_BEFORE_LOT3 = '20261004070344';

const migrations = () => readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'));

// Une seule migration pour un sujet : son fichier.
function oneMigration(suffix) {
  const files = migrations().filter((f) => new RegExp(`^\\d{14}_${suffix}\\.sql$`).test(f));
  assert.equal(files.length, 1, `une seule migration *_${suffix}.sql attendue, trouvé : ${files.join(', ') || 'aucune'}`);
  return files[0];
}

// Le SQL sans ses commentaires de ligne : les assertions « jamais » ne se
// déclenchent pas sur une phrase d'explication.
const code = (sql) => sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

const attentionFile = () => oneMigration('refonte_mission_lot3_attention');
const snoozesFile = () => oneMigration('refonte_mission_lot3_plus_tard');
const attentionSql = () => read(join('supabase/migrations', attentionFile()));
const snoozesSql = () => read(join('supabase/migrations', snoozesFile()));

// ─── Une migration par sujet ────────────────────────────────────────────────

test('lot 3 : une seule migration par sujet, horodatages distincts et postérieurs au lot 0c-4', () => {
  const a = attentionFile().slice(0, 14);
  const s = snoozesFile().slice(0, 14);
  assert.notEqual(a, s, 'deux migrations du lot 3 portent le même horodatage');
  assert.ok(a > LAST_BEFORE_LOT3 && s > LAST_BEFORE_LOT3, 'horodatage antérieur au lot 0c-4');
  // Un horodatage unique sur tout le dossier (deux fichiers de même version cassent db push).
  const versions = migrations().map((f) => f.slice(0, 14));
  assert.equal(new Set(versions).size, versions.length, 'deux migrations de même version');
});

test('lot 3 : get_mission_attention, ses aides et la table ne sont définies que dans leur migration', () => {
  const definitions = [
    [/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.get_mission_attention\b/i, attentionFile()],
    [/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.is_go_recommendation\b/i, attentionFile()],
    [/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.job_details_is_described\b/i, attentionFile()],
    [/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?public\.mission_action_snoozes\b/i, snoozesFile()],
  ];
  for (const [re, owner] of definitions) {
    const where = migrations().filter((f) => re.test(code(read(join('supabase/migrations', f)))));
    assert.deepEqual(where, [owner], `${re} défini hors de ${owner} : ${where.join(', ')}`);
  }
});

test('lot 3 : aucune des deux migrations ne cite la nouvelle page (garde de lot12-mission-v3)', () => {
  for (const sql of [attentionSql(), snoozesSql()]) {
    assert.doesNotMatch(sql, /mission-v3|missionBeta/);
  }
});

// ─── get_mission_attention ──────────────────────────────────────────────────

test('lot 3 : get_mission_attention est SECURITY INVOKER, STABLE, sans SECURITY DEFINER', () => {
  const sql = code(attentionSql());
  assert.doesNotMatch(sql, /SECURITY\s+DEFINER/i, 'aucune fonction SECURITY DEFINER dans la migration de l\'attention');
  const m = sql.match(/CREATE OR REPLACE FUNCTION public\.get_mission_attention\([\s\S]*?\n\$\$;/);
  assert.ok(m, 'corps de get_mission_attention introuvable');
  assert.match(m[0], /SECURITY INVOKER/);
  assert.match(m[0], /\bSTABLE\b/);
  assert.match(m[0], /SET search_path = public, pg_temp/);
});

test('lot 3 : get_mission_attention, EXECUTE à authenticated seulement (jamais anon, jamais service_role)', () => {
  const sql = code(attentionSql());
  const sig = 'public\\.get_mission_attention\\(uuid\\[\\], integer, integer, integer\\)';
  assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION ${sig}\\s+FROM PUBLIC, anon, authenticated, service_role;`));
  const grants = [...sql.matchAll(new RegExp(`GRANT EXECUTE ON FUNCTION ${sig} TO ([^;]+);`, 'g'))].map((g) => g[1].trim());
  assert.deepEqual(grants, ['authenticated'], `GRANT de get_mission_attention : ${grants.join(' | ')}`);
});

test('lot 3 : les aides ne sont ni à PUBLIC ni à anon, IMMUTABLE', () => {
  const sql = code(attentionSql());
  for (const [name, args] of [['is_go_recommendation', 'text'], ['job_details_is_described', 'jsonb']]) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(${args}\\) FROM PUBLIC, anon;`), `${name} : REVOKE`);
    const grants = [...sql.matchAll(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(${args}\\) TO ([^;]+);`, 'g'))].map((g) => g[1].trim());
    assert.ok(grants.length === 1 && !/anon|public/i.test(grants[0]), `${name} : GRANT ${grants.join(' | ')}`);
    const m = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`));
    assert.ok(m && /\bIMMUTABLE\b/.test(m[0]), `${name} : IMMUTABLE`);
  }
});

test('lot 3 : get_mission_attention filtre la vue par project_id (sous les fenêtres) et l\'organisation de l\'appelant', () => {
  const sql = code(attentionSql());
  // Le filtre sur le paramètre descend sous les fenêtres de mission_candidate_rows.
  assert.match(sql, /FROM public\.mission_candidate_rows c\s+WHERE c\.project_id = ANY \(p_project_ids\)/);
  // Missions de l'organisation de l'appelant seulement, jamais un filtre conditionné au rôle courant.
  assert.match(sql, /get_user_org_id\(auth\.uid\(\)\)/);
  assert.match(sql, /JOIN org ON sp\.organization_id = org\.id/);
  assert.doesNotMatch(sql, /current_user\s*<>/);
  // Réponses sans suite : définition du lien, plafond d'ancienneté, plafond de lignes.
  assert.match(sql, /mc\.last_inbound_at > coalesce\(mc\.last_outbound_at, '-infinity'::timestamptz\)/);
  assert.match(sql, /least\(greatest\(coalesce\(p_item_limit, 5\), 0\), 200\)/);
  assert.match(sql, /p_reply_days integer DEFAULT 30/);
  // Les écartés et les embauchés n'attendent pas de réponse.
  assert.match(sql, /NOT IN \('rejected', 'hired'\)/);
  // Aucune écriture : lecture seule.
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE)\b\s+(INTO\s+|FROM\s+)?public\./i);
});

test('lot 3 : l\'attention ne crée ni table ni policy', () => {
  const sql = code(attentionSql());
  assert.doesNotMatch(sql, /CREATE\s+TABLE|CREATE\s+POLICY|ALTER\s+TABLE|CREATE\s+TRIGGER|CREATE\s+(OR\s+REPLACE\s+)?VIEW/i);
});

// ─── mission_action_snoozes ─────────────────────────────────────────────────

test('lot 3 : mission_action_snoozes, trois policies nommées, aucune autre', () => {
  const sql = code(snoozesSql());
  const policies = [...sql.matchAll(/CREATE POLICY (\w+) ON public\.mission_action_snoozes\s+([\s\S]*?);/g)]
    .map((m) => ({ name: m[1], body: m[2] }));
  assert.deepEqual(policies.map((p) => p.name).sort(), ['mission_same_org_insert', 'mission_same_org_update', 'own_rows_all']);
  const by = Object.fromEntries(policies.map((p) => [p.name, p.body]));
  assert.match(by.own_rows_all, /FOR ALL TO authenticated/);
  assert.match(by.own_rows_all, /USING \(user_id = auth\.uid\(\)\)/);
  assert.match(by.own_rows_all, /WITH CHECK \(user_id = auth\.uid\(\)\)/);
  assert.doesNotMatch(by.own_rows_all, /RESTRICTIVE/);
  for (const [name, cmd] of [['mission_same_org_insert', 'INSERT'], ['mission_same_org_update', 'UPDATE']]) {
    assert.match(by[name], new RegExp(`AS RESTRICTIVE FOR ${cmd} TO authenticated`), `${name} : RESTRICTIVE ${cmd}`);
    assert.match(by[name], /project_organization_id\(project_id\) = public\.get_user_org_id\(auth\.uid\(\)\)/, `${name} : organisation de l'auteur`);
  }
  assert.match(sql, /ALTER TABLE public\.mission_action_snoozes ENABLE ROW LEVEL SECURITY;/);
});

test('lot 3 : mission_action_snoozes, privilèges (rien pour anon), clé unique, cascades, format de clé', () => {
  const sql = code(snoozesSql());
  assert.match(sql, /REVOKE ALL ON public\.mission_action_snoozes FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON public\.mission_action_snoozes TO authenticated;/);
  assert.match(sql, /GRANT ALL ON public\.mission_action_snoozes TO service_role;/);
  assert.doesNotMatch(sql, /GRANT[^;]*\banon\b/i);
  assert.match(sql, /CONSTRAINT mission_action_snoozes_key UNIQUE \(user_id, project_id, action_key\)/);
  assert.match(sql, /user_id\s+uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
  assert.match(sql, /project_id\s+uuid NOT NULL REFERENCES public\.sourcing_projects\(id\) ON DELETE CASCADE/);
  assert.match(sql, /action_key ~ '\^\[a-z\]\[a-z0-9_\]\*\(:\.\+\)\?\$'/);
  assert.match(sql, /char_length\(action_key\) <= 200/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_mission_action_snoozes_project/);
  assert.match(sql, /BEFORE UPDATE ON public\.mission_action_snoozes[\s\S]*?update_updated_at_column\(\)/);
});

test('lot 3 : mission_action_snoozes, pas de SECURITY DEFINER, aucun lien avec le chiffre d\'À traiter', () => {
  const sql = code(snoozesSql());
  assert.doesNotMatch(sql, /SECURITY\s+DEFINER/i);
  assert.doesNotMatch(sql, /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i, 'aucune fonction nouvelle : l\'audit générique reste inchangé');
  // La barre lit notifications et candidate_reminders : cette table n'y touche pas.
  assert.doesNotMatch(sql, /\b(notifications|candidate_reminders)\b/);
  // La précondition lève une exception claire si une aide manque.
  assert.match(sql, /to_regprocedure\('public\.project_organization_id\(uuid\)'\) IS NULL/);
});

test('lot 3 : la purge pg_cron est protégée par la présence de l\'extension', () => {
  const sql = code(snoozesSql());
  assert.match(sql, /IF EXISTS \(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'\) THEN/);
  assert.match(sql, /cron\.schedule\(\s*'purge-mission-action-snoozes'/);
});

// ─── types.ts, audits, CI ───────────────────────────────────────────────────

// Bloc d'une fonction ou d'une table dans types.ts : de sa déclaration à la suivante, à la même indentation.
function typesBlock(types, name, indent) {
  const start = types.indexOf(`\n${indent}${name}: {`);
  assert.ok(start >= 0, `${name} absent de types.ts`);
  const rest = types.slice(start + 1);
  const end = rest.slice(1).search(new RegExp(`\\n${indent}\\w+: [{A-Z]`));
  return end < 0 ? rest : rest.slice(0, end + 1);
}

test('lot 3 : types.ts déclare get_mission_attention comme la migration (arguments et colonnes)', () => {
  const types = read('src/integrations/supabase/types.ts');
  const sql = code(attentionSql());
  const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.get_mission_attention\(([\s\S]*?)\)\s*RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE/);
  assert.ok(fn, 'signature de get_mission_attention introuvable');
  const args = [...fn[1].matchAll(/(p_\w+)\s+[\w\[\]]+(\s+DEFAULT\s+\S+)?/g)].map((m) => ({ name: m[1], optional: !!m[2] }));
  const cols = [...fn[2].matchAll(/^\s*(\w+)\s+[\w\[\]]+/gm)].map((m) => m[1]);
  assert.equal(args.length, 4);
  assert.equal(cols.length, 13);
  const block = typesBlock(types, 'get_mission_attention', '      ');
  const argsBlock = block.match(/Args: \{([\s\S]*?)\}\s*Returns:/);
  assert.ok(argsBlock, 'Args de get_mission_attention introuvables');
  for (const a of args) {
    assert.match(argsBlock[1], new RegExp(`\\b${a.name}${a.optional ? '\\?' : ''}: `), `argument ${a.name}${a.optional ? ' (optionnel)' : ''}`);
  }
  const returns = block.slice(block.indexOf('Returns:'));
  for (const c of cols) {
    assert.match(returns, new RegExp(`\\b${c}: `), `colonne ${c} absente de types.ts`);
  }
  assert.equal([...returns.matchAll(/^\s{10}\w+: /gm)].length, cols.length, 'colonnes en trop ou en moins dans types.ts');
});

test('lot 3 : types.ts déclare les aides et la table des reports', () => {
  const types = read('src/integrations/supabase/types.ts');
  assert.match(types, /is_go_recommendation: \{ Args: \{ r: string \}; Returns: boolean \}/);
  assert.match(types, /job_details_is_described: \{ Args: \{ jd: Json \}; Returns: boolean \}/);
  const table = typesBlock(types, 'mission_action_snoozes', '      ');
  for (const col of ['action_key', 'created_at', 'expires_at', 'id', 'project_id', 'updated_at', 'user_id']) {
    assert.equal([...table.matchAll(new RegExp(`\\b${col}\\??: `, 'g'))].length, 3, `${col} : Row, Insert et Update`);
  }
  assert.match(table, /Insert: \{[\s\S]*?action_key: string[\s\S]*?expires_at: string[\s\S]*?project_id: string[\s\S]*?user_id: string/);
  assert.match(table, /foreignKeyName: "mission_action_snoozes_project_id_fkey"/);
});

test('lot 3 : les audits existent, ne touchent pas la production, et la CI de base neuve les joue', () => {
  const e2e = read('.github/workflows/e2e.yml');
  for (const audit of ['mission_attention_audit.sql', 'mission_action_snoozes_audit.sql']) {
    assert.ok(existsSync(join(ROOT, 'supabase/tests', audit)), `${audit} absent`);
    assert.match(e2e, new RegExp(`-c 'BEGIN;' -f supabase/tests/${audit.replace('.', '\\.')} -c 'ROLLBACK;'`), `e2e.yml ne joue pas ${audit}`);
    const sql = read(join('supabase/tests', audit));
    // Jamais d'appel sous SET ROLE anon : l'image locale plante sur un refus (CLAUDE.md).
    assert.doesNotMatch(sql, /SET\s+(LOCAL\s+)?ROLE\s+anon/i, `${audit} : appel sous SET ROLE anon`);
  }
  // Appels anonymes réels par l'API : refus attendu (401, 42501).
  for (const fn of ['get_mission_attention', 'is_go_recommendation', 'job_details_is_described']) {
    assert.match(e2e, new RegExp(`'${fn}\\|\\{`), `e2e.yml : appel anonyme de ${fn}`);
  }
  assert.match(e2e, /rest\/v1\/mission_action_snoozes\?select=id&limit=1/);
});

test('lot 3 : l\'audit de l\'attention couvre les cas et les bornes de la décision', () => {
  const sql = read('supabase/tests/mission_attention_audit.sql');
  for (const motif of [
    'R1 ', 'R2 ', 'R3 ', 'R4 ', 'R5 ', 'R6 ', 'R7 ', 'R8 ', 'R9 ', 'R10 ', 'R11 ', 'R12 ', 'R13 ', 'R14 ', 'R15 ', 'R16 ', 'R17 ',
    'R19 ', 'R20 ', 'I1 ', 'T1 ', 'J1 ', 'P1 ', 'P2 ', 'P3 ', 'F1 ', 'F2 ', 'S4 ',
  ]) {
    assert.ok(sql.includes(`'${motif}`), `contrôle ${motif.trim()} absent de mission_attention_audit.sql`);
  }
  // Borne stricte d'un entretien de 5 jours exactement, et réponse de 7 jours exactement.
  assert.match(sql, /interval '5 days'\)/);
  assert.match(sql, /I-5d1s/);
});

test('lot 3 : le rapprochement lien et ligne se fait par tri, jamais par un balayage des lignes par lien', () => {
  const sql = code(attentionSql());
  // Un LATERAL (ou une boucle) sur le CTE v rejoue toutes les lignes de toutes les missions pour chaque
  // réponse en attente : coût lignes x liens, mesuré à 90 s sur 100 000 lignes et 4 000 réponses.
  assert.doesNotMatch(sql, /JOIN\s+LATERAL\s*\(\s*SELECT[^)]*FROM\s+v\b/i, 'jointure LATERAL sur le CTE v');
  assert.match(sql, /first_value\(/i, 'le rapprochement doit se faire par fenêtre (first_value)');
  // L'audit lit un volume sous un seuil de durée (le jeu des cas, de quelques dizaines de lignes, ne le voit pas).
  const audit = read('supabase/tests/mission_attention_audit.sql');
  assert.match(audit, /generate_series\(1, 3000\)/, 'volume de lignes absent de l\'audit');
  assert.match(audit, /P3 durée/, 'seuil de durée absent de l\'audit');
});
