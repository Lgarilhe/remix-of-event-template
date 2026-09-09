#!/usr/bin/env node
/**
 * Inventaire UX généré depuis le code — base de la matrice de couverture.
 *
 * Pourquoi : un audit n'est « exhaustif » que si l'on peut prouver ce qui a été
 * regardé. Cet inventaire est REGENERABLE : il repart du code à chaque fois,
 * donc il ne vieillit pas comme une liste écrite à la main.
 *
 * Usage  : node scripts/audit-ux/inventory.mjs
 * Sortie : docs/audit-ux/00-cartographie.md + docs/audit-ux/inventory.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'src');

const read = (p) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};

/** Résout un import "@/..." ou relatif vers un fichier réel de src/. */
function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // paquet npm
  const cands = [
    base + '.tsx',
    base + '.ts',
    path.join(base, 'index.tsx'),
    path.join(base, 'index.ts'),
    base,
  ];
  for (const c of cands) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function importsOf(file) {
  const src = read(file);
  const out = new Set();
  const patterns = [
    /import\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const r = resolveImport(m[1], file);
      if (r) out.add(r);
    }
  }
  return [...out];
}

const EMPTY = {
  dialogs: 0,
  portals: 0,
  inputs: 0,
  labels: 0,
  forms: 0,
  writes: 0,
  invokes: 0,
  toastSuccess: 0,
  toastError: 0,
  maybeSingle: 0,
  windowConfirm: 0,
  localStorage: 0,
};

/** Marqueurs UX relevés dans un fichier. */
function markersOf(file) {
  const src = read(file);
  const count = (re) => (src.match(re) || []).length;
  return {
    file: path.relative(ROOT, file).replace(/\\/g, '/'),
    // surfaces bloquantes
    dialogs: count(/<(?:Dialog|AlertDialog|Sheet|Drawer)\b/g),
    portals: count(/createPortal\s*\(/g),
    // saisie utilisateur
    inputs: count(/<(?:Input|Textarea|Select|Checkbox|Switch|RadioGroup)\b/g),
    labels: count(/<Label\b/g),
    forms: count(/<form\b/g),
    // écritures : ce qui change l'état du métier
    writes: count(/\.(?:insert|update|upsert|delete)\s*\(/g),
    invokes: count(/functions\.invoke\s*\(/g),
    // retours à l'utilisateur
    toastSuccess: count(/toast\.success\s*\(/g),
    toastError: count(/toast\.error\s*\(/g),
    // pièges connus
    maybeSingle: count(/\.maybeSingle\s*\(/g),
    windowConfirm: count(/window\.confirm\s*\(/g),
    localStorage: count(/localStorage\.(?:get|set|remove)Item/g),
  };
}

/** Parcourt le graphe d'imports depuis une page, sans descendre dans components/ui. */
function walk(entry, maxDepth = 6) {
  const seen = new Set();
  const stack = [[entry, 0]];
  const uiDir = `${path.sep}components${path.sep}ui${path.sep}`;
  while (stack.length) {
    const [f, d] = stack.pop();
    if (seen.has(f) || d > maxDepth) continue;
    seen.add(f);
    if (f.includes(uiDir)) continue;
    for (const nxt of importsOf(f)) stack.push([nxt, d + 1]);
  }
  return [...seen];
}

// ---- 1. Routes déclarées dans App.tsx -------------------------------------
const appFile = path.join(SRC, 'App.tsx');
const appSrc = read(appFile);

// Les routes sont enveloppées (ProtectedRoute, garde d'organisation, layout…).
// Le vrai écran est le dernier composant de l'élément qui n'est pas une enveloppe.
const WRAPPERS = new Set([
  'ProtectedRoute',
  'OrganizationGuard',
  'AppLayout',
  'Suspense',
  'Navigate',
  'Fragment',
  'ErrorBoundary',
  'Outlet',
]);

const routes = [];
const routeRe = /<Route\s+path="([^"]+)"\s+element=\{([\s\S]*?)\}\s*\/>/g;
let rm;
while ((rm = routeRe.exec(appSrc))) {
  const inner = [...rm[2].matchAll(/<([A-Z][A-Za-z0-9_]*)/g)].map((m) => m[1]);
  const screens = inner.filter((c) => !WRAPPERS.has(c));
  const component = screens.length ? screens[screens.length - 1] : inner[inner.length - 1] || '?';
  routes.push({ path: rm[1], component, wrappers: inner.filter((c) => WRAPPERS.has(c)) });
}

// map composant -> fichier, via les imports de App.tsx
const appImports = new Map();
{
  const re = /import\s+(?:\{([^}]*)\}|([A-Za-z0-9_]+))\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(appSrc))) {
    const file = resolveImport(m[3], appFile);
    if (!file) continue;
    const names = m[1]
      ? m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop())
      : [m[2]];
    for (const nme of names) if (nme) appImports.set(nme, file);
  }
  const lazyRe = /const\s+([A-Za-z0-9_]+)\s*=\s*(?:React\.)?lazy\(\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]/g;
  while ((m = lazyRe.exec(appSrc))) {
    const file = resolveImport(m[2], appFile);
    if (file) appImports.set(m[1], file);
  }
}

// ---- 2. Agrégation par route ---------------------------------------------
const inventory = routes.map((r) => {
  const entry = appImports.get(r.component);
  if (!entry) return { ...r, entry: null, files: 0, totals: { ...EMPTY }, hotspots: [] };
  const files = walk(entry);
  const marks = files.map(markersOf);
  const totals = { ...EMPTY };
  for (const k of Object.keys(EMPTY)) totals[k] = marks.reduce((a, mk) => a + mk[k], 0);
  const hotspots = marks
    .filter((mk) => mk.writes + mk.invokes > 0 || mk.portals > 0 || mk.maybeSingle > 0 || mk.windowConfirm > 0)
    .sort((a, b) => b.writes + b.invokes - (a.writes + a.invokes))
    .slice(0, 12);
  return {
    ...r,
    entry: path.relative(ROOT, entry).replace(/\\/g, '/'),
    files: files.length,
    totals,
    hotspots,
  };
});

// ---- 3. Sorties -----------------------------------------------------------
const outDir = path.join(ROOT, 'docs/audit-ux');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'inventory.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), routes: inventory }, null, 2),
);

