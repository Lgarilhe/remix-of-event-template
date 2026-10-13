// Normaliseurs de conversation, de message et d'e-mail : exemples de référence
// (fixtures/*.json), formes lues par la messagerie, par incoming.ts et par les
// outils de l'assistant, et lecture tolérante.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/unipile/normalize/messages.test.ts

import { deepStrictEqual, strictEqual } from 'node:assert';
import chatGroup from '../fixtures/chat-group.json' with { type: 'json' };
import chatOneToOne from '../fixtures/chat-one-to-one.json' with { type: 'json' };
import emailNoThread from '../fixtures/email-no-thread.json' with { type: 'json' };
import emailReply from '../fixtures/email-reply.json' with { type: 'json' };
import messageInmail from '../fixtures/message-inmail.json' with { type: 'json' };
import { isCandidateReplyCandidate, LEGACY_FOLDER_BY_INBOX, toKonektChat, toKonektChatLookup, toKonektEmail, toKonektMessage, toKonektPage } from './messages.ts';

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

Deno.test('toKonektChat : conversation 1 à 1 avec InMail, boîte Recruiter', () => {
  deepStrictEqual(toKonektChat(chatOneToOne.input, chatOneToOne.context as { accountId: string; inboxKind: 'recruiter' }), chatOneToOne.expected);
});

Deno.test('toKonektChat : groupe, participants, compteur -1 lu comme 1, aperçu sans horodatage', () => {
  deepStrictEqual(toKonektChat(chatGroup.input, chatGroup.context), chatGroup.expected);
});

Deno.test('toKonektChat : ce que lisent la messagerie et incoming.ts', () => {
  const chat = toKonektChat(chatOneToOne.input, { accountId: 'acc_test_linkedin', inboxKind: 'classic' });
  strictEqual(chat.account_id, 'acc_test_linkedin');
  strictEqual(Number(chat.type) === 0, true); // incoming.ts : une conversation 1 à 1 a le type 0
  strictEqual(chat.attendees.length, 1);
  strictEqual(chat.attendees[0].is_self, false);
  strictEqual(chat.attendees[0].provider_id, 'ACoAAB1234567');
  strictEqual(chat.attendee_provider_id, 'ACoAAB1234567');
  deepStrictEqual(chat.folder, [LEGACY_FOLDER_BY_INBOX.classic]);
  strictEqual(chat.folder.some((f) => f.toLowerCase().includes('classic')), true);
  strictEqual(chat.folder.some((f) => f.toLowerCase().includes('recruiter')), false);
  strictEqual(chat.content_type, 'inmail');
});

Deno.test('toKonektChat : le dossier d’avant suit la licence de la boîte, sinon les dossiers v2 sont rendus tels quels', () => {
  const raw = { id: 'c', type: '1to1', folders: ['a', 'b'] };
  deepStrictEqual(toKonektChat(raw, { inboxKind: 'sales_navigator' }).folder, ['INBOX_LINKEDIN_SALES_NAVIGATOR']);
  deepStrictEqual(toKonektChat(raw).folder, ['a', 'b']);
  deepStrictEqual(toKonektChat({ id: 'c' }).folder, []);
});

Deno.test('toKonektChat : compteur de non lus, type numérique, jamais d’InMail sans signal', () => {
  strictEqual(toKonektChat({ unread_count: 0 }).unread_count, 0);
  strictEqual(toKonektChat({ unread_count: 5 }).unread, 5);
  strictEqual(toKonektChat({ unread_count: -1 }).unread_count, 1);
  strictEqual(toKonektChat({}).unread_count, 0);
  strictEqual(toKonektChat({ type: '1to1' }).type, 0);
  strictEqual(toKonektChat({ is_group: true }).type, 1);
  strictEqual(toKonektChat({ type: 'channel' }).type, 2);
  strictEqual(toKonektChat({}).type, null);
  strictEqual(toKonektChat({ last_message: { specifics: { type: 'MESSAGE' } } }).is_inmail, false);
  strictEqual(toKonektChat({ last_message: { specifics: { type: 'INMAIL_ACCEPT' } } }).content_type, 'inmail');
  strictEqual(toKonektChat({}).content_type, null);
});

