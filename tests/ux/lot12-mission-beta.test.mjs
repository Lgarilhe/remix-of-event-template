/**
 * Refonte mission, lots 1 et 2 : interrupteur de la nouvelle page mission et
 * correspondance des adresses (src/lib/missionBeta.ts), règles partagées de la
 * nouvelle page (src/components/missions/v3/types.ts). Fonctions pures.
 *
 * Modules empaquetés par esbuild (alias @/ résolus par tsconfig.app.json),
 * client Supabase remplacé par un module vide.
 * Lancer : node --test tests/ux/lot12-mission-beta.test.mjs (ou npm run test:ux)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = new URL('../../', import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

const stubs = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'stub' }));
    b.onResolve({ filter: /^(react|@tanstack\/react-query)$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: [
        'export const supabase = { rpc: () => ({}) };',
        'export const useMemo = (f) => f();',
        'export const useQuery = (o) => o;',
        'export const createContext = (v) => ({ v });',
        'export const useContext = (c) => c.v;',
      ].join('\n'),
      loader: 'js',
    }));
  },
};

const load = async (rel) => {
  const { outputFiles } = await build({
    entryPoints: [join(ROOT_PATH, rel)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    tsconfig: join(ROOT_PATH, 'tsconfig.app.json'),
    plugins: [stubs],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
};

const beta = await load('src/lib/missionBeta.ts');
const v3 = await load('src/components/missions/v3/types.ts');

const ID = '4a1b2c3d-0000-4000-8000-0000000000aa';
const STEP_A = '4a1b2c3d-0000-4000-8000-00000000000a';
const STEP_B = '4a1b2c3d-0000-4000-8000-00000000000b';
const STEPS = [
  { id: STEP_B, name: 'Entretien DG', step_order: 2 },
  { id: STEP_A, name: 'Qualification', step_order: 1 },
];

/** Stockage local simulé ; `fail` fait lever chaque accès. */
function memoryStorage({ fail = false, initial = {} } = {}) {
  const data = new Map(Object.entries(initial));
  const guard = () => { if (fail) throw new Error('SecurityError'); };
  return {
    data,
    getItem: (k) => { guard(); return data.has(k) ? data.get(k) : null; },
    setItem: (k, v) => { guard(); data.set(k, String(v)); },
    removeItem: (k) => { guard(); data.delete(k); },
  };
}

// ------------------------------------------------------------ interrupteur
test('lot12 : clé konekt.mission-v3, paramètre nouvelle-mission', () => {
  assert.equal(beta.MISSION_BETA_STORAGE_KEY, 'konekt.mission-v3');
  assert.equal(beta.MISSION_BETA_PARAM, 'nouvelle-mission');
});

test('lot12 : lecture protégée, éteint par défaut', () => {
  assert.equal(beta.readMissionBeta(memoryStorage()), false);
  assert.equal(beta.readMissionBeta(memoryStorage({ initial: { 'konekt.mission-v3': '1' } })), true);
  assert.equal(beta.readMissionBeta(memoryStorage({ initial: { 'konekt.mission-v3': 'true' } })), false);
  assert.equal(beta.readMissionBeta(memoryStorage({ fail: true })), false, 'stockage refusé : éteint, sans erreur');
  assert.equal(beta.readMissionBeta(null), false);
  assert.equal(beta.readMissionBeta(), false, 'hors navigateur : éteint');
});

test('lot12 : écriture protégée, éteindre retire la clé', () => {
  const s = memoryStorage();
  assert.equal(beta.writeMissionBeta(true, s), true);
  assert.equal(s.data.get('konekt.mission-v3'), '1');
  assert.equal(beta.writeMissionBeta(false, s), true);
  assert.equal(s.data.has('konekt.mission-v3'), false);
  assert.equal(beta.writeMissionBeta(true, memoryStorage({ fail: true })), false, 'refus rendu, jamais levé');
});

