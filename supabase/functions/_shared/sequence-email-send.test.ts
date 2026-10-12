// deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/sequence-email-send.test.ts
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { sendViaMailbox, type MailboxEmail } from './sequence-email-send.ts';
import { jsonResponse, networkError, withMockTransport } from './unipile/testing.ts';

const ACC = 'acc_01mail';

const mail = (extra: Partial<MailboxEmail> = {}): MailboxEmail => ({
  accountId: ACC,
  senderName: 'Marie Durand',
  senderAddress: 'marie@cabinet.example',
  to: 'candidat@example.com',
  subject: 'Un poste pour vous',
  htmlBody: '<p>Bonjour</p>',
  ...extra,
});

const sentReply = (extra: Record<string, unknown> = {}) => jsonResponse({ object: 'EmailSent', id: 'em_1', message_id: '<abc@mail.example>', ...extra });

Deno.test('envoi : POST /{acc}/emails/send en JSON, html, destinataires {email}, expéditeur avec adresse', async () => {
  await withMockTransport(() => sentReply(), async (mock) => {
    const out = await sendViaMailbox(mail({ cc: ['a@x.fr', ''], bcc: ['b@x.fr'] }), mock.options);
    deepStrictEqual(out, { success: true, messageId: '<abc@mail.example>' });
    strictEqual(mock.calls.length, 1);
    strictEqual(mock.calls[0].method, 'POST');
    strictEqual(mock.calls[0].path, `/${ACC}/emails/send`);
    deepStrictEqual(mock.calls[0].body, {
      to: [{ email: 'candidat@example.com' }],
      cc: [{ email: 'a@x.fr' }],
      bcc: [{ email: 'b@x.fr' }],
      from: { email: 'marie@cabinet.example', display_name: 'Marie Durand' },
      subject: 'Un poste pour vous',
      html: '<p>Bonjour</p>',
    });
    const raw = JSON.stringify(mock.calls[0].body);
    for (const old of ['account_id', 'identifier', '"body"', 'tracking_options']) ok(!raw.includes(old), old);
  });
});

Deno.test('envoi : sans adresse de boîte connue, pas de from (la boîte envoie sous son nom)', async () => {
  await withMockTransport(() => sentReply(), async (mock) => {
    await sendViaMailbox(mail({ senderAddress: null }), mock.options);
    ok(!('from' in (mock.calls[0].body as object)));
    await sendViaMailbox(mail({ senderName: '' }), mock.options);
    ok(!('from' in (mock.calls[1].body as object)));
  });
});

Deno.test('preuve d\'envoi : l\'en-tête Message-ID quand il est connu, sinon l\'identifiant du courrier', async () => {
  await withMockTransport(() => sentReply({ message_id: undefined }), async (mock) => {
    const out = await sendViaMailbox(mail(), mock.options);
    deepStrictEqual(out, { success: true, messageId: 'em_1' });
  });
});

Deno.test('expéditeur refusé (validation) : un seul nouvel essai sans from, rien n\'était parti', async () => {
  let n = 0;
  await withMockTransport(() => (++n === 1 ? jsonResponse({ error: 'invalid sender' }, 400) : sentReply()), async (mock) => {
    const out = await sendViaMailbox(mail(), mock.options);
    strictEqual(out.success, true);
    strictEqual(mock.calls.length, 2);
    ok('from' in (mock.calls[0].body as object));
    ok(!('from' in (mock.calls[1].body as object)));
  });
});

Deno.test('envoi incertain : 5xx ou coupure = send_uncertain, jamais un second POST', async () => {
  for (const reply of [() => jsonResponse({ error: 'boom' }, 503), () => jsonResponse({ error: 'boom' }, 500), () => networkError()]) {
    await withMockTransport(reply, async (mock) => {
      const out = await sendViaMailbox(mail(), mock.options);
      deepStrictEqual(out, { success: false, error: 'send_uncertain' });
      strictEqual(mock.calls.length, 1);
    });
  }
});

Deno.test('réponse acceptée mais illisible = send_uncertain (jamais donnée pour envoyée)', async () => {
  await withMockTransport(() => jsonResponse({ object: 'EmailSent' }), async (mock) => {
    deepStrictEqual(await sendViaMailbox(mail(), mock.options), { success: false, error: 'send_uncertain' });
  });
});

Deno.test('429 : limite de débit, code email_send_failed_429, une seule requête', async () => {
  await withMockTransport(() => jsonResponse({ error: 'too many requests' }, 429), async (mock) => {
    const out = await sendViaMailbox(mail(), mock.options);
    deepStrictEqual(out, { success: false, error: 'email_send_failed_429', rateLimited: true });
    strictEqual(mock.calls.length, 1);
  });
});

Deno.test('limite d\'usage du fournisseur : reprise seulement sur 429, définitive sur 403 ou 422 (jamais rateLimited)', async () => {
  await withMockTransport(() => jsonResponse({ error: 'Daily sending limit reached' }, 429), async (mock) => {
    const out = await sendViaMailbox(mail(), mock.options);
    // Le code porte « 429 » : sequence-send-email le lit pour reporter l'étape.
    deepStrictEqual(out, { success: false, error: 'email_send_failed_429' });
  });
  for (const status of [403, 422]) {
    await withMockTransport(() => jsonResponse({ error: 'Daily sending limit reached' }, status), async (mock) => {
      const out = await sendViaMailbox(mail(), mock.options);
      deepStrictEqual(out, { success: false, error: `email_send_failed_${status}` });
      ok(!('rateLimited' in out), 'pas de report horaire sans fin');
      strictEqual(mock.calls.length, 1);
    });
  }
});

Deno.test('boîte à reconnecter ou limitée : codes dédiés, sans texte du fournisseur', async () => {
  await withMockTransport(() => jsonResponse({ error: 'Account disconnected, please reconnect' }, 401), async (mock) => {
    deepStrictEqual(await sendViaMailbox(mail(), mock.options), { success: false, error: 'sender_mailbox_disconnected' });
  });
  await withMockTransport(() => jsonResponse({ error: 'locked' }, 423), async (mock) => {
    deepStrictEqual(await sendViaMailbox(mail(), mock.options), { success: false, error: 'sender_mailbox_limited' });
  });
});

Deno.test('refus ordinaire : email_send_failed_<code HTTP>, jamais le corps du fournisseur', async () => {
  await withMockTransport(() => jsonResponse({ error: 'Unipile says no' }, 422), async (mock) => {
    const out = await sendViaMailbox(mail(), mock.options);
    deepStrictEqual(out, { success: false, error: 'email_send_failed_422' });
    ok(!JSON.stringify(out).toLowerCase().includes('unipile'));
  });
});

Deno.test('identifiant de boîte ancien : rien n\'est envoyé, boîte à reconnecter', async () => {
  await withMockTransport(() => sentReply(), async (mock) => {
    const out = await sendViaMailbox(mail({ accountId: 'BJMqT1aKSBerrkX8lbO1lQ' }), mock.options);
    deepStrictEqual(out, { success: false, error: 'sender_mailbox_disconnected' });
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('adresse de destinataire invalide : refus avant toute requête, email_send_failed_400', async () => {
  await withMockTransport(() => sentReply(), async (mock) => {
    const out = await sendViaMailbox(mail({ to: 'pas une adresse' }), mock.options);
    deepStrictEqual(out, { success: false, error: 'email_send_failed_400' });
    strictEqual(mock.calls.length, 0);
  });
});
