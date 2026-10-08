/**
 * Messagerie : onglets par état du fil et ligne « À faire ».
 *
 * Une seule définition de « à répondre », « à relancer » et « en attente »
 * (src/lib/inboxThreadState.ts), partagée par les onglets, leurs compteurs, les
 * repères de la liste et la ligne « À faire » de la conversation. Le module pur
 * est transpilé en mémoire par esbuild et joué ; les composants, qui dépendent
 * du client Supabase, sont vérifiés par lecture du code.
 *
 * Fuseau fixé à Europe/Paris : les jours ouvrés et le changement d'heure du
 * 25/10/2026 se vérifient en heure locale.
 *
 * Lancer : node --test tests/ux/messagerie-onglets.test.mjs
 */
process.env.TZ = 'Europe/Paris';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build, transformSync } from 'esbuild';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
/** Code sans commentaires : les commentaires citent ce qu'on veut bannir. */
const code = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const load = async (rel) => {
  const { code: js } = transformSync(read(rel), { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
};

const {
  FOLLOW_UP_BUSINESS_DAYS,
  RESPONSE_FILTER_STATE,
  businessDaysSince,
  countThreadStates,
  latestMessage,
  pickSuggestedAction,
  responseFilterFromParam,
  responseFilterToParam,
  threadState,
} = await load('src/lib/inboxThreadState.ts');

// La phrase importe la fonction de pluriel partagée : module empaqueté (esbuild) plutôt que transpilé seul.
const { outputFiles } = await build({
  entryPoints: [new URL('../../src/lib/inboxThreadSentence.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});
const { threadWaitingSentence } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);

const enrollmentBundle = await build({
  stdin: {
    contents: "export * from './src/lib/inboxEnrollments'; export { getChatJobInfo, getChatThreadState } from './src/hooks/useMessagesInboxHelpers';",
    resolveDir: new URL('../../', import.meta.url).pathname,
    loader: 'ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
});
const { fetchInboxEnrollmentRows, indexInboxEnrollments, getChatJobInfo, getChatThreadState } = await import(`data:text/javascript;base64,${Buffer.from(enrollmentBundle.outputFiles[0].text).toString('base64')}`);

const multichannelBundle = await build({
  entryPoints: [new URL('../../src/lib/multichannelInbox.ts', import.meta.url).pathname],
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  alias: { '@': new URL('../../src', import.meta.url).pathname },
});
const { groupMultichannelConversations } = await import(`data:text/javascript;base64,${Buffer.from(multichannelBundle.outputFiles[0].text).toString('base64')}`);

// Heures locales de Paris (le fuseau est fixé plus haut).
const at = (y, m, d, h = 10, min = 0) => new Date(y, m - 1, d, h, min, 0);
const iso = (date) => date.toISOString();
const mine = (date, extra = {}) => ({ lastIsMine: true, lastAt: iso(date), sequenceActive: false, ...extra });

// ---------------------------------------------------------------- module pur
test('Le module des états est pur : aucun import', () => {
  const src = read('src/lib/inboxThreadState.ts');
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.doesNotMatch(src, /\bimport\s*\(|\brequire\s*\(/);
});

test('Le seuil de relance est de trois jours ouvrés, comme le chiffre « À traiter »', () => {
  assert.equal(FOLLOW_UP_BUSINESS_DAYS, 3);
});

test('À répondre : le candidat a écrit le dernier message, quelle que soit l’ancienneté', () => {
  const now = at(2026, 10, 6);
  assert.equal(threadState({ lastIsMine: false, lastAt: iso(at(2026, 10, 6, 9)), sequenceActive: false }, now), 'to_reply');
  assert.equal(threadState({ lastIsMine: false, lastAt: iso(at(2026, 6, 1)), sequenceActive: true }, now), 'to_reply');
});

test('Auteur du dernier message inconnu : aucun état', () => {
  assert.equal(threadState({ lastIsMine: null, lastAt: iso(at(2026, 10, 1)), sequenceActive: false }, at(2026, 10, 6)), 'none');
});

test('À relancer : trois jours ouvrés sans réponse, bornes comprises', () => {
  // Jeudi 1er octobre 2026 à 10 h, mardi 6 octobre à 10 h : vendredi, lundi, mardi = 3.
  const sent = at(2026, 10, 1, 10);
  assert.equal(businessDaysSince(iso(sent), at(2026, 10, 6, 10)), 3);
  assert.equal(threadState(mine(sent), at(2026, 10, 6, 10)), 'to_follow_up');
  // Une heure plus tard le jeudi : le mardi à 10 h, le troisième jour n'est pas révolu.
  const later = at(2026, 10, 1, 11);
  assert.equal(businessDaysSince(iso(later), at(2026, 10, 6, 10)), 2);
  assert.equal(threadState(mine(later), at(2026, 10, 6, 10)), 'waiting');
});

test('En attente : un ou deux jours ouvrés, le week-end ne compte pas', () => {
  // Vendredi 17 h : le week-end est sauté, le jour ouvré s'accomplit lundi à 17 h (même heure locale).
  assert.equal(businessDaysSince(iso(at(2026, 10, 2, 17)), at(2026, 10, 5, 12)), 0);
  assert.equal(businessDaysSince(iso(at(2026, 10, 2, 17)), at(2026, 10, 5, 17)), 1);
  assert.equal(threadState(mine(at(2026, 10, 2, 17)), at(2026, 10, 5, 17)), 'waiting');
  // Vendredi 10 h, mercredi 10 h : lundi, mardi, mercredi.
  assert.equal(threadState(mine(at(2026, 10, 2, 10)), at(2026, 10, 7, 10)), 'to_follow_up');
  // Samedi : aucun jour ouvré écoulé.
  assert.equal(businessDaysSince(iso(at(2026, 10, 3, 9)), at(2026, 10, 4, 18)), 0);
});

test('Le changement d’heure du 25/10/2026 ne décale pas la frontière', () => {
  // Vendredi 23 octobre 10 h (heure d'été), mercredi 28 octobre 10 h (heure d'hiver) : lundi, mardi, mercredi.
  assert.equal(businessDaysSince(iso(at(2026, 10, 23, 10)), at(2026, 10, 28, 10)), 3);
  assert.equal(businessDaysSince(iso(at(2026, 10, 23, 10)), at(2026, 10, 28, 9, 59)), 2);
});

test('Une séquence active garde la conversation en attente : la relance est déjà prévue', () => {
  const old = at(2026, 9, 1);
  assert.equal(threadState(mine(old, { sequenceActive: true }), at(2026, 10, 6)), 'waiting');
  assert.equal(threadState(mine(old, { sequenceActive: false }), at(2026, 10, 6)), 'to_follow_up');
});

test('Une séquence Recruiter reste en attente dans la messagerie Classic, malgré un historique plus récent', () => {
  const active = { profile_id: 'AE_recruiter', provider_id: 'provider', resolved_profile_id: 'ACo_classic', status: 'active', replied_at: null };
  const closed = { profile_id: 'ACo_classic', status: 'completed' };
  const index = indexInboxEnrollments([closed, active]);
  const chat = { id: 'chat', attendees: [{ provider_id: 'other', attendee_provider_id: 'ACo_classic' }], last_message: { is_sender: true, timestamp: iso(at(2026, 9, 1)) } };
  assert.equal(getChatJobInfo(chat, index), active);
  assert.equal(getChatThreadState(chat, index, at(2026, 10, 6)), 'waiting');
  assert.equal(index.get('AE_recruiter'), active);
  assert.equal(index.get('provider'), active);
  assert.equal(getChatThreadState({ ...chat, last_message: { ...chat.last_message, is_sender: false } }, index), 'to_reply');
});

test('Les séquences actives anciennes restent visibles au-delà de la première page, dans la bonne organisation', async () => {
  const closed = Array.from({ length: 500 }, (_, i) => ({ profile_id: `closed-${i}`, status: 'completed' }));
  const active = Array.from({ length: 501 }, (_, i) => ({ profile_id: `active-${i}`, status: 'active' }));
  const organizations = [];
  const client = {
    from() {
      let onlyActive = false;
      const query = {
        select() { return query; }, order() { return query; },
        eq(field, value) { if (field === 'organization_id') organizations.push(value); if (field === 'status') onlyActive = value === 'active'; return query; },
        async limit() { return { data: closed, error: null }; },
        async range(from, to) { return { data: onlyActive ? active.slice(from, to + 1) : [], error: null }; },
      };
      return query;
    },
  };
  const index = indexInboxEnrollments(await fetchInboxEnrollmentRows(client, 'org-a'));
  assert.equal(index.get('active-500')?.status, 'active');
  assert.equal(index.get('closed-0')?.status, 'completed');
  assert.ok(organizations.length > 0 && organizations.every(id => id === 'org-a'));
  assert.deepEqual(await fetchInboxEnrollmentRows({ from() { throw new Error('lecture hors organisation'); } }, ''), []);
});

test('Date illisible ou absente : en attente, jamais une relance devinée', () => {
  const now = at(2026, 10, 6);
  assert.equal(threadState({ lastIsMine: true, lastAt: 'pas une date', sequenceActive: false }, now), 'waiting');
  assert.equal(threadState({ lastIsMine: true, lastAt: null, sequenceActive: false }, now), 'waiting');
  assert.equal(businessDaysSince('pas une date', now), null);
});

test('Une date future ou très ancienne ne bloque pas le calcul', () => {
  const now = at(2026, 10, 6);
  assert.equal(businessDaysSince(iso(at(2026, 10, 9)), now), 0);
  assert.ok(businessDaysSince('2001-01-01T00:00:00Z', now) > 1000);
});

test('Chaque conversation active est dans un seul onglet, les compteurs somment sans doublon', () => {
  const counts = countThreadStates(['to_reply', 'to_reply', 'to_follow_up', 'waiting', 'none', 'waiting']);
  assert.deepEqual(counts, { to_reply: 2, to_follow_up: 1, waiting: 2 });
  assert.deepEqual(RESPONSE_FILTER_STATE, {
    waiting_me: 'to_reply',
    to_follow_up: 'to_follow_up',
    waiting_candidate: 'waiting',
  });
});

test('?onglet= : aller-retour, valeur inconnue ou absente = toutes', () => {
  assert.equal(responseFilterFromParam('a-repondre'), 'waiting_me');
  assert.equal(responseFilterFromParam('a-relancer'), 'to_follow_up');
  assert.equal(responseFilterFromParam('en-attente'), 'waiting_candidate');
  assert.equal(responseFilterFromParam('nimporte-quoi'), 'all');
  assert.equal(responseFilterFromParam(null), 'all');
  for (const filter of ['waiting_me', 'to_follow_up', 'waiting_candidate']) {
    assert.equal(responseFilterFromParam(responseFilterToParam(filter)), filter);
  }
  assert.equal(responseFilterToParam('all'), null, 'toutes : pas de paramètre');
});

test('Phrase de la ligne « À faire » : jours ouvrés accordés par la fonction partagée, sans tiret long', () => {
  assert.match(code('src/lib/inboxThreadSentence.ts'), /import \{ plural \} from '\.\/plural';/);
  assert.doesNotMatch(code('src/lib/inboxThreadSentence.ts') + code('src/lib/inboxThreadState.ts'), /const plural = \(|function plural\(/);
  assert.equal(threadWaitingSentence('to_reply', 0), 'Le candidat attend votre réponse.');
  assert.equal(threadWaitingSentence('to_reply', 1), 'Le candidat attend votre réponse depuis 1 jour ouvré.');
  assert.equal(threadWaitingSentence('to_reply', 2), 'Le candidat attend votre réponse depuis 2 jours ouvrés.');
  assert.equal(threadWaitingSentence('to_follow_up', 3), 'Sans réponse depuis 3 jours ouvrés.');
  assert.equal(threadWaitingSentence('to_follow_up', null), 'Sans réponse du candidat.');
  assert.equal(threadWaitingSentence('waiting', 2), null);
  assert.equal(threadWaitingSentence('none', null), null);
});

test('Dernier message du fil : le plus récent, hors messages supprimés', () => {
  const list = [
    { id: 'a', timestamp: iso(at(2026, 10, 1)), is_sender: false },
    { id: 'b', timestamp: iso(at(2026, 10, 3)), is_sender: true },
    { id: 'c', timestamp: iso(at(2026, 10, 5)), is_sender: false, is_deleted: true },
    { id: 'd', is_sender: false },
  ];
  assert.equal(latestMessage(list).id, 'b');
  assert.equal(latestMessage([]), null);
  assert.equal(latestMessage([{ id: 'x', timestamp: 'illisible' }]), null);
});

test('Action suggérée par l’analyse en cache : la plus prioritaire, texte borné, rien si illisible', () => {
  const analysis = {
    suggestedActions: [
      { type: 'tag', priority: 'low', label: 'Étiqueter' },
      { type: 'reply', priority: 'high', label: '  Répondre sur le salaire  ', description: 'Il demande une fourchette.' },
      { type: 'alert', priority: 'high', label: 'Deuxième urgence' },
      { type: 'schedule_followup', label: 'Sans priorité', description: 42 },
      { label: '   ' },
      'texte',
      null,
    ],
  };
  assert.deepEqual(pickSuggestedAction(analysis), {
    type: 'reply',
    priority: 'high',
    label: 'Répondre sur le salaire',
    description: 'Il demande une fourchette.',
  });
  // Priorité absente : moyenne ; description non textuelle : ignorée.
  const noPriority = pickSuggestedAction({ suggestedActions: [{ type: 'reply', label: 'Proposer un appel', description: 42 }] });
  assert.equal(noPriority.priority, 'medium');
  assert.equal(noPriority.description, null);
  assert.equal(pickSuggestedAction({ suggestedActions: [{ label: 'x'.repeat(500), priority: 'high' }] }).label.length, 160);
  // Marqueur « aucun message du candidat », liste vide, entrées invalides.
  assert.equal(pickSuggestedAction({ _marker: true, suggestedActions: [] }), null);
  assert.equal(pickSuggestedAction({}), null);
  assert.equal(pickSuggestedAction(null), null);
  assert.equal(pickSuggestedAction('texte'), null);
  assert.equal(pickSuggestedAction({ suggestedActions: 'oui' }), null);
});

// ---------------------------------------------------------------- écrans
const sidebar = code('src/components/outreach/inbox/ChatListSidebar.tsx');
const hook = code('src/hooks/useMessagesInbox.ts');
const helpers = code('src/hooks/useMessagesInboxHelpers.ts');
const page = code('src/pages/Inbox.tsx');
const inbox = code('src/components/outreach/MessagesInbox.tsx');
const view = code('src/components/outreach/inbox/MessageView.tsx');
const step = code('src/components/outreach/inbox/ThreadNextStep.tsx');
const cta = code('src/components/outreach/inbox/CtaReplyButton.tsx');
const suggestedHook = code('src/hooks/useChatSuggestedAction.ts');
const newFiles = {
  step,
  suggestedHook,
  lib: code('src/lib/inboxThreadState.ts'),
  sentence: code('src/lib/inboxThreadSentence.ts'),
};

test('Onglets : Toutes, À répondre, À relancer, En attente, avec compteurs sur les deux premiers états', () => {
  assert.match(sidebar, /<SegmentedControl\s+aria-label="Conversations affichées"\s+variant="quiet"/);
  for (const value of ['all', 'waiting_me', 'to_follow_up', 'waiting_candidate']) {
    assert.match(sidebar, new RegExp(`value: '${value}'`), `onglet ${value}`);
  }
  assert.match(sidebar, /text="À répondre" count=\{threadCounts\.to_reply\}/);
  assert.match(sidebar, /text="À relancer" count=\{threadCounts\.to_follow_up\}/);
  assert.match(sidebar, /count > 0 \?/, 'un compteur nul ne s’écrit pas');
  assert.doesNotMatch(sidebar, /waitingMeCount/, 'plus de compteur qui compte les conversations archivées ou en sommeil');
});

test('Le filtre et les compteurs passent par la définition unique', () => {
  assert.match(hook, /const wanted = RESPONSE_FILTER_STATE\[responseFilter\];/);
  assert.match(hook, /threadStates\.get\(chat\.id\) === wanted/);
  assert.doesNotMatch(hook, /last_message\?\.is_sender === (?:true|false)/, 'plus de règle à part dans le filtre');
  // Compteurs : conversations actives seulement.
  const counts = hook.slice(hook.indexOf('const threadCounts = useMemo'), hook.indexOf('// Filter chats effect'));
  assert.match(counts, /getEffectiveStatus\(chatStatus\.statusMap\.get\(chat\.id\), now\) === 'active'/);
  assert.match(counts, /countThreadStates\(active\)/);
  // Les repères de la liste reprennent les mêmes états.
  assert.match(helpers, /const state = getChatThreadState\(chat, enrollmentsMap, now\);/);
  assert.match(helpers, /if \(state === 'to_follow_up'\) return \{ kind: 'follow_up', mission \};/);
});

test('?onglet= : lu au montage, réécrit sans empiler l’historique, lien de conversation conservé', () => {
  assert.match(page, /responseFilterFromParam\(searchParams\.get\('onglet'\)\)/);
  assert.match(page, /next\.set\('onglet', param\)/);
  assert.match(page, /next\.delete\('onglet'\)/);
  assert.match(page, /\{ replace: true \}/);
  assert.match(page, /new URLSearchParams\(prev\)/, 'les autres paramètres (chatId) sont gardés');
  assert.match(inbox, /initialResponseFilter: initialTab/);
  assert.match(inbox, /onTabChange\?\.\(tab\)/);
  assert.match(inbox, /threadCounts=\{threadCounts\}/, 'la liste reçoit les compteurs de tous les canaux');
  // Le montage ne dépend pas de l'onglet : changer d'onglet ne remonte pas la messagerie.
  assert.match(page, /key=\{initialChatId \?\? 'inbox'\}/);
});

test('Les compteurs de l’inbox réelle ajoutent e-mail et WhatsApp aux conversations LinkedIn, sans doublon de fournisseur', () => {
  const now = at(2026, 10, 7, 10);
  const record = (id, channel, direction, date) => ({
    id, organization_id: 'org-a', candidate_id: id, project_id: 'mission-a',
    owner_user_id: 'user-a', account_id: 'account-a', audience: 'candidate',
    provider_message_id: id, provider_thread_id: `${id}-thread`, channel,
    service: channel === 'email' ? 'gmail' : 'whatsapp', direction,
    counterpart: 'candidat@example.test', sender: 'candidat@example.test',
    recipient: 'recruteur@example.test', content: 'Message enregistré', occurred_at: iso(date),
  });
  const received = record('received', 'email', 'inbound', now);
  const conversations = groupMultichannelConversations([
    received, { ...received, id: 'provider-retry' },
    record('old-send', 'whatsapp', 'outbound', at(2026, 10, 1, 10)),
    record('recent-send', 'email', 'outbound', now),
  ], [], [], now);
  // Jouer le calcul effectivement branché entre les deux lectures et la liste.
  const start = inbox.indexOf('const externalCounts =');
  const end = inbox.indexOf('const { addReaction', start);
  assert.ok(start >= 0 && end > start, 'calcul des compteurs réels introuvable');
  const compute = new Function('inbox', 'multichannel', `${inbox.slice(start, end)} return threadCounts;`);
  const linkedIn = { threadCounts: countThreadStates(['to_reply', 'waiting', 'none']) };
  assert.deepEqual(compute(linkedIn, { conversations }), { to_reply: 2, to_follow_up: 1, waiting: 2 });
  assert.deepEqual(compute(linkedIn, { conversations: [] }), linkedIn.threadCounts, 'LinkedIn seul garde ses compteurs');
  assert.deepEqual(compute({ threadCounts: countThreadStates([]) }, { conversations }), { to_reply: 1, to_follow_up: 1, waiting: 1 }, 'les compteurs existent aussi sans compte LinkedIn');
  assert.match(sidebar, /conversation\.state !== RESPONSE_FILTER_STATE\[responseFilter\]/, 'les filtres externes suivent les mêmes états');
  assert.match(inbox, /replyCount=\{threadCounts\.to_reply\} followUpCount=\{threadCounts\.to_follow_up\}/, 'les cartes de l’accueil et les onglets reçoivent le même total');
});

test('Ligne « À faire » : montée une fois au-dessus du composeur, seulement pour À répondre et À relancer', () => {
  assert.equal(view.split('<ThreadNextStep').length - 1, 1);
  assert.match(view, /if \(state !== 'to_reply' && state !== 'to_follow_up'\) return null;/);
  assert.ok(view.indexOf('<ThreadNextStep') < view.indexOf('<MessageComposer'), 'au-dessus du composeur');
  // Même règle que les onglets, avec le fil et l'inscription lus en base.
  assert.match(view, /const last = latestMessage\(messages\) \?\? selectedChat\.last_message \?\? null;/);
  assert.match(view, /sequenceActive: hasActiveEnrollment \|\|/);
  // L'action IA ne s'affiche que pour À répondre, et pas si le candidat a écrit depuis l'analyse.
  assert.match(view, /useChatSuggestedAction\(selectedChat, nextStep\?\.state === 'to_reply'\)/);
  assert.match(view, /new Date\(nextStep\.lastAt\) > new Date\(cached\.analyzedAt\)/);
  // Téléphone : la ligne s'efface quand le champ de saisie a le focus. Clavier ouvert, elle laissait 117 px
  // de fil (moins d'un message) ; effacée, il en reste 226 (mesuré sur 390 x 470).
  assert.match(view, /<div\b[^>]*className="group\/compose"[^>]*>/, 'la rangée réunit la ligne et le composeur');
  assert.match(step, /group-has-\[textarea:focus\]\/compose:max-md:hidden/, 'effacée au focus, sur téléphone seulement');
  // Les hooks restent avant le retour anticipé de la conversation vide.
  assert.ok(view.indexOf('const nextStep = useMemo') < view.indexOf('if (!selectedChat) {'));
});

test('Ligne « À faire » : rien ne part sans envoi, rappel préparé, aucun bouton plein', () => {
  assert.match(step, /aria-label="À faire pour cette conversation"/);
  assert.match(step, /presetCta=\{state === 'to_reply' \? 'auto' : 'check_interest'\}/);
  assert.match(step, /Rédiger une réponse/);
  assert.match(step, /Rédiger une relance/);
  assert.match(step, /Créer un rappel/);
  assert.match(step, /prefillCategory="follow_up"/);
  assert.match(step, /Suggestion de l'IA Konekt : /);
  assert.doesNotMatch(step, /variant="primary"/, 'un seul bouton plein dans la conversation : Envoyer');
  assert.doesNotMatch(step, /sendMessage|onSend|functions\.invoke|\.insert\(|\.upsert\(/, 'la ligne n’envoie ni n’écrit rien');
  assert.match(step, /lazy\(\(\) =>\s*import\('@\/components\/tasks\/CreateTaskModal'\)/, 'fenêtre de tâche chargée à l’ouverture');
  // La date proposée est figée au montage (la fenêtre réécrit ses champs si elle change) ;
  // la ligne repart de zéro à chaque conversation (key).
  assert.match(step, /const \[dueAt\] = useState\(\(\) => nextBusinessMorning\(new Date\(\)\)\);/);
  assert.match(view, /<ThreadNextStep\s+key=\{selectedChat\.id\}/);
  // L'insertion ne remplace jamais un brouillon : elle s'ajoute à la suite, comme dans le composeur.
  assert.match(view, /onInsert=\{\(text\) => onNewMessageChange\(newMessage\.trim\(\) \? `\$\{newMessage\.trimEnd\(\)\}\\n\\n\$\{text\}` : text\)\}/);
  assert.match(code('src/components/outreach/inbox/MessageComposer.tsx'), /const next = value\.trim\(\) \? `\$\{value\.trimEnd\(\)\}\\n\\n\$\{msg\}` : msg;/, 'même règle que le composeur');
  // Dialogue de relecture partagé avec « Proposer une suite ».
  assert.match(cta, /presetCta \? \(/);
  assert.match(cta, /onClick=\{\(\) => void handlePick\(presetCta\)\}/);
  assert.match(cta, /<Dialog open=\{dialogOpen\}/);
});

test('Action suggérée : lecture du cache seulement, aucun crédit débité', () => {
  assert.match(suggestedHook, /\.from\('message_analysis_cache'\)/);
  assert.doesNotMatch(suggestedHook, /functions\.invoke|invokeEdgeFunction|invokeWithCredits|\.insert\(|\.upsert\(|\.update\(|\.delete\(/);
  assert.match(suggestedHook, /queryKey: \['chat-intents', accountId, 'suggested-action', chatId\]/);
});

test('Nouveaux fichiers : textes vouvoyés, aucun nom de prestataire, registre visuel du kit', () => {
  for (const [name, src] of Object.entries(newFiles)) {
    assert.doesNotMatch(src, /Unipile|Apollo|People Data Labs|Anthropic|Claude\b/, `${name} : nom de prestataire`);
    assert.doesNotMatch(src, /\b(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/, `${name} : couleur brute`);
    assert.doesNotMatch(src, /text-\[|z-\[|z-50|\buppercase\b|rounded-none|rounded-2xl|rounded-3xl|framer-motion/, `${name} : registre hors kit`);
    assert.doesNotMatch(src, /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u, `${name} : emoji`);
    assert.doesNotMatch(src, /\(s\)|—|\bTu\b|\btu\b|\bton\b/, `${name} : tiret long, « (s) » ou tutoiement`);
  }
});
