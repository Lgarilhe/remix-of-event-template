/**
 * Garde statique de la bascule des identifiants de compte (API v1 vers API v2) :
 * migration *_provider_account_id_remap.sql, audit SQL, requête de contrôle du
 * propriétaire, fonction supabase/functions/unipile-migration.
 *
 * Invariants :
 *   - ARM-1 le registre des colonnes de la migration est identique à la liste « remapped » de
 *     supabase/tests/provider_id_columns_check.sql, et les colonnes « report_only » y sont
 *     justifiées (liste laissée telle quelle ou clé jsonb) ;
 *   - ARM-2 l'ordre : les inscriptions de séquence avant toute table de liaison member_*_accounts
 *     (déclencheur sequence_enrollments_check_sender_owner_update, voir l'audit, section 5) ;
 *   - ARM-3 les deux tables ont la RLS active, aucune policy, aucun droit pour PUBLIC, anon ni
 *     authenticated ; les sept fonctions retirent EXECUTE à PUBLIC, anon et authenticated, le
 *     donnent à service_role, et les quatre SECURITY DEFINER fixent search_path ;
 *   - ARM-4 la requête de contrôle est en lecture seule (aucune écriture, aucun appel aux
 *     fonctions de bascule) ;
 *   - ARM-5 l'audit SQL est câblé dans e2e.yml et vérifie l'ordre des écritures ;
 *   - ARM-6 la fonction : section verify_jwt = false, porte administrateur AVANT la lecture du
 *     corps, aucun appel direct au prestataire (ni fetch, ni /api/v1), aucune chaîne de texte qui
 *     nomme le prestataire (les noms de variables d'environnement lus sont listés) ;
 *   - ARM-7 la confirmation exacte de la bascule est contrôlée avant toute lecture ;
 *   - ARM-9 CORS : liste d'origines partagée, jamais le joker ; l'annulation d'un lot exige son mot ;
 *   - ARM-10 aucun identifiant de compte entier dans les réponses ; l'empreinte du plan est contrôlée
 *     avant la première écriture ; le temps compte depuis le début de la demande ; lecture ordonnée ;
 *   - ARM-11 les colonnes sautées et les identifiants sans compte relié ne sont pas passés sous silence ;
 *   - ARM-12 aucun texte rendu ne parle de « paire » (on dit « compte »).
 *
 * Lancer : node --test tests/c1/account-remap.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const FN_DIR = join(ROOT, 'supabase/functions/unipile-migration');

const migrationFile = readdirSync(MIGRATIONS).filter((name) => /_provider_account_id_remap\.sql$/.test(name));
const read = (path) => readFileSync(path, 'utf8');
const sql = () => read(join(MIGRATIONS, migrationFile[0]));
const checkSql = () => read(join(ROOT, 'supabase/tests/provider_id_columns_check.sql'));
const auditSql = () => read(join(ROOT, 'supabase/tests/account_remap_audit.sql'));

/** Lignes du registre : (ord, 'table', 'colonne', 'type', 'mode', filtre, note). */
function registryRows() {
  const text = sql();
  const start = text.indexOf('FROM (VALUES');
  assert.ok(start > -1, 'registre introuvable dans la migration');
  const end = text.indexOf(') AS v(ord, table_name', start);
  const rows = [...text.slice(start, end).matchAll(/^\s*\((\d+),\s*'([a-z_]+)',\s*'([a-z_]+)',\s*'([a-z_]+)',\s*'(remap|report_only)'/gm)];
  return rows.map((m) => ({ ord: Number(m[1]), table: m[2], column: m[3], kind: m[4], mode: m[5] }));
}

test('ARM-0 une seule migration de bascule, au nom horodaté', () => {
  assert.equal(migrationFile.length, 1, `migrations trouvées : ${migrationFile.join(', ')}`);
  assert.match(migrationFile[0], /^\d{14}_provider_account_id_remap\.sql$/);
});

test('ARM-1 registre de la migration = liste « remapped » de la requête de contrôle', () => {
  const remap = registryRows().filter((r) => r.mode === 'remap').map((r) => `${r.table}.${r.column}`).sort();
  assert.ok(remap.length >= 18, `${remap.length} colonnes au registre`);
  const text = checkSql();
  const block = text.slice(text.indexOf('remapped(table_name, column_name)'), text.indexOf('left_alone(table_name'));
  const listed = [...block.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map((m) => `${m[1]}.${m[2]}`).sort();
  assert.deepEqual(listed, remap, 'la requête de contrôle et le registre de la migration ont divergé');
  // Aucun doublon.
  assert.equal(new Set(remap).size, remap.length);
});

test('ARM-1b les colonnes « report_only » sont justifiées dans la requête de contrôle', () => {
  const text = checkSql();
  for (const row of registryRows().filter((r) => r.mode === 'report_only')) {
    assert.ok(
      text.includes(`'${row.table}', '${row.column}'`) || (text.includes(`'${row.table}'`) && text.includes(row.column)),
      `${row.table}.${row.column} n'est pas justifiée dans provider_id_columns_check.sql`,
    );
  }
});

test('ARM-2 les inscriptions de séquence passent avant toutes les tables de liaison', () => {
  const rows = registryRows().filter((r) => r.mode === 'remap');
  const enrollments = rows.filter((r) => r.table === 'sequence_enrollments').map((r) => r.ord);
  const members = rows.filter((r) => /^member_.*_accounts$/.test(r.table)).map((r) => r.ord);
  assert.ok(enrollments.length >= 2 && members.length === 4, `${enrollments.length} colonnes d'inscription, ${members.length} liaisons`);
  assert.ok(Math.max(...enrollments) < Math.min(...members), 'une liaison member_*_accounts est écrite avant une inscription');
  // La restauration suit le même ordre de tables (même raison) : elle lit le même registre.
  const text = sql();
  // Trois lectures : la bascule, la restauration, et le comptage des lignes restées au nouvel identifiant.
  assert.equal([...text.matchAll(/FROM public\.provider_account_id_columns\(\) c WHERE c\.mode = 'remap' ORDER BY c\.ord/g)].length, 3,
    'la bascule et la restauration lisent le registre dans le même ordre');
});

test('ARM-3 tables fermées et fonctions réservées à service_role', () => {
  const text = sql();
  for (const table of ['account_id_remap', 'account_id_remap_backup']) {
    assert.match(text, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`), `${table} : RLS`);
    assert.match(text, new RegExp(`REVOKE ALL ON public\\.${table} FROM PUBLIC, anon, authenticated`), `${table} : droits retirés`);
    assert.match(text, new RegExp(`GRANT ALL ON public\\.${table} TO service_role`), `${table} : service_role`);
  }
  assert.doesNotMatch(text, /CREATE POLICY/i, 'aucune policy sur les tables de sauvegarde');
  const signatures = [
    'provider_account_id_columns()',
    'provider_account_id_column_state(text, text, text)',
    'provider_account_id_row_match(text, text, text, text, boolean)',
    'provider_account_id_usage(text)',
    'provider_account_id_orphans(integer)',
    'remap_provider_account_id(uuid, text, text, text, uuid)',
    'rollback_provider_account_id_remap(uuid)',
  ];
  for (const signature of signatures) {
    const escaped = signature.replace(/[()]/g, '\\$&');
    assert.match(text, new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped} FROM PUBLIC, anon, authenticated`), `${signature} : REVOKE`);
    assert.match(text, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${escaped} TO service_role`), `${signature} : GRANT`);
  }
  for (const name of ['provider_account_id_usage', 'provider_account_id_orphans', 'remap_provider_account_id', 'rollback_provider_account_id_remap']) {
    const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    const header = text.slice(start, text.indexOf('AS $$', start));
    assert.match(header, /SECURITY DEFINER/, `${name} : SECURITY DEFINER`);
    assert.match(header, /SET search_path = public, pg_temp/, `${name} : search_path fixé`);
  }
});

test('ARM-3b la bascule est une seule transaction : aucun COMMIT ni ROLLBACK dans les fonctions', () => {
  const text = sql().replace(/--.*$/gm, '');
  assert.doesNotMatch(text, /\bCOMMIT\b/);
  assert.doesNotMatch(text, /\bROLLBACK\b/);
});

test('ARM-4 la requête de contrôle est en lecture seule', () => {
  const text = checkSql().replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO)\b/i);
  assert.doesNotMatch(text, /remap_provider_account_id|rollback_provider_account_id_remap|provider_account_id_/);
  assert.equal([...text.matchAll(/;/g)].length, 1, 'une seule instruction');
  assert.match(text.trim(), /^WITH\b/);
});

test('ARM-5 l\'audit SQL est câblé dans e2e.yml et prouve l\'ordre des écritures', () => {
  const yml = read(join(ROOT, '.github/workflows/e2e.yml'));
  assert.match(yml, /supabase\/tests\/account_remap_audit\.sql/);
  assert.match(yml, /account_id_remap_backup/);
  const audit = auditSql();
  assert.match(audit, /ENROLL_ACCOUNT_OF_OTHER_MEMBER/);
  assert.match(audit, /ordre inverse/);
  assert.match(audit, /rollback_provider_account_id_remap/);
  // Aucun appel sous SET ROLE anon ou authenticated (CLAUDE.md : supautils fait tomber le serveur).
  assert.doesNotMatch(audit.replace(/--.*$/gm, ''), /SET\s+(LOCAL\s+)?ROLE/i);
});

// ---------------------------------------------------------------------------
// La fonction
// ---------------------------------------------------------------------------

const SOURCES = readdirSync(FN_DIR).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts')).sort();
const source = (name) => read(join(FN_DIR, name));

/** Chaînes de texte d'un fichier TypeScript (hors spécificateurs d'import et d'export). */
function stringLiterals(name) {
  const file = ts.createSourceFile(name, source(name), ts.ScriptTarget.ES2022, true);
  const out = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    else if (ts.isTemplateExpression(node)) out.push(node.head.text, ...node.templateSpans.map((span) => span.literal.text));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

test('ARM-6a la fonction a sa section verify_jwt = false', () => {
  const toml = read(join(ROOT, 'supabase/config.toml'));
  assert.match(toml, /^\[functions\.unipile-migration\]\s*\nverify_jwt = false\s*$/m);
});

test('ARM-6b la porte administrateur ferme avant la lecture du corps, de la base et du service', () => {
  const handler = source('handler.ts');
  const gate = handler.indexOf('platformAdminGate(auth.userId');
  assert.ok(gate > -1, 'handleRequest n\'appelle pas platformAdminGate');
  for (const later of ['req.json()', 'deps.createAdmin()', 'handleReadiness(', 'handlePreview(', 'handleApply(', 'handleRollback(']) {
    const at = handler.indexOf(later, handler.indexOf('async function route('));
    assert.ok(at > gate, `${later} avant la porte`);
  }
  const gateSource = source('gate.ts');
  assert.match(gateSource, /allow\.length === 0/, 'liste vide = porte fermée');
});

test('ARM-6c aucun appel direct au prestataire : ni fetch, ni /api/v1, ni hôte', () => {
  for (const name of SOURCES) {
    const text = source(name);
    assert.doesNotMatch(text, /\bfetch\s*\(/, `${name} : fetch`);
    assert.doesNotMatch(text, /\/api\/v1/, `${name} : /api/v1`);
    // UNIPILE_DSN n'est lu que par handler.ts, pour dire si l'ancien secret est encore défini (booléen) :
    // jamais pour appeler le prestataire.
    assert.doesNotMatch(text, /resolveUnipileCredentials|api\.unipile\.com/, `${name} : ancien accès`);
  }
});

test('ARM-6d aucune chaîne de texte ne nomme le prestataire, sauf les noms de variables lues', () => {
  const ALLOWED_ENV = new Set(['UNIPILE_V2_WEBHOOK_TOKEN', 'UNIPILE_WEBHOOK_SECRET', 'UNIPILE_API_KEY', 'UNIPILE_DSN']);
  for (const name of SOURCES) {
    for (const text of stringLiterals(name)) {
      if (!/unipile/i.test(text)) continue;
      const allowed = ALLOWED_ENV.has(text) || text.startsWith('[unipile-migration]');
      assert.ok(allowed, `${name} : chaîne « ${text} »`);
    }
  }
  // Les noms de variables ne sont lus que par handler.ts et jamais renvoyés.
  for (const name of SOURCES.filter((n) => n !== 'handler.ts')) {
    assert.doesNotMatch(source(name).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /UNIPILE_[A-Z_]+/, `${name} : variable d'environnement`);
  }
});

test('ARM-6e aucune chaîne de texte ne contient de tiret long', () => {
  for (const name of SOURCES) {
    for (const text of stringLiterals(name)) assert.ok(!text.includes('—'), `${name} : « ${text} »`);
  }
});

test('ARM-7 la confirmation de la bascule est contrôlée avant toute lecture', () => {
  const handler = source('handler.ts');
  const apply = handler.slice(handler.indexOf('export async function handleApply'));
  const early = apply.indexOf('applyRefusal(');
  const firstRead = apply.indexOf('loadService(');
  assert.ok(early > -1 && firstRead > early, 'applyRefusal doit précéder la première lecture');
  assert.match(source('plan.ts'), /export const CONFIRM_WORD = 'BASCULER'/);
});

test('ARM-8 les écritures passent par les fonctions SQL, jamais par un update de table', () => {
  const handler = source('handler.ts');
  assert.doesNotMatch(handler, /\.(update|insert|upsert|delete)\(/);
  assert.match(handler, /rpc\('remap_provider_account_id'/);
  assert.match(handler, /rpc\('rollback_provider_account_id_remap'/);
});

// ---------------------------------------------------------------------------
// Revue du 12/10/2026 : colonnes sautées, identifiants isolés, empreinte, annulation, CORS
// ---------------------------------------------------------------------------

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');

test('ARM-9a CORS : la liste d\'origines de _shared/cors.ts, jamais le joker, pour la réponse et le refus d\'authentification', () => {
  const handler = stripComments(source('handler.ts'));
  assert.match(handler, /from '\.\.\/_shared\/cors\.ts'/);
  assert.match(handler, /buildCorsHeaders\(req\)/);
  assert.doesNotMatch(handler, /Access-Control-Allow-Origin/i, 'en-tête d\'origine écrit à la main');
  assert.doesNotMatch(handler, /'\*'/, 'joker');
  assert.match(handler, /deps\.authenticate\(req, cors\)/, 'le refus de requireAuth porte les mêmes en-têtes');
});

test('ARM-9b l\'annulation d\'un lot exige son mot avant d\'appeler la base', () => {
  const handler = source('handler.ts');
  const rollback = handler.slice(handler.indexOf('export async function handleRollback'));
  const confirmAt = rollback.indexOf('ROLLBACK_CONFIRM_WORD');
  assert.ok(confirmAt > -1 && confirmAt < rollback.indexOf("rpc('rollback_provider_account_id_remap'"), 'mot contrôlé après l\'appel');
  assert.match(source('plan.ts'), /export const ROLLBACK_CONFIRM_WORD = 'ANNULER'/);
});

test('ARM-10a aucune réponse ne rend un identifiant de compte entier (ancien ou nouveau)', () => {
  const handler = stripComments(source('handler.ts'));
  assert.doesNotMatch(handler, /\bold_id\b|\bnew_id\b/, 'clé old_id ou new_id dans une réponse');
  assert.match(handler, /\.\.\.who/, 'les résultats portent le type, le libellé masqué et la fin de l\'identifiant');
});

test('ARM-10b l\'empreinte du plan est contrôlée avant la première écriture, après le contrôle de la confirmation', () => {
  const handler = source('handler.ts');
  const apply = handler.slice(handler.indexOf('export async function handleApply'), handler.indexOf('export async function handleRollback'));
  const fingerprint = apply.indexOf('planFingerprint(plan)');
  const write = apply.indexOf("rpc('remap_provider_account_id'");
  assert.ok(fingerprint > apply.indexOf('applyRefusal(') && fingerprint > -1 && fingerprint < write, 'empreinte contrôlée après la première écriture');
  assert.match(apply, /body\.plan_fingerprint !== fingerprint/);
  assert.match(apply, /error_code: 'plan_changed'/);
  assert.match(handler, /plan_fingerprint: await planFingerprint\(plan\)/, 'la simulation rend l\'empreinte');
});

test('ARM-10c le temps de la conversion compte depuis le début de la demande, sous les 55 s du navigateur', () => {
  const handler = source('handler.ts');
  const apply = handler.slice(handler.indexOf('export async function handleApply'));
  assert.ok(apply.indexOf('const startedAt = deps.now()') < apply.indexOf('loadService('), 'horloge lancée après les lectures');
  const budget = Number(/APPLY_BUDGET_MS = ([\d_]+)/.exec(handler)?.[1].replace(/_/g, ''));
  assert.ok(budget > 0 && budget <= 30_000, `budget de ${budget} ms`);
});

test('ARM-10d la lecture des comptes de la base est ordonnée sur la clé primaire et refuse une table trop longue', () => {
  const handler = stripComments(source('handler.ts'));
  const readAll = handler.slice(handler.indexOf('async function readAll'), handler.indexOf('const str ='));
  assert.match(readAll, /\.order\('id', \{ ascending: true \}\)/);
  assert.match(readAll, /MAX_PAGES \* PAGE\} rows`\);\s*return null;/, 'plafond atteint = lecture en échec');
});

test('ARM-11a la migration compte les lignes d\'une colonne de type inattendu, dans l\'usage et dans la bascule', () => {
  const text = sql();
  const usage = text.slice(text.indexOf('CREATE OR REPLACE FUNCTION public.provider_account_id_usage'), text.indexOf('-- --- 4. Bascule'));
  const remap = text.slice(text.indexOf('CREATE OR REPLACE FUNCTION public.remap_provider_account_id'), text.indexOf('-- --- 5. Restauration'));
  assert.match(usage, /IF s\.status = 'unsupported_type' THEN[\s\S]*row_match\(r\.kind, r\.column_name, r\.row_filter, p_old, true\)/);
  assert.match(remap, /IF s\.status IN \('ok', 'unsupported_type'\) THEN/);
  assert.match(remap, /'skipped_rows', v_count/);
  // Le comptage large ne sert jamais à écrire : la réécriture appelle row_match sans le drapeau.
  assert.match(remap, /v_match := public\.provider_account_id_row_match\(r\.kind, r\.column_name, r\.row_filter, p_old, false\)/);
});

test('ARM-11b la restauration compte les lignes qui portent encore le nouvel identifiant', () => {
  const text = sql();
  const rollback = text.slice(text.indexOf('CREATE OR REPLACE FUNCTION public.rollback_provider_account_id_remap'));
  assert.match(rollback, /'still_new_rows', v_still_total, 'still_new', v_still/);
  const counting = rollback.indexOf('FOR q IN SELECT DISTINCT m.new_id');
  assert.ok(counting > -1 && counting < rollback.indexOf('UPDATE public.account_id_remap SET rolled_back_at'), 'compté après les paires, avant le marquage du lot');
});

test('ARM-11c les identifiants sans compte relié : fonction en lecture seule, rendue par la simulation, listée par la requête du propriétaire', () => {
  const text = sql();
  const orphans = text.slice(text.indexOf('CREATE OR REPLACE FUNCTION public.provider_account_id_orphans'), text.indexOf('COMMENT ON FUNCTION public.remap_provider_account_id'));
  assert.doesNotMatch(orphans.replace(/--.*$/gm, ''), /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i, 'la fonction des identifiants isolés écrit');
  assert.match(source('handler.ts'), /rpc\('provider_account_id_orphans'/);
  const check = checkSql();
  assert.match(check, /orphan_rows AS/);
  assert.match(check, /'orphelin'::text/);
});

test('ARM-12 aucun texte rendu par la fonction ne parle de « paire », de point de terminaison ni de jeton', () => {
  for (const name of SOURCES) {
    for (const text of stringLiterals(name)) {
      assert.doesNotMatch(text, /\bpaires?\b/i, `${name} : « ${text} »`);
      assert.doesNotMatch(text, /point de terminaison|\(V2\)/i, `${name} : « ${text} »`);
    }
  }
});
