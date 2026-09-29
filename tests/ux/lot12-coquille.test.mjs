/**
 * Refonte mission, lot 1 : coquille de la nouvelle page mission (piste
 * coquille du contrat lot12). Adresse d'un écran (fonction pure, empaquetée par
 * esbuild) et gardes statiques sur les fichiers de la coquille.
 * Lancer : node --test tests/ux/lot12-coquille.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = new URL('../../', import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const code = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const load = async (rel) => {
  const { outputFiles } = await build({
    entryPoints: [join(ROOT_PATH, rel)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    tsconfig: join(ROOT_PATH, 'tsconfig.app.json'),
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
};

const SHELL_DIR = 'src/components/missions/v3/shell';
const SHELL_FILES = readdirSync(join(ROOT_PATH, SHELL_DIR)).map((name) => `${SHELL_DIR}/${name}`);
const OWN_FILES = [
  ...SHELL_FILES,
  'src/components/missions/v3/MissionWorkspaceV3.tsx',
  'src/pages/MissionEntry.tsx',
  'src/hooks/useMissionBeta.ts',
];

test('C-1 : adresse d’un écran, panneaux gardés, paramètres d’écran retirés', async () => {
  const { missionScreenTarget } = await load(`${SHELL_DIR}/missionScreens.ts`);
  assert.equal(missionScreenTarget('m1', 'pipeline', ''), '/missions/m1');
  assert.equal(missionScreenTarget('m1', 'sourcing', '?panneau=fiche&candidat=r1'), '/missions/m1/sourcing?panneau=fiche&candidat=r1');
  assert.equal(missionScreenTarget('m1', 'cadrage', '?vue=etapes&etape=replied&x=1', 'etapes'), '/missions/m1/cadrage?x=1&section=etapes');
  assert.equal(missionScreenTarget('m1', 'pipeline', '?section=poste&tab=brief&nouvelle-mission=1'), '/missions/m1');
  assert.equal(missionScreenTarget('m1', 'sourcing', '', 'poste'), '/missions/m1/sourcing', 'section : Cadrage seulement');
});

test('C-2 : route, entrée et clé de page', () => {
  const app = read('src/App.tsx'); // brut : « /missions/:id/* » ressemble à un commentaire
  assert.match(app, /path="\/missions\/:id\/\*" element=\{<ProtectedRoute><OrganizationGuard><AppLayout><MissionEntry \/>/);
  assert.doesNotMatch(app, /path="\/missions\/:id" /);

  const entry = code('src/pages/MissionEntry.tsx');
  assert.doesNotMatch(entry, /<Navigate/, 'redirection en effet, jamais un <Navigate> rendu');
  for (const needle of ['legacyToV3Target(', 'v3ToLegacyTarget(', 'missionBetaParam(', 'withoutMissionBetaParam(', 'setMissionBeta(', 'replace: true']) {
    assert.ok(entry.includes(needle), `MissionEntry : ${needle} absent`);
  }
  // Ancienne page importée avec l'entrée (un seul fichier à charger, interrupteur éteint).
  assert.match(entry, /import MissionWorkspace from '\.\/MissionWorkspace'|import\('\.\/MissionWorkspace'\)/);
  assert.match(entry, /useEffect\(/);

  const layout = code('src/components/AppLayout.tsx');
  assert.match(layout, /pageTransitionKey\(location\.pathname\)/);
  assert.match(layout, /key=\{transitionKey\}/);
});

test('C-3 : coquille, onglets, panneau et menus', () => {
  const shell = code(`${SHELL_DIR}/MissionShell.tsx`);
  assert.match(shell, /data-testid="mission-v3"/);
  assert.match(shell, /fallbackTitle="Erreur dans le Pipeline"/);
  assert.match(shell, /fallbackTitle="Erreur dans le Cadrage"/);
  assert.match(code(`${SHELL_DIR}/SourcingScreen.tsx`), /fallbackTitle="Erreur dans le Sourcing"/);

  const tabs = code(`${SHELL_DIR}/MissionTabs.tsx`);
  assert.match(tabs, /aria-label="Écrans de la mission"/);
  assert.match(tabs, /aria-current=\{active \? 'page' : undefined\}/);
  assert.doesNotMatch(tabs, /Lock|🔒/, 'aucun verrou');

  const panel = code(`${SHELL_DIR}/PanelHost.tsx`);
  for (const needle of ['data-testid="mission-panel"', 'data-panel={panel}', 'aria-labelledby={titleId}', "'Escape'", 'lg:w-[480px]', 'fixed inset-0', 'useReducedMotion', 'key={rowId}']) {
    assert.ok(panel.includes(needle), `PanelHost : ${needle} absent`);
  }

  assert.match(code(`${SHELL_DIR}/MissionMoreMenu.tsx`), /aria-label="Plus d'actions"/);
  const archive = code(`${SHELL_DIR}/ArchiveMissionDialog.tsx`);
  assert.match(archive, /Archiver cette mission \?/);
  assert.match(archive, /variant="destructive"/);
  assert.match(archive, /<AlertDialog /);

  const workspace = code('src/components/missions/v3/MissionWorkspaceV3.tsx');
  assert.match(workspace, /missionV3Pushed: true/);
  assert.match(workspace, /navigate\(-1\)/);
  assert.match(workspace, /Mission introuvable/);
  assert.match(workspace, /Impossible de charger la mission\./);
});

test('C-4 : barre latérale, chevron et verrous seulement interrupteur éteint', () => {
  const nav = code('src/components/sidebar/missions/MissionNavRow.tsx');
  assert.match(nav, /beta = false/);
  assert.match(nav, /\{!beta && \(\s*<Button[\s\S]{0,300}Afficher les vues de/);
  assert.match(nav, /\{!beta && expanded && \(/);
  assert.match(nav, /missionV3PathFromVisit\(item\.id, lastView\)/);
  assert.match(code('src/components/sidebar/missions/MissionsPanel.tsx'), /beta=\{beta\}/);
  assert.match(code('src/components/sidebar/missions/MissionVisitTracker.tsx'), /\[projectId, view, seenTotal, recordVisit\]/);
});

test('C-5 : règles de rédaction et d’écriture dans les fichiers de la coquille', () => {
  for (const rel of OWN_FILES) {
    const src = code(rel);
    assert.doesNotMatch(src, /window\.confirm/, `${rel} : window.confirm`);
    assert.doesNotMatch(src, /trackEvent/, `${rel} : trackEvent`);
    assert.doesNotMatch(src, /—/, `${rel} : tiret long`);
    assert.doesNotMatch(src, /\(s\)/, `${rel} : « (s) »`);
    assert.doesNotMatch(src, /Unipile|Apollo|People Data Labs|\bPDL\b|Anthropic|Claude/, `${rel} : nom de prestataire`);
    assert.doesNotMatch(src, /localStorage/, `${rel} : stockage local hors de missionBeta.ts`);
    assert.doesNotMatch(src, /job_candidate_status|pipeline_stage|set_candidate_stage/, `${rel} : écriture d'étape`);
  }
});
