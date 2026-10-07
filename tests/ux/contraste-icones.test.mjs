/**
 * Contraste façon Qonto, partie 3 : icônes et boutons discrets à l'encre (docs/design/01-direction.md,
 * § 6 et § 10 ; 06-simplicite.md, « Contraste » ; décision 1 du propriétaire du 06/10/2026).
 *
 * Règle : une icône lucide prend la couleur de son contrôle ou de sa ligne, à l'encre. Sa classe ne porte
 * jamais de gris (text-muted-foreground, text-foreground-secondary, text-[var(--k-text-muted)]), d'opacité
 * de jeton (text-foreground/60, text-muted-foreground/40) ni d'opacity-30 à opacity-70 hors transition de
 * survol. Aucun parent ne grise ses svg ([&_svg]:text-muted-foreground…). Un bouton discret gris (Button
 * ghost ou link, <button> ou lien à classe fixe) est un geste de retrait : Supprimer, Retirer, Dissocier,
 * Écarter, Mettre en pause, Arrêter… (gris secondaire, rouge au survol s'il détruit).
 *
 * Reconnues sans liste : l'icône posée dans un champ (absolute, exception a) et la roue de chargement
 * (animate-spin, exception f). Les autres exceptions sont écrites plus bas, par fichier, élément et nombre,
 * avec leur raison (lettres de la spécification v2, § 5.2) : la liste ne fait que décroître. Une entrée qui
 * ne sert plus, ou plus autant, fait échouer le test : il faut la retirer ou baisser son nombre.
 *
 * Périmètre : src/components et src/pages, hors primitives (ui, gardées par contraste-primitives), pages
 * publiques et portails (landing, public, portal, Pricing…), et ancienne page mission (missions/v2 et les
 * fichiers qu'elle seule rend, exception h). Classes ternaires des <button> faits main non lues (état choisi
 * ou non) ; constantes de classes lues par leur nom (…ICON…, …ACTION…, …BUTTON…, …BTN…).
 *
 * Lancer : node --test tests/ux/contraste-icones.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Hors périmètre : primitives, pages publiques et portails. */
const OUT_OF_SCOPE = [
  /^src\/components\/(ui|landing|public|portal)\//,
  /^src\/pages\/(Auth|Pricing|SkalrLanding|CandidatePortal|ClientPortalV2|RecruiterPublicProfile|Privacy|PrivacyExtension|Unsubscribe)\.tsx$/,
];
/**
 * Exception h : l'ancienne page mission, inchangée (dossier missions/v2 et fichiers qu'elle seule rend). La fenêtre
 * « Nouvelle mission » (CreateMissionV2, et JobOffersPicker et BriefAnalysisPanel qu'elle seule rend) suit la règle.
 */
const OLD_MISSION_PAGE = [
  /^src\/components\/missions\/v2\/(?!(CreateMissionV2|JobOffersPicker|BriefAnalysisPanel)\.tsx$)/,
  /^src\/components\/missions\/(MissionPipeline|MissionOutreach|MissionInsights|FilterReviewModal)\.tsx$/,
  /^src\/components\/outreach\/projects\/(ProjectCandidatesTableEnhanced|ProjectFunnel)\.tsx$/,
  /^src\/pages\/MissionWorkspace\.tsx$/,
];

/**
 * Icônes grises gardées : [fichier, icône, nombre, raison]. Décroissante.
 */
