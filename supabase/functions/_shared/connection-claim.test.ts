// Claim of a connected account driven by a connection attempt.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/connection-claim.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import {
  claimAccount,
  claimFailureNotice,
  claimForAttempt,
  closeAttempt,
  type ConnectionAttemptRow,
  decideClaim,
  effectiveAttemptStatus,
  insertClaimNotification,
  isAttemptId,
  loadAttempt,
  phoneFromName,
  providerKind,
  readableAccountName,
  statusAtClaim,
} from './connection-claim.ts';
import { FakeDb } from './connection-claim.testing.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ATTEMPT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOW = new Date('2026-10-11T12:00:00.000Z');
const FUTURE = '2026-10-11T12:30:00.000Z';
const PAST = '2026-10-11T11:59:00.000Z';

function attempt(patch: Partial<ConnectionAttemptRow> = {}): ConnectionAttemptRow {
  return {
    id: ATTEMPT,
    organization_id: ORG,
    user_id: USER,
    provider: 'linkedin',
    purpose: 'link',
    reconnect_account_id: null,
    mode: 'hosted',
    status: 'pending',
    intent_id: null,
    account_id: null,
    error_kind: null,
    created_at: '2026-10-11T12:00:00.000Z',
    completed_at: null,
    expires_at: FUTURE,
    ...patch,
  };
}

const LINKEDIN = { id: 'acc_li1', provider: 'linkedin', name: 'Claire Martin', status: 'running', is_locked: false };

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

Deno.test('effectiveAttemptStatus : une tentative en cours échue est « expired »', () => {
  strictEqual(effectiveAttemptStatus(attempt(), NOW), 'pending');
  strictEqual(effectiveAttemptStatus(attempt({ expires_at: PAST }), NOW), 'expired');
  strictEqual(effectiveAttemptStatus(attempt({ expires_at: NOW.toISOString() }), NOW), 'expired');
  strictEqual(effectiveAttemptStatus(attempt({ expires_at: 'n importe quoi' }), NOW), 'expired');
  for (const status of ['completed', 'failed', 'cancelled', 'expired'] as const) {
    strictEqual(effectiveAttemptStatus(attempt({ status, expires_at: PAST }), NOW), status);
  }
});

Deno.test('isAttemptId : seul un uuid est un état admis', () => {
  ok(isAttemptId(ATTEMPT));
  for (const bad of ['', 'user:abc|org:def', 'acc_123', null, undefined, 12, `${ATTEMPT}x`]) ok(!isAttemptId(bad), String(bad));
});

Deno.test('decideClaim : les décisions du serveur, sans entrée-sortie', () => {
  deepStrictEqual(decideClaim(attempt(), LINKEDIN, NOW), { action: 'claim' });
  deepStrictEqual(decideClaim(null, LINKEDIN, NOW), { action: 'refuse', reason: 'unknown_attempt' });
  deepStrictEqual(decideClaim(attempt({ expires_at: PAST }), LINKEDIN, NOW), { action: 'refuse', reason: 'expired' });
  deepStrictEqual(decideClaim(attempt({ status: 'cancelled' }), LINKEDIN, NOW), { action: 'refuse', reason: 'cancelled' });
  deepStrictEqual(decideClaim(attempt({ status: 'failed' }), LINKEDIN, NOW), { action: 'refuse', reason: 'failed' });
  deepStrictEqual(decideClaim(attempt({ status: 'expired' }), LINKEDIN, NOW), { action: 'refuse', reason: 'expired' });
  // Rejeu : même compte = sans effet ; autre compte = refus.
  deepStrictEqual(decideClaim(attempt({ status: 'completed', account_id: 'acc_li1' }), LINKEDIN, NOW), { action: 'replay' });
  deepStrictEqual(decideClaim(attempt({ status: 'completed', account_id: 'acc_other' }), LINKEDIN, NOW), { action: 'refuse', reason: 'completed_other_account' });
  // Le canal doit correspondre ; un identifiant d'une génération précédente n'est jamais rattaché.
  deepStrictEqual(decideClaim(attempt({ provider: 'whatsapp' }), LINKEDIN, NOW), { action: 'refuse', reason: 'provider_mismatch' });
  deepStrictEqual(decideClaim(attempt(), { ...LINKEDIN, id: 'abc123' }, NOW), { action: 'refuse', reason: 'invalid_account' });
  // Une reconnexion ne rend que le compte visé.
  const reconnect = attempt({ purpose: 'reconnect', reconnect_account_id: 'acc_li1' });
  deepStrictEqual(decideClaim(reconnect, LINKEDIN, NOW), { action: 'claim' });
  deepStrictEqual(decideClaim(reconnect, { ...LINKEDIN, id: 'acc_li2' }, NOW), { action: 'refuse', reason: 'account_mismatch' });
});