test('lot12 : magasin du module, abonnés prévenus une fois par changement', () => {
  beta.resetMissionBetaForTests();
  assert.equal(beta.getMissionBeta(), false);
  let calls = 0;
  const off = beta.subscribeMissionBeta(() => { calls += 1; });
  beta.setMissionBeta(true);
  assert.equal(beta.getMissionBeta(), true, 'vaut pour la session même sans stockage');
  beta.setMissionBeta(true);
  assert.equal(calls, 1, 'même valeur : aucune notification');
  beta.setMissionBeta(false);
  assert.equal(calls, 2);
  off();
  beta.setMissionBeta(true);
  assert.equal(calls, 2, 'désabonné');
  beta.resetMissionBetaForTests();
});

test('lot12 : ?nouvelle-mission=1 allume, =0 éteint, puis le paramètre est retiré', () => {
  assert.equal(beta.missionBetaParam('?nouvelle-mission=1'), true);
  assert.equal(beta.missionBetaParam('?tab=brief&nouvelle-mission=0'), false);
  assert.equal(beta.missionBetaParam('?nouvelle-mission=oui'), null);
  assert.equal(beta.missionBetaParam(''), null);
  assert.equal(beta.withoutMissionBetaParam('?nouvelle-mission=1'), '');
  assert.equal(beta.withoutMissionBetaParam('?tab=brief&nouvelle-mission=1&x=2'), '?tab=brief&x=2');
  assert.equal(beta.withoutMissionBetaParam(''), '');
});

// ---------------------------------------------------------------- adresses
test('lot12 : chemins de mission, sous-chemins compris', () => {
  assert.deepEqual(beta.parseMissionPath(`/missions/${ID}`), { id: ID, screen: 'pipeline', sub: '' });
  assert.deepEqual(beta.parseMissionPath(`/missions/${ID}/sourcing`), { id: ID, screen: 'sourcing', sub: 'sourcing' });
  assert.deepEqual(beta.parseMissionPath(`/missions/${ID}/cadrage/`), { id: ID, screen: 'cadrage', sub: 'cadrage' });
  assert.deepEqual(beta.parseMissionPath(`/missions/${ID}/xyz`), { id: ID, screen: null, sub: 'xyz' });
  assert.equal(beta.parseMissionPath('/missions'), null);
  assert.equal(beta.parseMissionPath('/missions/'), null);
  assert.equal(beta.parseMissionPath(`/missions/${ID}/a/b`), null);
  assert.equal(beta.parseMissionPath('/pipeline'), null);
  assert.equal(beta.missionIdFromPath(`/missions/${ID}/sourcing`), ID);
  assert.equal(beta.missionIdFromPath('/sourcing/abc'), null);
});

test('lot12 : chemins de la nouvelle page', () => {
  assert.equal(beta.missionV3Path(ID), `/missions/${ID}`);
  assert.equal(beta.missionV3Path(ID, 'sourcing'), `/missions/${ID}/sourcing`);
  assert.equal(beta.missionV3Path(ID, 'cadrage', { section: 'etapes', vide: null }), `/missions/${ID}/cadrage?section=etapes`);
  assert.equal(beta.missionV3Path('a b'), '/missions/a%20b');
});

test('lot12 : lecture de l\'adresse de la nouvelle page', () => {
  const loc = beta.readMissionV3Location(`/missions/${ID}`, '?panneau=fiche&candidat=r1&bilan=1&vue=etapes&etape=replied');
  assert.deepEqual(loc, {
    id: ID, screen: 'pipeline', panel: 'fiche', candidateRowId: 'r1', bilan: true,
    section: null, view: 'etapes', stage: 'replied',
  });
  const ficheSansLigne = beta.readMissionV3Location(`/missions/${ID}`, '?panneau=fiche');
  assert.equal(ficheSansLigne.panel, null, 'fiche sans candidat : aucun panneau');
  assert.equal(beta.readMissionV3Location(`/missions/${ID}`, '?panneau=contact&candidat=r1').candidateRowId, null);
  assert.equal(beta.readMissionV3Location(`/missions/${ID}/cadrage`, '?section=reglages').section, 'reglages');
  assert.equal(beta.readMissionV3Location(`/missions/${ID}/cadrage`, '?section=autre').section, null);
  assert.equal(beta.readMissionV3Location(`/missions/${ID}/xyz`, '').screen, 'pipeline');
  assert.equal(beta.readMissionV3Location(`/missions/${ID}`, '').view, 'liste');
  assert.equal(beta.readMissionV3Location('/missions', ''), null);
});

