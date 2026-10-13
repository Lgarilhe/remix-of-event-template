/**
 * Refonte mission, lot 5f-2d : bouton « Séquence » de la recherche, rappel de
 * fin d'inscription de la recherche et renommage de « Présélectionner sans
 * message » (interrupteur des séquences allumé).
 *
 * - SequenceEnrollButton : interrupteur éteint, le composant d'avant (menu puis
 *   fenêtre SequenceEnrollModal) ; allumé, même bouton qui ouvre la feuille du
 *   flux d'inscription avec des profils figés à l'ouverture. Le composant est
 *   empaqueté par esbuild avec des doublures de React (hooks, JSX en objets) et
 *   de ses dépendances, puis appelé comme une fonction : pas de DOM nécessaire.
 * - LinkedInSearch.handleSequenceEnrollSuccess : lu dans son source et exécuté
 *   avec des doublures (avec identifiants : retire ceux-là seulement ; sans
 *   argument : vide la sélection).
 * - Types des props des deux panneaux de résultats et appelants qui ignorent
 *   l'argument.
 * - EnrollmentPreviewModal : libellé en fonction de l'interrupteur, ancien
 *   littéral conservé.
 *
 * Lancer : node --test tests/ux/lot5f2d-entrees.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Sans commentaires : les gardes de code lisent le code. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const EM_DASH = String.fromCharCode(0x2014);

let esbuild = null;
try {
  esbuild = await import('esbuild');
} catch {
  esbuild = null;
}

const BUTTON = 'src/components/outreach/SequenceEnrollButton.tsx';
const SEARCH = 'src/components/outreach/LinkedInSearch.tsx';
const PANEL = 'src/components/outreach/search/SearchResultsPanel.tsx';
const RESULTS_V3 = 'src/components/missions/v3/sourcing/SourcingResultsV3.tsx';
const CARD_ACTIONS = 'src/components/outreach/result-card/CardActions.tsx';
const DETAIL_SHEET = 'src/components/outreach/result-card/ProfileDetailSheet.tsx';
const PREVIEW_MODAL = 'src/components/outreach/EnrollmentPreviewModal.tsx';

// ─── SequenceEnrollButton : source ──────────────────────────────────────────

test('5F2D-B1 bouton : ancien composant gardé tel quel, nouveau composant à part, interrupteur à l\'entrée', () => {
  const src = read(BUTTON);
  const body = code(src);

  // Signature : les identifiants traités sont facultatifs, l'ancien flux appelle sans argument.
  assert.match(body, /onSuccess\?: \(enrolledProfileIds\?: readonly string\[\]\) => void;/);
  assert.match(body, /const handleEnrollSuccess = \(\) => \{[^}]*onSuccess\?\.\(\);/);

  // Interrupteur : un seul point d'aiguillage, les deux composants derrière.
  assert.match(body, /import \{ useSequencesBeta \} from '@\/hooks\/useSequencesBeta';/);
  assert.match(
    body,
    /export const SequenceEnrollButton: React\.FC<SequenceEnrollButtonProps> = \(props\) => \{\s*const sequencesV2 = useSequencesBeta\(\);\s*return sequencesV2 \? <ContactFlowEnrollButton \{\.\.\.props\} \/> : <LegacySequenceEnrollButton \{\.\.\.props\} \/>;\s*\};/,
  );
  assert.equal((body.match(/export const /g) || []).length, 1, 'un seul export de composant (SequenceEnrollJob est une interface)');

  // L'ancien composant est déplacé, pas réécrit : les gardes de forme des autres tests le lisent.
  const legacy = body.slice(body.indexOf('const LegacySequenceEnrollButton'), body.indexOf('const ContactFlowEnrollButton'));
  assert.ok(legacy.length > 5000, 'ancien composant lu en entier');
  for (const needle of [
    'quiet = false,',
    "variant={quiet ? 'ghost' : 'outline'}",
    '<SequenceEnrollModal',
    '<DropdownMenu',
    'placeholder="Rechercher une séquence"',
    'Impossible de charger les séquences',
    'const handleEnrollSuccess = () => {',
    'sequence_steps(count)',
    '<ChevronDown',
    'hasPlanFeature(effectivePlanId',
  ]) {
    assert.ok(legacy.includes(needle), `ancien composant : ${needle}`);
  }
});

test('5F2D-B2 bouton : le nouveau composant n\'écrit rien, ne lit rien et charge la feuille à la demande', () => {
  const body = code(read(BUTTON));
  const v2 = body.slice(body.indexOf('const ContactFlowEnrollButton'), body.indexOf('export const SequenceEnrollButton'));
  assert.ok(v2.length > 800, 'nouveau composant lu');

  // Feuille chargée à la demande, sans rendu bloquant.
  assert.match(
    body,
    /const ContactFlowSheet = lazy\(\(\) =>\s*import\('@\/components\/sequences\/contact\/ContactFlowSheet'\)\.then\(\(m\) => \(\{ default: m\.ContactFlowSheet \}\)\),\s*\);/,
  );
  assert.doesNotMatch(body, /import \{[^}]*ContactFlowSheet[^}]*\} from/, 'jamais d\'import statique de la feuille');
  assert.match(v2, /<Suspense fallback=\{null\}>/);

  // Profils figés à l'ouverture, par l'adaptateur pur.
  assert.match(v2, /useState<\{ candidates: FlowCandidate\[\]; overflow: number \} \| null>\(null\)/);
  assert.match(v2, /onClick=\{\(\) => setFrozen\(profilesToFlowCandidates\(selectedProfiles\)\)\}/);
  assert.match(v2, /candidates=\{frozen\.candidates\}/);
  assert.match(v2, /overflow=\{frozen\.overflow\}/);
  // Mission, poste, compte du bouton ; pas de lien « Ouvrir la fiche ».
  assert.match(v2, /missionId=\{missionId\}/);
  assert.match(v2, /job=\{selectedJob \?\? null\}/);
  assert.match(v2, /accountId=\{accountId\}/);
  assert.doesNotMatch(v2, /onOpenCandidate/);
  // Fin d'inscription et retenu sans inscrire.
  assert.match(v2, /onEnrolled=\{\(handledIds\) => onSuccess\?\.\(handledIds\)\}/);
  assert.match(v2, /onChanged=\{\(\) => onSuccess\?\.\(\[\]\)\}/);
  // La feuille survit à une sélection vide : seul le bouton dépend d'elle.
  assert.match(v2, /\{selectedProfiles\.length > 0 && \(\s*<Button/);
  assert.match(v2, /\{frozen && \(\s*<span className="contents" onClick=\{\(event\) => event\.stopPropagation\(\)\} onKeyDown=\{\(event\) => event\.stopPropagation\(\)\}>\s*<Suspense/);
  // Les clics et les touches de la feuille (rendue dans un portail) ne remontent pas jusqu'à la carte du résultat.

  // Même aspect que le menu, sans chevron ; kit seulement.
  assert.match(v2, /variant=\{quiet \? 'ghost' : 'outline'\}/);
  assert.match(v2, /title="Inscrire dans une séquence"/);
  assert.match(v2, /className=\{cn\('shrink-0', quiet && 'max-sm:min-h-11', className\)\}/);
  assert.match(v2, /<GitBranch aria-hidden="true" \/>/);
  assert.doesNotMatch(v2, /ChevronDown|DropdownMenu|SequenceEnrollModal/);
  assert.doesNotMatch(v2, /<button\b/, 'composant du kit, pas de balise brute');

  // Aucune écriture, aucune lecture, aucun stockage local, aucune adresse : le flux s'en charge.
  assert.doesNotMatch(v2, /supabase|\.from\(|\.rpc\(|retainCandidates|enrollCandidates|localStorage|sessionStorage|navigate|\/sequences|<Link/);
  // Pas de texte nouveau : ni tiret long, ni « (s) », ni nom de prestataire.
  assert.ok(!v2.includes(EM_DASH));
  assert.doesNotMatch(v2, /\(s\)|Unipile|Apollo|PDL/);
});

// ─── SequenceEnrollButton : comportement ────────────────────────────────────

/** Doublures du bouton : React en objets, hooks pilotés par le test, dépendances réduites à des marqueurs. */
const BUTTON_STUBS = {
  react: `
    export const Fragment = 'Fragment';
    export const Suspense = 'Suspense';
    export const lazy = (loader) => ({ lazy: true, loader });
    export const useMemo = (fn) => fn();
    export const useCallback = (fn) => fn;
    export const useState = (initial) => {
      const h = globalThis.__enrollHarness;
      const i = h.cursor++;
      if (!(i in h.states)) h.states[i] = typeof initial === 'function' ? initial() : initial;
      return [h.states[i], (next) => { h.states[i] = typeof next === 'function' ? next(h.states[i]) : next; }];
    };
    export default { Fragment, Suspense, lazy };
  `,
  'react/jsx-runtime': `
    export const Fragment = 'Fragment';
    export const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
    export const jsxs = jsx;
  `,
  'react-router-dom': "export const Link = 'Link';",
  '@/integrations/supabase/client': 'export const supabase = {};',
  '@/components/ui/button': "export const Button = 'Button';",
  '@/components/ui/input': "export const Input = 'Input';",
  '@/components/ui/dropdown-menu': `
    export const DropdownMenu = 'DropdownMenu';
    export const DropdownMenuContent = 'DropdownMenuContent';
    export const DropdownMenuItem = 'DropdownMenuItem';
    export const DropdownMenuLabel = 'DropdownMenuLabel';
    export const DropdownMenuSeparator = 'DropdownMenuSeparator';
    export const DropdownMenuTrigger = 'DropdownMenuTrigger';
  `,
  '@/components/ui/badge': "export const Badge = 'Badge';",
  '@/lib/utils': "export const cn = (...parts) => parts.filter(Boolean).join(' ');",
  'lucide-react': `
    export const AlertCircle = 'AlertCircle';
    export const GitBranch = 'GitBranch';
    export const ChevronDown = 'ChevronDown';
    export const Loader2 = 'Loader2';
    export const Plus = 'Plus';
    export const Search = 'Search';
  `,
  sonner: 'export const toast = { error() {} };',
  './SequenceEnrollModal': "export const SequenceEnrollModal = 'SequenceEnrollModal';",
  '@/components/ui/UpgradePrompt': "export const UpgradePrompt = 'UpgradePrompt';",
  '@/hooks/useSubscriptionState': "export const useSubscriptionState = () => ({ effectivePlanId: 'pro', isLoading: false });",
  '@/lib/featureGates': 'export const hasPlanFeature = () => true;',
  './enrollment-preview/enrollmentHelpers': "export const SEQUENCES_PLAN_REQUIRED_MESSAGE = 'plan';",
  '@/hooks/useSequencesBeta': 'export const useSequencesBeta = () => globalThis.__enrollHarness.beta;',
  // L'adaptateur a son propre test (lot5f2d-generalisation) : ici seul son contrat compte.
  '@/components/sequences/contact/flowCandidates': `
    export const profilesToFlowCandidates = (profiles) => ({
      candidates: profiles.map((p) => ({ id: p.id, rowId: null })),
      overflow: 7,
    });
  `,
  '@/components/sequences/contact/ContactFlowSheet': "export const ContactFlowSheet = 'ContactFlowSheetStub';",
};

