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
  for (const needle of ['data-testid="mission-panel"', 'data-panel={panel}', 'aria-labelledby={titleId}', "'Escape'", 'lg:w-[440px]', 'fixed inset-0', 'useReducedMotion', 'key={rowId}']) {
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

test('C-6 : en-tête allégé (design simplifié, 04/10/2026) : logo du client, statut sans cadre ni couleur, un seul « Réactiver », cibles de 44 px, focus rendu', () => {
  const header = code(`${SHELL_DIR}/MissionHeader.tsx`);
  const switcher = code(`${SHELL_DIR}/MissionSwitcher.tsx`);
  const more = code(`${SHELL_DIR}/MissionMoreMenu.tsx`);
  const banner = code(`${SHELL_DIR}/MissionStateBanner.tsx`);
  const notice = code(`${SHELL_DIR}/ArchivedNotice.tsx`);
  const sourcing = code(`${SHELL_DIR}/SourcingScreen.tsx`);
  const dialog = code(`${SHELL_DIR}/ArchiveMissionDialog.tsx`);
  const client = code(`${SHELL_DIR}/missionClient.ts`);
  const statusLib = code(`${SHELL_DIR}/missionStatus.ts`);

  // Règle 4 : le logo du client (initiales sinon) devant le nom, et devant chaque mission du menu.
  assert.match(switcher, /import \{ MissionCompanyLogo \} from '@\/components\/dashboard\/MissionCompanyLogo'/);
  assert.equal((switcher.match(/<MissionCompanyLogo/g) ?? []).length, 2, 'logo dans le déclencheur et dans chaque entrée du menu');
  assert.match(switcher, /company=\{item\.client_name \|\| item\.name\}/);
  // Le client se lit comme l'accueil et la liste : celui du brief d'abord, puis client_name (même client partout).
  assert.match(switcher, /company=\{missionClientName\(project\) \|\| project\.name\}/);
  assert.match(client, /project\.job_details\?\.client\?\.name\?\.trim\(\) \|\| project\.client_name\?\.trim\(\) \|\| null/);
  assert.match(header, /const client = missionClientName\(project\)/);
  assert.doesNotMatch(header + switcher, /project\.client_name/, 'jamais client_name seul : passer par missionClientName');
  assert.match(header, /<h1 className="[^"]*">\s*<MissionSwitcher \/>\s*<\/h1>/, 'un seul h1, le menu du nom');
  assert.equal((header.match(/<h1/g) ?? []).length, 1);

  // Le client se lit en discret à côté du nom, sans « · » décoratif, et rend sa place au nom.
  assert.doesNotMatch(header, /aria-hidden="true">·</);
  // Il ne s'écrit que si ce qui reste après le nom lui laisse 6 rem (conteneur de taille en ligne, base nulle) : jamais un fragment.
  assert.match(header, /min-w-0 flex-1 basis-0 \[container-type:inline-size\]/);
  assert.match(header, /hidden truncate text-muted-foreground \[@container\(min-width:6rem\)\]:block/);

  // Statut : le mot et un chevron, ni cadre ni fond ni pilule ni point de couleur (la couleur est réservée à ce qui attend
  // quelqu'un ; la liste des missions n'écrit même pas « Active ») ; mêmes noms accessibles et menu.
  const statusBase = header.match(/const baseClass =([\s\S]*?);\n/)?.[1] ?? '';
  assert.ok(statusBase.length > 0, 'classe de base du statut introuvable');
  assert.doesNotMatch(statusBase, /\bborder\b|border-|rounded-full|\bbg-/);
  assert.match(statusBase, /max-sm:min-h-11/);
  assert.match(header, /aria-label=\{`Statut : \$\{missionStatusLabel\(project\.status\)\}, changer le statut`\}/);
  assert.doesNotMatch(header, /MISSION_STATUS_DOT|rounded-full|bg-(success|warning|info)/, 'statut : aucun point de couleur');
  assert.doesNotMatch(statusLib, /MISSION_STATUS_DOT|bg-(success|warning|info)/);
  assert.match(header, /<DropdownMenuRadioItem key=\{status\} value=\{status\} className="max-sm:min-h-11">\s*\{MISSION_STATUS_LABEL\[status\]\}\s*<\/DropdownMenuRadioItem>/, 'menu du statut : le mot, la coche du contrôle dit lequel est actif');
  assert.match(header, /canEditBrief/);
  assert.match(header, /control\.blockedReason/);
  assert.match(header, /<ArchiveMissionDialog\s/);

  // Archivage : à la fermeture de la confirmation, le focus revient au bouton qui l'a ouverte (statut ou « ... »), jamais <body>.
  assert.match(dialog, /returnFocusRef: React\.RefObject<HTMLElement \| null>/);
  assert.match(dialog, /onCloseAutoFocus=\{\(event\) => \{[\s\S]*?event\.preventDefault\(\);\s*target\.focus\(\);/);
  for (const [name, src] of [['MissionHeader', header], ['MissionMoreMenu', more]]) {
    assert.match(src, /const triggerRef = useRef<HTMLButtonElement>\(null\)/, `${name} : cible de retour du focus`);
    assert.match(src, /ref=\{triggerRef\}/, `${name} : le déclencheur porte la cible`);
    assert.match(src, /returnFocusRef=\{triggerRef\}/, `${name} : la confirmation la reçoit`);
  }

  // Un seul « Réactiver » par écran : celui du bandeau de la page. La phrase de l'écran fermé n'a ni cadre ni bouton,
  // sauf dans le panneau plein écran (le bandeau y est inerte), où ContactPanel le demande.
  assert.match(banner, /variant="primary"/);
  assert.match(banner, /changeStatus\('active'\)/);
  assert.doesNotMatch(notice, /border|bg-card|rounded-|<Archive\b/, 'écran fermé sans cadre ni icône');
  assert.match(notice, /withAction = false/);
  assert.match(notice, /\{withAction && status\.canManage && \(/);
  assert.doesNotMatch(sourcing, /withAction/, 'Sourcing : jamais de second « Réactiver »');
  assert.match(code('src/components/missions/v3/panels/ContactPanel.tsx'), /withAction=\{fullscreen\}/);

  // Un bouton plein au plus par fichier de la coquille ; aucune taille de texte écrite à la main.
  for (const rel of SHELL_FILES) {
    const src = code(rel);
    assert.ok((src.match(/variant="primary"/g) ?? []).length <= 1, `${rel} : plus d'un bouton plein`);
    assert.doesNotMatch(src, /text-\[\d/, `${rel} : taille de texte écrite à la main`);
  }

  // Cibles de 44 px sur téléphone : déclencheurs, entrées de menu, bouton « Réactiver ».
  for (const [name, src] of [['MissionHeader', header], ['MissionSwitcher', switcher], ['MissionMoreMenu', more], ['MissionStateBanner', banner], ['ArchivedNotice', notice]]) {
    assert.match(src, /max-sm:min-h-11/, `${name} : cible de 44 px sur téléphone`);
  }
  assert.equal((more.match(/max-sm:min-h-11/g) ?? []).length, 4, 'chaque entrée du menu « ... », mémoire comprise');
  assert.match(more, /aria-label="Plus d'actions"/);
  assert.match(more, /Revenir à l'ancienne page/);
});
