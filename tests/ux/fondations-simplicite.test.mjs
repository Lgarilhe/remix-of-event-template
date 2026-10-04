/**
 * Design simplifié, lot des fondations (docs/design/06-simplicite.md) :
 * paliers de texte, tailles écrites à la main, titre de page, visages des
 * personnes, icônes qui attendent.
 *
 * Lecture du source, et rendu statique des composants empaquetés par esbuild
 * (alias @/ résolus par tsconfig.app.json).
 * Lancer : node --test tests/ux/fondations-simplicite.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

function listSources(dir) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...listSources(rel));
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(rel);
  }
  return out;
}

// Les composants et le rendu React dans un seul paquet (une seule copie de React).
const { outputFiles } = await build({
  stdin: {
    contents: [
      "export { cn } from './src/lib/utils';",
      "export { PersonAvatar, AvatarStack } from './src/components/ui/person-avatar';",
      "export { initialsOf } from './src/lib/initials';",
      "export { TypingIcon, HourglassIcon, AlarmIcon, SparkleIcon, PingDot } from './src/components/ui/animated-icons';",
      "export { createElement } from 'react';",
      "export { renderToStaticMarkup } from 'react-dom/server.browser';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  tsconfig: join(ROOT, 'tsconfig.app.json'),
  define: { 'process.env.NODE_ENV': '"production"' },
});
const kit = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const render = (component, props = {}) => kit.renderToStaticMarkup(kit.createElement(component, props));

test('paliers : rien sous 12 px, corps à 14 px, titre de page à 28 px', () => {
  const config = read('tailwind.config.ts');
  const start = config.indexOf('fontSize: {');
  const block = config.slice(start, config.indexOf('\n  \t\t},', start));
  const sizes = Object.fromEntries(
    [...block.matchAll(/'?([\w-]+)'?: \['([\d.]+)rem'/g)].map((m) => [m[1], Number(m[2]) * 16]),
  );
  assert.deepEqual(sizes, { '3xs': 12, '2xs': 12, xs: 13, sm: 14, md: 15, title: 28 });
});

test('aucune taille de texte écrite à la main', () => {
  const offenders = listSources('src').filter((rel) => /text-\[\d+(\.\d+)?(px|rem)\]/.test(read(rel)));
  assert.deepEqual(offenders, []);
});

test('cn traite text-title comme une taille, pas comme une couleur', () => {
  assert.equal(kit.cn('text-foreground text-title'), 'text-foreground text-title');
  assert.equal(kit.cn('text-xl text-title'), 'text-title');
  assert.equal(kit.cn('text-title text-sm'), 'text-sm');
});

test('PageHeader : titre de page à 28 px, sous-titre à 15 px', () => {
  const src = read('src/components/layout/PageHeader.tsx');
  assert.match(src, /<h1 className="truncate text-title font-semibold text-foreground">/);
  assert.match(src, /<p className="max-w-2xl text-md text-muted-foreground">/);
});

test('visage : photo, sinon initiales, et un lien en échec repasse aux initiales', () => {
  assert.equal(kit.initialsOf('Julie Bonnet'), 'JB');
  assert.equal(kit.initialsOf('  marie  claire dupont '), 'MD');
  assert.equal(kit.initialsOf('Madonna'), 'M');
  assert.equal(kit.initialsOf(''), '?');
  assert.equal(kit.initialsOf(null), '?');

  const photo = render(kit.PersonAvatar, { name: 'Julie Bonnet', src: 'https://example.test/julie.jpg', size: 36 });
  assert.match(photo, /<img [^>]*src="https:\/\/example\.test\/julie\.jpg"/);
  assert.match(photo, /aria-hidden="true"/, 'décoratif par défaut');
  assert.match(photo, /referrerPolicy="no-referrer"|referrerpolicy="no-referrer"/);
  const initials = render(kit.PersonAvatar, { name: 'Julie Bonnet', src: null, alt: 'Photo de Julie Bonnet' });
  assert.match(initials, /role="img" aria-label="Photo de Julie Bonnet"/);
  assert.match(initials, />JB</);

  const src = read('src/components/ui/person-avatar.tsx');
  assert.match(src, /onError=\{\(\) => setFailedSrc\(src\)\}/);
  assert.match(src, /if \(src && src !== failedSrc\)/, 'un autre lien est retenté');
  for (const rel of ['src/components/dashboard/CandidateAvatar.tsx', 'src/components/candidates/shared/CandidateAvatar.tsx']) {
    const avatar = read(rel);
    assert.match(avatar, /<PersonAvatar/, `${rel} passe par PersonAvatar`);
    assert.doesNotMatch(avatar, /style\.display = 'none'/, `${rel} : plus d'image masquée sans initiales`);
  }
});

test('pile de visages : trois visages au plus, puis « +N », et les noms pour les lecteurs d\'écran', () => {
  const people = ['Julie Bonnet', 'Sarah Bonnet', 'Inès Durand', 'Hugo Clement'].map((name) => ({ name }));
  const five = render(kit.AvatarStack, { people, total: 6 });
  assert.match(five, /aria-label="Julie Bonnet, Sarah Bonnet, Inès Durand et 3 autres"/);
  assert.match(five, />\+3</);
  assert.equal((five.match(/>(JB|SB|ID|HC)</g) || []).length, 3);
  const two = render(kit.AvatarStack, { people: people.slice(0, 2) });
  assert.match(two, /aria-label="Julie Bonnet et Sarah Bonnet"/);
  assert.doesNotMatch(two, /\+\d/);
  assert.equal(render(kit.AvatarStack, { people: [] }), '');
});

test('icônes qui attendent : décoratives, et chaque boucle finit sur la pose fixe', () => {
  const typing = render(kit.TypingIcon);
  assert.equal((typing.match(/animate-typing-dot/g) || []).length, 3);
  for (const [icon, animation] of [
    [kit.TypingIcon, 'animate-typing-dot'],
    [kit.HourglassIcon, 'animate-hourglass-flip'],
    [kit.AlarmIcon, 'animate-alarm-ring'],
    [kit.SparkleIcon, 'animate-twinkle'],
    [kit.PingDot, 'animate-ping-slow'],
  ]) {
    const html = render(icon);
    assert.match(html, /^<(svg|span) [^>]*aria-hidden="true"/, `${animation} : décorative`);
    assert.match(html, new RegExp(animation));
  }

  const config = read('tailwind.config.ts');
  assert.match(config, /'typing-dot': \{\n\s+'0%, 60%, 100%': \{ transform: 'translateY\(0\)'/);
  assert.match(config, /'100%': \{ transform: 'rotate\(360deg\)' \}/);
  assert.match(config, /'alarm-ring': \{\n\s+'0%, 70%, 100%': \{ transform: 'rotate\(0deg\)' \}/);
  assert.match(config, /twinkle: \{\n\s+'0%, 72%, 100%': \{ transform: 'scale\(1\)' \}/);
  assert.match(config, /'ping-slow': 'ping 2\.2s/);
  // Mouvement réduit : la règle globale arrête tout, y compris ces boucles.
  assert.match(read('src/index.css'), /@media \(prefers-reduced-motion: reduce\) \{\n\s+\*,\n\s+\*::before,\n\s+\*::after \{\n\s+animation-duration: 0\.01ms !important;\n\s+animation-iteration-count: 1 !important;/);
});
