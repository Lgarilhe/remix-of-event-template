// E-mail : envoi (suivi, fil de réponse, issue sent/uncertain/refused), liste,
// lecture, fil, et lecture des en-têtes. Chaque appel est joué contre un
// transport factice qui vérifie l'URL, la méthode, la requête et le corps.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/unipile/email.test.ts

import { deepStrictEqual, rejects, strictEqual, throws } from 'node:assert';
import { buildSendEmailBody, getEmail, getThread, headerValue, inReplyToOf, listEmails, sendEmail } from './email.ts';
import { isUnipileError } from './errors.ts';
import { OutdatedAccountIdError } from './ids.ts';
import { fixtures, jsonResponse, networkError, withMockTransport } from './testing.ts';

const ACC = 'acc_01abc';
const TO = [{ email: 'candidat@exemple.fr', display_name: 'Marie Dupont' }];

// ---------------------------------------------------------------------------
// Envoi
// ---------------------------------------------------------------------------

Deno.test('sendEmail : POST /{acc}/emails/send avec html, plain_text, from et destinataires {email, display_name}', async () => {
  await withMockTransport(() => jsonResponse({ object: 'EmailSent', id: 'em_1', message_id: '<abc@x>' }), async (mock) => {
    const out = await sendEmail({
      accountId: ACC,
      to: TO,
      cc: [{ email: 'cc@exemple.fr' }],
      bcc: [{ email: 'bcc@exemple.fr' }],
      from: { email: 'moi@konekt.fr', display_name: 'Moi' },
      subject: 'Bonjour',
      html: '<p>Bonjour</p>',
      plainText: 'Bonjour',
    });
    deepStrictEqual(out, { outcome: 'sent', emailId: 'em_1', messageId: '<abc@x>' });
    strictEqual(mock.calls[0].method, 'POST');
    strictEqual(mock.calls[0].path, `/${ACC}/emails/send`);
    deepStrictEqual(mock.calls[0].body, {
      to: [{ email: 'candidat@exemple.fr', display_name: 'Marie Dupont' }],
      cc: [{ email: 'cc@exemple.fr' }],
      bcc: [{ email: 'bcc@exemple.fr' }],
      from: { email: 'moi@konekt.fr', display_name: 'Moi' },
      subject: 'Bonjour',
      html: '<p>Bonjour</p>',
      plain_text: 'Bonjour',
    });
  });
});

Deno.test('sendEmail : un champ « identifier » ou autre clé étrangère ne passe jamais, ni « body » ni « account_id »', () => {
  const body = buildSendEmailBody({
    accountId: ACC,
    to: [{ email: 'a@b.fr', identifier: 'a@b.fr', extra: 1 } as unknown as { email: string }],
    html: '<p>x</p>',
  });
  deepStrictEqual(body, { to: [{ email: 'a@b.fr' }], html: '<p>x</p>' });
  const keys = Object.keys(body);
  strictEqual(keys.includes('body') || keys.includes('account_id'), false);
});

Deno.test('sendEmail : fil de réponse par reply_to_message_id, en-tête Reply-To à part, en-têtes et pièces jointes', async () => {
  await withMockTransport(() => jsonResponse({ object: 'EmailSent', id: 'em_2' }), async (mock) => {
    const out = await sendEmail({
      accountId: ACC,
      to: TO,
      html: '<p><img src="cid:logo"></p>',
      replyToMessageId: 'gmail-id-1',
      replyTo: [{ email: 'repondre@konekt.fr' }],
      customHeaders: [{ name: 'List-Unsubscribe', value: '<mailto:u@konekt.fr>' }],
      attachments: [{ content: 'QUJD', contentType: 'image/png', filename: 'logo.png', contentId: 'logo' }],
    });
    deepStrictEqual(out, { outcome: 'sent', emailId: 'em_2', messageId: null });
    deepStrictEqual(mock.calls[0].body, {
      to: [{ email: 'candidat@exemple.fr', display_name: 'Marie Dupont' }],
      html: '<p><img src="cid:logo"></p>',
      reply_to_message_id: 'gmail-id-1',
      reply_to: [{ email: 'repondre@konekt.fr' }],
      custom_headers: [{ name: 'List-Unsubscribe', value: '<mailto:u@konekt.fr>' }],
      attachments: [{ content: 'QUJD', content_type: 'image/png', filename: 'logo.png', content_id: 'logo' }],
    });
  });
});

Deno.test('sendEmail : options de suivi opens, clicks, label, custom_domain (html obligatoire)', async () => {
  await withMockTransport(() => jsonResponse({ object: 'EmailSent', id: 'em_3' }), async (mock) => {
    await sendEmail({
      accountId: ACC, to: TO, html: '<p>x</p>',
      tracking: { opens: true, clicks: false, label: 'exec-42', customDomain: 'track.konekt.fr' },
    });
    deepStrictEqual((mock.calls[0].body as Record<string, unknown>).tracking_options, {
      opens: true, clicks: false, label: 'exec-42', custom_domain: 'track.konekt.fr',
    });
  });
  throws(
    () => buildSendEmailBody({ accountId: ACC, to: TO, plainText: 'x', tracking: { opens: true } }),
    (e: unknown) => isUnipileError(e) && e.kind === 'validation',
  );
  // Un simple label, sans ouverture ni clic, ne demande pas de html.
  deepStrictEqual(
    (buildSendEmailBody({ accountId: ACC, to: TO, plainText: 'x', tracking: { label: 'l' } })).tracking_options,
    { label: 'l' },
  );
  // Un objet de suivi vide n'ajoute rien.
  strictEqual('tracking_options' in buildSendEmailBody({ accountId: ACC, to: TO, html: 'x', tracking: {} }), false);
});

