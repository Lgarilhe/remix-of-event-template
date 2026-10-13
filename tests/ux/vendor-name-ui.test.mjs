/**
 * Marque : le nom du prestataire LinkedIn ne s'affiche jamais à l'écran (CLAUDE.md, « Branding »).
 *
 * Aucune chaîne de caractères ni aucun texte JSX de src/ (et de l'interface de l'extension
 * Chrome) ne contient « Unipile ». Les commentaires, les noms d'identifiants et les
 * expressions régulières ne sont pas des chaînes : ils ne comptent pas. Sont admis :
 *   - les deux pages juridiques (liste des sous-traitants, art. 28 du RGPD) :
 *     src/pages/Privacy.tsx et src/pages/PrivacyExtension.tsx ;
 *   - les adresses de modules (import, export, import()), qui ne s'affichent pas ;
 *   - un jeton technique d'un seul mot, en minuscules, commençant par « unipile- » ou
 *     « unipile_ », éventuellement précédé d'un chemin d'adresse : nom d'une fonction serveur
 *     (« unipile-accounts », « /functions/v1/unipile-accounts »), clé de stockage local
 *     (« unipile_quota_state »). Un texte lisible a toujours une majuscule ou une espace.
 *
 * Lisent aussi le nom nu : index.html (titre, balises meta), public/ (texte), manifest.json de
 * l'extension.
 *
 * Technique : arbre syntaxique TypeScript (comme tests/c1/unipile-client.test.mjs), sans
 * exécuter le code. Le garde prouve d'abord qu'il voit un texte JSX, une chaîne, un gabarit et
 * qu'il ignore un commentaire.
 *
 * Lancer : node --test tests/ux/vendor-name-ui.test.mjs
 * UX_ROOT=<dossier> relit un autre arbre (preuve que le garde échoue sur une violation).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = process.env.UX_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const VENDOR = /unipile/i;
/** Pages où le nom est exigé par la loi (liste des sous-traitants). */
const LEGAL_PAGES = ['src/pages/Privacy.tsx', 'src/pages/PrivacyExtension.tsx'];
/** Jeton technique : un seul mot en minuscules, préfixé par le nom. */
const TECHNICAL_TOKEN = /^\/?(?:[a-z0-9_.-]+\/)*unipile[-_][a-z0-9_-]+$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git']);

function walk(rel, pattern, out = []) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const childRel = `${rel}/${name}`;
    if (statSync(join(ROOT, childRel)).isDirectory()) walk(childRel, pattern, out);
    else if (pattern.test(name)) out.push(childRel);
  }
  return out;
}

const isModuleSpecifier = (node) => {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return parent.moduleSpecifier === node;
  if (ts.isExternalModuleReference(parent) || ts.isImportTypeNode(parent) || ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent)) return true;
  if (ts.isCallExpression(parent) && parent.arguments[0] === node) {
    return parent.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(parent.expression) && parent.expression.text === 'require');
  }
  return false;
};

/** Textes qu'un lecteur peut voir : chaînes, morceaux de gabarits, texte JSX. [{ line, kind, text }] */
export function visibleStringsNamingVendor(fileName, source) {
  const kind = /\.tsx$|\.jsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const hits = [];
  const check = (node, text, label) => {
    if (!VENDOR.test(text)) return;
    if (TECHNICAL_TOKEN.test(text.trim())) return;
    if (isModuleSpecifier(node)) return;
    hits.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, kind: label, text: text.trim().replace(/\s+/g, ' ').slice(0, 100) });
  };
  (function visit(node) {
    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
        check(node, node.text, 'chaîne');
        break;
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
        check(node, node.text, 'gabarit');
        break;
      case ts.SyntaxKind.JsxText:
        check(node, node.text, 'texte JSX');
        break;
      default:
    }
    ts.forEachChild(node, visit);
  })(sf);
  return hits;
}

const format = (file, hits) => hits.map((h) => `${file}:${h.line} (${h.kind}) ${h.text}`);

test('le garde voit un texte JSX, une chaîne et un gabarit, et ignore commentaires, adresses de modules et jetons techniques', () => {
  const sample = [
    "import { invoke } from '@/lib/invokeUnipile';",
    "// Unipile dans un commentaire",
    "/* Unipile dans un bloc */",
    "const url = `${base}/functions/v1/unipile-accounts`;",
    "const fn = 'unipile-accounts';",
    "const key = 'unipile_quota_state';",
    "const re = /Unipile/gi;",
    "const a = 'Connexion Unipile impossible';",
    "const b = `Erreur Unipile ${code}`;",
    "export const C = () => <p>Service Unipile</p>;",
    "export const D = () => <input placeholder=\"Compte Unipile\" />;",
    "const lazy = import('@/lib/invokeUnipile');",
    "const shown = 'Unipile';",
  ].join('\n');
  const hits = visibleStringsNamingVendor('sample.tsx', sample).map((h) => `${h.line}:${h.kind}`);
  assert.deepEqual(hits, ['8:chaîne', '9:gabarit', '10:texte JSX', '11:chaîne', '13:chaîne']);
});

test('src/ : aucune chaîne ni texte JSX ne nomme le prestataire, hors pages juridiques', () => {
  const files = walk('src', /\.(ts|tsx)$/);
  assert.ok(files.length > 500, `fichiers lus : ${files.length}`);
  for (const must of ['src/pages/Auth.tsx', 'src/lib/invokeUnipile.ts', 'src/components/outreach/search/SearchResultsPanel.tsx']) {
    assert.ok(files.includes(must), `fichier attendu non lu : ${must}`);
  }
  const violations = [];
  for (const file of files) {
    if (LEGAL_PAGES.includes(file)) continue;
    violations.push(...format(file, visibleStringsNamingVendor(file, read(file))));
  }
  assert.deepEqual(violations, []);
});

test('pages juridiques : l\'exception sert encore (le nom y est, comme la loi l\'exige)', () => {
  for (const file of LEGAL_PAGES) {
    assert.ok(visibleStringsNamingVendor(file, read(file)).length > 0, `${file} ne cite plus le sous-traitant : retirer l'exception`);
  }
});

test('extension Chrome : aucune chaîne ni texte JSX de l\'interface ne nomme le prestataire', () => {
  const files = walk('extensions/chrome/src', /\.(ts|tsx)$/);
  assert.ok(files.length > 5, `fichiers lus : ${files.length}`);
  const violations = [];
  for (const file of files) violations.push(...format(file, visibleStringsNamingVendor(file, read(file))));
  assert.deepEqual(violations, []);
  assert.doesNotMatch(read('extensions/chrome/manifest.json'), VENDOR, 'manifest.json (nom, description, permissions)');
});

test('index.html et public/ : ni titre, ni balise meta, ni texte ne nomme le prestataire', () => {
  assert.doesNotMatch(read('index.html'), VENDOR);
  const texts = walk('public', /\.(html|json|webmanifest|xml|txt|md)$/);
  for (const file of texts) assert.doesNotMatch(read(file), VENDOR, file);
});
