// Garde statique de l'assistant et des actions candidat sur l'API v2 du service de connexion :
// aucun reste de l'ancienne API dans ces fichiers, aucun appel direct au fournisseur hors du client
// partagé, aucun nom de fournisseur dans ce que lit le modèle ou l'utilisateur, et le compte d'un
// appel est toujours prouvé relié au membre avant la requête.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFileSync(`${root}${path}`, 'utf8');
const functions = 'supabase/functions/';

const OWNED = [
  `${functions}_shared/agent-tools-email.ts`,
  `${functions}_shared/agent-tools-mutations.ts`,
  `${functions}_shared/agent-tools-reads.ts`,
  ...readdirSync(`${root}${functions}_shared/candidate-actions`).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => `${functions}_shared/candidate-actions/${f}`),
  `${functions}candidate-actions/index.ts`,
  `${functions}send-candidate-email/index.ts`,
  `${functions}search-agent-chat/index.ts`,
  `${functions}agent-tool-action/index.ts`,
  `${functions}process-scheduled-actions/index.ts`,
  `${functions}process-agent-tasks/index.ts`,
  `${functions}run-agent-search/index.ts`,
];

test('aucun reste de l’ancienne API, de ses identifiants par organisation ou d’un appel direct au fournisseur', () => {
  for (const path of OWNED) {
    const source = read(path);
    assert.doesNotMatch(source, /\/api\/v1|UNIPILE_DSN|UNIPILE_API_KEY|resolveUnipileCredentials|organization_integrations|unipile_dsn|unipile_api_key|baseDsn|creds\.dsn|X-API-KEY/, path);
    assert.doesNotMatch(source, /api\.unipile\.com|\bconst dsn\b|\blet dsn\b/, path);
  }
});

test('aucune écriture de la chaîne du fournisseur dans ce que lit le modèle ou l’utilisateur', () => {
  const mutations = read(`${functions}_shared/agent-tools-mutations.ts`);
  assert.doesNotMatch(mutations, /unipile_response/);
  assert.doesNotMatch(mutations, /Unipile LinkedIn provider_id|Provider\/Unipile/);
  assert.match(mutations, /send_result: \{/);
  // Le dernier recours des fonctions de conversation et de recherche ne renvoie plus le texte d'une exception.
  for (const path of [`${functions}search-agent-chat/index.ts`, `${functions}run-agent-search/index.ts`]) {
    const source = read(path);
    assert.doesNotMatch(source, /error instanceof Error \? error\.message : "Unknown error"/, path);
    assert.match(source, /Le service est momentanément indisponible\. Veuillez réessayer dans quelques instants\./, path);
  }
  // Les textes d'erreur du transport des actions candidat sont écrits ici ; le texte du fournisseur ne va qu'au journal.
  const transport = read(`${functions}_shared/candidate-actions/transport.ts`);
  assert.match(transport, /describeForLog\(error\)/);
  assert.doesNotMatch(transport, /await response\.text\(\)|response\.json\(\)/);
});

test('le compte de chaque appel est prouvé relié au membre avant la requête', () => {
  const transport = read(`${functions}_shared/candidate-actions/transport.ts`);
  assert.match(transport, /assertAccountOwnedByOrg\(admin, scope\.organization_id, accountId, \{ userId, kinds: \[channel\] \}\)/);
  // Une conversation n'a pas de compte propre : le porteur est le compte du membre sous lequel le fournisseur répond.
  assert.match(transport, /getChat\(ownerId, id\)/);
  assert.doesNotMatch(transport, /chat\.account_id|attendee\.account_id/);
  const mutations = read(`${functions}_shared/agent-tools-mutations.ts`);
  assert.match(mutations, /assertAccountOwnedByOrg\(ctx\.adminClient, ctx\.organizationId, accountId, \{ userId: ctx\.userId, kinds: \['linkedin'\] \}\)/);
  assert.match(mutations, /assertAccountOwnedByOrg\(ctx\.adminClient, ctx\.organizationId, sender\.email_account_id, \{ userId: ctx\.userId, kinds: \['email'\] \}\)/);
  assert.doesNotMatch(mutations, /chat\?\.account_id/);
  const send = read(`${functions}send-candidate-email/index.ts`);
  assert.match(send, /assertAccountOwnedByOrg\(adminClient, organizationId, sender\.email_account_id, \{ userId, kinds: \["email"\] \}\)/);
  const search = read(`${functions}run-agent-search/index.ts`);
  assert.match(search, /assertAccountOwnedByOrg\(supabase, orgId, working\.linkedin_account_id, \{ userId: user\.id, kinds: \["linkedin"\] \}\)/);
});

test('la recherche de l’agent part du compte du membre, jamais du premier compte de l’organisation', () => {
  const search = read(`${functions}run-agent-search/index.ts`);
  assert.doesNotMatch(search, /functions\/v1\/unipile-accounts|accounts\[0\]/);
  assert.match(search, /\.from\("member_linkedin_accounts"\)[\s\S]*\.eq\("user_id", user\.id\)[\s\S]*\.eq\("organization_id", orgId\)/);
  assert.match(search, /a\.account_status === "OK"/);
  // Un profil partiel (sans nom) ne se confond pas avec un autre par sa seule ligne de titre.
  assert.match(search, /const nameKey = profile\.name \?/);
  assert.match(search, /\(nameKey && alreadyTreatedSet\.has\(nameKey\)\)/);
  // Le motif d'un refus de la recherche est dit à l'utilisateur seulement s'il vient de la fonction de recherche.
  assert.match(search, /typeof searchData\?\.errorType === "string"/);
});

test('un envoi n’est jamais repris et un envoi incertain n’est jamais donné pour parti', () => {
  const transport = read(`${functions}_shared/candidate-actions/transport.ts`);
  assert.match(transport, /sent\.outcome === 'uncertain'[\s\S]*return uncertain/);
  assert.match(transport, /errorCode: 'SEND_UNCERTAIN'/);
  const mutations = read(`${functions}_shared/agent-tools-mutations.ts`);
  assert.match(mutations, /outcome\.outcome === 'uncertain'[\s\S]*L'envoi n'est pas confirmé/);
  const send = read(`${functions}send-candidate-email/index.ts`);
  assert.match(send, /outcome\.outcome === "uncertain"[\s\S]*SEND_UNCERTAIN/);
  assert.ok(send.indexOf('SEND_UNCERTAIN') < send.indexOf('from("candidate_notes")'), 'aucune note avant la fin de l’envoi');
});

test('un compte LinkedIn partiel se reconnecte, seul un compte limité attend', () => {
  const mutations = read(`${functions}_shared/agent-tools-mutations.ts`);
  const blocked = mutations.slice(mutations.indexOf('function sendingAccountBlockedMessage'), mutations.indexOf('const GDPR_MESSAGE_REFUSED'));
  assert.match(blocked, /value === 'DEGRADED'\)/);
  assert.doesNotMatch(blocked, /'PARTIAL'/);
});