test('lot12 : anciens ?tab= vers la nouvelle page (interrupteur allumé)', () => {
  const to = (search, path = `/missions/${ID}`) => beta.legacyToV3Target(path, search);
  assert.equal(to('?tab=overview'), `/missions/${ID}`);
  assert.equal(to('?tab=pipeline'), `/missions/${ID}`);
  assert.equal(to('?tab=insights'), `/missions/${ID}?bilan=1`);
  assert.equal(to('?tab=outreach&outreach=invitations'), `/missions/${ID}?outreach=invitations&panneau=contact`);
  assert.equal(to('?tab=sourcing'), `/missions/${ID}/sourcing`);
  assert.equal(to('?tab=brief'), `/missions/${ID}/cadrage?section=poste`);
  assert.equal(to('?tab=process'), `/missions/${ID}/cadrage?section=etapes`);
  assert.equal(to('?tab=config'), `/missions/${ID}/cadrage?section=reglages`);
  assert.equal(to('?tab=inconnu&score=x'), `/missions/${ID}?score=x`, 'autres paramètres gardés');
  assert.equal(to(''), null, 'adresse déjà bonne');
  assert.equal(to('?panneau=contact'), null);
  assert.equal(to('', `/missions/${ID}/sourcing`), null);
  assert.equal(to('?x=1', `/missions/${ID}/xyz`), `/missions/${ID}?x=1`, 'sous-chemin inconnu : Pipeline');
  assert.equal(to('?tab=brief', '/missions'), null);
});

test('lot12 : nouvelles adresses vers ?tab= (interrupteur éteint)', () => {
  const to = (path, search = '') => beta.v3ToLegacyTarget(path, search);
  assert.equal(to(`/missions/${ID}`), null, 'ancienne adresse : rien ne change');
  assert.equal(to(`/missions/${ID}`, '?tab=brief'), null);
  assert.equal(to(`/missions/${ID}/sourcing`), `/missions/${ID}?tab=sourcing`);
  assert.equal(to(`/missions/${ID}/cadrage`), `/missions/${ID}?tab=brief`);
  assert.equal(to(`/missions/${ID}/cadrage`, '?section=etapes'), `/missions/${ID}?tab=process`);
  assert.equal(to(`/missions/${ID}/cadrage`, '?section=reglages'), `/missions/${ID}?tab=config`);
  assert.equal(to(`/missions/${ID}`, '?panneau=contact'), `/missions/${ID}?tab=outreach`);
  assert.equal(to(`/missions/${ID}`, '?bilan=1'), `/missions/${ID}?tab=insights`);
  assert.equal(to(`/missions/${ID}`, '?panneau=fiche&candidat=r1'), `/missions/${ID}?tab=pipeline`);
  assert.equal(to(`/missions/${ID}`, '?vue=etapes&x=1'), `/missions/${ID}?x=1&tab=pipeline`);
  assert.equal(to(`/missions/${ID}/xyz`, '?x=1'), `/missions/${ID}?x=1`, 'sous-chemin inconnu : Vue d\'ensemble');
  assert.equal(to(`/missions/${ID}/sourcing`, '?tab=brief'), `/missions/${ID}?tab=brief`, 'un ?tab= présent l\'emporte');
  assert.equal(to('/pipeline', '?bilan=1'), null);
});

test('lot12 : aller et retour sans perte pour les vues qui existent des deux côtés', () => {
  for (const [tab, back] of [['sourcing', 'sourcing'], ['brief', 'brief'], ['process', 'process'], ['config', 'config'],
    ['outreach', 'outreach'], ['insights', 'insights']]) {
    const v3Url = new URL(beta.legacyToV3Target(`/missions/${ID}`, `?tab=${tab}`), 'https://x');
    const legacy = beta.v3ToLegacyTarget(v3Url.pathname, v3Url.search);
    assert.equal(new URL(legacy, 'https://x').searchParams.get('tab'), back, tab);
  }
});