Deno.test('providerKind, readableAccountName, phoneFromName, statusAtClaim', () => {
  strictEqual(providerKind('linkedin'), 'linkedin');
  strictEqual(providerKind('google'), 'email');
  strictEqual(providerKind('outlook'), 'email');
  strictEqual(providerKind('imap'), 'email');
  strictEqual(providerKind('whatsapp'), 'whatsapp');
  strictEqual(providerKind('telegram'), null);

  strictEqual(readableAccountName('  Claire   Martin '), 'Claire Martin');
  strictEqual(readableAccountName(`user:${USER}|org:${ORG}|providers:LINKEDIN|expires:1760000000000`), null);
  strictEqual(readableAccountName('org:abc'), null);
  strictEqual(readableAccountName('x|reconnect:acc_1'), null);
  strictEqual(readableAccountName(''), null);
  strictEqual(readableAccountName(42), null);

  strictEqual(phoneFromName('+33 6 12 34 56 78'), '+33612345678');
  strictEqual(phoneFromName('33612345678@s.whatsapp.net'), '+33612345678');
  strictEqual(phoneFromName('Claire'), null);

  strictEqual(statusAtClaim({}), 'OK');
  strictEqual(statusAtClaim({ status: 'running' }), 'OK');
  strictEqual(statusAtClaim({ status: 'disconnected' }), 'CREDENTIALS');
  strictEqual(statusAtClaim({ status: 'running', is_locked: true }), 'LOCKED');
  strictEqual(statusAtClaim({ is_locked: true }), 'LOCKED');
});

Deno.test('claimFailureNotice : texte au vouvoiement, sans nom de prestataire', () => {
  for (const provider of ['linkedin', 'whatsapp', 'google']) {
    for (const reason of ['cross_tenant', 'other_member', 'revoked', 'expired', 'cancelled', 'database'] as const) {
      const { title, body } = claimFailureNotice(provider, reason);
      ok(title.startsWith('Compte ') && title.endsWith('non rattaché'), title);
      ok(!/unipile/i.test(title + body), body);
      ok(!/—/.test(title + body), 'tiret cadratin');
    }
  }
  strictEqual(claimFailureNotice('google', 'cross_tenant').title, 'Compte e-mail non rattaché');
  strictEqual(claimFailureNotice('linkedin', 'cross_tenant').body, 'Ce compte LinkedIn est déjà rattaché à un autre espace de travail.');
});

// ---------------------------------------------------------------------------
// claimAccount : LinkedIn
// ---------------------------------------------------------------------------

function linkedinDb(rows: Array<Record<string, unknown>> = []): FakeDb {
  const db = new FakeDb({ member_linkedin_accounts: rows });
  db.unique('member_linkedin_accounts', ['linkedin_account_id', 'organization_id']);
  return db;
}

Deno.test('claimAccount linkedin : première liaison, statut au vocabulaire Konekt, nom lisible', async () => {
  const db = linkedinDb();
  const result = await claimAccount(db, { organizationId: ORG, userId: USER, account: LINKEDIN, now: NOW });
  ok(result.ok);
  strictEqual(result.ok && result.status, 'OK');
  strictEqual(result.ok && result.replacedAccountId, null);
  const row = db.table('member_linkedin_accounts')[0];
  strictEqual(row.linkedin_account_id, 'acc_li1');
  strictEqual(row.user_id, USER);
  strictEqual(row.organization_id, ORG);
  strictEqual(row.linked_by, USER);
  strictEqual(row.account_status, 'OK');
  strictEqual(row.linkedin_account_name, 'Claire Martin');
  strictEqual(row.failure_reason, null);
});

Deno.test('claimAccount linkedin : le nom qui porte l etat de l ancien flux n est jamais gardé', async () => {
  const db = linkedinDb();
  await claimAccount(db, { organizationId: ORG, userId: USER, account: { ...LINKEDIN, name: `user:${USER}|org:${ORG}` }, now: NOW });
  strictEqual(db.table('member_linkedin_accounts')[0].linkedin_account_name, 'Compte LinkedIn');
});

Deno.test('claimAccount linkedin : un compte verrouillé ou dégradé est stocké tel quel, jamais OK', async () => {
  for (const [status, locked, expected] of [['degraded', false, 'DEGRADED'], ['partial', false, 'PARTIAL'], ['running', true, 'LOCKED']] as const) {
    const db = linkedinDb();
    await claimAccount(db, { organizationId: ORG, userId: USER, account: { ...LINKEDIN, status, is_locked: locked }, now: NOW });
    strictEqual(db.table('member_linkedin_accounts')[0].account_status, expected);
  }
});