async function loadButton() {
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, BUTTON)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    jsx: 'automatic',
    logLevel: 'silent',
    plugins: [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => (args.path in BUTTON_STUBS ? { path: args.path, namespace: 'stub' } : undefined));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: BUTTON_STUBS[args.path], loader: 'js' }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

/** Rendu à la main : l'aiguillage, puis le composant choisi, avec l'état du harnais. */
function makeHarness({ beta }) {
  const harness = { beta, states: [], cursor: 0 };
  globalThis.__enrollHarness = harness;
  return harness;
}
function renderButton(kit, harness, props) {
  harness.cursor = 0;
  const outer = kit.SequenceEnrollButton(props);
  return { outer, tree: typeof outer.type === 'function' ? outer.type(outer.props) : outer };
}
/** Premier nœud (dans l'arbre rendu) qui satisfait le prédicat. */
function find(node, predicate) {
  if (node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, predicate);
      if (hit) return hit;
    }
    return null;
  }
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}
const textOf = (node) => {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props?.children);
};

const profile = (id) => ({ id, name: `Profil ${id}` });
const baseProps = (extra = {}) => ({
  selectedProfiles: [profile('a'), profile('b')],
  accountId: 'acc_1',
  selectedJob: { id: 'project:11111111-1111-4111-8111-111111111111', title: 'Poste' },
  triggerLabel: 'Contacter',
  ...extra,
});

