/**
 * Refonte mission, lot 5f-2d, chantier D : page d'une séquence (« Inscrire des
 * candidats ») et carte « Maintenant » (« Contacter les N »).
 *
 * - sequenceEnrollPath (src/lib/sequencesBeta.ts) lue sous Node : adresse du
 *   Pipeline de la mission avec la séquence demandée (`tab=pipeline` sert aussi l'ancienne
 *   page), parité avec missionV3Path une fois convertie par la nouvelle page, identifiant
 *   nu de bareMissionId, `/sourcing` sans mission.
 * - SequenceDetailPage : une seule cible calculée, deux sites, adresse écrite nulle part ailleurs.
 * - PipelineScreen : indication d'une ligne (condition et phrase extraites du source
 *   et exécutées, vue Liste seulement), ouverture du panneau par « Contacter les N »
 *   (effet des retenus exécuté avec des doublures : plafond dit par un toast posé avant
 *   l'ouverture, demande qui tombe quand on quitte la portée), ancien geste gardé
 *   interrupteur éteint, séquence demandée retirée de l'adresse d'arrivée après usage.
 * - ContactPanel : paramètre local `sequence` (jamais un paramètre de panneau, n'ouvre
 *   rien à lui seul), consommé à l'ouverture du mode Contacter : lu une fois (état local),
 *   transmis au seul mode Contacter, retiré de l'adresse aussitôt (effet extrait et exécuté).
 *
 * Lancer : node --test tests/ux/lot5f2d-seq-maintenant.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

/** Sans commentaires : les gardes de code lisent le code. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

async function loadTs(t, rel) {
  try {
    return await import(`../../${rel}`);
  } catch (err) {
    if (err && err.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
      t.skip('Node sans lecture native du TypeScript (22.18 ou plus requis)');
      return null;
    }
    throw err;
  }
}

const EM_DASH = String.fromCharCode(0x2014);

const BETA = 'src/lib/sequencesBeta.ts';
const MISSION_BETA = 'src/lib/missionBeta.ts';
const PICK = 'src/lib/missionSequencePick.ts';
const DETAIL = 'src/pages/SequenceDetailPage.tsx';
const SCREEN = 'src/components/missions/v3/pipeline/PipelineScreen.tsx';
const PANEL = 'src/components/missions/v3/panels/ContactPanel.tsx';
const WORKSPACE = 'src/components/missions/v3/MissionWorkspaceV3.tsx';
const RULE = 'src/lib/missionNextAction.ts';

const MISSION = '5b1c2d3e-0000-4000-8000-000000000001';
const SEQ = '9a8b7c6d-0000-4000-8000-0000000000aa';

const HINT = 'Cochez les candidats à inscrire, puis « Contacter » : la séquence demandée sera proposée d\'avance.';

// ─── sequenceEnrollPath ─────────────────────────────────────────────────────

test('5F2D-SM1 sequenceEnrollPath : Pipeline de la mission avec la séquence demandée, ?tab=pipeline pour les deux pages', async (t) => {
  const m = await loadTs(t, BETA);
  if (!m) return;
  const url = m.sequenceEnrollPath({ id: SEQ, project_id: MISSION });
  assert.equal(url, `/missions/${MISSION}?tab=pipeline&sequence=${SEQ}`);
  // Ni panneau ni mode : le panneau à vide serait renvoyé sur « Contactés ».
  assert.doesNotMatch(url, /panneau|contacter/);
});

test('5F2D-SM2 sequenceEnrollPath : « project:<uuid> » ramené à l\'uuid, comme bareMissionId', async (t) => {
  const m = await loadTs(t, BETA);
  const pick = await loadTs(t, PICK);
  if (!m || !pick) return;
  assert.equal(m.sequenceEnrollPath({ id: SEQ, project_id: `project:${MISSION}` }), `/missions/${MISSION}?tab=pipeline&sequence=${SEQ}`);
  for (const raw of [MISSION, `project:${MISSION}`, 'project:', '', null]) {
    const bare = pick.bareMissionId(raw);
    const expected = bare ? `/missions/${encodeURIComponent(bare)}?tab=pipeline&sequence=${SEQ}` : '/sourcing';
    assert.equal(m.sequenceEnrollPath({ id: SEQ, project_id: raw }), expected, `project_id ${JSON.stringify(raw)}`);
  }
});

test('5F2D-SM3 sequenceEnrollPath : sans mission, /sourcing', async (t) => {
  const m = await loadTs(t, BETA);
  if (!m) return;
  assert.equal(m.sequenceEnrollPath({ id: SEQ, project_id: null }), '/sourcing');
  assert.equal(m.sequenceEnrollPath({ id: SEQ, project_id: '' }), '/sourcing');
  assert.equal(m.sequenceEnrollPath({ id: SEQ, project_id: 'project:' }), '/sourcing');
});

test('5F2D-SM4 sequenceEnrollPath : identifiants encodés, même adresse que missionV3Path une fois ?tab= converti', async (t) => {
  const m = await loadTs(t, BETA);
  const beta = await loadTs(t, MISSION_BETA);
  if (!m || !beta) return;
  for (const [mission, id] of [
    [MISSION, SEQ],
    ['mission avec espace/slash?x', 'séq & 1=2'],
    ['m&1', 'a+b%c#d'],
  ]) {
    const path = m.sequenceEnrollPath({ id, project_id: mission });
    const [pathname, search] = path.split('?');
    // La nouvelle page retire `tab` (MissionEntry, legacyToV3Target) : l'adresse obtenue est celle de missionV3Path.
    assert.equal(beta.legacyToV3Target(pathname, `?${search}`), beta.missionV3Path(mission, 'pipeline', { sequence: id }), `parité pour ${mission}`);
    assert.equal(decodeURIComponent(pathname.slice('/missions/'.length)), mission, 'mission lisible');
    assert.equal(new URLSearchParams(search).get('sequence'), id, 'séquence lisible');
    assert.equal(new URLSearchParams(search).get('tab'), 'pipeline');
  }
});

test('5F2D-SM5 l\'adresse produite mène au Pipeline des deux pages : nouvelle page sans ?tab=, ancienne page sur son onglet Pipeline', async (t) => {
  const m = await loadTs(t, BETA);
  const beta = await loadTs(t, MISSION_BETA);
  const views = await loadTs(t, 'src/lib/missionViews.ts');
  if (!m || !beta || !views) return;
  const [pathname, search] = m.sequenceEnrollPath({ id: SEQ, project_id: MISSION }).split('?');
  assert.deepEqual(beta.readMissionV3Location(pathname, `?${search}`), {
    id: MISSION, screen: 'pipeline', panel: null, candidateRowId: null, bilan: false,
    section: null, view: 'liste', stage: null,
  });
  // Nouvelle page : `tab` est converti (retiré), `sequence` traverse tel quel (ni conversion, ni paramètre de la page).
  assert.equal(beta.legacyToV3Target(pathname, `?${search}`), `/missions/${MISSION}?sequence=${SEQ}`);
  // Ancienne page (konekt.mission-v3 = '0') : l'adresse reste telle quelle et son onglet Pipeline s'ouvre, pas la Vue d'ensemble.
  assert.equal(beta.v3ToLegacyTarget(pathname, `?${search}`), null);
  assert.equal(views.parseMissionView(new URLSearchParams(search).get('tab')), 'pipeline');
});

test('5F2D-SM6 sequencesBeta reste sans import, la fonction est pure', () => {
  const src = read(BETA);
  assert.doesNotMatch(src, /^import /m);
  assert.match(code(src), /export function sequenceEnrollPath\(sequence: \{ id: string; project_id: string \| null \}\): string \{/);
  assert.ok(!src.includes(EM_DASH), 'pas de tiret long');
});

// ─── Page d'une séquence ────────────────────────────────────────────────────

test('5F2D-SM7 SequenceDetailPage : une cible calculée une fois, deux sites, plus de ?tab=pipeline', () => {
  const src = code(read(DETAIL));
  assert.match(src, /import \{ SEQUENCES_PATH, sequenceEnrollPath, sequencePath \} from '@\/lib\/sequencesBeta';/);
  assert.equal(src.split('sequenceEnrollPath(').length - 1, 1, 'un seul calcul');
  assert.match(src, /const enrollHref = sequence \? sequenceEnrollPath\(sequence\) : '\/sourcing';/);
  // En-tête de la page et état vide de l'onglet Candidats.
  assert.equal(src.split('enrollHref={enrollHref}').length - 1, 2, 'deux sites');
  assert.match(src, /<SequenceHeader[\s\S]*?enrollHref=\{enrollHref\}/);
  assert.match(src, /<CandidatesTab[\s\S]*?enrollHref=\{enrollHref\}/);
  // Plus d'adresse écrite en ligne vers l'onglet Pipeline de l'ancienne page.
  assert.doesNotMatch(src, /\?tab=pipeline/);
  assert.doesNotMatch(src, /enrollHref=\{sequence\./);
});

test('5F2D-SM8 SequenceHeader et CandidatesTab : le lien reste un Link, la cible ne s\'y calcule pas', () => {
  const header = code(read('src/components/sequences/SequenceHeader.tsx'));
  assert.match(header, /<Link to=\{enrollHref\}>\s*<Send aria-hidden="true" \/>\s*Inscrire des candidats\s*<\/Link>/);
  assert.doesNotMatch(header, /\?tab=|sequenceEnrollPath/);
  const tab = code(read('src/components/sequences/CandidatesTab.tsx'));
  assert.doesNotMatch(tab, /\?tab=|sequenceEnrollPath/);
});

// ─── Paramètre local ────────────────────────────────────────────────────────

test('5F2D-SM9 `sequence` est un paramètre local : ni V3_PARAM, ni paramètre de panneau, ni conversion', () => {
  for (const rel of [MISSION_BETA, WORKSPACE, 'src/components/missions/v3/shell/missionScreens.ts']) {
    assert.doesNotMatch(code(read(rel)), /['"`]sequence['"`]|\bsequence:/, `${rel} : pas de paramètre sequence`);
  }
  // Les deux lecteurs le déclarent chacun, comme `contacter`.
  assert.match(code(read(SCREEN)), /const SEQUENCE_PARAM = 'sequence';/);
  assert.match(code(read(PANEL)), /const SEQUENCE_PARAM = 'sequence';/);
});

// ─── PipelineScreen : indication ────────────────────────────────────────────

/** Expression de sequenceHint, extraite du source et exécutée avec des doublures. */
function hintEvaluator() {
  const src = code(read(SCREEN));
  const m = src.match(/const sequenceHint =\s*([\s\S]*?);\n/);
  assert.ok(m, 'sequenceHint introuvable');
  const fn = new Function('sequencesV2', 'ctx', 'searchParams', 'selection', 'SEQUENCE_PARAM', 'view', `return ${m[1]};`);
  return ({ on = true, archived = false, sequence = SEQ, size = 0, view = 'liste' } = {}) =>
    fn(
      on,
      { isArchived: archived },
      new URLSearchParams(sequence === null ? '' : `sequence=${sequence}`),
      { size },
      'sequence',
      view,
    );
}

