/**
 * Contraste des jetons (docs/design/01-direction.md, § 2 et § 10 ; décisions du propriétaire du
 * 06/10/2026 : « plus marqué, façon Qonto », bouton plein à l'encre, fond clair à 96 %, zones
 * grises à 92 %, cartes blanches).
 *
 * Relit `:root` (sombre) et `.light` (clair, qui surcharge `:root`) de src/index.css, compose les
 * couleurs comme le navigateur (HSL arrondi sur 8 bits, alpha composé sur la surface qui porte la
 * couleur) et recalcule le rapport WCAG 2.x de chaque paire à seuil, sur la surface la plus
 * défavorable : 4,5:1 pour un texte, 3:1 pour un composant d'interface (bord de bouton ou de champ,
 * anneau, icône, pastille de badge). Surfaces examinées : fond, carte, menu, zone en retrait,
 * survol, ligne active (`brand` à 10 % sur le fond), barre latérale et son élément actif.
 * Le filet des boutons à contour en sombre (`dark:border-foreground/NN`, button.tsx) et la teinte
 * du badge `brand` (`bg-brand/NN`, badge.tsx) sont lus dans leurs primitives.
 *
 * Lancer : node --test tests/ux/contraste-jetons.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// ── Lecture des jetons ──────────────────────────────────────────────────────

const css = read('src/index.css').replace(/\/\*[\s\S]*?\*\//g, '');

/** Corps du premier bloc dont le sélecteur est exactement `selector`. */
function blockOf(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`^\\s*${escaped}\\s*\\{`, 'm').exec(css);
  assert.ok(m, `bloc ${selector} introuvable dans src/index.css`);
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  for (; i < css.length && depth > 0; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
  }
  return css.slice(start, i - 1);
}