test('5F2D-B3 bouton allumé : même bouton, la feuille s\'ouvre avec les profils figés', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const kit = await loadButton();
  const harness = makeHarness({ beta: true });
  const calls = [];
  const props = baseProps({ onSuccess: (...args) => calls.push(args) });

  // Fermée : le bouton seul, au même aspect que le menu, sans chevron.
  let { outer, tree } = renderButton(kit, harness, props);
  assert.equal(typeof outer.type, 'function');
  assert.notEqual(outer.type.name, 'LegacySequenceEnrollButton');
  assert.equal(find(tree, (n) => n.type === 'Suspense'), null, 'pas de feuille tant que rien n\'est ouvert');
  assert.equal(find(tree, (n) => n.type === 'DropdownMenu'), null);
  const button = find(tree, (n) => n.type === 'Button');
  assert.equal(button.props.variant, 'outline');
  assert.equal(button.props.size, 'sm');
  assert.equal(button.props.title, 'Inscrire dans une séquence');
  assert.equal(button.props.className, 'shrink-0');
  assert.equal(textOf(button), 'Contacter');
  assert.ok(find(button, (n) => n.type === 'GitBranch'));
  assert.equal(find(button, (n) => n.type === 'ChevronDown'), null);

  // Ouverture : les profils cochés à cet instant.
  button.props.onClick();
  ({ tree } = renderButton(kit, harness, props));
  const sheet = find(tree, (n) => n.type?.lazy === true);
  assert.ok(sheet, 'la feuille est rendue');
  assert.equal(find(tree, (n) => n.type === 'Suspense').props.fallback, null);
  assert.equal(sheet.props.open, true);
  assert.equal(sheet.props.missionId, '11111111-1111-4111-8111-111111111111');
  assert.deepEqual(sheet.props.job, props.selectedJob);
  assert.equal(sheet.props.accountId, 'acc_1');
  assert.deepEqual(sheet.props.candidates.map((c) => c.id), ['a', 'b']);
  assert.equal(sheet.props.overflow, 7);
  assert.equal(sheet.props.onOpenCandidate, undefined, 'pas de fiche à ouvrir depuis la recherche');
  const frozenCandidates = sheet.props.candidates;

  // La sélection change pendant que la feuille est ouverte : la liste montrée ne bouge pas.
  ({ tree } = renderButton(kit, harness, { ...props, selectedProfiles: [profile('a'), profile('b'), profile('c')] }));
  assert.equal(find(tree, (n) => n.type?.lazy === true).props.candidates, frozenCandidates);

  // Sélection tombée à vide : plus de bouton, la feuille reste sous les mains de la personne.
  ({ tree } = renderButton(kit, harness, { ...props, selectedProfiles: [] }));
  assert.equal(find(tree, (n) => n.type === 'Button'), null);
  assert.ok(find(tree, (n) => n.type?.lazy === true), 'feuille toujours rendue');

  // Fin d'inscription : les identifiants rendus par le flux, tels quels, en un seul argument.
  const openSheet = find(tree, (n) => n.type?.lazy === true);
  openSheet.props.onEnrolled(['a', 'b']);
  assert.deepEqual(calls, [[['a', 'b']]]);
  // Retenu sans inscrire : l'appelant relit ses statuts, aucun profil n'est traité.
  openSheet.props.onChanged();
  assert.deepEqual(calls[1], [[]]);
  assert.equal(calls.length, 2);

  // Une demande d'ouverture n'est pas une fermeture ; la fermeture rend la feuille.
  openSheet.props.onOpenChange(true);
  ({ tree } = renderButton(kit, harness, props));
  assert.ok(find(tree, (n) => n.type?.lazy === true));
  openSheet.props.onOpenChange(false);
  ({ tree } = renderButton(kit, harness, props));
  assert.equal(find(tree, (n) => n.type === 'Suspense'), null);
  assert.ok(find(tree, (n) => n.type === 'Button'), 'le bouton revient avec la sélection');

  // Chargement à la demande : la feuille nommée par le module, jamais autre chose.
  const loaded = await sheet.type.loader();
  assert.deepEqual(loaded, { default: 'ContactFlowSheetStub' });
});