Deno.test('claimAccount linkedin : refus d un compte relié à une autre organisation, sans arrêter l ancien compte', async () => {
  const db = linkedinDb([
    { id: 'r-old', organization_id: ORG, user_id: USER, linkedin_account_id: 'acc_old', linkedin_account_name: 'Ancien' },
    { id: 'r-foreign', organization_id: OTHER_ORG, user_id: OTHER_USER, linkedin_account_id: 'acc_li1' },
  ]);
  const result = await claimAccount(db, { organizationId: ORG, userId: USER, account: LINKEDIN, now: NOW });
  deepStrictEqual(result.ok, false);
  strictEqual(!result.ok && result.reason, 'cross_tenant');
  // La liaison actuelle n'a pas bougé et aucune inscription n'a été gelée.
  strictEqual(db.table('member_linkedin_accounts').find((r) => r.id === 'r-old')?.linkedin_account_id, 'acc_old');
  ok(!db.calls.some((c) => c.table === 'sequence_enrollments'));
});

Deno.test('claimAccount linkedin : refus d un compte déjà relié à un autre membre de l organisation', async () => {
  const db = linkedinDb([{ id: 'r-peer', organization_id: ORG, user_id: OTHER_USER, linkedin_account_id: 'acc_li1' }]);
  const result = await claimAccount(db, { organizationId: ORG, userId: USER, account: LINKEDIN, now: NOW });
  strictEqual(!result.ok && result.reason, 'other_member');
});

Deno.test('claimAccount linkedin : le compte remplacé cesse d envoyer avant que la liaison ne change', async () => {
  const db = linkedinDb([
    { id: 'r-old', organization_id: ORG, user_id: USER, linkedin_account_id: 'acc_old', linkedin_account_name: 'Ancien', linked_at: '2026-01-01T00:00:00.000Z' },
  ]);
  db.unique('member_linkedin_accounts', ['user_id', 'organization_id']);
  const result = await claimAccount(db, { organizationId: ORG, userId: USER, account: LINKEDIN, now: NOW });
  ok(result.ok);
  strictEqual(result.ok && result.replacedAccountId, 'acc_old');
  const row = db.table('member_linkedin_accounts').find((r) => r.user_id === USER)!;
  strictEqual(row.linkedin_account_id, 'acc_li1');
  // La montée en charge repart de zéro pour un nouveau compte.
  strictEqual(row.linked_at, NOW.toISOString());
  // L'arrêt a lu les inscriptions du compte remplacé.
  ok(db.calls.some((c) => c.table === 'sequence_enrollments'));
});

Deno.test('claimAccount linkedin : si l arrêt des envois échoue, la liaison ne change pas', async () => {
  const db = linkedinDb([{ id: 'r-old', organization_id: ORG, user_id: USER, linkedin_account_id: 'acc_old' }]);
  db.failOn('sequence_enrollments', 'update');
  db.failOn('sequence_enrollments', 'select');
  const result = await claimAccount(db, { organizationId: ORG, userId: USER, account: LINKEDIN, now: NOW });
  strictEqual(!result.ok && result.reason, 'stop_failed');
  strictEqual(db.table('member_linkedin_accounts')[0].linkedin_account_id, 'acc_old');
});

Deno.test('claimAccount linkedin : la même liaison reconnectée garde son ancienneté', async () => {
  const db = linkedinDb([
    { id: 'r1', organization_id: ORG, user_id: USER, linkedin_account_id: 'acc_li1', linked_at: '2026-01-01T00:00:00.000Z', account_status: 'CREDENTIALS' },
  ]);
  db.unique('member_linkedin_accounts', ['user_id', 'organization_id']);
  const result = await claimAccount(db, { organizationId: ORG, userId: USER, account: LINKEDIN, now: NOW });
  ok(result.ok);
  strictEqual(result.ok && result.replacedAccountId, null);
  const row = db.table('member_linkedin_accounts')[0];
  strictEqual(row.linked_at, '2026-01-01T00:00:00.000Z');
  strictEqual(row.account_status, 'OK');
});

Deno.test('claimAccount linkedin : la reconnexion d un collègue par un administrateur met la ligne à jour sur place', async () => {
  const db = linkedinDb([
    { id: 'r-peer', organization_id: ORG, user_id: OTHER_USER, linkedin_account_id: 'acc_li1', account_status: 'CREDENTIALS', linkedin_account_name: 'Pierre' },
  ]);
  // L'initiateur (USER) n'est pas le titulaire : la ligne reste à son titulaire.
  const result = await claimAccount(db, { organizationId: ORG, userId: USER, purpose: 'reconnect', account: LINKEDIN, now: NOW });
  ok(result.ok);
  const rows = db.table('member_linkedin_accounts');
  strictEqual(rows.length, 1);
  strictEqual(rows[0].user_id, OTHER_USER);
  strictEqual(rows[0].account_status, 'OK');
});

