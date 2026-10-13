/**
 * Refonte mission, lot 5f-2c : plomberie du panneau Contacter dans la page
 * mission (sélection au-dessus de l'écran, adresse `?contacter=1`, bouton
 * « Contacter » de la barre, branche du panneau, relecture des candidats).
 *
 * Gardes statiques des sources (ContactFlow et ses modules purs ont leurs
 * propres tests) et un contrôle de comportement de la lecture d'adresse, qui
 * prouve que le mode Contacter ne change pas MissionV3Location.
 *
 * Lancer : node --test tests/ux/lot5f2c-plomberie.test.mjs
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

const V3 = 'src/components/missions/v3';
const CONTEXT = `${V3}/shell/missionSelectionContext.ts`;
const PROVIDER = `${V3}/shell/missionSelection.tsx`;
const SHELL = `${V3}/shell/MissionShell.tsx`;
const WORKSPACE = `${V3}/MissionWorkspaceV3.tsx`;
const TYPES = `${V3}/types.ts`;
const SCREEN = `${V3}/pipeline/PipelineScreen.tsx`;
const BUTTON = `${V3}/pipeline/ContactSelectionButton.tsx`;
const CANDIDATES = `${V3}/pipeline/useContactCandidates.ts`;
const PANEL = `${V3}/panels/ContactPanel.tsx`;

const MY_FILES = [CONTEXT, PROVIDER, SHELL, WORKSPACE, TYPES, SCREEN, BUTTON, CANDIDATES, PANEL];

// ─── Sélection au-dessus de l'écran ─────────────────────────────────────────

test('5F2C-P1 contexte de sélection à part : jamais dans la valeur de MissionV3Context', () => {
  const ctx = code(read(CONTEXT));
  assert.match(ctx, /selection: ReadonlyMap<string, MissionCandidateRow>;/);
  assert.match(ctx, /setSelection: Dispatch<SetStateAction<Map<string, MissionCandidateRow>>>;/);
  assert.match(ctx, /export const MissionSelectionContext = createContext<MissionSelectionValue \| null>\(null\);/);
  assert.match(ctx, /export function useMissionSelection\(\): MissionSelectionValue \{/);
  // Hors de la coquille, une erreur de montage claire (comme useMissionV3), jamais une sélection de repli.
  assert.match(ctx, /throw new Error\('useMissionSelection : composant monté hors de la coquille de la mission'\)/);

  // La valeur de MissionV3Context a 19 abonnés : la sélection n'y entre pas.
  const types = code(read(TYPES));
  const value = types.slice(types.indexOf('export interface MissionV3ContextValue'), types.indexOf('export interface MissionWorkspaceV3Props'));
  assert.ok(value.length > 500, 'valeur du contexte lue');
  assert.doesNotMatch(value, /[Ss]election/);
  assert.doesNotMatch(code(read(WORKSPACE)), /[Ss]election/, 'la page ne porte pas la sélection');
});

test('5F2C-P2 fournisseur : état de la sélection, enfants en prop, monté dans MissionShell à côté du panneau du Sourcing', () => {
  const provider = code(read(PROVIDER));
  assert.match(provider, /export function MissionSelectionProvider\(\{ children \}: \{ children: ReactNode \}\) \{/);
  assert.match(provider, /const \[selection, setSelection\] = useState<Map<string, MissionCandidateRow>>\(\(\) => new Map\(\)\);/);
  assert.match(provider, /<MissionSelectionContext\.Provider value=\{value\}>\{children\}<\/MissionSelectionContext\.Provider>/);

  const shell = code(read(SHELL));
  assert.match(shell, /import \{ MissionSelectionProvider \} from '\.\/missionSelection';/);
  assert.match(
    shell,
    /<SourcingPanelSlotProvider>\s*<MissionSelectionProvider>\s*<MissionShellFrame \/>\s*<\/MissionSelectionProvider>\s*<\/SourcingPanelSlotProvider>/,
  );
  // La coquille elle-même ne lit pas la sélection : cocher une case ne la re-rend pas.
  assert.doesNotMatch(shell.slice(shell.indexOf('function MissionShellFrame')), /useMissionSelection/);
});

test('5F2C-P3 PipelineScreen : la sélection vient du contexte, noms et textes verrouillés gardés', () => {
  const src = code(read(SCREEN));
  assert.match(src, /import \{ useMissionSelection \} from '\.\.\/shell\/missionSelectionContext';/);
  assert.match(src, /const \{ selection, setSelection \} = useMissionSelection\(\);/);
  assert.doesNotMatch(src, /useState<Map<string, MissionCandidateRow>>/, 'plus d\'état local de sélection');
  assert.match(src, /const \[selectionNote, setSelectionNote\] = useState<string \| null>\(null\);/);
  assert.match(src, /const \[contactRequest, setContactRequest\] = useState\(false\);/);
  assert.match(src, /setSelection\(new Map\(picked\.map/);
  // Une sélection déjà vide ne fait pas re-rendre les lecteurs du contexte.
  assert.match(src, /setSelection\(\(prev\) => \(prev\.size === 0 \? prev : new Map\(\)\)\);/);
  assert.doesNotMatch(src, /openContactPanel\(\)/);
  // Lot 5f-2d : le seul appel à openContactFlow est la fin de l'effet des retenus (« Contacter les N » de la
  // carte Maintenant), interrupteur allumé et au moins un retenu coché ; éteint, le focus de la barre d'avant.
  assert.match(src, /const \{ openContactFlow \} = ctx;/);
  assert.equal(src.split('openContactFlow()').length - 1, 1, 'un seul appel à openContactFlow');
  assert.doesNotMatch(src, /ctx\.openContactFlow/, 'déstructuré : le contexte change à chaque rendu');
  assert.match(src, /if \(sequencesV2 && picked\.length > 0\) openContactFlow\(\);\s*else setFocusContact\(picked\.length > 0\);/);
});

test('5F2C-P4 PipelineScreen : le remontage ne vide pas la sélection panneau Contacter ouvert, l\'écran quitté panneau fermé la vide', () => {
  const src = code(read(SCREEN));
  // État à jour du panneau, lu par une ref (le nettoyage ne voit pas le rendu courant).
  // Seul le vrai mode Contacter (interrupteur allumé, ?contacter=1) garde la sélection : l'ancien panneau et les
  // onglets Contactés et Séquences ne la lisent pas, l'écran quitté la vide comme avant.
  assert.match(src, /const contactPanelOpen = useRef\(false\);\s*contactPanelOpen\.current = location\.panel === 'contact' && sequencesV2 && searchParams\.get\('contacter'\) === '1';/);
  assert.match(src, /const sequencesV2 = useSequencesBeta\(\);/);
  // Une sélection vidée ne laisse pas sa note de plafond à l'écran.
  assert.match(src, /const selectionSize = selection\.size;\s*useEffect\(\(\) => \{\s*if \(selectionSize === 0\) setSelectionNote\(null\);\s*\}, \[selectionSize\]\);/);
  // Changement de filtre ou de vue : vide ; premier rendu : vide sauf panneau ouvert.
  assert.match(src, /const lastScope = useRef<\{ filterParam: string \| null; view: PipelineViewMode \} \| null>\(null\);/);
  const effect = src.match(/useEffect\(\(\) => \{\s*const before = lastScope\.current;([\s\S]*?)\}, \[filterParam, view, clearSelection\]\);/);
  assert.ok(effect, 'effet de changement de filtre et de vue');
  assert.match(effect[1], /lastScope\.current = \{ filterParam, view \};/);
  assert.match(effect[1], /const changed = before !== null && \(before\.filterParam !== filterParam \|\| before\.view !== view\);/);
  assert.match(effect[1], /if \(changed \|\| \(before === null && !contactPanelOpen\.current\)\) clearSelection\(\);/);
  // Nettoyage au démontage, sauf panneau Contacter ouvert.
  assert.match(
    src,
    /useEffect\(\s*\(\) => \(\) => \{\s*if \(!contactPanelOpen\.current\) clearSelection\(\);\s*\},\s*\[clearSelection\],\s*\);/,
  );
  // L'ancien effet inconditionnel a disparu.
  assert.doesNotMatch(src, /useEffect\(\(\) => \{\s*clearSelection\(\);\s*\}, \[filterParam, view, clearSelection\]\);/);
});

// ─── Adresse ────────────────────────────────────────────────────────────────

test('5F2C-P5 adresse : contacter=1 est un paramètre local, retiré à la fermeture, à l\'ouverture d\'une fiche et du panneau simple', () => {
  const src = code(read(WORKSPACE));
  assert.match(src, /const CONTACT_PARAM = 'contacter';/);
  assert.match(src, /const PANEL_PARAMS: readonly string\[\] = \[V3_PARAM\.panel, V3_PARAM\.candidate, OUTREACH_TAB_PARAM, CONTACT_PARAM\];/);
  // Fiche et panneau simple retirent le mode ; le mode Contacter pose panneau et paramètre, retire la fiche.
  assert.match(src, /openPanel\(\{ \[V3_PARAM\.panel\]: 'fiche', \[V3_PARAM\.candidate\]: rowId \}, \[OUTREACH_TAB_PARAM, CONTACT_PARAM\], opts\);/);
  assert.match(src, /openPanel\(\{ \[V3_PARAM\.panel\]: 'contact' \}, \[V3_PARAM\.candidate, CONTACT_PARAM\]\);/);
  assert.match(
    src,
    /const openContactFlow = useCallback\(\(\) => \{\s*openPanel\(\{ \[V3_PARAM\.panel\]: 'contact', \[CONTACT_PARAM\]: '1' \}, \[V3_PARAM\.candidate\]\);\s*\}, \[openPanel\]\);/,
  );
  // Exposé dans la valeur du contexte et ses dépendances (une fois chacun).
  assert.equal(src.split('      openContactFlow,\n').length - 1, 2, 'valeur et dépendances');
  assert.match(code(read(TYPES)), /openContactFlow: \(\) => void;/);

  // L'adresse lue par la page ne change pas : le mode n'est ni un champ ni une valeur de ?panneau=.
  const beta = read('src/lib/missionBeta.ts');
  assert.doesNotMatch(beta, /contacter/);
  assert.match(code(beta), /panel: 'panneau',\s*candidate: 'candidat',\s*bilan: 'bilan',\s*section: 'section',\s*view: 'vue',\s*stage: 'etape',/);
});

test('5F2C-P5b adresse : ?contacter=1 ne change pas la lecture de l\'adresse de la page', async (t) => {
  const beta = await loadTs(t, 'src/lib/missionBeta.ts');
  if (!beta) return;
  const loc = beta.readMissionV3Location('/missions/m1', '?panneau=contact&contacter=1');
  assert.deepEqual(loc, {
    id: 'm1', screen: 'pipeline', panel: 'contact', candidateRowId: null, bilan: false,
    section: null, view: 'liste', stage: null,
  });
  // Une fiche garde sa lecture, avec ou sans le mode.
  const fiche = beta.readMissionV3Location('/missions/m1/sourcing', '?panneau=fiche&candidat=r1&contacter=1');
  assert.equal(fiche.panel, 'fiche');
  assert.equal(fiche.candidateRowId, 'r1');
  assert.equal(fiche.screen, 'sourcing');
});

// ─── Bouton « Contacter » ───────────────────────────────────────────────────

test('5F2C-P6 ContactSelectionButton : allumé il ouvre le panneau, éteint le menu d\'avant est inchangé', () => {
  const src = code(read(BUTTON));
  assert.match(src, /import \{ useSequencesBeta \} from '@\/hooks\/useSequencesBeta';/);
  assert.match(src, /const sequencesV2 = useSequencesBeta\(\);/);
  assert.match(src, /const \{ openContactFlow \} = useMissionV3\(\);/);
  assert.match(src, /const \{ selection, setSelection \} = useMissionSelection\(\);/);

  // Geste : la sélection devient les lignes reçues si elles diffèrent, puis le panneau s'ouvre.
  assert.match(src, /const same = rows\.length === selection\.size && rows\.every\(\(row\) => selection\.has\(row\.id\)\);/);
  assert.match(src, /if \(!same\) setSelection\(new Map\(rows\.map\(\(row\) => \[row\.id, row\] as const\)\)\);\s*openContactFlow\(\);/);

  // Disponibilité : le compte, disabled et des lignes. Les lignes sans profil LinkedIn ne comptent plus ici.
  assert.match(src, /const nothingToContact = sequencesV2 \? rows\.length === 0 : profiles\.length === 0;/);
  assert.match(src, /\} else if \(disabled \|\| !selectedAccount \|\| nothingToContact\) \{\s*control = \(\s*<Button variant="primary" size="sm" disabled>/);
  assert.match(src, /\} else if \(sequencesV2\) \{\s*control = \(\s*<Button type="button" variant="primary" size="sm" className="max-sm:min-h-11" onClick=\{openFlow\}>\s*<Send className="mr-1\.5 h-4 w-4" aria-hidden="true" \/>\s*Contacter\s*<\/Button>/);
  assert.match(src, /const note = noAccount \? 'Reliez votre compte LinkedIn pour contacter\.' : sequencesV2 \? null : missing;/);
  assert.match(src, />\s*Relier LinkedIn\s*<\/Link>/);

  // Éteint : le menu « Séquence » et le texte des lignes laissées de côté, comme avant.
  assert.match(src, /\} else \{\s*control = \(\s*<div role="group" aria-label="Contacter" className=\{cn\('inline-flex', FILLED_TRIGGER\)\}>\s*<SequenceEnrollButton\s+selectedProfiles=\{profiles\}\s+accountId=\{selectedAccount\}\s+selectedJob=\{job\}\s+onSuccess=\{onSuccess\}\s+triggerLabel="Contacter"\s*\/>/);
  assert.match(src, /const withLinkedIn = useMemo\(\(\) => rows\.filter\(\(row\) => !!row\.linkedinUrl\), \[rows\]\);/);
  assert.match(src, /export function missingLinkedInText\(count: number\): string \| null \{/);
  assert.match(src, /export function missionEnrollJob\(project: SourcingProject\): SequenceEnrollJob \{/);

  // La conversion ligne vers candidat vit dans useContactCandidates.ts (un .tsx de composant n'exporte que des composants).
  assert.match(src, /import \{ rowToAtsCandidate \} from '\.\/useContactCandidates';/);
  assert.doesNotMatch(src, /function rowToAtsCandidate/);
  assert.match(code(read(CANDIDATES)), /export function rowToAtsCandidate\(row: MissionCandidateRow, project: SourcingProject\): ATSCandidate \{/);
});

// ─── Relecture des candidats ────────────────────────────────────────────────

test('5F2C-P7 useContactCandidates : lecture bornée de la mission, par lots de 100, jamais d\'écriture', () => {
  const src = code(read(CANDIDATES));
  assert.match(src, /export const CONTACT_FLOW_MAX = 400;/);
  assert.match(src, /const READ_CHUNK = 100;/);
  assert.match(src, /for \(let from = 0; from < ids\.length; from \+= READ_CHUNK\) chunks\.push\(ids\.slice\(from, from \+ READ_CHUNK\)\);/);

  // Une seule instruction : mission, jamais ouverts exclus, lot d'identifiants (garde du lot 1-2 sur la vue).
  const queries = [...src.matchAll(/\.from\('mission_candidate_rows'\)[^;]*/g)].map((m) => m[0]);
  assert.equal(queries.length, 1, 'une seule lecture de la vue');
  assert.match(queries[0], /\.select\(MISSION_ROW_LIGHT_COLUMNS\)/);
  assert.match(queries[0], /\.eq\('project_id', project\.id\)/);
  assert.match(queries[0], /\.eq\('is_unopened', false\)/);
  assert.match(queries[0], /\.in\('id', ids\)/);

  // Colonnes légères du Pipeline seulement : ni le profil, ni la distance de réseau ni l'identifiant du fournisseur
  // d'un instantané (le moteur lit network_distance de l'inscription comme une preuve de connexion).
  assert.doesNotMatch(src, /linkedin_profile_data|MISSION_ROW_DETAIL_COLUMNS|network_distance|provider_id/);

  // Relue à chaque ouverture, clé avec la mission et la signature des identifiants.
  assert.match(src, /queryKey: \['project-candidates', project\.id, 'contact-flow', signature\],/);
  assert.match(src, /enabled: enabled && ids\.length > 0,\s*staleTime: 0,\s*gcTime: 0,\s*refetchOnMount: 'always',/);
  assert.match(src, /const overflow = Math\.max\(0, rows\.length - CONTACT_FLOW_MAX\);/);
  assert.match(src, /\.slice\(0, CONTACT_FLOW_MAX\)/);

  // Profil : celui que le Pipeline fabriquait déjà, rien de plus.
  assert.match(src, /const profile = atsCandidateToProfile\(rowToAtsCandidate\(row, project\)\);/);
  // La sélection change panneau ouvert : les candidats déjà lus restent, filtrés sur la sélection, l'inscription attend.
  assert.match(src, /placeholderData: keepPreviousData,/);
  assert.match(src, /const refreshing = enabled && ids\.length > 0 && query\.isPlaceholderData;/);
  assert.match(src, /return query\.data\.filter\(\(candidate\) => wanted\.has\(candidate\.rowId\)\);/);
  assert.match(src, /id: profile\.id,\s*rowId: row\.id,\s*candidateId: row\.candidateId,\s*name: row\.name \?\? '',\s*headline: row\.headline,\s*pictureUrl: row\.pictureUrl,\s*hasLinkedIn: !!row\.linkedinUrl,\s*profile,/);
  // Ordre de la sélection, ligne disparue écartée.
  assert.match(src, /for \(const id of ids\) \{\s*const candidate = byRow\.get\(id\);\s*if \(candidate\) ordered\.push\(candidate\);/);
  // États : chargement jusqu'à la première lecture, erreur avec réessai.
  assert.match(src, /else if \(ids\.length === 0 \|\| query\.data !== undefined\) status = 'ready';/);
  assert.match(src, /else if \(query\.isError \|\| query\.fetchStatus === 'paused'\) status = 'error';/);

  // Lecture seule.
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(|\.rpc\(|from\('(job_candidate_status|sequence_enrollments|sequence_step_executions)'\)/);
  assert.doesNotMatch(src, /\bany\b/, 'aucun any');
});

