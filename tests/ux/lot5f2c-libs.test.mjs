/**
 * Refonte mission, lot 5f-2c : modules purs du panneau Contacter.
 *
 * Comportement de src/lib/missionSequencePick.ts (choix de la séquence),
 * src/lib/contactFlowGroups.ts (groupes prêts, à compléter, exclus) et
 * src/lib/quotaGauge.ts (jauge du plafond LinkedIn), lus sous Node, puis
 * gardes de source de ces trois fichiers.
 *
 * Lancer : node --test tests/ux/lot5f2c-libs.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

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

const PICK = 'src/lib/missionSequencePick.ts';
const GROUPS = 'src/lib/contactFlowGroups.ts';
const GAUGE = 'src/lib/quotaGauge.ts';

const MIDDLE_DOT = '·';
const EM_DASH = String.fromCharCode(0x2014);

// ---------------------------------------------------------------------------
// missionSequencePick
// ---------------------------------------------------------------------------

const MISSION = '5b1c2d3e-0000-4000-8000-000000000001';
const OTHER_MISSION = '5b1c2d3e-0000-4000-8000-000000000002';

const sequence = (id, extra = {}) => ({
  id,
  name: `Séquence ${id}`,
  is_active: true,
  project_id: MISSION,
  created_at: '2026-10-01T10:00:00Z',
  stepCount: 3,
  ...extra,
});

test('5F2C-1 bareMissionId retire « project: » et rend null pour une valeur vide', async (t) => {
  const m = await loadTs(t, PICK);
  if (!m) return;
  assert.equal(m.bareMissionId('project:abc'), 'abc');
  assert.equal(m.bareMissionId('abc'), 'abc');
  assert.equal(m.bareMissionId(MISSION), MISSION);
  assert.equal(m.bareMissionId(null), null);
  assert.equal(m.bareMissionId(undefined), null);
  assert.equal(m.bareMissionId(''), null);
  assert.equal(m.bareMissionId('project:'), null);
});

test('5F2C-2 menu des séquences : la mission du plus récent au plus ancien, le choix d’avance est le premier', async (t) => {
  const m = await loadTs(t, PICK);
  if (!m) return;
  const list = [
    sequence('old', { created_at: '2026-09-01T08:00:00Z' }),
    sequence('new', { created_at: '2026-10-05T08:00:00Z' }),
    sequence('mid', { created_at: '2026-09-20T08:00:00Z' }),
  ];
  const menu = m.missionSequenceMenu(list, MISSION);
  assert.deepEqual(menu.mission.map((s) => s.id), ['new', 'mid', 'old']);
  assert.deepEqual(menu.others, []);
  assert.equal(menu.pick?.id, 'new');
  // L'objet choisi est celui de la liste (les champs en plus de l'appelant sont gardés).
  assert.equal(menu.pick, list[1]);
});

test('5F2C-3 le tri compare des instants, pas des chaînes (fuseaux différents)', async (t) => {
  const m = await loadTs(t, PICK);
  if (!m) return;
  // 12:00 à +02:00 est 10:00 UTC, donc plus ancien que 11:00 UTC.
  const list = [
    sequence('paris', { created_at: '2026-10-01T12:00:00+02:00' }),
    sequence('utc', { created_at: '2026-10-01T11:00:00Z' }),
  ];
  assert.deepEqual(m.missionSequenceMenu(list, MISSION).mission.map((s) => s.id), ['utc', 'paris']);
});

test('5F2C-4 à égalité de date, l’identifiant décroissant l’emporte, quel que soit l’ordre d’entrée', async (t) => {
  const m = await loadTs(t, PICK);
  if (!m) return;
  const a = sequence('aaa', { created_at: '2026-10-01T10:00:00Z' });
  const b = sequence('bbb', { created_at: '2026-10-01T10:00:00Z' });
  const c = sequence('ccc', { created_at: '2026-10-01T10:00:00.000Z' }); // même instant, autre écriture
  for (const list of [[a, b, c], [c, b, a], [b, a, c]]) {
    const menu = m.missionSequenceMenu(list, MISSION);
    assert.deepEqual(menu.mission.map((s) => s.id), ['ccc', 'bbb', 'aaa']);
    assert.equal(menu.pick?.id, 'ccc');
  }
});

test('5F2C-5 les séquences inactives et sans étape sont écartées des deux listes', async (t) => {
  const m = await loadTs(t, PICK);
  if (!m) return;
  const list = [
    sequence('paused-newest', { is_active: false, created_at: '2026-10-09T08:00:00Z' }),
    sequence('empty-newer', { stepCount: 0, created_at: '2026-10-08T08:00:00Z' }),
    sequence('usable', { created_at: '2026-10-01T08:00:00Z' }),
    sequence('other-paused', { project_id: OTHER_MISSION, is_active: false }),
    sequence('other-empty', { project_id: null, stepCount: 0 }),
  ];
  const menu = m.missionSequenceMenu(list, MISSION);
  // La plus récente est en pause, la suivante est vide : le choix retombe sur la plus ancienne utilisable.
  assert.deepEqual(menu.mission.map((s) => s.id), ['usable']);
  assert.deepEqual(menu.others, []);
  assert.equal(menu.pick?.id, 'usable');
});

test('5F2C-6 une séquence d’une autre mission ou partagée va dans others, jamais dans le choix d’avance', async (t) => {
  const m = await loadTs(t, PICK);
  if (!m) return;
  const list = [
    sequence('elsewhere', { project_id: OTHER_MISSION, created_at: '2026-10-10T08:00:00Z' }),
    sequence('shared', { project_id: null, created_at: '2026-10-09T08:00:00Z' }),
    sequence('mine', { created_at: '2026-09-01T08:00:00Z' }),
  ];
  const menu = m.missionSequenceMenu(list, MISSION);
  assert.deepEqual(menu.mission.map((s) => s.id), ['mine']);
  assert.deepEqual(menu.others.map((s) => s.id), ['elsewhere', 'shared']);
  assert.equal(menu.pick?.id, 'mine');
});

test('5F2C-7 aucune séquence utilisable pour la mission : pick nul, les autres restent proposées', async (t) => {
  const m = await loadTs(t, PICK);
  if (!m) return;
  const list = [
    sequence('elsewhere', { project_id: OTHER_MISSION }),
    sequence('shared', { project_id: null, created_at: '2026-10-02T08:00:00Z' }),
  ];
  const menu = m.missionSequenceMenu(list, MISSION);
  assert.equal(menu.pick, null);
  assert.deepEqual(menu.mission, []);
  assert.deepEqual(menu.others.map((s) => s.id), ['shared', 'elsewhere']);
  // Liste vide.
  assert.deepEqual(m.missionSequenceMenu([], MISSION), { mission: [], others: [], pick: null });
});

test('5F2C-8 mission inconnue : une séquence partagée ne passe jamais pour celle de la mission', async (t) => {
  const m = await loadTs(t, PICK);
  if (!m) return;
  const list = [sequence('shared', { project_id: null }), sequence('mine')];
  for (const missionId of [null, '']) {
    const menu = m.missionSequenceMenu(list, missionId);
    assert.equal(menu.pick, null);
    assert.deepEqual(menu.mission, []);
    assert.equal(menu.others.length, 2);
  }
});

test('5F2C-9 un identifiant « project:<id> » est ramené à l’identifiant nu, la liste d’entrée n’est pas modifiée', async (t) => {
  const m = await loadTs(t, PICK);
  if (!m) return;
  const list = [
    sequence('older', { created_at: '2026-09-01T08:00:00Z' }),
    sequence('newer', { created_at: '2026-10-01T08:00:00Z' }),
  ];
  const before = list.map((s) => s.id);
  const menu = m.missionSequenceMenu(list, `project:${MISSION}`);
  assert.equal(menu.pick?.id, 'newer');
  assert.deepEqual(list.map((s) => s.id), before, 'la liste d’entrée garde son ordre');
});

test('5F2C-10 une date illisible passe pour la plus ancienne, le tri reste déterministe', async (t) => {
  const m = await loadTs(t, PICK);
  if (!m) return;
  const list = [
    sequence('broken-b', { created_at: 'pas une date' }),
    sequence('dated', { created_at: '2026-01-01T00:00:00Z' }),
    sequence('broken-a', { created_at: '' }),
  ];
  const forward = m.missionSequenceMenu(list, MISSION).mission.map((s) => s.id);
  const backward = m.missionSequenceMenu([...list].reverse(), MISSION).mission.map((s) => s.id);
  assert.deepEqual(forward, ['dated', 'broken-b', 'broken-a']);
  assert.deepEqual(backward, forward);
});

// ---------------------------------------------------------------------------
// contactFlowGroups
// ---------------------------------------------------------------------------

/** Éligibilité sans aucun motif ; chaque test ajoute ce qu'il prouve. */
function eligibility({ blocking = [], erased = [], recent = [], incompatible = [], warnings = [] } = {}) {
  return {
    blocking: new Map(blocking),
    erased: new Set(erased),
    recent: new Map(recent),
    incompatible: new Map(incompatible),
    warnings: new Map(warnings),
  };
}

