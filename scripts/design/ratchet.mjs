#!/usr/bin/env node
/**
 * Cliquet design : compte la dette visuelle de src/ et refuse qu'elle augmente.
 *
 * Même principe que les cliquets TypeScript et ESLint de la CI : une PR ne
 * peut pas faire monter un compteur par rapport à main. La dette existante
 * n'est pas bloquante, elle se résorbe lot après lot (docs/design/).
 *
 * Usage :
 *   node scripts/design/ratchet.mjs              tableau des compteurs
 *   node scripts/design/ratchet.mjs --json       compteurs en JSON (CI)
 *   node scripts/design/ratchet.mjs --details    les fichiers les plus chargés, par compteur
 *   node scripts/design/ratchet.mjs --by-file    la dette de chaque fichier, tous compteurs confondus
 *   node scripts/design/ratchet.mjs --compare base.json
 *        compare au JSON d'une autre révision ; code de sortie 1 si un compteur monte
 *
 * Mesure le dossier src/ du répertoire courant (la CI le lance sur la PR puis
 * sur la base, avec le même script).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const IGNORED_DIRS = new Set(['node_modules', '__tests__', 'integrations']);
// Pages où la loi impose de nommer les sous-traitants (CLAUDE.md, « Branding »).
const LEGAL_PAGES = new Set(['src/pages/Privacy.tsx', 'src/pages/PrivacyExtension.tsx']);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (IGNORED_DIRS.has(name)) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walk(abs));
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(abs);
  }
  return out;
}

function walkStyles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (IGNORED_DIRS.has(name)) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walkStyles(abs));
    else if (/\.css$/.test(name)) out.push(abs);
  }
  return out;
}

/** Code sans commentaires (les commentaires citent souvent ce qu'on veut bannir). */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/**
 * Textes lisibles par l'utilisateur : littéraux de chaîne et texte JSX, sans
 * les imports ni les journaux console (réservés au débogage, CLAUDE.md).
 */