test('5F2D-SM10 indication : la phrase exacte, seulement séquence demandée, interrupteur allumé, mission en cours, vue Liste, rien de coché', () => {
  const hint = hintEvaluator();
  assert.equal(hint(), HINT);
  assert.equal(hint({ view: 'liste' }), HINT);
  // La vue Étapes (kanban) n'a ni case ni barre d'actions : l'indication renverrait à un geste impossible.
  assert.equal(hint({ view: 'etapes' }), null, 'vue Étapes');
  assert.equal(hint({ on: false }), null, 'interrupteur éteint');
  assert.equal(hint({ archived: true }), null, 'mission archivée');
  assert.equal(hint({ size: 1 }), null, 'une case cochée');
  assert.equal(hint({ size: 12 }), null);
  assert.equal(hint({ sequence: null }), null, 'aucune séquence demandée');
  assert.equal(hint({ sequence: '' }), null, 'paramètre vide');
});

test('5F2D-SM11 indication : dans l\'emplacement de la note de sélection, qui garde la priorité', () => {
  const src = code(read(SCREEN));
  assert.match(
    src,
    /\{\(selectionNote \?\? sequenceHint\) && \(\s*<p role="status" className="text-xs text-muted-foreground">\s*\{selectionNote \?\? sequenceHint\}\s*<\/p>\s*\)\}/,
  );
  // L'effet qui vide la note avec la sélection n'est pas touché.
  assert.match(src, /const selectionSize = selection\.size;\s*useEffect\(\(\) => \{\s*if \(selectionSize === 0\) setSelectionNote\(null\);\s*\}, \[selectionSize\]\);/);
  // L'écran ne pose jamais le paramètre : il le lit (indication, séquence consommée) et ne fait que le retirer.
  assert.doesNotMatch(src, /\[SEQUENCE_PARAM\]: (?!null\b)/);
  assert.equal(src.split('[SEQUENCE_PARAM]: null').length - 1, 1, 'un seul retrait, voir 5F2D-SM22');
  assert.match(src, /const requestedSequence = searchParams\.get\(SEQUENCE_PARAM\);/);
  assert.equal(src.split('SEQUENCE_PARAM').length - 1, 4, 'déclaré, lu pour l\'indication, lu pour l\'usage, retiré');
});

