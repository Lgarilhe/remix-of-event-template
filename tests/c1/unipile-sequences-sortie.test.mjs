/**
 * Garde statique du lot S4b (passage à l'API v2 seule) : envois de la file
 * InMail et des e-mails de séquence.
 *
 *   process-sequences (moteur), process-inmail-queue, sequence-send-email, _shared/sequence-*.ts
 *   (dont sequence-linkedin-send.ts et sequence-email-send.ts, nouveaux).
 *
 * Invariants :
 *   - S4B-1 aucun reste de l'ancienne API : ni /api/v1, ni UNIPILE_DSN,
 *     UNIPILE_API_KEY, resolveUnipileCredentials, colonnes unipile_* ou variable
 *     dsn, ni corps multipart (FormData) ni en-tête de clé ;
 *   - S4B-2 aucun fetch vers l'hôte du prestataire : les envois passent par
 *     _shared/unipile (sendEmail, startChat, getInmailCredits, listContracts) ;
 *   - S4B-3 file InMail : état du compte et format de son identifiant avant tout
 *     appel, licence et solde lus avant le claim, claim avant l'envoi, marqueur
 *     avant l'envoi, limite du réseau = pause du compte pour la journée ;
 *   - S4B-4 un envoi incertain n'est jamais enregistré comme envoyé, jamais repris ;
 *   - S4B-5 aucune phrase rendue à un utilisateur ne nomme le prestataire ;
 *   - S4B-6 e-mail : preuve d'envoi = Message-ID de l'en-tête, sinon identifiant du courrier.
 *
 * Le comportement des modules est joué par des tests Deno :
 *   _shared/sequence-linkedin-send.test.ts, sequence-email-send.test.ts,
 *   sequence-send-rules.test.ts, sequence-sender.test.ts.
 *
 * Lancer : node --test tests/c1/unipile-sequences-sortie.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const FN = 'supabase/functions';
const QUEUE = `${FN}/process-inmail-queue/index.ts`;
const EMAIL = `${FN}/sequence-send-email/index.ts`;
// Moteur (passe S4-4) : mêmes interdits que les envois, en plus de son propre test
// (tests/ux/seq-v2-moteur.test.mjs).
const ENGINE = `${FN}/process-sequences/index.ts`;
const SHARED_SEQUENCE = readdirSync(join(ROOT, FN, '_shared'))
  .filter((f) => /^sequence-.*\.(ts|mjs)$/.test(f) && !/\.test\.ts$/.test(f))
  .map((f) => `${FN}/_shared/${f}`);
const PRODUCTION = [ENGINE, QUEUE, EMAIL, ...SHARED_SEQUENCE];

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** Corps de la boucle d'envoi de la file : de la première lecture d'un item à la réponse. */
const queueLoop = () => {
  const src = read(QUEUE);
  return src.slice(src.indexOf('for (const item of pendingItems'), src.indexOf('// Action: status'));
};