const ICON_EXCEPTIONS = [
  // a. icône posée dans un faux champ (bouton au texte indicatif gris), révélée au survol.
  ['src/components/outreach/filters/PositionFiltersSection.tsx', 'Pencil', 1, 'a : crayon du champ « Cliquez pour ajouter un rôle… »'],
  ['src/components/outreach/search/SearchFiltersPanel.tsx', 'Pencil', 1, 'a : crayon du champ des mots-clés'],
  // b. geste de retrait.
  ['src/components/outreach/search/SearchFiltersPanel.tsx', 'X', 1, 'b : écarter une suggestion de filtre'],
  ['src/components/missions/FilterWizard.tsx', 'X', 1, 'b : retirer une puce (fichier importé nulle part)'],
  // c. interrupteur éteint.
  ['src/components/outreach/LinkedInAccountManager.tsx', 'ToggleLeft', 1, 'c : « Forcer Recruiter » éteint'],
  // d. statut neutre, à côté de sa variante colorée.
  ['src/components/outreach/JobScoreDisplay.tsx', 'Icon', 1, 'd : dimension non validée (la validée est verte)'],
  ['src/components/outreach/SequenceDiagnostic.tsx', 'XCircle', 1, 'd : planificateur dans un état inconnu (rouge quand la panne est connue)'],
  // e. désactivé ou verrouillé.
  ['src/components/outreach/LinkedInResultCard.tsx', 'X', 2, 'e : case de sélection désactivée (profil peu adapté)'],
  ['src/components/outreach/SequencesList.tsx', 'Lock', 2, 'e : activation verrouillée (lecture seule)'],
  ['src/components/sequences/SequenceRow.tsx', 'Lock', 1, 'e : interrupteur verrouillé (lecture seule)'],
  // g. barre latérale : seules la rangée basse et les têtes de ligne changent (décision 4).
  ['src/components/sidebar/SidebarUserMenu.tsx', 'ChevronsUpDown', 1, 'g : menu de l\'avatar, inchangé'],
  // h. composants partagés : le rendu hors `embedded` est celui de l'ancienne page.
  ['src/components/missions/MissionClientPortal.tsx', 'Lock', 1, 'h : hors embedded (embedded rend null)'],
  ['src/components/missions/MissionHuntMode.tsx', 'Lock', 1, 'h : hors embedded (embedded rend null)'],
  ['src/components/missions/MissionHuntMode.tsx', 'User', 2, 'h : !embedded && \'text-muted-foreground\''],
  ['src/components/missions/process/shared.tsx', 'Users', 1, 'h : en-tête de l\'équipe, hors embedded'],
  ['src/components/missions/process/shared.tsx', 'User', 1, 'h : pastille d\'un membre, hors embedded'],
  ['src/components/missions/process/shared.tsx', 'Mail', 1, 'h : !embedded && \'text-muted-foreground\''],
];

/** Boutons discrets gris qui ne sont pas des retraits : [fichier, élément, nombre, raison]. Décroissante. */
const BUTTON_EXCEPTIONS = [
  // h. SearchResultsPanel : tout ce qui suit le rendu mission-v3 (« ) : (<> ») n'est rendu que par
  // l'ancienne page (MissionWorkspaceV2) ; la nouvelle page et /sourcing/:id passent layout="mission-v3".
  ['src/components/outreach/search/SearchResultsPanel.tsx', 'button', 1, 'h : « Séquence » désactivé, branche non v3'],
  ['src/components/outreach/search/SearchResultsPanel.tsx', 'Button', 2, 'h : « Élargir » et « Affiner », branche non v3'],
  // h. StepCard de process/shared n'est rendue que par l'ancienne page (MissionProcessV2).
  ['src/components/missions/process/shared.tsx', 'button', 2, 'h : « Développer » et « + » d\'un objectif, StepCard'],
  ['src/components/missions/MissionClientPortal.tsx', 'button', 1, 'h : « Annuler » du formulaire, hors embedded'],
];

/** Constantes de classes grises : [fichier, constante, raison]. Décroissante. */
const CONSTANT_EXCEPTIONS = [
  ['src/components/sidebar/missions/MissionNavRow.tsx', 'ICON_BUTTON_CLASS', 'g : actions d\'une ligne de mission de la barre'],
  ['src/components/sidebar/todo/ApprovalsSection.tsx', 'ACTION_BUTTON_CLASS', 'g : « Ignorer » d\'une validation de la barre'],
  ['src/components/sidebar/todo/FirstStepsSection.tsx', 'HIDE_BUTTON_CLASS', 'g : « Masquer » des premiers pas'],
  ['src/components/sidebar/todo/ForYouSection.tsx', 'HEADER_BUTTON_CLASS', 'g : action d\'en-tête de section de la barre'],
];