// ─── PipelineScreen : « Contacter les N » ───────────────────────────────────

/** Dernière instruction de l'effet des retenus, exécutée avec des doublures. */
function openOrFocus() {
  const src = code(read(SCREEN));
  const m = src.match(/(if \(sequencesV2 && picked\.length > 0\) openContactFlow\(\);\s*else setFocusContact\(picked\.length > 0\);)\s*\}, \[/);
  assert.ok(m, 'fin de l\'effet des retenus introuvable');
  const fn = new Function('sequencesV2', 'picked', 'openContactFlow', 'setFocusContact', m[1]);
  return (sequencesV2, picked) => {
    const calls = [];
    fn(sequencesV2, picked, () => calls.push('open'), (value) => calls.push(`focus:${value}`));
    return calls;
  };
}

test('5F2D-SM12 « Contacter les N » : interrupteur allumé, le panneau s\'ouvre ; éteint, le focus de la barre', () => {
  const run = openOrFocus();
  assert.deepEqual(run(true, [{ id: 'a' }, { id: 'b' }]), ['open']);
  assert.deepEqual(run(false, [{ id: 'a' }, { id: 'b' }]), ['focus:true']);
  // Rien de coché : jamais de panneau à vide (il s'ouvrirait sur « Contactés »), pas de focus à chercher.
  assert.deepEqual(run(true, []), ['focus:false']);
  assert.deepEqual(run(false, []), ['focus:false']);
});