test('lot12 : dernières vues gardées dans l\'ancien vocabulaire', () => {
  assert.equal(beta.screenToVisitView('pipeline'), 'pipeline');
  assert.equal(beta.screenToVisitView('sourcing'), 'sourcing');
  assert.equal(beta.screenToVisitView('cadrage'), 'brief');
  for (const [v, s] of [[null, 'pipeline'], ['overview', 'pipeline'], ['pipeline', 'pipeline'], ['insights', 'pipeline'],
    ['outreach', 'pipeline'], ['sourcing', 'sourcing'], ['brief', 'cadrage'], ['process', 'cadrage'], ['config', 'cadrage'],
    ['cadrage', 'cadrage'], ['x', 'pipeline']]) {
    assert.equal(beta.visitViewToScreen(v), s, String(v));
  }
  assert.equal(beta.missionV3PathFromVisit(ID, 'process'), `/missions/${ID}/cadrage`);
  assert.equal(beta.missionV3PathFromVisit(ID, null), `/missions/${ID}`);
});

test('lot12 : une seule clé de page par mission, /settings inchangé', () => {
  assert.equal(beta.pageTransitionKey(`/missions/${ID}`), `/missions/${ID}`);
  assert.equal(beta.pageTransitionKey(`/missions/${ID}/sourcing`), `/missions/${ID}`);
  assert.equal(beta.pageTransitionKey(`/missions/${ID}/cadrage`), `/missions/${ID}`);
  assert.equal(beta.pageTransitionKey('/settings/org/team'), '/settings');
  assert.equal(beta.pageTransitionKey('/missions'), '/missions');
  assert.equal(beta.pageTransitionKey('/pipeline'), '/pipeline');
});

// ---------------------------------------------------------- lignes (v3/types)
const rawRow = (over = {}) => ({
  id: 'r1', group_ids: ['r2', 'r1'], group_size: 2, candidate_id: 'c1', candidate_name: 'Camille Martin',
  candidate_headline: 'DAF', linkedin_profile_url: 'https://www.linkedin.com/in/cm', general_stage: 'contacted',
  process_step_id: null, stage_entered_at: '2026-09-20T10:00:00.000000+00:00', decision_source: 'user', score: '81',
  recommendation: 'go', tags: ['a', 3], ...over,
});

test('lot12 : ligne de la vue vers MissionCandidateRow', () => {
  const row = v3.toMissionCandidateRow(rawRow());
  assert.equal(row.id, 'r1');
  assert.deepEqual(row.groupIds, ['r2', 'r1']);
  assert.equal(row.groupSize, 2);
  assert.equal(row.stage, 'contacted');
  assert.equal(row.score, 81);
  assert.deepEqual(row.tags, ['a']);
  assert.equal(row.stageEnteredAt, '2026-09-20T10:00:00.000000+00:00', 'date gardée en chaîne');
  assert.deepEqual(v3.toMissionCandidateRow(rawRow({ group_ids: null, group_size: null })).groupIds, ['r1']);
  assert.deepEqual(v3.toMissionCandidateRow(rawRow({ group_ids: ['r3'] })).groupIds, ['r1', 'r3'], 'la ligne canonique est toujours écrite');
  assert.equal(v3.toMissionCandidateRow(rawRow({ general_stage: 'shortlisted' })).stage, 'to_sort');
  assert.equal(v3.toMissionCandidateRow(rawRow({ decision_source: 'robot' })).decisionSource, null);
  assert.equal(v3.toMissionCandidateRow(rawRow({ score: null })).score, null);
  assert.equal(v3.toMissionCandidateRow({ candidate_id: 'c1' }), null);
  assert.equal(v3.toMissionCandidateRow(null), null);
  const detail = v3.toMissionCandidateDetailRow(rawRow({ linkedin_profile_data: { a: 1 } }));
  assert.deepEqual(detail.linkedinProfileData, { a: 1 });
  assert.equal(detail.scoringDetails, null);
});

