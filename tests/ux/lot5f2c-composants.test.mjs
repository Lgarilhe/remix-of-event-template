/**
 * Refonte mission, lot 5f-2c : les trois composants de présentation de
 * ContactFlow (src/components/sequences/contact/) :
 * - RecipientGroups : candidats en trois groupes (Prêts, À compléter, Exclus) ;
 * - SequencePicker : choix de la séquence et porte « Rédiger une séquence » ;
 * - QuotaGauge : jauge du plafond LinkedIn.
 *
 * Gardes de source (textes, kit, icônes, imports) et rendu statique : les
 * composants sont empaquetés par esbuild avec les modules purs du lot, puis
 * rendus par react-dom/server. Le menu déroulant du kit est remplacé par une
 * doublure toujours ouverte pour lire son contenu ; l'avatar et la lecture de
 * description du poste sont des doublures. Rien d'autre n'est simulé.
 *
 * Lancer : node --test tests/ux/lot5f2c-composants.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT_PATH = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT_PATH, rel), 'utf8');

const GROUPS = 'src/components/sequences/contact/RecipientGroups.tsx';
const PICKER = 'src/components/sequences/contact/SequencePicker.tsx';
const GAUGE = 'src/components/sequences/contact/QuotaGauge.tsx';
const FILES = [GROUPS, PICKER, GAUGE];

const EM_DASH = String.fromCharCode(0x2014);

/** Code sans commentaires (les commentaires peuvent citer d'anciens textes). */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** Chemins importés par un fichier, dans l'ordre. */
const importsOf = (rel) => [...code(rel).matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);