test('5F2D-SM13 « Contacter les N » : la sélection est posée avant l\'ouverture, dépendances de l\'effet à jour', () => {
  const src = code(read(SCREEN));
  const effect = src.match(/useEffect\(\(\) => \{\s*if \(!contactRequest\) return;([\s\S]*?)\}, \[contactRequest, ([^\]]*)\]\);/);
  assert.ok(effect, 'effet des retenus');
  const body = effect[1];
  const selectAt = body.indexOf('setSelection(new Map(picked.map');
  const openAt = body.indexOf('openContactFlow()');
  assert.ok(selectAt > 0 && openAt > selectAt, 'sélection posée, puis panneau');
  // La demande tombe entre la pagination et la lecture finale : un nouveau rendu ne rouvre rien. Les occurrences
  // plus haut (plus aucun retenu, hors ligne, portée quittée) sont d'autres branches : on cherche celle qui suit la pagination.
  const pagingEnd = body.indexOf('return;', body.indexOf('fetchMoreRetained()'));
  const dropAt = body.indexOf('setContactRequest(false)', pagingEnd);
  assert.ok(pagingEnd > 0 && dropAt > pagingEnd && dropAt < selectAt, 'la demande tombe entre la pagination et la lecture finale');
  // Dépendances : primitives et fonctions stables, jamais le contexte entier.
  const deps = effect[2].split(',').map((d) => d.trim());
  assert.ok(deps.includes('sequencesV2'), 'sequencesV2 en dépendance');
  assert.ok(deps.includes('openContactFlow'), 'openContactFlow en dépendance');
  assert.ok(!deps.includes('ctx'), 'pas le contexte entier');
  // openContactFlow vient du contexte, déstructuré, jamais lu en ligne.
  assert.match(src, /const \{ openContactFlow \} = ctx;/);
  // L'ancien geste reste pour l'interrupteur éteint.
  assert.match(src, /const \[focusContact, setFocusContact\] = useState\(false\);/);
  assert.match(src, /\[data-bulk-bar\] button/);
});

/**
 * Effet des retenus, exécuté avec des doublures : corps extrait du source (types retirés), état de l'écran
 * rejoué rendu après rendu. `state` porte les valeurs lues par l'effet ; les appels sont enregistrés dans `calls`.
 */