test('5F2D-B4 bouton allumé : poste sans mission, absent ou sans rappel ne plantent pas', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const kit = await loadButton();

  const openedSheet = (extra) => {
    const harness = makeHarness({ beta: true });
    const props = baseProps(extra);
    let { tree } = renderButton(kit, harness, props);
    find(tree, (n) => n.type === 'Button').props.onClick();
    ({ tree } = renderButton(kit, harness, props));
    return find(tree, (n) => n.type?.lazy === true);
  };

  // Poste d'une mission à l'ancien format (sans « project: ») : aucune mission, le poste passe tel quel.
  const legacyJob = { id: 'job-ancien', title: 'Poste' };
  let sheet = openedSheet({ selectedJob: legacyJob });
  assert.equal(sheet.props.missionId, null);
  assert.deepEqual(sheet.props.job, legacyJob);

  // Sans poste : rien n'est écrit dans le Pipeline, le flux le sait par deux valeurs nulles.
  for (const selectedJob of [null, undefined]) {
    sheet = openedSheet({ selectedJob });
    assert.equal(sheet.props.missionId, null);
    assert.equal(sheet.props.job, null);
  }

  // Sans rappel : rien ne plante, ni à l'inscription ni au retenu.
  sheet = openedSheet({ onSuccess: undefined });
  sheet.props.onEnrolled(['a']);
  sheet.props.onChanged();
});