Deno.test('toKonektChat : l’heure suit last_message_timestamp, puis le dernier message, puis updated_at, puis created_at', () => {
  strictEqual(toKonektChat({ last_message_timestamp: 'A', updated_at: 'B' }).timestamp, 'A');
  strictEqual(toKonektChat({ last_message: { timestamp: 'M' }, updated_at: 'B' }).timestamp, 'M');
  strictEqual(toKonektChat({ updated_at: 'B', created_at: 'C' }).timestamp, 'B');
  strictEqual(toKonektChat({ created_at: 'C' }).timestamp, 'C');
  strictEqual(toKonektChat({}).timestamp, null);
});

Deno.test('toKonektChat : sans compte donné account_id est null, sans utilisateur pas de participant inventé', () => {
  const chat = toKonektChat({ id: 'c', type: '1to1' });
  strictEqual(chat.account_id, null);
  deepStrictEqual(chat.attendees, []);
  strictEqual(chat.attendee_provider_id, null);
});

Deno.test('toKonektChatLookup : les correspondances de GET /users/{id}/chat, sans identifiant elles sont écartées', () => {
  deepStrictEqual(
    toKonektChatLookup({ object: 'ChatLookup', data: [{ chat_id: 'c1', inbox_id: 'i1', has_history: true }, { chat_id: 'c2' }, { inbox_id: 'x' }, null, 'x'] }),
    [
      { id: 'c1', chat_id: 'c1', inbox_id: 'i1', has_history: true },
      { id: 'c2', chat_id: 'c2', inbox_id: null, has_history: null },
    ],
  );
  deepStrictEqual(toKonektChatLookup({ data: [] }), []);
  deepStrictEqual(toKonektChatLookup(null), []);
  deepStrictEqual(toKonektChatLookup({ data: 'x' }), []);
});

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

Deno.test('toKonektMessage : InMail envoyé, réactions développées, pièces jointes', () => {
  deepStrictEqual(toKonektMessage(messageInmail.input, messageInmail.context), messageInmail.expected);
});

Deno.test('toKonektMessage : ce que lisent la messagerie, l’assistant et incoming.ts', () => {
  const message = toKonektMessage(messageInmail.input, { accountId: 'acc_x' });
  strictEqual(message.provider_id || message.message_id || message.id, 'msg_100');
  strictEqual(message.is_sender, true);
  strictEqual(message.seen, 1);
  strictEqual(message.read, true);
  strictEqual(message.message_type, 'INMAIL');
  strictEqual(message.subject, 'Une opportunité');
  strictEqual(message.account_id, 'acc_x');
  strictEqual(message.attachments.length, 2);
  strictEqual(message.reactions.filter((r) => r.value === '👍').length, 2);
});

Deno.test('toKonektMessage : l’identifiant de conversation vient du message, sinon du contexte', () => {
  strictEqual(toKonektMessage({ id: 'm' }, { chatId: 'chat_ctx' }).chat_id, 'chat_ctx');
  strictEqual(toKonektMessage({ id: 'm', chat_id: 'chat_own' }, { chatId: 'chat_ctx' }).chat_id, 'chat_own');
  strictEqual(toKonektMessage({ id: 'm' }).chat_id, null);
});

Deno.test('toKonektMessage : seen et read suivent is_seen, sans information ils restent null', () => {
  strictEqual(toKonektMessage({ is_seen: false }).seen, 0);
  strictEqual(toKonektMessage({ is_seen: false }).read, false);
  strictEqual(toKonektMessage({}).seen, null);
  strictEqual(toKonektMessage({}).read, null);
});

Deno.test('toKonektMessage : les réactions sont plafonnées par valeur et une valeur vide est ignorée', () => {
  const message = toKonektMessage({ reactions_counter: [{ reaction: '👍', count: 100000 }, { reaction: '', count: 3 }, { count: 2 }, { reaction: '😀', count: -4 }] });
  strictEqual(message.reactions.length, 50);
  strictEqual(message.reactions.every((r) => r.value === '👍'), true);
});

Deno.test('toKonektMessage : ne lève jamais', () => {
  for (const bad of [null, undefined, 'x', 3, [], { attachments: 'x' }, { attachments: [null, 1, {}] }, { sender: 'x', reactions_counter: 'x' }]) {
    const message = toKonektMessage(bad);
    strictEqual(message.id, null);
    strictEqual(Array.isArray(message.attachments), true);
    strictEqual(Array.isArray(message.reactions), true);
  }
});

// ---------------------------------------------------------------------------
// E-mail
// ---------------------------------------------------------------------------

Deno.test('toKonektEmail : réponse d’un candidat, en-têtes de chaînage, destinataires au format d’avant', () => {
  deepStrictEqual(toKonektEmail(emailReply.input, emailReply.context), emailReply.expected);
});

