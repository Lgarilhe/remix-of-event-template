/**
 * Refonte mission, lot 3 : garde-fous statiques des écrans de la carte
 * « Maintenant » (NowCard, ThenLine, hooks de lecture et de report, câblage de
 * PipelineScreen, remplacement de la règle provisoire).
 *
 * Même forme que lot3-regle.test.mjs : lecture des sources, assertions sur les
 * motifs, sans navigateur, sans base, sans esbuild.
 *  - la carte est posée au-dessus des deux vues, dans sa propre
 *    SectionErrorBoundary ;
 *  - chaque intention de bouton de la règle a son geste dans PipelineScreen ;
 *  - provisionalNextAction n'existe plus, les trois consommateurs passent par
 *    rowNextAction ;
 *  - « Plus tard » ne touche jamais aux notifications, aux rappels ni à la
 *    barre latérale ; les écritures de report relisent la ligne écrite ;
 *  - états des sources : jamais le plan par défaut, jamais le compte d'un
 *    collègue, jamais un zéro inventé ;
 *  - accessibilité et téléphone : région nommée, zone annoncée, un seul bouton
 *    plein, pas de barre fixe, pas de fenêtre surgissante.
 *
 * Lancer : node --test tests/c1/lot3-ecrans.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** Code sans commentaires : blocs et fins de ligne (« https:// » reste). */
