/**
 * Audit séquences 2026-09, lot B4 : canal e-mail des séquences.
 *
 * Deux familles de garde-fous :
 * - les règles pures de _shared/sequence-email-policy.mjs (exécutées ici) ;
 * - le câblage dans les fonctions (lecture du code source) : ordre des
 *   écritures, filtres par organisation, statuts pris en compte.
 *
 * Lancer : node --test tests/ux/seq-audit-b4.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

import {
  CLICK_WITHOUT_OPEN_MIN_DELAY_MS,
  TRACKING_MIN_DELAY_MS,
  decodeHrefUrl,
  enrollmentSendDecision,
  inReplyToCandidates,
  isAutomatedUserAgent,
  linkSigningSecret,
  linkVerificationSecrets,
  pickMailbox,
  providerMessageId,
  recipientList,
  resolveEmailSender,
  sentProofValue,
  signTrackedUrl,
  trackedStatusToRaise,
  verifyTrackedUrl,
} from '../../supabase/functions/_shared/sequence-email-policy.mjs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const sendEmail = read('supabase/functions/sequence-send-email/index.ts');
const track = read('supabase/functions/sequence-email-track/index.ts');
const webhooks = read('supabase/functions/sequence-webhooks-handler/index.ts');
const unsubscribe = read('supabase/functions/handle-email-unsubscribe/index.ts');

/** Corps du handler principal de sequence-send-email (après Deno.serve). */
const sendHandler = sendEmail.slice(sendEmail.indexOf('Deno.serve('));
/** Position de l'appel d'envoi réel dans le handler. */
const sendCallIndex = sendHandler.indexOf('sendResult = await sendViaUnipile(');

const HUMAN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const SENT_AT = '2026-09-25T10:00:00.000Z';
const at = (ms) => Date.parse(SENT_AT) + ms;

// ---------------------------------------------------------------- SEQ-005
test('SEQ-005 — la preuve d’envoi est l’identifiant du fournisseur, jamais un identifiant inventé', () => {
  assert.equal(providerMessageId({ object: 'EmailSent', provider_id: 'prov-1', tracking_id: 'trk-1' }), 'prov-1');
  assert.equal(providerMessageId({ message_id: '<m@x>', provider_id: 'prov-1' }), '<m@x>');
  assert.equal(providerMessageId({}), null);
  assert.equal(providerMessageId(null), null);
  // Sans identifiant, un marqueur déterministe et non nul : la garde et la reprise le lisent.
  assert.equal(sentProofValue(null, 'abc'), sentProofValue(null, 'abc'));
  assert.ok(sentProofValue(null, 'abc').includes('abc'));
  assert.equal(sentProofValue('prov-1', 'abc'), 'prov-1');
});

test('SEQ-005 — une preuve d’envoi existante empêche tout second envoi', () => {
  const guard = sendHandler.indexOf(".not('email_message_id', 'is', null)");
  assert.ok(guard > 0, 'la garde doit chercher une ligne de suivi avec un identifiant non nul');
  assert.ok(sendCallIndex > guard, 'la garde doit précéder l’appel au fournisseur');
  assert.match(sendHandler, /skipped: 'already_sent'/);
});

test('SEQ-005 — après l’envoi : preuve écrite d’abord, statut ensuite, succès même si le statut échoue', () => {
  const afterSend = sendHandler.slice(sendCallIndex);
  const proofWrite = afterSend.indexOf("from('sequence_email_tracking').update(");
  const statusWrite = afterSend.indexOf("status: 'sent',");
  assert.ok(proofWrite > 0 && statusWrite > proofWrite, 'la preuve doit être écrite avant le statut');
  assert.match(afterSend.slice(proofWrite, statusWrite), /sentProofValue\(sendResult\.messageId, trackingId\)/);
  assert.match(afterSend, /\.in\('status', \['sending', 'scheduled'\]\)\.select\('id'\)/);
  assert.match(afterSend, /success: true, message_id: [^}]*status_update_failed: true/);
  assert.doesNotMatch(sendEmail, /Email sent but failed to update execution status/, 'plus de 500 après un envoi réussi');
});