Deno.test('toKonektEmail : sans fil ni en-têtes, thread_id reste null et thread_key retombe sur l’identifiant RFC', () => {
  const email = toKonektEmail(emailNoThread.input);
  deepStrictEqual(email, emailNoThread.expected);
  strictEqual(email.thread_id, null);
  strictEqual(email.thread_key, '<solo@mail.example>');
});

Deno.test('toKonektEmail : ce que lit incoming.ts', () => {
  const email = toKonektEmail(emailReply.input, { accountId: 'acc_test_mail', accountEmail: 'recruteur@konekt.example' });
  strictEqual(email.from_attendee?.identifier, 'Candidat@Example.com');
  deepStrictEqual(email.to_attendees.map((a) => a.identifier), ['recruteur@konekt.example']);
  deepStrictEqual(email.cc_attendees.map((a) => a.identifier), ['copie@konekt.example']);
  strictEqual(email.body_plain, 'Bonjour, je suis intéressé.');
  strictEqual(email.date, '2026-10-01T09:30:00.000Z');
  strictEqual(email.provider_id || email.message_id || email.id, 'em_0001'); // l'identifiant stocké est celui du fournisseur, jamais l'en-tête RFC
  strictEqual(email.message_id, '<abc123@mail.example>');
  strictEqual(email.in_reply_to, '<orig@mail.example>');
  strictEqual(email.is_sender, false);
  strictEqual(email.attachments[0].name, 'cv.pdf');
  strictEqual(email.has_attachments, true);
});

Deno.test('toKonektEmail : is_sender compare l’expéditeur à la boîte sans tenir compte de la casse, et reste null sans adresse connue', () => {
  const own = { from: [{ email: 'Moi@Konekt.example' }] };
  strictEqual(toKonektEmail(own, { accountEmail: 'moi@konekt.example' }).is_sender, true);
  strictEqual(toKonektEmail(own, { accountEmail: 'autre@konekt.example' }).is_sender, false);
  strictEqual(toKonektEmail(own).is_sender, null);
  strictEqual(toKonektEmail({}, { accountEmail: 'a@b.fr' }).is_sender, null);
});

Deno.test('toKonektEmail : thread_key suit References, puis In-Reply-To, puis l’identifiant RFC', () => {
  const headers = (h: Array<[string, string]>) => ({ message_id: '<own@x>', headers: h.map(([name, value]) => ({ name, value })) });
  strictEqual(toKonektEmail(headers([['References', '<r1@x> <r2@x>'], ['In-Reply-To', '<r2@x>']])).thread_key, 'r1@x');
  strictEqual(toKonektEmail(headers([['In-Reply-To', '<r2@x>']])).thread_key, 'r2@x');
  strictEqual(toKonektEmail(headers([])).thread_key, '<own@x>');
  strictEqual(toKonektEmail({ ...headers([['references', 'r1@x r2@x']]) }).references.join(','), 'r1@x,r2@x'); // nom d'en-tête insensible à la casse, sans chevrons
  strictEqual(toKonektEmail({ thread_id: 'T', ...headers([['References', '<r1@x>']]) }).thread_key, 'T');
});

Deno.test('toKonektEmail : destinataire sans adresse écarté, nom absent null, ne lève jamais', () => {
  const email = toKonektEmail({ to: [{ display_name: 'Sans adresse' }, { email: 'ok@x.fr' }, null, 'x'], from: 'x', attachments: 'x', headers: 'x' });
  deepStrictEqual(email.to_attendees, [{ display_name: null, identifier: 'ok@x.fr' }]);
  strictEqual(email.from_attendee, null);
  deepStrictEqual(email.attachments, []);
  deepStrictEqual(email.headers, []);
  for (const bad of [null, undefined, 'x', 3, []]) strictEqual(toKonektEmail(bad).id, null);
});

// ---------------------------------------------------------------------------
// Listes
// ---------------------------------------------------------------------------

Deno.test('toKonektPage : data, total_count et next_cursor deviennent items, total et cursor', () => {
  const page = toKonektPage({ data: [{ id: 'a' }, { id: 'b' }], total_count: 7, next_cursor: 'n1' }, (raw) => (raw as { id: string }).id);
  deepStrictEqual(page, { items: ['a', 'b'], cursor: 'n1', total: 7 });
});