test('lot12 : colonnes légères sans profil lourd, colonnes de la fiche avec', () => {
  const light = v3.MISSION_ROW_LIGHT_COLUMNS.split(',');
  assert.ok(light.includes('group_ids') && light.includes('stage_entered_at'));
  assert.ok(!light.includes('linkedin_profile_data') && !light.includes('scoring_details'));
  assert.ok(!light.includes('status') && !light.includes('pipeline_stage'), 'on range par l\'étape générale');
  assert.match(v3.MISSION_ROW_DETAIL_COLUMNS, /linkedin_profile_data,scoring_details$/);
  assert.equal(v3.PIPELINE_PAGE_SIZE, 50);
});

test('lot12 : un geste écrit tout le groupe, sans doublon', () => {
  assert.deepEqual(v3.rowWriteIds([{ id: 'a', groupIds: ['a', 'b'] }, { id: 'c', groupIds: [] }, { id: 'b', groupIds: ['b', 'a'] }]),
    ['a', 'b', 'c']);
});

test('lot12 : résultat par candidat, pas par ligne', () => {
  const rows = [{ id: 'a', groupIds: ['a', 'b'] }, { id: 'c', groupIds: ['c'] }, { id: 'd', groupIds: ['d'] }, { id: 'e', groupIds: ['e'] }];
  const outcome = {
    rows: [
      { id: 'a', result: 'unchanged', hint: null }, { id: 'b', result: 'updated', hint: null },
      { id: 'c', result: 'skipped', hint: null }, { id: 'd', result: 'error', hint: 'STAGE_STEP_REQUIRED' },
    ],
    error: null,
  };
  // a : jugé sur sa ligne canonique (inchangée), même si son doublon b a changé.
  assert.deepEqual(v3.summarizeStageMove(rows, outcome),
    { changed: 0, unchanged: 1, skipped: 1, refused: 1, firstHint: 'STAGE_STEP_REQUIRED', callFailed: false });
  // Ligne canonique absente de la réponse : les autres lignes du groupe jugent.
  assert.equal(v3.summarizeStageMove([{ id: 'z', groupIds: ['z', 'w'] }], { rows: [{ id: 'w', result: 'updated', hint: null }], error: null }).changed, 1);
  const failed = v3.summarizeStageMove(rows, { rows: [], error: { hint: null, code: null, message: 'x' } });
  assert.equal(failed.callFailed, true);
  assert.equal(failed.changed, 0, 'rien annoncé comme fait');
});

// ------------------------------------------------------------ filtre d'étape
test('lot12 : filtre d\'étape (?etape=)', () => {
  assert.equal(v3.parseStageFilter(null), null);
  assert.deepEqual(v3.parseStageFilter('replied'), { stage: 'replied', stepId: null });
  assert.deepEqual(v3.parseStageFilter(`interviewing:${STEP_A}`), { stage: 'interviewing', stepId: STEP_A });
  assert.deepEqual(v3.parseStageFilter('interviewing:none'), { stage: 'interviewing', stepId: 'none' });
  assert.equal(v3.parseStageFilter('retained:x'), null);
  assert.equal(v3.parseStageFilter('shortlisted'), null);
  assert.equal(v3.parseStageFilter('interviewing:'), null);
  for (const raw of ['to_sort', 'rejected', 'interviewing', `interviewing:${STEP_B}`, 'interviewing:none']) {
    assert.equal(v3.stageFilterParam(v3.parseStageFilter(raw)), raw);
  }
  assert.equal(v3.stageFilterKey(null), 'en-cours');
  assert.ok(v3.sameStageFilter(null, null));
  assert.ok(!v3.sameStageFilter(null, { stage: 'hired', stepId: null }));
  assert.ok(v3.sameStageFilter({ stage: 'hired', stepId: 'x' }, { stage: 'hired', stepId: null }));
});

