// Comportement du moteur de séquences sur l'API v2 (passe S4-4) : les fonctions
// d'index.ts sont extraites du fichier à l'exécution (il démarre un serveur à
// l'import, on ne peut pas l'importer), assemblées dans un module temporaire avec
// des doublures pour la base, puis jouées contre le faux fournisseur v2
// (`_shared/unipile/testing.ts`). Le code testé est donc celui du moteur, jamais
// une copie.
//
//   deno test --no-check --allow-env --allow-read --allow-write \
//     --import-map=e2e/local-stack/import_map.json supabase/functions/process-sequences/engine.test.ts
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { fixtures, jsonResponse, networkError, withMockTransport } from '../_shared/unipile/testing.ts';

const SHARED = new URL('../_shared/', import.meta.url).href;
const SOURCE = await Deno.readTextFile(new URL('./index.ts', import.meta.url));

/** Code d'une fonction de premier niveau d'index.ts, de sa signature à son accolade fermante. */
function fn(name: string): string {
  const match = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(SOURCE);
  if (!match) throw new Error(`fonction introuvable dans index.ts : ${name}`);
  const end = SOURCE.indexOf('\n}\n', match.index);
  return SOURCE.slice(match.index, end + 3);
}

/** Déclaration `const` (ou `type`) de premier niveau, jusqu'au point-virgule de fin de ligne. */
function decl(prefix: string): string {
  const start = SOURCE.indexOf(prefix);
  if (start < 0) throw new Error(`déclaration introuvable dans index.ts : ${prefix}`);
  const end = SOURCE.indexOf('\n]);\n', start);
  const single = SOURCE.indexOf(';\n', start);
  return SOURCE.slice(start, end > 0 && end < single + 400 && prefix.includes('new Set') ? end + 5 : single + 2);
}

const FUNCTIONS = [
  'providerAccountUsable', 'profileInfoOf', 'getProfileInfo', 'resolveProfileIdForChat', 'checkForReplyAfterDate',
  'checkMessagesForReply', 'checkHasProspectReplied', 'checkQuotaForAction', 'providerKindOf', 'isRateLimitError',
  'isRetryableError', 'isAccountDisconnectedError', 'isMailboxDisconnectedError', 'readProfileForSend',
  'providerUserRef', 'classicProviderId', 'pickExistingChat', 'failedSendResult', 'senderSignatureFor', 'preSendErrorKind', 'executeStepAction',
];

const moduleSource = `
import {
  assertV2AccountId, isV2AccountId, isUnipileError, describeForLog, getProfile, getChatForUser, listMessages,
  getInmailCredits, pickInmailProduct, toNetworkDegree, toKonektMessage, isCandidateReplyCandidate,
  sendMessage, sendRelationRequest, startChat, visitProfile, notifyVisitToken, probeText,
} from '${SHARED}unipile/index.ts';
import { planInmail, startLinkedInChat } from '${SHARED}sequence-linkedin-send.ts';
import { sendUncertainError } from '${SHARED}sequence-send-rules.ts';
import { chatLookupOutcome, combineReplyStates, replyReferenceDate } from '${SHARED}sequence-wait-rules.ts';
import { providerCallAllowed, replyStateOfMessages, unresolvedAttendees } from '${SHARED}sequence-wait-guards.ts';

export const profileInfoCache = new Map();
export const stubs = { linked: true, recorded: [], analytics: [], enforce: [] };
const fetchWithTimeout = () => { throw new Error('fetchWithTimeout ne doit pas servir ici'); };
async function isSenderAccountLinked() { return stubs.linked; }
async function enforceLinkedInAction(_s, opts) { stubs.enforce.push(opts); return { allowed: true }; }
async function recordEngineSend(_s, _enrollment, send) { stubs.recorded.push(send); }
async function logAnalytics(_s, _sequenceId, field) { stubs.analytics.push(field); }
async function scheduleNextStep() {}
${decl('const PROVIDER_ERROR_KINDS = new Set')}
${decl('const CHAT_FALLBACK_KINDS')}
${FUNCTIONS.map(fn).join('\n')}
export { ${FUNCTIONS.join(', ')} };
`.replaceAll("'../_shared/", `'${SHARED}`);

const dir = await Deno.makeTempDir({ prefix: 'engine-test-' });
const file = `${dir}/engine.ts`;
await Deno.writeTextFile(file, moduleSource);
// deno-lint-ignore no-explicit-any
const m: any = await import(new URL(`file://${file}`).href);
await Deno.remove(dir, { recursive: true });

const ACC = 'acc_TEST1';
const AFTER = '2026-10-01T00:00:00.000Z';
const PROFILE = { id: 'ACoAAxyz1234', public_identifier: 'jean', display_name: 'Jean', specifics: { network_distance: 'SECOND_DEGREE' } };
const profileWith = (specifics: Record<string, unknown>) => ({ ...PROFILE, specifics });

