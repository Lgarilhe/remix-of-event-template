/**
 * Audit séquences 2026-09-25, lot B5 — événements entrants (webhooks LinkedIn,
 * e-mail, Calendly), comptes d'envoi, outils de l'assistant, RGPD.
 *
 * Invariants épinglés par lecture de source (Deno absent de cette suite), dans
 * le style de tests/ux/lot1-envois.test.mjs. Les décisions pures (première
 * étape, date de première exécution) sont testées sous Deno :
 *   deno test --no-check supabase/functions/_shared/sequence-first-step.test.ts
 *
 * Lancer : node --test tests/ux/seq-audit-b5.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const webhook = read('supabase/functions/unipile-webhook/index.ts');
const accounts = read('supabase/functions/unipile-accounts/index.ts');
const calendly = read('supabase/functions/calendly-webhook/index.ts');
const mutations = read('supabase/functions/_shared/agent-tools-mutations.ts');
const contact = read('supabase/functions/_shared/get-or-fetch-contact.ts');
const erase = read('supabase/functions/rgpd-erase-contact/index.ts');
const purge = read('supabase/functions/rgpd-purge/index.ts');
const scheduled = read('supabase/functions/process-scheduled-actions/index.ts');
const v2 = read('supabase/functions/_shared/unipile-v2.ts');

const sliceBetween = (src, start, end) => {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `repère introuvable : ${start}`);
  const to = src.indexOf(end, from + start.length);
  assert.ok(to > from, `repère de fin introuvable : ${end}`);
  return src.slice(from, to);
};

/** Corps d'une fonction de haut niveau, jusqu'à la suivante. */
const fnBody = (src, signature) => {
  const from = src.indexOf(signature);
  assert.ok(from >= 0, `fonction introuvable : ${signature}`);
  const next = src.slice(from + signature.length).search(/\n(async function|function|const [A-Za-z]+: AgentTool|export )/);
  return next >= 0 ? src.slice(from, from + signature.length + next) : src.slice(from);
};

/** Bloc d'un outil de l'assistant (objet AgentTool). */
const toolBlock = (name) => {
  const from = mutations.indexOf(`  name: '${name}',`);
  assert.ok(from >= 0, `outil introuvable : ${name}`);
  const next = mutations.indexOf(': AgentTool = {', from);
  return mutations.slice(from, next >= 0 ? next : undefined);
};

/** Case du switch de unipile-accounts. */
const caseBlock = (name) => {
  const start = accounts.indexOf(`      case '${name}': {`);
  assert.ok(start >= 0, `case '${name}' introuvable`);
  const next = accounts.indexOf("\n      case '", start + 1);
  return accounts.slice(start, next >= 0 ? next : undefined);
};

const newRelation = fnBody(webhook, 'async function handleNewRelation(');
const newMessage = fnBody(webhook, 'async function handleNewMessage(');
const newMail = fnBody(webhook, 'async function handleNewMail(');
const bounce = fnBody(webhook, 'async function handleBounce(');