function options({ aiReview = false, canOverrideRecent = false, overrides = [] } = {}) {
  return { aiReview, canOverrideRecent, overrides: new Set(overrides) };
}

const person = (id, extra = {}) => ({ id, name: `Candidat ${id}`, hasLinkedIn: true, ...extra });

/** Résultat d'un seul candidat : { group, entry }. */
function classifyOne(m, source, elig, opts) {
  const groups = m.classifyContactEntries([source], elig, opts);
  for (const key of ['ready', 'incomplete', 'excluded']) {
    if (groups[key].length === 1) return { group: key, entry: groups[key][0] };
  }
  throw new Error('le candidat doit être dans un groupe');
}

const RECENT_LABEL = 'Déjà contacté par Marie le 03/10/2026';

test('5F2C-11 les libellés de chaque raison sont exacts', async (t) => {
  const m = await loadTs(t, GROUPS);
  if (!m) return;
  assert.deepEqual(m.LABEL_BY_REASON, {
    no_linkedin: 'Sans profil LinkedIn',
    ai_review: "Message rédigé par l'IA à relire avant l'inscription",
    in_sequence: 'Déjà dans cette séquence',
    passed_sequence: 'Déjà passé par cette séquence (terminée, réponse ou arrêt)',
    erased: "A demandé l'effacement de ses données",
    recent_contact: 'Déjà contacté par votre organisation',
    too_far: "Hors de votre réseau LinkedIn, seul un InMail peut l'atteindre",
    connection_only: "Déjà en relation, et la séquence ne contient qu'une invitation",
  });
  assert.deepEqual(m.OVERRIDE_LABEL, { recent_contact: 'Inscrire quand même', incompatible: 'Inclure quand même' });
});

