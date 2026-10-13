/**
 * Restes du front après le passage à l'API v2 (lot S1G) :
 *  - InMail groupé : solde et objet de la licence qui enverra, comme la file
 *    (resolveSendLicence et planInmail, supabase/functions/_shared/sequence-linkedin-send.ts) ;
 *  - texte de reconnexion sans cookie ;
 *  - Message.chat_id typé et repli de compte qui traite '' comme absent ;
 *  - onglet « Reconnecter » de l'extension renvoyé vers Paramètres › Connexions.
 *
 * Lancer : node --test tests/ux/inmail-licence.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

async function loadPure(rel) {
  const result = await build({
    stdin: { contents: read(rel), resolveDir: path.dirname(path.join(ROOT, rel)), loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

test('Licence active : contrat sélectionné, sinon Recruiter, sinon Sales Navigator, sinon Classic', async () => {
  const m = await loadPure('src/lib/inmailLicence.ts');
  assert.equal(m.licenceFromContracts([]), 'classic');
  assert.equal(m.licenceFromContracts([{ product: 'recruiter', selected: true }]), 'recruiter');
  assert.equal(m.licenceFromContracts([{ product: 'sales_navigator', selected: true }]), 'sales_navigator');
  assert.equal(m.licenceFromContracts([{ product: 'recruiter', selected: false }, { product: 'sales_navigator', selected: true }]), 'sales_navigator');
  assert.equal(m.licenceFromContracts([{ product: 'recruiter' }, { product: 'sales_navigator' }]), 'recruiter');
  assert.equal(m.licenceFromContracts([{ product: 'sales_navigator' }]), 'sales_navigator');
  assert.equal(m.licenceFromContracts([{ product: 'autre', selected: true }]), 'classic');
});

test('Solde et objet par licence : Classic lit premium et n\'a pas d\'objet', async () => {
  const m = await loadPure('src/lib/inmailLicence.ts');
  assert.equal(m.balanceKeyOf('classic'), 'premium');
  assert.equal(m.balanceKeyOf('recruiter'), 'recruiter');
  assert.equal(m.balanceKeyOf('sales_navigator'), 'sales_navigator');
  assert.equal(m.subjectRequired('classic'), false);
  assert.equal(m.subjectRequired('recruiter'), true);
  assert.equal(m.subjectRequired('sales_navigator'), true);
  assert.equal(m.subjectRequired(null), false, 'licence inconnue : le serveur tranche');
  assert.match(m.subjectHelp('recruiter'), /Recruiter.*Votre nom de profil signe le message/);
  assert.match(m.subjectHelp('sales_navigator'), /Sales Navigator/);
  assert.equal(m.subjectHelp('classic'), null);
  assert.doesNotMatch(`${m.subjectHelp('recruiter')}${m.subjectHelp('sales_navigator')}`, /Unipile|—/);
});

test('Le miroir suit la règle du serveur', () => {
  const server = read('supabase/functions/_shared/sequence-linkedin-send.ts');
  assert.match(server, /selected === 'recruiter' \|\| selected === 'sales_navigator'/);
  assert.match(server, /recruiter \? 'recruiter' : salesNavigator \? 'sales_navigator' : 'classic'/);
  assert.match(server, /if \(licence === 'classic'\) return \{ ok: true, spec: \{ licence: 'classic' \} \};/);
  assert.match(server, /if \(licence === 'sales_navigator'\) return \{ ok: true, spec: \{ licence: 'sales_navigator', subject \} \};/);
  const lib = read('src/lib/inmailLicence.ts');
  assert.match(lib, /selected === 'recruiter' \|\| selected === 'sales_navigator'/);
  assert.match(lib, /products\.includes\('recruiter'\)\) return 'recruiter'/);
});

test('InMail groupé : solde de la licence active, objet selon la licence', () => {
  const src = read('src/components/outreach/BulkInMailModal.tsx');
  assert.doesNotMatch(src, /getCredits\('recruiter'\)|hasCredits\('recruiter'|recruiterCredits/);
  assert.doesNotMatch(src, /passe par l'API Recruiter/);
  assert.match(src, /const \{ licence: sendLicence, isResolving: isResolvingLicence \} = useSendLicence\(accountId\);/);
  assert.match(src, /getCredits\(balanceKeyOf\(sendLicence\)\)/);
  assert.match(src, /hasCredits\(balanceKeyOf\(sendLicence\), creditsNeeded\)/);
  // Le champ Objet n'existe que si la licence en exige un (ou si elle est inconnue).
  assert.match(src, /const needsSubject = sendLicence === null \|\| subjectRequired\(sendLicence\);/);
  assert.match(src, /\{needsSubject && \(\s*<div className="space-y-1\.5">\s*<Label htmlFor="subject"/);
  assert.match(src, /subject: needsSubject \? firstReadyMessage\.subject \|\| null : null,/);
  // Planifier refuse un InMail Recruiter ou Sales Navigator sans objet.
  const queue = src.slice(src.indexOf('const handleQueueAll = async () => {'), src.indexOf('// Cancel pending items'));
  assert.match(queue, /if \(subjectRequired\(sendLicence\)\) \{[\s\S]*?subject\.trim\(\) === ''/);
  assert.match(queue, /Ajoutez un objet/);
  // Un destinataire déjà en relation reçoit un message gratuit sans objet : jamais réclamé.
  assert.match(queue, /queueNetworkDistance\(r\) !== 1 && messages\[r\.id\]\.subject\.trim\(\) === ''/);
  // Le premier InMail à corriger s'affiche, et un nom vide ne laisse pas un trou dans la phrase.
  assert.match(queue, /setCurrentRecipientIndex\(recipients\.indexOf\(missingSubject\[0\]\)\)/);
  assert.match(queue, /missingSubject\[0\]\.name \|\| 'ce candidat'/);
  assert.ok(queue.indexOf('Ajoutez un objet') < queue.indexOf('setIsQueueing(true)'), 'refus avant toute mise en file');
  assert.match(src, /isResolvingLicence \|\| !hasEnoughCredits/);
  // Pendant la lecture de la licence, le bouton montre son indicateur d'attente.
  assert.match(src, /loading=\{isGenerating \|\| isResolvingLicence \|\| missionConfigStatus === 'loading'\}/);
  // Champ Objet : état d'erreur du composant et champ annoncé obligatoire, pour le destinataire affiché seulement.
  assert.match(src, /const subjectIsRequired = subjectRequired\(sendLicence\)\s*&& !\(currentRecipient && queueNetworkDistance\(currentRecipient\) === 1\);/);
  assert.match(src, /aria-required=\{subjectIsRequired \|\| undefined\}/);
  assert.match(src, /error=\{subjectIsRequired && editingSubject\.trim\(\) === ''\}/);
  assert.match(src, /Ajoutez un objet pour pouvoir planifier\./);
});

test('Lecture de la licence : toujours les contrats, jamais de devinette depuis la liste des comptes', () => {
  const hook = read('src/hooks/useSendLicence.ts');
  // Les offres de la liste des comptes sont une déduction au mieux du serveur : elles ne décident pas.
  assert.doesNotMatch(hook, /shouldReadContracts|licenceFromSubscriptions|useLinkedInAccounts/);
  assert.match(hook, /enabled: !!accountId,/);
  assert.match(hook, /if \(query\.isError\) return \{ licence: null, isResolving: false \};/);
  assert.match(hook, /'unipile-accounts'/);
});

test('Texte de reconnexion : Paramètres › Connexions, jamais un cookie', () => {
  const actions = read('src/hooks/useLinkedInSearchActions.ts');
  assert.match(actions, /Votre session a expiré\. Reconnectez votre compte dans Paramètres › Connexions\./);
  assert.match(actions, /toast\.error\(`Compte LinkedIn indisponible\. \$\{detail\}`/);
  assert.doesNotMatch(actions, /cookie li_at|méthode cookie|recréez le mapping/);
  assert.doesNotMatch(actions, /Compte LinkedIn indisponible —/);
  const banner = read('src/components/outreach/search/LinkedInReconnectBanner.tsx');
  assert.match(banner, /\{accountLabel\} : session LinkedIn instable\./);
  assert.doesNotMatch(banner, /session LinkedIn instable\.<\/span>[\s\S]*Paramètres › Connexions/);
  assert.doesNotMatch(banner, /li_at|cookies frais|ré-importez|\{accountLabel\} —/);
});

test('Message.chat_id typé et compte de repli : une chaîne vide vaut « inconnu »', () => {
  const hook = read('src/hooks/useMessagesInbox.ts');
  assert.match(hook, /export interface Message \{[\s\S]*?chat_id\?: string \| null;[\s\S]*?\n\}/);
  const inbox = read('src/components/outreach/MessagesInbox.tsx');
  assert.doesNotMatch(inbox, /as \(\{ chat_id\?: string \| null \} \| undefined\)/);
  assert.match(inbox, /\?\.account_id \|\| selectedAccount;/);
  assert.match(inbox, /accountId: chat\.account_id \|\| selectedAccount/);
  assert.doesNotMatch(inbox, /account_id \?\? selectedAccount/);
});

test('Extension : l\'onglet Reconnecter renvoie vers Paramètres › Connexions, sans appel de connexion', () => {
  const popup = read('extensions/chrome/src/popup/Popup.tsx');
  const tab = popup.slice(popup.indexOf('function ReconnectTab'), popup.indexOf('// ─── Tab : Quick Add'));
  assert.match(tab, /\/settings\/account\/connections/);
  assert.match(tab, /Paramètres › Connexions/);
  assert.doesNotMatch(tab, /RECONNECT_LINKEDIN|sendMessage|handleReconnect/);
  assert.doesNotMatch(tab, /cookie|CREDENTIALS|Recruiter quotidien/);
});

test('Extension : le popup s\'ouvre sur « Ajouter », pas sur le renvoi vers Paramètres', () => {
  const popup = read('extensions/chrome/src/popup/Popup.tsx');
  assert.match(popup, /useState<'reconnect' \| 'add' \| 'settings'>\('add'\)/);
});
