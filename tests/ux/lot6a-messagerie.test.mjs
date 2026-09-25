/**
 * Chantier design, lot 6a : la messagerie (/inbox).
 *
 * Garde-fous de non-régression des constats D-01 à D-20 et D-65 à D-72
 * (docs/design/audit/D-outreach-messagerie.md), par lecture du code, sans
 * navigateur ni base : identifiants techniques, actions au doigt et au
 * clavier, états, texte, registre visuel.
 *
 * Lancer : node --test tests/ux/lot6a-messagerie.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
/** Code sans commentaires : les commentaires citent ce qu'on veut bannir. */
const code = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const FILES = {
  page: 'src/pages/Inbox.tsx',
  inbox: 'src/components/outreach/MessagesInbox.tsx',
  sidebar: 'src/components/outreach/inbox/ChatListSidebar.tsx',
  item: 'src/components/outreach/inbox/ChatListItem.tsx',
  view: 'src/components/outreach/inbox/MessageView.tsx',
  composer: 'src/components/outreach/inbox/MessageComposer.tsx',
  panel: 'src/components/outreach/inbox/InlineAIPanel.tsx',
  activity: 'src/components/outreach/inbox/ActivityEventCard.tsx',
  snooze: 'src/components/outreach/inbox/SnoozeArchiveButtons.tsx',
  cta: 'src/components/outreach/inbox/CtaReplyButton.tsx',
  replies: 'src/components/outreach/inbox/SmartReplies.tsx',
  templates: 'src/components/outreach/inbox/TemplatesPicker.tsx',
  tone: 'src/components/outreach/inbox/ToneSelector.tsx',
  pipeline: 'src/components/outreach/AddToPipelineModal.tsx',
  hook: 'src/hooks/useMessagesInbox.ts',
  helpers: 'src/hooks/useMessagesInboxHelpers.ts',
  intents: 'src/hooks/useChatIntents.ts',
  categories: 'src/hooks/useChatCategories.ts',
  drafts: 'src/hooks/useChatDraft.ts',
};
const src = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, code(rel)]));

// ---------------------------------------------------------------- D-01
test('D-01 : la frise d’activité passe par le catalogue des séquences', () => {
  assert.match(src.activity, /sequenceActionLabel\(event\.actionType\)/);
  assert.match(src.activity, /<SequenceActionIcon type=\{event\.actionType\}/);
  assert.match(src.activity, /<ExecutionStatusBadge/);
  assert.match(src.activity, /skipReasonLabel\(event\.skipReason\)/, 'une raison d’arrêt se traduit');
  assert.doesNotMatch(src.activity, /label: event\.actionType|\{event\.actionType\}<|event\.errorMessage/, 'jamais d’identifiant ni d’erreur brute');
  assert.doesNotMatch(src.activity, /send_connection|send_message|onClick=/, 'plus de table locale ni de div cliquable');
});

// ---------------------------------------------------------------- D-02
test('D-02 : « Inscrire dans une séquence » depuis l’en-tête de la conversation', () => {
  assert.match(src.view, /onClick=\{onEnrollInSequence\}[^>]*>\s*<ListPlus[^>]*\/>\s*Inscrire dans une séquence/);
  assert.match(src.view, /onSelect=\{onEnrollInSequence\}/, 'aussi dans le menu « Plus d’actions » (téléphone)');
  const start = src.hook.indexOf('const handleEnrollInSequence');
  assert.ok(start !== -1, 'handleEnrollInSequence introuvable');
  const handler = src.hook.slice(start, src.hook.indexOf('}, [selectedChat]);', start));
  assert.match(handler, /setShowSequenceSelect\(true\)/);
  assert.doesNotMatch(handler, /toast/, 'le dialogue dit lui-même qu’il n’y a pas de séquence');
  assert.match(src.inbox, /Aucune séquence active/);
  assert.match(src.inbox, /to="\/missions"/);
});