test('5F2C-12 chaque raison place le candidat dans son groupe, avec son libellé', async (t) => {
  const m = await loadTs(t, GROUPS);
  if (!m) return;
  const cases = [
    ['no_linkedin', person('a', { hasLinkedIn: false }), eligibility(), options(), 'incomplete', 'Sans profil LinkedIn'],
    ['in_sequence', person('a'), eligibility({ blocking: [['a', 'in_sequence']] }), options(), 'excluded', 'Déjà dans cette séquence'],
    ['passed_sequence', person('a'), eligibility({ blocking: [['a', 'passed']] }), options(), 'excluded', 'Déjà passé par cette séquence (terminée, réponse ou arrêt)'],
    ['erased', person('a'), eligibility({ erased: ['a'] }), options(), 'excluded', "A demandé l'effacement de ses données"],
    ['recent_contact', person('a'), eligibility({ recent: [['a', RECENT_LABEL]] }), options(), 'excluded', RECENT_LABEL],
    ['too_far', person('a'), eligibility({ incompatible: [['a', 'too_far']] }), options(), 'excluded', "Hors de votre réseau LinkedIn, seul un InMail peut l'atteindre"],
    ['connection_only', person('a'), eligibility({ incompatible: [['a', 'connection_only_already_connected']] }), options(), 'excluded', "Déjà en relation, et la séquence ne contient qu'une invitation"],
    ['ai_review', person('a'), eligibility(), options({ aiReview: true }), 'incomplete', "Message rédigé par l'IA à relire avant l'inscription"],
  ];
  for (const [reason, source, elig, opts, group, label] of cases) {
    const result = classifyOne(m, source, elig, opts);
    assert.equal(result.group, group, `${reason} : groupe`);
    assert.equal(result.entry.reason, reason, `${reason} : raison`);
    assert.equal(result.entry.label, label, `${reason} : libellé`);
    assert.equal(result.entry.source, source, `${reason} : source`);
    assert.equal(result.entry.overridden, false, `${reason} : pas de dérogation en vigueur`);
  }
});

test('5F2C-13 un candidat sans motif est prêt, sans raison ni libellé', async (t) => {
  const m = await loadTs(t, GROUPS);
  if (!m) return;
  const { group, entry } = classifyOne(m, person('a'), eligibility(), options());
  assert.equal(group, 'ready');
  assert.deepEqual({ ...entry, source: undefined }, {
    source: undefined, reason: null, label: null, override: null, overridden: false,
  });
});

test('5F2C-14 ordre des raisons : la première qui s’applique décide', async (t) => {
  const m = await loadTs(t, GROUPS);
  if (!m) return;
  const everything = eligibility({
    blocking: [['a', 'in_sequence']],
    erased: ['a'],
    recent: [['a', RECENT_LABEL]],
    incompatible: [['a', 'too_far']],
  });
  const all = options({ aiReview: true });
  // 1. Sans profil LinkedIn passe avant tout.
  assert.equal(classifyOne(m, person('a', { hasLinkedIn: false }), everything, all).entry.reason, 'no_linkedin');
  // 2. Déjà dans la séquence passe avant l'effacement, le contact récent et le reste.
  assert.equal(classifyOne(m, person('a'), everything, all).entry.reason, 'in_sequence');
  const passed = eligibility({ blocking: [['a', 'passed']], erased: ['a'], recent: [['a', RECENT_LABEL]] });
  assert.equal(classifyOne(m, person('a'), passed, all).entry.reason, 'passed_sequence');
  // 3. L'effacement passe avant le contact récent et l'incompatibilité.
  const erased = eligibility({ erased: ['a'], recent: [['a', RECENT_LABEL]], incompatible: [['a', 'too_far']] });
  assert.equal(classifyOne(m, person('a'), erased, all).entry.reason, 'erased');
  // 4. Le contact récent passe avant l'incompatibilité.
  const both = eligibility({ recent: [['a', RECENT_LABEL]], incompatible: [['a', 'too_far']] });
  assert.equal(classifyOne(m, person('a'), both, all).entry.reason, 'recent_contact');
  // 4 contre 5. Une exclusion l'emporte sur le message à relire.
  const far = eligibility({ incompatible: [['a', 'connection_only_already_connected']] });
  const farResult = classifyOne(m, person('a'), far, all);
  assert.equal(farResult.group, 'excluded');
  assert.equal(farResult.entry.reason, 'connection_only');
  // 5. Sans autre motif, le message à relire place le candidat à compléter.
  assert.equal(classifyOne(m, person('a'), eligibility(), all).group, 'incomplete');
});

test('5F2C-15 le contact récent : dérogation offerte aux seuls propriétaires et administrateurs', async (t) => {
  const m = await loadTs(t, GROUPS);
  if (!m) return;
  const elig = eligibility({ recent: [['a', RECENT_LABEL]] });

  // Sans le droit : exclu, aucune dérogation, même si l'état en garde une.
  for (const overrides of [[], ['recent_contact']]) {
    const { group, entry } = classifyOne(m, person('a'), elig, options({ canOverrideRecent: false, overrides }));
    assert.equal(group, 'excluded');
    assert.equal(entry.override, null);
    assert.equal(entry.overridden, false);
    assert.equal(entry.label, RECENT_LABEL);
  }

  // Avec le droit, avant le choix : exclu, la dérogation est offerte.
  const offered = classifyOne(m, person('a'), elig, options({ canOverrideRecent: true }));
  assert.equal(offered.group, 'excluded');
  assert.equal(offered.entry.override, 'recent_contact');
  assert.equal(offered.entry.overridden, false);

  // Avec le droit et le choix : prêt, inscrit quand même, la raison levée reste écrite.
  const lifted = classifyOne(m, person('a'), elig, options({ canOverrideRecent: true, overrides: ['recent_contact'] }));
  assert.equal(lifted.group, 'ready');
  assert.equal(lifted.entry.overridden, true);
  assert.equal(lifted.entry.reason, 'recent_contact');
  assert.equal(lifted.entry.label, RECENT_LABEL);
  assert.equal(lifted.entry.override, null);

  // La dérogation des incompatibles ne lève pas un contact récent.
  const wrongCategory = classifyOne(m, person('a'), elig, options({ canOverrideRecent: true, overrides: ['incompatible'] }));
  assert.equal(wrongCategory.group, 'excluded');
});

test('5F2C-16 le libellé du contact récent se replie sur « Déjà contacté par votre organisation »', async (t) => {
  const m = await loadTs(t, GROUPS);
  if (!m) return;
  const { entry } = classifyOne(m, person('a'), eligibility({ recent: [['a', '']] }), options());
  assert.equal(entry.reason, 'recent_contact');
  assert.equal(entry.label, 'Déjà contacté par votre organisation');
});