test('SEQ-005 — délai dépassé ou erreur serveur du fournisseur : envoi incertain, sans relance automatique', () => {
  const fn = sendEmail.slice(sendEmail.indexOf('async function sendViaUnipile('), sendEmail.indexOf('// ============ SENDING MAILBOX'));
  assert.match(fn, /res\.status >= 500\) return \{ success: false, error: 'send_uncertain' \}/);
  assert.match(fn, /catch \(err\) \{[\s\S]*?error: 'send_uncertain'/);
  // Une réponse illisible après acceptation reste un succès.
  assert.match(fn, /res\.json\(\)\.catch\(\(\) => null\)/);
  assert.doesNotMatch(sendEmail, /randomUUID\(\)\.slice/, 'plus d’identifiant de message aléatoire');
  assert.match(sendHandler, /sendResult\.error === 'send_uncertain'[\s\S]*?status: 'failed'/);
});

// ---------------------------------------------------------------- SEQ-010 / SEQ-067
test('SEQ-010 — un compte d’envoi hors de l’organisation n’envoie rien', () => {
  const decision = resolveEmailSender({
    candidates: [null, null, 'acc-autre-org'],
    emailAccounts: [],
    linkedinAccounts: [],
    fallbackUserId: 'user-1',
  });
  assert.deepEqual(decision, { kind: 'not_in_org' });

  const resolver = sendEmail.slice(sendEmail.indexOf('async function resolveSendingMailbox('), sendEmail.indexOf('// ============ MAIN HANDLER'));
  assert.match(resolver, /from\('member_email_accounts'\)[\s\S]*?\.eq\('organization_id', orgId\)/);
  assert.match(resolver, /from\('member_linkedin_accounts'\)[\s\S]*?\.eq\('organization_id', orgId\)/);
  const resolveCall = sendHandler.indexOf('await resolveSendingMailbox(');
  assert.ok(resolveCall > 0 && resolveCall < sendCallIndex, 'contrôle avant l’appel au fournisseur');
  assert.match(sendHandler, /mailbox\.kind === 'not_in_org'[\s\S]*?status: 'cancelled',\s*skip_reason: SENDER_NOT_IN_ORG_REASON/);
  assert.match(sendEmail, /SENDER_NOT_IN_ORG_REASON = "Compte d'envoi non rattaché à l'organisation"/);
});