// ── Lecture du source ──────────────────────────────────────────────────────────────────────────

/** Gris secondaire ou opacité de jeton, sans préfixe d'état (hover:, disabled:, aria-…:) devant. */
const GREY = /(?<![\w:/-])(?:text-muted-foreground(?:\/\d+)?|text-foreground-secondary|text-foreground\/\d+|text-\[var\(--k-text-muted\)\])(?![\w-])/;
const GREY_TEXT = /(?<![\w:/-])(?:text-muted-foreground|text-foreground-secondary|text-\[var\(--k-text-muted\)\])(?![\w/-])/;
const OPACITY = /(?<![\w:/-])opacity-(?:30|40|50|60|70)(?![\w-])/;
const OPACITY_TRANSITION = /(?:[\w-]*hover|focus[\w-]*|group-[\w/-]+|data-\[[^\]]*\]):opacity-|transition-opacity/;
const PARENT_SVG = /\[&(?:_|>)svg\]:(?:text-muted-foreground|text-foreground-secondary|text-\[var\(--k-text-muted\)\]|opacity-\d+)/g;
const RETRAIT_WORDS = /(?:^|[^\p{L}])(?:supprimer|retirer|dissocier|effacer|d[ée]sinscrire|r[ée]voquer|d[ée]connecter|d[ée]lier|rejeter|refuser|[ée]carter|exclure|enlever|vider|ignorer|suspendre|d[ée]sactiver|annuler (?:les?|la|l['’]|cette|ce)|mettre en pause|arr[êe]ter|sauter|ne pas envoyer)(?![\p{L}])/iu;
const RETRAIT_ICON = /<(?:Trash2?|Unlink2?|Unplug|UserMinus|UserX|Ban|StopCircle|XCircle|Pause)\b/;

/** Retire les commentaires en gardant les fins de ligne (les numéros de ligne restent justes). */
function stripComments(src) {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, (m, p) => p + ' '.repeat(m.length - p.length));
}
/** Balise ouvrante complète à partir de `<` (accolades et chaînes comprises). */
function openingTag(code, i) {
  let depth = 0;
  let quote = null;
  for (let j = i + 1; j < code.length; j++) {
    const c = code[j];
    if (quote) {
      if (c === quote && code[j - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return code.slice(i, j + 1);
  }
  return code.slice(i, i + 400);
}
const lineOf = (code, i) => code.slice(0, i).split('\n').length;
const classExpr = (tag) => (tag.match(/className=(\{[\s\S]*?\}(?=\s+[\w-]+=|\s*\/?>)|"[^"]*"|'[^']*')/) || [])[1] ?? '';
const staticClass = (tag) => (tag.match(/className="([^"]*)"/) || [])[1] ?? null;

/** Analyse un fichier : icônes grises, parents qui grisent, boutons discrets gris, constantes grises. */
function analyse(src) {
  const code = stripComments(src);
  const lucide = new Set();
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]lucide-react['"]/g)) {
    for (const part of m[1].split(',')) {
      const p = part.trim().replace(/^type\s+/, '');
      if (p && !/^Lucide/.test(p)) lucide.add(p.includes(' as ') ? p.split(' as ')[1].trim() : p);
    }
  }
  const isIcon = (name) => lucide.has(name)
    || (/^(?:[A-Z]\w*)?Icon$|\.icon$/i.test(name) && !/^(?:ChannelIcon|IconTile)$/.test(name));

  const icons = [];
  const buttons = [];
  for (const m of code.matchAll(/<([A-Za-z][\w.]*)(?=[\s/>])/g)) {
    const prev = code[m.index - 1];
    if (prev && /[\w.)\]]/.test(prev)) continue; // génériques TypeScript : useState<Foo>
    const name = m[1];
    const tag = openingTag(code, m.index);
    if (isIcon(name)) {
      const cls = classExpr(tag);
      const grey = GREY.test(cls);
      const veiled = OPACITY.test(cls) && !OPACITY_TRANSITION.test(cls);
      if ((grey || veiled) && !/\babsolute\b/.test(cls) && !/\banimate-spin\b/.test(cls)) {
        icons.push({ name, line: lineOf(code, m.index), token: (cls.match(GREY) || cls.match(OPACITY))[0] });
      }
      continue;
    }
    const discreet = (name === 'Button' && /\bvariant=(?:"(?:ghost|link)"|\{'(?:ghost|link)'\})/.test(tag))
      || name === 'button' || name === 'a' || name === 'Link';
    if (!discreet) continue;
    const cls = staticClass(tag);
    if (cls === null || !GREY_TEXT.test(cls)) continue;
    const end = code.indexOf(`</${name}>`, m.index + tag.length);
    const inner = end > 0 && !/\/>$/.test(tag) ? code.slice(m.index + tag.length, end) : '';
    const label = `${tag.replace(/className="[^"]*"/, '')} ${inner.replace(/<[^>]*>/g, ' ')}`;
    const onlyCross = /^\s*(?:<(?:X|XIcon)\b[^>]*\/>|[✕×])\s*$/.test(inner) && !/fermer|close/i.test(label);
    const retrait = RETRAIT_WORDS.test(label) || /hover:text-(?:danger|destructive)\b/.test(cls) || RETRAIT_ICON.test(inner) || onlyCross;
    if (!retrait) buttons.push({ name, line: lineOf(code, m.index) });
  }
  const parents = [...code.matchAll(PARENT_SVG)].map((m) => ({ token: m[0], line: lineOf(code, m.index) }));
  const constants = [];
  for (const m of code.matchAll(/(?:^|\n)\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*(?:ICON|ACTION|BUTTON|BTN)[A-Z0-9_]*)\s*=([^;]*);/g)) {
    if (GREY.test(m[2])) constants.push(m[1]);
  }
  return { icons, buttons, parents, constants };
}

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const abs = join(dir, n);
      if (statSync(abs).isDirectory()) {
        if (n !== '__tests__') walk(abs);
      } else if (/\.tsx?$/.test(n) && !/\.(test|spec)\./.test(n)) {
        out.push(relative(ROOT, abs).split('\\').join('/'));
      }
    }
  };
  walk(join(ROOT, 'src/components'));
  walk(join(ROOT, 'src/pages'));
  return out.filter((f) => !OUT_OF_SCOPE.some((r) => r.test(f)) && !OLD_MISSION_PAGE.some((r) => r.test(f)));
}

