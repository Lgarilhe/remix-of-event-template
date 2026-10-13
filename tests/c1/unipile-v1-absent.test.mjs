/**
 * Garde statique : l'ancienne génération de l'API du prestataire LinkedIn a disparu
 * (passage à l'API v2 seule).
 *
 * Périmètre : supabase/functions, src, scripts, extensions (fichiers .ts .tsx .js .jsx
 * .mjs .mts .cjs ; node_modules, dist et build ignorés). Les tests e2e et ce fichier
 * ne sont pas lus.
 *
 * Invariants :
 *   - V1-1 aucun appel /api/v1 vers le prestataire (les appels /api/v1 d'un autre
 *     service, ici api.apollo.io, sont retirés avant la recherche) ;
 *   - V1-2 aucune lecture de UNIPILE_DSN ni de UNIPILE_API_KEY (la clé de la v2 est
 *     UNIPILE_V2_API_KEY, dont le nom ne les contient pas) ;
 *   - V1-3 aucune lecture des colonnes unipile_dsn et unipile_api_key (la clé est
 *     globale, plus par organisation) ;
 *   - V1-4 aucun resolveUnipileCredentials ;
 *   - V1-5 aucun import de _shared/unipile-v2.ts (module retiré) ;
 *   - V1-6 hors tests, seuls http.ts (qui appelle), config.ts (qui porte la constante
 *     UNIPILE_BASE_URL) et testing.ts (aide de test) citent l'hôte du prestataire ou
 *     UNIPILE_BASE_URL ; et dans le code de production, seul http.ts importe la
 *     constante : aucun autre module ne peut donc construire un appel vers l'hôte.
 *
 * Les exceptions sont une liste fermée ci-dessous, avec la raison. Une exception qui ne
 * sert plus fait échouer le garde (liste périmée).
 *
 * Lancer : node --test tests/c1/unipile-v1-absent.test.mjs
 * V1_ROOT=<dossier> relit un autre arbre (preuve que le garde échoue sur une violation).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.V1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const SCAN_DIRS = ['supabase/functions', 'src', 'scripts', 'extensions'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git']);
const EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|mts|cjs)$/;

const CLIENT_DIR = 'supabase/functions/_shared/unipile/';
const HOST_ALLOWED = new Set([`${CLIENT_DIR}http.ts`, `${CLIENT_DIR}config.ts`, `${CLIENT_DIR}testing.ts`]);

/** Appels /api/v1 d'un autre service : retirés de la ligne avant la recherche. */
const OTHER_SERVICE_V1 = /https?:\/\/api\.apollo\.io\/api\/v1/g;

const CHECKS = [
  { id: 'V1-1', label: 'appel /api/v1', re: /\/api\/v1/, prepare: (line) => line.replace(OTHER_SERVICE_V1, '') },
  { id: 'V1-2a', label: 'UNIPILE_DSN', re: /\bUNIPILE_DSN\b/ },
  { id: 'V1-2b', label: 'UNIPILE_API_KEY', re: /\bUNIPILE_API_KEY\b/ },
  { id: 'V1-3a', label: 'colonne unipile_dsn', re: /\bunipile_dsn\b/ },
  { id: 'V1-3b', label: 'colonne unipile_api_key', re: /\bunipile_api_key\b/ },
  { id: 'V1-4', label: 'resolveUnipileCredentials', re: /\bresolveUnipileCredentials\b/ },
  { id: 'V1-5', label: 'import de _shared/unipile-v2', re: /(?:from\s+|import\s*\(\s*|import\s+)['"][^'"]*unipile-v2(?:\.ts)?['"]/ },
];

/** Exceptions : fichier -> { identifiant du contrôle -> raison }. */
const EXCEPTIONS = {
  'supabase/functions/unipile-migration/handler.ts': {
    'V1-2a': 'rapport de préparation : dit seulement si le secret hérité est encore posé (legacySecretsSet), pour que le propriétaire le supprime',
    'V1-2b': 'rapport de préparation : même ligne que ci-dessus, présence du secret hérité, jamais sa valeur',
  },
  'supabase/functions/unipile-migration/handler.test.ts': {
    'V1-2a': 'test du rapport de préparation (secret hérité posé ou non)',
    'V1-2b': 'test du rapport de préparation (secret hérité posé ou non)',
  },
  'supabase/functions/_shared/unipile/config.test.ts': {
    'V1-2a': 'prouve que le client ignore UNIPILE_DSN même posé',
  },
  'supabase/functions/unipile-webhook/index.test.ts': {
    'V1-1': 'assertions d\'absence : aucune URL appelée ne contient /api/v1',
  },
  'src/integrations/supabase/types.ts': {
    'V1-3a': 'fichier généré du schéma : la colonne existe encore en base, aucun code ne la lit (retrait par une migration ultérieure)',
    'V1-3b': 'fichier généré du schéma : la colonne existe encore en base, aucun code ne la lit (retrait par une migration ultérieure)',
  },
};

// ---------------------------------------------------------------------------

const toPosix = (p) => p.split('\\').join('/');

function walk(rel, out) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return;
  for (const name of readdirSync(abs).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const childRel = `${rel}/${name}`;
    const st = statSync(join(ROOT, childRel));
    if (st.isDirectory()) walk(childRel, out);
    else if (EXTENSIONS.test(name)) out.push(toPosix(childRel));
  }
}

