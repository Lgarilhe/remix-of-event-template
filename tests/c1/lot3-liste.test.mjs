/**
 * Refonte mission, lot 3 : garde-fous statiques de la ligne de prochaine
 * action de la liste des missions (src/components/outreach/projects/
 * ProjectsListV2.tsx et src/hooks/useMissionAttention.ts).
 *
 * Même forme que lot0c3-vues.test.mjs : lecture du source et assertions sur
 * les motifs, sans navigateur ni base. La règle elle-même (missionListAction)
 * est jouée par tests/ux/lot3-maintenant.test.mjs.
 *  - la ligne vient de la règle unique, pas d'un calcul local ;
 *  - une seule requête d'attention pour toutes les missions, avec assez
 *    d'éléments pour nommer une réponse ou un entretien ;
 *  - les reports sont lus, jamais écrits, et ne touchent ni notifications ni
 *    barre latérale ;
 *  - trois états visibles : attente (hauteur réservée), indisponible avec
 *    Réessayer, rien (jamais « Rien ne presse », mais la même hauteur) ;
 *  - le clic ouvre la fiche du candidat ou l'écran voulu, sans ?tab= ;
 *  - textes : ni nom de prestataire, ni tiret long, ni confirm natif ;
 *  - design simplifié (04/10/2026) : logo du client et visages, aucun zéro écrit,
 *    colonnes vides retirées, un seul bouton plein, aucun cadre autour des
 *    groupes, menu de ligne révélé sans display:none, couleur orange réservée
 *    à la réponse qui attend.
 *
 * Lancer : node --test tests/c1/lot3-liste.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const LIST = 'src/components/outreach/projects/ProjectsListV2.tsx';
const ATTENTION = 'src/hooks/useMissionAttention.ts';
const SNOOZES = 'src/hooks/useMissionActionSnoozes.ts';

test('lot 3 liste : la ligne vient de missionListAction, sur les missions En cours seulement', () => {
  const src = code(LIST);
  assert.match(src, /import \{[^}]*missionListAction[^}]*\} from '@\/lib\/missionNextAction'/);
  assert.match(src, /import \{ snoozeChecker \} from '@\/lib\/missionSnooze'/);
  assert.match(src, /missionListAction\(\{/);
  // Les compteurs sont ceux que la liste lit déjà : pas de seconde lecture.
  assert.match(src, /counts: sourceOfValue\(counts\?\.\[id\] \?\? null, countsWaiting\)/);
  assert.match(src, /attention: sourceOfValue\(attention\?\.\[id\] \?\? null, attentionWaiting\)/);
  assert.match(src, /snoozed: snoozeChecker\(snoozes, id, now\)/);
  // Boucle sur les missions En cours : les terminées et archivées n'ont pas de ligne.
  assert.match(src, /for \(const p of ongoingProjects\)/);
  assert.match(src, /const ongoingIds = useMemo\(\(\) => ongoingProjects\.map\(p => p\.sourcingProject\.id\)/);
  assert.match(src, /useMissionAttention\(ongoingIds\)/);
  // Les reports sont ceux de la carte : un « Plus tard » posé sur la mission se voit dans la liste.
  assert.match(src, /useMissionActionSnoozes\(\)/);
  // La règle n'est pas recopiée : aucun rang, aucun seuil, aucune phrase d'action dans la liste.
  assert.doesNotMatch(src, /REPLY_MAX_AGE_DAYS|INTERVIEW_WAIT_DAYS|RANK_ORDER|computeNowCard|rowNextAction/);
  assert.doesNotMatch(src, /Contacter les|Trier les|Répondre à|Décrire le poste|Chercher des profils/);
  // Pas de tri par urgence : l'ordre reste la dernière activité.
  assert.match(src, /const byActivity = /);
  assert.doesNotMatch(src, /sort\([^)]*(action|rank)/i);
});

test('lot 3 liste : trois états visibles, jamais « Rien ne presse », jamais un zéro', () => {
  const src = code(LIST);
  // Attente : un bloc gris, hauteur réservée.
  assert.match(src, /action\.state === 'loading'/);
  assert.match(src, /<Skeleton className="h-3\.5 w-44 max-w-full" aria-hidden="true" \/>/);
  assert.match(src, /Chargement de la prochaine action/);
  // Indisponible : phrase et Réessayer.
  assert.match(src, /action\.state === 'unavailable'/);
  assert.match(src, /Impossible de vérifier\./);
  assert.match(src, /Réessayer/);
  assert.match(src, /onRetry\(\)/);
  // Rien : aucun texte, mais la même hauteur que l'attente (la liste ne saute pas au chargement).
  assert.match(src, /action\.state !== 'none'/);
  assert.match(src, /aria-hidden=\{action\.state === 'none' \? true : undefined\}/);
  assert.doesNotMatch(src, /if \(action\.state === 'none'\) return null/);
  assert.match(src, /className="mt-1 flex h-5 min-w-0 items-center text-sm outline-none max-sm:h-11"/);
  // Cible tactile : 44 px sous 640 px, pour le lien d'action comme pour Réessayer.
  const actionLine = src.slice(src.indexOf('const ActionLine'), src.indexOf('interface MissionRowProps'));
  assert.equal((actionLine.match(/max-sm:min-h-11/g) ?? []).length, 2);
  assert.doesNotMatch(src, /max-sm:min-h-8|max-sm:h-8/);
  // Réessayer : le bouton est démonté quand la relecture repasse en attente, le focus va d'abord à la racine.
  assert.match(src, /const rootRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(src, /rootRef\.current\?\.focus\(\);\s*onRetry\(\);/);
  assert.match(src, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); retry\(\); \}\}/);
  assert.doesNotMatch(src, /Rien ne presse|Rien d'autre à faire|Aucune action à proposer/);
  // Hors ligne : une requête en pause est « indisponible », pas une attente sans fin.
  assert.match(src, /fetchStatus !== 'paused'/);
  // Un report non lu : on attend, une action ne paraît pas puis disparaît.
  assert.match(src, /snoozesWaiting \? LOADING_ACTION/);
  // Pas de rang 0 par ligne : la liste ne lit ni LinkedIn ni le plan ni le type d'organisation.
  assert.doesNotMatch(src, /resolveMyLinkedInStatus|useSubscriptionState|useLinkedInStatus|linkedinSource/);
});

test('lot 3 liste : le clic ouvre la fiche du candidat ou l\'écran voulu, sans ?tab=', () => {
  const src = code(LIST);
  assert.doesNotMatch(src, /\?tab=/);
  assert.match(src, /function actionPath\(missionId: string, intent: ActionIntent \| null\): string/);
  assert.match(src, /case 'open_row':[\s\S]{0,160}\[V3_PARAM\.panel\]: 'fiche', \[V3_PARAM\.candidate\]: intent\.rowId/);
  assert.match(src, /case 'open_conversation':[\s\S]{0,80}\/inbox\?chatId=\$\{encodeURIComponent\(intent\.chatId\)\}/);
  assert.match(src, /case 'filter_stage':[\s\S]{0,120}\[V3_PARAM\.stage\]: intent\.stage/);
  // « Trier N profils notés » : la section À trier est repliée sous la liste, sans adresse pour l'ouvrir ; la liste filtrée sur À trier est celle qu'une adresse atteint.
  assert.match(src, /case 'open_to_sort':[\s\S]{0,120}\[V3_PARAM\.stage\]: 'to_sort'/);
  assert.match(src, /case 'open_sourcing':[\s\S]{0,80}'sourcing'/);
  assert.match(src, /case 'open_cadrage':[\s\S]{0,120}'cadrage'/);
  assert.match(src, /default:\s*return missionV3Path\(missionId\)/);
  // La ligne d'action n'ouvre pas aussi la mission : l'évènement s'arrête au bouton.
  assert.match(src, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); onAction\(\); \}\}/);
  // Le clic sur la ligne entière reste « ouvrir la mission » (garde 0c-3).
  assert.match(src, /onOpen=\{\(\) => navigateToWorkspace\(project\)\}/);
});

test('lot 3 liste : une requête d\'attention pour toutes les missions En cours, avec assez d\'éléments', () => {
  const src = code(ATTENTION);
  assert.match(src, /supabase\.rpc\('get_mission_attention', \{/);
  // La règle veut au moins 5 éléments : avec 0, rangs 3 et 6 muets ou « non vérifiés ».
  const limit = Number(/MISSION_ATTENTION_ITEM_LIMIT = (\d+)/.exec(src)?.[1]);
  assert.ok(limit >= 5, `MISSION_ATTENTION_ITEM_LIMIT = ${limit}`);
  assert.match(src, /p_item_limit: MISSION_ATTENTION_ITEM_LIMIT/);
  // Jamais de zéro inventé : une erreur est propagée.
  assert.match(src, /if \(error\) throw error/);
  // Relue avec les compteurs d'étapes (invalidateStageReaders) et au retour sur l'onglet.
  assert.match(src, /queryKey: \['mission-stage-counts', 'attention', ids\]/);
  assert.match(src, /refetchOnWindowFocus: true/);
  // La liste n'appelle la fonction qu'une fois, pour les missions En cours (garde de la section 1).
  assert.equal((code(LIST).match(/useMissionAttention\(/g) ?? []).length, 1);
  assert.equal((code(LIST).match(/get_mission_attention/g) ?? []).length, 0);
});

test('lot 3 liste : la liste lit les reports, ne les écrit jamais, et ne touche ni notifications ni barre', () => {
  const list = code(LIST);
  assert.doesNotMatch(list, /\.snooze\(|\.unsnooze\(|\bsnooze,|\bunsnooze,|from\('mission_action_snoozes'\)/);
  assert.match(code(SNOOZES), /\['mission-action-snoozes', userId\]/);
  for (const rel of [LIST, ATTENTION]) {
    assert.doesNotMatch(code(rel), /from\('notifications'\)|candidate_reminders|\['sidebar'/, rel);
  }
});

test('lot 3 liste : textes, aucun prestataire, tiret long, confirm natif ni mesure d\'usage', () => {
  const VENDORS = /\b(Unipile|Apollo|Anthropic|Claude|Resend|Stripe|BetterContact|People Data Labs|PDL|Brandfetch|Clearbit|Coresignal|OpenAI)\b/i;
  const src = read(LIST);
  assert.doesNotMatch(src, VENDORS);
  assert.doesNotMatch(src, /[\u2013\u2014]/, 'tiret long');
  assert.doesNotMatch(code(LIST), /window\.confirm|trackEvent/);
});

// ─── Design simplifié : liste des missions (docs/design/06-simplicite.md) ───

const FORMAT = 'src/components/outreach/projects/missionListFormat.ts';
const PEOPLE = 'src/components/outreach/projects/useInterviewingPeople.ts';

test('liste simplifiée : une ligne = le logo du client et le nom, le client dessous, les visages en entretien', () => {
  const src = code(LIST);
  assert.match(src, /import \{ MissionCompanyLogo \} from '@\/components\/dashboard\/MissionCompanyLogo'/);
  assert.match(src, /<MissionCompanyLogo\s+company=\{project\.clientName \|\| project\.name\}\s+size=\{archived \? 32 : 40\}/);
  assert.match(src, /import \{ AvatarStack \} from '@\/components\/ui\/person-avatar'/);
  assert.match(src, /<AvatarStack people=\{people\} total=\{value\}/);
  // Le client d'abord dans la ligne du dessous : c'est de lui que parle le logo.
  assert.match(src, /\[project\.clientName, showJobTitle \? project\.jobTitle : null, project\.location\]/);
  // Les visages : une lecture légère et bornée de la vue du Pipeline, jamais le profil entier ni une photo devinée.
  const hook = code(PEOPLE);
  assert.match(hook, /\.from\('mission_candidate_rows'\)/);
  assert.match(hook, /\.eq\('general_stage', 'interviewing'\)/);
  assert.match(hook, /\.eq\('is_unopened', false\)/);
  assert.match(hook, /\.in\('project_id', ids\)/);
  assert.match(hook, /\.limit\(INTERVIEWING_ROWS_LIMIT\)/);
  assert.match(hook, /linkedin_profile_data->>profile_picture_url\b/);
  assert.doesNotMatch(hook, /select\(\s*['"`][^'"`]*\blinkedin_profile_data\s*[,'"`]/, 'jamais le profil entier');
  assert.match(hook, /queryKey: \['project-candidates', 'interviewing-people', ids\]/, 'relue par invalidateStageReaders');
  assert.doesNotMatch(hook, /useATSData|fetchAllCandidates/);
  // Les nombres restent ceux des compteurs : les visages ne servent que d'habillage.
  assert.match(src, /useInterviewingPeople\(faceIds\)/);
  assert.match(src, /\(counts\?\.\[id\]\?\.interviewing \?\? 0\) > 0/);
});

test('liste simplifiée : aucun zéro écrit, une colonne vide pour toutes les missions n\'est pas affichée', () => {
  const src = code(LIST);
  // Une case à zéro reste vide, lue « 0 ».
  assert.match(src, /if \(value === 0\) return <span className="sr-only">0<\/span>/);
  // Colonnes : seulement celles qui ont un nombre non nul ; l'attente garde les quatre.
  assert.match(src, /COUNT_COLUMNS\.filter\(col => known\.some\(c => c !== null && col\.of\(c\) > 0\)\)/);
  assert.match(src, /countsWaiting \? COUNT_COLUMNS/);
  // Pas d'en-têtes sans colonne à nommer, et jamais sur le groupe replié.
  assert.match(src, /layout\.columns\.length > 0 && \(\s*<thead className="hidden xl:table-header-group">/);
  // La phrase de téléphone, de tablette et des terminées vient d'un seul module sans zéro.
  assert.match(src, /countsPhrase\(listCountsOf\(counts\)\)/);
  assert.match(src, /missionsSentence\(ongoingProjects\.length, summary\)/);
  assert.doesNotMatch(src, /COUNT_COLUMNS\.map\(\(\{ label, of \}\) => `\$\{label\} \$\{of\(counts\)\}`\)/, 'plus de « À trier 0 · Contacté 0 »');
  assert.doesNotMatch(src, /eyebrow/, 'plus de micro-libellé en majuscules');
  const fmt = code(FORMAT);
  assert.match(fmt, /c\.interviewing > 0 \?/);
  assert.match(fmt, /c\.toSort > 0 \?/);
  // L'activité : écrite une seule fois, et pas tant qu'elle date de moins d'une heure.
  assert.match(fmt, /QUIET_ACTIVITY_MS = 60 \* 60 \* 1000/);
  assert.equal((code(LIST).match(/activityLabel\(/g) ?? []).length, 2, 'une lecture par ligne, une pour les colonnes');
  assert.match(src, /<span className="xl:hidden">\{subline \? ' · ' : ''\}Activité \{activity\}<\/span>/, 'sous la colonne : dans la ligne du nom');
});

test('liste simplifiée : un seul bouton plein, des titres réels, aucun cadre, aucune taille écrite à la main', () => {
  const src = code(LIST);
  assert.equal((src.match(/variant="primary"/g) ?? []).length, 1);
  assert.doesNotMatch(src, /variant="outline"|variant="secondary"|variant="default"/);
  assert.doesNotMatch(src, /text-\[\d/);
  // Titres de section : « En cours » (lu seulement quand il n'y a qu'un groupe) et « Terminées, archivées » en text-lg.
  assert.match(src, /twoGroups \? 'mb-1 text-lg font-semibold text-foreground' : 'sr-only'/);
  assert.match(src, /text-lg font-semibold text-foreground hover:text-foreground-secondary/);
  // Aucune bordure ni fond de carte autour des groupes, de la recherche vide ou des terminées (les filets de ligne restent).
  assert.doesNotMatch(src, /rounded-xl|border-dashed|\bshadow-|\bring-1\b/);
  assert.match(src, /<ErrorState\s+variant="compact"\s+className="border-0 bg-transparent"/, 'état d\'erreur sans cadre');
  assert.doesNotMatch(src, /hover:bg-accent focus-visible/);
  assert.doesNotMatch(src, /rounded-md bg-muted px-1\.5/, 'plus de pastille de statut');
  assert.match(src, /border-b border-border/);
  // Le groupe replié n'a pas de seconde rangée d'en-têtes : layout.columns y est vide.
  assert.match(src, /columns: archived \? \[\]/);
  // Cibles de 44 px sous 640 px : bouton principal, recherche, relance, titre replié, menu de ligne.
  assert.match(src, /className="max-sm:min-h-11"/);
  assert.match(src, /className="pl-9 max-sm:h-11"/);
  assert.match(src, /max-sm:h-11 max-sm:w-11/);
  // Le nom n'a pas de zone à lui sur téléphone (toute la ligne ouvre la mission) : une zone de 44 px prise
  // au-dessus de « N profils trouvés » lui volait ses touchers (relecture du 05/10/2026).
  assert.doesNotMatch(src, /max-sm:-my-3/);
  assert.doesNotMatch(src, /max-sm:-mt-\d/);
  // « N profils trouvés » : 44 px de zone, prise vers le bas seulement (24 px de plus que sa ligne de 20 px).
  // Positionné, sinon la phrase qui le suit (plus tard dans la page) lui prendrait ses touchers.
  assert.equal((src.match(/max-sm:relative max-sm:-mb-6 max-sm:pb-6/g) ?? []).length, 1);
  // Les boutons de la ligne d'action sont positionnés eux aussi (et plus bas) : ils gardent leur zone là où elles se recouvrent.
  assert.equal((src.match(/'relative inline-flex min-w-0 items-center gap-1\.5/g) ?? []).length, 1);
  assert.match(src, /className="relative rounded-sm text-foreground-secondary underline/);
  assert.match(src, /<tr\s+data-testid="mission-row"\s+onClick=\{onOpen\}/, 'toute la ligne ouvre la mission');
});

test('liste simplifiée : téléphone, entrées du menu et boutons de la confirmation de 44 px, phrase des effectifs jamais coupée', () => {
  const src = code(LIST);
  // Chaque entrée du menu de la ligne (4 changements d'état et Supprimer).
  const menu = src.slice(src.indexOf('<DropdownMenuContent'), src.indexOf('</DropdownMenuContent>'));
  assert.equal((menu.match(/<DropdownMenuItem\b/g) ?? []).length, 5);
  assert.equal((menu.match(/max-sm:min-h-11/g) ?? []).length, 5, 'toutes les entrées');
  // Les deux boutons de la fenêtre de suppression.
  assert.match(src, /<AlertDialogCancel className="max-sm:min-h-11">Annuler<\/AlertDialogCancel>/);
  assert.match(src, /<AlertDialogAction\s+className="bg-destructive text-destructive-foreground hover:bg-destructive\/90 max-sm:min-h-11"/);
  // La phrase des effectifs (seule trace des nombres sous 1 280 px) passe à la ligne : jamais « co... ».
  assert.match(src, /<p className="mt-0\.5 text-sm text-muted-foreground xl:hidden">\{phrase\}<\/p>/);
  assert.match(src, /<p className="mt-0\.5 text-sm text-muted-foreground xl:hidden">Effectifs indisponibles<\/p>/);
  assert.doesNotMatch(src, /truncate text-sm text-muted-foreground xl:hidden/);
});

test('liste simplifiée : le focus ne tombe pas sur la page à la fermeture de la confirmation de suppression', () => {
  const src = code(LIST);
  // Le bouton « ... » de la ligne (menu invisible hors survol) est transmis à l'ouverture, pas l'entrée de menu qui disparaît.
  assert.match(src, /<Button\s+ref=\{menuTriggerRef\}/);
  assert.match(src, /onDelete\(menuTriggerRef\.current\)/);
  assert.match(src, /onDelete=\{\(opener\) => \{ deleteOpenerRef\.current = opener; setDeleteTarget\(project\); \}\}/);
  // À la fermeture : retour au bouton s'il existe encore, sinon début de la liste (groupe qui accepte le focus).
  assert.match(src, /<AlertDialogContent\s+onCloseAutoFocus=\{\(event\) => \{/);
  assert.match(src, /event\.preventDefault\(\);/);
  assert.match(src, /\(opener && opener\.isConnected \? opener : listRef\.current\)\?\.focus\(\)/);
  assert.match(src, /<div ref=\{listRef\} tabIndex=\{-1\} role="group" aria-label="Liste des missions"/);
  // Supprimer : la fenêtre se ferme au clic, avant la fin de l'effacement ; la ligne part, on ne lui rend rien.
  const action = src.slice(src.indexOf('<AlertDialogAction'), src.indexOf('</AlertDialogAction>'));
  assert.match(action, /deleteOpenerRef\.current = null;/);
});

test('liste simplifiée : aucune opacité sur le logo (les initiales passaient sous 4,5:1)', () => {
  const src = code(LIST);
  const logo = src.slice(src.indexOf('<MissionCompanyLogo'), src.indexOf('/>', src.indexOf('<MissionCompanyLogo')));
  assert.doesNotMatch(logo, /opacity|className/);
  assert.doesNotMatch(src, /opacity-70/);
});

test('liste simplifiée : le menu de ligne se révèle au survol, au focus et au toucher sans display:none', () => {
  const src = code(LIST);
  assert.match(src, /import \{ REVEAL_ON_ROW \} from '@\/components\/missions\/v3\/cadrage\/sectionUi'/);
  assert.match(src, /className=\{cn\(REVEAL_ON_ROW, 'data-\[state=open\]:opacity-100 max-sm:h-11 max-sm:w-11'\)\}/);
  assert.match(src, /'group cursor-pointer border-b border-border/, 'la ligne porte le groupe du survol');
  const reveal = read('src/components/missions/v3/cadrage/sectionUi.ts');
  assert.match(reveal, /opacity-0[^']*group-hover:opacity-100 group-focus-within:opacity-100 \[@media\(hover:none\)\]:opacity-100/);
  // Le bouton reste atteignable au clavier : ni hidden, ni invisible, ni tabIndex négatif sur le déclencheur.
  const trigger = src.slice(src.indexOf('<DropdownMenuTrigger asChild>'), src.indexOf('</DropdownMenuTrigger>'));
  assert.doesNotMatch(trigger.replace(/aria-hidden/g, ''), /\bhidden\b|invisible|tabIndex|display/);
  assert.match(trigger, /aria-label=\{`Actions pour \$\{project\.name\}`\}/);
  // Mêmes actions, mêmes confirmations : la suppression passe toujours par l'AlertDialog.
  assert.match(src, /setDeleteTarget\(project\)/);
  assert.match(src, /<AlertDialogTitle>Supprimer cette mission \?<\/AlertDialogTitle>/);
});

test('liste simplifiée : la ligne d\'action garde la couleur du texte, orange seulement pour une réponse qui attend', () => {
  const src = code(LIST);
  assert.match(src, /action\.rank === '3' \? 'text-warning' : 'text-foreground'/);
  assert.doesNotMatch(src, /text-brand|text-primary\b|text-status-/, 'plus de turquoise sur les lignes');
  // Même bouton, même nom accessible.
  assert.match(src, /aria-label=\{`\$\{action\.text \?\? ''\}, \$\{missionName\}`\}/);
});