test('le contrôle d’effacement d’une réponse LinkedIn reçoit toute l’identité du destinataire et échoue fermé', () => {
  const mutations = read(`${functions}_shared/agent-tools-mutations.ts`);
  const verify = mutations.slice(mutations.indexOf('Le destinataire d\'une réponse est identifié'), mutations.indexOf('async dryRun(params, ctx) {', mutations.indexOf('Le destinataire d\'une réponse est identifié')));
  assert.match(verify, /linkedinIds: \[recipient, recipientPublicId\]/);
  assert.match(verify, /linkedinUrl: recipientUrl \|\| null/);
  assert.match(verify, /one_to_one && !recipient && !recipientPublicId && !recipientUrl[\s\S]*GDPR_UNVERIFIED_MESSAGE/);
});

test('un refus de la boîte à l’envoi d’un e-mail de suite demande de la reconnecter, comme un envoi non tenté', () => {
  const send = read(`${functions}send-candidate-email/index.ts`);
  const refused = send.slice(send.indexOf('outcome.outcome === "refused"'), send.indexOf('// Le message est parti'));
  assert.match(refused, /outcome\.kind === "account_disconnected"[\s\S]*MAILBOX_RECONNECT[\s\S]*409/);
  assert.match(refused, /SEND_FAILED/);
});

test('la réponse d’un candidat retrouve l’envoi par l’identifiant RFC gardé dans le reçu, et un historique plein n’est jamais complet', () => {
  const incoming = read(`${functions}_shared/candidate-actions/incoming.ts`);
  assert.match(incoming, /result->providerReceipt->>message_id/);
  assert.match(incoming, /effect_id/);
  const transport = read(`${functions}_shared/candidate-actions/transport.ts`);
  assert.match(transport, /page\.hasMore !== true && page\.items\.length < limit/);
  assert.doesNotMatch(transport, /complete: !page\.nextCursor/);
  assert.match(transport, /message_id: rfcMessageId/);
});