// ---------------------------------------------------------------- D-03, D-12
test('D-03, D-12 : actions au doigt, au survol et au focus clavier', () => {
  assert.doesNotMatch(src.view, /hidden md:flex items-center gap-1 shrink-0/, 'l’en-tête ne masque plus ses actions sur téléphone');
  assert.match(src.view, /aria-label="Plus d'actions"/);
  for (const [name, file] of [['ChatListItem', src.item], ['MessageView', src.view]]) {
    assert.match(file, /\[@media\(hover:hover\)\]:opacity-0/, `${name} : masqué seulement quand le survol existe`);
    assert.match(file, /group-focus-within(\/msg)?:opacity-100/, `${name} : visible au focus clavier`);
    assert.match(file, /data-\[state=open\]:opacity-100/, `${name} : visible menu ouvert`);
  }
  assert.doesNotMatch(src.item, /opacity-0 group-hover:opacity-100 transition-opacity/, 'plus d’actions au seul survol');
  assert.match(src.item, /aria-label=\{`Actions pour la conversation avec \$\{displayName\}`\}/);
});

// ---------------------------------------------------------------- D-04
test('D-04 : intentions et étiquettes en variantes de Badge', () => {
  for (const [name, file] of [['useChatIntents', src.intents], ['useChatCategories', src.categories]]) {
    assert.doesNotMatch(file, /\b(?:bg|text|border)-(?:emerald|red|blue|purple|amber|gray|green|violet)-\d+/, `${name} : couleur brute`);
    assert.doesNotMatch(file, /dark:/, `${name} : variante dark: superflue`);
    assert.doesNotMatch(file, /emoji:/, `${name} : emoji servant d’icône`);
    assert.match(file, /tone: '(success|danger|info|warning|muted)'/, `${name} : ton de badge`);
  }
  assert.match(src.item, /<Badge variant=\{categoryInfo\.tone\}/);
  assert.match(src.item, /<Badge variant=\{intentMeta\.tone\}/);
});