// deno-lint-ignore no-explicit-any
function fakeSupabase(): any {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  // deno-lint-ignore no-explicit-any
  const query: any = {
    update(values: Record<string, unknown>) { updates.push(values); return query; },
    insert(values: Record<string, unknown>) { inserts.push(values); return Promise.resolve({ error: null }); },
    select() { return query; },
    eq() { return query; },
    in() { return query; },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    then(resolve: (v: unknown) => unknown) { return Promise.resolve({ data: null, error: null }).then(resolve); },
  };
  return { updates, inserts, from: () => query, rpc: () => Promise.resolve({ error: null }) };
}

function reset() {
  m.profileInfoCache.clear();
  m.stubs.linked = true;
  m.stubs.recorded.length = 0;
  m.stubs.analytics.length = 0;
  m.stubs.enforce.length = 0;
}

const enrollment = (extra: Record<string, unknown> = {}) => ({
  id: 'enr1', sequence_id: 'seq1', profile_id: 'jean', profile_name: 'Jean Test', account_id: ACC, organization_id: 'org1',
  profile_url: 'https://www.linkedin.com/in/jean', ...extra,
});
const step = (extra: Record<string, unknown> = {}) => ({ id: 'st1', step_order: 1, ...extra });

// ─── Profil et relation ─────────────────────────────────────────────────────

Deno.test('profil : la relation est le jeton du fournisseur lu sous specifics, jamais DISTANCE_n', async () => {
  reset();
  await withMockTransport(() => jsonResponse(profileWith({ network_distance: 'FIRST_DEGREE' })), async (mock) => {
    deepStrictEqual(await m.getProfileInfo(ACC, 'jean'), { network_distance: 'FIRST_DEGREE', provider_id: 'ACoAAxyz1234', public_identifier: 'jean' });
    ok(mock.calls[0].path.startsWith(`/${ACC}/users/`));
    await m.getProfileInfo(ACC, 'jean');
    strictEqual(mock.calls.length, 1, 'le second appel vient du cache');
  });
});

Deno.test('profil : lecture refusée ou compte à l\'ancien format = null, jamais mis en cache', async () => {
  reset();
  await withMockTransport(() => jsonResponse({ error: 'boom' }, 500), async () => {
    strictEqual(await m.getProfileInfo(ACC, 'jean'), null);
    strictEqual(m.profileInfoCache.size, 0);
  });
  strictEqual(await m.getProfileInfo('U0Cfy5DeRuG6gHFSGUk5Sg', 'jean'), null);
});

Deno.test('compte de fond : ancien format, hors organisation ou illisible ne sont jamais interrogés', async () => {
  reset();
  strictEqual(await m.providerAccountUsable({}, 'o', 'U0Cfy5DeRuG6gHFSGUk5Sg', new Map()), 'outdated');
  strictEqual(await m.providerAccountUsable({}, 'o', ACC, new Map()), 'ok');
  m.stubs.linked = false;
  strictEqual(await m.providerAccountUsable({}, 'o', ACC, new Map()), 'unlinked');
  m.stubs.linked = null;
  strictEqual(await m.providerAccountUsable({}, 'o', ACC, new Map()), 'unknown');
});

// ─── Visite de profil ───────────────────────────────────────────────────────

Deno.test('profile_visit : lecture du profil puis visite explicite avec le jeton, rien d\'autre', async () => {
  reset();
  await withMockTransport((req) => {
    if (req.path.endsWith('/users/visit-profile')) return jsonResponse({ object: 'ProfileVisited' });
    return jsonResponse(profileWith({ network_distance: 'SECOND_DEGREE', notify_visit_token: 'tok_1' }));
  }, async (mock) => {
    const result = await m.executeStepAction('profile_visit', enrollment(), step(), {}, fakeSupabase());
    strictEqual(result.success, true);
    strictEqual(mock.calls.length, 2);
    strictEqual(mock.calls[0].method, 'GET');
    ok(mock.calls[0].path.startsWith(`/${ACC}/users/`) && !mock.calls[0].path.includes('visit'));
    strictEqual(mock.calls[1].method, 'POST');
    strictEqual(mock.calls[1].path, `/${ACC}/users/visit-profile`);
    strictEqual(mock.calls[1].query.get('token'), 'tok_1');
    deepStrictEqual(m.stubs.analytics, ['profile_visits']);
  });
});

Deno.test('profile_visit : sans jeton la visite est sautée avec sa raison, jamais comptée', async () => {
  reset();
  await withMockTransport(() => jsonResponse(profileWith({ network_distance: 'SECOND_DEGREE' })), async (mock) => {
    const result = await m.executeStepAction('profile_visit', enrollment(), step(), {}, fakeSupabase());
    strictEqual(result.success, false);
    strictEqual(result.error, '__SKIP_UNSUPPORTED__');
    ok(String(result.skipReason).startsWith('Visite impossible'));
    ok(!mock.calls.some((c) => c.method === 'POST'));
    deepStrictEqual(m.stubs.analytics, []);
  });
});

