/**
 * Suite d'un entretien (message au candidat, présentation au manager) : garde-fous
 * statiques des deux fonctions serveur et de leur module partagé.
 *
 * Lecture du source et assertions sur les motifs, sans Deno, base ni réseau.
 * Les règles de contenu (champs écartés avant le modèle, accord obligatoire,
 * type d'organisation) sont prouvées sur le comportement dans
 * tests/ux/interview-followup.test.mjs ; ce fichier garde la forme : qui peut
 * appeler, dans quel ordre les refus tombent, ce qui est écrit, ce qui ne l'est pas.
 *
 * Un envoi réel (boîte reliée, prestataire d'envoi) et la qualité d'un brouillon
 * ne se vérifient pas ici.
 * Lancer : node --test tests/c1/interview-followup.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const generate = read('supabase/functions/generate-interview-followup/index.ts');
const send = read('supabase/functions/send-candidate-email/index.ts');
const shared = read('supabase/functions/_shared/interview-followup.ts');
const config = read('supabase/config.toml');

// Le code sans ses commentaires : un commentaire peut nommer ce que le code s'interdit.
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const indexOf = (source, needle) => {
  const at = source.indexOf(needle);
  assert.notEqual(at, -1, `introuvable : ${needle}`);
  return at;
};

test('config : les deux fonctions sont déclarées sans JWT de passerelle, l’authentification est dans le code', () => {
  for (const name of ['generate-interview-followup', 'send-candidate-email']) {
    assert.match(config, new RegExp(`\\[functions\\.${name}\\]\\s*\\nverify_jwt = false`));
  }
});

test('authentification : un utilisateur connecté membre de l’organisation, jamais un appel anonyme ni la clé de service', () => {
  for (const source of [generate, send]) {
    assert.match(source, /requireOrgAccess\(req, body, corsHeaders\)/);
    assert.match(source, /check_rate_limit/);
    // L'identité vient de requireOrgAccess : aucun user_id lu dans le corps de la demande.
    assert.doesNotMatch(source, /body\.user_id|body\.organization_id/);
  }
});

test('rédaction : refus de crédits avant l’appel au modèle, débit après, rien n’est écrit ni envoyé', () => {
  assert.ok(indexOf(generate, 'assertCredits(') < indexOf(generate, 'callClaudeCompat('));
  assert.ok(indexOf(generate, 'callClaudeCompat(') < indexOf(generate, 'settleClaudeUsage('));
  assert.match(generate, /aiAction: "interview_followup"/);
  assert.match(generate, /creditGateResponse\(gate, corsHeaders\)/);
  assert.match(generate, /antiAiStyle: "full"/);
  assert.doesNotMatch(generate, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\/emails/);
});

test('rédaction : le type d’organisation est vérifié avant la déduction de crédits', () => {
  assert.match(generate, /kind === "manager_presentation"/);
  assert.match(generate, /canPresentToManager\(/);
  assert.match(generate, /ORG_TYPE_NOT_ALLOWED/);
  assert.ok(indexOf(generate, 'canPresentToManager(') < indexOf(generate, 'assertCredits('));
});

test('rédaction : le modèle ne reçoit que les vues filtrées du compte rendu, jamais la transcription', () => {
  assert.match(shared, /managerReportView\(ctx\.report\)/);
  assert.match(shared, /candidateReportView\(ctx\.report\)/);
  assert.doesNotMatch(code(generate), /transcript|verbatim|red_flags/);
  assert.doesNotMatch(code(shared), /\.red_flags|\.verbatim|\.transcript/);
});

test('envoi : présentation réservée au type d’organisation, accord validé par le module partagé', () => {
  assert.match(send, /validateSendPayload\(body\)/);
  assert.match(send, /canPresentToManager\(/);
  assert.match(send, /ORG_TYPE_NOT_ALLOWED/);
  assert.match(shared, /kind === 'manager_presentation' && !consent/);
  assert.match(shared, /b\.candidate_consent_confirmed === true/);
});

test('envoi : les refus tombent dans l’ordre, tous avant l’appel au prestataire', () => {
  const order = [
    'validateSendPayload(body)',
    'isCandidateErasedForOrg(',
    'from("suppressed_emails")',
    'from("member_email_accounts")',
    'resolveUnipileCredentials(',
    '/api/v1/emails',
    'from("candidate_notes")',
  ];
  const positions = order.map((needle) => indexOf(send, needle));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'ordre des contrôles');
});

test('envoi : candidat effacé, refus ; registre illisible, refus aussi (échec fermé)', () => {
  assert.match(send, /CANDIDATE_ERASED/);
  assert.match(send, /GdprRegistryUnavailableError/);
  assert.match(send, /GDPR_UNVERIFIED/);
  assert.match(send, /isCandidateErasedForOrg\(adminClient, \{\s*organizationId,\s*linkedinIds: \[payload\.candidate_id\],\s*linkedinUrl: payload\.linkedin_url,/);
});

test('envoi : liste d’exclusion respectée, boîte de la personne qui envoie et de son organisation', () => {
  assert.match(send, /\.from\("suppressed_emails"\)\.select\("email"\)\.eq\("email", payload\.to_email\)/);
  assert.match(send, /EMAIL_SUPPRESSED/);
  assert.match(send, /\.from\("member_email_accounts"\)[\s\S]*\.eq\("organization_id", organizationId\)[\s\S]*\.eq\("user_id", userId\)/);
  assert.match(send, /account_status\.is\.null,account_status\.in\.\(OK,CONNECTED\)/);
  assert.match(send, /NO_MAILBOX/);
});

test('envoi : appel au prestataire borné dans le temps, adresse d’hôte sans double préfixe, corps neutralisé', () => {
  assert.match(send, /function fetchWithTimeout/);
  assert.match(send, /fetchWithTimeout\(`\$\{baseDsn\}\/api\/v1\/emails`/);
  assert.match(send, /creds\.dsn\.startsWith\("http"\) \? creds\.dsn : `https:\/\/\$\{creds\.dsn\}`/);
  assert.match(send, /body: textToHtml\(payload\.body\)/);
  assert.match(send, /account_id: sender\.email_account_id/);
  assert.doesNotMatch(send, /https:\/\/\$\{creds\.dsn\}`\s*[,;]\s*\n.*\n.*https:\/\/\$\{creds\.dsn\}/);
});

test('envoi : une note sur la fiche, jamais de changement d’étape du pipeline', () => {
  assert.match(send, /\.from\("candidate_notes"\)\.insert\(\{[\s\S]*candidate_id: payload\.candidate_id[\s\S]*organization_id: organizationId[\s\S]*created_by: userId/);
  assert.doesNotMatch(send, /job_candidate_status|set_candidate_stage|pipeline_stage|general_stage/);
  // Le message est parti : un échec de la note ne fait pas échouer la réponse.
  assert.match(send, /if \(noteError\) console\.error/);
});

test('messages lus par la personne : aucun mot ni nombre que le navigateur réécrirait', () => {
  // Les déclencheurs de humanizeError (src/lib/invokeEdgeFunction.ts), relus dans le source.
  const front = read('src/lib/invokeEdgeFunction.ts');
  const humanize = front.slice(front.indexOf('function humanizeError'), front.indexOf('async function extractEdgeFunctionError'));
  const triggers = [...humanize.matchAll(/lower\.includes\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(triggers.length >= 10, 'déclencheurs relus');

  const messages = [];
  for (const source of [generate, send, shared]) {
    for (const m of source.matchAll(/(?:error: |fail\(\d+, '[A-Z_]+', )(["'`])((?:\\.|(?!\1).)+)\1/g)) messages.push(m[2]);
  }
  assert.ok(messages.length >= 15, `messages relus : ${messages.length}`);
  for (const message of messages) {
    for (const trigger of triggers) {
      assert.ok(!message.toLowerCase().includes(trigger), `« ${message} » contient « ${trigger} » : le navigateur la réécrirait`);
    }
  }
});

test('messages lus par la personne : aucun nom de prestataire', () => {
  for (const message of [...generate.matchAll(/error: (["'`])((?:\\.|(?!\1).)+)\1/g), ...send.matchAll(/error: (["'`])((?:\\.|(?!\1).)+)\1/g)]) {
    assert.doesNotMatch(message[2], /unipile|anthropic|claude|deepgram|resend|openai|gemini/i);
  }
});

test('crédits : l’action existe dans les deux catalogues, sans nom de prestataire dans son libellé', () => {
  const front = read('src/types/aiCredits.ts');
  const back = read('supabase/functions/_shared/ai-config.ts');
  for (const catalog of [front, back]) {
    const at = indexOf(catalog, 'interview_followup');
    const entry = catalog.slice(at, at + 400);
    assert.match(entry, /label: ["']Message après un entretien["']/);
    assert.match(entry, /routingTier: ["']fast["']/);
  }
});