test('5F2C-17 l’incompatibilité : dérogation « Inclure quand même » pour tous, hors réseau comme invitation seule', async (t) => {
  const m = await loadTs(t, GROUPS);
  if (!m) return;
  const cases = [
    ['too_far', 'too_far', "Hors de votre réseau LinkedIn, seul un InMail peut l'atteindre"],
    ['connection_only_already_connected', 'connection_only', "Déjà en relation, et la séquence ne contient qu'une invitation"],
  ];
  for (const [kind, reason, label] of cases) {
    const elig = eligibility({ incompatible: [['a', kind]] });
    // Le droit sur les contacts récents n'est pas nécessaire ici.
    const excluded = classifyOne(m, person('a'), elig, options({ canOverrideRecent: false }));
    assert.equal(excluded.group, 'excluded', reason);
    assert.equal(excluded.entry.override, 'incompatible', reason);
    const lifted = classifyOne(m, person('a'), elig, options({ overrides: ['incompatible'] }));
    assert.equal(lifted.group, 'ready', reason);
    assert.equal(lifted.entry.overridden, true, reason);
    assert.equal(lifted.entry.reason, reason, reason);
    assert.equal(lifted.entry.label, label, reason);
  }
});

test('5F2C-18 aucune dérogation pour « déjà dans la séquence », « déjà passé » et « données effacées »', async (t) => {
  const m = await loadTs(t, GROUPS);
  if (!m) return;
  const everyOverride = options({ canOverrideRecent: true, overrides: ['recent_contact', 'incompatible'] });
  const cases = [
    ['in_sequence', eligibility({ blocking: [['a', 'in_sequence']] })],
    ['passed_sequence', eligibility({ blocking: [['a', 'passed']] })],
    ['erased', eligibility({ erased: ['a'] })],
  ];
  for (const [reason, elig] of cases) {
    const { group, entry } = classifyOne(m, person('a'), elig, everyOverride);
    assert.equal(group, 'excluded', reason);
    assert.equal(entry.reason, reason, reason);
    assert.equal(entry.override, null, reason);
    assert.equal(entry.overridden, false, reason);
  }
});

test('5F2C-19 deux raisons à dérogation dont une seule levée : le candidat reste exclu sur l’autre', async (t) => {
  const m = await loadTs(t, GROUPS);
  if (!m) return;
  const elig = eligibility({ recent: [['a', RECENT_LABEL]], incompatible: [['a', 'too_far']] });

  // Aucune levée : la première raison (contact récent) est portée.
  const none = classifyOne(m, person('a'), elig, options({ canOverrideRecent: true }));
  assert.deepEqual([none.group, none.entry.reason, none.entry.override], ['excluded', 'recent_contact', 'recent_contact']);

  // Le contact récent est levé : reste l'incompatibilité, avec sa dérogation.
  const recentLifted = classifyOne(m, person('a'), elig, options({ canOverrideRecent: true, overrides: ['recent_contact'] }));
  assert.deepEqual(
    [recentLifted.group, recentLifted.entry.reason, recentLifted.entry.override, recentLifted.entry.overridden],
    ['excluded', 'too_far', 'incompatible', false],
  );

  // L'incompatibilité est levée : reste le contact récent.
  const farLifted = classifyOne(m, person('a'), elig, options({ canOverrideRecent: true, overrides: ['incompatible'] }));
  assert.deepEqual(
    [farLifted.group, farLifted.entry.reason, farLifted.entry.override, farLifted.entry.overridden],
    ['excluded', 'recent_contact', 'recent_contact', false],
  );

  // Les deux levées : prêt, inscrit quand même, la première raison reste écrite.
  const both = classifyOne(m, person('a'), elig, options({ canOverrideRecent: true, overrides: ['recent_contact', 'incompatible'] }));
  assert.deepEqual([both.group, both.entry.reason, both.entry.overridden], ['ready', 'recent_contact', true]);

  // Sans le droit sur les contacts récents, lever l'incompatibilité ne suffit pas, et il n'y a pas de dérogation à offrir.
  const noRight = classifyOne(m, person('a'), elig, options({ canOverrideRecent: false, overrides: ['incompatible', 'recent_contact'] }));
  assert.deepEqual([noRight.group, noRight.entry.reason, noRight.entry.override], ['excluded', 'recent_contact', null]);
});

test('5F2C-20 une dérogation levée ne dispense pas du message à relire', async (t) => {
  const m = await loadTs(t, GROUPS);
  if (!m) return;
  const elig = eligibility({ incompatible: [['a', 'too_far']] });
  const { group, entry } = classifyOne(m, person('a'), elig, options({ aiReview: true, overrides: ['incompatible'] }));
  assert.equal(group, 'incomplete');
  assert.equal(entry.reason, 'ai_review');
  assert.equal(entry.overridden, true);
  assert.equal(entry.override, null);
});

test('5F2C-21 chaque groupe garde l’ordre d’entrée, un identifiant en double ne compte qu’une fois (la première entrée)', async (t) => {
  const m = await loadTs(t, GROUPS);
  if (!m) return;
  const entries = [
    person('r1'),
    person('x1'),
    person('c1', { hasLinkedIn: false }),
    person('r2'),
    person('x1', { name: 'Doublon de x1' }),
    person('r1', { name: 'Doublon de r1', hasLinkedIn: false }),
    person('x2'),
    person('c2', { hasLinkedIn: false }),
  ];
  const elig = eligibility({ erased: ['x1', 'x2'] });
  const groups = m.classifyContactEntries(entries, elig, options());
  assert.deepEqual(groups.ready.map((e) => e.source.id), ['r1', 'r2']);
  assert.deepEqual(groups.incomplete.map((e) => e.source.id), ['c1', 'c2']);
  assert.deepEqual(groups.excluded.map((e) => e.source.id), ['x1', 'x2']);
  // La première entrée seule compte : r1 reste prêt (le doublon, sans lien LinkedIn, est ignoré).
  assert.equal(groups.ready[0].source.name, 'Candidat r1');
  assert.equal(groups.excluded[0].source.name, 'Candidat x1');
  // Aucun candidat perdu ni compté deux fois.
  assert.equal(groups.ready.length + groups.incomplete.length + groups.excluded.length, 6);
});

