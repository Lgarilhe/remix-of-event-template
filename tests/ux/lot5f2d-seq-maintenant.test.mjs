/**
 * Refonte mission, lot 5f-2d, chantier D : page d'une séquence (« Inscrire des
 * candidats ») et carte « Maintenant » (« Contacter les N »).
 *
 * - sequenceEnrollPath (src/lib/sequencesBeta.ts) lue sous Node : adresse du
 *   Pipeline de la mission avec la séquence demandée, parité avec missionV3Path
 *   et bareMissionId, `/sourcing` sans mission.
 * - SequenceDetailPage : une seule cible calculée, deux sites, plus de ?tab=pipeline.
 * - PipelineScreen : indication d'une ligne (condition et phrase extraites du source
 *   et exécutées), ouverture du panneau par « Contacter les N » (fin de l'effet des
 *   retenus exécutée avec des doublures), ancien geste gardé interrupteur éteint.
 * - ContactPanel : paramètre local `sequence` (jamais un paramètre de panneau, n'ouvre
 *   rien à lui seul), transmis au seul mode Contacter, retiré en le quittant (extrait
 *   de setTab exécuté).
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

test('5F2D-SM1 sequenceEnrollPath : Pipeline de la mission avec la séquence demandée', async (t) => {
  const m = await loadTs(t, BETA);
  if (!m) return;
  assert.equal(m.sequenceEnrollPath({ id: SEQ, project_id: MISSION }), `/missions/${MISSION}?sequence=${SEQ}`);
  // Pas de ?tab=, pas de panneau ni de mode : le panneau à vide serait renvoyé sur « Contactés ».
  const url = m.sequenceEnrollPath({ id: SEQ, project_id: MISSION });
  assert.doesNotMatch(url, /tab=|panneau|contacter/);
});

test('5F2D-SM2 sequenceEnrollPath : « project:<uuid> » ramené à l\'uuid, comme bareMissionId', async (t) => {
  const m = await loadTs(t, BETA);
  const pick = await loadTs(t, PICK);
  if (!m || !pick) return;
  assert.equal(m.sequenceEnrollPath({ id: SEQ, project_id: `project:${MISSION}` }), `/missions/${MISSION}?sequence=${SEQ}`);
  for (const raw of [MISSION, `project:${MISSION}`, 'project:', '', null]) {
    const bare = pick.bareMissionId(raw);
    const expected = bare ? `/missions/${encodeURIComponent(bare)}?sequence=${SEQ}` : '/sourcing';
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

test('5F2D-SM4 sequenceEnrollPath : identifiants encodés, même adresse que missionV3Path', async (t) => {
  const m = await loadTs(t, BETA);
  const beta = await loadTs(t, MISSION_BETA);
  if (!m || !beta) return;
  for (const [mission, id] of [
    [MISSION, SEQ],
    ['mission avec espace/slash?x', 'séq & 1=2'],
    ['m&1', 'a+b%c#d'],
  ]) {
    const path = m.sequenceEnrollPath({ id, project_id: mission });
    assert.equal(path, beta.missionV3Path(mission, 'pipeline', { sequence: id }), `parité pour ${mission}`);
    const [pathname, search] = path.split('?');
    assert.equal(decodeURIComponent(pathname.slice('/missions/'.length)), mission, 'mission lisible');
    assert.equal(new URLSearchParams(search).get('sequence'), id, 'séquence lisible');
  }
});

test('5F2D-SM5 l\'adresse produite se lit comme l\'écran Pipeline de la mission, sans panneau', async (t) => {
  const m = await loadTs(t, BETA);
  const beta = await loadTs(t, MISSION_BETA);
  if (!m || !beta) return;
  const [pathname, search] = m.sequenceEnrollPath({ id: SEQ, project_id: MISSION }).split('?');
  assert.deepEqual(beta.readMissionV3Location(pathname, `?${search}`), {
    id: MISSION, screen: 'pipeline', panel: null, candidateRowId: null, bilan: false,
    section: null, view: 'liste', stage: null,
  });
  // `sequence` n'est ni converti vers l'ancienne page, ni un paramètre de la page : il traverse tel quel.
  assert.equal(beta.legacyToV3Target(pathname, `?${search}`), null);
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
  const fn = new Function('sequencesV2', 'ctx', 'searchParams', 'selection', 'SEQUENCE_PARAM', `return ${m[1]};`);
  return ({ on = true, archived = false, sequence = SEQ, size = 0 } = {}) =>
    fn(
      on,
      { isArchived: archived },
      new URLSearchParams(sequence === null ? '' : `sequence=${sequence}`),
      { size },
      'sequence',
    );
}

test('5F2D-SM10 indication : la phrase exacte, seulement séquence demandée, interrupteur allumé, mission en cours, rien de coché', () => {
  const hint = hintEvaluator();
  assert.equal(hint(), HINT);
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
  // Le paramètre n'est jamais écrit ni retiré par l'écran : seul le panneau le retire en quittant le mode.
  assert.doesNotMatch(src, /\[SEQUENCE_PARAM\]|setParams\(\{[^}]*sequence/);
  assert.equal(src.split('SEQUENCE_PARAM').length - 1, 2, 'déclaré et lu une fois');
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
  const effect = src.match(/useEffect\(\(\) => \{\s*if \(!contactRequest \|\| filterParam !== 'retained'([\s\S]*?)\}, \[contactRequest, ([^\]]*)\]\);/);
  assert.ok(effect, 'effet des retenus');
  const body = effect[1];
  const selectAt = body.indexOf('setSelection(new Map(picked.map');
  const openAt = body.indexOf('openContactFlow()');
  assert.ok(selectAt > 0 && openAt > selectAt, 'sélection posée, puis panneau');
  // La demande tombe avant la lecture finale : un nouveau rendu ne rouvre rien.
  assert.ok(body.indexOf('setContactRequest(false)') < selectAt);
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
  assert.match(src, /const preferredSequenceId = new URLSearchParams\(location\.search\)\.get\(SEQUENCE_PARAM\) \|\| null;/);
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