const n = (x) => (x ? String(x) : '·');
let md = `# 00 — Cartographie de l'application (générée)

> Fichier **généré** par \`node scripts/audit-ux/inventory.mjs\`. Ne pas éditer à la main.
> Regénérer après chaque lot : si une ligne bouge, la couverture correspondante est à revalider.

Chaque route est parcourue par son graphe d'imports (profondeur 6, hors \`components/ui\`).
Les colonnes comptent ce qui casse une expérience quand c'est mal fait :

- **Écrit** : appels qui modifient des données (\`insert\`, \`update\`, \`upsert\`, \`delete\`) plus les appels de fonctions serveur. C'est là qu'un « c'est enregistré » peut être faux.
- **Surfaces** : fenêtres bloquantes et \`createPortal\` maison. Un portail maison ne gère ni le focus ni la touche Échap.
- **Saisie / Libellés** : champs de formulaire, et libellés associés. Un écart fort entre les deux signale des champs sans repère persistant.
- **Succès / Erreur** : messages de confirmation contre messages d'échec. Beaucoup de succès pour peu d'écritures vérifiées annonce des confirmations trompeuses.

| Route | Écran | Fichiers | Écrit | Surfaces | Saisie / Libellés | Succès / Erreur | Pièges |
|---|---|--:|--:|--:|--:|--:|---|
`;

for (const r of inventory) {
  const t = r.totals;
  const pieges = [];
  if (t.maybeSingle) pieges.push(`maybeSingle x${t.maybeSingle}`);
  if (t.portals) pieges.push(`portail x${t.portals}`);
  if (t.windowConfirm) pieges.push(`window.confirm x${t.windowConfirm}`);
  if (t.localStorage) pieges.push(`localStorage x${t.localStorage}`);
  md += `| \`${r.path}\` | ${r.component} | ${r.files} | ${n(t.writes + t.invokes)} | ${n(t.dialogs + t.portals)} | ${n(t.inputs)} / ${n(t.labels)} | ${n(t.toastSuccess)} / ${n(t.toastError)} | ${pieges.join(', ') || '·'} |\n`;
}

md += `\n## Points chauds par route\n\nLes fichiers qui écrivent réellement. Ce sont eux qu'un test de résultat doit couvrir.\n`;
for (const r of inventory) {
  if (!r.hotspots.length) continue;
  md += `\n### \`${r.path}\` — ${r.component}\n\n`;
  for (const h of r.hotspots) {
    const flags = [];
    if (h.maybeSingle) flags.push('maybeSingle');
    if (h.portals) flags.push('portail maison');
    if (h.windowConfirm) flags.push('window.confirm');
    if (h.toastSuccess && !h.toastError) flags.push('succès sans branche erreur');
    md += `- \`${h.file}\` : écrit ${h.writes + h.invokes}, succès ${h.toastSuccess}, erreur ${h.toastError}${flags.length ? ` — attention : ${flags.join(', ')}` : ''}\n`;
  }
}