Deno.test('profile_visit : visite non confirmée = échec relançable, pas comptée', async () => {
  reset();
  await withMockTransport((req) => {
    if (req.path.endsWith('/users/visit-profile')) return jsonResponse({ object: 'Other' });
    return jsonResponse(profileWith({ notify_visit_token: 'tok_1' }));
  }, async () => {
    const result = await m.executeStepAction('profile_visit', enrollment(), step(), {}, fakeSupabase());
    strictEqual(result.success, false);
    strictEqual(result.errorKind, 'server');
    deepStrictEqual(m.stubs.analytics, []);
  });
});

Deno.test('profile_visit : une visite = une seule place du plafond des vues, la lecture du jeton n\'écrit aucune ligne au ledger', async () => {
  // Le gate (checkQuotaForAction, hors de executeStepAction) journalise déjà la
  // visite en 'profile_view'. Une seconde ligne écrite par la lecture qui rend le
  // jeton faisait consommer deux places par visite (25 vues = 12 visites).
  for (const scenario of ['visite faite', 'sans jeton', 'visite non confirmée'] as const) {
    reset();
    const supabase = fakeSupabase();
    await withMockTransport((req) => {
      if (req.path.endsWith('/users/visit-profile')) return jsonResponse({ object: scenario === 'visite faite' ? 'ProfileVisited' : 'Other' });
      return jsonResponse(profileWith(scenario === 'sans jeton' ? { network_distance: 'SECOND_DEGREE' } : { notify_visit_token: 'tok_1' }));
    }, async () => {
      await m.executeStepAction('profile_visit', enrollment(), step(), {}, supabase);
    });
    const ledgerRows = supabase.inserts.filter((row: Record<string, unknown>) => 'action_type' in row);
    deepStrictEqual(ledgerRows, [], `${scenario} : aucune ligne de ledger écrite par l'exécution de l'étape`);
  }
});

Deno.test('check_connection : la lecture du profil n\'écrit aucune ligne au ledger (déjà journalisée par le gate)', async () => {
  reset();
  const supabase = fakeSupabase();
  await withMockTransport(() => jsonResponse(profileWith({ network_distance: 'FIRST_DEGREE' })), async () => {
    const result = await m.executeStepAction('check_connection', enrollment(), step(), {}, supabase);
    strictEqual(result.success, true);
  });
  deepStrictEqual(supabase.inserts.filter((row: Record<string, unknown>) => 'action_type' in row), []);
});

// ─── Invitation ─────────────────────────────────────────────────────────────

Deno.test('connection_request : demande de relation avec la note tronquée, connection_status = pending_invite', async () => {
  reset();
  const supabase = fakeSupabase();
  await withMockTransport((req) => {
    if (req.path.endsWith('/relation-requests')) return jsonResponse({ id: 'rr_1' });
    return jsonResponse(profileWith({ network_distance: 'SECOND_DEGREE' }));
  }, async (mock) => {
    const result = await m.executeStepAction('connection_request', enrollment(), step({ message_template: 'Bonjour Jean' }), {}, supabase);
    strictEqual(result.success, true);
    strictEqual(result.message, 'Bonjour Jean');
    const post = mock.calls.find((c) => c.method === 'POST');
    strictEqual(post?.path, `/${ACC}/users/me/relation-requests`);
    strictEqual((post?.body as { message: string }).message, 'Bonjour Jean');
    ok(supabase.updates.some((u: Record<string, unknown>) => u.connection_status === 'pending_invite'));
    deepStrictEqual(m.stubs.analytics, ['invites_sent']);
    // Marqueur avant l'envoi, comme au lot 0b.
    deepStrictEqual(m.stubs.recorded.map((r: { sendKind: string; pending?: boolean }) => [r.sendKind, r.pending]), [['invitation', true]]);
  });
});

Deno.test('connection_request : déjà en relation (premier degré) = étape sautée, aucune demande envoyée', async () => {
  reset();
  await withMockTransport(() => jsonResponse(profileWith({ network_distance: 'FIRST_DEGREE' })), async (mock) => {
    const result = await m.executeStepAction('connection_request', enrollment(), step({ message_template: 'Bonjour' }), {}, fakeSupabase());
    strictEqual(result.error, '__SKIP_UNSUPPORTED__');
    strictEqual(result.skipReason, 'Déjà en relation : invitation inutile');
    ok(!mock.calls.some((c) => c.method === 'POST'));
  });
});

Deno.test('connection_request : refus « relation existante » = étape sautée, pas un échec', async () => {
  reset();
  const supabase = fakeSupabase();
  await withMockTransport((req) => {
    if (req.path.endsWith('/relation-requests')) return jsonResponse({ detail: 'Trying to send a relation request to an existing relation will fail' }, 422);
    return jsonResponse(profileWith({ network_distance: 'SECOND_DEGREE' }));
  }, async () => {
    const result = await m.executeStepAction('connection_request', enrollment(), step({ message_template: 'Bonjour' }), {}, supabase);
    strictEqual(result.error, '__SKIP_UNSUPPORTED__');
    strictEqual(result.skipReason, 'Déjà en relation : invitation inutile');
    ok(supabase.updates.some((u: Record<string, unknown>) => u.connection_status === 'connected'));
  });
});