test('5F2D-B5 bouton : discret sur la nouvelle page, classes ajoutées gardées', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const kit = await loadButton();
  const harness = makeHarness({ beta: true });
  const { tree } = renderButton(kit, harness, baseProps({ quiet: true, className: 'extra', triggerLabel: undefined }));
  const button = find(tree, (n) => n.type === 'Button');
  assert.equal(button.props.variant, 'ghost');
  assert.equal(button.props.className, 'shrink-0 max-sm:min-h-11 extra');
  assert.equal(textOf(button), 'Séquence', 'libellé par défaut');

  // Rien de coché : ni bouton ni feuille.
  const empty = renderButton(kit, harness, baseProps({ selectedProfiles: [] }));
  assert.equal(find(empty.tree, (n) => n.type === 'Button'), null);
  assert.equal(find(empty.tree, (n) => n.type === 'Suspense'), null);
});

test('5F2D-B6 bouton éteint : l\'ancien menu et la fenêtre d\'avant, jamais la feuille', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const kit = await loadButton();
  const harness = makeHarness({ beta: false });
  const calls = [];
  const { outer, tree } = renderButton(kit, harness, baseProps({ onSuccess: (...args) => calls.push(args) }));
  assert.equal(outer.type.name, 'LegacySequenceEnrollButton');
  assert.ok(find(tree, (n) => n.type === 'DropdownMenu'), 'le menu « Séquence »');
  const trigger = find(tree, (n) => n.type === 'DropdownMenuTrigger');
  const button = find(trigger, (n) => n.type === 'Button');
  assert.equal(button.props.title, 'Inscrire dans une séquence');
  assert.ok(find(button, (n) => n.type === 'ChevronDown'), 'le chevron de l\'ancien bouton');
  assert.equal(button.props.onClick, undefined, 'le menu s\'ouvre par le déclencheur, pas par un clic de feuille');
  assert.equal(find(tree, (n) => n.type === 'Suspense'), null);
  assert.equal(find(tree, (n) => n.type?.lazy === true), null);
  assert.deepEqual(calls, []);

  // Rien de coché : le composant d'avant ne rend rien.
  const empty = renderButton(kit, harness, baseProps({ selectedProfiles: [] }));
  assert.equal(empty.tree, null);
});

