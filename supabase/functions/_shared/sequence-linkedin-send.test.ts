// deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/sequence-linkedin-send.test.ts
import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import {
  inboxKindOf,
  licencesFromContracts,
  pickInbox,
  planInmail,
  resolveSendLicence,
  startLinkedInChat,
} from './sequence-linkedin-send.ts';
import { getInmailCredits } from './unipile/index.ts';
import { jsonResponse, networkError, withMockTransport } from './unipile/testing.ts';

const ACC = 'acc_01abc';
const USER = 'AEMAAABBCCDD';

const contract = (product: string, selected: boolean) => ({ id: `ct_${product}`, name: product, product, selected });

Deno.test('licencesFromContracts : le contrat sélectionné fixe la licence, Classic sans contrat', () => {
  deepStrictEqual(licencesFromContracts([]), { recruiter: false, sales_navigator: false, active: 'classic' });
  strictEqual(licencesFromContracts([contract('recruiter', true)]).active, 'recruiter');
  strictEqual(licencesFromContracts([contract('sales_navigator', true), contract('recruiter', false)]).active, 'sales_navigator');
  // Aucun contrat désigné : le premier connu, Recruiter avant Sales Navigator.
  strictEqual(licencesFromContracts([contract('sales_navigator', false), contract('recruiter', false)]).active, 'recruiter');
});

Deno.test('resolveSendLicence : lit les contrats du compte ; liste introuvable = Classic ; autre erreur remonte', async () => {
  await withMockTransport(() => jsonResponse({ object: 'AvailableContracts', contracts: [contract('recruiter', true)] }), async (mock) => {
    strictEqual(await resolveSendLicence(ACC, mock.options), 'recruiter');
    strictEqual(mock.calls[0].path, `/${ACC}/linkedin/contracts`);
  });
  await withMockTransport(() => jsonResponse({ error: 'not found' }, 404), async (mock) => {
    strictEqual(await resolveSendLicence(ACC, mock.options), 'classic');
  });
  await withMockTransport(() => jsonResponse({ error: 'boom' }, 500), async (mock) => {
    await rejects(() => resolveSendLicence(ACC, mock.options));
  });
});

Deno.test('planInmail : forme de l\'InMail par licence, objet et signature exigés comme le fournisseur', () => {
  deepStrictEqual(planInmail('classic', { subject: '', signature: null }), { ok: true, spec: { licence: 'classic' } });
  deepStrictEqual(planInmail('sales_navigator', { subject: ' Objet ', signature: null }), {
    ok: true, spec: { licence: 'sales_navigator', subject: 'Objet' },
  });
  deepStrictEqual(planInmail('recruiter', { subject: 'Objet', signature: ' Marie ' }), {
    ok: true, spec: { licence: 'recruiter', subject: 'Objet', signature: 'Marie' },
  });
  deepStrictEqual(planInmail('recruiter', { subject: '', signature: 'Marie' }), { ok: false, reason: 'subject_missing' });
  deepStrictEqual(planInmail('sales_navigator', { subject: null, signature: null }), { ok: false, reason: 'subject_missing' });
  deepStrictEqual(planInmail('recruiter', { subject: 'Objet', signature: null }), { ok: false, reason: 'signature_missing' });
});

Deno.test('pickInbox : la seule boîte active, sinon celle dont le nom le dit, sinon aucune', () => {
  const inbox = (id: string, description?: string) => ({ id, description, disabled: false });
  strictEqual(pickInbox([inbox('in_1')], 'recruiter')?.id, 'in_1');
  strictEqual(pickInbox([inbox('in_1', 'Classic'), inbox('in_2', 'Recruiter inbox')], 'recruiter')?.id, 'in_2');
  strictEqual(pickInbox([inbox('in_1', 'Classic'), inbox('in_2', 'Recruiter inbox')], 'classic')?.id, 'in_1');
  strictEqual(pickInbox([inbox('in_1'), inbox('in_2')], 'recruiter'), undefined);
  strictEqual(pickInbox([], 'classic'), undefined);
  strictEqual(inboxKindOf({ id: 'x', description: 'Sales Navigator' }), 'sales_navigator');
});

/** Fournisseur factice : deux boîtes lisibles, envoi accepté. */
function provider(sendReply: () => Response | Error, inboxes: unknown = { data: [{ object: 'Inbox', id: 'in_r', description: 'Recruiter', disabled: false }, { object: 'Inbox', id: 'in_c', description: 'Classic', disabled: false }] }) {
  return (req: { path: string }) => {
    if (req.path.endsWith('/inboxes')) return jsonResponse(inboxes);
    return sendReply();
  };
}

Deno.test('startLinkedInChat : InMail Recruiter par la boîte Recruiter, JSON, sans champ de l\'ancienne API', async () => {
  await withMockTransport(provider(() => jsonResponse({ object: 'ChatStarted', chat_id: 'CH1', message_id: ['M1', 'M2'] })), async (mock) => {
    const out = await startLinkedInChat({
      accountId: ACC, user: USER, text: 'Bonjour', kind: 'recruiter',
      inmail: { licence: 'recruiter', subject: 'Un poste', signature: 'Marie' },
    }, mock.options);
    deepStrictEqual(out, { outcome: 'sent', messageId: 'M1', messageIds: ['M1', 'M2'], chatId: 'CH1' });
    const send = mock.calls.find((c) => c.method === 'POST');
    ok(send);
    strictEqual(send.path, `/${ACC}/inboxes/in_r/chats/send`);
    deepStrictEqual(send.body, {
      text: 'Bonjour', users_ids: USER,
      specifics: { linkedin: { recruiter: { subject: 'Un poste', signature: 'Marie' } } },
    });
    ok(!(send.body instanceof FormData));
    ok(!JSON.stringify(send.body).includes('account_id'));
    ok(!JSON.stringify(send.body).includes('attendees_ids'));
    ok(!JSON.stringify(send.body).includes('linkedin[inmail]'));
  });
});