Deno.test('claimAccount : un fournisseur que Konekt ne relie pas est refusé', async () => {
  const result = await claimAccount(new FakeDb(), { organizationId: ORG, userId: USER, account: { id: 'acc_t1', provider: 'telegram' } });
  strictEqual(!result.ok && result.reason, 'unsupported');
});

// ---------------------------------------------------------------------------
// claimAccount : e-mail et WhatsApp
// ---------------------------------------------------------------------------

Deno.test('claimAccount email : adresse tirée du nom, type conservé au format que les lecteurs attendent', async () => {
  const db = new FakeDb();
  for (const [provider, legacy] of [['google', 'GOOGLE_OAUTH'], ['outlook', 'OUTLOOK'], ['imap', 'MAIL']] as const) {
    const id = `acc_${provider}1`;
    const result = await claimAccount(db, { organizationId: ORG, userId: USER, account: { id, provider, name: `  Claire@Exemple.fr ` }, now: NOW });
    ok(result.ok, provider);
    const row = db.table('member_email_accounts').find((r) => r.email_account_id === id)!;
    strictEqual(row.provider, legacy);
    strictEqual(row.email_address, 'claire@exemple.fr');
    strictEqual(row.account_status, 'OK');
    strictEqual(row.linked_by, USER);
  }
});

Deno.test('claimAccount email : jamais une boîte déjà reliée ailleurs, rejouable pour le même membre', async () => {
  const db = new FakeDb({
    member_email_accounts: [
      { id: 'e-foreign', organization_id: OTHER_ORG, user_id: OTHER_USER, email_account_id: 'acc_g1' },
      { id: 'e-peer', organization_id: ORG, user_id: OTHER_USER, email_account_id: 'acc_g2' },
      { id: 'e-own', organization_id: ORG, user_id: USER, email_account_id: 'acc_g3', account_status: 'CREDENTIALS' },
    ],
  });
  const google = (id: string) => ({ id, provider: 'google', name: 'claire@exemple.fr', status: 'running' });
  let result = await claimAccount(db, { organizationId: ORG, userId: USER, account: google('acc_g1'), now: NOW });
  strictEqual(!result.ok && result.reason, 'cross_tenant');
  result = await claimAccount(db, { organizationId: ORG, userId: USER, account: google('acc_g2'), now: NOW });
  strictEqual(!result.ok && result.reason, 'other_member');
  result = await claimAccount(db, { organizationId: ORG, userId: USER, account: google('acc_g3'), now: NOW });
  ok(result.ok);
  strictEqual(db.table('member_email_accounts').find((r) => r.id === 'e-own')?.account_status, 'OK');
  strictEqual(db.table('member_email_accounts').length, 3);
});

Deno.test('claimAccount whatsapp : numéro tiré du nom, liaison retirée jamais reprise, autre membre refusé', async () => {
  const db = new FakeDb({
    member_whatsapp_accounts: [
      { id: 'w-revoked', organization_id: ORG, user_id: USER, whatsapp_account_id: 'acc_w2', account_status: 'DELETED' },
      { id: 'w-peer', organization_id: ORG, user_id: OTHER_USER, whatsapp_account_id: 'acc_w3', account_status: 'OK' },
      { id: 'w-foreign', organization_id: OTHER_ORG, user_id: OTHER_USER, whatsapp_account_id: 'acc_w4', account_status: 'OK' },
    ],
  });
  const wa = (id: string) => ({ id, provider: 'whatsapp', name: '+33 6 12 34 56 78', status: 'running' });
  let result = await claimAccount(db, { organizationId: ORG, userId: USER, account: wa('acc_w1'), now: NOW });
  ok(result.ok);
  const created = db.table('member_whatsapp_accounts').find((r) => r.whatsapp_account_id === 'acc_w1')!;
  strictEqual(created.phone_number, '+33612345678');
  strictEqual(created.account_status, 'OK');
  strictEqual(created.user_id, USER);
  result = await claimAccount(db, { organizationId: ORG, userId: USER, account: wa('acc_w2'), now: NOW });
  strictEqual(!result.ok && result.reason, 'revoked');
  result = await claimAccount(db, { organizationId: ORG, userId: USER, account: wa('acc_w3'), now: NOW });
  strictEqual(!result.ok && result.reason, 'other_member');
  result = await claimAccount(db, { organizationId: ORG, userId: USER, account: wa('acc_w4'), now: NOW });
  strictEqual(!result.ok && result.reason, 'cross_tenant');
});