function retainedEffect() {
  const src = code(read(SCREEN));
  const m = src.match(/useEffect\(\(\) => \{\s*(if \(!contactRequest\) return;[\s\S]*?)\}, \[contactRequest, [^\]]*\]\);/);
  assert.ok(m, 'effet des retenus introuvable');
  const body = m[1].replace(/ as const/g, '');
  const fn = new Function(
    'contactRequest', 'filterParam', 'view', 'countsKnown', 'retainedTotal', 'retainedPending', 'retainedFetchStatus',
    'retainedError', 'retainedMore', 'retainedFetching', 'retainedPages', 'fetchMoreRetained', 'setContactRequest',
    'setSelectionNote', 'setSelection', 'sequencesV2', 'openContactFlow', 'setFocusContact', 'retainedReached',
    'toast', 'RETAINED_SELECTION_MAX', body,
  );
  const makeRows = (n) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));
  return function run(initial) {
    const state = {
      contactRequest: true, filterParam: 'retained', view: 'liste', countsKnown: true, retainedTotal: 3,
      retainedPending: false, retainedFetchStatus: 'idle', retainedError: false, retainedMore: false,
      retainedFetching: false, retainedPages: [{ rows: makeRows(3) }], sequencesV2: true, ...initial,
    };
    const reached = { current: false };
    const calls = [];
    const step = (patch = {}) => {
      Object.assign(state, patch);
      fn(
        state.contactRequest, state.filterParam, state.view, state.countsKnown, state.retainedTotal, state.retainedPending,
        state.retainedFetchStatus, state.retainedError, state.retainedMore, state.retainedFetching, state.retainedPages,
        () => calls.push('fetchMore'),
        (value) => { calls.push(`request:${value}`); state.contactRequest = value; },
        (value) => calls.push(value === null ? 'note:null' : 'note'),
        (value) => calls.push(`select:${value.size}`),
        state.sequencesV2,
        () => calls.push('open'),
        (value) => calls.push(`focus:${value}`),
        reached,
        { info: (text) => calls.push(`toast:${text}`) },
        400,
      );
    };
    return { state, calls, reached, step, makeRows };
  };
}

const capSentence = (picked, total) =>
  `${picked.toLocaleString('fr-FR')} retenus sur ${total.toLocaleString('fr-FR')} sont cochés : une sélection groupée est limitée à ${(400).toLocaleString('fr-FR')}.`;

test('5F2D-SM19 « Contacter les N » au delà de 400 retenus : le plafond est dit par un toast posé avant l\'ouverture du panneau', () => {
  const run = retainedEffect();
  // 1 000 retenus, 400 lus : la note reste sous la barre et le même texte part en toast, avant le panneau.
  const big = run({ retainedTotal: 1000 });
  big.step({ retainedPages: [{ rows: big.makeRows(400) }] });
  assert.deepEqual(big.calls, ['request:false', 'select:400', 'note', `toast:${capSentence(400, 1000)}`, 'open']);
  // Sous 400 retenus, ou tous cochés : pas de toast.
  const small = run({ retainedTotal: 3 });
  small.step();
  assert.deepEqual(small.calls, ['request:false', 'select:3', 'note:null', 'open']);
  const exact = run({ retainedTotal: 400 });
  exact.step({ retainedPages: [{ rows: exact.makeRows(400) }] });
  assert.ok(!exact.calls.some((c) => c.startsWith('toast:')), 'tous les retenus cochés : rien à dire');
  // Interrupteur éteint : le panneau ne s'ouvre pas, la note reste à l'écran sous la barre, pas de toast.
  const off = run({ retainedTotal: 1000, sequencesV2: false });
  off.step({ retainedPages: [{ rows: off.makeRows(400) }] });
  assert.deepEqual(off.calls, ['request:false', 'select:400', 'note', 'focus:true']);
});