Deno.test('sendEmail : destinataires et pièces jointes invalides refusés avant tout appel', async () => {
  await withMockTransport(() => jsonResponse({ object: 'EmailSent', id: 'x' }), async (mock) => {
    const v = (e: unknown) => isUnipileError(e) && e.kind === 'validation';
    await rejects(() => sendEmail({ accountId: ACC, to: [] }), v);
    await rejects(() => sendEmail({ accountId: ACC, to: [{ email: 'pas-une-adresse' }] }), v);
    await rejects(() => sendEmail({ accountId: ACC, to: [{ email: '' }] }), v);
    await rejects(() => sendEmail({ accountId: ACC, to: TO, from: { email: ' ' } }), v);
    await rejects(() => sendEmail({ accountId: ACC, to: TO, replyToMessageId: '' }), v);
    await rejects(() => sendEmail({ accountId: ACC, to: TO, attachments: [{ content: '', contentType: 'a/b', filename: 'f' }] }), v);
    await rejects(() => sendEmail({ accountId: 'old-id', to: TO }), OutdatedAccountIdError);
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('sendEmail : réponse sans id = incertain ; 5xx et panne réseau = incertain sans nouvel essai', async () => {
  await withMockTransport(() => jsonResponse({ object: 'EmailSent' }), async () => {
    strictEqual((await sendEmail({ accountId: ACC, to: TO, html: 'x' })).outcome, 'uncertain');
  });
  await withMockTransport(() => new Response('boom', { status: 500 }), async (mock) => {
    strictEqual((await sendEmail({ accountId: ACC, to: TO, html: 'x' })).outcome, 'uncertain');
    strictEqual(mock.calls.length, 1);
  });
  await withMockTransport(() => networkError(), async (mock) => {
    strictEqual((await sendEmail({ accountId: ACC, to: TO, html: 'x' })).outcome, 'uncertain');
    strictEqual(mock.calls.length, 1);
  });
});

Deno.test('sendEmail : refus du fournisseur = refused avec la nature de l\'erreur', async () => {
  await withMockTransport(() => jsonResponse({ error: 'mailbox disconnected, reconnect required' }, 403), async () => {
    const out = await sendEmail({ accountId: ACC, to: TO, html: 'x' });
    strictEqual(out.outcome, 'refused');
    if (out.outcome === 'refused') strictEqual(out.kind, 'account_disconnected');
  });
  await withMockTransport(() => jsonResponse({ error: 'invalid recipient' }, 400), async () => {
    const out = await sendEmail({ accountId: ACC, to: TO, html: 'x' });
    strictEqual(out.outcome, 'refused');
    if (out.outcome === 'refused') strictEqual(out.kind, 'validation');
  });
});

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

Deno.test('listEmails : GET /{acc}/emails avec tous les filtres', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([{ id: 'e1' }], { nextCursor: 'n1' })), async (mock) => {
    const page = await listEmails(ACC, {
      q: 'poste', metaOnly: true, to: 'a@b.fr', from: 'c@d.fr', anyEmail: ['x@y.fr', 'z@y.fr'], hasAttachment: false,
      isStarred: false, isUnread: true, before: new Date('2026-10-02T00:00:00Z'), after: '2026-10-01T00:00:00.000Z',
      excludeFolder: ['SPAM', 'TRASH'], cursor: 'c0', limit: 30,
    });
    strictEqual(page.nextCursor, 'n1');
    strictEqual(mock.calls[0].method, 'GET');
    strictEqual(mock.calls[0].path, `/${ACC}/emails`);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), {
      q: 'poste', meta_only: 'true', to: 'a@b.fr', from: 'c@d.fr', any_email: 'x@y.fr,z@y.fr', has_attachment: 'false',
      is_starred: 'false', is_unread: 'true', before: '2026-10-02T00:00:00.000Z', after: '2026-10-01T00:00:00.000Z',
      exclude_folder: 'SPAM,TRASH', cursor: 'c0', limit: '30',
    });
  });
});

Deno.test('listEmails : variante par dossier et pagination par offset ; aucune clé « items »', async () => {
  await withMockTransport(() => jsonResponse({ items: [{ id: 'old' }] }), async (mock) => {
    const page = await listEmails(ACC, { folderId: 'INBOX', offset: 40 });
    strictEqual(mock.calls[0].path, `/${ACC}/folders/INBOX/emails`);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), { offset: '40' });
    strictEqual(page.items.length, 1);
  });
});

