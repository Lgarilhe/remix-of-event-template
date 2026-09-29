/**
 * Refonte mission, lots 1 et 2 : panneaux de la nouvelle page mission (fiche
 * candidat, Prise de contact) et écran Cadrage.
 *  - adaptateurs purs de la fiche (src/components/missions/v3/panels/candidateAdapters.ts) ;
 *  - raison de la lecture seule de Cadrage (CadrageReadOnlyBanner.tsx) ;
 *  - gardes de texte sur les fichiers de la piste.
 *
 * Modules empaquetés par esbuild (alias @/ résolus par tsconfig.app.json),
 * React, icônes, organisation et contexte remplacés par des modules vides.
 * Lancer : node --test tests/ux/lot12-panneaux.test.mjs
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
    b.onResolve({ filter: /^(react|react\/jsx-runtime|lucide-react)$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    b.onResolve({ filter: /(hooks\/useOrganization|MissionV3Context)$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: [
        'export const jsx = () => null; export const jsxs = () => null; export const Fragment = null;',
        'export const Eye = null;',
        'export const useOrganization = () => ({});',
        'export const useMissionV3 = () => ({});',
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

const A = await load('src/components/missions/v3/panels/candidateAdapters.ts');
const B = await load('src/components/missions/v3/cadrage/CadrageReadOnlyBanner.tsx');

const baseRow = {
  id: 'r1',
  groupIds: ['r1', 'r2'],
  groupSize: 2,
  candidateId: 'c1',
  name: 'Camille Fontaine',
  headline: 'Directrice financière',
  linkedinUrl: 'https://www.linkedin.com/in/camille',
  stage: 'retained',
  processStepId: null,
  stageEnteredAt: '2026-09-20T10:00:00Z',
  decisionSource: 'user',
  score: 83,
  recommendation: 'shortlist',
  skipReason: null,
  contactedAt: null,
  repliedAt: null,
  firstInterviewAt: null,
  presentedAt: null,
  hiredAt: null,
  rejectedAt: null,
  rejectedFromStage: null,
  replySummary: null,
  tags: ['finance'],
  jobId: 'job-1',
  projectId: 'p1',
  createdBy: 'u1',
  createdAt: '2026-09-18T10:00:00Z',
  updatedAt: '2026-09-21T10:00:00Z',
  linkedinProfileData: null,
  scoringDetails: null,
};

const profile = {
  first_name: 'Camille',
  last_name: 'Fontaine',
  headline: 'CFO',
  location: { name: 'Paris' },
  skills: ['IFRS', { name: 'LBO' }, null],
  languages: [{ name: 'Anglais' }],
  work_experience: [
    { role: 'Directrice financière', company: 'Verallia', start: { year: 2019, month: 3 } },
    { role: 'Contrôleuse', company: 'Saint-Gobain', start: { year: 2012 }, end: { year: 2019, month: 2 } },
  ],
  education: [{ school: { name: 'HEC', logo: 'x.png' }, degree: 'MSc', start: { year: 2008 }, end: { year: 2011 } }],
};

test('hasProfileData : objet non vide seulement', () => {
  assert.equal(A.hasProfileData(null), false);
  assert.equal(A.hasProfileData({}), false);
  assert.equal(A.hasProfileData([]), false);
  assert.equal(A.hasProfileData('x'), false);
  assert.equal(A.hasProfileData({ a: 1 }), true);
});

test('buildEnrichedProfile : même construction que la fiche du /pipeline', () => {
  assert.equal(A.buildEnrichedProfile(null, { name: 'X', headline: null }), null);
  const e = A.buildEnrichedProfile(profile, { name: 'X', headline: null }, new Date('2026-09-29T00:00:00Z'));
  assert.equal(e.name, 'Camille Fontaine');
  assert.equal(e.headline, 'CFO');
  assert.equal(e.currentRole, 'Directrice financière');
  assert.equal(e.currentCompany, 'Verallia');
  assert.equal(e.location, 'Paris');
  assert.deepEqual(e.skills, ['IFRS', 'LBO']);
  assert.deepEqual(e.languages, ['Anglais']);
  assert.equal(e.yearsOfExperience, 14);
  assert.equal(e.experiences[0].startDate, '2019-03');
  assert.equal(e.experiences[0].isCurrent, true);
  assert.equal(e.experiences[1].endDate, '2019-02');
  assert.deepEqual(e.education[0], { school: 'HEC', logo: 'x.png', degree: 'MSc', field: '', startYear: '2008', endYear: '2011' });
  const fallback = A.buildEnrichedProfile({ summary: 'Bio' }, { name: 'Repli', headline: 'Titre' });
  assert.equal(fallback.name, 'Repli');
  assert.equal(fallback.headline, 'Titre');
});

test('positionLine et candidateDisplayName', () => {
  assert.equal(A.positionLine({ currentRole: 'CFO', currentCompany: 'Verallia' }, null), 'CFO, Verallia');
  assert.equal(A.positionLine({ headline: 'Titre du profil' }, 'Titre de la ligne'), 'Titre du profil');
  assert.equal(A.positionLine(null, 'Titre de la ligne'), 'Titre de la ligne');
  assert.equal(A.positionLine(null, null), null);
  assert.equal(A.candidateDisplayName({ name: 'Nom' }, profile), 'Nom');
  assert.equal(A.candidateDisplayName({ name: null }, profile), 'Camille Fontaine');
  assert.equal(A.candidateDisplayName({ name: null }, null), 'Candidat sans nom');
});

test('scoreReasons : résumé, points forts et réserves, quatre au plus, rien sinon', () => {
  assert.equal(A.scoreReasons(null), null);
  assert.equal(A.scoreReasons({ dimensions: {} }), null);
  const r = A.scoreReasons({ summary: ' Bon profil ', strengths: ['a', '', 'b', 'c', 'd', 'e'], concerns: ['x', 3] });
  assert.equal(r.summary, 'Bon profil');
  assert.deepEqual(r.strengths, ['a', 'b', 'c', 'd']);
  assert.deepEqual(r.concerns, ['x']);
});

test('toAtsCandidate : ligne de la mission vers les onglets existants', () => {
  const c = A.toAtsCandidate(
    { ...baseRow, scoringDetails: { summary: 's' } },
    { name: 'Mission DAF', job_details: { title: 'Directeur financier' } },
    'Retenu',
    profile,
  );
  assert.equal(c.id, 'r1');
  assert.equal(c.candidateId, 'c1');
  assert.equal(c.name, 'Camille Fontaine');
  assert.equal(c.stage, 'Retenu');
  assert.equal(c.jobId, 'job-1');
  assert.equal(c.jobTitle, 'Directeur financier');
  assert.equal(c.linkedin, 'https://www.linkedin.com/in/camille');
  assert.equal(c.score, 83);
  assert.deepEqual(c.tags, ['finance']);
  assert.deepEqual(c.scoringDetails, { summary: 's' });
  assert.equal(c.linkedinProfileData, profile);
  assert.equal(c.createdAt, '2026-09-18T10:00:00Z');
  assert.equal(c.lastActivity, '2026-09-21T10:00:00Z');

  const bare = A.toAtsCandidate(
    { ...baseRow, name: null, createdAt: null, stageEnteredAt: null, updatedAt: null },
    { name: 'Mission DAF', job_details: null },
    'À trier',
    {},
    new Date('2026-09-29T00:00:00Z'),
  );
  assert.equal(bare.jobTitle, 'Mission DAF');
  assert.equal(bare.name, 'Candidat sans nom');
  assert.equal(bare.linkedinProfileData, null);
  assert.equal(bare.scoringDetails, null);
  assert.equal(bare.createdAt, '2026-09-29T00:00:00.000Z');
});

test('neighborRowIds : voisins dans la liste affichée, par n importe quelle ligne du groupe', () => {
  const visible = ['a', 'b', 'c'];
  assert.deepEqual(A.neighborRowIds(visible, ['b']), { previous: 'a', next: 'c' });
  assert.deepEqual(A.neighborRowIds(visible, ['a']), { previous: null, next: 'b' });
  assert.deepEqual(A.neighborRowIds(visible, ['c']), { previous: 'b', next: null });
  assert.deepEqual(A.neighborRowIds(visible, ['x', 'c']), { previous: 'b', next: null });
  assert.deepEqual(A.neighborRowIds(visible, ['z']), { previous: null, next: null });
  assert.deepEqual(A.neighborRowIds([], ['a']), { previous: null, next: null });
});

test('jalons, dates courtes et ancienneté', () => {
  assert.equal(A.shortDate('2026-09-17T10:00:00Z'), '17/09');
  assert.equal(A.shortDate('pas une date'), null);
  assert.equal(A.shortDate(null), null);
  assert.deepEqual(A.milestoneTexts({ ...baseRow, contactedAt: '2026-09-17T10:00:00Z', repliedAt: '2026-09-18T10:00:00Z' }), [
    'Contacté le 17/09',
    'A répondu le 18/09',
  ]);
  assert.deepEqual(A.milestoneTexts(baseRow), []);
  assert.equal(A.sinceText(null), null);
  assert.equal(A.sinceText(0), "depuis aujourd'hui");
  assert.equal(A.sinceText(6), 'depuis 6 j');
});

test('cadrageReadOnlyReason : raison et remède, rien pendant le chargement', () => {
  const ok = { orgLoading: false, orgType: 'agency', isOwnMission: true, isArchived: false, canEditBrief: true, canEditProcess: true };
  assert.equal(B.cadrageReadOnlyReason(ok), null);
  assert.equal(B.cadrageReadOnlyReason({ ...ok, orgLoading: true, canEditBrief: false, canEditProcess: false }), null);
  assert.match(B.cadrageReadOnlyReason({ ...ok, isOwnMission: false, canEditBrief: false }), /autre organisation/);
  assert.match(B.cadrageReadOnlyReason({ ...ok, isArchived: true, canEditBrief: false, canEditProcess: false }), /Mission archivée : réactivez-la/);
  assert.match(B.cadrageReadOnlyReason({ ...ok, orgType: null, canEditBrief: false, canEditProcess: false }), /type de votre organisation/);
  assert.match(B.cadrageReadOnlyReason({ ...ok, canEditProcess: false }), /Adressez-vous au propriétaire/);
});

const FILES = [
  'src/components/missions/v3/panels/CandidatePanel.tsx',
  'src/components/missions/v3/panels/CandidatePanelHeader.tsx',
  'src/components/missions/v3/panels/CandidatePanelTabs.tsx',
  'src/components/missions/v3/panels/ContactPanel.tsx',
  'src/components/missions/v3/panels/candidateAdapters.ts',
  'src/components/missions/v3/cadrage/CadrageScreen.tsx',
  'src/components/missions/v3/cadrage/CadrageReadOnlyBanner.tsx',
  'src/hooks/useMissionCandidateDetail.ts',
];

const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

test('gardes de texte : ni tiret long, ni « (s) », ni nom de prestataire, ni confirmation du navigateur', () => {
  for (const file of FILES) {
    const src = read(file);
    const body = code(src);
    assert.ok(!src.includes('\u2014'), `${file} : tiret long`);
    assert.ok(!/[a-zà-ÿ]\(s\)/i.test(body), `${file} : (s)`);
    assert.ok(!/unipile|apollo|people data labs|\bpdl\b|anthropic|claude/i.test(body), `${file} : nom de prestataire`);
    assert.ok(!body.includes('window.confirm'), `${file} : window.confirm`);
    assert.ok(!body.includes('trackEvent'), `${file} : trackEvent`);
    assert.ok(!body.includes('localStorage'), `${file} : localStorage`);
  }
});

test('écritures d étape : seulement par useMissionStageActions, jamais sur job_candidate_status', () => {
  for (const file of FILES) {
    const body = code(read(file));
    assert.ok(!/pipeline_stage/.test(body), `${file} : pipeline_stage`);
    assert.ok(!/rpc\(\s*['"]set_candidate_stage/.test(body), `${file} : appel direct de set_candidate_stage`);
    const jcs = body.split("from('job_candidate_status')").slice(1);
    for (const chunk of jcs) {
      const next = chunk.slice(0, 200);
      assert.match(next, /^\s*\.select\('linkedin_profile_data'\)/, `${file} : lecture de job_candidate_status autre que le profil`);
      assert.ok(!/\.(update|upsert|insert|delete)\(/.test(next), `${file} : écriture de job_candidate_status`);
    }
    if (jcs.length > 0) assert.equal(file, 'src/hooks/useMissionCandidateDetail.ts');
  }
  const panel = code(read('src/components/missions/v3/panels/CandidatePanel.tsx'));
  assert.match(panel, /useMissionStageActions\(project\.id\)/);
  assert.match(panel, /actions\.move\(\{ rows: \[row\]/);
});

test('fiche : quatre onglets, liste de mission_candidate_rows, clés sous project-candidates', () => {
  const panel = read('src/components/missions/v3/panels/CandidatePanel.tsx');
  for (const label of ["label: 'Aperçu'", "label: 'Échanges'", "label: 'Évaluations'", "label: 'Profil'"]) {
    assert.ok(panel.includes(label), label);
  }
  assert.ok(read('src/components/missions/v3/panels/CandidatePanelTabs.tsx').includes('aria-label="Fiche du candidat"'));
  const hook = read('src/hooks/useMissionCandidateDetail.ts');
  assert.match(hook, /\['project-candidates', projectId, 'v3-row', rowId\]/);
  assert.match(hook, /from\('mission_candidate_rows'\)\.select\(MISSION_ROW_DETAIL_COLUMNS\)/);
  assert.match(hook, /organization_id: organizationId/);
});

test('Prise de contact et Cadrage : composants existants tels quels', () => {
  const contact = read('src/components/missions/v3/panels/ContactPanel.tsx');
  assert.match(contact, /<SequencesList/);
  assert.match(contact, /<InvitationsPanel/);
  assert.match(contact, /reliez d'abord un compte LinkedIn/);
  assert.ok(!/emoji/.test(code(contact)));
  const cadrage = read('src/components/missions/v3/cadrage/CadrageScreen.tsx');
  for (const needle of ['cadrage-poste', 'cadrage-etapes', 'cadrage-reglages', 'Le poste', "Étapes d'entretien", 'Réglages']) {
    assert.ok(cadrage.includes(needle), needle);
  }
  assert.match(cadrage, /<MissionBriefV2 project=\{project\} readOnly=\{!canEditBrief\}/);
  assert.match(cadrage, /<MissionProcessV2 project=\{project\} readOnly=\{!canEditProcess\}/);
  assert.match(cadrage, /<MissionConfigV2 project=\{project\} readOnly=\{!canEditBrief\}/);
});