let cache = null;
function scan() {
  if (cache) return cache;
  cache = sourceFiles().map((file) => ({ file, ...analyse(readFileSync(join(ROOT, file), 'utf8')) }));
  return cache;
}

/** Compare des occurrences (clé fichier|élément) à une liste blanche de nombres. */
function compare(found, exceptions, what) {
  const counts = new Map();
  const where = new Map();
  for (const f of found) {
    const key = `${f.file}|${f.name}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    where.set(key, [...(where.get(key) ?? []), `${f.file}:${f.line}${f.token ? ` ${f.token}` : ''}`]);
  }
  const allowed = new Map();
  for (const [file, name, n] of exceptions) allowed.set(`${file}|${name}`, (allowed.get(`${file}|${name}`) ?? 0) + n);
  const extra = [];
  for (const [key, n] of counts) if (n > (allowed.get(key) ?? 0)) extra.push(...where.get(key));
  const stale = [];
  for (const [key, n] of allowed) if ((counts.get(key) ?? 0) < n) stale.push(`${key.replace('|', ' : ')} (${counts.get(key) ?? 0} au lieu de ${n})`);
  assert.deepEqual(extra, [], `${what} : gris hors exceptions (passer à l'encre, ou justifier dans la liste) :\n${extra.join('\n')}`);
  assert.deepEqual(stale, [], `liste blanche à réduire (${what}) :\n${stale.join('\n')}`);
}

// ── Gardes ─────────────────────────────────────────────────────────────────────────────────────

test('l\'analyse voit ce qu\'elle doit voir (la garde n\'est pas vide)', () => {
  const sample = [
    "import { Pencil, Search, Loader2, Trash2, X, ChevronRight as Chevron } from 'lucide-react';",
    '<Pencil className="h-4 w-4 text-muted-foreground" />',
    '<Chevron className="h-4 w-4 opacity-50" />',
    '<Search className="absolute left-3 h-4 w-4 text-muted-foreground" />',
    '<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />',
    '<Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />',
    '<Pencil className="h-3 w-3 opacity-50 group-hover:opacity-100" />',
    '<Pencil className="h-3 w-3 hover:text-muted-foreground" />',
    '<item.icon className="h-4 w-4 text-foreground/60" />',
    '<Button variant="ghost" className="text-muted-foreground">Toutes les tâches</Button>',
    '<Button variant="ghost" className="text-muted-foreground" aria-label="Supprimer la note"><Trash2 /></Button>',
    '<Button variant="ghost" className="text-muted-foreground">Mettre en pause</Button>',
    '<button type="button" className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>',
    '<button type="button" className="text-muted-foreground">Voir la suite</button>',
    '<Button variant="ghost" className="text-foreground disabled:text-muted-foreground">Ajouter</Button>',
    '<div className="[&_svg]:text-muted-foreground" />',
    "const TOOL_ICON = 'h-7 w-7 text-muted-foreground';",
    "const NAV_BUTTON_CLASS = 'min-h-11 disabled:text-muted-foreground';",
  ].join('\n');
  const r = analyse(sample);
  assert.deepEqual(r.icons.map((x) => `${x.name} ${x.token}`), ['Pencil text-muted-foreground', 'Chevron opacity-50', 'item.icon text-foreground/60']);
  assert.deepEqual(r.buttons.map((x) => `${x.name}:${x.line}`), ['Button:10', 'button:14']);
  assert.deepEqual(r.parents.map((x) => x.token), ['[&_svg]:text-muted-foreground']);
  assert.deepEqual(r.constants, ['TOOL_ICON']);
});

test('icônes lucide : ni gris ni opacité, hors exceptions écrites', () => {
  const found = scan().flatMap(({ file, icons }) => icons.map((x) => ({ file, ...x })));
  compare(found, ICON_EXCEPTIONS, 'icônes');
});

test('aucun parent ne grise ses svg', () => {
  const found = scan().flatMap(({ file, parents }) => parents.map((x) => `${file}:${x.line} ${x.token}`));
  assert.deepEqual(found, []);
});

test('boutons discrets : un bouton gris est un geste de retrait, hors exceptions écrites', () => {
  const found = scan().flatMap(({ file, buttons }) => buttons.map((x) => ({ file, ...x })));
  compare(found, BUTTON_EXCEPTIONS, 'boutons discrets');
});

test('constantes de classes des icônes et des boutons : sans gris, hors exceptions écrites', () => {
  const found = scan().flatMap(({ file, constants }) => constants.map((name) => ({ file, name, line: 0 })));
  compare(found, CONSTANT_EXCEPTIONS.map(([file, name, why]) => [file, name, 1, why]), 'constantes');
});

test('chaque exception a sa raison, et son fichier est dans le périmètre', () => {
  const inScope = new Set(sourceFiles());
  for (const [file, name, n, why] of [...ICON_EXCEPTIONS, ...BUTTON_EXCEPTIONS]) {
    assert.ok(inScope.has(file), `${file} : hors périmètre, l'entrée est inutile`);
    assert.ok(Number.isInteger(n) && n > 0, `${file} ${name} : nombre`);
    assert.match(why, /^[a-h] : \S/, `${file} ${name} : raison (lettre de l'exception, puis le cas)`);
  }
  for (const [file, name, why] of CONSTANT_EXCEPTIONS) {
    assert.ok(inScope.has(file), `${file} : hors périmètre`);
    assert.match(why, /^[a-h] : \S/, `${file} ${name} : raison`);
  }
});

test('cohérence entre écrans : un même geste a la même couleur, un statut garde la sienne, un aplat garde un texte lisible', () => {
  const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  // « Rejeter » une action de l'assistant : retrait gris, dans la carte d'approbation comme dans le Journal.
  const card = read('src/components/agent/AgentToolApprovalCard.tsx');
  const reject = card.slice(card.lastIndexOf('<Button', card.indexOf('Rejeter\n')), card.indexOf('Rejeter\n'));
  assert.match(reject, /variant="ghost"[\s\S]*className="text-muted-foreground"/, 'carte d\'approbation');
  const journal = read('src/components/settings/AgentActionsSettings.tsx');
  const rejectJournal = journal.slice(journal.lastIndexOf('<Button', journal.indexOf('Rejeter\n')), journal.indexOf('Rejeter\n'));
  assert.match(rejectJournal, /className="text-muted-foreground/, 'Journal');
  // « Écarter » un candidat : gris au repos, rouge au survol, sur tous les écrans (01-direction, § 6).
  const ecarter = [
    ['src/components/missions/v3/pipeline/BulkActionBar.tsx', 'Écarter\n      </Button>'],
    ['src/components/missions/v3/panels/CandidatePanelHeader.tsx', 'Écarter\n              </Button>'],
    ['src/components/outreach/result-card/ProfileDetailSheet.tsx', 'Écarter\n                  </Button>'],
  ];
  for (const [rel, label] of ecarter) {
    const src = read(rel);
    const at = src.indexOf(label);
    assert.ok(at > 0, `${rel} : « Écarter » introuvable`);
    const tag = src.slice(src.lastIndexOf('<Button', at), at);
    assert.match(tag, /text-muted-foreground hover:bg-danger-muted hover:text-danger/, `${rel} : Écarter`);
    assert.doesNotMatch(tag, /(?<![:\w-])text-danger\b/, `${rel} : pas de rouge au repos`);
  }
  assert.match(read('src/components/missions/v3/sourcing/SourcingResultsV3.tsx'), /title="Écarter"\s+className=\{cn\(DECISION_BUTTON, 'text-muted-foreground hover:text-danger'\)\}/, 'lignes du Sourcing');
  // Un statut permanent porté par un bouton désactivé garde sa couleur (« Retenu ») : le gris du
  // désactivé de ghost (0,2,0) l'emporterait sur text-success (0,1,0).
  const project = read('src/components/outreach/projects/AddToProjectButton.tsx');
  assert.match(project, /isAdded \? 'text-success hover:text-success disabled:text-success'/, '« Retenu » (forme compacte)');
  assert.match(project, /isAdded \? 'text-success disabled:text-success'/, '« Shortlisté »');
  // Bouton à contour repeint d'un aplat de couleur : bord transparent et texte blanc, jamais l'encre sur le
  // bleu LinkedIn (3,25:1 en clair) ni le vert d'état en sombre (2,21:1) ; désactivé sur fond gris.
  for (const rel of ['src/components/outreach/LinkedInAccountManager.tsx', 'src/components/outreach/CompanyFilter.tsx', 'src/components/onboarding/scenes/SceneLinkedIn.tsx']) {
    for (const m of read(rel).matchAll(/className="([^"]*\bbg-linkedin\b[^"]*)"/g)) {
      if (!/<Button\b[^<]*$/.test(read(rel).slice(0, m.index))) continue;
      assert.match(m[1], /\bborder-transparent\b/, `${rel} : bord`);
      assert.match(m[1], /\btext-white\b/, `${rel} : texte`);
      // Désactivé : fond gris, jamais le libellé gris de la variante sur le bleu (1,20:1).
      assert.match(m[1], /\bdisabled:bg-muted\b/, `${rel} : désactivé`);
    }
  }
  assert.doesNotMatch(read('src/components/outreach/filter-wizard/WizardQuestionStep.tsx'), /bg-success hover:bg-success\/90 text-white/);
  assert.match(read('src/components/outreach/result-card/CardMessageThread.tsx'), /variant="primary"\s*className="h-auto min-h-\[60px\] w-12"/, 'envoi : icône lisible sur l\'aplat');
});