test('S4B-1 : aucun reste de l\'ancienne API dans les envois de séquence', () => {
  assert.ok(SHARED_SEQUENCE.includes(`${FN}/_shared/sequence-linkedin-send.ts`));
  assert.ok(SHARED_SEQUENCE.includes(`${FN}/_shared/sequence-email-send.ts`));
  for (const rel of PRODUCTION) {
    const src = read(rel);
    assert.doesNotMatch(src, /\/api\/v1/, `${rel} : /api/v1`);
    assert.doesNotMatch(src, /UNIPILE_DSN|UNIPILE_API_KEY|resolveUnipileCredentials|unipile_api_key|unipile_dsn|unipile_connected/, rel);
    assert.doesNotMatch(src, /\b(const|let|var)\s+dsn\b|\bdsn\s*:|\bbareDsn\b|\bcreds\.(dsn|apiKey)\b|uCreds/, `${rel} : variable dsn ou creds`);
    assert.doesNotMatch(stripComments(src), /new FormData\(|X-API-KEY|linkedin\[|attendees_ids|inmail_balance(?!_unavailable)/, `${rel} : corps multipart ou champ de l'ancienne API`);
    assert.doesNotMatch(src, /organization_integrations/, `${rel} : plus de lecture des accès par organisation`);
  }
});

test('S4B-2 : aucun fetch vers le prestataire, tout passe par le client commun', () => {
  const queue = stripComments(read(QUEUE));
  assert.doesNotMatch(queue, /\bfetch(WithTimeout)?\(/, 'la file InMail n\'appelle plus rien en direct');
  assert.match(queue, /from "\.\.\/_shared\/unipile\/index\.ts"/);
  assert.match(queue, /from "\.\.\/_shared\/sequence-linkedin-send\.ts"/);
  const email = stripComments(read(EMAIL));
  // Le seul fetch restant va vers une autre fonction Konekt (contexte du candidat).
  for (const line of email.split('\n').filter((l) => /\bfetch(WithTimeout)?\(/.test(l) && !/function fetchWithTimeout/.test(l))) {
    assert.match(line, /fetchWithTimeout\(`\$\{SUPABASE_URL\}\/functions\/v1\/|return fetch\(url, \{ \.\.\.options/, line.trim());
  }
  assert.match(email, /from "\.\.\/_shared\/sequence-email-send\.ts"/);
  for (const rel of SHARED_SEQUENCE) {
    const src = stripComments(read(rel));
    if (rel.endsWith('sequence-linkedin-send.ts') || rel.endsWith('sequence-email-send.ts')) {
      assert.doesNotMatch(src, /\bfetch\(/, rel);
      assert.match(src, /from '\.\/unipile\/index\.ts'/, rel);
    }
  }
  const send = stripComments(read(`${FN}/_shared/sequence-email-send.ts`));
  assert.match(send, /sendEmail\(/);
  const linkedin = stripComments(read(`${FN}/_shared/sequence-linkedin-send.ts`));
  assert.match(linkedin, /startChat\(/);
  assert.match(linkedin, /listContracts\(/);
  assert.match(stripComments(read(QUEUE)), /getInmailCredits\(item\.account_id, sendLicence\)/);
});

test('S4B-3 : file InMail, ordre des contrôles avant l\'envoi', () => {
  const loop = queueLoop();
  const at = (needle) => {
    const i = loop.indexOf(needle);
    assert.ok(i > 0, `repère introuvable : ${needle}`);
    return i;
  };
  const linked = at('const accountLink = await getAccountLink(');
  const gate = at('const gate = accountSendGate(status);');
  const configured = at('if (!isUnipileConfigured())');
  const v2 = at('if (!isV2AccountId(item.account_id))');
  const licence = at('sendLicence = await resolveSendLicence(item.account_id);');
  const credits = at('const balance = await getInmailCredits(item.account_id, sendLicence);');
  const quota = at('const gate = await enforceLinkedInAction(');
  const claim = at('.update({ status: "sending" })');
  const marker = at('await recordQueueSend(supabase, item, itemOrgId as string, null);');
  const send = at('const outcome = await startLinkedInChat({');
  const sent = at('status: "sent"');
  const recorded = at('await recordQueueSend(supabase, item, itemOrgId as string, {', sent);
  assert.ok(linked < gate && gate < configured && configured < v2 && v2 < licence && licence < credits && credits < quota && quota < claim, 'contrôles dans l\'ordre, claim après');
  assert.ok(claim < marker && marker < send && send < sent && sent < recorded, 'claim, marqueur, envoi, statut, enregistrement');
  // L'InMail se crée avec la licence qui enverra, solde de cette licence seule ; une licence absente vaut zéro.
  assert.match(loop, /credits = balance\[sendLicence\] \?\? 0;/);
  assert.match(loop, /kind: isFirstDegree \? "classic" : sendLicence,\s*inmail: isFirstDegree \? undefined : inmailSpec,/);
  // Un message direct (premier degré) ne lit ni licence ni solde.
  assert.match(loop, /if \(!isFirstDegreeMsg\) \{\s*let credits: number;/);
  // Contrôle des crédits impossible : report de 30 minutes (fail-closed), texte fixe.
  assert.match(loop, /scheduled_at: new Date\(Date\.now\(\) \+ 30 \* 60 \* 1000\)\.toISOString\(\),[^}]*Contrôle des crédits InMail momentanément indisponible, nouvel essai dans 30 min/);
  assert.match(loop, /scheduled_at: new Date\(Date\.now\(\) \+ 4 \* 60 \* 60 \* 1000\)\.toISOString\(\),\s*error_message: "Crédits InMail épuisés \(re-essai dans 4h\)"/);
  // Objet et signature manquants : échec explicite avant le claim, rien n'est parti.
  assert.match(loop, /plan\.reason === "subject_missing"/);
  // Plus de signal d'usage en pourcentage : la limite vient du registre et du refus du réseau.
  assert.doesNotMatch(read(QUEUE), /parseUsagePct/);
});

test('S4B-3 : état du compte, DEGRADED, PARTIAL et LOCKED reportent sans échec ni boucle horaire', () => {
  const loop = queueLoop();
  const status = loop.slice(loop.indexOf('const gate = accountSendGate(status);'), loop.indexOf('Sérialisation par compte'));
  assert.match(status, /const delayMs = gate === 'limited' \? LIMITED_ACCOUNT_DEFER_MS : 60 \* 60 \* 1000;/);
  assert.match(status, /status: 'scheduled',/);
  assert.doesNotMatch(status, /status: 'failed'|status: 'cancelled'/, 'un compte limité ne fait ni échouer ni annuler l\'item');
  assert.match(status, /INMAIL_DISCONNECTED_MESSAGE/);
  assert.match(status, /LIMITED_ACCOUNT_MESSAGE/);
  // Aucun statut brut dans le texte lu par le recruteur.
  assert.doesNotMatch(read(QUEUE), /Compte LinkedIn non disponible \(statut/);
});

test('S4B-3 : limite du réseau = pause du compte pour la journée, requête non traitée = report', () => {
  const loop = queueLoop();
  const refused = loop.slice(loop.indexOf('if (outcome.outcome === "refused")'), loop.indexOf('// Mark as sent'));
  assert.match(refused, /if \(outcome\.kind === "provider_limit"\) \{\s*await recordUsageSignal\(supabase, item\.account_id, 100, item\.user_timezone\);/);
  assert.match(refused, /inmailRefusalPlan\(outcome\.kind, outcome\.error\.status, item\.error_message \?\? null\)/);
  assert.match(refused, /plan\.action === "retry" \|\| plan\.action === "defer"/);
  assert.match(refused, /\.eq\("status", "sending"\)/);
  assert.match(refused, /throw new Error\(plan\.message\)/);
});

test('S4B-4 : un envoi incertain n\'est jamais enregistré comme envoyé ni repris', () => {
  const loop = queueLoop();
  const uncertain = loop.slice(loop.indexOf('if (outcome.outcome === "uncertain")'), loop.indexOf('if (outcome.outcome === "refused")'));
  assert.match(uncertain, /throw new Error\("Envoi incertain : /);
  assert.doesNotMatch(uncertain, /status: "sent"|recordQueueSend|continue;/);
  // L'identifiant de message est celui que normalise le client (premier de la liste, ou aucun).
  assert.match(loop, /messageId: textOrNull\(outcome\.messageId\),/);
  assert.match(loop, /chatId: textOrNull\(outcome\.chatId\),/);
  // L'issue incertaine finit en échec (catch), jamais en nouvelle tentative.
  const catchBlock = loop.slice(loop.indexOf('} catch (sendError) {'));
  assert.match(catchBlock, /status: "failed",/);
  // E-mail : aucun nouvel essai après un envoi incertain (un seul nouvel essai, après un refus de l'expéditeur).
  const email = read(`${FN}/_shared/sequence-email-send.ts`);
  assert.match(email, /if \(outcome\.outcome === 'uncertain'\) return \{ success: false, error: 'send_uncertain' \};/);
  assert.match(email, /if \(from && outcome\.outcome === 'refused' && outcome\.kind === 'validation'\)/);
});

test('S4B-5 : aucune phrase rendue à un utilisateur ne nomme le prestataire', () => {
  for (const rel of PRODUCTION) {
    const code = stripComments(read(rel));
    const literals = [...code.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((m) => m[2]);
    const hits = literals.filter((l) => /unipile/i.test(l) && !/^(\.\.?\/)|\.ts$|unipile-webhook|unipile-search|unipile-accounts|\[unipile\]/i.test(l));
    assert.deepEqual(hits, [], `${rel} : ${hits.join(' | ')}`);
  }
  // Les messages de la file sont écrits par Konekt : ni code HTTP brut ni corps du fournisseur ne s'y ajoutent.
  const rules = read(`${FN}/_shared/sequence-send-rules.ts`);
  assert.match(rules, /Le service de connexion LinkedIn a refusé l'envoi/);
});

test('S4B-6 : e-mail, la preuve d\'envoi est le Message-ID de l\'en-tête, sinon l\'identifiant du courrier', () => {
  const policy = read(`${FN}/_shared/sequence-email-policy.mjs`);
  assert.match(policy, /const PROVIDER_ID_KEYS = \['message_id', 'id'\];/);
  const send = read(`${FN}/_shared/sequence-email-send.ts`);
  assert.match(send, /providerMessageId\(\{ message_id: outcome\.messageId, id: outcome\.emailId \}\)/);
  // La boîte est lue dans l'organisation de l'inscription, avec son adresse (exigée à côté d'un nom affiché).
  const email = read(EMAIL);
  assert.match(email, /\.select\('email_account_id, user_id, account_status, email_address'\)\s*\.eq\('organization_id', orgId\)/);
  assert.match(email, /isUnipileConfigured\(\)/);
});
