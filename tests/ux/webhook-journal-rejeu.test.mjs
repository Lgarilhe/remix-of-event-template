/**
 * Notifications en temps réel (Paramètres › Connexions) : journal des notifications reçues et rejeu
 * (administrateurs de la plateforme), confirmation de suppression qui dit la vérité, lecture de la
 * réponse de `register` à point de réception unique.
 *
 * Inspection de source, sans navigateur ni base. Lancer : node --test tests/ux/webhook-journal-rejeu.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
/** Code sans commentaires : on vérifie ce qui s'exécute, pas ce qui est raconté. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const MANAGER = 'src/components/outreach/WebhookManager.tsx';
const LOG = 'src/components/outreach/WebhookDeliveryLog.tsx';
const manager = code(MANAGER);
const log = code(LOG);
const between = (src, start, end) => {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `repère introuvable : ${start}`);
  const j = src.indexOf(end, i + start.length);
  assert.ok(j >= 0, `repère introuvable : ${end}`);
  return src.slice(i, j);
};

test('suppression : le texte dit que tout s\'arrête ensemble, plus de formule par famille', () => {
  const dialog = between(manager, '<AlertDialog open={!!deleteTarget}', '</AlertDialog>');
  assert.match(dialog, /Supprimer les notifications en temps réel \?/);
  assert.match(dialog, /Les notifications ne se suppriment pas une par une : toutes s’arrêtent ensemble\./);
  assert.match(dialog, /deleteSubjects\(deleteTarget\)/);
  assert.match(dialog, /Vous pourrez les rétablir avec « Activer les notifications en temps réel »\./);
  // L'ancienne phrase ne parlait que de la famille de la ligne cliquée.
  assert.doesNotMatch(dialog, /SOURCES\[deleteTarget\.source\]\?\.subject/);
  assert.doesNotMatch(dialog, /Supprimer la notification «/);
  assert.match(dialog, /className="bg-destructive"/);
  assert.match(dialog, /void handleDelete\(deleteTarget\.id\)/);
});

test('suppression : toutes les lignes du même point de réception passent en chargement, le bouton ne promet pas une famille', () => {
  assert.match(manager, /const endpointOf = \(webhook: Pick<WebhookInfo, 'id' \| 'endpoint_id'>\) => webhook\.endpoint_id \?\? webhook\.id;/);
  assert.match(manager, /deletingEndpoint === endpointOf\(webhook\)/);
  assert.doesNotMatch(manager, /deletingId/);
  assert.match(manager, /aria-label=\{`Supprimer toutes les notifications en temps réel, depuis la ligne « \$\{sourceLabel\(webhook\.source\)\} »`\}/);
  assert.match(manager, /<TooltipContent>Supprimer toutes les notifications<\/TooltipContent>/);
  assert.match(manager, /toast\.success\('Notifications en temps réel supprimées'\)/);
  // Les familles citées par la confirmation sont celles du point de réception supprimé.
  const subjects = between(manager, 'const deleteSubjects = (target: WebhookInfo) =>', 'const registeredSources');
  assert.match(subjects, /endpointOf\(w\) === endpointOf\(target\)/);
});

test('register : lit la réponse à point de réception unique, plus de results[] par famille', () => {
  const register = between(manager, 'const handleRegister = async () => {', 'const handleDelete');
  assert.doesNotMatch(manager, /results\?:|\.results\b|failedSources/);
  assert.match(manager, /duplicates_not_deleted\?: number;/);
  assert.match(register, /action: 'register'/);
  assert.match(register, /if \(!response\.data\?\.success\) throw new Error\(response\.data\?\.error\);/);
  assert.match(register, /toast\.warning\(/);
  assert.match(register, /doublon n’a pas pu être supprimé/);
  assert.match(register, /toast\.success\('Notifications en temps réel activées'\)/);
  // La phrase française du serveur (configuration incomplète, liste trop longue) est montrée SEULE, sinon « Réessayez ».
  assert.match(register, /toast\.error\(detail \?\? 'Les notifications n’ont pas pu être activées\. Réessayez\.'\)/);
  assert.doesNotMatch(register, /activées\.\$\{/, 'plus de phrase fixe suivie de celle du serveur');
});

test('journal : appelé sans erreur visible, un 403 le masque, rien avant la réponse du serveur', () => {
  assert.match(manager, /import \{ WebhookDeliveryLog \} from '@\/components\/outreach\/WebhookDeliveryLog';/);
  assert.match(manager, /<WebhookDeliveryLog \/>/);
  assert.match(log, /action: 'list_deliveries'/);
  const load = between(log, 'const load = useCallback(', '}, []);');
  const forbidden = between(load, 'if (response.error?.status === 403) {', 'return;');
  assert.match(forbidden, /setAllowed\(false\)/);
  assert.doesNotMatch(forbidden, /toast\./);
  assert.doesNotMatch(forbidden, /setLoadError\(true\)/);
  // Aucune erreur par toast à la lecture, seulement dans la rubrique quand le droit est établi.
  assert.doesNotMatch(load, /toast\./);
  assert.match(log, /if \(!allowed\) return null;/);
});

test('journal : rejeu derrière une AlertDialog, seulement pour une livraison qui n\'a pas abouti', () => {
  assert.match(log, /setReplayTarget\(delivery\)/);
  assert.doesNotMatch(log, /onClick=\{\(\) => (?:void )?handleReplay\(delivery\)\}/, 'jamais sans confirmation');
  const dialog = between(log, '<AlertDialog open={!!replayTarget}', '</AlertDialog>');
  assert.match(dialog, /<AlertDialogTitle>Rejouer cette notification \?<\/AlertDialogTitle>/);
  // Le serveur refuse un événement déjà reçu : le texte ne promet plus qu'un rejeu est « ignoré ».
  assert.match(dialog, /Un événement que Konekt a déjà reçu n’est pas rejoué\. Un événement dont le traitement avait échoué est repris\./);
  assert.doesNotMatch(dialog, /il est ignoré/);
  assert.match(dialog, /void handleReplay\(replayTarget\)/);
  assert.match(log, /\{!ok && !receivedLater && \(\s*<Button/, 'pas de bouton sur une livraison reçue, ni sur la tentative en échec d\'un événement reçu ensuite');
  assert.match(log, /const receivedEvents = new Set\(deliveries\.filter\(\(d\) => d\.status === 'delivered'\)\.map\(\(d\) => d\.event_id\)\);/);
  assert.match(log, /\{receivedLater \? ', reçue ensuite' : ''\}/);
  assert.match(log, /action: 'replay_event'/);
  assert.match(log, /event_id: delivery\.event_id/);
  // Le journal se relit après le rejeu, la consigne manuelle disparaît.
  assert.match(log, /toast\.success\('Rejeu demandé\. Le journal va se mettre à jour\.'\)/);
  assert.match(log, /window\.setTimeout\(\(\) => \{ void load\(0\); \}, REFRESH_AFTER_REPLAY_MS\)/);
  assert.doesNotMatch(log, /Actualisez le journal/);
  // Échec : la phrase du serveur d'abord, la phrase fixe sinon.
  assert.match(log, /toast\.error\(serverSentence\(error\) \?\? 'Le rejeu n’a pas pu être demandé\. Réessayez\.'\)/);
});

test('journal : le bouton Rejouer reste actif pendant un rejeu (le focus revient dessus), les clics sont ignorés', () => {
  const row = between(log, '{!ok && !receivedLater && (', ')}\n                </li>');
  assert.doesNotMatch(row, /disabled=/);
  assert.doesNotMatch(row, /loading=/);
  assert.match(row, /aria-busy=\{replaying \|\| undefined\}/);
  assert.match(row, /if \(!replayingId\) setReplayTarget\(delivery\)/);
  assert.match(log, /if \(replayingId\) return;/);
});

test('journal : un échec de lecture avec des lignes déjà affichées se dit et se relance', () => {
  // Avant : l'erreur n'apparaissait que liste vide ; « Afficher les suivantes » échouait sans un mot.
  const more = between(log, '</ul>', '{nextOffset !== null && (');
  assert.match(more, /\{loadError && \(\s*<ErrorBox/);
  assert.match(more, /Impossible de charger la suite du journal\./);
  assert.match(more, /Impossible d’actualiser le journal\./);
  assert.match(more, /void load\(lastOffset\.current\)/);
  assert.match(log, /lastOffset\.current = offset;/);
});

test('journal : libellés des événements écoutés, résumé daté de ce qui est affiché, région vocale permanente', () => {
  assert.match(log, /eventType === 'message\.receipt\.read'\) return 'Message lu'/);
  assert.match(log, /eventType === 'message\.reaction\.new'\) return 'Réaction à un message'/);
  assert.doesNotMatch(log, /tracking\./, 'aucun événement « tracking. » n\'est écouté');
  assert.match(log, /parmi \$\{plural\(deliveries\.length, 'affichée', 'affichées'\)\}/);
  assert.doesNotMatch(log, /\} sur \$\{deliveries\.length\}/);
  // Une seule région role=status, toujours présente, remplie ensuite.
  assert.equal((log.match(/role="status"/g) ?? []).length, 1);
  assert.match(log, /<p role="status" className="sr-only">\{announcement\}<\/p>/);
  assert.match(log, /livraison ajoutée', 'livraisons ajoutées'/);
});

test('journal : l\'état s\'écrit en mots, squelette, état vide, erreur avec nouvel essai, cibles de 44 px', () => {
  assert.match(log, /if \(delivery\.status === 'delivered'\) return 'Reçue';/);
  assert.match(log, /Échec \(\$\{delivery\.http_status\}\)/);
  assert.match(log, /return 'Sans réponse';/);
  assert.match(log, /<Skeleton /);
  assert.match(log, /Aucune livraison enregistrée pour le moment\./);
  assert.match(log, /<ErrorBox title="Impossible de lire le journal\." onRetry=\{\(\) => \{ void load\(0\); \}\} \/>/);
  assert.match(log, /aria-label="Actualiser le journal des notifications"/);
  // Chaque bouton (actualiser, rejouer, afficher les suivantes) porte sa hauteur de 44 px sur téléphone.
  const buttons = log.match(/<Button\b/g) ?? [];
  const touch = log.match(/max-md:h-11/g) ?? [];
  assert.equal(buttons.length, 3);
  assert.equal(touch.length, buttons.length);
  assert.match(log, /size="icon-xs"\s+className="shrink-0 max-md:h-11 max-md:w-11"/);
  assert.match(log, /aria-labelledby="journal-notifications"/);
});

/** Textes visibles : contenu JSX, chaînes passées à toast, aria-label, title, placeholder. */
function visibleStrings(src) {
  const out = [];
  for (const m of src.matchAll(/>([^<>{}]+)</g)) out.push(m[1]);
  for (const m of src.matchAll(/\b(?:aria-label|title|placeholder)=(?:"([^"]*)"|\{`([^`]*)`\})/g)) out.push(m[1] ?? m[2]);
  for (const m of src.matchAll(/toast\.(?:success|error|warning|info)\(\s*(?:'([^']*)'|`([^`]*)`)/g)) out.push(m[1] ?? m[2]);
  for (const m of src.matchAll(/return '([^']*)';/g)) out.push(m[1]);
  return out;
}

test('textes : aucun nom de fournisseur, pas de tiret cadratin, pas de mots creux', () => {
  const VENDORS = /\b(?:Unipile|Apollo|People Data Labs|PDL|Resend|Anthropic|Claude|Stripe|BetterContact)\b/;
  const FILLER = /\b(?:crucial|crucia\w+|essentiel\w*|robuste\w*|riche\w*|fluide\w*|puissant\w*|innovant\w*|explorer|naviguer|garantir|veiller)\b/i;
  for (const [name, src] of [['WebhookManager', read(MANAGER)], ['WebhookDeliveryLog', read(LOG)]]) {
    for (const text of visibleStrings(code(name === 'WebhookManager' ? MANAGER : LOG))) {
      assert.doesNotMatch(text, VENDORS, `${name} : « ${text.trim()} »`);
      assert.doesNotMatch(text, FILLER, `${name} : « ${text.trim()} »`);
      assert.doesNotMatch(text, /—/, `${name} : tiret cadratin dans « ${text.trim()} »`);
    }
    assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, ''), /—/, `${name} : tiret cadratin`);
  }
  assert.ok(visibleStrings(log).length >= 10, 'le relevé des textes visibles ne doit pas être vide');
});