function stripComments(src) {
  return src
    .replace(/(^|[\s{(])\/\*[\s\S]*?\*\//g, '$1')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}
const code = (rel) => stripComments(read(rel));

const RULE = 'src/lib/missionNextAction.ts';
const ATTENTION = 'src/hooks/useMissionAttention.ts';
const SNOOZES = 'src/hooks/useMissionActionSnoozes.ts';
const NOW_HOOK = 'src/hooks/useMissionNow.ts';
const CARD = 'src/components/missions/v3/pipeline/NowCard.tsx';
const THEN = 'src/components/missions/v3/pipeline/ThenLine.tsx';
const SCREEN = 'src/components/missions/v3/pipeline/PipelineScreen.tsx';
const ROW = 'src/components/missions/v3/pipeline/CandidateListRow.tsx';
const LIST = 'src/components/missions/v3/pipeline/CandidateList.tsx';
const BOARD = 'src/components/missions/v3/pipeline/MissionBoard.tsx';
const HEADER = 'src/components/missions/v3/panels/CandidatePanelHeader.tsx';
const TYPES = 'src/components/missions/v3/types.ts';

const CARD_FILES = [ATTENTION, SNOOZES, NOW_HOOK, CARD, THEN];

// ─── Fichiers ───────────────────────────────────────────────────────────────

test('lot 3 écrans : les hooks et les composants de la carte existent', () => {
  for (const rel of CARD_FILES) assert.ok(existsSync(join(ROOT, rel)), `${rel} absent`);
});

// ─── Câblage de l'écran ─────────────────────────────────────────────────────

test('lot 3 écrans : la carte est posée en tête de PipelineScreen, dans sa propre SectionErrorBoundary', () => {
  const src = code(SCREEN);
  assert.match(src, /import \{ SectionErrorBoundary \} from '@\/components\/SectionErrorBoundary';/);
  assert.match(src, /import \{ NowCard \} from '\.\/NowCard';/);
  const boundary = src.match(/<SectionErrorBoundary[^>]*>\s*<NowCard\b[^>]*\/>\s*<\/SectionErrorBoundary>/);
  assert.ok(boundary, 'NowCard dans un SectionErrorBoundary qui ne contient qu\'elle');
  // Au-dessus de la barre d'étapes, donc des deux vues (liste et kanban).
  assert.ok(src.indexOf('<NowCard') < src.indexOf('<StageBar'), 'la carte précède la barre d\'étapes');
  assert.ok(src.indexOf('<NowCard') < src.indexOf('<PipelineListView'), 'la carte précède la liste');
  assert.ok(src.indexOf('<NowCard') < src.indexOf('<MissionBoard'), 'la carte précède le kanban');
  assert.match(src, /isOwnMission=\{ctx\.isOwnMission\}/, 'pas de carte sur une mission d\'une autre organisation');
});

test('lot 3 écrans : chaque intention de la règle a son geste dans PipelineScreen', () => {
  const rule = code(RULE);
  const union = rule.match(/export type ActionIntent =([\s\S]*?);\n/);
  assert.ok(union, 'union ActionIntent introuvable');
  const intents = [...union[1].matchAll(/type: '(\w+)'/g)].map((m) => m[1]);
  assert.ok(intents.length >= 10, `intentions lues : ${intents.join(', ')}`);
  const src = code(SCREEN);
  const run = src.match(/const runIntent = useCallback\(([\s\S]*?)\n  \);/);
  assert.ok(run, 'runIntent introuvable');
  for (const intent of intents) assert.match(run[1], new RegExp(`case '${intent}':`), `geste de « ${intent} »`);
  // Gestes existants, pas de nouvelle voie.
  assert.match(run[1], /ctx\.openCandidate\(intent\.rowId\)/);
  assert.match(run[1], /ctx\.goToScreen\('sourcing'\)/);
  assert.match(run[1], /ctx\.goToScreen\('cadrage', \{ section: intent\.section \}\)/);
  assert.match(run[1], /navigate\(SETTINGS_PATHS\.connections\)/);
  assert.match(run[1], /navigate\(SETTINGS_PATHS\.general\)/);
  assert.match(run[1], /\/inbox\?chatId=\$\{encodeURIComponent\(intent\.chatId\)\}/);
  assert.doesNotMatch(src, /window\.open\(/, 'pas de fenêtre surgissante');
});

test('lot 3 écrans : « Trier » efface la vue et l\'étape avant d\'ouvrir la section', () => {
  const src = code(SCREEN);
  const open = src.match(/const openToSort = useCallback\(([\s\S]*?)\n  \}, \[setParams\]\);/);
  assert.ok(open, 'openToSort introuvable');
  assert.match(open[1], /setToSortOpen\(true\)/);
  assert.match(open[1], /setParams\(\{ \[V3_PARAM\.stage\]: null, \[V3_PARAM\.view\]: null \}\)/);
});

test('lot 3 écrans : « Contacter les N » filtre sur Retenu, coche les retenus, puis met le focus sur « Contacter » de la barre', () => {
  const src = code(SCREEN);
  assert.match(src, /useMissionCandidateRows\(project\.id, RETAINED_FILTER,/);
  assert.match(src, /const contactRetained = useCallback\(\(\) => \{\s*setParams\(\{ \[V3_PARAM\.stage\]: 'retained', \[V3_PARAM\.view\]: null \}\);\s*setSelectionNote\(null\);\s*setContactRequest\(true\);/);
  // Les retenus ne sont lus qu'à la demande : pas de page lue à chaque arrivée ni à chaque retour de focus.
  assert.match(src, /enabled: contactRequest && counts !== null && counts\.retained > 0/);
  // La sélection est posée après le changement de filtre (qui la vide).
  assert.match(src, /filterParam !== 'retained' \|\| view !== 'liste'/);
  assert.match(src, /setSelection\(new Map\(picked\.map/);
  assert.match(src, /rows\.slice\(0, RETAINED_SELECTION_MAX\)/);
  // Le panneau de contact ne reçoit aucune sélection : « Contacter les N » ne l'ouvre pas, le geste est dans la barre.
  assert.doesNotMatch(src, /openContactPanel\(\)/);
  assert.match(src, /\[data-bulk-bar\] button/);
  assert.match(src, /startsWith\('Contacter'\)/);
  // Plafond et échec de lecture dits à l'écran, jamais en silence.
  assert.match(src, /une sélection groupée est limitée à/);
  assert.match(src, /Les retenus n\\'ont pas pu être lus/);
  assert.match(src, /<p role="status"[^>]*>\s*\{selectionNote\}/);
});

// ─── Remplacement de la règle provisoire ────────────────────────────────────

test('lot 3 écrans : provisionalNextAction n\'existe plus, les consommateurs passent par rowNextAction', () => {
  assert.doesNotMatch(code(TYPES), /provisionalNextAction|ProvisionalNextAction/);
  for (const rel of [ROW, BOARD, HEADER, LIST]) {
    assert.doesNotMatch(code(rel), /provisionalNextAction/, rel);
  }
  assert.match(code(ROW), /rowNextAction\(row, signals \?\? signalsWithout\(now\)\)/);
  assert.match(code(BOARD), /rowNextAction\(row, signals\)/);
  const header = code(HEADER);
  assert.match(header, /rowNextAction\(row, useMissionRowSignals\(project\)\)/);
  assert.match(header, /import \{ useMissionV3 \} from '\.\.\/MissionV3Context';/);
  // Un seul calcul des signaux par mission, passé aux lignes (pas de requête par carte).
  const screen = code(SCREEN);
  assert.match(screen, /const rowSignals = useMissionRowSignals\(project\);/);
  assert.equal([...screen.matchAll(/signals=\{rowSignals\}/g)].length, 2, 'kanban et liste reçoivent les signaux');
  assert.doesNotMatch(code(BOARD), /useQuery|supabase/, 'aucune lecture par carte');
});

// ─── Lectures ───────────────────────────────────────────────────────────────

test('lot 3 écrans : useMissionAttention, clé sous mission-stage-counts, 30 s, retour de focus, 5 éléments au moins', () => {
  const src = code(ATTENTION);
  assert.match(src, /rpc\('get_mission_attention'/);
  assert.match(src, /queryKey: \['mission-stage-counts', 'attention', ids\]/);
  assert.match(src, /MISSION_ATTENTION_STALE_TIME = 30_000/);
  assert.match(src, /refetchOnWindowFocus: true/);
  const limit = src.match(/MISSION_ATTENTION_ITEM_LIMIT = (\d+)/);
  assert.ok(limit && Number(limit[1]) >= 5, 'au moins 5 éléments demandés (sinon les rangs 3 et 6 sont indisponibles)');
  assert.match(src, /p_item_limit: MISSION_ATTENTION_ITEM_LIMIT/);
  assert.match(src, /parseAttentionRow/);
});

test('lot 3 écrans : useMissionNow, états de source jamais confondus avec un zéro', () => {
  const src = code(NOW_HOOK);
  // LinkedIn : état strict de la personne, pas le compte d'un collègue ni le seul chiffre de la barre.
  assert.match(src, /resolveMyLinkedInStatus\(\{/);
  assert.match(src, /linkedinSource\(linkedinState\)/);
  assert.doesNotMatch(src, /useLinkedInOutage|useFilteredLinkedInAccounts/);
  // Formule : lue dans l'état, jamais le plan par défaut d'un état pas encore lu.
  assert.match(src, /subscription\.state\s*\?\s*hasPlanFeature\(subscription\.effectivePlanId, 'sequences_send'\)/);
  assert.match(src, /subscription\.isLoadingError/);
  assert.doesNotMatch(src, /hasFeature\(/);
  // Type d'organisation : chargement tant que l'organisation se lit.
  assert.match(src, /if \(orgLoading\) orgTypeSource = SOURCE_LOADING/);
  // Effectifs et attention : une mission non rendue est une erreur, jamais des zéros.
  assert.match(src, /countsQuery\.isSuccess && countsRow === null/);
  assert.match(src, /attentionQuery\.isSuccess && attentionRow === null/);
  assert.match(src, /offline: !online/);
  // L'heure se rafraîchit à la minute et au retour de focus.
  assert.match(src, /CARD_CLOCK_MS = 60_000/);
  assert.match(src, /addEventListener\('focus', tick\)/);
  assert.match(src, /visibilitychange/);
  // Une seule règle, partagée.
  assert.match(src, /computeNowCard\(\{/);
  assert.match(src, /buildRowSignals\(\{/);
});

// ─── Reports « Plus tard » ──────────────────────────────────────────────────

test('lot 3 écrans : le report relit la ligne écrite et traite un refus qui rend 0 ligne', () => {
  const src = code(SNOOZES);
  assert.match(src, /\.from\('mission_action_snoozes'\)\s*\.upsert\(/);
  assert.match(src, /onConflict: 'user_id,project_id,action_key'/);
  assert.match(src, /\.upsert\([\s\S]*?\.select\(COLUMNS\)\s*\.single\(\)/);
  assert.match(src, /\.delete\(\)[\s\S]*?\.select\('id'\)/);
  assert.match(src, /data\.length === 0\) throw/);
  // Le report passe par nextLocalMorning (demain 6 h), jamais un ajout de millisecondes.
  assert.match(src, /nextLocalMorning\(new Date\(\)\)/);
  assert.doesNotMatch(src, /86_?400_?000|24 \* 60 \* 60/);
  // Pas de succès avant l'écriture : aucune mise à jour optimiste du cache.
  assert.doesNotMatch(src, /onMutate/);
  assert.match(src, /toast\.error\(SNOOZE_FAILED\)/);
  assert.match(src, /queryKey = \['mission-action-snoozes', userId\]|\['mission-action-snoozes', userId\] as const/);
  assert.match(src, /onlineManager/, 'hors ligne : l\'écriture est grisée');
});

test('lot 3 écrans : « Plus tard » n\'écrit ni dans les notifications, ni dans les rappels, ni sur la barre latérale', () => {
  for (const rel of CARD_FILES) {
    const src = code(rel);
    assert.doesNotMatch(src, /from\(\s*['"](notifications|candidate_reminders)['"]\s*\)/, `${rel} : table des notifications ou des rappels`);
    assert.doesNotMatch(src, /\bmarkRead\b|markAllForYouRead|useSidebar|useTodoSignal|todoCount/, `${rel} : chiffre d'À traiter`);
    assert.doesNotMatch(src, /@\/hooks\/sidebar\//, `${rel} : import de la barre latérale`);
    assert.doesNotMatch(src, /\[\s*['"]sidebar['"]/, `${rel} : clé React Query de la barre latérale`);
  }
});

// ─── Carte : accessibilité, téléphone, un seul bouton plein ─────────────────

test('lot 3 écrans : région nommée, zone annoncée dès le montage, focus rendu après « Plus tard »', () => {
  const src = code(CARD);
  assert.match(src, /<section ref=\{sectionRef\} data-testid="now-card" aria-labelledby="now-card-title"/);
  assert.match(src, /<h2\s+id="now-card-title"[\s\S]*?tabIndex=\{-1\}/);
  assert.match(src, /aria-live="polite"/);
  assert.match(src, /aria-atomic="true"/);
  // La zone annoncée est rendue quel que soit l'état (hors « hidden »), donc présente dès le montage.
  assert.ok(src.indexOf('aria-live="polite"') < src.indexOf("state === 'loading' && <CardLoading"), 'zone annoncée avant les états');
  assert.match(src, /titleRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(src, /Reporté à demain\./);
  // « Plus tard » grisé sans perdre le focus : aria-disabled, pas disabled.
  assert.match(src, /aria-disabled=\{busy \|\| !online\}/);
  assert.doesNotMatch(src, /(^|[^-])\bdisabled=\{/);
  // « Pourquoi maintenant ? » : panneau repliable (aria-expanded et aria-controls posés par le composant).
  assert.match(src, /<Collapsible open=\{whyOpen\}/);
  assert.match(src, /\{WHY_LABEL\}/);
  assert.match(src, /\{LATER_LABEL\}/);
  assert.match(src, /\{RESUME_LABEL\}/);
});

test('lot 3 écrans : un seul bouton plein, pas de barre fixe, pas de fenêtre surgissante, tailles nommées', () => {
  for (const rel of [CARD, THEN]) {
    const src = code(rel);
    assert.ok([...src.matchAll(/variant="primary"/g)].length <= 1, `${rel} : un seul bouton plein`);
    assert.doesNotMatch(src, /\bfixed\b|\bsticky\b/, `${rel} : barre fixe (lot 10)`);
    assert.doesNotMatch(src, /window\.open|window\.location/, rel);
    assert.doesNotMatch(src, /text-\[\d/, `${rel} : taille arbitraire (paliers nommés)`);
    assert.doesNotMatch(src, /\bas any\b/, rel);
  }
  assert.equal([...code(CARD).matchAll(/variant="primary"/g)].length, 1, 'le bouton plein de la carte');
  // Téléphone : bouton pleine largeur, cibles de 44 px, ligne « Ensuite » repliée sur « N autres ».
  const card = code(CARD);
  assert.match(card, /w-full max-sm:h-11 sm:w-auto/);
  assert.match(card, /max-sm:min-h-11/);
  const then = code(THEN);
  assert.match(then, /max-sm:hidden/);
  assert.match(then, /aria-expanded=\{expanded\}/);
});

test('lot 3 écrans : réserve de hauteur au chargement, source indisponible dite avec « Réessayer »', () => {
  const card = code(CARD);
  assert.match(card, /function CardLoading\(\)/);
  assert.match(card, /aria-busy="true"/);
  assert.match(card, /result\.unavailableLine/);
  assert.match(card, /role="status"/);
  assert.match(card, />\s*Réessayer\s*</);
  assert.match(code(THEN), /data-testid="then-line-loading"/);
  assert.match(card, /loading=\{state === 'loading' \|\| result\.thenLoading\}/);
  // Mission archivée ou d'une autre organisation : aucune carte.
  assert.match(card, /if \(state === 'hidden'\) return null;/);
});

test('lot 3 écrans : les actions sans geste restent du texte, un mailto est un lien', () => {
  const then = code(THEN);
  assert.match(then, /if \(!button\) return <span/);
  assert.match(then, /intent\.type === 'mailto'[\s\S]*?<a href=\{button\.intent\.href\}/);
  const card = code(CARD);
  assert.match(card, /<a href=\{button\.intent\.href\}>/);
});

// ─── CI ─────────────────────────────────────────────────────────────────────

test('lot 3 écrans : la CI joue les gardes du lot 3 (glob tests/c1/lot3-*)', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /node --test tests\/c1\/lot3-\*\.test\.mjs/);
});

// ─── Corrections de relecture (lot 3, passe 2) ──────────────────────────────

test('lot 3 écrans : une seule mission lit tous les éléments d\'attention (carte, colonne, en-tête)', () => {
  const att = code(ATTENTION);
  const detail = Number(/MISSION_ATTENTION_DETAIL_ITEM_LIMIT = (\d+)/.exec(att)?.[1]);
  assert.ok(detail > 5 && detail <= 200, `MISSION_ATTENTION_DETAIL_ITEM_LIMIT = ${detail}`);
  assert.match(att, /p_item_limit: MISSION_ATTENTION_DETAIL_ITEM_LIMIT/);
  assert.match(att, /queryKey: \['mission-stage-counts', 'attention', 'detail', id\]/);
  const hook = code(NOW_HOOK);
  assert.equal((hook.match(/useMissionAttentionDetail\(project\.id\)/g) ?? []).length, 2, 'carte et colonne');
  assert.doesNotMatch(hook, /useMissionAttention\(/);
});

test('lot 3 écrans : la carte attend la lecture des reports, la colonne ne marque rien tant qu\'ils manquent', () => {
  const hook = code(NOW_HOOK);
  assert.match(hook, /const snoozesWaiting = snoozes\.isLoading;/);
  assert.match(hook, /snoozesWaiting\s*\?\s*SOURCE_LOADING/);
  assert.match(hook, /snoozes\.isLoading \? null :/);
});

test('lot 3 écrans : mission archivée, la colonne retombe sur son texte de repos', () => {
  const hook = code(NOW_HOOK);
  assert.match(hook, /project\.status === 'archived'/);
  assert.match(hook, /archived \? ALL_PAUSED : snoozeChecker/);
});

test('lot 3 écrans : hors ligne, « Plus tard » ne promet pas une reprise à la reconnexion', () => {
  const src = read(CARD);
  assert.doesNotMatch(src, /reprendra à la reconnexion/);
  assert.match(src, /n'est pas disponible\. Réessayez à la reconnexion/);
});