Deno.test('claimAccount reconnexion : si la liaison a disparu, rien n est relié à l initiateur (qui peut être un administrateur)', async () => {
  // LinkedIn : l'administrateur (USER) reconnectait le compte d'un collègue dont la ligne a été retirée entre-temps.
  const li = linkedinDb([{ id: 'r-own', organization_id: ORG, user_id: USER, linkedin_account_id: 'acc_own', account_status: 'OK' }]);
  const gone = await claimAccount(li, { organizationId: ORG, userId: USER, purpose: 'reconnect', account: LINKEDIN, now: NOW });
  strictEqual(!gone.ok && gone.reason, 'link_gone');
  deepStrictEqual(li.table('member_linkedin_accounts').map((r) => r.linkedin_account_id), ['acc_own'], 'le lien de l administrateur est intact');
  ok(!li.calls.some((c) => c.table === 'sequence_enrollments'), 'aucun envoi arrêté');

  // E-mail et WhatsApp : même règle.
  const mail = new FakeDb();
  const mailResult = await claimAccount(mail, { organizationId: ORG, userId: USER, purpose: 'reconnect', account: { id: 'acc_g9', provider: 'google', name: 'a@b.fr' }, now: NOW });
  strictEqual(!mailResult.ok && mailResult.reason, 'link_gone');
  strictEqual(mail.table('member_email_accounts').length, 0);
  const wa = new FakeDb();
  const waResult = await claimAccount(wa, { organizationId: ORG, userId: USER, purpose: 'reconnect', account: { id: 'acc_w9', provider: 'whatsapp', name: '+33 6 12 34 56 78' }, now: NOW });
  strictEqual(!waResult.ok && waResult.reason, 'link_gone');
  strictEqual(wa.table('member_whatsapp_accounts').length, 0);

  // Par une tentative : elle se termine en échec lisible, jamais « rattaché ».
  const db = attemptDb(attempt({ purpose: 'reconnect', reconnect_account_id: 'acc_li1' }));
  const out = await claimForAttempt(db, { attemptId: ATTEMPT, account: LINKEDIN, now: NOW });
  strictEqual(out.outcome, 'failed');
  strictEqual(out.outcome === 'failed' && out.reason, 'link_gone');
  strictEqual(db.table('connection_attempts')[0].status, 'failed');
  strictEqual(db.table('connection_attempts')[0].error_kind, 'claim_link_gone');
  strictEqual(db.table('member_linkedin_accounts').length, 0);
});

Deno.test('claimAccount whatsapp : un nom qui n est pas un numéro n efface ni le numéro ni le nom enregistrés', async () => {
  const db = new FakeDb({
    member_whatsapp_accounts: [{ id: 'w1', organization_id: ORG, user_id: USER, whatsapp_account_id: 'acc_w1', name: 'Mon numéro', phone_number: '+33612345678', account_status: 'CREDENTIALS' }],
  });
  const result = await claimAccount(db, { organizationId: ORG, userId: USER, purpose: 'reconnect', account: { id: 'acc_w1', provider: 'whatsapp', name: 'Recruteur', status: 'running' }, now: NOW });
  ok(result.ok);
  const row = db.table('member_whatsapp_accounts')[0];
  strictEqual(row.phone_number, '+33612345678');
  strictEqual(row.name, 'Recruteur');
  strictEqual(row.account_status, 'OK');
  await claimAccount(db, { organizationId: ORG, userId: USER, purpose: 'reconnect', account: { id: 'acc_w1', provider: 'whatsapp', name: 'user:u|org:o|providers:WHATSAPP|expires:1' }, now: NOW });
  strictEqual(db.table('member_whatsapp_accounts')[0].phone_number, '+33612345678');
  strictEqual(db.table('member_whatsapp_accounts')[0].name, 'Recruteur', 'un nom illisible ne remplace pas le nom');
});