// ---------------------------------------------------------------- D-05, D-06
test('D-05, D-06 : trois rangées avant la liste, libellés visibles, état annoncé', () => {
  assert.match(src.sidebar, /<SegmentedControl[\s\S]*?aria-label="Conversations affichées"/);
  assert.match(src.sidebar, /<FilterPill label="Filtres"/);
  assert.match(src.sidebar, /<FilterOption/);
  assert.doesNotMatch(src.sidebar, /Att\. cand\.|Att\. moi|'Tags/, 'plus de libellé abrégé');
  assert.doesNotMatch(src.sidebar, /bg-foreground text-background/, 'la sélection n’est plus un aplat inversé');
  assert.doesNotMatch(src.sidebar, /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/u, 'plus d’emoji dans les filtres');
});

// ---------------------------------------------------------------- D-07
test('D-07 : « À répondre » ou « En attente » puis la mission, source neutre', () => {
  assert.match(src.helpers, /kind: 'reply' \| 'waiting' \| null/);
  assert.doesNotMatch(src.helpers, /label: 'Classic'/, 'la messagerie classique n’a pas de badge');
  assert.doesNotMatch(src.helpers, /color:/, 'la source reste en texte neutre');
  assert.doesNotMatch(src.item, /!sourceType && !categoryInfo/, 'le repère n’est plus masqué par la source');
});

// ---------------------------------------------------------------- D-08
test('D-08 : une mission déduite se dit « probable », jamais supposée par défaut', () => {
  assert.doesNotMatch(src.view, /activeMissions\.length === 1 \? activeMissions\[0\]/, 'plus de repli sur la seule mission active');
  assert.match(src.view, /Mission probable : /);
  assert.doesNotMatch(src.view, /Hors séquence/);
  const stop = src.view.match(/const canStopSequence = ([^;]+);/);
  assert.ok(stop && /jobInfo/.test(stop[1]) && !/inferredMission|displayContext/.test(stop[1]), 'l’arrêt ne concerne qu’une inscription réelle');
});

// ---------------------------------------------------------------- D-09
test('D-09 : erreur avec « Réessayer », vide filtré, compte à relier', () => {
  assert.match(src.hook, /const \[chatsError, setChatsError\] = useState<string \| null>\(null\)/);
  assert.match(src.hook, /setChatsError\(error instanceof Error/);
  assert.match(src.sidebar, /<ErrorState[\s\S]*?onRetry=\{onRefresh\}/);
  assert.match(src.sidebar, /Effacer les filtres/);
  assert.match(src.inbox, /to="\/settings\/account\/connections"/);
  assert.match(src.pipeline, /<ErrorState[\s\S]*?onRetry=\{fetchJobs\}/, 'les postes aussi : une panne n’est pas une liste vide');
});

// ---------------------------------------------------------------- D-10
test('D-10 : un brouillon se signale dans la liste et le composeur', () => {
  assert.match(src.drafts, /export function useChatDrafts\(\)/);
  assert.match(src.drafts, /notifyDraftsChanged\(\)/);
  assert.match(src.item, /Brouillon : /);
  assert.match(src.composer, /Brouillon enregistré/);
  assert.match(src.view, /draftSaved=\{hasDraft\}/);
});

// ---------------------------------------------------------------- D-11
test('D-11 : hauteur calée sur l’espace visible, sans calcul figé', () => {
  assert.doesNotMatch(src.page, /100dvh - 124px/);
  assert.match(src.page, /offsetTop/);
  assert.match(src.page, /ResizeObserver/);
});

// ---------------------------------------------------------------- D-13
test('D-13 : noms accessibles et un seul bouton principal dans le composeur', () => {
  assert.match(src.composer, /aria-label="Message"/);
  for (const label of ['Gras', 'Italique', 'Insérer un lien', 'Liste à puces', 'Liste numérotée', 'Insérer un emoji']) {
    assert.ok(src.composer.includes(`label="${label}"`) || src.composer.includes(`aria-label="${label}"`), `${label} sans nom`);
  }
  assert.equal((src.composer.match(/variant="primary"/g) || []).length, 2, 'Envoyer, et l’action d’un dialogue');
  assert.doesNotMatch(src.composer, /bg-foreground text-background/, 'l’IA n’est plus un second bouton principal');
  assert.doesNotMatch(src.view, /toUpperCase\(\)/, 'le canal s’écrit en casse normale');
  assert.match(src.view, /channel=\{channelLabel\(channel\)\}/);
});

// ---------------------------------------------------------------- D-14
test('D-14 : une suggestion IA remplit le composeur, jamais d’envoi direct', () => {
  assert.doesNotMatch(src.panel, /onSuggestionSend|Envoyer directement/);
  assert.doesNotMatch(src.view, /onSuggestionSend/);
  assert.doesNotMatch(src.hook, /handleSuggestionSend/);
  assert.doesNotMatch(src.panel, /<div[^>]*onClick=/, 'plus de div cliquable');
  assert.doesNotMatch(src.panel, /\b(?:bg|text|border)-(?:emerald|amber)-\d+/);
});

// ---------------------------------------------------------------- D-15, D-69
test('D-15, D-69 : ni dégradé, ni flou, ni ombre de bulle, ni ressort', () => {
  for (const [name, file] of Object.entries(src)) {
    assert.doesNotMatch(file, /bg-gradient-to-|backdrop-blur/, `${name} : effet décoratif`);
    assert.doesNotMatch(file, /from 'framer-motion'/, `${name} : animation framer-motion`);
  }
  assert.doesNotMatch(src.view, /shadow-sm|shadow-md|rounded-2xl/, 'bulles à plat, rayon surface');
});

// ---------------------------------------------------------------- D-17, D-71
test('D-17, D-71 : vouvoiement, français, pas de tiret long', () => {
  assert.match(src.item, /Vous : /);
  const visible = Object.values(src).join('\n');
  // « Stoppé depuis Inbox » reste la raison écrite en base, traduite à l'affichage par le catalogue.
  for (const phrase of ['Tu : ', 'Choisis un', 'Tu pourras', 'Click sur', 'Réduire la sidebar', 'Aucun poste matché', 'Réponse + CTA', "label: 'Stoppé'", 'Séquence stoppée', 'dans le projet']) {
    assert.ok(!visible.includes(phrase), `« ${phrase} » encore affiché`);
  }
  assert.doesNotMatch(src.composer + src.templates, /['">]\s*(?:Nouveau t|T)emplates?\b/, 'modèle, pas template');
  // Les journaux console (débogage) ne sont pas lus par l'utilisateur, comme pour le cliquet.
  const withoutConsole = (s) => s.replace(/\bconsole\.(?:log|warn|error|info|debug)\((?:[^()]|\([^()]*\))*\)/g, '');
  for (const [name, file] of Object.entries(src)) {
    assert.doesNotMatch(withoutConsole(file), /—/, `${name} : tiret long`);
    assert.doesNotMatch(file, /\bétape\(s\)|\(s\)/, `${name} : pluriel « (s) »`);
  }
});

// ---------------------------------------------------------------- D-18
test('D-18 : statut d’inscription du catalogue, une seule conversation montée', () => {
  assert.match(src.view, /<EnrollmentStatusBadge/);
  assert.doesNotMatch(src.view, /SequenceStatusBadge|config\.active|En séquence/, 'plus de repli « En séquence »');
  assert.equal((src.inbox.match(/<MessageView\b/g) || []).length, 1, 'MessageView monté une fois');
  assert.match(src.hook, /current_step_order, pause_reason'\)/, 'la raison d’une pause est lue');
});

// ---------------------------------------------------------------- D-19
test('D-19 : « Ajouter au pipeline » monochrome, sélection en accent, sans emoji', () => {
  assert.doesNotMatch(src.pipeline, /bg-info|blue-\d+/);
  assert.match(src.pipeline, /variant="primary"/);
  assert.match(src.pipeline, /border-brand bg-brand\/10/);
  assert.match(src.pipeline, /aria-pressed=\{selected\}/);
  assert.doesNotMatch(src.pipeline, /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/u);
});

// ---------------------------------------------------------------- D-20
test('D-20 : archiver sans confirmation ni rouge', () => {
  assert.doesNotMatch(src.snooze, /AlertDialog|hover:text-destructive/);
  assert.match(src.snooze, /onClick=\{\(\) => onArchive\(chatId, accountId\)\}/);
  assert.match(src.snooze, /Restaurer/);
});

// ---------------------------------------------------------------- D-65, D-66
test('D-65, D-66 : un canal se montre par ChannelIcon, sans couleur propre', () => {
  assert.match(src.activity, /<ChannelIcon channel="call"/, 'un appel prend l’icône du canal');
  assert.doesNotMatch(src.activity, /whatsapp|aircall-logo/, 'plus de couleur WhatsApp pour un appel');
  assert.match(src.inbox, /<ChannelIcon key=\{channel\} channel=\{channel\}/, 'les canaux d’une séquence au choix');
  assert.match(src.item, /<ChannelIcon channel=\{channel\}/);
});

// ---------------------------------------------------------------- D-67, D-68, D-70, D-72
test('D-67, D-68, D-70, D-72 : paliers, primitives, pas d’emoji d’interface, calques nommés', () => {
  for (const [name, file] of Object.entries(src)) {
    assert.doesNotMatch(file, /\btext-\[\d/, `${name} : taille arbitraire`);
    assert.doesNotMatch(file, /\btext-(?:muted-)?foreground\/\d+/, `${name} : texte atténué par opacité`);
    assert.doesNotMatch(file, /\bz-\[\d+\]|\bz-50\b/, `${name} : calque arbitraire`);
    assert.doesNotMatch(file, /\brounded-(?:none|2xl|3xl)\b/, `${name} : rayon hors système`);
    assert.doesNotMatch(file, /\buppercase\b/, `${name} : capitales (eyebrow seulement)`);
  }
  // Seules les listes d'emoji à insérer dans un message (contenu, pas icônes) en portent.
  // Même définition que le cliquet (scripts/design/ratchet.mjs).
  const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/u;
  const withoutPickers = (s) => s.replace(/const (?:REACTIONS|QUICK_EMOJIS)[\s\S]*?\];/g, '');
  for (const [name, file] of Object.entries(src)) {
    assert.doesNotMatch(withoutPickers(file), EMOJI, `${name} : emoji d’interface`);
  }
  assert.match(src.templates, /role="listbox"/);
  assert.match(src.templates, /role="option"/);
  assert.match(src.composer, /aria-activedescendant=/);
});