test('SEQ-067 — la boîte e-mail est résolue, jamais l’identifiant du compte LinkedIn', () => {
  // Compte LinkedIn de l'organisation : on prend la boîte de son titulaire.
  assert.deepEqual(
    resolveEmailSender({
      candidates: [null, null, 'li-claire'],
      emailAccounts: [],
      linkedinAccounts: [{ linkedin_account_id: 'li-claire', user_id: 'claire' }],
      fallbackUserId: 'laurent',
    }),
    { kind: 'owner', ownerUserId: 'claire' },
  );
  // Compte e-mail de l'organisation : il sert directement.
  assert.deepEqual(
    resolveEmailSender({
      candidates: ['mb-1'],
      emailAccounts: [{ email_account_id: 'mb-1', user_id: 'claire' }],
      linkedinAccounts: [],
    }),
    { kind: 'mailbox', mailboxId: 'mb-1', ownerUserId: 'claire' },
  );
  // Ancienne valeur (identifiant d'utilisateur) en rotation : ignorée au profit du compte rattaché.
  assert.deepEqual(
    resolveEmailSender({
      candidates: [null, 'uuid-utilisateur', 'li-laurent'],
      emailAccounts: [],
      linkedinAccounts: [{ linkedin_account_id: 'li-laurent', user_id: 'laurent' }],
    }),
    { kind: 'owner', ownerUserId: 'laurent' },
  );
  // Sans compte : l'auteur de l'inscription.
  assert.deepEqual(
    resolveEmailSender({ candidates: [null, undefined, ''], emailAccounts: [], linkedinAccounts: [], fallbackUserId: 'laurent' }),
    { kind: 'owner', ownerUserId: 'laurent' },
  );
  assert.equal(pickMailbox([
    { email_account_id: 'mb-ko', account_status: 'CREDENTIALS' },
    { email_account_id: 'mb-ok', account_status: 'OK' },
  ]), 'mb-ok');
  assert.equal(pickMailbox([]), null);

  assert.doesNotMatch(sendEmail, /step\.sender_id \|\| enrollment\.assigned_sender_id \|\| enrollment\.account_id \|\| ''/);
  assert.match(sendHandler, /const emailAccountId = mailbox\.mailboxId;/);
  assert.match(sendHandler, /mailbox\.kind === 'no_mailbox'[\s\S]*?error_message: NO_SENDER_MAILBOX_MESSAGE/);
  assert.match(sendEmail, /NO_SENDER_MAILBOX_MESSAGE = "Aucune boîte e-mail n'est reliée pour l'expéditeur/);
});

// ---------------------------------------------------------------- SEQ-067 (passe 2)
const importTs = async (source) => {
  const { code } = transformSync(source, { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};

test('SEQ-067 — boîte d’envoi déconnectée : refusée avant l’envoi, échec distinct', async () => {
  const start = sendEmail.indexOf('function isUsableMailboxStatus(');
  const end = sendEmail.indexOf('\n}\n', start);
  assert.ok(start > 0 && end > start, 'règle d’état de la boîte introuvable');
  const { isUsableMailboxStatus } = await importTs(`${sendEmail.slice(start, end + 3)}\nexport { isUsableMailboxStatus };`);
  for (const usable of ['OK', 'ok', ' OK ', 'CONNECTED', null, undefined, '']) {
    assert.equal(isUsableMailboxStatus(usable), true, String(usable));
  }
  for (const disconnected of ['CREDENTIALS', 'ERROR', 'PERMISSIONS', 'DELETED', 'STOPPED', 'CONNECTING']) {
    assert.equal(isUsableMailboxStatus(disconnected), false, disconnected);
  }
  // pickMailbox garde son choix (même boîte que le moteur) ; c'est l'envoi qui la refuse.
  assert.equal(pickMailbox([{ email_account_id: 'mb-ko', account_status: 'CREDENTIALS' }]), 'mb-ko');

  const resolver = sendEmail.slice(sendEmail.indexOf('async function resolveSendingMailbox('), sendEmail.indexOf('// ============ MAIN HANDLER'));
  // Boîte désignée directement : son état est lu dans la même requête.
  assert.match(resolver, /from\('member_email_accounts'\)\.select\('email_account_id, user_id, account_status'\)/);
  assert.match(resolver, /decision\.kind === 'mailbox'[\s\S]*?!isUsableMailboxStatus\(status\)\) return \{ kind: 'mailbox_disconnected'/);
  // Boîte du titulaire : même contrôle après pickMailbox.
  const afterPick = resolver.slice(resolver.indexOf('const mailboxId = pickMailbox(ownerRows);'));
  assert.match(afterPick, /!isUsableMailboxStatus\(status\)\) return \{ kind: 'mailbox_disconnected', mailboxId, status \}/);

  const branch = sendHandler.indexOf("mailbox.kind === 'mailbox_disconnected'");
  assert.ok(branch > 0 && branch < sendCallIndex, 'refus avant l’appel au fournisseur');
  const branchBody = sendHandler.slice(branch, sendHandler.indexOf('const emailAccountId = mailbox.mailboxId;'));
  assert.match(branchBody, /status: 'failed',\s*error_message: SENDER_MAILBOX_DISCONNECTED_MESSAGE,/);
  assert.match(branchBody, /\.in\('status', \['sending', 'scheduled'\]\)/);
  assert.match(branchBody, /return json\(\{ success: false, error: 'sender_mailbox_disconnected' \}\)/);
  assert.match(sendEmail, /SENDER_MAILBOX_DISCONNECTED_MESSAGE = "Boîte e-mail de l'expéditeur déconnectée : reconnectez-la dans Paramètres, Connexions\.";/);
});

// ---------------------------------------------------------------- SEQ-107
test('SEQ-107 — échec d’envoi : \'failed\', jamais \'bounced\' deviné depuis le texte de l’erreur', () => {
  const afterSend = sendHandler.slice(sendCallIndex);
  assert.doesNotMatch(sendEmail, /isBounce/);
  assert.doesNotMatch(afterSend, /status: [^,\n]*'bounced'/);
  const failBranch = afterSend.slice(afterSend.indexOf('} else if (isRateLimit) {'));
  assert.match(failBranch, /\} else \{[\s\S]*?status: 'failed',\s*error_message: sendResult\.error,/);
});

// ---------------------------------------------------------------- SEQ-012
test('SEQ-012 — une réponse clôt aussi une inscription en pause', () => {
  const mailReceived = webhooks.slice(webhooks.indexOf('async function handleMailReceived('), webhooks.indexOf('async function handleMailTracking('));
  assert.match(mailReceived, /\.eq\('email_used', fromEmail\)\s*\.in\('status', \['active', 'paused'\]\)/);
  assert.doesNotMatch(mailReceived, /\.eq\('status', 'active'\)/);

  const reply = webhooks.slice(webhooks.indexOf('async function handleReply('), webhooks.indexOf('// ============ WEBHOOK HANDLERS'));
  assert.match(reply, /status: 'replied',[\s\S]*?pause_reason: null,[\s\S]*?\.in\('status', \['active', 'paused'\]\)/);
  assert.match(reply, /enrollment\.status !== 'active' && enrollment\.status !== 'paused'/);
});

// ---------------------------------------------------------------- SEQ-039
test('SEQ-039 — in_reply_to est lu sous toutes ses formes', () => {
  const fromObject = inReplyToCandidates({ message_id: '<abc@mail.example>', id: 'eml-1' });
  assert.ok(fromObject.includes('<abc@mail.example>'));
  assert.ok(fromObject.includes('abc@mail.example'));
  assert.ok(fromObject.includes('eml-1'));
  assert.deepEqual(inReplyToCandidates('prov-1'), ['prov-1', '<prov-1>']);
  assert.deepEqual(inReplyToCandidates(null), []);
  assert.deepEqual(inReplyToCandidates({}), []);

  assert.doesNotMatch(webhooks, /payload\.in_reply_to as string/);
  assert.match(webhooks, /inReplyToCandidates\(payload\.in_reply_to\)/);
  assert.match(webhooks, /\.in\('email_message_id', inReplyTo\)/);
});

// ---------------------------------------------------------------- SEQ-100
test('SEQ-100 — un seul expéditeur : titulaire de la boîte, repli sur l’auteur de l’inscription', () => {
  assert.doesNotMatch(sendEmail, /sequence\?\.created_by/);
  assert.match(sendHandler, /const senderUserId = mailbox\.senderUserId \|\| \(enrollment\.created_by as string\) \|\| null;/);
  // Expéditeur déjà résolu passé en 4e paramètre (prioritaire), plus en faux sender_id.
  assert.match(sendEmail, /loadAiContextForEnrollment\(supabase, enrollment, null, senderUserId\)/);
  assert.doesNotMatch(sendEmail, /loadAiContextForEnrollment\(supabase, enrollment, \{ sender_id: senderUserId \}\)/);
});

// ---------------------------------------------------------------- SEQ-104
test('SEQ-104 — désinscription : liste de suppression d’abord, jeton ensuite', () => {
  const post = unsubscribe.slice(unsubscribe.indexOf('// POST: Process the unsubscribe'));
  const suppress = post.indexOf(".from('suppressed_emails')");
  const markUsed = post.indexOf('.update({ used_at:');
  assert.ok(suppress > 0 && markUsed > suppress, 'l’upsert doit précéder le marquage du jeton');
});

// ---------------------------------------------------------------- SEQ-105
test('SEQ-105 — avec des copies, ni pixel, ni liens suivis, ni pied de désinscription', () => {
  assert.deepEqual(recipientList([' a@x.fr ', '', null, 'b@x.fr']), ['a@x.fr', 'b@x.fr']);
  assert.deepEqual(recipientList(undefined), []);
  assert.match(sendHandler, /const hasCopies = cc\.length > 0 \|\| bcc\.length > 0;/);
  assert.match(sendHandler, /if \(step\.include_unsubscribe && !hasCopies\)/);
  assert.match(sendHandler, /if \(!hasCopies\) \{\s*\/\/[^\n]*\n\s*htmlBody = await wrapLinksForTracking/);
});

// ---------------------------------------------------------------- SEQ-106
test('SEQ-106 — ouvertures et clics automatiques : horodatés, sans monter le statut', () => {
  const base = { userAgent: HUMAN_UA, executedAt: SENT_AT, currentStatus: 'sent' };
  assert.equal(trackedStatusToRaise({ ...base, evt: 'open', nowMs: at(TRACKING_MIN_DELAY_MS - 1000) }), null);
  assert.equal(trackedStatusToRaise({ ...base, evt: 'open', nowMs: at(5 * 60_000) }), 'opened');
  assert.equal(trackedStatusToRaise({ ...base, evt: 'open', userAgent: '', nowMs: at(5 * 60_000) }), null);
  assert.equal(trackedStatusToRaise({ ...base, evt: 'click', userAgent: 'Mimecast URL Protect', nowMs: at(10 * 60_000) }), null);
  // Clic peu après l'envoi sans ouverture comptée : passerelle de sécurité probable.
  assert.equal(trackedStatusToRaise({ ...base, evt: 'click', nowMs: at(90_000) }), null);
  assert.equal(trackedStatusToRaise({ ...base, evt: 'click', currentStatus: 'opened', nowMs: at(90_000) }), 'clicked');
  assert.equal(trackedStatusToRaise({ ...base, evt: 'click', nowMs: at(CLICK_WITHOUT_OPEN_MIN_DELAY_MS + 1000) }), 'clicked');
  // Le proxy d'images de Gmail charge le pixel à la lecture : ouverture comptée.
  assert.equal(isAutomatedUserAgent('Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)'), false);

  assert.match(track, /const isHead = req\.method === 'HEAD';/);
  assert.match(track, /select\('id, status, tracking_data, executed_at'\)/);
  assert.match(track, /p_new_status: raise \? 'opened' : null/);
  assert.match(track, /p_new_status: raise \? 'clicked' : null/);
});

// ---------------------------------------------------------------- SEQ-109
test('SEQ-109 — un envoi réussi efface l’erreur d’une tentative précédente', () => {
  const afterSend = sendHandler.slice(sendCallIndex);
  assert.match(afterSend, /status: 'sent',\s*executed_at: new Date\(\)\.toISOString\(\),\s*error_message: null,/);
});

// ---------------------------------------------------------------- SEQ-200
test('SEQ-200 — statut de l’inscription relu juste avant l’envoi (pause : attente, clôture : annulation)', () => {
  assert.equal(enrollmentSendDecision('active'), 'send');
  assert.equal(enrollmentSendDecision('paused'), 'hold');
  assert.equal(enrollmentSendDecision('replied'), 'cancel');
  assert.equal(enrollmentSendDecision(undefined), 'cancel');
  const recheck = sendHandler.lastIndexOf("from('sequence_enrollments')");
  assert.ok(recheck > 0 && recheck < sendCallIndex);
  assert.match(sendHandler.slice(recheck, sendCallIndex), /enrollmentSendDecision\(latestEnrollment\?\.status\)/);
  // Pause : l'étape reprend son attente, elle n'est ni annulée ni sautée.
  assert.match(sendHandler, /decision === 'hold'[\s\S]*?update\(\{ status: 'scheduled' \}\)[\s\S]*?\.eq\('status', 'sending'\)/);
});

// ---------------------------------------------------------------- SEQ-201 / SEQ-202
test('SEQ-201 — signature lue dans l’organisation de l’inscription seulement', () => {
  assert.match(sendHandler, /from\('email_signatures'\)[\s\S]*?\.eq\('organization_id', orgId\)/);
  assert.match(sendHandler, /if \(step\.signature_id && orgId\)/);
});

test('SEQ-202 — la raison de la suppression n’est pas exposée', () => {
  assert.match(sendEmail, /SUPPRESSED_SKIP_REASON = 'Adresse bloquée pour les envois e-mail'/);
  assert.doesNotMatch(sendEmail, /Adresse en liste de suppression \(/);
});

// ---------------------------------------------------------------- SEQ-203 / SEQ-204 / SEQ-205
test('SEQ-203 — liens avec &amp; ou %XX : URL réelle signée, pas de double décodage', () => {
  assert.equal(decodeHrefUrl('https://cal.com/x?a=1&amp;b=2'), 'https://cal.com/x?a=1&b=2');
  assert.equal(decodeHrefUrl('https://x.fr/?a=1&#38;b=2&#x26;c=3'), 'https://x.fr/?a=1&b=2&c=3');
  assert.equal(decodeHrefUrl('https://x.fr/?mail=a%40b.fr'), 'https://x.fr/?mail=a%40b.fr');
  assert.doesNotMatch(track, /decodeURIComponent\(rawRedirect\)/);
  assert.match(sendEmail, /const target = decodeHrefUrl\(m\[2\]\);/);
});

test('SEQ-204 — clé de signature dédiée, liens déjà envoyés toujours valides après rotation', async () => {
  const env = (vars) => (key) => vars[key];
  assert.equal(linkSigningSecret(env({ EMAIL_LINK_SIGNING_SECRET: 'dedie', SB_SECRET_KEY: 'svc' })), 'dedie');
  assert.equal(linkSigningSecret(env({ SB_SECRET_KEY: 'svc' })), 'svc');
  assert.deepEqual(
    linkVerificationSecrets(env({ EMAIL_LINK_SIGNING_SECRET: 'new', EMAIL_LINK_SIGNING_SECRET_PREVIOUS: 'old', SB_SECRET_KEY: 'svc', SUPABASE_SERVICE_ROLE_KEY: 'svc' })),
    ['new', 'old', 'svc'],
  );
  const url = 'https://cal.com/x?a=1&b=2';
  const sigOld = await signTrackedUrl('old', 'tid1', url);
  assert.equal(await verifyTrackedUrl(['new', 'old'], 'tid1', url, sigOld), true);
  assert.equal(await verifyTrackedUrl(['new'], 'tid1', url, sigOld), false);
  assert.equal(await verifyTrackedUrl(['new', 'old'], 'tid2', url, sigOld), false);
  assert.equal(await verifyTrackedUrl(['old'], 'tid1', url, null), false);
  assert.match(sendEmail, /linkSigningSecret\(\(key\) => Deno\.env\.get\(key\)\)/);
  assert.match(track, /linkVerificationSecrets\(\(key\) => Deno\.env\.get\(key\)\)/);
});

test('SEQ-205 — plus de suivi natif du fournisseur en double', () => {
  const payload = sendEmail.slice(sendEmail.indexOf('const payload: Record<string, unknown> = {'), sendEmail.indexOf('let res: Response;'));
  assert.match(payload, /account_id: accountId,/);
  assert.doesNotMatch(payload, /tracking_options\s*:/);
});

// ---------------------------------------------------------------- Branding
test('Textes lus par le recruteur : sans nom de fournisseur', () => {
  const userFacing = [...sendEmail.matchAll(/^const [A-Z_]+ = (["'])(.*)\1;$/gm)].map((m) => m[2]);
  assert.ok(userFacing.length >= 4);
  for (const text of userFacing) {
    assert.doesNotMatch(text, /Unipile|Resend|Anthropic|Claude|Microsoft/i, text);
  }
});