Deno.test('connection_request : issue incertaine (5xx) = errorKind uncertain, aucune invitation enregistrée, un seul POST', async () => {
  reset();
  const supabase = fakeSupabase();
  await withMockTransport((req) => {
    if (req.path.endsWith('/relation-requests')) return jsonResponse({ error: 'boom' }, 503);
    return jsonResponse(profileWith({ network_distance: 'SECOND_DEGREE' }));
  }, async (mock) => {
    const result = await m.executeStepAction('connection_request', enrollment(), step({ message_template: 'Bonjour' }), {}, supabase);
    strictEqual(result.success, false);
    strictEqual(result.errorKind, 'uncertain');
    ok(!/unipile/i.test(String(result.error)));
    strictEqual(mock.calls.filter((c) => c.method === 'POST').length, 1);
    ok(!supabase.updates.some((u: Record<string, unknown>) => u.connection_status === 'pending_invite'));
    deepStrictEqual(m.stubs.analytics, []);
  });
});

Deno.test('connection_request : identifiant Recruiter (AE) = l\'identifiant classique résolu part en tête, jamais l\'AE seul', async () => {
  const post = (calls: Array<{ method: string; body?: unknown }>) => calls.find((c) => c.method === 'POST')?.body as { user_id: string };
  // Identifiant classique déjà résolu sur l'inscription.
  reset();
  await withMockTransport((req) => {
    if (req.path.endsWith('/relation-requests')) return jsonResponse({ id: 'rr_1' });
    return jsonResponse({ ...PROFILE, id: 'ACoAAread999', specifics: { network_distance: 'SECOND_DEGREE' } });
  }, async (mock) => {
    const result = await m.executeStepAction(
      'connection_request',
      enrollment({ profile_id: 'AEMAAxyz1234', resolved_profile_id: 'ACoAAclassic1', profile_url: undefined }),
      step({ message_template: 'Bonjour' }), {}, fakeSupabase(),
    );
    strictEqual(result.success, true);
    strictEqual(post(mock.calls).user_id, 'ACoAAclassic1');
  });
  // Pas encore résolu : l'identifiant lu sur le profil, qui est enregistré.
  reset();
  const supabase = fakeSupabase();
  await withMockTransport((req) => {
    if (req.path.endsWith('/relation-requests')) return jsonResponse({ id: 'rr_1' });
    return jsonResponse({ ...PROFILE, id: 'ACoAAread999', specifics: { network_distance: 'SECOND_DEGREE' } });
  }, async (mock) => {
    const result = await m.executeStepAction(
      'connection_request', enrollment({ profile_id: 'AEMAAxyz1234', profile_url: undefined }), step({ message_template: 'Bonjour' }), {}, supabase,
    );
    strictEqual(result.success, true);
    strictEqual(post(mock.calls).user_id, 'ACoAAread999');
    ok(supabase.updates.some((u: Record<string, unknown>) => u.resolved_profile_id === 'ACoAAread999'));
  });
});

Deno.test('classicProviderId : un identifiant Recruiter (AE) n\'est jamais « classique »', () => {
  strictEqual(m.classicProviderId({ resolved_profile_id: 'ACoAAclassic1' }), 'ACoAAclassic1');
  strictEqual(m.classicProviderId({ resolved_profile_id: 'AEMAAxyz1234' }, 'ACoAAread999'), 'ACoAAread999');
  strictEqual(m.classicProviderId({ resolved_profile_id: null }, 'AEMAAxyz1234'), null);
  strictEqual(m.classicProviderId({}), null);
});

Deno.test('relation : profil lu sans degré (specifics.network_distance facultatif) = le degré enregistré à l\'inscription tranche', async () => {
  // Premier degré enregistré : l'invitation est sautée, jamais envoyée.
  reset();
  await withMockTransport((req) => {
    if (req.path.endsWith('/relation-requests')) return jsonResponse({ id: 'rr_1' });
    return jsonResponse({ ...PROFILE, specifics: {} });
  }, async (mock) => {
    const result = await m.executeStepAction(
      'connection_request', enrollment({ network_distance: 'FIRST_DEGREE', connection_status: 'not_connected' }), step({ message_template: 'Bonjour' }), {}, fakeSupabase(),
    );
    strictEqual(result.error, '__SKIP_UNSUPPORTED__');
    ok(!mock.calls.some((c) => c.method === 'POST'));
  });
  // « Vérifier la connexion » : connected, branche « oui ».
  reset();
  const supabase = fakeSupabase();
  await withMockTransport(() => jsonResponse({ ...PROFILE, specifics: {} }), async () => {
    const result = await m.executeStepAction('check_connection', enrollment({ network_distance: 'FIRST_DEGREE' }), step(), {}, supabase);
    strictEqual(result.success, true);
    ok(supabase.updates.some((u: Record<string, unknown>) => u.connection_status === 'connected'));
  });
  // Un degré lu l'emporte sur le degré enregistré.
  reset();
  const lower = fakeSupabase();
  await withMockTransport(() => jsonResponse(profileWith({ network_distance: 'SECOND_DEGREE' })), async () => {
    await m.executeStepAction('check_connection', enrollment({ network_distance: 'FIRST_DEGREE' }), step(), {}, lower);
    ok(lower.updates.some((u: Record<string, unknown>) => u.connection_status === 'not_connected'));
  });
});