Deno.test('claimAccount : une nouvelle boîte ou un nouveau numéro remplace le lien à ancien identifiant du même membre, pas les autres', async () => {
  const mail = new FakeDb({
    member_email_accounts: [
      { id: 'old-same', organization_id: ORG, user_id: USER, email_account_id: 'ancien-id', email_address: 'Claire@Exemple.fr' },
      { id: 'old-other-address', organization_id: ORG, user_id: USER, email_account_id: 'ancien-id-2', email_address: 'autre@exemple.fr' },
      { id: 'old-peer', organization_id: ORG, user_id: OTHER_USER, email_account_id: 'ancien-id-3', email_address: 'claire@exemple.fr' },
      { id: 'live-same', organization_id: ORG, user_id: USER, email_account_id: 'acc_g0', email_address: 'claire@exemple.fr' },
    ],
  });
  const result = await claimAccount(mail, { organizationId: ORG, userId: USER, account: { id: 'acc_g1', provider: 'google', name: 'claire@exemple.fr' }, now: NOW });
  ok(result.ok);
  deepStrictEqual(mail.table('member_email_accounts').map((r) => r.id).sort(), ['live-same', 'old-other-address', 'old-peer', unknownId(mail, 'acc_g1')].sort());

  const wa = new FakeDb({
    member_whatsapp_accounts: [
      { id: 'w-old', organization_id: ORG, user_id: USER, whatsapp_account_id: 'ancien-id', phone_number: '+33612345678', account_status: 'OK' },
      { id: 'w-old-tomb', organization_id: ORG, user_id: USER, whatsapp_account_id: 'ancien-id-2', phone_number: '+33612345678', account_status: 'DELETED' },
      { id: 'w-old-other', organization_id: ORG, user_id: USER, whatsapp_account_id: 'ancien-id-3', phone_number: '+33699999999', account_status: 'OK' },
      { id: 'w-old-peer', organization_id: ORG, user_id: OTHER_USER, whatsapp_account_id: 'ancien-id-4', phone_number: '+33612345678', account_status: 'OK' },
    ],
  });
  ok((await claimAccount(wa, { organizationId: ORG, userId: USER, account: { id: 'acc_w1', provider: 'whatsapp', name: '+33 6 12 34 56 78' }, now: NOW })).ok);
  deepStrictEqual(wa.table('member_whatsapp_accounts').map((r) => r.whatsapp_account_id).sort(), ['acc_w1', 'ancien-id-3', 'ancien-id-4']);

  // Un nom sans adresse ni numéro lisible ne supprime rien ; une reconnexion non plus.
  const keep = new FakeDb({ member_email_accounts: [{ id: 'old', organization_id: ORG, user_id: USER, email_account_id: 'ancien-id', email_address: '' }] });
  ok((await claimAccount(keep, { organizationId: ORG, userId: USER, account: { id: 'acc_g2', provider: 'google', name: 'Boîte' }, now: NOW })).ok);
  strictEqual(keep.table('member_email_accounts').length, 2);

  // La suppression est au mieux : un échec ne fait pas échouer la liaison.
  const failing = new FakeDb({ member_email_accounts: [{ id: 'old', organization_id: ORG, user_id: USER, email_account_id: 'ancien-id', email_address: 'claire@exemple.fr' }] });
  failing.failOn('member_email_accounts', 'delete');
  const failed = await claimAccount(failing, { organizationId: ORG, userId: USER, account: { id: 'acc_g3', provider: 'google', name: 'claire@exemple.fr' }, now: NOW });
  ok(failed.ok);
});

function unknownId(db: FakeDb, accountId: string): string {
  return String(db.table('member_email_accounts').find((r) => r.email_account_id === accountId)!.id);
}

// ---------------------------------------------------------------------------
// claimForAttempt
// ---------------------------------------------------------------------------

function attemptDb(row: ConnectionAttemptRow | null, extra: Record<string, Array<Record<string, unknown>>> = {}): FakeDb {
  const db = new FakeDb({ connection_attempts: row ? [row as unknown as Record<string, unknown>] : [], member_linkedin_accounts: [], ...extra });
  db.unique('member_linkedin_accounts', ['linkedin_account_id', 'organization_id']);
  return db;
}

Deno.test('claimForAttempt : utilisateur et organisation viennent de la tentative, jamais de la charge utile', async () => {
  const db = attemptDb(attempt({ intent_id: 'acc_intent' }));
  const out = await claimForAttempt(db, { attemptId: ATTEMPT, account: LINKEDIN, now: NOW });
  strictEqual(out.outcome, 'claimed');
  const link = db.table('member_linkedin_accounts')[0];
  strictEqual(link.user_id, USER);
  strictEqual(link.organization_id, ORG);
  const row = db.table('connection_attempts')[0];
  strictEqual(row.status, 'completed');
  strictEqual(row.account_id, 'acc_li1');
  strictEqual(row.intent_id, null, 'la poignée du flux est effacée');
  ok(row.completed_at);
});

Deno.test('claimForAttempt : rejeu sans effet (deux écrivains, le second ne touche rien)', async () => {
  const db = attemptDb(attempt());
  strictEqual((await claimForAttempt(db, { attemptId: ATTEMPT, account: LINKEDIN, now: NOW })).outcome, 'claimed');
  const before = db.calls.length;
  const second = await claimForAttempt(db, { attemptId: ATTEMPT, account: LINKEDIN, now: NOW });
  strictEqual(second.outcome, 'replayed');
  // Un rejeu ne fait qu'une lecture.
  strictEqual(db.calls.slice(before).filter((c) => c.op !== 'select').length, 0);
});