test('5F2D-SM20 « Contacter les N » : la demande tombe quand on quitte la portée après l\'avoir atteinte, jamais avant', () => {
  const run = retainedEffect();
  // Lecture en cours sur Retenu, puis une autre puce d'étape, puis retour sur Retenu : rien ne s'ouvre.
  const left = run({ retainedPending: true, retainedPages: undefined });
  left.step();
  assert.deepEqual(left.calls, [], 'lecture en cours');
  assert.equal(left.reached.current, true, 'portée atteinte');
  left.step({ filterParam: 'contacted' });
  assert.deepEqual(left.calls, ['request:false'], 'portée quittée : la demande tombe');
  assert.equal(left.reached.current, false);
  left.step({ filterParam: 'retained', retainedPending: false, retainedPages: [{ rows: left.makeRows(3) }] });
  assert.ok(!left.calls.includes('open'), 'le retour sur Retenu ne rouvre aucun panneau');
  assert.ok(!left.calls.some((c) => c.startsWith('select:')), 'ni ne coche rien');
  // Même chose en quittant la vue Liste pour Étapes.
  const board = run({ retainedPending: true, retainedPages: undefined });
  board.step();
  board.step({ view: 'etapes' });
  board.step({ view: 'liste', retainedPending: false, retainedPages: [{ rows: board.makeRows(3) }] });
  assert.deepEqual(board.calls, ['request:false']);
  // Le filtre peut arriver après la demande (rendus séparés) : tant que la portée n'a pas été atteinte, elle attend.
  const late = run({ filterParam: null, retainedPending: true, retainedPages: undefined });
  late.step();
  assert.deepEqual(late.calls, [], 'ancien filtre : la demande attend');
  assert.equal(late.state.contactRequest, true);
  late.step({ filterParam: 'retained' });
  assert.deepEqual(late.calls, [], 'portée atteinte, lecture en cours');
  late.step({ retainedPending: false, retainedPages: [{ rows: late.makeRows(3) }] });
  assert.deepEqual(late.calls, ['request:false', 'select:3', 'note:null', 'open']);
  // Une demande neuve réarme : contactRetained remet la ref à faux avant de poser la demande.
  const src = code(read(SCREEN));
  assert.match(src, /const contactRetained = useCallback\(\(\) => \{[\s\S]*?retainedReached\.current = false;\s*setContactRequest\(true\);\s*\}, \[setParams\]\);/);
});