Deno.test('listEmails : date invalide refusée', async () => {
  await rejects(() => listEmails(ACC, { after: 'hier' }), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
});

Deno.test('getEmail : GET /{acc}/emails/{id}?meta_only ; réponse illisible = erreur serveur', async () => {
  await withMockTransport(() => jsonResponse({ id: 'e1', subject: 'S', thread_id: 't1' }), async (mock) => {
    const email = await getEmail(ACC, 'e1', { metaOnly: true });
    strictEqual(email.thread_id, 't1');
    strictEqual(mock.calls[0].path, `/${ACC}/emails/e1`);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), { meta_only: 'true' });
    await getEmail(ACC, 'e1');
    strictEqual(mock.calls[1].url, `https://api.unipile.com/v2/${ACC}/emails/e1`);
  });
  await withMockTransport(() => jsonResponse({ nope: 1 }), async () => {
    await rejects(() => getEmail(ACC, 'e1'), (e: unknown) => isUnipileError(e) && e.kind === 'server');
  });
});

Deno.test('getThread : GET /{acc}/threads/{id} rend {id, emails}', async () => {
  await withMockTransport(() => jsonResponse({ object: 'Thread', id: 't1', emails: [{ id: 'e1' }, { id: 'e2' }] }), async (mock) => {
    const thread = await getThread(ACC, 't1', { metaOnly: false });
    deepStrictEqual(thread.emails.map((e) => e.id), ['e1', 'e2']);
    strictEqual(mock.calls[0].path, `/${ACC}/threads/t1`);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), { meta_only: 'false' });
  });
  await withMockTransport(() => jsonResponse({ id: 't1' }), async () => {
    await rejects(() => getThread(ACC, 't1'), (e: unknown) => isUnipileError(e) && e.kind === 'server');
  });
});

// ---------------------------------------------------------------------------
// En-têtes
// ---------------------------------------------------------------------------

Deno.test('headerValue : insensible à la casse, liste {name, value} ou objet, null si absent', () => {
  const headers = [{ name: 'Message-ID', value: '<a@x>' }, { name: 'in-reply-to', value: '<b@x>' }];
  strictEqual(headerValue(headers, 'MESSAGE-id'), '<a@x>');
  strictEqual(headerValue(headers, 'In-Reply-To'), '<b@x>');
  strictEqual(headerValue(headers, 'X-Absent'), null);
  strictEqual(headerValue({ 'Auto-Submitted': 'auto-replied' }, 'auto-submitted'), 'auto-replied');
  strictEqual(headerValue(undefined, 'x'), null);
  strictEqual(headerValue([{ name: 'X', value: 3 }], 'x'), null);
});

Deno.test('inReplyToOf : In-Reply-To, sinon le dernier identifiant de References, sinon null', () => {
  strictEqual(inReplyToOf([{ name: 'In-Reply-To', value: ' <b@x> ' }, { name: 'References', value: '<a@x> <b@x>' }]), '<b@x>');
  strictEqual(inReplyToOf([{ name: 'References', value: '<a@x>\r\n <b@x> <c@x>' }]), '<c@x>');
  strictEqual(inReplyToOf([{ name: 'References', value: 'a@x b@x' }]), 'b@x');
  strictEqual(inReplyToOf([{ name: 'Subject', value: 's' }]), null);
  strictEqual(inReplyToOf([{ name: 'In-Reply-To', value: '  ' }]), null);
  strictEqual(inReplyToOf(null), null);
});

Deno.test('buildSendEmailBody : un saut de ligne dans un en-tête, un objet ou un nom affiché est refusé (injection d’en-tête)', () => {
  const validation = (e: unknown) => isUnipileError(e) && e.kind === 'validation';
  const base = { accountId: ACC, to: TO, html: '<p>x</p>' };
  throws(() => buildSendEmailBody({ ...base, subject: 'Bonjour\r\nBcc: autre@x.fr' }), validation);
  throws(() => buildSendEmailBody({ ...base, subject: 'Bonjour\nBcc: autre@x.fr' }), validation);
  throws(() => buildSendEmailBody({ ...base, to: [{ email: 'a@x.fr', display_name: 'Marie\r\nBcc: z@x.fr' }] }), validation);
  throws(() => buildSendEmailBody({ ...base, customHeaders: [{ name: 'X-Test\r\nBcc', value: 'v' }] }), validation);
  throws(() => buildSendEmailBody({ ...base, customHeaders: [{ name: 'X Test', value: 'v' }] }), validation);
  throws(() => buildSendEmailBody({ ...base, customHeaders: [{ name: 'X-Test', value: 'v\r\nBcc: z@x.fr' }] }), validation);
  throws(() => buildSendEmailBody({ ...base, customHeaders: [{ name: 'X-Test', value: { a: 1 } as never }] }), validation);
  throws(() => buildSendEmailBody({ ...base, replyToMessageId: 'id\r\nX: y' }), validation);
  // Les valeurs ordinaires passent.
  const ok = buildSendEmailBody({ ...base, subject: 'Votre candidature', customHeaders: [{ name: 'List-Unsubscribe', value: '<mailto:u@x.fr>' }] });
  strictEqual(ok.subject, 'Votre candidature');
});