// ─── Message ────────────────────────────────────────────────────────────────

/** Faux fournisseur d'un envoi : profil, conversation existante ou non, réponse d'envoi. */
function messagingProvider(opts: { chats?: unknown[]; send: () => Response | Error; credits?: Record<string, number>; distance?: string }) {
  return (req: { method: string; path: string }) => {
    if (req.path.endsWith('/inmail-credits')) return jsonResponse({ object: 'InmailCredits', credits: opts.credits ?? {} });
    if (req.path.endsWith('/chat')) return jsonResponse({ object: 'ChatLookup', data: opts.chats ?? [] });
    if (req.path.endsWith('/inboxes')) return jsonResponse({ object: 'Inboxes', data: [] });
    if (req.method === 'POST') return opts.send();
    return jsonResponse(profileWith({ network_distance: opts.distance ?? 'FIRST_DEGREE' }));
  };
}

Deno.test('message : dans la conversation existante, message_id en liste = premier identifiant, string inchangée', async () => {
  for (const [messageId, expected] of [[['M1', 'M2'], 'M1'], ['M9', 'M9']] as const) {
    reset();
    await withMockTransport(
      messagingProvider({ chats: [{ chat_id: 'CH1', has_history: true }], send: () => jsonResponse(fixtures.messageSent(messageId as string | string[])) }),
      async (mock) => {
        const result = await m.executeStepAction('message', enrollment(), step({ message_template: 'Bonjour' }), {}, fakeSupabase());
        strictEqual(result.success, true);
        strictEqual(result.chatId, 'CH1');
        strictEqual(result.messageId, expected);
        ok(mock.calls.some((c) => c.method === 'POST' && c.path.includes('/chats/CH1/messages')));
        deepStrictEqual(m.stubs.recorded.map((r: { sendKind: string; pending?: boolean }) => [r.sendKind, r.pending]), [['message', true]]);
      },
    );
  }
});

Deno.test('message : 5xx dans la conversation = issue incertaine, ni second envoi ni nouvelle conversation, rien d\'enregistré envoyé', async () => {
  reset();
  await withMockTransport(
    messagingProvider({ chats: [{ chat_id: 'CH1', has_history: true }], send: () => jsonResponse({ error: 'boom' }, 502) }),
    async (mock) => {
      const result = await m.executeStepAction('message', enrollment(), step({ message_template: 'Bonjour' }), {}, fakeSupabase());
      strictEqual(result.success, false);
      strictEqual(result.errorKind, 'uncertain');
      strictEqual(mock.calls.filter((c) => c.method === 'POST').length, 1);
      deepStrictEqual(m.stubs.analytics, []);
      ok(m.stubs.recorded.every((r: { pending?: boolean }) => r.pending === true), 'seul le marqueur est écrit, jamais « Contacté »');
    },
  );
});

Deno.test('message : coupure réseau = issue incertaine, jamais un échec relançable', async () => {
  reset();
  await withMockTransport(
    messagingProvider({ chats: [{ chat_id: 'CH1', has_history: true }], send: () => networkError() }),
    async () => {
      const result = await m.executeStepAction('message', enrollment(), step({ message_template: 'Bonjour' }), {}, fakeSupabase());
      strictEqual(result.errorKind, 'uncertain');
      strictEqual(m.isRetryableError(result.error, result.errorKind), false);
    },
  );
});

Deno.test('message : quota du réseau (429) = provider_limit, un seul POST, texte neutre', async () => {
  reset();
  await withMockTransport(
    messagingProvider({ chats: [{ chat_id: 'CH1', has_history: true }], send: () => jsonResponse({ error: 'invitation limit reached' }, 429) }),
    async (mock) => {
      const result = await m.executeStepAction('message', enrollment(), step({ message_template: 'Bonjour' }), {}, fakeSupabase());
      strictEqual(result.success, false);
      strictEqual(result.errorKind, 'provider_limit');
      strictEqual(m.isRateLimitError(result.error, result.errorKind), true);
      ok(String(result.error).startsWith('linkedin_send_failed_429'));
      ok(!/unipile/i.test(String(result.error)));
      strictEqual(mock.calls.filter((c) => c.method === 'POST').length, 1);
    },
  );
});