test('lot12 : liste par défaut = en cours, ni À trier ni Écarté', () => {
  const m = (stage, processStepId = null, f = null) => v3.rowMatchesFilter({ stage, processStepId }, f);
  assert.deepEqual([...v3.IN_PROGRESS_STAGES], ['retained', 'contacted', 'replied', 'interviewing', 'hired']);
  assert.ok(!m('to_sort') && !m('rejected') && m('replied') && m('hired'));
  assert.ok(m('rejected', null, { stage: 'rejected', stepId: null }));
  assert.ok(m('interviewing', STEP_A, { stage: 'interviewing', stepId: null }));
  assert.ok(m('interviewing', STEP_A, { stage: 'interviewing', stepId: STEP_A }));
  assert.ok(!m('interviewing', STEP_B, { stage: 'interviewing', stepId: STEP_A }));
  assert.ok(m('interviewing', null, { stage: 'interviewing', stepId: 'none' }));
  assert.ok(!m('interviewing', STEP_A, { stage: 'interviewing', stepId: 'none' }));
});

// ------------------------------------------------------ prochaine action
test('lot12 : prochaine action provisoire, « Aucune action depuis N j »', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  const at = (stage, iso) => v3.provisionalNextAction({ stage, processStepId: null, stageEnteredAt: iso, updatedAt: null, createdAt: null }, now);
  assert.deepEqual(at('contacted', '2026-09-23T11:00:00Z'), { text: 'Aucune action depuis 6 j', days: 6, stale: false });
  assert.equal(at('replied', '2026-09-20T11:00:00Z').stale, true, '7 j et plus : sans mouvement');
  assert.equal(at('retained', '2026-09-01T11:00:00Z').stale, false, 'Retenu : jamais sans mouvement');
  assert.equal(at('contacted', '2026-09-29T08:00:00Z').text, 'Aucune action depuis 0 j', 'même jour : 0 j, jamais une autre phrase');
  assert.equal(at('hired', '2026-09-01T11:00:00Z').text, 'Aucune');
  assert.equal(at('rejected', '2026-09-01T11:00:00Z').text, null);
  assert.equal(at('to_sort', '2026-09-01T11:00:00Z').text, 'À trier');
  assert.equal(at('contacted', null).text, 'Aucune action enregistrée');
});

test('lot12 : ordre de la liste, le même que la requête', () => {
  const rows = [
    { id: 'c', stageEnteredAt: null, score: 90 },
    { id: 'b', stageEnteredAt: '2026-09-20T10:00:00Z', score: null },
    { id: 'a', stageEnteredAt: '2026-09-20T10:00:00Z', score: 70 },
    { id: 'd', stageEnteredAt: '2026-09-10T10:00:00Z', score: 10 },
  ];
  assert.deepEqual([...rows].sort(v3.comparePipelineRows).map((r) => r.id), ['d', 'a', 'b', 'c']);
  // Embauché en dernier, même plus ancien ; À trier par note.
  const withHired = [...rows, { id: 'h', stage: 'hired', stageEnteredAt: '2026-08-01T10:00:00Z', score: 99 }];
  assert.deepEqual(withHired.sort(v3.comparePipelineRows).map((r) => r.id), ['d', 'a', 'b', 'c', 'h']);
  assert.deepEqual([...rows].sort(v3.compareToSortRows).map((r) => r.id), ['c', 'a', 'd', 'b']);
});

// ------------------------------------------------------- cibles d'étape
test('lot12 : « Déplacer vers » suit les étapes d\'entretien de la mission', () => {
  const opts = v3.moveOptions(STEPS);
  assert.deepEqual(opts.map((o) => o.label),
    ['À trier', 'Retenu', 'Contacté', 'A répondu', 'Qualification', 'Entretien DG', 'Embauché', 'Écarté']);
  assert.deepEqual(opts[4].target, { stage: 'interviewing', processStepId: STEP_A });
  assert.equal(new Set(opts.map((o) => o.key)).size, opts.length);
  assert.deepEqual(v3.moveOptions([]).map((o) => o.label),
    ['À trier', 'Retenu', 'Contacté', 'A répondu', 'En entretien', 'Embauché', 'Écarté']);
});

