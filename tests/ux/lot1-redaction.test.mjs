/**
 * Paramètres, lot 1 — rédaction : templates et signatures (R5a, R5b, R9).
 *
 * R5a/R5b : une lecture ratée affichait l'état vide (« Démarrer avec des
 * templates suggérés », « Aucune signature ») avec la création active.
 * L'utilisateur croyait ses données perdues. Ces tests épinglent le bloc
 * d'erreur (ErrorBox + Réessayer) et la création désactivée. L'écran des
 * variables personnalisées est retiré au lot 3 ; leur hook, encore lu par la
 * messagerie, garde isError et refetch.
 *
 * R9 : l'aperçu d'une signature injectait le HTML saisi tel quel
 * (XSS stockée entre membres). Il passe désormais par sanitizeSignatureHtml
 * (src/lib/signatureHtml.ts, autour de DOMPurify). Node n'a pas de DOM :
 * on vérifie ici les listes blanches, les règles d'URL (fonctions pures) et le
 * repli sans DOM ; le comportement de DOMPurify se vérifie dans un navigateur.
 *
 * Inspection de source et fonctions pures, sans navigateur ni base.
 * Lancer : node --test tests/ux/lot1-redaction.test.mjs (ou npm run test:ux)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const between = (src, start, end) => {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `repère introuvable : ${start}`);
  const j = end ? src.indexOf(end, i + start.length) : src.length;
  assert.ok(j >= 0, `repère introuvable : ${end}`);
  return src.slice(i, j);
};
const returnBlock = (src) => src.slice(src.lastIndexOf('return {'));

const templatesHook = read('src/hooks/useMessageTemplates.ts');
const templatesUi = read('src/components/settings/MessageTemplatesSettings.tsx');
const variablesHook = read('src/hooks/useUserTemplateVariables.ts');
const signaturesHook = read('src/hooks/useEmailSignatures.ts');
const signaturesUi = read('src/components/settings/EmailSignatures.tsx');
const signatureHtml = read('src/lib/signatureHtml.ts');

// Module assaini, empaqueté avec DOMPurify par esbuild (déjà présent via Vite).
const { outputFiles } = buildSync({
  entryPoints: [fileURLToPath(new URL('src/lib/signatureHtml.ts', ROOT))],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const sig = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
);

// ---------------------------------------------------------------- R5a
test('R5a — les hooks templates et variables exposent isError et refetch', () => {
  for (const [name, src] of [['useMessageTemplates', templatesHook], ['useUserTemplateVariables', variablesHook]]) {
    assert.match(src, /isLoading, isError, refetch \} = useQuery/, `${name} : isError/refetch non lus`);
    const ret = returnBlock(src);
    assert.match(ret, /\bisError,/, `${name} : isError non renvoyé`);
    assert.match(ret, /\brefetch,/, `${name} : refetch non renvoyé`);
  }
});

test('R5a — templates : bloc d\'erreur, ni suggestions ni liste, création désactivée', () => {
  const section = between(templatesUi, 'const TemplatesSection', '// ─── Placeholders Panel');
  assert.match(section, /isLoading, isError, refetch, create, update, remove \} = useMessageTemplates\(\)/);
  assert.match(section, /disabled=\{isLoading \|\| isError\}/, '« Nouveau template » doit être grisé');
  assert.match(section, /<ErrorBox title="Impossible de charger vos templates\." onRetry=/);
  assert.match(section, /!isLoading && !isError && templates\.length === 0/, 'suggestions affichées en erreur');
  assert.match(section, /!isLoading && !isError && templates\.length > 0/, 'liste affichée en erreur');
  assert.doesNotMatch(section, /!isLoading && templates\.length/, 'une condition sans !isError subsiste');
  assert.match(templatesUi, /import \{ ErrorBox \} from '@\/components\/marketplace\/ErrorBox'/);
});

// ---------------------------------------------------------------- R5b
test('R5b — signatures : le hook expose isError et refetch', () => {
  assert.match(signaturesHook, /isLoading, isError, refetch \} = useQuery/);
  const ret = returnBlock(signaturesHook);
  assert.match(ret, /\bisError,/);
  assert.match(ret, /\brefetch,/);
});

test('R5b — signatures : l\'erreur passe avant l\'état vide, « Nouvelle » désactivé', () => {
  assert.match(signaturesUi, /isLoading, isError, refetch, createSignature, updateSignature, deleteSignature \} = useEmailSignatures\(\)/);
  const zone = between(signaturesUi, '{isLoading ? (', 'signatures.map');
  const iErr = zone.indexOf('isError ?');
  const iEmpty = zone.indexOf('signatures.length === 0');
  assert.ok(iErr > 0, 'branche isError absente');
  assert.ok(iEmpty > iErr, 'la branche d\'erreur doit précéder l\'état vide');
  assert.match(zone, /<ErrorBox title="Impossible de charger les signatures email\." onRetry=/);
  assert.match(signaturesUi, /onClick=\{openCreate\} disabled=\{isLoading \|\| isError\}/);
});

// ---------------------------------------------------------------- R9
test('R9 — l\'aperçu n\'injecte plus la saisie brute', () => {
  assert.doesNotMatch(signaturesUi, /__html:\s*form\.content/);
  assert.match(signaturesUi, /useMemo\(\(\) => sanitizeSignatureHtml\(form\.content\), \[form\.content\]\)/);
  assert.match(signaturesUi, /__html: previewHtml/);
  assert.match(signaturesUi, /data-testid="signature-preview"/);
  assert.match(signaturesUi, /max-h-64 overflow-auto \[&_img\]:max-w-full \[&_img\]:h-auto/);
  assert.match(signaturesUi, /import \{ sanitizeSignatureHtml \} from '@\/lib\/signatureHtml'/);
});

test('R9 — dangerouslySetInnerHTML n\'apparaît que dans chart.tsx et l\'aperçu de signature', () => {
  const allowed = new Set([
    join('src', 'components', 'ui', 'chart.tsx'),
    join('src', 'components', 'settings', 'EmailSignatures.tsx'),
  ]);
  const rootPath = fileURLToPath(ROOT);
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?)$/.test(name) && readFileSync(full, 'utf8').includes('dangerouslySetInnerHTML')) {
        found.push(full.slice(rootPath.length));
      }
    }
  };
  walk(join(rootPath, 'src'));
  const unexpected = found.filter((f) => !allowed.has(f));
  assert.deepEqual(unexpected, [], `HTML injecté hors liste, à assainir : ${unexpected.join(', ')}`);
});

test('R9 — signatureHtml s\'appuie sur DOMPurify, dépendance déclarée en v3', () => {
  assert.match(signatureHtml, /import DOMPurify from 'dompurify'/);
  assert.match(signatureHtml, /addHook\('afterSanitizeAttributes'/);
  assert.match(signatureHtml, /FORBID_ATTR: \['style', 'class', 'id'\]/);
  assert.match(signatureHtml, /ALLOW_DATA_ATTR: false/);
  assert.match(signatureHtml, /ALLOW_ARIA_ATTR: false/);
  assert.match(signatureHtml, /ALLOWED_URI_REGEXP: SAFE_HREF/);
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.dependencies.dompurify ?? '', /^\^3\./, 'dompurify@^3 attendu dans dependencies');
});

test('R9 — listes blanches : aucune balise active, aucun attribut dangereux', () => {
  const tags = sig.SIGNATURE_ALLOWED_TAGS;
  for (const t of ['script', 'style', 'iframe', 'svg', 'math', 'noscript', 'template', 'form',
    'object', 'embed', 'input', 'button', 'textarea', 'link', 'meta', 'base', 'details']) {
    assert.ok(!tags.includes(t), `balise interdite dans la liste blanche : ${t}`);
  }
  for (const [tag, attrs] of Object.entries(sig.SIGNATURE_ATTRS_BY_TAG)) {
    assert.ok(tags.includes(tag), `attributs définis pour une balise non permise : ${tag}`);
    for (const a of attrs) {
      assert.doesNotMatch(a, /^on|^style$|^class$|^id$|^name$|srcset|^target$|^rel$/, `${tag}[${a}] ne doit pas être permis`);
    }
  }
  // Seuls les liens portent href, seules les images portent src.
  const owners = (attr) => Object.entries(sig.SIGNATURE_ATTRS_BY_TAG)
    .filter(([, attrs]) => attrs.includes(attr)).map(([tag]) => tag);
  assert.deepEqual(owners('href'), ['a']);
  assert.deepEqual(owners('src'), ['img']);
});

test('R9 — liens : http, https, mailto et tel seulement', () => {
  const ok = ['https://konekt.fr', 'http://konekt.fr/a?b=c', 'mailto:a@b.fr', 'tel:+33102030405',
    '  https://konekt.fr', 'HTTPS://KONEKT.FR'];
  const ko = ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'vbscript:x',
    'data:text/html,<script>alert(1)</script>', '/relatif', '#ancre', '//konekt.fr', 'cid:logo',
    'ftp://konekt.fr', 'https:/konekt.fr', ''];
  for (const h of ok) assert.ok(sig.isSafeSignatureHref(h), `lien refusé à tort : ${h}`);
  for (const h of ko) assert.ok(!sig.isSafeSignatureHref(h), `lien accepté à tort : ${JSON.stringify(h)}`);
});

test('R9 — images : https ou image matricielle embarquée seulement', () => {
  const ok = ['https://cdn.konekt.fr/logo.png', 'data:image/png;base64,iVBORw0KGgo=',
    'data:image/jpeg;base64,/9j/', 'data:image/jpg;base64,/9j/', 'data:image/gif;base64,R0lGOD',
    'data:image/webp;base64,UklGR'];
  const ko = ['http://x/y.png', 'x', '', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zy8+',
    'data:text/html;base64,PHNjcmlwdD4=', 'cid:logo', '//cdn.konekt.fr/logo.png', 'data:image/png,raw'];
  for (const s of ok) assert.ok(sig.isSafeSignatureImageSrc(s), `image refusée à tort : ${s}`);
  for (const s of ko) assert.ok(!sig.isSafeSignatureImageSrc(s), `image acceptée à tort : ${JSON.stringify(s)}`);
});

test('R9 — sans DOM, rien n\'est rendu (jamais d\'entrée brute)', () => {
  assert.equal(typeof globalThis.window, 'undefined', 'ce test suppose un environnement sans DOM');
  assert.equal(sig.sanitizeSignatureHtml('<img src=x onerror="alert(1)">'), '');
  assert.equal(sig.sanitizeSignatureHtml('<b>Jean</b>'), '');
  assert.equal(sig.sanitizeSignatureHtml(''), '');
});