// ─── Panneau ────────────────────────────────────────────────────────────────

test('5F2C-P8 ContactPanel : branche du mode Contacter entre l\'archive et l\'onglet Contactés, hooks avant la redirection', () => {
  const src = code(read(PANEL));
  assert.match(src, /import \{ ContactFlow \} from '@\/components\/sequences\/contact\/ContactFlow';/);
  assert.match(src, /const CONTACT_PARAM = 'contacter';/);
  assert.match(src, /const asksFlow = sequencesV2 && !isArchived && new URLSearchParams\(location\.search\)\.get\(CONTACT_PARAM\) === '1';/);

  // Les deux lignes repères des gardes 5F3-3 et 5F2B-10 sont intactes, la branche est entre l'archive et la première.
  assert.equal(src.split('} else if (sequencesV2) {').length - 1, 1);
  assert.equal(src.split('} else if (accountsLoading) {').length - 1, 1);
  const archived = src.indexOf('if (isArchived) {');
  const flowAt = src.indexOf('} else if (asksFlow) {');
  const v2At = src.indexOf('} else if (sequencesV2) {');
  assert.ok(archived > 0 && flowAt > archived && v2At > flowAt, 'archive, mode Contacter, onglets');
  const branch = src.slice(flowAt, v2At);
  assert.match(branch, /<SectionErrorBoundary fallbackTitle="Le panneau Contacter n'a pas pu s'afficher">/);
  assert.match(
    branch,
    /<ContactFlow\s+missionId=\{project\.id\}\s+job=\{job\}\s+candidates=\{flow\.candidates\}\s+candidatesStatus=\{flow\.status\}\s+overflow=\{flow\.overflow\}\s+refreshing=\{flow\.refreshing\}\s+onRetryCandidates=\{flow\.refetch\}\s+onEnrolled=\{onEnrolled\}\s+onOpenCandidate=\{openCandidate\}\s+onLeave=\{onLeave\}\s+preferredSequenceId=\{preferredSequenceId\}\s*\/>/,
  );
  // Lot 5f-2d : la séquence demandée par l'adresse (page d'une séquence), lue une fois à la création du panneau
  // (état local, consommée : retirée de l'adresse à l'ouverture du mode) et transmise au seul mode Contacter.
  assert.match(src, /const SEQUENCE_PARAM = 'sequence';/);
  assert.match(src, /const \[preferredSequenceId\] = useState<string \| null>\(\(\) => new URLSearchParams\(location\.search\)\.get\(SEQUENCE_PARAM\) \|\| null\);/);
  assert.equal(src.split('preferredSequenceId={').length - 1, 1, 'transmise une seule fois, à ContactFlow');
  assert.doesNotMatch(branch, /InvitationsPanel|panel-invitations|ContactedList/);

  // Hooks : avant la redirection vers la messagerie.
  const navigateAt = src.indexOf('return <Navigate');
  for (const hook of ['useMissionSelection()', 'useContactCandidates(project, [...selection.values()], asksFlow)', 'useMemo(() => missionEnrollJob(project), [project])', 'useEffect(']) {
    const at = src.indexOf(hook);
    assert.ok(at > 0 && at < navigateAt, `${hook} avant Navigate`);
  }
});