// ─── InMail ─────────────────────────────────────────────────────────────────

Deno.test('inmail : sans crédit chez aucune licence, rien ne part (crédits épuisés, relançable demain)', async () => {
  reset();
  await withMockTransport(
    messagingProvider({ distance: 'SECOND_DEGREE', credits: { classic: 0, recruiter: 0 }, send: () => jsonResponse(fixtures.messageSent('M1')) }),
    async (mock) => {
      const result = await m.executeStepAction('inmail', enrollment(), step({ subject_template: 'Un poste', message_template: 'Bonjour' }), {}, fakeSupabase());
      strictEqual(result.success, false);
      ok(String(result.error).startsWith('inmail_credits_exhausted'));
      ok(!mock.calls.some((c) => c.method === 'POST'));
    },
  );
});

Deno.test('inmail : la licence qui a des crédits crée la conversation (Classic), objet exigé par la décision produit', async () => {
  reset();
  await withMockTransport(
    messagingProvider({
      distance: 'SECOND_DEGREE', credits: { classic: 2 },
      send: () => jsonResponse({ object: 'ChatStarted', chat_id: 'CH7', message_id: 'M7' }),
    }),
    async (mock) => {
      const result = await m.executeStepAction('inmail', enrollment(), step({ subject_template: 'Un poste', message_template: 'Bonjour' }), {}, fakeSupabase());
      strictEqual(result.success, true);
      strictEqual(result.needsInMail, true);
      strictEqual(result.chatId, 'CH7');
      strictEqual(result.messageId, 'M7');
      const post = mock.calls.find((c) => c.method === 'POST');
      ok(post);
      ok(post.path.endsWith('/chats/send'));
      deepStrictEqual((post.body as { specifics: unknown }).specifics, { linkedin: { classic: { inmail: true } } }, 'InMail Classic : pas de champ objet côté fournisseur');
      deepStrictEqual(m.stubs.recorded.map((r: { sendKind: string }) => r.sendKind), ['inmail']);
    },
  );
  reset();
  await withMockTransport(
    messagingProvider({ distance: 'SECOND_DEGREE', credits: { classic: 2 }, send: () => jsonResponse(fixtures.messageSent('M1')) }),
    async (mock) => {
      const result = await m.executeStepAction('inmail', enrollment(), step({ message_template: 'Bonjour' }), {}, fakeSupabase());
      ok(String(result.error).startsWith('inmail_subject_missing'));
      ok(!mock.calls.some((c) => c.method === 'POST'));
    },
  );
});

