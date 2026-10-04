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
 *  - textes : ni nom de prestataire, ni tiret long, ni confirm natif.
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
  assert.match(src, /className="mt-1 flex h-5 min-w-0 items-center text-xs outline-none max-sm:h-8"/);
  // Cible tactile : 32 px sous 640 px, pour le lien d'action comme pour Réessayer.
  assert.equal((src.match(/max-sm:min-h-8/g) ?? []).length, 2);
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
