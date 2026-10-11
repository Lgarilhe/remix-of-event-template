/**
 * Correctifs des envois (PR des correctifs séquences) : garde-fous statiques.
 *
 *   1. Une séance lue dans un agenda relié (qualification_sessions.source =
 *      'agenda') n'arrête jamais une séquence : la condition « rendez-vous
 *      pris » du moteur l'exclut (plan agenda, docs/refonte-mission/
 *      agenda-outlook-construction-2026-10-05.md, « Effets sur le candidat »).
 *   2. Correctif 4 du plan du lot 5 : unipile-search send_message refuse
 *      l'envoi à un candidat effacé (RGPD), registre illisible compris (échec
 *      fermé), pour tout appelant, avant le plafond LinkedIn, le marqueur et le
 *      POST au prestataire. Avant : seule l'écriture était sautée, le message
 *      partait.
 *
 * Lecture du source et assertions sur les motifs, sans Deno, base ni réseau.
 * Le comportement est prouvé contre la stack locale par
 * e2e/api/seq-correctifs-envois.spec.ts.
 *
 * Lancer : node --test tests/c1/correctifs-envois.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre (ex. une extraction de HEAD) : c'est
 * ainsi qu'on vérifie que ces tests échouent sur le code d'origine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const ENGINE = 'supabase/functions/process-sequences/index.ts';
const SEARCH = 'supabase/functions/unipile-search/index.ts';

// Le code sans ses commentaires : un commentaire peut nommer ce que le code s'interdit.
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Corps d'une fonction de premier niveau, jusqu'à la déclaration suivante.
function topLevelBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `${signature} introuvable`);
  const next = src.slice(start + signature.length).search(/\n(async function|function|interface|const [A-Za-z_]+ = |export )/);
  return next >= 0 ? src.slice(start, start + signature.length + next) : src.slice(start);
}

test('agenda : la condition « rendez-vous pris » du moteur ignore les séances lues dans un agenda', () => {
  const engine = code(read(ENGINE));
  // Une seule lecture des séances dans le moteur : celle de la condition d'arrêt.
  assert.equal((engine.match(/from\('qualification_sessions'\)/g) ?? []).length, 1, 'une seule lecture de qualification_sessions');
  const start = engine.indexOf('if (!shouldStop && stopCond.on_meeting_booked) {');
  const end = engine.indexOf("stopReason = 'Stop condition: meeting booked (Calendly)'", start);
  assert.ok(start > 0 && end > start, 'condition « rendez-vous pris » introuvable, ou motif d\'arrêt modifié');
  const block = engine.slice(start, end);
  // La base de toutes les lectures (adresse, profil, URL) exclut la source agenda.
  assert.match(block, /const meetingBase = \(columns = 'id', limit = 1\) => \{\s*let q = supabase\.from\('qualification_sessions'\)\.select\(columns\)\.neq\('source', 'agenda'\)/);
  assert.equal((block.match(/from\('qualification_sessions'\)/g) ?? []).length, 1, 'toute lecture passe par meetingBase');
  for (const lookup of ["meetingBase().eq('invitee_email'", "meetingBase().eq('candidate_profile_id'", "meetingBase('id, candidate_linkedin_url', 50)"]) {
    assert.ok(block.includes(lookup), `${lookup} passe par meetingBase`);
  }
});

test('correctif 4 : send_message refuse un candidat effacé avant le plafond, le marqueur et le POST', () => {
  const search = code(read(SEARCH));
  const handler = search.slice(search.indexOf('Deno.serve(async (req) => {'));
  const check = handler.indexOf("const sendRecipient = action === 'send_message'\n      ? await checkSendRecipient(");
  const gate = handler.indexOf('const gate = await enforceLinkedInAction(');
  const dispatch = handler.indexOf("case 'send_message': {");
  assert.ok(check > 0, 'contrôle du destinataire appelé pour send_message seulement');
  assert.ok(gate > check, 'contrôle avant le plafond LinkedIn : aucune place prise par un envoi refusé');
  assert.ok(dispatch > gate, 'contrôle avant l\'envoi');
  assert.match(handler.slice(dispatch), /return await handleSendMessage\([\s\S]*?\}, sendRecipient\);/);
  // Un refus (UnipileInputError) est rendu avec son statut et son code.
  assert.match(handler, /if \(error instanceof UnipileInputError\) \{\s*return new Response\(\s*JSON\.stringify\(\{ success: false, error: error\.message, \.\.\.\(error\.code \? \{ error_code: error\.code \} : \{\}\) \}\),\s*\{ status: error\.status,/);

  const body = topLevelBody(search, 'async function checkSendRecipient(');
  // Avec chat_id, le message part dans la conversation (recipient_id ignoré au
  // routage) : le destinataire contrôlé est son participant, même si
  // recipient_id est fourni, sinon un recipient_id choisi contourne le refus.
  // chat_id lu comme l'envoi le lit (unipileId), sinon un chat_id encodé que
  // l'envoi décode échappe au contrôle.
  assert.ok(body.includes("const chatId = params.chat_id ? decodeURIComponent(unipileId(params.chat_id, 'chat_id')) : null;"), 'chat_id lu par unipileId, comme à l\'envoi');
  assert.match(topLevelBody(search, 'async function handleSendMessage('), /if \(chat_id\) \{\s*url = `\$\{baseUrl\}\/chats\/\$\{unipileId\(chat_id, 'chat_id'\)\}\/messages`;/);
  assert.match(body, /if \(chatId\) \{\s*candidate = \(await linkedChatCandidate\(admin, organizationId, accountId, chatId\)\)\s*\?\? \(await fetchChatCandidate\(baseUrl, apiKey, chatId\)\)\s*\?\? candidate;\s*\}/);
  assert.doesNotMatch(body, /candidate\.ids\.length === 0 && chatId/, 'la conversation n\'est plus lue seulement sans recipient_id');
  const erasedAt = body.indexOf('erased = await isCandidateErasedForOrg(');
  assert.ok(erasedAt > 0, 'effacement lu par l\'aide partagée (marqueur de l\'organisation et registre)');
  // Registre ou lecture illisible : refus (échec fermé), jamais « non effacé ».
  assert.match(body, /\} catch \(e\) \{[^}]*throw new UnipileInputError\(SEND_GDPR_UNVERIFIED_MESSAGE, 503, 'GDPR_UNVERIFIED'\);\s*\}/);
  assert.match(body, /if \(erased\) \{[^}]*throw new UnipileInputError\(SEND_ERASED_MESSAGE, 403, 'CANDIDATE_ERASED'\);\s*\}/);
  assert.doesNotMatch(body.slice(erasedAt), /return null;/, 'aucun passage silencieux après la lecture de l\'effacement');
  assert.doesNotMatch(body, /method: 'POST'|recordOutbound\(/, 'ni envoi ni marqueur dans le contrôle');

  // L'envoi : marqueur puis POST, à partir du destinataire déjà contrôlé.
  const send = topLevelBody(search, 'async function handleSendMessage(');
  assert.match(send, /recipient: SendRecipient \| null,\s*\): Promise<Response> \{/);
  const marker = send.indexOf('const manualSend = await prepareManualSend(accountId, params, ctx, recipient);');
  const post = send.indexOf("const response = await fetchWithTimeout(url, {\n    method: 'POST',");
  assert.ok(marker > 0 && post > marker, 'marqueur avant le POST');
  const prepare = topLevelBody(search, 'async function prepareManualSend(');
  assert.match(prepare, /if \(!recipient\) return null;/);
  assert.doesNotMatch(prepare, /isCandidateErasedForOrg/, 'plus de saut silencieux de l\'écriture pour un candidat effacé');
});

test('correctif 4 : messages de refus lisibles après humanizeError (français, sans nombre ni mot anglais)', () => {
  const search = read(SEARCH);
  for (const name of ['SEND_ERASED_MESSAGE', 'SEND_GDPR_UNVERIFIED_MESSAGE']) {
    const m = search.match(new RegExp(`const ${name} =\\s*"([^"]+)";`));
    assert.ok(m, `${name} introuvable`);
    const text = m[1];
    assert.ok(text.length <= 200, `${name} : 200 caractères au plus`);
    assert.doesNotMatch(text, /\d/, `${name} : aucun nombre`);
    assert.doesNotMatch(text, /forbidden|not found|unauthorized|internal|timeout|error|rate limit|jwt|signal|aborted/i, `${name} : aucun mot réécrit`);
    assert.doesNotMatch(text, /unipile|linkedin/i, `${name} : aucun nom de prestataire`);
  }
});