Deno.test('inmail : Recruiter sans nom de signature = rien ne part, objet/signature signalés', async () => {
  reset();
  await withMockTransport(
    messagingProvider({ distance: 'SECOND_DEGREE', credits: { recruiter: 5 }, send: () => jsonResponse(fixtures.messageSent('M1')) }),
    async (mock) => {
      const result = await m.executeStepAction('inmail', enrollment(), step({ subject_template: 'Un poste', message_template: 'Bonjour' }), {}, fakeSupabase());
      strictEqual(result.success, false);
      ok(String(result.error).startsWith('inmail_subject_missing'));
      ok(/signe l'InMail Recruiter/.test(String(result.error)));
      ok(!mock.calls.some((c) => c.method === 'POST'));
    },
  );
});

Deno.test('inmail : contrôle des crédits impossible = relançable, une limite d\'API n\'est pas une limite d\'envoi', async () => {
  reset();
  await withMockTransport(
    (req) => req.path.endsWith('/inmail-credits') ? jsonResponse({ error: 'slow down' }, 429) : messagingProvider({ distance: 'SECOND_DEGREE', send: () => jsonResponse(fixtures.messageSent('M1')) })(req),
    async (mock) => {
      const result = await m.executeStepAction('inmail', enrollment(), step({ subject_template: 'Un poste', message_template: 'Bonjour' }), {}, fakeSupabase());
      strictEqual(result.success, false);
      ok(String(result.error).startsWith('inmail_balance_unavailable'));
      strictEqual(result.errorKind, undefined, 'pas de famille provider_limit : aucune pause du compte');
      ok(!mock.calls.some((c) => c.method === 'POST'));
    },
  );
});

// ─── Quota et licence du gate ───────────────────────────────────────────────

Deno.test('checkQuotaForAction : crédits InMail lus par licence, premier degré sans crédit', async () => {
  const enr = { profile_id: 'jean', connection_status: null };
  const run = (distance: string, credits: Record<string, number>) => withMockTransport(
    messagingProvider({ distance, credits, send: () => jsonResponse({}) }),
    async (mock) => ({ result: await m.checkQuotaForAction(fakeSupabase(), 'inmail', ACC, 'u1', 'o1', { enrollment: enr, profileId: 'jean' }), mock }),
  );
  reset();
  let out = await run('SECOND_DEGREE', { recruiter: 3 });
  strictEqual(out.result.allowed, true);
  strictEqual(out.result.ledgerActionType, 'inmail');
  reset();
  out = await run('SECOND_DEGREE', { classic: 0, recruiter: 0 });
  strictEqual(out.result.allowed, false);
  strictEqual(out.result.scope, 'inmail_credits');
  reset();
  out = await run('FIRST_DEGREE', {});
  strictEqual(out.result.allowed, true);
  strictEqual(out.result.ledgerActionType, 'message');
  ok(!out.mock.calls.some((c: { path: string }) => c.path.endsWith('/inmail-credits')));
  reset();
  await withMockTransport(() => jsonResponse({ error: 'boom' }, 500), async () => {
    const result = await m.checkQuotaForAction(fakeSupabase(), 'inmail', ACC, 'u1', 'o1', { enrollment: enr, profileId: 'jean' });
    strictEqual(result.allowed, false);
  });
});

// ─── Réponses ───────────────────────────────────────────────────────────────

/** Fournisseur factice d'une conversation, messages donnés. */
function chatWith(messages: unknown[]) {
  return (req: { path: string }) => {
    if (req.path.endsWith('/chat')) return jsonResponse({ object: 'ChatLookup', data: [{ chat_id: 'chat1' }] });
    if (req.path.includes('/chats/chat1/messages')) return jsonResponse({ data: messages });
    return new Response(null, { status: 404 });
  };
}

Deno.test('réponse : un message du candidat (is_sender false) postérieur est une réponse, lu par compte et conversation', async () => {
  reset();
  await withMockTransport(chatWith([{ id: 'm1', chat_id: 'chat1', sender_id: 'u', text: 'ok', timestamp: '2026-10-02T00:00:00Z', is_sender: false }]), async (mock) => {
    strictEqual(await m.checkForReplyAfterDate(ACC, 'ACoAAxyz1234', AFTER), 'replied');
    ok(mock.calls.some((c) => c.path.startsWith(`/${ACC}/chats/chat1/messages`)));
  });
});

Deno.test('réponse : événements, invitations, nos messages et messages antérieurs ne comptent pas', async () => {
  reset();
  await withMockTransport(chatWith([
    { id: 'm1', chat_id: 'chat1', sender_id: 'u', timestamp: '2026-10-02T00:00:00Z', is_sender: false, is_event: true },
    { id: 'm2', chat_id: 'chat1', sender_id: 'u', timestamp: '2026-10-02T00:00:00Z', is_sender: false, specifics: { type: 'INVITATION' } },
    { id: 'm3', chat_id: 'chat1', sender_id: 's', timestamp: '2026-10-03T00:00:00Z', is_sender: true },
    { id: 'm4', chat_id: 'chat1', sender_id: 'u', timestamp: '2026-09-02T00:00:00Z', is_sender: false },
  ]), async () => {
    strictEqual(await m.checkForReplyAfterDate(ACC, 'ACoAAxyz1234', AFTER), 'no_reply');
  });
});

Deno.test('réponse : message sans is_sender = issue inconnue, jamais « pas de réponse »', async () => {
  reset();
  await withMockTransport(chatWith([{ id: 'm1', chat_id: 'chat1', timestamp: '2026-10-02T00:00:00Z' }]), async () => {
    strictEqual(await m.checkForReplyAfterDate(ACC, 'ACoAAxyz1234', AFTER), 'unknown');
  });
});

Deno.test('réponse : aucun fil (liste vide) = pas de réponse ; 5xx = inconnu ; compte à l\'ancien format = inconnu sans appel', async () => {
  reset();
  await withMockTransport(() => jsonResponse({ object: 'ChatLookup', data: [] }), async () => {
    strictEqual(await m.checkForReplyAfterDate(ACC, 'ACoAAxyz1234', AFTER), 'no_reply');
  });
  await withMockTransport(() => jsonResponse({ error: 'x' }, 500), async () => {
    strictEqual(await m.checkForReplyAfterDate(ACC, 'ACoAAxyz1234', AFTER), 'unknown');
  });
  await withMockTransport(() => jsonResponse({}), async (mock) => {
    strictEqual(await m.checkForReplyAfterDate('U0Cfy5DeRuG6gHFSGUk5Sg', 'ACoAAxyz1234', AFTER), 'unknown');
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('réponse : candidat non reconnu (404 ou 400 sur toutes les formes) = inconnu, jamais « pas de réponse »', async () => {
  reset();
  for (const status of [404, 400]) {
    await withMockTransport(() => jsonResponse({ error: 'nf' }, status), async () => {
      strictEqual(await m.checkForReplyAfterDate(ACC, 'ACoAAxyz1234', AFTER, 'https://www.linkedin.com/in/jean'), 'unknown');
    });
  }
  // Une conversation disparue (404 sur ses messages) reste « aucun fil à lire ».
  await withMockTransport((req) => req.path.endsWith('/chat')
    ? jsonResponse({ object: 'ChatLookup', data: [{ chat_id: 'chat1', has_history: true }] })
    : jsonResponse({ error: 'gone' }, 404), async () => {
    strictEqual(await m.checkForReplyAfterDate(ACC, 'ACoAAxyz1234', AFTER), 'no_reply');
  });
});

Deno.test('réponse : refus 403 = candidat qui a bloqué le compte, inscription active en pause « blocked_by_candidate »', async () => {
  reset();
  const supabase = fakeSupabase();
  await withMockTransport(() => jsonResponse({ error: 'forbidden' }, 403), async () => {
    strictEqual(await m.checkForReplyAfterDate(ACC, 'ACoAAxyz1234', AFTER, undefined, 'enr1', supabase), 'unknown');
  });
  strictEqual(supabase.updates[0]?.pause_reason, 'blocked_by_candidate');
  strictEqual(supabase.updates[0]?.status, 'paused');
});

Deno.test('réponse : 403 qui parle d\'un compte déconnecté ou limité = doute, aucune pause « blocked_by_candidate »', async () => {
  reset();
  for (const text of ['Account disconnected, please reconnect', 'Your account is locked']) {
    const supabase = fakeSupabase();
    await withMockTransport(() => jsonResponse({ error: text }, 403), async () => {
      strictEqual(await m.checkForReplyAfterDate(ACC, 'ACoAAxyz1234', AFTER, undefined, 'enr1', supabase), 'unknown');
    });
    strictEqual(supabase.updates.length, 0, `aucune écriture pour « ${text} »`);
  }
});

Deno.test('réponse : échéance dépassée = inconnu, aucun appel au fournisseur', async () => {
  reset();
  await withMockTransport(() => jsonResponse({}), async (mock) => {
    strictEqual(await m.checkForReplyAfterDate(ACC, 'ACoAAxyz1234', AFTER, undefined, undefined, undefined, Date.now() + 1_000), 'unknown');
    strictEqual(mock.calls.length, 0);
  });
});

// ─── Familles d'erreur ──────────────────────────────────────────────────────

Deno.test('classement des erreurs : la famille du client l\'emporte sur le texte', () => {
  strictEqual(m.isRateLimitError('x', 'provider_limit'), true);
  strictEqual(m.isRateLimitError('429 rate limit', 'server'), false);
  strictEqual(m.isRetryableError('timeout', 'validation'), false);
  strictEqual(m.isRetryableError('whatever', 'server'), true);
  strictEqual(m.isRetryableError('whatever', 'uncertain'), false);
  strictEqual(m.isRetryableError('whatever', 'account_degraded'), false);
  strictEqual(m.isAccountDisconnectedError('x', 'account_disconnected'), true);
  strictEqual(m.isAccountDisconnectedError('credentials', 'validation'), false);
  strictEqual(m.isAccountDisconnectedError('x', 'account_degraded'), false, 'un compte limité n\'est pas un compte à reconnecter');
  // Jetons écrits par Konekt : clé absente du serveur et boîte e-mail ne sont pas un compte LinkedIn à reconnecter.
  strictEqual(m.isAccountDisconnectedError('provider_not_configured'), false);
  strictEqual(m.isAccountDisconnectedError('email_account_disconnected: boîte'), false);
  strictEqual(m.isMailboxDisconnectedError('email_account_disconnected: boîte'), true);
  strictEqual(m.providerKindOf({ errorKind: 'provider_limit' }), 'provider_limit');
  strictEqual(m.providerKindOf({ errorKind: 'nope' }), null);
  strictEqual(m.providerKindOf(new Error('x')), null);
});

// ─── Câblage de la boucle (extrait d'index.ts, la boucle n'est pas appelable seule) ──

Deno.test('boucle : une boîte e-mail limitée (sender_mailbox_limited) est un report, avant le traitement générique des échecs', () => {
  const branch = SOURCE.indexOf("executeResult.error === 'sender_mailbox_limited'");
  const generic = SOURCE.indexOf('// For email steps, sequence-send-email may have already updated the execution status.');
  ok(branch > 0 && generic > 0, 'branches introuvables');
  ok(branch < generic, 'la branche « boîte limitée » doit précéder le traitement générique des échecs');
  const body = SOURCE.slice(branch, branch + 900);
  ok(body.includes('results.skipped++'), 'compté comme sauté');
  ok(!body.includes('results.failed++') && !body.includes('noteSequenceFailure'), 'ni échec ni auto-pause de la séquence');
});

Deno.test('boucle : un compte limité levé en exception rend la place du plafond comme le chemin du résultat', () => {
  const start = SOURCE.indexOf("} else if (caughtKind === 'account_degraded') {");
  ok(start > 0, 'branche introuvable');
  const body = SOURCE.slice(start, start + 900);
  ok(body.includes('await releaseSlot();'), 'releaseSlot attendu avant le report de 6 h');
  ok(body.indexOf('releaseSlot') < body.indexOf("status: 'scheduled'"), 'la place est rendue avant la réécriture');
});