Deno.test('startLinkedInChat : message direct sans specifics, par la boîte Classic', async () => {
  await withMockTransport(provider(() => jsonResponse({ object: 'ChatStarted', chat_id: 'CH1', message_id: 'M1' })), async (mock) => {
    await startLinkedInChat({ accountId: ACC, user: USER, text: 'Bonjour', kind: 'classic' }, mock.options);
    const send = mock.calls.find((c) => c.method === 'POST');
    strictEqual(send?.path, `/${ACC}/inboxes/in_c/chats/send`);
    deepStrictEqual(send?.body, { text: 'Bonjour', users_ids: USER });
  });
});

Deno.test('startLinkedInChat : compte sans boîte (liste introuvable), route sans boîte', async () => {
  await withMockTransport(
    (req) => req.path.endsWith('/inboxes') ? jsonResponse({ error: 'not found' }, 404) : jsonResponse({ object: 'ChatStarted', chat_id: 'CH1', message_id: 'M1' }),
    async (mock) => {
      const out = await startLinkedInChat({ accountId: ACC, user: USER, text: 'Bonjour', kind: 'classic', inmail: { licence: 'classic' } }, mock.options);
      strictEqual(out.outcome, 'sent');
      const send = mock.calls.find((c) => c.method === 'POST');
      strictEqual(send?.path, `/${ACC}/chats/send`);
      deepStrictEqual((send?.body as { specifics: unknown }).specifics, { linkedin: { classic: { inmail: true } } });
    },
  );
});

Deno.test('startLinkedInChat : route par boîte refusée (rien n\'est parti), un seul essai sans boîte', async () => {
  await withMockTransport(
    (req) => {
      if (req.path.endsWith('/inboxes')) return jsonResponse({ data: [{ object: 'Inbox', id: 'in_r', disabled: false }] });
      if (req.path.includes('/inboxes/')) return jsonResponse({ error: 'invalid inbox' }, 400);
      return jsonResponse({ object: 'ChatStarted', chat_id: 'CH1', message_id: 'M1' });
    },
    async (mock) => {
      const out = await startLinkedInChat({ accountId: ACC, user: USER, text: 'Bonjour', kind: 'classic' }, mock.options);
      strictEqual(out.outcome, 'sent');
      const sends = mock.calls.filter((c) => c.method === 'POST').map((c) => c.path);
      deepStrictEqual(sends, [`/${ACC}/inboxes/in_r/chats/send`, `/${ACC}/chats/send`]);
    },
  );
});

Deno.test('startLinkedInChat : 5xx ou coupure = incertain, jamais un second POST', async () => {
  for (const reply of [() => jsonResponse({ error: 'boom' }, 503), () => networkError()]) {
    await withMockTransport(provider(reply), async (mock) => {
      const out = await startLinkedInChat({ accountId: ACC, user: USER, text: 'Bonjour', kind: 'classic' }, mock.options);
      strictEqual(out.outcome, 'uncertain');
      strictEqual(mock.calls.filter((c) => c.method === 'POST').length, 1);
    });
  }
});

Deno.test('startLinkedInChat : message_id nul alors qu\'un texte est parti = incertain, pas envoyé', async () => {
  await withMockTransport(provider(() => jsonResponse({ object: 'ChatStarted', chat_id: 'CH1', message_id: null })), async (mock) => {
    const out = await startLinkedInChat({ accountId: ACC, user: USER, text: 'Bonjour', kind: 'classic' }, mock.options);
    strictEqual(out.outcome, 'uncertain');
  });
});

Deno.test('startLinkedInChat : refus 429 de quota = refused provider_limit, un seul POST', async () => {
  await withMockTransport(provider(() => jsonResponse({ error: 'inmail limit reached' }, 429)), async (mock) => {
    const out = await startLinkedInChat({ accountId: ACC, user: USER, text: 'Bonjour', kind: 'classic' }, mock.options);
    strictEqual(out.outcome, 'refused');
    if (out.outcome === 'refused') strictEqual(out.kind, 'provider_limit');
    strictEqual(mock.calls.filter((c) => c.method === 'POST').length, 1);
  });
});

Deno.test('startLinkedInChat : identifiant de compte ancien refusé avant tout appel', async () => {
  await withMockTransport(() => jsonResponse({}), async (mock) => {
    await rejects(() => startLinkedInChat({ accountId: 'U0Cfy5DeRuG6gHFSGUk5Sg', user: USER, text: 'Bonjour', kind: 'classic' }, mock.options));
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('crédits InMail : la clé de la licence sous credits, une licence absente vaut zéro pour le gate', async () => {
  await withMockTransport(() => jsonResponse({ object: 'InmailCredits', credits: { classic: 4 } }), async (mock) => {
    const balance = await getInmailCredits(ACC, 'classic', mock.options);
    strictEqual(mock.calls[0].path, `/${ACC}/linkedin/inmail-credits`);
    strictEqual(mock.calls[0].query.get('service'), 'classic');
    strictEqual(balance.classic ?? 0, 4);
    strictEqual(balance.recruiter ?? 0, 0);
  });
});