const FILES = [];
for (const dir of SCAN_DIRS) walk(dir, FILES);
const SOURCES = new Map(FILES.map((file) => [file, readFileSync(join(ROOT, file), 'utf8')]));
const isTestFile = (file) => /\.test\.[a-z]+$/.test(file);

/** Violations d'un contrôle : [{ file, line, text }]. */
function scan(check, files = FILES) {
  const hits = [];
  for (const file of files) {
    const lines = SOURCES.get(file).split('\n');
    lines.forEach((raw, index) => {
      const line = check.prepare ? check.prepare(raw) : raw;
      if (check.re.test(line)) hits.push({ file, line: index + 1, text: raw.trim().slice(0, 140) });
    });
  }
  return hits;
}

const describeHits = (hits) => hits.map((h) => `${h.file}:${h.line}  ${h.text}`).join('\n');

// ---------------------------------------------------------------------------

test('V1-0 le garde lit bien l\'arbre (il n\'est pas vide)', () => {
  assert.ok(FILES.length > 400, `fichiers lus : ${FILES.length}`);
  for (const must of [
    `${CLIENT_DIR}http.ts`,
    'supabase/functions/unipile-accounts/handler.ts',
    'supabase/functions/unipile-search/index.ts',
    'src/integrations/supabase/types.ts',
    'extensions/chrome/src/lib/konekt-api.ts',
  ]) {
    assert.ok(SOURCES.has(must), `fichier attendu non lu : ${must}`);
  }
  // Un dossier de test qui n'est pas lu ne protégerait rien : les tests de production sont lus.
  assert.ok(FILES.some(isTestFile), 'aucun fichier de test lu');
});

for (const check of CHECKS) {
  test(`${check.id} aucune occurrence de « ${check.label} » hors exceptions écrites`, () => {
    const hits = scan(check).filter((hit) => !EXCEPTIONS[hit.file]?.[check.id]);
    assert.deepEqual(hits, [], `\n${describeHits(hits)}\n`);
  });
}

test('V1-6a l\'hôte du prestataire et UNIPILE_BASE_URL ne sont cités que par http.ts, config.ts et testing.ts (hors tests)', () => {
  const hostRe = /unipile\.com|\bUNIPILE_BASE_URL\b/;
  const hits = [];
  for (const file of FILES) {
    if (!file.startsWith('supabase/functions/') || isTestFile(file) || HOST_ALLOWED.has(file)) continue;
    SOURCES.get(file).split('\n').forEach((line, index) => {
      if (hostRe.test(line)) hits.push({ file, line: index + 1, text: line.trim().slice(0, 140) });
    });
  }
  assert.deepEqual(hits, [], `\n${describeHits(hits)}\n`);
});

test('V1-6b seul http.ts importe UNIPILE_BASE_URL : config.ts le définit, aucun autre module de production ne s\'en sert', () => {
  const users = FILES.filter((file) =>
    file.startsWith('supabase/functions/') && !isTestFile(file)
    && file !== `${CLIENT_DIR}config.ts` && file !== `${CLIENT_DIR}testing.ts`
    && /\bUNIPILE_BASE_URL\b/.test(SOURCES.get(file)));
  assert.deepEqual(users, [`${CLIENT_DIR}http.ts`]);
  assert.match(SOURCES.get(`${CLIENT_DIR}config.ts`), /export const UNIPILE_BASE_URL = 'https:\/\/api\.unipile\.com\/v2';/);
});

test('V1-6c un appel fetch vers une adresse construite sur l\'hôte n\'existe que dans http.ts', () => {
  // Au-delà de la constante : aucun fichier de production (hors http.ts) ne contient une URL https vers le domaine du prestataire.
  const hits = [];
  for (const file of FILES) {
    if (isTestFile(file) || file === `${CLIENT_DIR}http.ts` || file === `${CLIENT_DIR}config.ts` || file === `${CLIENT_DIR}testing.ts`) continue;
    if (!file.startsWith('supabase/functions/') && !file.startsWith('scripts/')) continue;
    SOURCES.get(file).split('\n').forEach((line, index) => {
      if (/https?:\/\/[a-z0-9.-]*unipile[a-z0-9.-]*(?::\d+)?\//i.test(line)) hits.push({ file, line: index + 1, text: line.trim().slice(0, 140) });
    });
  }
  assert.deepEqual(hits, [], `\n${describeHits(hits)}\n`);
});

test('V1-7 le secret hérité n\'est lu qu\'à un endroit : le rapport de préparation de la bascule', () => {
  const source = SOURCES.get('supabase/functions/unipile-migration/handler.ts');
  const lines = source.split('\n').filter((line) => /\bUNIPILE_(DSN|API_KEY)\b/.test(line));
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /legacySecretsSet:\s*\(env\('UNIPILE_API_KEY'\) \?\? ''\)\.trim\(\) !== '' \|\| \(env\('UNIPILE_DSN'\) \?\? ''\)\.trim\(\) !== ''/);
});

test('V1-8 chaque exception écrite sert encore (liste non périmée)', () => {
  const stale = [];
  for (const [file, rules] of Object.entries(EXCEPTIONS)) {
    assert.ok(SOURCES.has(file), `fichier d'exception absent de l'arbre : ${file}`);
    for (const id of Object.keys(rules)) {
      const check = CHECKS.find((c) => c.id === id);
      assert.ok(check, `contrôle inconnu : ${id}`);
      if (scan(check, [file]).length === 0) stale.push(`${file} ${id}`);
    }
  }
  assert.deepEqual(stale, []);
});