// ─── Recherche : rappel de fin d'inscription ────────────────────────────────

test('5F2D-L1 recherche : le rappel connaît les identifiants traités, dropFromSelection est déclaré avant', () => {
  const src = code(read(SEARCH));
  const dropAt = src.indexOf('const dropFromSelection = useCallback(');
  const handlerAt = src.indexOf('const handleSequenceEnrollSuccess = useCallback(');
  assert.ok(dropAt > 0 && handlerAt > 0, 'les deux rappels existent');
  assert.ok(dropAt < handlerAt, 'dropFromSelection est déclaré avant le rappel qui le lit');
  assert.equal((src.match(/const dropFromSelection = /g) || []).length, 1);
  assert.equal((src.match(/const handleSequenceEnrollSuccess = /g) || []).length, 1);

  const handler = src.slice(handlerAt, src.indexOf('// Refine search state and handler', handlerAt));
  assert.match(handler, /useCallback\(\(enrolledIds\?: readonly string\[\]\) => \{/);
  assert.match(handler, /if \(enrolledIds\) dropFromSelection\(\[\.\.\.enrolledIds\]\);\s*else search\.setSelectedProfiles\(new Set\(\)\);/);
  assert.match(handler, /queryClient\.invalidateQueries\(\{ queryKey: \['job-candidate-status'\] \}\);/);
  assert.match(handler, /void search\.candidateStatus\.refresh\(\);/);
  assert.match(handler, /refreshProjectEnrollments\(\);/);
  // La liste de dépendances garde son début (les gardes SEQ-143 et SEQ-186 la lisent) et reçoit le rappel en dernier.
  assert.match(handler, /\}, \[search\.setSelectedProfiles, search\.candidateStatus\.refresh, queryClient, dropFromSelection\]\);/);

  // Le rappel passe tel quel aux deux panneaux de résultats.
  assert.match(src, /onSequenceEnrollSuccess=\{handleSequenceEnrollSuccess\}/);
});

/** Le rappel de LinkedInSearch, lu dans son source et exécuté avec des doublures. */
function loadHandler() {
  const src = read(SEARCH);
  const start = src.indexOf('const handleSequenceEnrollSuccess = useCallback(');
  const end = src.indexOf('}, [search.setSelectedProfiles', start);
  assert.ok(start > 0 && end > start, 'rappel trouvé');
  const fnSrc = src.slice(start + 'const handleSequenceEnrollSuccess = useCallback('.length, end + 1);
  const js = esbuild.transformSync(fnSrc, { loader: 'ts' }).code.trim().replace(/;$/, '');
  const log = [];
  const doubles = {
    dropFromSelection: (ids) => log.push(['drop', ids]),
    search: {
      setSelectedProfiles: (value) => log.push(['set', value]),
      candidateStatus: { refresh: () => { log.push(['refresh']); return Promise.resolve(); } },
    },
    queryClient: { invalidateQueries: (arg) => log.push(['invalidate', arg]) },
    refreshProjectEnrollments: () => log.push(['badges']),
  };
  const make = new Function('dropFromSelection', 'search', 'queryClient', 'refreshProjectEnrollments', `return (${js});`);
  const handler = make(doubles.dropFromSelection, doubles.search, doubles.queryClient, doubles.refreshProjectEnrollments);
  return { handler, log };
}

test('5F2D-L2 recherche : avec des identifiants, ceux-là seulement quittent la sélection', (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const { handler, log } = loadHandler();
  handler(['a', 'b']);
  assert.deepEqual(log, [
    ['drop', ['a', 'b']],
    ['invalidate', { queryKey: ['job-candidate-status'] }],
    ['refresh'],
    ['badges'],
  ]);
  assert.ok(!log.some((entry) => entry[0] === 'set'), 'la sélection n\'est pas vidée');
});

test('5F2D-L3 recherche : un tableau vide (retenu sans inscrire) relit les statuts sans toucher à la sélection', (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const { handler, log } = loadHandler();
  handler([]);
  assert.deepEqual(log.map((entry) => entry[0]), ['drop', 'invalidate', 'refresh', 'badges']);
  assert.deepEqual(log[0], ['drop', []]);
});