test('5F2C-22 aucune entrée : trois groupes vides, aucune note', async (t) => {
  const m = await loadTs(t, GROUPS);
  if (!m) return;
  assert.deepEqual(m.classifyContactEntries([], eligibility(), options()), { ready: [], incomplete: [], excluded: [], notes: [] });
});

test('5F2C-23 le classement ne modifie ni la liste d’entrée ni l’éligibilité', async (t) => {
  const m = await loadTs(t, GROUPS);
  if (!m) return;
  const entries = [person('a'), person('b', { hasLinkedIn: false })];
  const snapshot = JSON.stringify(entries);
  const elig = eligibility({ recent: [['a', RECENT_LABEL]], warnings: [['a', 'inmail_wasted']] });
  const opts = options({ canOverrideRecent: true, overrides: ['recent_contact'] });
  m.classifyContactEntries(entries, elig, opts);
  assert.equal(JSON.stringify(entries), snapshot);
  assert.equal(elig.recent.size, 1);
  assert.equal(elig.warnings.size, 1);
  assert.equal(opts.overrides.size, 1);
});

test('5F2C-24 notes : une phrase par avertissement, avec le nombre, pour les candidats prêts seulement', async (t) => {
  const m = await loadTs(t, GROUPS);
  if (!m) return;
  const entries = [person('a'), person('b'), person('c'), person('d'), person('e'), person('f', { hasLinkedIn: false })];
  const elig = eligibility({
    warnings: [
      ['a', 'inmail_wasted'],
      ['b', 'connection_already_connected'],
      ['c', 'connection_already_connected'],
      ['d', 'connection_already_connected'],
      ['e', 'inmail_wasted'],
      ['f', 'connection_already_connected'], // incomplet : non compté
      ['inconnu', 'connection_already_connected'], // pas dans la sélection : non compté
    ],
    erased: ['e'], // exclu : non compté
  });
  const groups = m.classifyContactEntries(entries, elig, options());
  assert.deepEqual(groups.notes, [
    "3 candidats déjà en relation : l'invitation sera sautée, les messages suivants partiront.",
    "1 candidat déjà en relation : un message direct serait gratuit, l'InMail consomme un crédit.",
  ]);
});