fs.writeFileSync(path.join(outDir, '00-cartographie.md'), md);

// ---- 4. Matrice de couverture --------------------------------------------
// Les lignes viennent du code. Une route nouvelle apparaît automatiquement
// en « à faire » : la matrice ne peut donc pas oublier un écran en silence.
const SKIP = new Set(['Navigate', 'NotFound']);
const covPath = path.join(outDir, 'coverage.json');
const coverage = fs.existsSync(covPath) ? JSON.parse(read(covPath)) : {};

const AXES = ['code', 'interface', 'erreurs', 'mobile_clavier'];
const LIB = { fait: 'fait', partiel: 'partiel', a_faire: 'à faire', bloque: 'bloqué' };
const AXE_LIB = {
  code: 'Code lu',
  interface: 'Écran testé',
  erreurs: 'Cas d’erreur',
  mobile_clavier: 'Mobile / clavier',
};

const tracked = inventory.filter((r) => !SKIP.has(r.component));
const missing = [];
let mm = `# 01 — Matrice de couverture

> Tableau **généré** par \`node scripts/audit-ux/inventory.mjs\`.
> Les lignes viennent du code : une route ajoutée apparaît toute seule en « à faire ».
> L'état de chaque case se modifie dans \`docs/audit-ux/coverage.json\`, jamais ici.

Quatre axes, parce qu'un écran peut être lu sans être testé, et testé sans que ses pannes le soient :

1. **Code lu** : les fichiers qui écrivent des données ont été relus.
2. **Écran testé** : le parcours a été fait dans l'application, connecté.
3. **Cas d'erreur** : réseau coupé, droit refusé, ligne absente, quota atteint.
4. **Mobile / clavier** : téléphone, navigation au clavier seul, zoom 200 %.

Une route n'est **complète** que si les quatre axes sont faits. Tant qu'une case reste à faire, la couverture de cette route ne peut pas être annoncée.

| Route | Écran | Écrit | ${AXES.map((a) => AXE_LIB[a]).join(' | ')} | État | Note |
|---|---|--:|---|---|---|---|---|---|
`;

let complete = 0;
for (const r of tracked) {
  const c = coverage[r.path];
  if (!c) missing.push(r.path);
  const cells = AXES.map((a) => LIB[c?.[a]] || 'à faire');
  const done = AXES.every((a) => c?.[a] === 'fait');
  if (done) complete++;
  const blocked = AXES.some((a) => c?.[a] === 'bloque');
  const untouched = AXES.every((a) => !c || c[a] === 'a_faire');
  const etat = done ? '**complet**' : blocked ? 'bloqué' : untouched ? 'à faire' : 'partiel';
  mm += `| \`${r.path}\` | ${r.component} | ${r.totals.writes + r.totals.invokes} | ${cells.join(' | ')} | ${etat} | ${c?.note || ''} |\n`;
}

mm += `\n**Couverture : ${complete} route${complete > 1 ? 's' : ''} complète${complete > 1 ? 's' : ''} sur ${tracked.length}.**\n`;
if (missing.length) {
  mm += `\n⚠ Routes absentes de \`coverage.json\` (comptées « à faire ») : ${missing.map((p) => `\`${p}\``).join(', ')}\n`;
}
mm += `\n## Critère de fin

L'audit est complet sur le périmètre annoncé quand les quatre axes sont faits pour chaque route de ce tableau, que chaque constat porte une preuve et une priorité, et que les scénarios bout en bout de \`03-scenarios.md\` sont passés. Une zone bloquée reste bloquée : elle ne se déclare pas couverte.
`;

fs.writeFileSync(path.join(outDir, '01-matrice-couverture.md'), mm);

const totalWrites = inventory.reduce((a, r) => a + r.totals.writes + r.totals.invokes, 0);
console.log(`Routes: ${inventory.length} (suivies: ${tracked.length}) · ecritures cumulees: ${totalWrites}`);
console.log(`Couverture complete: ${complete}/${tracked.length}`);
console.log('-> docs/audit-ux/00-cartographie.md');
console.log('-> docs/audit-ux/01-matrice-couverture.md');