const decode = (s) => s
  .replace(/&#x27;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');
/** Texte visible d'un fragment de HTML. */
const plain = (html) => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const count = (haystack, needle) => haystack.split(needle).length - 1;

// ---------------------------------------------------------------------------
// Gardes de source
// ---------------------------------------------------------------------------

test('5F2C-C1 aucun tiret long, aucun « (s) », aucun nom de prestataire, commentaires compris', () => {
  for (const rel of FILES) {
    const src = read(rel);
    assert.ok(!src.includes(EM_DASH), `${rel} : tiret long`);
    assert.ok(!/[A-Za-zÀ-ÿ]\(s\)/.test(src), `${rel} : « (s) » collé à un mot`);
    assert.ok(!/\b(Unipile|Apollo|PDL|People Data Labs|Anthropic|Claude|Notion|Brandfetch|Clearbit|Resend|Deepgram|OpenAI)\b/.test(src), `${rel} : nom de prestataire`);
  }
});

test('5F2C-C2 Button du kit : aucun <button>, <input>, <select> ni <textarea> brut, aucun bouton plein', () => {
  for (const rel of FILES) {
    const src = code(rel);
    assert.ok(!/<(button|input|select|textarea)\b/.test(src), `${rel} : élément brut`);
    assert.ok(!/variant="primary"/.test(src), `${rel} : un seul bouton plein par zone, et il est dans ContactFlow`);
  }
  for (const rel of [GROUPS, PICKER]) {
    assert.match(code(rel), /import \{ Button \} from '@\/components\/ui\/button';/, `${rel} : Button du kit`);
    assert.match(code(rel), /<Button\b/, `${rel} : utilise Button`);
  }
});

test('5F2C-C3 aucune lecture de données : seuls les imports de présentation et des modules purs', () => {
  const allowed = {
    [GROUPS]: [
      'react', 'lucide-react', '@/components/ui/button', '@/components/ui/person-avatar',
      '@/lib/contactFlowGroups', '@/lib/utils', './types',
    ],
    [PICKER]: [
      'react', 'react-router-dom', 'lucide-react', '@/components/ui/button', '@/components/ui/dropdown-menu',
      '@/components/ui/skeleton', '@/hooks/useSequenceAI', '@/lib/missionSequencePick', '@/lib/plural',
      '@/lib/sequenceDraft', '@/lib/sequencesBeta', '@/lib/utils', './useContactSequences',
    ],
    [GAUGE]: ['@/components/ui/progress', '@/lib/quotaGauge', '@/lib/utils'],
  };
  for (const rel of FILES) {
    for (const spec of importsOf(rel)) {
      assert.ok(allowed[rel].includes(spec), `${rel} : import inattendu « ${spec} »`);
    }
    const src = code(rel);
    assert.ok(!/supabase/i.test(src), `${rel} : aucun accès à la base`);
    assert.ok(!/MissionV3Context|useMissionV3|missionSelection|useMissionSelection|useOrganization|useQuery|invokeEdgeFunction/.test(src), `${rel} : aucun contexte de mission ni lecture`);
  }
});

test('5F2C-C4 types : aucun any, aucun @ts-ignore, pas de plural local', () => {
  for (const rel of FILES) {
    const src = code(rel);
    assert.ok(!/:\s*any\b|\bas any\b|<any>|any\[\]/.test(src), `${rel} : any`);
    assert.ok(!/@ts-(ignore|expect-error|nocheck)/.test(read(rel)), `${rel} : directive TypeScript`);
    assert.ok(!/(?:const|function)\s+plural\b/.test(src), `${rel} : plural local`);
  }
  assert.match(code(PICKER), /import \{ plural \} from '@\/lib\/plural';/);
  assert.match(code(PICKER), /plural\(sequence\.stepCount, 'étape'\)/, 'le nombre d\'étapes passe par plural');
});

test('5F2C-C5 jetons seulement : ni z-[N], ni text-[Npx], ni couleur de palette ou hexadécimale, ni halo', () => {
  const PALETTE = /\b(?:bg|text|border|ring|fill|stroke|outline|divide|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)\b/;
  for (const rel of FILES) {
    const src = code(rel);
    assert.ok(!/\bz-\[/.test(src), `${rel} : z-[N]`);
    assert.ok(!/text-\[\d/.test(src), `${rel} : taille arbitraire`);
    assert.ok(!PALETTE.test(src), `${rel} : couleur de palette`);
    assert.ok(!/-\[#[0-9a-fA-F]|-\[rgb\(|-\[hsl\(/.test(src), `${rel} : couleur arbitraire`);
    assert.ok(!/ring-\[3px\]|ring-ring\/20/.test(src), `${rel} : halo`);
  }
});

test('5F2C-C6 aucune icône grise ni voilée, aucun bouton discret gris', () => {
  const GREY = /text-muted-foreground|text-foreground-secondary|text-foreground\/\d+|text-\[var\(--k-text-muted\)\]/;
  const VEIL = /(?<![\w:-])opacity-\d+/;
  for (const rel of FILES) {
    const src = code(rel);
    for (const m of src.matchAll(/<(Check|ChevronDown|ChevronRight|Sparkles)\b([^>]*)\/?>/g)) {
      assert.ok(!GREY.test(m[2]) && !VEIL.test(m[2]), `${rel} : icône ${m[1]} grise ou voilée`);
    }
    for (const m of src.matchAll(/<Button\b([^>]*)>/g)) {
      if (/variant="(?:ghost|link)"/.test(m[1])) {
        assert.ok(!GREY.test(m[1]), `${rel} : bouton discret gris`);
      }
    }
    assert.ok(!/\[&(?:_|>)svg\]:(?:text-muted-foreground|opacity)/.test(src), `${rel} : parent qui grise les icônes`);
  }
});

test('5F2C-C7 textes : vouvoiement, français, casse de phrase', () => {
  const TU = /\b(tu|ton|ta|tes|toi|t'as|tu as)\b|\b(Clique|Sélectionne|Crée|Vérifie|Réessaie|Ajoute|Choisis|Saisis|Lance|Reconnecte-toi|Recharge|Active|Désactive|Écris|Pose|Décris|Dépose)\b(?!-vous)/;
  const JARGON = /\b(step|steps|preview|previews|enrollment|enrollments|template|templates|trigger|sender|senders|timeout|analytics|funnel|workflow|batch|skipp|CTA)\b/i;
  for (const rel of FILES) {
    // Sans les imports ni les classes (className="…" ou className={cn(…)}), qui ne sont pas des textes.
    const src = code(rel)
      .replace(/\bfrom\s+(['"])[^'"\n]*\1/g, '')
      .replace(/^\s*import\s+(['"])[^'"\n]*\1/gm, '')
      .replace(/className=(?:"[^"]*"|\{[^}]*\})/g, '');
    const texts = [
      ...[...src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]),
      ...[...src.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]),
      ...[...src.matchAll(/`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1]),
      ...[...src.matchAll(/>([^<>{}=;]*[A-Za-zÀ-ÿ][^<>{}=;]*)(?=[<{])/g)].map((m) => m[1].trim()),
    ].filter((t) => /[a-zà-ÿ]{3}/i.test(t) && /\s/.test(t) && !/https?:/.test(t));
    assert.ok(texts.length >= 1, `${rel} : des textes sont lus (${texts.length})`);
    for (const text of texts) {
      assert.ok(!TU.test(text), `${rel} : tutoiement dans « ${text} »`);
      assert.ok(!JARGON.test(text) || /^[a-z_.:-]+$/.test(text), `${rel} : jargon dans « ${text} »`);
    }
  }
});

test('5F2C-C8 RecipientGroups : trois sections nommées, gestes sur les props, hauteur bornée, cibles de 44 px', () => {
  const src = code(GROUPS);
  assert.match(src, /data-contact-group=\{groupKey\}/);
  for (const key of ['ready', 'incomplete', 'excluded']) assert.match(src, new RegExp(`groupKey="${key}"`), `section ${key}`);
  assert.match(src, /ready: 'Prêts',\s*incomplete: 'À compléter',\s*excluded: 'Exclus'/);
  assert.match(src, /<h4 id=\{headingId\}/);
  assert.match(src, /aria-labelledby=\{headingId\}/);
  assert.match(src, /aria-expanded=\{open\}/);
  assert.match(src, /<ul className="divide-y divide-border">/);
  assert.match(src, /<li data-contact-row=\{source\.id\}/);
  assert.match(src, /max-h-64 overflow-y-auto/);
  assert.match(src, /const TOUCH = 'max-lg:min-h-11';/);
  assert.match(src, /onClick=\{\(\) => onToggleOverride\(override\)\}/);
  assert.match(src, /onClick=\{\(\) => onToggleOverride\(category\)\}/);
  assert.match(src, /onClick=\{\(\) => onOpenCandidate\(entry\.source\.rowId\)\}/);
  assert.match(src, /OVERRIDE_LABEL\[override\]/);
  assert.match(src, /READY_OPEN_MAX = 5/);
  assert.match(src, /Annuler la dérogation/);
  for (const text of ['Inscrit quand même', 'Inclus quand même', 'Ouvrir la fiche', 'Seuls les propriétaires et administrateurs peuvent les inscrire quand même.']) {
    assert.ok(src.includes(text), `texte « ${text} »`);
  }
  assert.ok(src.includes("Cette séquence contient des messages rédigés par l'IA Konekt pour chaque candidat. Relisez-les avant l'inscription."));
  // Seul le composant est exporté (react-refresh).
  assert.deepEqual([...src.matchAll(/^export\s+(?:function|const)\s+(\w+)/gm)].map((m) => m[1]), ['RecipientGroups']);
});

test('5F2C-C9 SequencePicker : la porte Rédiger s\'ouvre dans un nouvel onglet, sans lien en dur', () => {
  const src = code(PICKER);
  assert.match(src, /import \{ newSequencePath \} from '@\/lib\/sequencesBeta';/);
  assert.match(src, /newSequencePath\(\{ kind: 'ia' \}, missionId\)/);
  assert.ok(!/['"`]\/sequences\b|SEQUENCES_PATH|\bsequencePath\(/.test(src), 'aucun lien en dur vers /sequences');
  const anchors = [...src.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(anchors.length, 2, 'la porte du menu et la porte de l\'état vide');
  for (const tag of anchors) {
    assert.match(tag, /href=\{draftHref\}/);
    assert.match(tag, /target="_blank"/);
    assert.match(tag, /rel="noreferrer"/);
  }
  assert.equal(count(src, 'target="_blank"'), count(src, 'rel="noreferrer"'));
  assert.match(src, /useMissionDraftReadiness\(missionId\)/);
  assert.match(src, /<Link to=\{cadrageHref\}>Décrire le poste<\/Link>/);
  for (const text of [
    'Rédiger une séquence pour cette mission',
    "S'ouvre dans un nouvel onglet. Au retour, la liste se met à jour.",
    "Cette mission n'a pas de séquence prête à l'emploi.",
    "Les séquences n'ont pas pu être chargées.",
    'Séquences de la mission',
    "Autres séquences de l'organisation",
    'Choisir une séquence',
    'Réessayer',
  ]) {
    assert.ok(src.includes(text), `texte « ${text} »`);
  }
  assert.match(src, /aria-labelledby=\{`\$\{labelId\} \$\{valueId\}`\}/);
  assert.match(src, /aria-busy="true"/);
  assert.match(src, /role="alert"/);
  assert.deepEqual([...src.matchAll(/^export\s+(?:function|const)\s+(\w+)/gm)].map((m) => m[1]), ['SequencePicker']);
});

test('5F2C-C10 QuotaGauge : barre fine du kit, nom accessible en pourcentage, jamais « N / M »', () => {
  const src = code(GAUGE);
  assert.match(src, /<Progress\b/);
  assert.match(src, /'h-1\.5'/);
  assert.match(src, /\[&>div\]:bg-warning/);
  assert.match(src, /\[&>div\]:bg-danger/);
  assert.match(src, /Plafond LinkedIn utilisé après cette inscription : \$\{model\.percent\} %/);
  assert.match(src, /role="status"/);
  assert.ok(!/model\.(used|cap|remaining)\b/.test(src), 'aucun chiffre brut du plafond');
  assert.ok(!/\}\s*\/\s*\{/.test(src), 'aucun « {a} / {b} »');
  assert.deepEqual([...src.matchAll(/^export\s+(?:function|const)\s+(\w+)/gm)].map((m) => m[1]), ['QuotaGauge']);
});

// ---------------------------------------------------------------------------
// Rendu statique
// ---------------------------------------------------------------------------

const STUBS = {
  // Avatar : la copie privée passe par la base, hors sujet ici.
  avatar: [
    "import { createElement } from 'react';",
    "export const PersonAvatar = (props) => createElement('span', { 'data-avatar': props.candidateId ?? '' });",
  ].join('\n'),
  // Description du poste : pilotée par le test (globalThis.__readiness).
  readiness: [
    'export const useMissionDraftReadiness = () => globalThis.__readiness ?? { loading: false, described: true, cadrageHref: "/missions/m-1/cadrage?section=poste" };',
  ].join('\n'),
  // Menu du kit toujours ouvert : seule la composition de SequencePicker est lue.
  menu: [
    "import { createElement, cloneElement } from 'react';",
    "const box = (tag) => ({ children, className }) => createElement(tag, { className }, children);",
    'export const DropdownMenu = ({ children }) => createElement("div", { "data-menu": "" }, children);',
    'export const DropdownMenuTrigger = ({ children }) => children;',
    'export const DropdownMenuContent = box("div");',
    'export const DropdownMenuLabel = box("p");',
    'export const DropdownMenuSeparator = () => createElement("hr");',
    'export const DropdownMenuItem = ({ asChild, disabled, children, className, ...rest }) => asChild',
    '  ? cloneElement(children, { role: "menuitem", className })',
    '  : createElement("div", { role: "menuitem", "aria-disabled": disabled ? "true" : undefined, "aria-current": rest["aria-current"], "data-sequence-id": rest["data-sequence-id"], className }, children);',
  ].join('\n'),
};

function stubPlugin(withMenuStub) {
  const table = {
    'person-avatar': STUBS.avatar,
    useSequenceAI: STUBS.readiness,
    ...(withMenuStub ? { 'dropdown-menu': STUBS.menu } : {}),
  };
  return {
    name: 'stubs-5f2c',
    setup(b) {
      b.onResolve({ filter: /(?:person-avatar|\/useSequenceAI|ui\/dropdown-menu)$/ }, (args) => {
        const key = Object.keys(table).find((k) => args.path.endsWith(k));
        return key ? { path: key, namespace: 'stub-5f2c' } : undefined;
      });
      b.onLoad({ filter: /.*/, namespace: 'stub-5f2c' }, (args) => ({ contents: table[args.path], loader: 'js', resolveDir: ROOT_PATH }));
    },
  };
}

async function buildKit(withMenuStub) {
  const { outputFiles } = await build({
    stdin: {
      contents: [
        "export { RecipientGroups } from './src/components/sequences/contact/RecipientGroups';",
        "export { SequencePicker } from './src/components/sequences/contact/SequencePicker';",
        "export { QuotaGauge } from './src/components/sequences/contact/QuotaGauge';",
        "export { classifyContactEntries } from './src/lib/contactFlowGroups';",
        "export { quotaGauge } from './src/lib/quotaGauge';",
        "export { missionSequenceMenu } from './src/lib/missionSequencePick';",
        "export { createElement } from 'react';",
        "export { renderToStaticMarkup } from 'react-dom/server.browser';",
        "export { MemoryRouter } from 'react-router-dom';",
      ].join('\n'),
      resolveDir: ROOT_PATH,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    tsconfig: join(ROOT_PATH, 'tsconfig.app.json'),
    plugins: [stubPlugin(withMenuStub)],
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}

const kit = await buildKit(true);

const MISSION = '5b1c2d3e-0000-4000-8000-000000000001';

const candidate = (id, extra = {}) => ({
  id,
  name: `Candidat ${id}`,
  hasLinkedIn: true,
  rowId: `row-${id}`,
  candidateId: `cand-${id}`,
  headline: `Poste de ${id}`,
  pictureUrl: null,
  profile: {},
  ...extra,
});
const eligibility = (extra = {}) => ({
  blocking: new Map(),
  erased: new Set(),
  recent: new Map(),
  incompatible: new Map(),
  warnings: new Map(),
  ...extra,
});
const classify = (entries, eligibilityExtra = {}, options = {}) =>
  kit.classifyContactEntries(entries, eligibility(eligibilityExtra), {
    aiReview: false,
    canOverrideRecent: true,
    overrides: new Set(),
    ...options,
  });
const renderGroups = (groups, extra = {}) =>
  kit.renderToStaticMarkup(kit.createElement(kit.RecipientGroups, {
    groups,
    canOverrideRecent: true,
    overrides: new Set(),
    onToggleOverride() {},
    onOpenCandidate() {},
    ...extra,
  }));
const sectionOf = (html, key) => {
  const start = html.indexOf(`<section data-contact-group="${key}"`);
  if (start < 0) return null;
  return html.slice(start, html.indexOf('</section>', start) + '</section>'.length);
};

test('5F2C-C11 trois sections dans l\'ordre, titres avec effectif, aucune section vide', () => {
  const groups = classify(
    [candidate('a'), candidate('b'), candidate('c', { hasLinkedIn: false }), candidate('d'), candidate('e')],
    { blocking: new Map([['d', 'in_sequence'], ['e', 'passed']]) },
  );
  const html = renderGroups(groups);
  const order = ['ready', 'incomplete', 'excluded'].map((key) => html.indexOf(`data-contact-group="${key}"`));
  assert.ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], `ordre : ${order}`);
  assert.match(plain(sectionOf(html, 'ready')), /^Prêts \(2\)/);
  assert.match(plain(sectionOf(html, 'incomplete')), /^À compléter \(1\)/);
  assert.match(plain(sectionOf(html, 'excluded')), /^Exclus \(2\)/);
  // Chaque section est nommée par son titre.
  for (const key of ['ready', 'incomplete', 'excluded']) {
    const section = sectionOf(html, key);
    const labelled = section.match(/aria-labelledby="([^"]+)"/)[1];
    assert.ok(section.includes(`<h4 id="${labelled}"`), `titre de ${key}`);
  }
  // Seulement des prêts : ni « À compléter » ni « Exclus ».
  const onlyReady = renderGroups(classify([candidate('a')]));
  assert.ok(onlyReady.includes('data-contact-group="ready"'));
  assert.ok(!onlyReady.includes('data-contact-group="incomplete"'));
  assert.ok(!onlyReady.includes('data-contact-group="excluded"'));
  // Rien du tout : le composant ne rend rien.
  assert.equal(renderGroups(classify([])), '');
});

test('5F2C-C12 une ligne par candidat : nom, intitulé, avatar de la copie privée', () => {
  const html = renderGroups(classify([candidate('a'), candidate('b')]));
  assert.equal(count(html, '<li data-contact-row='), 2);
  assert.ok(html.includes('<li data-contact-row="a"') && html.includes('<li data-contact-row="b"'));
  assert.match(plain(html), /Candidat a Poste de a/);
  assert.ok(html.includes('data-avatar="cand-a"'));
  // Listes sémantiques.
  assert.ok(html.includes('<ul class="divide-y divide-border">'));
});

test('5F2C-C13 Prêts : ouvert jusqu\'à 5 candidats, replié au-delà ; À compléter et Exclus restent ouverts', () => {
  const five = renderGroups(classify(Array.from({ length: 5 }, (_, i) => candidate(`r${i}`))));
  assert.match(sectionOf(five, 'ready'), /aria-expanded="true"/);
  assert.equal(count(five, '<li data-contact-row='), 5);

  const six = renderGroups(classify(Array.from({ length: 6 }, (_, i) => candidate(`r${i}`))));
  const sixReady = sectionOf(six, 'ready');
  assert.match(sixReady, /aria-expanded="false"/);
  assert.match(plain(sixReady), /^Prêts \(6\)/, 'l\'effectif reste écrit');
  assert.equal(count(six, '<li data-contact-row='), 0, 'les lignes ne sont pas rendues');
  assert.ok(!sixReady.includes('aria-controls='), 'rien à contrôler tant que la section est repliée');

  const mixed = renderGroups(classify(
    [...Array.from({ length: 7 }, (_, i) => candidate(`r${i}`)), candidate('x', { hasLinkedIn: false }), candidate('y')],
    { blocking: new Map([['y', 'in_sequence']]) },
  ));
  assert.match(sectionOf(mixed, 'ready'), /aria-expanded="false"/);
  assert.match(sectionOf(mixed, 'incomplete'), /aria-expanded="true"/);
  assert.match(sectionOf(mixed, 'excluded'), /aria-expanded="true"/);
  assert.equal(count(mixed, '<li data-contact-row='), 2);
});

test('5F2C-C14 le contenu d\'une section est borné en hauteur', () => {
  const html = renderGroups(classify(
    [candidate('a'), candidate('b', { hasLinkedIn: false }), candidate('c')],
    { blocking: new Map([['c', 'in_sequence']]) },
  ));
  for (const key of ['ready', 'incomplete', 'excluded']) {
    assert.ok(sectionOf(html, key).includes('max-h-64 overflow-y-auto'), `${key} : hauteur bornée`);
  }
});

test('5F2C-C15 À compléter : « Ouvrir la fiche » par ligne sans profil, une phrase unique pour les messages de l\'IA', () => {
  const noLinkedIn = renderGroups(classify([candidate('a', { hasLinkedIn: false }), candidate('b', { hasLinkedIn: false }), candidate('c')]));
  const section = sectionOf(noLinkedIn, 'incomplete');
  assert.equal(count(section, '>Ouvrir la fiche</button>'), 2);
  assert.ok(section.includes('aria-label="Ouvrir la fiche de Candidat a"'));
  assert.ok(section.includes('aria-label="Ouvrir la fiche de Candidat b"'));
  assert.match(plain(section), /Sans profil LinkedIn/);

  const ai = renderGroups(classify([candidate('a'), candidate('b'), candidate('c')], {}, { aiReview: true }));
  const aiSection = sectionOf(ai, 'incomplete');
  assert.match(plain(aiSection), /^À compléter \(3\)/);
  assert.equal(count(plain(aiSection), "Cette séquence contient des messages rédigés par l'IA Konekt pour chaque candidat. Relisez-les avant l'inscription."), 1);
  assert.ok(!aiSection.includes('Ouvrir la fiche'), 'pas de bouton par ligne pour les messages de l\'IA');
  assert.ok(!ai.includes('data-contact-group="ready"'));

  // Sans message de l'IA, la phrase n'apparaît pas.
  assert.ok(!plain(noLinkedIn).includes('rédigés par l\'IA Konekt'));
});

test('5F2C-C16 Exclus : un sous-titre par raison avec son effectif, la dérogation de la raison, jamais pour les autres', () => {
  const groups = classify(
    [candidate('a'), candidate('b'), candidate('c'), candidate('d'), candidate('e'), candidate('f'), candidate('g')],
    {
      blocking: new Map([['a', 'in_sequence'], ['b', 'in_sequence'], ['c', 'passed']]),
      erased: new Set(['d']),
      recent: new Map([['e', 'Déjà contacté par Marie le 03/10/2026'], ['f', 'Déjà contacté par Paul le 28/09/2026']]),
      incompatible: new Map([['g', 'too_far']]),
    },
  );
  const html = renderGroups(groups);
  const excluded = sectionOf(html, 'excluded');
  const blocks = [...excluded.matchAll(/data-contact-reason="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(blocks, ['in_sequence', 'passed_sequence', 'erased', 'recent_contact', 'too_far']);
  const text = plain(excluded);
  assert.match(text, /^Exclus \(7\)/);
  assert.ok(text.includes('Déjà dans cette séquence (2)'));
  assert.ok(text.includes('Déjà passé par cette séquence (terminée, réponse ou arrêt) (1)'));
  assert.ok(text.includes("A demandé l'effacement de ses données (1)"));
  assert.ok(text.includes('Déjà contactés depuis moins de 90 jours (2)'));
  assert.ok(text.includes("Hors de votre réseau LinkedIn, seul un InMail peut l'atteindre (1)"));
  // Un contact récent garde son libellé exact sur la ligne ; une raison commune n'est pas répétée.
  assert.ok(text.includes('Déjà contacté par Marie le 03/10/2026'));
  assert.ok(text.includes('Déjà contacté par Paul le 28/09/2026'));
  assert.equal(count(text, 'Déjà dans cette séquence'), 1);
  // Dérogations : contact récent et hors réseau seulement.
  assert.equal(count(excluded, '>Inscrire quand même</button>'), 1);
  assert.equal(count(excluded, '>Inclure quand même</button>'), 1);
  const blockOf = (reason) => {
    const start = excluded.indexOf(`data-contact-reason="${reason}"`);
    const next = excluded.indexOf('data-contact-reason=', start + 1);
    return excluded.slice(start, next < 0 ? undefined : next);
  };
  for (const reason of ['in_sequence', 'passed_sequence', 'erased']) {
    assert.ok(!/quand même/.test(blockOf(reason)), `${reason} : aucune dérogation`);
  }
  assert.ok(blockOf('recent_contact').includes('>Inscrire quand même</button>'));
  assert.ok(blockOf('too_far').includes('>Inclure quand même</button>'));
  assert.ok(blockOf('recent_contact').includes('aria-label="Inscrire quand même : Déjà contactés depuis moins de 90 jours"'));
});

test('5F2C-C17 contact récent sans droit de dérogation : une phrase, pas de bouton', () => {
  const entries = [candidate('a'), candidate('b')];
  const eligibilityExtra = { recent: new Map([['a', 'Déjà contacté par Marie le 03/10/2026']]), incompatible: new Map([['b', 'connection_only_already_connected']]) };
  const member = renderGroups(classify(entries, eligibilityExtra, { canOverrideRecent: false }), { canOverrideRecent: false });
  const memberText = plain(sectionOf(member, 'excluded'));
  assert.equal(count(memberText, 'Seuls les propriétaires et administrateurs peuvent les inscrire quand même.'), 1);
  assert.ok(!member.includes('>Inscrire quand même</button>'));
  assert.ok(member.includes('>Inclure quand même</button>'), 'l\'incompatibilité garde sa dérogation');

  const admin = renderGroups(classify(entries, eligibilityExtra, { canOverrideRecent: true }));
  assert.ok(!plain(admin).includes('Seuls les propriétaires'));
  assert.ok(admin.includes('>Inscrire quand même</button>'));
});

test('5F2C-C18 catégorie dérogée : ses candidats passent dans Prêts, « Annuler la dérogation » les ramène', () => {
  const entries = [candidate('a'), candidate('b'), candidate('c')];
  const eligibilityExtra = {
    recent: new Map([['a', 'Déjà contacté par Marie le 03/10/2026']]),
    incompatible: new Map([['b', 'too_far'], ['c', 'connection_only_already_connected']]),
  };

  // Aucune dérogation : tout est exclu, aucun lien d'annulation.
  const none = renderGroups(classify(entries, eligibilityExtra));
  assert.ok(!none.includes('data-contact-group="ready"'));
  assert.ok(!none.includes('Annuler la dérogation'));

  // Contact récent dérogé : Candidat a est prêt, « Inscrit quand même », la raison reste lisible.
  const recent = renderGroups(
    classify(entries, eligibilityExtra, { overrides: new Set(['recent_contact']) }),
    { overrides: new Set(['recent_contact']) },
  );
  const ready = sectionOf(recent, 'ready');
  assert.ok(ready.includes('<li data-contact-row="a"'));
  assert.match(plain(ready), /Candidat a Poste de a Inscrit quand même · Déjà contacté par Marie le 03\/10\/2026/);
  assert.equal(count(ready, 'Annuler la dérogation'), 2, 'libellé visible et nom accessible');
  assert.ok(ready.includes('aria-label="Annuler la dérogation : contacts de moins de 90 jours"'));
  assert.ok(!sectionOf(recent, 'excluded').includes('data-contact-reason="recent_contact"'), 'plus dans Exclus');
  assert.ok(sectionOf(recent, 'excluded').includes('data-contact-reason="too_far"'));

  // Incompatibles dérogés : « Inclus quand même ».
  const incompatible = renderGroups(
    classify(entries, eligibilityExtra, { overrides: new Set(['incompatible']) }),
    { overrides: new Set(['incompatible']) },
  );
  const incompatibleReady = sectionOf(incompatible, 'ready');
  assert.equal(count(incompatibleReady, 'Inclus quand même'), 2);
  assert.ok(!incompatibleReady.includes('Inscrit quand même'));
  assert.ok(incompatibleReady.includes('aria-label="Annuler la dérogation : candidats incompatibles avec la séquence"'));

  // Les deux : un lien par catégorie, et plus de section Exclus.
  const both = renderGroups(
    classify(entries, eligibilityExtra, { overrides: new Set(['recent_contact', 'incompatible']) }),
    { overrides: new Set(['recent_contact', 'incompatible']) },
  );
  assert.equal(count(sectionOf(both, 'ready'), 'aria-label="Annuler la dérogation'), 2);
  assert.ok(!both.includes('data-contact-group="excluded"'));
});

test('5F2C-C19 le lien d\'annulation reste visible quand Prêts est replié, et suit les candidats quand Prêts est vide', () => {
  const many = Array.from({ length: 6 }, (_, i) => candidate(`r${i}`));
  const recentOne = candidate('z');
  const html = renderGroups(
    classify([...many, recentOne], { recent: new Map([['z', 'Déjà contacté par Marie le 03/10/2026']]) }, { overrides: new Set(['recent_contact']) }),
    { overrides: new Set(['recent_contact']) },
  );
  const ready = sectionOf(html, 'ready');
  assert.match(ready, /aria-expanded="false"/);
  assert.ok(ready.includes('aria-label="Annuler la dérogation : contacts de moins de 90 jours"'));

  // Séquence à messages rédigés par l'IA : le dérogé est à compléter, le lien l'y suit.
  const ai = renderGroups(
    classify([recentOne], { recent: new Map([['z', 'Déjà contacté par Marie le 03/10/2026']]) }, { aiReview: true, overrides: new Set(['recent_contact']) }),
    { overrides: new Set(['recent_contact']) },
  );
  assert.ok(!ai.includes('data-contact-group="ready"'));
  assert.ok(sectionOf(ai, 'incomplete').includes('aria-label="Annuler la dérogation : contacts de moins de 90 jours"'));
  assert.equal(count(ai, 'Annuler la dérogation :'), 1);

  // Une dérogation choisie qui ne concerne personne n'affiche aucun lien.
  const idle = renderGroups(classify([candidate('a')], {}, { overrides: new Set(['recent_contact']) }), { overrides: new Set(['recent_contact']) });
  assert.ok(!idle.includes('Annuler la dérogation'));
});

test('5F2C-C20 informations sur les candidats prêts : un paragraphe par phrase, sous la section Prêts', () => {
  const groups = classify(
    [candidate('a'), candidate('b'), candidate('c')],
    { warnings: new Map([['a', 'connection_already_connected'], ['b', 'connection_already_connected'], ['c', 'inmail_wasted']]) },
  );
  assert.equal(groups.notes.length, 2);
  const html = renderGroups(groups);
  const ready = sectionOf(html, 'ready');
  for (const note of groups.notes) {
    assert.equal(count(plain(ready), note), 1, `phrase « ${note} »`);
  }
  const noteTags = [...ready.matchAll(/<p class="text-xs text-muted-foreground">([^<]*)<\/p>/g)].map((m) => decode(m[1]));
  assert.deepEqual(noteTags, groups.notes);
});

test('5F2C-C21 le tutoiement et les tirets n\'apparaissent dans aucun texte rendu', () => {
  const html = renderGroups(classify(
    [candidate('a'), candidate('b', { hasLinkedIn: false }), candidate('c'), candidate('d'), candidate('e')],
    {
      blocking: new Map([['c', 'in_sequence']]),
      recent: new Map([['d', 'Déjà contacté par Marie le 03/10/2026']]),
      incompatible: new Map([['e', 'too_far']]),
    },
  ));
  const text = plain(html);
  assert.ok(!text.includes(EM_DASH));
  assert.ok(!/\b(tu|ton|ta|tes)\b/i.test(text));
});

// --------------------------------------------------------------- SequencePicker

const sequence = (id, extra = {}) => ({
  id,
  name: `Séquence ${id}`,
  is_active: true,
  project_id: MISSION,
  created_at: '2026-10-01T10:00:00Z',
  stepCount: 3,
  multi_sender_enabled: false,
  sender_accounts: null,
  ...extra,
});
const renderPicker = (props, k = kit) =>
  k.renderToStaticMarkup(k.createElement(k.MemoryRouter, null, k.createElement(k.SequencePicker, {
    menu: { mission: [], others: [], pick: null },
    selectedId: null,
    status: 'ready',
    onRetry() {},
    onSelect() {},
    missionId: MISSION,
    ...props,
  })));
const withReadiness = (readiness, fn) => {
  globalThis.__readiness = readiness;
  try {
    return fn();
  } finally {
    delete globalThis.__readiness;
  }
};
const DOOR = `href="/sequences/nouvelle?mission=${MISSION}&amp;depart=ia" target="_blank" rel="noreferrer"`;

test('5F2C-C22 chargement : squelette occupé ; échec : phrase et « Réessayer »', () => {
  const loading = renderPicker({ status: 'loading' });
  assert.ok(loading.includes('aria-busy="true"'));
  assert.ok(!loading.includes('<button'), 'rien à cliquer pendant la lecture');

  const failed = renderPicker({ status: 'error' });
  assert.ok(failed.includes('role="alert"'));
  assert.match(plain(failed), /Les séquences n'ont pas pu être chargées\./);
  assert.ok(failed.includes('>Réessayer</button>'));
});

test('5F2C-C23 sans séquence utilisable : le bloc remplace le menu, la porte s\'ouvre dans un nouvel onglet', () => {
  const html = renderPicker({ menu: kit.missionSequenceMenu([], MISSION) });
  assert.match(plain(html), /Cette mission n'a pas de séquence prête à l'emploi\./);
  assert.ok(html.includes(`<a ${DOOR}`), `porte vers la rédaction par l'IA : ${html}`);
  assert.match(plain(html), /Rédiger une séquence pour cette mission/);
  assert.match(plain(html), /S'ouvre dans un nouvel onglet\. Au retour, la liste se met à jour\./);
  assert.ok(!html.includes('data-menu'), 'pas de menu sans séquence');
  assert.ok(!html.includes('Décrire le poste'));

  // Séquences inactives ou vides : même bloc.
  const unusable = renderPicker({ menu: kit.missionSequenceMenu([sequence('a', { is_active: false }), sequence('b', { stepCount: 0 })], MISSION) });
  assert.match(plain(unusable), /Cette mission n'a pas de séquence prête à l'emploi\./);
});

test('5F2C-C24 poste non décrit : porte désactivée, « Décrire le poste » dans le même onglet', () => {
  const html = withReadiness(
    { loading: false, described: false, cadrageHref: '/missions/m-1/cadrage?section=poste' },
    () => renderPicker({ menu: kit.missionSequenceMenu([], MISSION) }),
  );
  assert.ok(!html.includes('target="_blank"'), 'aucune porte vers la rédaction');
  assert.match(html, /<button[^>]*disabled=""[^>]*>[\s\S]*Rédiger une séquence pour cette mission/);
  assert.ok(html.includes('<a class="inline-flex'), 'lien « Décrire le poste »');
  assert.ok(html.includes('href="/missions/m-1/cadrage?section=poste"'));
  assert.ok(!html.includes('/missions/m-1/cadrage?section=poste" target'), 'même onglet');
  assert.match(plain(html), /Décrivez d’abord le poste dans le Cadrage pour que l’IA puisse rédiger\. Décrire le poste/);

  // Lecture en cours : porte attendue, rien d'écrit sur le poste.
  const loading = withReadiness(
    { loading: true, described: false, cadrageHref: '/missions/m-1/cadrage?section=poste' },
    () => renderPicker({ menu: kit.missionSequenceMenu([], MISSION) }),
  );
  assert.ok(!loading.includes('Décrire le poste'));
  assert.ok(!loading.includes('target="_blank"'));
  assert.match(loading, /disabled=""/);
});

test('5F2C-C25 le déclencheur porte le nom de la séquence choisie, sinon « Choisir une séquence »', () => {
  const list = [sequence('s1', { name: 'Approche ingénieurs', created_at: '2026-10-02T10:00:00Z' }), sequence('s2', { name: 'Relance', created_at: '2026-10-01T10:00:00Z' })];
  const menu = kit.missionSequenceMenu(list, MISSION);
  const picked = renderPicker({ menu, selectedId: menu.pick.id });
  const trigger = picked.match(/<button[^>]*aria-labelledby="([^"]+) ([^"]+)"[^>]*>/);
  assert.ok(trigger, 'déclencheur nommé par le libellé et la valeur');
  assert.ok(picked.includes(`id="${trigger[1]}"`) && picked.includes(`id="${trigger[2]}"`), 'les deux identifiants existent');
  assert.match(plain(picked), /^Séquence Approche ingénieurs/);

  const none = renderPicker({ menu, selectedId: null });
  assert.match(plain(none), /^Séquence Choisir une séquence/);
  const stale = renderPicker({ menu, selectedId: 'absente' });
  assert.match(plain(stale), /^Séquence Choisir une séquence/);
});

test('5F2C-C26 menu : séquences de la mission puis autres séquences, étapes, choix marqué, porte en dernier', () => {
  const list = [
    sequence('m1', { name: 'Mission récente', created_at: '2026-10-03T10:00:00Z', stepCount: 4 }),
    sequence('m2', { name: 'Mission ancienne', created_at: '2026-09-01T10:00:00Z', stepCount: 1 }),
    sequence('o1', { name: 'Partagée', project_id: null, stepCount: 2, created_at: '2026-09-20T10:00:00Z' }),
    sequence('x1', { name: 'Autre mission', project_id: '5b1c2d3e-0000-4000-8000-000000000002', stepCount: 3, created_at: '2026-09-10T10:00:00Z' }),
    sequence('off', { name: 'Éteinte', is_active: false }),
    sequence('empty', { name: 'Vide', stepCount: 0 }),
  ];
  const menu = kit.missionSequenceMenu(list, MISSION);
  const html = renderPicker({ menu, selectedId: 'm2' });
  const text = plain(html);
  // Le déclencheur répète le nom du choix : on lit le menu à partir de son premier titre.
  const menuText = text.slice(text.indexOf('Séquences de la mission'));
  const at = (needle) => menuText.indexOf(needle);
  const order = ['Séquences de la mission', 'Mission récente', 'Mission ancienne', "Autres séquences de l'organisation", 'Partagée', 'Autre mission', 'Rédiger une séquence pour cette mission'].map(at);
  assert.ok(order.every((i) => i >= 0), `tous présents : ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, `ordre du menu : ${order}`);
  assert.ok(!text.includes('Éteinte') && !text.includes('Vide'), 'inactives et vides absentes');
  assert.ok(text.includes('4 étapes') && text.includes('1 étape') && text.includes('2 étapes'));
  assert.ok(!text.includes('1 étapes'));
  // Seule la séquence choisie est marquée.
  assert.equal(count(html, 'aria-current="true"'), 1);
  assert.match(html, /<div[^>]*aria-current="true"[^>]*data-sequence-id="m2"|<div[^>]*data-sequence-id="m2"[^>]*aria-current="true"/);
  assert.equal(count(html, ', séquence choisie'), 1);
  // Porte : un lien, nouvel onglet, précisé sous l'entrée.
  assert.ok(html.includes(`<a ${DOOR}`));
  assert.match(text, /S'ouvre dans un nouvel onglet\. Au retour, la liste se met à jour\./);
  assert.equal(count(html, 'target="_blank"'), 1);
});

test('5F2C-C27 menu sans séquence de la mission : seules les autres séquences, sans séparation orpheline', () => {
  const menu = kit.missionSequenceMenu([sequence('o1', { name: 'Partagée', project_id: null })], MISSION);
  const html = renderPicker({ menu, selectedId: null });
  const text = plain(html);
  assert.ok(!text.includes('Séquences de la mission'));
  assert.ok(text.includes("Autres séquences de l'organisation"));
  // Une seule séparation : avant la porte.
  assert.equal(count(html, '<hr'), 1);
});

test('5F2C-C28 menu, poste non décrit : porte désactivée, explication et lien vers le Cadrage', () => {
  const menu = kit.missionSequenceMenu([sequence('m1')], MISSION);
  const html = withReadiness(
    { loading: false, described: false, cadrageHref: '/missions/m-1/cadrage?section=poste' },
    () => renderPicker({ menu, selectedId: 'm1' }),
  );
  assert.match(html, /aria-disabled="true"[^>]*>[\s\S]*?Rédiger une séquence pour cette mission/);
  assert.ok(!html.includes('target="_blank"'));
  assert.match(plain(html), /Décrivez d’abord le poste dans le Cadrage pour que l’IA puisse rédiger\./);
  assert.ok(html.includes('href="/missions/m-1/cadrage?section=poste"'));
  assert.ok(html.includes('role="menuitem"'));
});

test('5F2C-C31 déclencheur du kit réel : menu annoncé, fermé, nommé par le libellé et la valeur', async () => {
  // Sans doublure du menu : le déclencheur Radix rend ses attributs, le contenu reste fermé.
  const real = await buildKit(false);
  const menu = real.missionSequenceMenu([sequence('m1', { name: 'Approche ingénieurs' })], MISSION);
  const html = renderPicker({ menu, selectedId: 'm1' }, real);
  const trigger = html.match(/<button[^>]*>/)[0];
  assert.match(trigger, /aria-haspopup="menu"/);
  assert.match(trigger, /aria-expanded="false"/);
  assert.match(trigger, /aria-labelledby="[^"]+ [^"]+"/);
  assert.match(plain(html), /^Séquence Approche ingénieurs$/);
  assert.ok(!html.includes('role="menuitem"'), 'le contenu ne se rend qu\'à l\'ouverture');
});

// ------------------------------------------------------------------ QuotaGauge

const FIGURES = { usedToday: 10, capToday: 40, usedWeekInvitations: 30, capWeekInvitations: 100 };
const renderGauge = (model) => kit.renderToStaticMarkup(kit.createElement(kit.QuotaGauge, { model }));

test('5F2C-C29 jauge calme : phrase à l\'encre, barre neutre, nom accessible en pourcentage', () => {
  const model = kit.quotaGauge('connection_request', FIGURES, 5);
  assert.equal(model.level, 'ok');
  const html = renderGauge(model);
  assert.ok(html.includes('role="progressbar"'));
  assert.ok(html.includes(`aria-label="Plafond LinkedIn utilisé après cette inscription : ${model.percent} %"`));
  assert.ok(html.includes(`aria-valuenow="${model.percent}"`));
  assert.ok(html.includes('data-quota-gauge="invitations"'));
  assert.match(html, /<p class="text-xs text-foreground">/);
  assert.ok(html.includes('[&amp;&gt;div]:bg-muted-foreground') || html.includes('[&>div]:bg-muted-foreground'));
  assert.ok(html.includes('h-1.5'));
  assert.ok(!html.includes('role="status"'), 'pas d\'avertissement');
  assert.ok(plain(html).includes(model.text));
  // Jamais « N / M », jamais « 0 / N ».
  assert.ok(!/\d+\s*\/\s*\d+/.test(plain(html)), plain(html));
});

test('5F2C-C30 approche du plafond : orange à 80 %, rouge à 95 %, avertissement en zone de statut', () => {
  const warning = kit.quotaGauge('message', { ...FIGURES, usedToday: 30 }, 4);
  assert.equal(warning.level, 'warning');
  const warningHtml = renderGauge(warning);
  assert.ok(warningHtml.includes('data-quota-gauge="actions"'));
  assert.match(warningHtml, /<p class="text-xs text-warning">/);
  assert.ok(/\[&(?:amp;)?(?:>|&gt;)div\]:bg-warning/.test(warningHtml));
  assert.ok(!warningHtml.includes('role="status"'), 'tant que tous passent, rien à dire de plus');

  const critical = kit.quotaGauge('connection_request', { ...FIGURES, usedWeekInvitations: 90 }, 20);
  assert.equal(critical.level, 'critical');
  assert.ok(critical.warning);
  const criticalHtml = renderGauge(critical);
  assert.match(criticalHtml, /<p class="text-xs text-danger">/);
  assert.ok(/\[&(?:amp;)?(?:>|&gt;)div\]:bg-danger/.test(criticalHtml));
  assert.match(criticalHtml, /<p role="status" class="text-xs text-danger">/);
  assert.ok(plain(criticalHtml).includes(critical.warning));
  assert.ok(criticalHtml.includes(`aria-label="Plafond LinkedIn utilisé après cette inscription : ${critical.percent} %"`));
  // Plafond atteint : la phrase d'état le dit, sans chiffre brut.
  const full = kit.quotaGauge('connection_request', { ...FIGURES, usedWeekInvitations: 100 }, 3);
  const fullText = plain(renderGauge(full));
  assert.ok(fullText.includes("Plafond d'invitations atteint pour cette semaine"));
  assert.ok(!/\d+\s*\/\s*\d+/.test(fullText));
});