Deno.test('claimForAttempt : état inconnu, mal formé, échu, annulé ou échoué : rien n est écrit', async () => {
  const cases: Array<[string, ConnectionAttemptRow | null, unknown, string]> = [
    ['inconnu', null, ATTEMPT, 'unknown_attempt'],
    ['mal formé', null, `user:${USER}|org:${ORG}`, 'unknown_attempt'],
    ['échu', attempt({ expires_at: PAST }), ATTEMPT, 'expired'],
    ['annulé', attempt({ status: 'cancelled' }), ATTEMPT, 'cancelled'],
    ['échoué', attempt({ status: 'failed' }), ATTEMPT, 'failed'],
  ];
  for (const [label, row, state, reason] of cases) {
    const db = attemptDb(row);
    const out = await claimForAttempt(db, { attemptId: state, account: LINKEDIN, now: NOW });
    strictEqual(out.outcome, 'refused', label);
    strictEqual(out.outcome === 'refused' && out.reason, reason, label);
    strictEqual(db.table('member_linkedin_accounts').length, 0, label);
  }
});

Deno.test('claimForAttempt : un état mal formé ne déclenche aucune lecture', async () => {
  const db = attemptDb(null);
  await claimForAttempt(db, { attemptId: 'user:abc|org:def', account: LINKEDIN, now: NOW });
  strictEqual(db.calls.length, 0);
});

Deno.test('claimForAttempt : une tentative échue encore en cours est fermée, le membre est informé', async () => {
  const db = attemptDb(attempt({ expires_at: PAST }));
  const out = await claimForAttempt(db, { attemptId: ATTEMPT, account: LINKEDIN, now: NOW });
  strictEqual(out.outcome, 'refused');
  ok(out.outcome === 'refused' && out.notice?.body.includes('expiration'));
  strictEqual(db.table('connection_attempts')[0].status, 'expired');
});

Deno.test('claimForAttempt : liaison refusée = tentative en échec et notice, la liaison existante intacte', async () => {
  const db = attemptDb(attempt(), {
    member_linkedin_accounts: [{ id: 'r-foreign', organization_id: OTHER_ORG, user_id: OTHER_USER, linkedin_account_id: 'acc_li1' }],
  });
  const out = await claimForAttempt(db, { attemptId: ATTEMPT, account: LINKEDIN, now: NOW });
  strictEqual(out.outcome, 'failed');
  strictEqual(out.outcome === 'failed' && out.reason, 'cross_tenant');
  strictEqual(out.outcome === 'failed' && out.notice.title, 'Compte LinkedIn non rattaché');
  strictEqual(db.table('connection_attempts')[0].status, 'failed');
  strictEqual(db.table('connection_attempts')[0].error_kind, 'claim_cross_tenant');
});

Deno.test('claimForAttempt : une erreur de base est rejouable (la tentative reste en cours)', async () => {
  const read = attemptDb(attempt());
  read.failOn('connection_attempts', 'select');
  strictEqual((await claimForAttempt(read, { attemptId: ATTEMPT, account: LINKEDIN, now: NOW })).outcome, 'error');

  const write = attemptDb(attempt());
  write.failOn('member_linkedin_accounts', 'upsert');
  strictEqual((await claimForAttempt(write, { attemptId: ATTEMPT, account: LINKEDIN, now: NOW })).outcome, 'error');
  strictEqual(write.table('connection_attempts')[0].status, 'pending');

  const close = attemptDb(attempt());
  close.failOn('connection_attempts', 'update');
  strictEqual((await claimForAttempt(close, { attemptId: ATTEMPT, account: LINKEDIN, now: NOW })).outcome, 'error');
});

/** The attempt row is changed by someone else right after the claim read it (a cancel, a second start). */
function racing(db: FakeDb, change: (row: Record<string, unknown>) => void): void {
  const realFrom = db.from.bind(db);
  let reads = 0;
  db.from = (table: string) => {
    if (table === 'connection_attempts' && ++reads === 2) change(db.table('connection_attempts')[0]); // the second access is the close
    return realFrom(table);
  };
}

Deno.test('claimForAttempt : un annulation qui passe avant la fermeture gagne, rien n est relié', async () => {
  const db = attemptDb(attempt({ intent_id: 'acc_intent' }));
  racing(db, (row) => Object.assign(row, { status: 'cancelled', intent_id: null }));
  const out = await claimForAttempt(db, { attemptId: ATTEMPT, account: LINKEDIN, now: NOW });
  strictEqual(out.outcome, 'refused');
  strictEqual(out.outcome === 'refused' && out.reason, 'cancelled');
  strictEqual(db.table('member_linkedin_accounts').length, 0, 'aucune liaison pour une tentative annulée');
  strictEqual(db.table('connection_attempts')[0].status, 'cancelled');
});