test('lot12 : étape suivante', () => {
  const next = (stage, processStepId = null, steps = STEPS) => v3.nextStageOption({ stage, processStepId }, steps)?.key ?? null;
  assert.equal(next('to_sort'), 'retained');
  assert.equal(next('retained'), 'contacted');
  assert.equal(next('contacted'), 'replied');
  assert.equal(next('replied'), `interviewing:${STEP_A}`);
  assert.equal(next('interviewing', STEP_A), `interviewing:${STEP_B}`);
  assert.equal(next('interviewing', STEP_B), 'hired');
  assert.equal(next('interviewing', null), `interviewing:${STEP_A}`, 'sans étape : la première');
  assert.equal(next('replied', null, []), 'interviewing');
  assert.equal(next('interviewing', null, []), 'hired');
  assert.equal(next('hired'), null);
  assert.equal(next('rejected'), null);
  assert.equal(v3.rowStageLabel({ stage: 'interviewing', processStepId: STEP_B }, STEPS), 'Entretien DG');
  assert.equal(v3.rowStageLabel({ stage: 'interviewing', processStepId: 'autre' }, STEPS), 'En entretien');
  assert.equal(v3.rowStageLabel({ stage: 'replied', processStepId: null }, STEPS), 'A répondu');
});

// ------------------------------------------------------------------ textes
test('lot12 : « N profils trouvés », jamais à zéro', () => {
  assert.equal(v3.unopenedLinkText(1), '1 profil trouvé');
  assert.equal(v3.unopenedLinkText(12), '12 profils trouvés');
  assert.equal(v3.unopenedLinkText(0), null);
  assert.equal(v3.unopenedLinkText(undefined), null);
});

test('lot12 : Bilan sur les cumuls, nombres accordés, pas de taux au-delà de 100', () => {
  assert.equal(v3.BILAN_TITLE, 'Depuis le début de la mission');
  const [retained, contacted, replied] = v3.bilanRates({ triagedByUser: 15, everRetained: 12, everContacted: 12, everReplied: 9 });
  assert.equal(retained.text, '12 retenus sur 15 profils triés par vous');
  assert.equal(retained.percent, 80);
  assert.equal(contacted.text, '12 ont été contactés sur 12 retenus');
  assert.equal(contacted.percent, 100);
  assert.equal(replied.text, '9 ont répondu sur 12 contactés');
  assert.equal(replied.percent, 75);
  const one = v3.bilanRates({ triagedByUser: 0, everRetained: 1, everContacted: 3, everReplied: 1 });
  assert.equal(one[0].text, '1 retenu au total', 'plus de retenus que de profils triés : cumul seul');
  assert.equal(one[0].percent, null, 'dénominateur nul');
  const none = v3.bilanRates({ triagedByUser: 0, everRetained: 0, everContacted: 0, everReplied: 0 });
  assert.equal(none[0].text, '0 retenu sur 0 profil trié par vous');
  assert.equal(v3.bilanRates({ triagedByUser: 0, everRetained: 4, everContacted: 4, everReplied: 0 })[0].text, '4 retenus au total');
  assert.equal(one[1].text, '3 ont été contactés sur 1 retenu');
  assert.equal(one[1].percent, null, 'jamais de taux à 300 %');
  assert.equal(one[2].text, '1 a répondu sur 3 contactés');
  for (const rate of one) assert.ok(rate.detail.length > 0);
});

test('lot12 : ni tiret long, ni « (s) », ni nom de prestataire, ni mesure d\'usage', () => {
  for (const rel of ['src/lib/missionBeta.ts', 'src/components/missions/v3/types.ts', 'src/components/missions/v3/MissionV3Context.tsx']) {
    const src = read(rel);
    assert.doesNotMatch(src, /\(s\)|—/, rel);
    assert.doesNotMatch(src, /unipile|apollo|people data labs|\bpdl\b|anthropic|claude/i, rel);
    assert.doesNotMatch(src, /trackEvent/, rel);
  }
  assert.match(read('src/lib/missionBeta.ts'), /try \{[\s\S]*?localStorage[\s\S]*?\} catch/);
});