function declarations(body) {
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const rootTokens = declarations(blockOf(':root'));
const THEMES = {
  clair: { ...rootTokens, ...declarations(blockOf('.light')) },
  sombre: rootTokens,
};

// ── Couleurs, comme le navigateur ───────────────────────────────────────────

/** Arrondi au pair le plus proche sur une moitié exacte (round de Python, celui des calculs de la spécification). */
function round(x) {
  const f = Math.floor(x);
  if (x - f === 0.5) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

function hslToRgb(h, s, l) {
  const [H, S, L] = [h / 360, s / 100, l / 100];
  if (S === 0) return [L, L, L].map((v) => round(v * 255));
  const m2 = L <= 0.5 ? L * (1 + S) : L + S - L * S;
  const m1 = 2 * L - m2;
  const v = (hue) => {
    const x = ((hue % 1) + 1) % 1;
    if (x < 1 / 6) return m1 + (m2 - m1) * x * 6;
    if (x < 0.5) return m2;
    if (x < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - x) * 6;
    return m1;
  };
  return [v(H + 1 / 3), v(H), v(H - 1 / 3)].map((c) => round(c * 255));
}

const over = (fg, a, bg) => fg.map((f, i) => round(f * a + bg[i] * (1 - a)));
const lin = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Valeur d'un jeton (suit les alias var(--x)). */
function raw(theme, name) {
  let value = THEMES[theme][name];
  for (let guard = 0; value && /^var\(--[\w-]+\)$/.test(value) && guard < 5; guard += 1) {
    value = THEMES[theme][value.slice(4, -1)];
  }
  assert.ok(value, `${theme} : jeton ${name} absent`);
  return value;
}

/** « H S% L% » ou « H S% L% / A » (A en % ou en fraction) → { rgb, a }. */
function parseHsl(value, where) {
  const m = /^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*([\d.]+)(%?))?$/.exec(value);
  assert.ok(m, `${where} : couleur illisible « ${value} »`);
  const a = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
  return { rgb: hslToRgb(Number(m[1]), Number(m[2]), Number(m[3])), a };
}

/**
 * Couleur d'un jeton telle que la rend Tailwind : les filets et le bord de champ passent par
 * leurs variantes séparées (-hsl, -alpha), lues par tailwind.config.ts.
 */
function token(theme, name) {
  const t = THEMES[theme];
  if (t[`--${name}-hsl`] !== undefined) {
    const { rgb } = parseHsl(raw(theme, `--${name}-hsl`), `${theme} --${name}-hsl`);
    return { rgb, a: Number(raw(theme, `--${name}-alpha`)) };
  }
  return parseHsl(raw(theme, `--${name}`), `${theme} --${name}`);
}

/** Couleur opaque d'un jeton posé sur `on` (composée s'il a un alpha). */
function C(theme, name, on) {
  const { rgb, a } = token(theme, name);
  if (a >= 1) return rgb;
  assert.ok(on, `${theme} : --${name} est transparent, il lui faut une surface`);
  return over(rgb, a, on);
}

// ── Valeurs lues dans les primitives ────────────────────────────────────────

const button = read('src/components/ui/button.tsx');
const inkDark = /dark:border-foreground\/(\d+)/.exec(button);
assert.ok(inkDark, 'button.tsx : filet d\'encre des boutons à contour en sombre (dark:border-foreground/NN)');
const INK_ALPHA = { clair: 1, sombre: Number(inkDark[1]) / 100 };

const badge = read('src/components/ui/badge.tsx');
const brandTint = /bg-brand\/(\d+)/.exec(badge);
assert.ok(brandTint, 'badge.tsx : teinte du badge brand (bg-brand/NN)');
const BRAND_TINT = Number(brandTint[1]) / 100;

const placeholder = /^hsl\(var\(--muted-foreground\)(?:\s*\/\s*([\d.]+))?\)$/.exec(rootTokens['--k-text-placeholder'] ?? '');
assert.ok(placeholder, '--k-text-placeholder doit dériver de --muted-foreground');
const PLACEHOLDER_ALPHA = placeholder[1] === undefined ? 1 : Number(placeholder[1]);

// ── Surfaces ────────────────────────────────────────────────────────────────

const LABEL = {
  bg: 'fond', card: 'carte', popover: 'menu', muted: 'retrait', accent: 'survol', sel: 'ligne active',
  side: 'barre', sacc: 'actif barre',
};
const TXT = ['bg', 'card', 'popover', 'muted', 'accent', 'sel'];
const ALL = [...TXT, 'side', 'sacc'];

function surfaces(theme) {
  const bg = C(theme, 'background');
  return {
    bg,
    card: C(theme, 'card', bg),
    popover: C(theme, 'popover', bg),
    muted: C(theme, 'muted', bg),
    accent: C(theme, 'accent', bg),
    side: C(theme, 'sidebar-background', bg),
    sacc: C(theme, 'sidebar-accent', bg),
    sel: over(C(theme, 'brand', bg), 0.1, bg),
  };
}

// ── Les 44 paires à seuil (spécification v2 du contraste, § 10.1) ──────────

const TEXT = 4.5;
const UI = 3;
/** Couleur `name` posée sur la surface examinée. */
const on = (name) => (t, s, n) => [C(t, name, s[n]), s[n]];
/** Couleur fixe, quelle que soit la surface examinée. */
const fixed = (fn) => ({ fn, surfaces: ['bg'] });
const ink = (t, base) => over(C(t, 'foreground'), INK_ALPHA[t], base);
const brandTintOn = (t, s) => over(C(t, 'brand'), BRAND_TINT, s.card);

const STATUSES = [
  ['warning', 'status-warning', 'status-warning-muted'],
  ['success', 'status-success', 'status-success-muted'],
  ['info', 'status-info', 'status-info-muted'],
  ['danger', 'danger', 'danger-muted'],
];

const PAIRS = [
  // Texte
  { name: 'texte : encre (foreground)', target: TEXT, surfaces: ALL, fn: on('foreground') },
  { name: 'texte : foreground-secondary', target: TEXT, surfaces: ALL, fn: on('foreground-secondary') },
  { name: 'texte : gris secondaire (muted-foreground)', target: TEXT, surfaces: ALL, fn: on('muted-foreground') },
  { name: 'texte : sidebar-foreground', target: TEXT, surfaces: ['side', 'sacc'], fn: on('sidebar-foreground') },
  { name: 'texte : brand (lien d\'accent)', target: TEXT, surfaces: ALL, fn: on('brand') },
  {
    name: 'texte indicatif (--k-text-placeholder)', target: TEXT, surfaces: ['bg', 'card'],
    fn: (t, s, n) => [over(C(t, 'muted-foreground', s[n]), PLACEHOLDER_ALPHA, s[n]), s[n]],
  },
  // Statuts (texte et icône de statut)
  ...STATUSES.map(([label, color]) => ({ name: `statut ${label} : texte, icône`, target: TEXT, surfaces: ALL, fn: on(color) })),
  // Badges à la Qonto : texte à l'encre, pastille de la couleur du statut, sur la teinte du statut
  ...STATUSES.flatMap(([label, color, tint]) => [
    { name: `badge ${label} : texte à l'encre / sa teinte`, target: TEXT, ...fixed((t) => [C(t, 'foreground'), C(t, tint)]) },
    { name: `badge ${label} : pastille / sa teinte`, target: UI, ...fixed((t) => [C(t, color), C(t, tint)]) },
  ]),
  { name: 'badge muted : texte à l\'encre / muted', target: TEXT, ...fixed((t, s) => [C(t, 'foreground'), s.muted]) },
  { name: 'badge brand : texte à l\'encre / sa teinte', target: TEXT, ...fixed((t, s) => [C(t, 'foreground'), brandTintOn(t, s)]) },
  { name: 'badge brand : pastille / sa teinte', target: UI, ...fixed((t, s) => [C(t, 'brand'), brandTintOn(t, s)]) },
  // Boutons
  { name: 'bouton plein : libellé / aplat d\'encre', target: TEXT, ...fixed((t) => [C(t, 'primary-foreground'), C(t, 'primary')]) },
  { name: 'bouton plein : aplat / surface', target: UI, surfaces: ALL, fn: on('primary') },
  { name: 'bouton outline, default : contour d\'encre / surface', target: UI, surfaces: ALL, fn: (t, s, n) => [ink(t, s[n]), s[n]] },
  { name: 'bouton secondary : contour d\'encre / surface', target: UI, surfaces: ALL, fn: (t, s, n) => [ink(t, s[n]), s[n]] },
  { name: 'bouton à contour : libellé à l\'encre / surface', target: TEXT, surfaces: ALL, fn: on('foreground') },
  { name: 'bouton à contour survolé : filet / survol', target: UI, ...fixed((t, s) => [ink(t, s.accent), s.accent]) },
  { name: 'bouton discret : libellé à l\'encre / surface', target: TEXT, surfaces: ALL, fn: on('foreground') },
  { name: 'bouton discret de retrait : gris secondaire / surface', target: TEXT, surfaces: ALL, fn: on('muted-foreground') },
  // Contrôles
  { name: 'champ, case, piste éteinte : bord input', target: UI, surfaces: TXT, fn: on('input') },
  { name: 'radio : bord input', target: UI, surfaces: ['bg', 'card', 'popover'], fn: on('input') },
  { name: 'onglet, segment actif : anneau border-strong / rail muted', target: UI, ...fixed((t, s) => [C(t, 'border-strong', s.muted), s.muted]) },
  { name: 'FilterPill active : contour d\'encre', target: UI, surfaces: ['bg', 'card'], fn: on('foreground') },
  { name: 'Toggle allumé : anneau border-strong / survol', target: UI, ...fixed((t, s) => [C(t, 'border-strong', s.accent), s.accent]) },
  { name: 'Switch allumé : pastille brand-foreground / piste brand', target: UI, ...fixed((t) => [C(t, 'brand-foreground'), C(t, 'brand')]) },
  { name: 'case cochée, piste allumée : brand / surface', target: UI, surfaces: TXT, fn: on('brand') },
  { name: 'chevron du Select : encre / surface', target: UI, surfaces: ['bg', 'card', 'popover'], fn: on('foreground') },
  { name: 'anneau de focus : ring / surface', target: UI, surfaces: ALL, fn: on('ring') },
  { name: 'focus d\'un champ : bord et anneau ring / surface', target: UI, surfaces: TXT, fn: on('ring') },
  // Icônes
  { name: 'icône d\'action ou d\'accompagnement : encre / surface', target: UI, surfaces: TXT, fn: on('foreground') },
  { name: 'icône de la barre (rangée basse, tête de ligne) : sidebar-foreground', target: UI, surfaces: ['side', 'sacc'], fn: on('sidebar-foreground') },
  { name: 'icône de champ ou de retrait : gris secondaire / surface', target: UI, surfaces: ALL, fn: on('muted-foreground') },
  { name: 'icône autrefois à opacité, désormais à l\'encre / surface', target: UI, surfaces: ['bg', 'card'], fn: on('foreground') },
  { name: 'pastille d\'état vide, IconTile neutre : encre / muted', target: UI, ...fixed((t, s) => [C(t, 'foreground'), s.muted]) },
];

function worst(theme, pair) {
  const s = surfaces(theme);
  let result = null;
  for (const n of pair.surfaces) {
    const [fg, bg] = pair.fn(theme, s, n);
    const r = ratio(fg, bg);
    if (!result || r < result.r) result = { r, surface: LABEL[n], fg: hex(fg), bg: hex(bg) };
  }
  return result;
}

const fmt = (r) => r.toFixed(2).replace('.', ',');

test('44 paires à seuil par thème, comme la spécification', () => {
  assert.equal(PAIRS.length, 44);
});

for (const theme of ['clair', 'sombre']) {
  test(`Thème ${theme} : chaque paire à seuil tient sa cible sur la surface la plus défavorable`, () => {
    const failures = [];
    for (const pair of PAIRS) {
      const w = worst(theme, pair);
      if (w.r < pair.target) {
        failures.push(`${pair.name} : ${fmt(w.r)}:1 < ${fmt(pair.target)}:1 (${w.fg} sur ${w.bg}, ${w.surface})`);
      }
    }
    assert.deepEqual(failures, [], `contrastes sous la cible en thème ${theme}`);
  });
}

test('Relief du thème clair : zones grises et cartes blanches se détachent du fond (décision 3)', () => {
  const s = surfaces('clair');
  assert.deepEqual(s.card, [255, 255, 255], 'cartes blanches');
  assert.ok(ratio(s.card, s.bg) >= 1.08, `carte / fond : ${fmt(ratio(s.card, s.bg))}`);
  assert.ok(ratio(s.muted, s.bg) >= 1.08, `zone grise / fond : ${fmt(ratio(s.muted, s.bg))}`);
  assert.ok(ratio(s.muted, s.card) >= 1.15, `zone grise / carte : ${fmt(ratio(s.muted, s.card))}`);
});

test('Filets et bord de champ : la valeur courte et ses variantes -hsl / -alpha disent la même chose', () => {
  for (const theme of ['clair', 'sombre']) {
    for (const name of ['border', 'border-strong', 'input']) {
      const short = parseHsl(raw(theme, `--${name}`), `${theme} --${name}`);
      const split = token(theme, name);
      assert.deepEqual(short.rgb, split.rgb, `${theme} --${name} : teinte`);
      assert.ok(Math.abs(short.a - split.a) < 1e-9, `${theme} --${name} : opacité ${short.a} contre ${split.a}`);
    }
  }
});