// ------------------------------------------------------------------ SEQ-006
test('SEQ-006 — réponse : pipeline mis à jour dans l’organisation de l’inscription seulement, échec fermé', () => {
  const mark = fnBody(webhook, 'async function markCandidateRepliedInPipeline(');
  assert.match(mark, /if \(!organizationId\) \{[\s\S]*?return;/, 'sans organisation : aucune mise à jour');
  assert.match(mark, /\.eq\('candidate_id', candidateId\)\s*\.eq\('organization_id', organizationId\)/);
  // L'ancien repli ajoutait le filtre SEULEMENT si l'organisation était connue.
  assert.doesNotMatch(webhook, /if \([^)]*organization_id\)\s*jcsQuery = jcsQuery\.eq\('organization_id'/);
  assert.match(newMessage, /markCandidateRepliedInPipeline\(supabase, enrollment\.organization_id, enrollment\.profile_id\)/);
  assert.match(newMail, /markCandidateRepliedInPipeline\(supabase, enrollment\.organization_id, enrollment\.profile_id\)/);
});

// ------------------------------------------------------------------ SEQ-008
test('SEQ-008 — Calendly : jamais d’arrêt sans candidat reconnu, toujours dans son organisation', () => {
  const stop = sliceBetween(calendly, "// Arrêt des séquences du candidat", '// Try to update Notion');
  assert.match(stop, /if \(candidateMatch\?\.candidate_id && candidateOrgId\) \{/);
  // Toutes les requêtes d'arrêt sont bornées à l'organisation du candidat.
  const selects = stop.match(/\.from\('sequence_enrollments'\)\s*\.select\(enrollmentColumns\)[\s\S]*?;/g) ?? [];
  assert.equal(selects.length, 2);
  for (const q of selects) assert.match(q, /\.eq\('organization_id', candidateOrgId\)/);
  assert.match(stop, /\.in\('status', \['active', 'paused'\]\)/);
  // URL exacte : jamais de joker après le slug.
  assert.doesNotMatch(calendly, /ilike\('(linkedin_profile_url|profile_url)', `%\$\{slug\}%`\)/);
  assert.match(calendly, /return \[`%linkedin\.com\/in\/\$\{escaped\}`, `%linkedin\.com\/in\/\$\{escaped\}\/`\];/);
  assert.match(stop, /candidates\.length > MAX_ENROLLMENTS_STOPPED_PER_BOOKING/);
  assert.match(calendly, /const MAX_ENROLLMENTS_STOPPED_PER_BOOKING = 5;/);
});

test('SEQ-008 — Calendly : plus de « premier profil venu », session rattachée à l’organisation', () => {
  assert.doesNotMatch(calendly, /\.from\('profiles'\)\s*\.select\('user_id'\)\s*\.limit\(1\)/);
  assert.match(calendly, /status: 422/);
  assert.match(calendly, /created_by: createdBy,\s*organization_id: candidateOrgId,/);
});

// ------------------------------------------------------------------ SEQ-012
test('SEQ-012 — réponse LinkedIn ou e-mail : les inscriptions en pause sont closes aussi', () => {
  assert.match(webhook, /const OPEN_ENROLLMENT_STATUSES = \['active', 'paused'\];/);
  const exact = sliceBetween(newMessage, 'const { rows: exactMatch', 'if (exactError)');
  assert.match(exact, /\.in\('status', OPEN_ENROLLMENT_STATUSES\)/);
  assert.doesNotMatch(exact, /\.eq\('status', 'active'\)/);
  const url = sliceBetween(newMessage, 'const { rows: urlMatch', 'if (urlError)');
  assert.match(url, /\.in\('status', OPEN_ENROLLMENT_STATUSES\)/);
  // Clôture : pause_reason effacée, et seulement si l'inscription était ouverte.
  const close = sliceBetween(newMessage, "status: 'replied',", ".select('id')");
  assert.match(close, /pause_reason: null,/);
  assert.match(close, /\.in\('status', OPEN_ENROLLMENT_STATUSES\)/);
  // La recherche « passée » (notification seule) ne contient plus 'paused'.
  assert.doesNotMatch(newMessage, /\['replied', 'completed', 'paused'\]/);
  // E-mail : même élargissement (repli par adresse).
  assert.match(fnBody(webhook, 'async function findOpenEnrollmentsByEmail('), /statuses: string\[\] = OPEN_ENROLLMENT_STATUSES/);
  assert.match(newMail, /pause_reason: null,/);
});

test('SEQ-012 / SEQ-209 — acceptation : consignée aussi en pause, sans filtre sur connection_status', () => {
  assert.match(newRelation, /\.in\('status', OPEN_ENROLLMENT_STATUSES\)/);
  assert.doesNotMatch(newRelation, /\.in\('connection_status'/);
  assert.match(newRelation, /\.filter\(\(e\) => e\.connection_status !== 'connected'\)/);
  // L'étape d'attente n'est réarmée et last_check_at écrit que pour une inscription active.
  assert.match(newRelation, /const isActive = enrollment\.status === 'active';/);
  assert.match(newRelation, /if \(isActive\) \{[\s\S]*?\.from\('sequence_step_executions'\)/);
  assert.match(newRelation, /\.\.\.\(isActive \? \{ last_check_at:/);
});

// ------------------------------------------------------------------ SEQ-013
test('SEQ-013 — rattachement par compte de rotation : erreur journalisée, seule 22P02 tolérée', () => {
  const find = fnBody(webhook, 'async function findEnrollmentsBySenderAccount');
  assert.doesNotMatch(find, /if \(bySender\.error\) return \{ rows: byAccount\.data \?\? \[\], error: null \};/);
  assert.match(find, /\(bySender\.error as \{ code\?: string \} \| null\)\?\.code === UUID_COLUMN_ERROR/);
  assert.match(find, /console\.warn\(/);
  assert.match(find, /return \{ rows: \[\], error: bySender\.error \};/);
  // Commentaire obsolète retiré de unipile-accounts.
  assert.doesNotMatch(accounts, /Jamais de filtre sur sequence_enrollments\.assigned_sender_id/);
});

// ------------------------------------------------------------------ SEQ-024
test('SEQ-024 — assistant : mettre une séquence en pause met ses candidats en pause', () => {
  const pause = toolBlock('pause_sequence');
  assert.match(
    pause,
    /\.update\(\{ status: 'paused', pause_reason: 'sequence_inactive', updated_at: nowIso \}\)\s*\.eq\('sequence_id', sequenceId\)\s*\.eq\('organization_id', ctx\.organizationId\)\s*\.eq\('status', 'active'\)\s*\.select\('id'\)/,
  );
  assert.match(pause, /if \(pauseError\) \{[\s\S]*?success: false/);
  assert.doesNotMatch(mutations, /le cron skip les enrollments quand is_active=false/);
  assert.doesNotMatch(pause, /'pending'/);
});

test('SEQ-024 — assistant : la reprise vérifie le plan puis passe par resume_enrollments', () => {
  const resume = toolBlock('resume_sequence');
  assert.match(resume, /getSubscriptionGate\(/);
  assert.match(resume, /if \(!gate\.canSendSequences\)/);
  assert.match(resume, /action: 'resume_enrollments'/);
  assert.match(resume, /pause_reasons: SEQUENCE_LEVEL_PAUSE_REASONS/);
  assert.match(mutations, /const SEQUENCE_LEVEL_PAUSE_REASONS = \['sequence_inactive', 'auto_paused'\];/);
  assert.match(resume, /if \(!res\.ok \|\| body\.success !== true\)/, 'jamais de succès sans preuve');
  // Reprise par séquence interrompue par le budget de temps du serveur : le reste est annoncé.
  assert.match(resume, /const remaining = typeof body\.remaining === 'number' && body\.remaining > 0 \? body\.remaining : 0;/);
  assert.match(resume, /if \(remaining > 0\) notes\.push\(/);
  assert.doesNotMatch(resume, /'pending'/);
});

// ------------------------------------------------------------------ SEQ-031
test('SEQ-031 — assistant : « attendre une réponse » attend vraiment, avec un délai', () => {
  const create = toolBlock('create_sequence');
  assert.match(create, /wait_for_event: 'reply_received', timeout_days:/);
  assert.match(mutations, /const WAIT_REPLY_DEFAULT_TIMEOUT_DAYS = 3;/);
});

// ------------------------------------------------------------------ SEQ-039
test('SEQ-039 — réponse e-mail : rattachée par le message d’origine, puis par l’organisation de la boîte', () => {
  // Normalisation partagée avec sequence-webhooks-handler (règle de B4,
  // exécutée dans tests/ux/seq-audit-b4.test.mjs) : plus de copie locale.
  assert.match(webhook, /import \{ inReplyToCandidates \} from "\.\.\/_shared\/sequence-email-policy\.mjs";/);
  assert.match(newMail, /const repliedToIds = inReplyToCandidates\(payload\.in_reply_to\);/);
  assert.doesNotMatch(webhook, /function inReplyToMessageIds\(/);
  assert.match(newMail, /\.from\('sequence_email_tracking'\)\s*\.select\('execution_id'\)\s*\.in\('email_message_id', repliedToIds\)/);
  assert.match(newMail, /resolveMailboxOrganizations\(supabase, account_id\)/);
  const byEmail = fnBody(webhook, 'async function findOpenEnrollmentsByEmail(');
  assert.match(byEmail, /\.in\('organization_id', mailboxOrgs\)/);
  assert.match(fnBody(webhook, 'async function resolveMailboxOrganizations('), /\.from\('member_email_accounts'\)/);
});

// ------------------------------------------------------------------ SEQ-040
test('SEQ-040 — erreurs de lecture ou d’écriture : levées pour un rejeu, plus avalées avec un 200', () => {
  assert.doesNotMatch(webhook, /if \(enrollError\) \{\s*console\.error\([^)]*\);\s*return;/);
  assert.doesNotMatch(webhook, /if \(enrErr\) \{\s*console\.error\([^)]*\);\s*return;/);
  assert.match(newRelation, /if \(enrollError\) throw enrollError;/);
  assert.match(newMessage, /if \(exactError\) throw exactError;/);
  assert.match(newMessage, /if \(urlError\) throw urlError;/);
  for (const [name, body] of [['new_relation', newRelation], ['new_message', newMessage], ['mail', newMail], ['bounce', bounce]]) {
    assert.match(body, /if \(failures\.length > 0\) \{[\s\S]*?throw failures\[0\];/, `${name} : échec d'écriture non remonté`);
  }
  // Vérification de l'expéditeur impossible : levée (rejeu), pas abandon.
  assert.match(newMessage, /verificationUnavailable = new Error\(`attendee verification unavailable/);
  assert.match(newMessage, /if \(verificationUnavailable\) \{[\s\S]*?throw /);
});

// ------------------------------------------------------------------ SEQ-041
test('SEQ-041 — changement de compte : l’ancien compte cesse d’envoyer avant le repointage', () => {
  const claim = caseBlock('claim_linkedin_account');
  const stopAt = claim.indexOf('stopLinkedInAccountSending(adminClient, { organizationId, accountId: previousAccountId })');
  assert.ok(stopAt > 0, 'arrêt de l\'ancien compte absent');
  assert.ok(stopAt < claim.indexOf(".upsert({"), 'arrêt après le repointage');
  assert.match(claim, /if \(previousAccountId && previousAccountId !== accountId\)/);
  assert.match(claim, /catch \(stopError\) \{[\s\S]*?throw new HttpError\(500,/);
  const hosted = sliceBetween(webhook, "case 'account_connected': {", "case 'account_status_updated':");
  const hostedStop = hosted.indexOf('await stopLinkedInAccountSending(supabase, {');
  assert.ok(hostedStop > 0 && hostedStop < hosted.indexOf(".from('member_linkedin_accounts')\n                .upsert("));
});

// ------------------------------------------------------------------ SEQ-042
test('SEQ-042 — retrait d’un membre : action serveur qui arrête ses envois puis retire sa liaison', () => {
  const stop = caseBlock('stop_member_linkedin');
  assert.match(stop, /callerRole !== 'owner' && callerRole !== 'admin'/);
  assert.match(stop, /\.eq\('organization_id', organizationId\)\s*\.eq\('user_id', memberUserId\)/);
  const helperAt = stop.indexOf('stopLinkedInAccountSending(adminClient');
  assert.ok(helperAt > 0 && helperAt < stop.indexOf('.delete()'), 'liaison retirée avant l\'arrêt');
  assert.match(stop, /paused_enrollments: pausedTotal,\s*relabeled_enrollments: relabeledTotal,\s*cancelled_inmails: cancelledInmailsTotal,/);
});

// ------------------------------------------------------------------ SEQ-043
test('SEQ-043 — assistant : inscription depuis le compte relié de l’utilisateur, affiché avant validation', () => {
  const enroll = toolBlock('enroll_in_sequence');
  assert.match(enroll, /required: \['sequence_id', 'candidate_id', 'job_id'\]/);
  const verify = sliceBetween(enroll, 'async verifyAccess(', 'async dryRun(');
  assert.match(verify, /const sending = await resolveSendingAccount\(params, ctx\);/);
  assert.match(verify, /if \(sending\.account_status !== 'OK'\)/);
  const dry = sliceBetween(enroll, 'async dryRun(', 'async execute(');
  assert.match(dry, /envoi depuis votre compte LinkedIn/);
  assert.match(dry, /sending_account:/);
  const exec = enroll.slice(enroll.indexOf('async execute('));
  assert.match(exec, /account_id: sending\.account_id,/);
  assert.doesNotMatch(exec, /account_id: String\(params\.account_id\)/);
  const resolve = fnBody(mutations, 'async function resolveSendingAccount(');
  assert.match(resolve, /\.eq\('user_id', ctx\.userId\)\s*\.eq\('organization_id', ctx\.organizationId\)/);
});

// ------------------------------------------------------------------ SEQ-044
test('SEQ-044 — assistant : la première étape est planifiée à l’inscription, sinon l’inscription est annulée', () => {
  const exec = toolBlock('enroll_in_sequence').split('async execute(')[1];
  assert.match(exec, /pickFirstRootStep\(/);
  assert.match(exec, /firstExecutionTime\(/);
  const insert = sliceBetween(exec, ".from('sequence_step_executions')", 'if (execError)');
  assert.match(insert, /status: 'scheduled',/);
  assert.match(insert, /organization_id: ctx\.organizationId,/);
  assert.match(exec, /if \(execError\) \{[\s\S]*?\.from\('sequence_enrollments'\)\s*\.delete\(\)[\s\S]*?success: false/);
  assert.match(exec, /status: 'active',\s*user_timezone: userTimezone,/);
  assert.match(toolBlock('create_sequence'), /step_order: i,/);
  assert.doesNotMatch(toolBlock('create_sequence'), /step_order: i \+ 1,/);
});

// ------------------------------------------------------------------ SEQ-046 / SEQ-128
test('SEQ-046 / SEQ-128 — anti-doublon de l’assistant : autres identifiants, inscriptions vivantes sans limite de date', () => {
  const find = fnBody(mutations, 'async function findRecentOrgContact(');
  assert.match(find, /`resolved_profile_id\.in\.\(\$\{list\}\)`/);
  assert.match(find, /profile_url\.ilike\.\*\/in\/\$\{slug\}\*/);
  assert.match(find, /\.in\('status', LIVE_CONTACT_STATUSES\)\s*\.or\(identityFilter\)/);
  assert.match(mutations, /const LIVE_CONTACT_STATUSES = \['active', 'paused'\];/);
  // La fenêtre de 90 jours ne s'applique qu'aux inscriptions closes.
  const live = sliceBetween(find, ".in('status', LIVE_CONTACT_STATUSES)", '.limit(20)');
  assert.doesNotMatch(live, /created_at', since/);
});

// ------------------------------------------------------------------ SEQ-125
test('SEQ-125 — anti-doublon de l’assistant : un InMail groupé récent compte comme un contact', () => {
  const find = fnBody(mutations, 'async function findRecentOrgContact(');
  assert.match(mutations, /const INMAIL_CONTACT_STATUSES = \['scheduled', 'sending', 'sent'\];/);
  const inmail = sliceBetween(find, ".from('inmail_queue')", '.limit(20)');
  assert.match(inmail, /\.select\('recipient_profile_id, created_by, created_at, status'\)/);
  assert.match(inmail, /\.eq\('organization_id', ctx\.organizationId\)/);
  assert.match(inmail, /\.gte\('created_at', since\)/);
  assert.match(inmail, /\.in\('status', INMAIL_CONTACT_STATUSES\)/);
  assert.match(inmail, /\.in\('recipient_profile_id', Array\.from\(queryValues\)\)/);
  // Lecture en échec : l'inscription est refusée (verifyAccess), jamais un faux « aucun contact ».
  assert.match(find, /const error = live\.error \?\? recentClosed\.error \?\? inmails\.error;/);
  // Rapprochement exact de recipient_profile_id, puis le plus récent toutes sources confondues.
  assert.match(find, /\.filter\(\(row\) => matchesKey\(row\.recipient_profile_id\)\)/);
  assert.match(find, /sequence_id: null,\s*source: 'inmail' as const,/);
  assert.match(find, /contacts\.sort\(/);
  // Pas de lecture de séquence pour un InMail ; libellé « par InMail ».
  assert.match(find, /match\.sequence_id\s*\?\s*ctx\.adminClient\.from\('outreach_sequences'\)/);
  assert.match(fnBody(mutations, 'function formatRecentContact('), /recent\.source === 'inmail' \? ' par InMail' : ''/);
  // Un InMail ne se confond pas avec « déjà inscrit dans cette séquence ».
  assert.match(mutations, /sequenceId: string \| null;/);
});

// ------------------------------------------------------------------ SEQ-054
test('SEQ-054 — effacement RGPD : séquences arrêtées, étapes et InMails annulés, adresse supprimée, données effacées', () => {
  const rec = fnBody(contact, 'export async function recordGdprErasure(');
  assert.match(rec, /\.update\(\{ status: 'stopped', pause_reason: null, completed_at: nowIso, updated_at: nowIso \}\)[\s\S]*?\.in\('status', \['active', 'paused'\]\)/);
  assert.match(rec, /\.in\('status', PENDING_EXECUTION_STATUSES\)/);
  assert.match(contact, /const PENDING_EXECUTION_STATUSES = \['scheduled', 'waiting_event', 'quota_blocked'\];/);
  assert.match(rec, /\.from\('inmail_queue'\)[\s\S]*?\.in\('status', \['pending', 'scheduled'\]\)/);
  assert.match(rec, /\.from\('suppressed_emails'\)\s*\.upsert\(\{ email: emailNorm, reason: 'unsubscribe' \}/);
  assert.match(rec, /profile_name: null, profile_headline: null, email_used: null, phone_used: null/);
  assert.match(rec, /final_message: null/);
  // Toute erreur fait échouer l'effacement (jamais de succès sans preuve).
  assert.match(rec, /if \(error\) return fail\('arrêt des inscriptions', error\);/);
  assert.ok(rec.lastIndexOf('return { ...result, success: true };') > rec.indexOf(".from('suppressed_emails')"));
});

// ------------------------------------------------------------------ SEQ-055
test('SEQ-055 — effacement RGPD : propriétaire ou administrateur, limité à son organisation', () => {
  assert.match(erase, /membership\?\.role !== "owner" && membership\?\.role !== "admin"/);
  assert.match(erase, /isPlatformAdmin\(auth\.userId\)/);
  assert.match(erase, /organizationId: scopeOrgId,/);
  const rec = fnBody(contact, 'export async function recordGdprErasure(');
  // Blocage global (gdpr_erasures) réservé à l'effacement plateforme.
  assert.match(rec, /if \(orgId === null\) \{[\s\S]*?\.from\('gdpr_erasures'\)/);
  // Enrichissements supprimés dans le périmètre.
  const dels = rec.match(/\.from\('candidate_enrichments'\)\.delete\(\)[^;]*;\s*if \(orgId\) del = del\.eq\('organization_id', orgId\);/g) ?? [];
  assert.equal(dels.length, 2);
  assert.doesNotMatch(contact, /await supabase\.from\('candidate_enrichments'\)\.delete\(\)\.eq\('linkedin_url', urlNorm\);/);
});

// ------------------------------------------------------------------ SEQ-066
test('SEQ-066 — assistant : adresse et téléphone connus renseignés à l’inscription', () => {
  const exec = toolBlock('enroll_in_sequence').split('async execute(')[1];
  assert.match(exec, /getOrFetchContact\(ctx\.adminClient, \{/);
  assert.match(exec, /email_used: emailUsed,\s*phone_used: phoneUsed,/);
  assert.match(exec, /emailUsed = contact\.email \? contact\.email\.trim\(\)\.toLowerCase\(\) : null;/);
  // Adresse déclarée non délivrable jamais reprise.
  assert.match(contact, /cached\.contact_email_status !== 'undeliverable'/);
});

// ------------------------------------------------------------------ medium / low
test('SEQ-107 / SEQ-115 — rebond : exécution e-mail marquée, recruteur prévenu', () => {
  assert.match(bounce, /await markLastEmailExecutionBounced\(supabase, enr\.id\);/);
  assert.match(bounce, /title: 'Adresse e-mail invalide, séquence arrêtée'/);
  assert.match(newMail, /type: 'new_message',/);
  assert.match(newMail, /link: projectId \? `\/missions\/\$\{projectId\}\?tab=outreach` : '\/missions'/);
  assert.match(calendly, /title: 'RDV pris, séquence arrêtée'/);
});

test('SEQ-111 — InMails « répondu » : seulement ceux du compte qui reçoit la réponse', () => {
  const inmail = sliceBetween(newMessage, "const { data: exactInmailMatch", '// ── Create notification');
  const reads = inmail.match(/\.from\('inmail_queue'\)\s*\.select\([^)]*\)\s*\.eq\('account_id', account_id\)/g) ?? [];
  assert.equal(reads.length, 2);
});

test('SEQ-112 — Calendly : statut « completed » admis, exécutions annulées seulement si l’inscription a changé', () => {
  assert.doesNotMatch(calendly, /status: 'booked'/);
  assert.match(calendly, /status: 'completed',[\s\S]*?completion_reason: 'meeting_booked'/);
  assert.match(calendly, /if \(!changed \|\| changed\.length === 0\) continue;[\s\S]*?\.in\('status', PENDING_EXECUTION_STATUSES\)/);
});

test('SEQ-113 — réponses automatiques reconnues (Outlook anglais, allemand, en-têtes)', () => {
  const auto = fnBody(webhook, 'function isAutoReplyMail(');
  assert.match(webhook, /'automatic reply'/);
  assert.match(webhook, /'automatische antwort'/);
  assert.match(webhook, /'do-not-reply@', 'donotreply@', 'mailer@'/);
  assert.match(auto, /readMailHeader\(payload, 'auto-submitted'\)/);
  assert.match(auto, /readMailHeader\(payload, 'x-autoreply'\)/);
});

test('SEQ-114 — actions programmées : budget de 40 s et réservations interrompues closes', () => {
  assert.match(scheduled, /const TIME_BUDGET_MS = 40_000;/);
  assert.match(scheduled, /Délai dépassé : l'action a pu partir, vérifiez avant de relancer/);
  assert.match(scheduled, /\.eq\('status', 'approved'\)\s*\.not\('executed_at', 'is', null\)\s*\.lt\('executed_at', cutoffIso\)/);
});

test('SEQ-116 — purge RGPD : inscriptions closes et InMails terminés, jamais les vivants', () => {
  assert.match(purge, /const CLOSED_ENROLLMENT_STATUSES = \["replied", "completed", "bounced", "cancelled", "stopped"\];/);
  assert.doesNotMatch(sliceBetween(purge, 'const CLOSED_ENROLLMENT_STATUSES', '// ── Summary'), /"active"|"paused"|"pending"|"scheduled"/);
});

test('SEQ-190 / SEQ-191 — garde de statut : réarmement et clôture conditionnés', () => {
  assert.match(newRelation, /\.update\(\{ status: 'scheduled', scheduled_at: new Date\(\)\.toISOString\(\) \}\)\s*\.eq\('id', waitStep\.id\)\s*\.in\('status', \['waiting_event', 'scheduled'\]\)/);
  assert.match(newMessage, /if \(!changed \|\| changed\.length === 0\) continue;\s*closedEnrollments\.push\(enrollment\);/);
});

test('SEQ-208 / SEQ-210 / SEQ-211 / SEQ-212 / SEQ-213', () => {
  assert.match(webhook, /\.filter\(\(row\) => row\.account_status === 'OK'\)/);
  assert.doesNotMatch(v2, /"email\.new\.bounce"|"tracking\.open"|"tracking\.click"/);
  assert.doesNotMatch(webhook, /pipeline_stage: 'Pré-qualif'/);
  assert.match(newMail, /closeSiblingEnrollments\(/);
  assert.match(newMessage, /closeSiblingEnrollments\(/);
  assert.match(calendly, /if \(!timingSafeEqual\(expectedSignature, signature\)\)/);
  assert.match(scheduled, /timingSafeEqual\(token, serviceRoleKey\) \|\| \(cronSecret !== '' && timingSafeEqual\(token, cronSecret\)\)/);
});