test('5F2C-P9 ContactPanel : onglet = quitter le mode, après l\'inscription ou en le quittant, rechargement sans sélection, pied masqué', () => {
  const src = code(read(PANEL));
  // Choisir un onglet retire le mode ; les deux lignes verrouillées par 5F2B-10 ne changent pas.
  assert.match(
    src,
    /params\.delete\(CONTACT_PARAM\);\s*if \(!sequencesV2 && next === 'sequences'\) params\.delete\(OUTREACH_PARAM\);\s*else params\.set\(OUTREACH_PARAM, next\);/,
  );
  // Lot 5f-2d : quitter le mode retire aussi la séquence demandée, placée avant la ligne verrouillée.
  assert.match(src, /params\.delete\(SEQUENCE_PARAM\);\s*params\.delete\(CONTACT_PARAM\);\s*if \(!sequencesV2 && next === 'sequences'\)/);
  // Inscription faite : les lignes traitées quittent la sélection, puis « Contactés ».
  const enrolled = src.match(/const onEnrolled = useCallback\(([\s\S]*?)\[setSelection, setTab\],\s*\);/);
  assert.ok(enrolled, 'onEnrolled');
  assert.match(enrolled[1], /\(handledRowIds: readonly string\[\]\) => \{/);
  assert.match(enrolled[1], /for \(const id of handled\) next\.delete\(id\);/);
  assert.match(enrolled[1], /setTab\('contactes'\);/);
  // Quitter le mode ne touche pas à la sélection.
  assert.match(src, /const onLeave = useCallback\(\(\) => setTab\('contactes'\), \[setTab\]\);/);
  // Rechargement : le mode sans sélection au montage ouvre « Contactés », une seule fois.
  assert.match(
    src,
    /const reloadChecked = useRef\(false\);\s*const selectionSize = selection\.size;\s*useEffect\(\(\) => \{\s*if \(reloadChecked\.current\) return;\s*reloadChecked\.current = true;\s*if \(asksFlow && selectionSize === 0\) setTab\('contactes'\);\s*\}, \[asksFlow, selectionSize, setTab\]\);/,
  );
  // ContactFlow a son propre pied : celui du panneau ne s'affiche pas dans ce mode.
  assert.match(src, /\{!isArchived && !asksFlow && \(\s*<div className="sticky bottom-0 mt-auto/);
  // Deux onglets seulement (garde 5F3-3).
  assert.match(src, /const TABS_V2: readonly \{ key: ContactTab; label: string \}\[\] = \[\s*\{ key: 'contactes', label: 'Contactés' \},\s*\{ key: 'sequences', label: 'Séquences' \},\s*\];/);
  // Jamais d'écriture ni de lecture directe depuis le panneau (les lectures passent par les hooks).
  assert.doesNotMatch(src, /\.from\(|\.rpc\(|\.(insert|update|upsert)\(/);
});

// ─── Textes ─────────────────────────────────────────────────────────────────

test('5F2C-P10 fichiers de la plomberie : français, sans tiret long, sans « (s) », sans nom de prestataire', () => {
  for (const rel of MY_FILES) {
    const source = read(rel);
    assert.ok(!source.includes('—'), `${rel} : pas de tiret long`);
    assert.doesNotMatch(source, /[A-Za-zÀ-ÿ]\(s\)/, `${rel} : accorder par le nombre`);
    assert.doesNotMatch(code(source), /\b(Unipile|Apollo|PDL|People Data Labs|Anthropic|Claude|Notion)\b/, `${rel} : nom de prestataire`);
    assert.doesNotMatch(code(source), /\bwindow\.confirm\b|\btrackEvent\b|\blocalStorage\b/, `${rel} : confirm, mesure ou stockage local`);
    assert.doesNotMatch(source, /<input\b|<select\b|<textarea\b/, `${rel} : champ brut`);
    // Le seul <button> brut du lot est l'onglet de ContactPanel, d'avant (dette du cliquet de design).
    assert.equal(source.split('<button').length - 1, rel === PANEL ? 1 : 0, `${rel} : bouton brut`);
  }
});

// ─── Défauts confirmés par la relecture indépendante ────────────────────────

test('5F2C-R9 ContactPanel : l\'adresse est lue à l\'appel, une fin d\'inscription tardive ne renavigue pas', () => {
  const src = code(read(PANEL));
  assert.match(src, /const locationRef = useRef\(location\);\s*locationRef\.current = location;/);
  assert.match(src, /const mounted = useRef\(true\);/);
  // setTab lit l'adresse la plus récente et ne dépend plus des champs figés de useLocation.
  const setTab = src.slice(src.indexOf('const setTab = useCallback('), src.indexOf('// Mode Contacter : les lignes cochées'));
  assert.match(setTab, /const current = locationRef\.current;/);
  assert.match(setTab, /\[navigate, sequencesV2\],/);
  assert.doesNotMatch(setTab, /location\.(pathname|search|state)/);
  // La fin d'inscription retire toujours les lignes, et ne navigue que si le panneau est monté et encore en mode Contacter.
  const enrolled = src.slice(src.indexOf('const onEnrolled = useCallback('), src.indexOf('const onLeave = useCallback('));
  assert.match(enrolled, /setSelection\(\(prev\) => \{/);
  assert.match(enrolled, /if \(!mounted\.current\) return;/);
  assert.match(enrolled, /new URLSearchParams\(locationRef\.current\.search\)\.get\(CONTACT_PARAM\) !== '1'/);
  assert.ok(enrolled.indexOf('setSelection(') < enrolled.indexOf('if (!mounted.current) return;'), 'sélection retirée avant le garde de navigation');
});

test('5F2C-R10 ContactPanel : le focus revient au titre quand le mode Contacter est quitté', () => {
  const src = code(read(PANEL));
  assert.match(src, /const wasFlow = useRef\(false\);/);
  assert.match(src, /if \(wasFlow\.current && !asksFlow\) document\.getElementById\(titleId\)\?\.focus\(\{ preventScroll: true \}\);/);
  assert.match(src, /refreshing=\{flow\.refreshing\}/);
});