test('5F2D-SM14 la règle de la carte ne change pas : même intention, commentaire à jour', () => {
  const src = read(RULE);
  assert.match(code(src), /\| \{ type: 'contact_retained' \}/);
  assert.doesNotMatch(src, /le panneau de contact ne reçoit pas de sélection/);
  assert.match(src, /ouvrir le panneau Contacter sur eux/);
  // Le commentaire de l'écran ne dit plus que le raccourci n'ouvre pas le panneau.
  assert.doesNotMatch(read(SCREEN), /ce raccourci ne l'ouvre pas lui-même/);
});

// ─── ContactPanel ───────────────────────────────────────────────────────────

test('5F2D-SM15 ContactPanel : `sequence` seul n\'ouvre pas le mode Contacter', () => {
  const src = code(read(PANEL));
  const asks = src.match(/const asksFlow = ([^;]*);/);
  assert.ok(asks, 'asksFlow');
  assert.doesNotMatch(asks[1], /SEQUENCE_PARAM|sequence['"]/);
  assert.match(asks[1], /=== '1'/);
  // Lue une fois, à la création du panneau (état local) : elle reste la même après le retrait de l'adresse.
  assert.match(src, /const \[preferredSequenceId\] = useState<string \| null>\(\(\) => new URLSearchParams\(location\.search\)\.get\(SEQUENCE_PARAM\) \|\| null\);/);
  assert.doesNotMatch(src, /const preferredSequenceId = /, 'plus relue à chaque rendu');
  // Un paramètre vide ou absent donne null, jamais une chaîne vide transmise au flux.
  const read1 = (search) => new URLSearchParams(search).get('sequence') || null;
  assert.equal(read1('?panneau=contact&contacter=1&sequence=abc'), 'abc');
  assert.equal(read1('?panneau=contact&contacter=1&sequence='), null);
  assert.equal(read1('?panneau=contact&contacter=1'), null);
});

test('5F2D-SM16 ContactPanel : la séquence demandée n\'est transmise qu\'à ContactFlow, en mode Contacter', () => {
  const src = code(read(PANEL));
  assert.equal(src.split('preferredSequenceId').length - 1, 3, 'déclarée, lue, transmise');
  const flowAt = src.indexOf('} else if (asksFlow) {');
  const v2At = src.indexOf('} else if (sequencesV2) {');
  assert.ok(flowAt > 0 && v2At > flowAt);
  assert.match(src.slice(flowAt, v2At), /<ContactFlow[\s\S]*?onLeave=\{onLeave\}\s+preferredSequenceId=\{preferredSequenceId\}\s*\/>/);
  assert.equal(src.slice(0, flowAt).includes('preferredSequenceId={'), false);
  assert.equal(src.slice(v2At).includes('preferredSequenceId={'), false);
});

test('5F2D-SM17 ContactPanel : quitter le mode retire `sequence`, garde le reste de l\'adresse', () => {
  const src = code(read(PANEL));
  const m = src.match(/(const params = new URLSearchParams\(current\.search\);[\s\S]*?const query = params\.toString\(\);)/);
  assert.ok(m, 'corps de setTab');
  const run = new Function('current', 'next', 'sequencesV2', 'SEQUENCE_PARAM', 'CONTACT_PARAM', 'OUTREACH_PARAM', `${m[1]}\nreturn query;`);
  const call = (search, next, v2 = true) => run({ search }, next, v2, 'sequence', 'contacter', 'outreach');
  const out = new URLSearchParams(call('?panneau=contact&contacter=1&sequence=abc&etape=retained', 'contactes'));
  assert.equal(out.get('sequence'), null, 'séquence demandée retirée');
  assert.equal(out.get('contacter'), null, 'mode quitté');
  assert.equal(out.get('outreach'), 'contactes');
  assert.equal(out.get('panneau'), 'contact', 'panneau gardé');
  assert.equal(out.get('etape'), 'retained', 'filtre gardé');
  // Choisir l'onglet Séquences la retire aussi, interrupteur allumé ou éteint.
  assert.equal(new URLSearchParams(call('?panneau=contact&sequence=abc', 'sequences')).get('sequence'), null);
  assert.equal(new URLSearchParams(call('?panneau=contact&sequence=abc', 'sequences', false)).get('sequence'), null);
  // Sans séquence demandée, l'adresse ne change que comme avant.
  assert.equal(call('?panneau=contact&contacter=1', 'contactes'), 'panneau=contact&outreach=contactes');
});

/** Effet de consommation de ContactPanel, exécuté avec des doublures. */
function consumeEffect() {
  const src = code(read(PANEL));
  const m = src.match(/useEffect\(\(\) => \{\s*(if \(!asksFlow\) return;[\s\S]*?)\}, \[asksFlow, navigate\]\);/);
  assert.ok(m, 'effet de consommation introuvable');
  const fn = new Function('asksFlow', 'locationRef', 'SEQUENCE_PARAM', 'navigate', m[1]);
  return ({ asksFlow = true, pathname = `/missions/${MISSION}`, search, state = { missionV3Pushed: true } }) => {
    const calls = [];
    fn(asksFlow, { current: { pathname, search, state } }, 'sequence', (to, options) => calls.push({ to, options }));
    return calls;
  };
}

test('5F2D-SM21 ContactPanel : la séquence demandée est consommée à l\'ouverture du mode Contacter, retirée de l\'adresse par remplacement', () => {
  const run = consumeEffect();
  const state = { missionV3Pushed: true, missionV3PushKind: 'panel' };
  const calls = run({ search: '?sequence=abc&panneau=contact&contacter=1&etape=retained', state });
  assert.equal(calls.length, 1);
  // Remplacement (pas d'entrée d'historique de plus), état de navigation gardé, autres paramètres gardés dans leur ordre.
  assert.equal(calls[0].to, `/missions/${MISSION}?panneau=contact&contacter=1&etape=retained`);
  assert.deepEqual(calls[0].options, { replace: true, state });
  // Seul paramètre : adresse sans point d'interrogation.
  assert.equal(run({ search: '?sequence=abc' })[0].to, `/missions/${MISSION}`);
  // Adresse déjà débarrassée (l'effet est relancé par la navigation) : rien, donc pas de boucle.
  assert.deepEqual(run({ search: '?panneau=contact&contacter=1&etape=retained' }), []);
  assert.deepEqual(run({ search: '?sequence=&panneau=contact&contacter=1' }).map((c) => c.to), [`/missions/${MISSION}?panneau=contact&contacter=1`]);
  // Hors mode Contacter (onglets du panneau, mission archivée) : rien n'est consommé.
  assert.deepEqual(run({ asksFlow: false, search: '?sequence=abc&panneau=contact' }), []);
});

test('5F2D-SM22 ContactPanel : l\'effet de consommation est avant celui du rechargement ; le Pipeline retire la séquence de l\'adresse d\'arrivée après usage', () => {
  const panel = code(read(PANEL));
  const consumeAt = panel.indexOf('}, [asksFlow, navigate]);');
  const reloadAt = panel.indexOf('const reloadChecked = useRef(false);');
  assert.ok(consumeAt > 0 && reloadAt > consumeAt, 'si les deux naviguent au montage, celui qui retire aussi le mode passe en dernier');
  // Rechargement sans sélection avec la séquence demandée : l'adresse finale n'a ni mode ni séquence.
  const m = panel.match(/(const params = new URLSearchParams\(current\.search\);[\s\S]*?const query = params\.toString\(\);)/);
  const run = new Function('current', 'next', 'sequencesV2', 'SEQUENCE_PARAM', 'CONTACT_PARAM', 'OUTREACH_PARAM', `${m[1]}\nreturn query;`);
  const final = new URLSearchParams(run({ search: '?sequence=abc&panneau=contact&contacter=1' }, 'contactes', true, 'sequence', 'contacter', 'outreach'));
  assert.equal(final.get('sequence'), null);
  assert.equal(final.get('contacter'), null);
  assert.equal(final.get('outreach'), 'contactes');

  // Fermer le panneau (Retour) ramène l'adresse d'arrivée, qui porte encore `sequence` : l'écran la retire après usage.
  const screen = code(read(SCREEN));
  const e = screen.match(/useEffect\(\(\) => \{\s*(if \(contactMode\) \{[\s\S]*?)\}, \[contactMode, requestedSequence, setParams\]\);/);
  assert.ok(e, 'effet de la séquence consommée');
  const fn = new Function('contactMode', 'requestedSequence', 'sequenceUsed', 'setParams', 'SEQUENCE_PARAM', e[1]);
  const used = { current: null };
  const calls = [];
  const step = (contactMode, requestedSequence) =>
    fn(contactMode, requestedSequence, used, (values) => calls.push(values), 'sequence');
  step(false, 'abc');
  assert.deepEqual(calls, [], 'arrivée : la séquence demandée reste (indication, premier « Contacter »)');
  step(true, 'abc');
  step(true, null);
  assert.deepEqual(calls, [], 'mode Contacter ouvert : le panneau retire la séquence, l\'écran ne touche à rien');
  step(false, 'abc');
  assert.deepEqual(calls, [{ sequence: null }], 'retour sur l\'adresse d\'arrivée après usage : retirée par remplacement');
  step(false, 'abc');
  assert.equal(calls.length, 1, 'une seule fois');
  // Une autre séquence demandée plus tard n'est pas celle qui a servi.
  step(true, 'abc');
  step(false, 'autre');
  assert.equal(calls.length, 1);
  // Mode fini sans retour sur l'adresse d'arrivée (adresse sans la séquence) : rien à retirer.
  const calls2 = [];
  const used2 = { current: null };
  const fn2 = (contactMode, requestedSequence) => fn(contactMode, requestedSequence, used2, (values) => calls2.push(values), 'sequence');
  fn2(true, 'abc');
  fn2(false, null);
  assert.deepEqual(calls2, []);
});

// ─── Textes ─────────────────────────────────────────────────────────────────

test('5F2D-SM18 fichiers du chantier : sans tiret long, sans « (s) », sans nom de prestataire, sans stockage local', () => {
  for (const rel of [BETA, DETAIL, SCREEN, PANEL, RULE]) {
    const source = read(rel);
    assert.ok(!source.includes(EM_DASH), `${rel} : pas de tiret long`);
    assert.doesNotMatch(source, /[A-Za-zÀ-ÿ]\(s\)/, `${rel} : accorder par le nombre`);
    // sequencesBeta.ts porte l'interrupteur dans le stockage local : seuls les autres fichiers sont gardés.
    if (rel !== BETA) {
      assert.doesNotMatch(code(source), /\b(Unipile|Apollo|PDL|People Data Labs|Anthropic|Claude|Notion)\b/, `${rel} : nom de prestataire`);
      assert.doesNotMatch(code(source), /\blocalStorage\b|\bwindow\.confirm\b/, `${rel} : stockage local ou confirm`);
    }
  }
  // Pas de bouton brut de plus : le seul d'avant est l'onglet de ContactPanel.
  assert.equal(read(SCREEN).split('<button').length - 1, 0);
  assert.equal(read(PANEL).split('<button').length - 1, 1);
  // La phrase est vouvoyée, sans tiret long, et ne nomme aucune séquence (aucune lecture de plus).
  assert.doesNotMatch(HINT, /tu |ton |ta |tes /i);
  assert.ok(!HINT.includes(EM_DASH));
});