Deno.test('claimForAttempt : deux écrivains simultanés, un seul écrit ; le second rejoue', async () => {
  const db = attemptDb(attempt());
  racing(db, (row) => Object.assign(row, { status: 'completed', account_id: 'acc_li1', completed_at: NOW.toISOString() }));
  const out = await claimForAttempt(db, { attemptId: ATTEMPT, account: LINKEDIN, now: NOW });
  strictEqual(out.outcome, 'replayed');
  strictEqual(db.table('member_linkedin_accounts').length, 0, 'celui qui a perdu n écrit pas');
  // Gagnant avec un autre compte : refus.
  const other = attemptDb(attempt());
  racing(other, (row) => Object.assign(row, { status: 'completed', account_id: 'acc_autre' }));
  const refused = await claimForAttempt(other, { attemptId: ATTEMPT, account: LINKEDIN, now: NOW });
  strictEqual(refused.outcome === 'refused' && refused.reason, 'completed_other_account');
  strictEqual(other.table('member_linkedin_accounts').length, 0);
});

Deno.test('claimForAttempt : une erreur d écriture rouvre la tentative avec sa poignée de flux, un refus la termine en échec', async () => {
  const db = attemptDb(attempt({ intent_id: 'acc_intent', mode: 'native' }));
  db.failOn('member_linkedin_accounts', 'upsert');
  const out = await claimForAttempt(db, { attemptId: ATTEMPT, account: LINKEDIN, now: NOW });
  strictEqual(out.outcome, 'error');
  const row = db.table('connection_attempts')[0];
  strictEqual(row.status, 'pending', 'rejouable');
  strictEqual(row.intent_id, 'acc_intent', 'la poignée du flux natif est rendue');
  strictEqual(row.account_id, null);
  strictEqual(row.completed_at, null);
  // Rejouée, la liaison est posée.
  strictEqual((await claimForAttempt(db, { attemptId: ATTEMPT, account: LINKEDIN, now: NOW })).outcome, 'claimed');
  strictEqual(db.table('member_linkedin_accounts').length, 1);
  strictEqual(db.table('connection_attempts')[0].status, 'completed');

  // Une exception inattendue de l'écriture est traitée comme une erreur de base.
  const boom = attemptDb(attempt());
  const realFrom = boom.from.bind(boom);
  boom.from = (table: string) => {
    if (table === 'member_linkedin_accounts') throw new Error('réseau coupé');
    return realFrom(table);
  };
  strictEqual((await claimForAttempt(boom, { attemptId: ATTEMPT, account: LINKEDIN, now: NOW })).outcome, 'error');
  strictEqual(boom.table('connection_attempts')[0].status, 'pending');
});

Deno.test('claimForAttempt : le fournisseur de l événement doit être celui de la tentative', async () => {
  const db = attemptDb(attempt({ provider: 'whatsapp' }));
  const out = await claimForAttempt(db, { attemptId: ATTEMPT, account: LINKEDIN, now: NOW });
  strictEqual(out.outcome === 'refused' && out.reason, 'provider_mismatch');
  strictEqual(db.table('member_linkedin_accounts').length, 0);
});

// ---------------------------------------------------------------------------
// Attempts and notifications
// ---------------------------------------------------------------------------

Deno.test('closeAttempt : le premier écrivain gagne', async () => {
  const db = attemptDb(attempt());
  strictEqual(await closeAttempt(db, ATTEMPT, { status: 'completed', accountId: 'acc_li1', now: NOW }), true);
  strictEqual(await closeAttempt(db, ATTEMPT, { status: 'failed', errorKind: 'x', now: NOW }), false);
  strictEqual(db.table('connection_attempts')[0].status, 'completed');
});

Deno.test('loadAttempt : null pour un identifiant mal formé, exception pour une erreur de base', async () => {
  strictEqual(await loadAttempt(attemptDb(null), 'pas un uuid'), null);
  const db = attemptDb(attempt());
  strictEqual((await loadAttempt(db, ATTEMPT))?.id, ATTEMPT);
  db.failOn('connection_attempts', 'select');
  let thrown = false;
  try {
    await loadAttempt(db, ATTEMPT);
  } catch {
    thrown = true;
  }
  ok(thrown);
});

Deno.test('insertClaimNotification : une notification, jamais d exception', async () => {
  const db = new FakeDb({ notifications: [] });
  await insertClaimNotification(db, { userId: USER, organizationId: ORG, notice: claimFailureNotice('linkedin', 'other_member'), accountId: 'acc_li1' });
  const row = db.table('notifications')[0];
  strictEqual(row.user_id, USER);
  strictEqual(row.type, 'error');
  strictEqual(row.link, '/settings/account/connections');
  deepStrictEqual(row.metadata, { account_id: 'acc_li1' });
  db.failOn('notifications', 'insert');
  await insertClaimNotification(db, { userId: USER, organizationId: ORG, notice: claimFailureNotice('linkedin', 'other_member') });
});