test('5F2D-L4 recherche : sans argument (ancien flux), la sélection est vidée comme avant', (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const { handler, log } = loadHandler();
  handler();
  assert.deepEqual(log.map((entry) => entry[0]), ['set', 'invalidate', 'refresh', 'badges']);
  assert.ok(log[0][1] instanceof Set && log[0][1].size === 0);
  assert.ok(!log.some((entry) => entry[0] === 'drop'));
});

// ─── Types et appelants ─────────────────────────────────────────────────────

test('5F2D-T1 types : les deux panneaux de résultats acceptent les identifiants, les cartes et la fiche les ignorent', () => {
  for (const rel of [PANEL, RESULTS_V3]) {
    assert.match(code(read(rel)), /onSequenceEnrollSuccess: \(enrolledIds\?: readonly string\[\]\) => void;/, rel);
  }
  // La carte et la fiche appellent le rappel sans argument : le bouton ne vide rien de plus que d'habitude.
  const card = code(read(CARD_ACTIONS));
  assert.match(card, /onSuccess=\{\(\) => \{\s*onSequenceEnroll\?\.\(\);\s*onProfileTreated\?\.\(\);\s*\}\}/);
  const sheet = code(read(DETAIL_SHEET));
  assert.equal((sheet.match(/onSuccess=\{\(\) => \{ onSequenceEnroll\?\.\(\); onProfileTreated\?\.\(\); \}\}/g) || []).length, 2);
  assert.match(sheet, /onSequenceEnroll\?: \(\) => void;/);
  assert.match(card, /onSequenceEnroll\?: \(\) => void;/);

  // Les entrées de la recherche passent toutes par le bouton : aucune n'ouvre elle-même la fenêtre d'avant.
  for (const rel of [PANEL, RESULTS_V3, CARD_ACTIONS, DETAIL_SHEET]) {
    assert.doesNotMatch(code(read(rel)), /<SequenceEnrollModal/, rel);
  }
  // Les deux boutons discrets du Sourcing de la mission gardent leur forme (garde S-13b de lot12-sourcing).
  assert.equal((read(RESULTS_V3).match(/\bquiet\n/g) || []).length, 2);
});

// ─── Renommage ──────────────────────────────────────────────────────────────

test('5F2D-R1 renommage : « Retenir sans contacter » interrupteur allumé, l\'ancien libellé gardé dans le source', () => {
  const src = read(PREVIEW_MODAL);
  const body = code(src);
  assert.match(body, /import \{ useSequencesBeta \} from '@\/hooks\/useSequencesBeta';/);
  assert.equal((body.match(/const sequencesV2 = useSequencesBeta\(\);/g) || []).length, 1);
  assert.match(
    body,
    /\{sequencesV2 \? 'Retenir sans contacter' : 'Présélectionner sans message'\}/,
  );
  assert.equal((body.match(/Retenir sans contacter/g) || []).length, 1);
  assert.equal((body.match(/Présélectionner sans message/g) || []).length, 1);

  // Le hook est lu avec les premiers : avant tout état et tout retour anticipé de la fenêtre.
  const component = body.slice(body.indexOf('export const EnrollmentPreviewModal'));
  const hookAt = component.indexOf('const sequencesV2 = useSequencesBeta();');
  assert.ok(hookAt > 0);
  assert.ok(hookAt < component.indexOf('useState('), 'avant le premier état');
  assert.ok(hookAt < component.search(/\n  (?:if \([^\n]*\) )?return\b/), 'avant tout retour du corps');

  // Le bouton reste celui d'avant : même fonction, même condition, même icône.
  assert.match(
    body,
    /\{job\?\.id && \(\s*<Button\s+variant="outline"\s+onClick=\{handleShortlist\}[\s\S]*?\{!isShortlisting && <ListChecks aria-hidden="true" \/>\}\s*\{sequencesV2 \? 'Retenir sans contacter' : 'Présélectionner sans message'\}\s*<\/Button>\s*\)\}/,
  );
  // Les textes ajoutés respectent les règles de forme.
  assert.ok(!'Retenir sans contacter'.includes(EM_DASH));
});