function visibleStrings(code) {
  const cleaned = code
    .replace(/\bconsole\.(?:log|warn|error|info|debug)\((?:[^()]|\([^()]*\))*\)/g, '')
    .replace(/\bfrom\s+(['"])[^'"\n]*\1/g, '')
    .replace(/^\s*import\s+(['"])[^'"\n]*\1/gm, '')
    .replace(/\bimport\(\s*(['"])[^'"\n]*\1\s*\)/g, '');
  return [
    ...[...cleaned.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]),
    ...[...cleaned.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]),
    ...[...cleaned.matchAll(/`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1]),
    ...[...cleaned.matchAll(/>([^<>{}=;]*[A-Za-zÀ-ÿ][^<>{}=;]*)(?=[<{])/g)].map((m) => m[1]),
  ];
}

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';

/**
 * Chaque compteur : ce qu'il mesure, pourquoi c'est une dette, et la règle de
 * docs/design/01-direction.md qu'il protège.
 */
const METRICS = [
  {
    id: 'couleurs_palette',
    label: 'Couleurs Tailwind brutes (bg-emerald-500…)',
    // Ignorent le thème et doublonnent les jetons success/warning/info/danger.
    scope: 'code',
    re: new RegExp(
      String.raw`\b(?:bg|text|border|ring|ring-offset|from|to|via|fill|stroke|outline|decoration|divide|placeholder|caret|accent|shadow)-(?:${PALETTE})-(?:50|[1-9]00|950)\b`,
      'g',
    ),
  },
  {
    id: 'couleurs_arbitraires',
    label: 'Couleurs en dur (#hex, rgb(), hsl() hors jetons)',
    scope: 'code',
    re: /-\[(?:#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\((?!var))|(?:color|background(?:Color)?|borderColor|fill|stroke)\s*:\s*['"](?:#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\((?!var))/g,
  },
  {
    id: 'tailles_arbitraires',
    label: 'Tailles de texte arbitraires (text-[11px]…)',
    // L'échelle a six paliers ; tailwind.config.ts les nomme.
    scope: 'code',
    re: /\btext-\[\d+(?:\.\d+)?(?:px|rem|em)\]/g,
  },
  {
    id: 'z_arbitraires',
    label: 'z-index arbitraires (z-[5000]…)',
    scope: 'code',
    re: /\bz-\[\d+\]/g,
  },
  {
    id: 'effets_decoratifs',
    label: 'Effets décoratifs (dégradés, glow, shine, shimmer)',
    scope: 'code',
    re: /\b(?:konekt-skalr-[a-z-]+|skalr-gradient-[a-z]+|konekt-glow|konekt-shine|konekt-shimmer-text|bg-gradient-to-(?:t|tr|r|br|b|bl|l|tl)|bg-clip-text)\b/g,
  },
  {
    id: 'rayons_hors_systeme',
    label: 'Rayons hors système (rounded-none, -2xl, -3xl, arbitraires)',
    // Système : 8 px contrôles (rounded-lg), 6 px imbriqués (rounded-md), 12 px surfaces (rounded-xl),
    // plein (rounded-full), 4 px sous 20 px (rounded-sm).
    scope: 'code',
    re: /\brounded(?:-[tblrsexy]{1,2})?-(?:none|2xl|3xl|\[[^\]]+\])/g,
  },
  {
    id: 'polices_hors_systeme',
    label: 'Polices hors système (serif, font-[…])',
    scope: 'code',
    re: /\bfont-(?:serif|editorial)\b|\bfont-\[[^\]]+\]|fontFamily\s*:/g,
  },
  {
    id: 'boutons_bruts',
    label: '<button> écrits à la main (hors src/components/ui)',
    scope: 'code-hors-ui',
    re: /<button\b/g,
  },
  {
    id: 'champs_bruts',
    label: '<input>, <select>, <textarea> natifs (hors src/components/ui)',
    scope: 'code-hors-ui',
    re: /<(?:input|select|textarea)\b/g,
  },
  {
    id: 'couleurs_ancienne_marque',
    label: 'Ancienne palette de marque (brand-purple…, --skalr-*)',
    // Reste de la marque Skalr : contredit l'accent unique (01-direction.md, § 2).
    scope: 'code',
    re: /\b(?:bg|text|border|ring|from|to|via|fill|stroke|shadow|outline|decoration|divide|placeholder|caret|accent)-brand-(?:purple|pink|blue|cyan|green)\b|var\(--skalr-/g,
  },
  {
    id: 'texte_attenue',
    label: 'Texte atténué par opacité (text-muted-foreground/60…)',
    // Descend sous 4,5:1 ; trois niveaux de texte existent (01-direction.md, § 2).
    scope: 'code',
    re: /\btext-(?:muted-)?foreground\/(?:\d+|\[[^\]]+\])/g,
  },
  {
    id: 'variables_inconnues',
    label: 'Variables CSS lues sans être déclarées (var(--x))',
    // Une variable absente rend la propriété invalide sans erreur visible (revue G-02).
    scope: 'variables',
  },
  {
    id: 'emoji_interface',
    label: 'Emoji dans les textes visibles (sélecteurs d’emoji des messages compris)',
    scope: 'texte',
    // Caractères rendus en emoji : présentation emoji par défaut, ou pictogramme suivi du sélecteur U+FE0F.
    re: /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/gu,
  },
  {
    id: 'tirets_longs',
    label: 'Tirets longs dans les textes visibles',
    scope: 'texte',
    re: /—/g,
  },
  {
    id: 'noms_fournisseurs',
    label: 'Noms de fournisseurs dans les textes visibles (hors pages légales)',
    scope: 'texte-hors-legal',
    re: /\b(?:Unipile|Apollo|People Data Labs|PDL|Brandfetch|Clearbit|Logo\.dev|Resend|Anthropic|Claude|Deepgram|Coresignal|BetterContact|Dropcontact|Perplexity|Firecrawl|OpenAI)\b/g,
  },
];

// Variables fournies par les bibliothèques (Radix, Tailwind, sonner, vaul) : jamais déclarées dans src/.
const LIBRARY_VARIABLE = /^(?:radix|tw|sonner|vaul)-/;
// { '--x': … }, { ['--x' as string]: … }, ou une règle CSS (--x: …).
const DECLARATION = /(?:^|[\s{;'"`(,[])--([a-zA-Z][\w-]*)['"]?(?:\s+as\s+[\w.]+)?\]?\s*:/g;
const VARIABLE_USE = /var\(\s*--([a-zA-Z][\w-]*)/g;

function measure() {
  if (!existsSync(SRC)) throw new Error(`src/ introuvable depuis ${ROOT}`);
  const totals = Object.fromEntries(METRICS.map((m) => [m.id, 0]));
  const perFile = Object.fromEntries(METRICS.map((m) => [m.id, {}]));
  const files = walk(SRC).map((abs) => {
    const rel = relative(ROOT, abs).split('\\').join('/');
    return { rel, code: stripComments(readFileSync(abs, 'utf8')) };
  });
  // Déclarées : feuilles de style de src/ et objets style du code ({ '--x': … }).
  const declared = new Set();
  const sheets = walkStyles(SRC).map((abs) => ({
    rel: relative(ROOT, abs).split('\\').join('/'),
    code: readFileSync(abs, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
  }));
  for (const { code } of [...sheets, ...files]) for (const m of code.matchAll(DECLARATION)) declared.add(m[1]);
  const unknownVariables = (code) =>
    [...code.matchAll(VARIABLE_USE)].filter((m) => !declared.has(m[1]) && !LIBRARY_VARIABLE.test(m[1])).length;

  for (const { rel, code } of files) {
    const texts = visibleStrings(code).join('\n');
    const inUi = rel.startsWith('src/components/ui/');
    for (const m of METRICS) {
      let n = 0;
      if (m.scope === 'variables') n = unknownVariables(code);
      else {
        let hay;
        if (m.scope === 'code') hay = code;
        else if (m.scope === 'code-hors-ui') hay = inUi ? '' : code;
        else if (m.scope === 'texte') hay = texts;
        else if (m.scope === 'texte-hors-legal') hay = LEGAL_PAGES.has(rel) ? '' : texts;
        n = hay ? (hay.match(m.re) || []).length : 0;
      }
      if (n) {
        totals[m.id] += n;
        perFile[m.id][rel] = n;
      }
    }
  }
  for (const { rel, code } of sheets) {
    const n = unknownVariables(code);
    if (n) {
      totals.variables_inconnues += n;
      perFile.variables_inconnues[rel] = n;
    }
  }
  return { totals, perFile };
}

const args = process.argv.slice(2);
const { totals, perFile } = measure();

// --by-file : la dette par fichier, tous compteurs confondus, pour repérer
// les écrans qu'aucun lot ne couvre encore.
if (args.includes('--by-file')) {
  const byFile = {};
  for (const m of METRICS) {
    for (const [file, n] of Object.entries(perFile[m.id])) {
      byFile[file] ??= { total: 0, detail: [] };
      byFile[file].total += n;
      byFile[file].detail.push(`${m.id} ${n}`);
    }
  }
  for (const [file, { total, detail }] of Object.entries(byFile).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`${String(total).padStart(5)}  ${file}  (${detail.join(', ')})`);
  }
  process.exit(0);
}

if (args.includes('--json')) {
  process.stdout.write(JSON.stringify(totals, null, 2) + '\n');
  process.exit(0);
}

const compareIdx = args.indexOf('--compare');
if (compareIdx !== -1) {
  const base = JSON.parse(readFileSync(args[compareIdx + 1], 'utf8'));
  let worse = 0;
  console.log('Compteur'.padEnd(26), 'base'.padStart(7), 'PR'.padStart(7));
  for (const m of METRICS) {
    const b = base[m.id];
    const p = totals[m.id];
    // Un compteur absent de la base (ajouté par la PR) ne peut pas être comparé.
    const flag = b === undefined ? '  (nouveau compteur)' : p > b ? '  ▲ en hausse' : p < b ? '  ▼ en baisse' : '';
    if (b !== undefined && p > b) worse++;
    console.log(m.id.padEnd(26), String(b ?? '-').padStart(7), String(p).padStart(7) + flag);
  }
  if (worse) {
    console.error(`\n${worse} compteur(s) en hausse : la PR ajoute de la dette design. Voir docs/design/01-direction.md.`);
    process.exit(1);
  }
  process.exit(0);
}

for (const m of METRICS) {
  console.log(`${String(totals[m.id]).padStart(6)}  ${m.label}`);
  if (args.includes('--details')) {
    const top = Object.entries(perFile[m.id]).sort((a, b) => b[1] - a[1]).slice(0, 8);
    for (const [file, n] of top) console.log(`          ${String(n).padStart(4)}  ${file}`);
  }
}