test('5F2C-25 notes : ordre stable quel que soit l’ordre des candidats, une seule phrase si un seul type', async (t) => {
  const m = await loadTs(t, GROUPS);
  if (!m) return;
  const entries = [person('a'), person('b')];
  const direct = m.classifyContactEntries(entries, eligibility({
    warnings: [['a', 'inmail_wasted'], ['b', 'connection_already_connected']],
  }), options());
  const reversed = m.classifyContactEntries([...entries].reverse(), eligibility({
    warnings: [['b', 'connection_already_connected'], ['a', 'inmail_wasted']],
  }), options());
  assert.deepEqual(direct.notes, reversed.notes);
  assert.equal(direct.notes.length, 2);
  assert.match(direct.notes[0], /l'invitation sera sautée/);
  assert.match(direct.notes[1], /l'InMail consomme un crédit/);

  const single = m.classifyContactEntries(entries, eligibility({ warnings: [['a', 'connection_already_connected']] }), options());
  assert.deepEqual(single.notes, ["1 candidat déjà en relation : l'invitation sera sautée, les messages suivants partiront."]);
  const none = m.classifyContactEntries(entries, eligibility(), options());
  assert.deepEqual(none.notes, []);
});

test('5F2C-26 notes : un candidat prêt grâce à une dérogation compte, un candidat à relire ne compte pas', async (t) => {
  const m = await loadTs(t, GROUPS);
  if (!m) return;
  const entries = [person('a')];
  const elig = eligibility({ recent: [['a', RECENT_LABEL]], warnings: [['a', 'inmail_wasted']] });
  const lifted = m.classifyContactEntries(entries, elig, options({ canOverrideRecent: true, overrides: ['recent_contact'] }));
  assert.equal(lifted.notes.length, 1);
  const review = m.classifyContactEntries(entries, eligibility({ warnings: [['a', 'inmail_wasted']] }), options({ aiReview: true }));
  assert.deepEqual(review.notes, []);
});

test('5F2C-27 contactSummary : zéros omis, accords, séparateur point médian', async (t) => {
  const m = await loadTs(t, GROUPS);
  if (!m) return;
  const group = (n) => Array.from({ length: n }, (_, i) => ({ source: person(`p${i}`), reason: null, label: null, override: null, overridden: false }));
  const summary = (ready, incomplete, excluded) => m.contactSummary({ ready: group(ready), incomplete: group(incomplete), excluded: group(excluded), notes: [] });
  assert.equal(summary(2, 1, 2), `2 prêts ${MIDDLE_DOT} 1 à compléter ${MIDDLE_DOT} 2 exclus`);
  assert.equal(summary(1, 3, 1), `1 prêt ${MIDDLE_DOT} 3 à compléter ${MIDDLE_DOT} 1 exclu`);
  assert.equal(summary(0, 1, 2), `1 à compléter ${MIDDLE_DOT} 2 exclus`);
  assert.equal(summary(2, 0, 2), `2 prêts ${MIDDLE_DOT} 2 exclus`);
  assert.equal(summary(2, 1, 0), `2 prêts ${MIDDLE_DOT} 1 à compléter`);
  assert.equal(summary(1, 0, 0), '1 prêt');
  assert.equal(summary(0, 0, 1), '1 exclu');
  assert.equal(summary(0, 4, 0), '4 à compléter');
  assert.equal(summary(0, 0, 0), 'Aucun candidat');
  // Le séparateur est bien U+00B7 entouré d'espaces.
  assert.ok(summary(1, 1, 1).includes(` ${MIDDLE_DOT} `));
});

test('5F2C-28 contactSummary lit le résultat du classement', async (t) => {
  const m = await loadTs(t, GROUPS);
  if (!m) return;
  const entries = [person('a'), person('b'), person('c', { hasLinkedIn: false }), person('d'), person('e')];
  const groups = m.classifyContactEntries(entries, eligibility({ erased: ['d', 'e'] }), options());
  assert.equal(m.contactSummary(groups), `2 prêts ${MIDDLE_DOT} 1 à compléter ${MIDDLE_DOT} 2 exclus`);
});

// ---------------------------------------------------------------------------
// quotaGauge
// ---------------------------------------------------------------------------

const figures = (extra = {}) => ({
  usedToday: 0,
  capToday: 100,
  usedWeekInvitations: 0,
  capWeekInvitations: 100,
  ...extra,
});

test('5F2C-29 gaugeKindOf : invitation = invitations, message = actions, tout le reste (InMail compris) = null', async (t) => {
  const m = await loadTs(t, GAUGE);
  if (!m) return;
  assert.equal(m.gaugeKindOf('connection_request'), 'invitations');
  assert.equal(m.gaugeKindOf('message'), 'actions');
  for (const type of ['inmail', 'smart_message', 'profile_visit', 'check_connection', 'wait_connection', 'wait_reply', 'wait_profile_visit', 'email', 'whatsapp_message', 'endorse', '', 'Message']) {
    assert.equal(m.gaugeKindOf(type), null, `« ${type} »`);
  }
  assert.equal(m.gaugeKindOf(null), null);
  assert.equal(m.gaugeKindOf(undefined), null);
});

test('5F2C-30 seuils du niveau : 79 ok, 80 attention, 94 attention, 95 critique', async (t) => {
  const m = await loadTs(t, GAUGE);
  if (!m) return;
  const levelAt = (percent, type = 'message') => {
    // Plafond de 100 : la part utilisée après inscription vaut used + count.
    const gauge = m.quotaGauge(type, figures({ usedToday: percent - 1, usedWeekInvitations: percent - 1 }), 1);
    return [gauge.percent, gauge.level];
  };
  for (const type of ['message', 'connection_request']) {
    assert.deepEqual(levelAt(79, type), [79, 'ok'], type);
    assert.deepEqual(levelAt(80, type), [80, 'warning'], type);
    assert.deepEqual(levelAt(94, type), [94, 'warning'], type);
    assert.deepEqual(levelAt(95, type), [95, 'critical'], type);
    assert.deepEqual(levelAt(100, type), [100, 'critical'], type);
  }
  assert.equal(m.GAUGE_WARNING_PERCENT, 80);
  assert.equal(m.GAUGE_CRITICAL_PERCENT, 95);
});

test('5F2C-31 le pourcentage tient compte de l’inscription, est arrondi sans dérive et plafonné à 100', async (t) => {
  const m = await loadTs(t, GAUGE);
  if (!m) return;
  // 22 utilisés + 1 = 23 sur 40 = 57,5 % : arrondi à 58 (sans dérive de virgule flottante).
  assert.equal(m.quotaGauge('message', figures({ usedToday: 22, capToday: 40 }), 1).percent, 58);
  // 29 sur 200 = 14,5 % : 15.
  assert.equal(m.quotaGauge('message', figures({ usedToday: 28, capToday: 200 }), 1).percent, 15);
  // Dépassement : plafonné à 100.
  const over = m.quotaGauge('message', figures({ usedToday: 90, capToday: 100 }), 50);
  assert.equal(over.percent, 100);
  assert.equal(over.level, 'critical');
  // Compteur déjà au-delà du plafond : plus rien de possible, 100 %.
  const exceeded = m.quotaGauge('message', figures({ usedToday: 130, capToday: 100 }), 1);
  assert.equal(exceeded.remaining, 0);
  assert.equal(exceeded.percent, 100);
});

test('5F2C-32 chaque sorte lit ses propres chiffres', async (t) => {
  const m = await loadTs(t, GAUGE);
  if (!m) return;
  const f = figures({ usedToday: 10, capToday: 80, usedWeekInvitations: 60, capWeekInvitations: 100 });
  const invitations = m.quotaGauge('connection_request', f, 5);
  assert.deepEqual(
    { kind: invitations.kind, used: invitations.used, cap: invitations.cap, remaining: invitations.remaining },
    { kind: 'invitations', used: 60, cap: 100, remaining: 40 },
  );
  const actions = m.quotaGauge('message', f, 5);
  assert.deepEqual(
    { kind: actions.kind, used: actions.used, cap: actions.cap, remaining: actions.remaining },
    { kind: 'actions', used: 10, cap: 80, remaining: 70 },
  );
  // Un InMail n'a pas de jauge : son plafond du jour et ses crédits ne sont pas ceux des actions visibles.
  assert.equal(m.quotaGauge('inmail', f, 5), null);
  assert.equal(m.quotaGauge('smart_message', f, 5), null);
});

test('5F2C-33 textes exacts de la jauge, jamais de « N / M »', async (t) => {
  const m = await loadTs(t, GAUGE);
  if (!m) return;
  const f = figures({ usedToday: 77, capToday: 80, usedWeekInvitations: 88, capWeekInvitations: 100 });
  assert.equal(m.quotaGauge('connection_request', f, 1).text, '12 invitations possibles cette semaine');
  assert.equal(m.quotaGauge('message', f, 1).text, "3 actions possibles aujourd'hui");
  const one = figures({ usedToday: 79, capToday: 80, usedWeekInvitations: 99, capWeekInvitations: 100 });
  assert.equal(m.quotaGauge('connection_request', one, 1).text, '1 invitation possible cette semaine');
  assert.equal(m.quotaGauge('message', one, 1).text, "1 action possible aujourd'hui");
  const reached = figures({ usedToday: 80, capToday: 80, usedWeekInvitations: 100, capWeekInvitations: 100 });
  assert.equal(m.quotaGauge('connection_request', reached, 1).text, "Plafond d'invitations atteint pour cette semaine");
  assert.equal(m.quotaGauge('message', reached, 1).text, "Plafond d'actions atteint pour aujourd'hui");

  // Aucun texte ne contient « / » : ni « 0 / N », ni « N / M ».
  for (const type of ['connection_request', 'message']) {
    for (const g of [figures(), f, one, reached]) {
      for (const count of [1, 5, 500]) {
        const gauge = m.quotaGauge(type, g, count);
        assert.ok(!gauge.text.includes('/'), `${type} ${count} : ${gauge.text}`);
        if (gauge.warning) assert.ok(!gauge.warning.includes('/'), `${type} ${count} : ${gauge.warning}`);
      }
    }
  }
});

test('5F2C-34 avertissement : absent tant que tout tient, annonce le report sinon', async (t) => {
  const m = await loadTs(t, GAUGE);
  if (!m) return;
  const f = figures({ usedToday: 77, capToday: 80, usedWeekInvitations: 88, capWeekInvitations: 100 });
  // count <= remaining : pas d'avertissement, à la limite comprise.
  assert.equal(m.quotaGauge('connection_request', f, 12).warning, null);
  assert.equal(m.quotaGauge('connection_request', f, 1).warning, null);
  assert.equal(m.quotaGauge('message', f, 3).warning, null);
  // Il reste 12 invitations, 15 candidats : 3 reportés.
  assert.equal(
    m.quotaGauge('connection_request', f, 15).warning,
    '3 candidats seront reportés automatiquement : le plafond LinkedIn sera atteint.',
  );
  // Un seul de trop : singulier.
  assert.equal(
    m.quotaGauge('message', f, 4).warning,
    '1 candidat sera reporté automatiquement : le plafond LinkedIn sera atteint.',
  );
  // Plafond déjà atteint : tous les candidats sont reportés.
  const reached = figures({ usedToday: 80, capToday: 80, usedWeekInvitations: 100, capWeekInvitations: 100 });
  assert.equal(m.quotaGauge('message', reached, 1).warning, 'Plafond atteint : 1 candidat sera reporté automatiquement.');
  assert.equal(m.quotaGauge('connection_request', reached, 7).warning, 'Plafond atteint : 7 candidats seront reportés automatiquement.');
});

test('5F2C-35 la jauge n’existe pas sans envoi, sans candidat ou sans plafond connu', async (t) => {
  const m = await loadTs(t, GAUGE);
  if (!m) return;
  // Première action sans envoi.
  for (const type of ['profile_visit', 'wait_connection', 'email', null, undefined, '']) {
    assert.equal(m.quotaGauge(type, figures(), 5), null, `type ${String(type)}`);
  }
  // Aucun candidat.
  assert.equal(m.quotaGauge('message', figures(), 0), null);
  assert.equal(m.quotaGauge('message', figures(), -3), null);
  assert.equal(m.quotaGauge('message', figures(), Number.NaN), null);
  // Plafond nul, négatif ou illisible : pas de jauge (la sorte voisine n'y change rien).
  assert.equal(m.quotaGauge('message', figures({ capToday: 0 }), 1), null);
  assert.equal(m.quotaGauge('message', figures({ capToday: -5 }), 1), null);
  assert.equal(m.quotaGauge('message', figures({ capToday: Number.NaN }), 1), null);
  assert.equal(m.quotaGauge('message', figures({ capToday: undefined }), 1), null);
  assert.equal(m.quotaGauge('message', figures({ capToday: '80' }), 1), null);
  assert.equal(m.quotaGauge('connection_request', figures({ capWeekInvitations: 0 }), 1), null);
  assert.equal(m.quotaGauge('connection_request', figures({ capWeekInvitations: 0, capToday: 80 }), 1), null);
  assert.equal(m.quotaGauge('message', figures({ capWeekInvitations: 0 }), 1)?.kind, 'actions');
});

test('5F2C-36 un compteur illisible compte pour zéro, jamais négatif', async (t) => {
  const m = await loadTs(t, GAUGE);
  if (!m) return;
  const unreadable = m.quotaGauge('message', figures({ usedToday: undefined, capToday: 50 }), 1);
  assert.equal(unreadable.used, 0);
  assert.equal(unreadable.remaining, 50);
  const negative = m.quotaGauge('message', figures({ usedToday: -4, capToday: 50 }), 1);
  assert.equal(negative.used, 0);
  assert.equal(negative.remaining, 50);
});

test('5F2C-37 modèle complet pour un cas courant', async (t) => {
  const m = await loadTs(t, GAUGE);
  if (!m) return;
  assert.deepEqual(m.quotaGauge('connection_request', figures({ usedWeekInvitations: 90, capWeekInvitations: 100 }), 4), {
    kind: 'invitations',
    remaining: 10,
    cap: 100,
    used: 90,
    count: 4,
    percent: 94,
    level: 'warning',
    text: '10 invitations possibles cette semaine',
    warning: null,
  });
  assert.deepEqual(m.quotaGauge('message', figures({ usedToday: 78, capToday: 80 }), 5), {
    kind: 'actions',
    remaining: 2,
    cap: 80,
    used: 78,
    count: 5,
    percent: 100,
    level: 'critical',
    text: "2 actions possibles aujourd'hui",
    warning: '3 candidats seront reportés automatiquement : le plafond LinkedIn sera atteint.',
  });
});

// ---------------------------------------------------------------------------
// Vocabulaire des textes produits
// ---------------------------------------------------------------------------

test('5F2C-38 textes produits : français, pas de jargon technique anglais, pas de nom de prestataire', async (t) => {
  const g = await loadTs(t, GROUPS);
  const q = await loadTs(t, GAUGE);
  if (!g || !q) return;
  const texts = [
    ...Object.values(g.LABEL_BY_REASON),
    ...Object.values(g.OVERRIDE_LABEL),
    g.contactSummary({ ready: [], incomplete: [], excluded: [], notes: [] }),
  ];
  const warned = g.classifyContactEntries(
    [person('a'), person('b')],
    eligibility({ warnings: [['a', 'connection_already_connected'], ['b', 'inmail_wasted']] }),
    options(),
  );
  texts.push(...warned.notes);
  const reached = figures({ usedToday: 80, capToday: 80, usedWeekInvitations: 100, capWeekInvitations: 100 });
  for (const type of ['connection_request', 'message']) {
    for (const f of [figures(), reached]) {
      const gauge = q.quotaGauge(type, f, 3);
      texts.push(gauge.text);
      if (gauge.warning) texts.push(gauge.warning);
    }
  }
  assert.ok(texts.length > 15);
  for (const text of texts) {
    assert.doesNotMatch(text, /\b(step|preview|enrollment|template|sender|batch|workflow|override)\b/i, text);
    assert.doesNotMatch(text, /\b(Unipile|Apollo|PDL|People Data Labs|Anthropic|Claude|Notion)\b/, text);
    assert.ok(!text.includes(EM_DASH), text);
    assert.doesNotMatch(text, /\(s\)/, text);
    assert.equal(text, text.trim(), text);
  }
});

// ---------------------------------------------------------------------------
// Gardes de source des trois fichiers
// ---------------------------------------------------------------------------

const SOURCES = [
  ['missionSequencePick.ts', read(PICK)],
  ['contactFlowGroups.ts', read(GROUPS)],
  ['quotaGauge.ts', read(GAUGE)],
];

/** Chaque module cité par un import ou un export ... from, ou par un import() dynamique. */
function specifiers(source) {
  const found = [];
  for (const match of source.matchAll(/\b(?:import|export)\b[^;'"`]*?\bfrom\s*['"]([^'"]+)['"]/g)) found.push(match[1]);
  for (const match of source.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) found.push(match[1]);
  for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(match[1]);
  return found;
}

test('5F2C-39 gardes de source : aucun tiret long, aucun « (s) », aucun nom de prestataire', () => {
  for (const [name, source] of SOURCES) {
    assert.ok(!source.includes(EM_DASH), `${name} : pas de tiret long, commentaires compris`);
    assert.doesNotMatch(source, /\(s\)/, `${name} : accorder par le nombre`);
    assert.doesNotMatch(source, /\b(Unipile|Apollo|PDL|People Data Labs|Anthropic|Claude|Notion)\b/, `${name} : nom de prestataire`);
  }
});

test('5F2C-40 gardes de source : imports relatifs avec l’extension .ts seulement, ni react ni « @/ »', () => {
  for (const [name, source] of SOURCES) {
    for (const specifier of specifiers(source)) {
      assert.match(specifier, /^\.\/[A-Za-z0-9_-]+\.ts$/, `${name} : import « ${specifier} » (chemin relatif avec .ts attendu)`);
    }
    assert.doesNotMatch(source, /from\s*['"]react(?:\/[^'"]*)?['"]/, `${name} : pas de react`);
    assert.doesNotMatch(source, /from\s*['"]@\//, `${name} : pas d'alias « @/ »`);
    assert.doesNotMatch(source, /['"]@\//, `${name} : pas d'alias « @/ »`);
  }
  // Les pluriels passent par plural, importé (jamais redéfini).
  for (const [name, source] of SOURCES) {
    assert.doesNotMatch(source, /function plural\(|const plural\s*=/, `${name} : pas de plural local`);
    if (/\bplural\(/.test(source)) {
      assert.match(source, /import \{ plural \} from '\.\/plural\.ts';/, `${name} : plural vient de ./plural.ts`);
    }
  }
  // missionSequencePick n'importe rien.
  assert.deepEqual(specifiers(SOURCES[0][1]), []);
});

test('5F2C-41 gardes de source : aucun any, aucun @ts-ignore, aucune syntaxe que Node ne sait pas lire sans compilation', () => {
  for (const [name, source] of SOURCES) {
    assert.doesNotMatch(source, /:\s*any\b|<any>|\bas any\b|\bany\[\]/, `${name} : pas de any`);
    assert.doesNotMatch(source, /@ts-ignore|@ts-expect-error|@ts-nocheck/, `${name} : pas de directive TypeScript`);
    // Le retrait des types de Node refuse les enums, espaces de noms et propriétés de paramètres.
    assert.doesNotMatch(source, /^\s*(?:export\s+)?(?:const\s+)?enum\s/m, `${name} : pas d'enum`);
    assert.doesNotMatch(source, /^\s*(?:export\s+)?namespace\s/m, `${name} : pas de namespace`);
    assert.doesNotMatch(source, /constructor\s*\(\s*(?:public|private|protected|readonly)\b/, `${name} : pas de propriété de paramètre`);
  }
});

test('5F2C-42 gardes de source : aucune lecture ni écriture, aucun effet de bord', () => {
  for (const [name, source] of SOURCES) {
    assert.doesNotMatch(source, /\bsupabase\b|\bfetch\(|\blocalStorage\b|\bsessionStorage\b|\bwindow\b|\bdocument\b|console\./, `${name} : module pur`);
  }
});