Deno.test('toKonektPage : fin de liste, fil d’e-mails (emails), tableau nu, corps illisible', () => {
  deepStrictEqual(toKonektPage({ data: [] }, (r) => r), { items: [], cursor: null, total: null });
  deepStrictEqual(toKonektPage({ object: 'Thread', id: 't', emails: [1, 2] }, (r) => r), { items: [1, 2], cursor: null, total: null });
  deepStrictEqual(toKonektPage([1], (r) => r), { items: [1], cursor: null, total: null });
  deepStrictEqual(toKonektPage(null, (r) => r), { items: [], cursor: null, total: null });
  deepStrictEqual(toKonektPage({ data: [{ id: 'x' }], next_cursor: '' }, (r) => r).cursor, null);
});

Deno.test('toKonektPage : accepte aussi la page déjà lue par pagination.ts', () => {
  deepStrictEqual(toKonektPage({ items: [1, 2], nextCursor: 'n', totalCount: 5, hasMore: null }, (r) => r), { items: [1, 2], cursor: 'n', total: 5 });
});

Deno.test('toKonektPage : avec un normaliseur de message, la liste est prête pour le journal', () => {
  const page = toKonektPage({ data: [{ id: 'm1', text: 'a', is_sender: true }] }, (raw) => toKonektMessage(raw, { accountId: 'acc_1', chatId: 'c1' }));
  strictEqual(page.items[0].chat_id, 'c1');
  strictEqual(page.items[0].account_id, 'acc_1');
});

Deno.test('toKonektMessage : une ligne système (is_event, is_hidden) est reconnue et n’est pas une réponse', () => {
  const call = toKonektMessage({ id: 'm1', is_sender: false, is_event: true, event_type: 9, is_hidden: false, text: '' });
  strictEqual(call.is_event, true);
  strictEqual(call.event_type, 9);
  strictEqual(isCandidateReplyCandidate(call), false);
  const hidden = toKonektMessage({ id: 'm2', is_sender: false, is_hidden: true, text: 'x' });
  strictEqual(hidden.is_hidden, true);
  strictEqual(isCandidateReplyCandidate(hidden), false);
  strictEqual(isCandidateReplyCandidate(toKonektMessage({ id: 'm3', is_sender: false, is_deleted: true })), false);
  strictEqual(isCandidateReplyCandidate(toKonektMessage({ id: 'm4', is_sender: true, text: 'ours' })), false);
  for (const type of ['INVITATION', 'INMAIL_DECLINE', 'INMAIL_ACCEPT']) {
    strictEqual(isCandidateReplyCandidate(toKonektMessage({ id: 'm5', is_sender: false, text: 'x', specifics: { type } })), false, type);
  }
  for (const specifics of [undefined, { type: 'MESSAGE' }, { type: 'INMAIL_REPLY', subject: 's' }]) {
    strictEqual(isCandidateReplyCandidate(toKonektMessage({ id: 'm6', is_sender: false, is_event: false, text: 'bonjour', specifics })), true);
  }
  strictEqual(isCandidateReplyCandidate(null), false);
});

Deno.test('toKonektChat : un aperçu de dernier message ne dit pas si c’est un InMail (inmail_unknown)', () => {
  const preview = toKonektChat({ id: 'c1', last_message: { object: 'MessagePreview', text: 'hi', sender_display_name: 'Marie', is_sender: false } });
  strictEqual(preview.inmail_unknown, true);
  strictEqual(preview.last_message?.is_preview, true);
  strictEqual(preview.last_message?.sender_name, 'Marie');
  strictEqual(preview.last_message?.is_sender, false);
  const full = toKonektChat({ id: 'c2', last_message: { object: 'Message', text: 'hi', specifics: { type: 'INMAIL' } } });
  strictEqual(full.inmail_unknown, false);
  strictEqual(full.is_inmail, true);
  strictEqual(toKonektChat({ id: 'c3' }).inmail_unknown, false);
});

Deno.test('toKonektEmail : in_reply_to retombe sur le dernier identifiant de References, comme le webhook', () => {
  const onlyReferences = toKonektEmail({ id: 'e1', headers: [{ name: 'References', value: '<a@x> <b@x>' }] });
  strictEqual(onlyReferences.in_reply_to, '<b@x>');
  const both = toKonektEmail({ id: 'e2', headers: [{ name: 'In-Reply-To', value: ' <z@x> ' }, { name: 'References', value: '<a@x> <b@x>' }] });
  strictEqual(both.in_reply_to, '<z@x>');
  strictEqual(toKonektEmail({ id: 'e3', headers: [{ name: 'Subject', value: 's' }] }).in_reply_to, null);
});
