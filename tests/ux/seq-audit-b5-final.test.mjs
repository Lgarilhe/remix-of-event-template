/**
 * Audit séquences 2026-09-25, lot B5, vague finale (relecture contradictoire
 * et décisions D1, D2, D4, D5 du contrat des lots, §7), puis dernière passe
 * (D3 appliquée par l'assistant, contrat §8).
 *
 * Invariants épinglés par lecture de source, dans le style de
 * tests/ux/seq-audit-b5.test.mjs (Deno absent de cette suite). Chaque test
 * échoue sur le code d'avant la vague.
 *
 * Lancer : node --test tests/ux/seq-audit-b5-final.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const webhook = read('supabase/functions/unipile-webhook/index.ts');
const accounts = read('supabase/functions/unipile-accounts/index.ts');
const calendly = read('supabase/functions/calendly-webhook/index.ts');
const stripe = read('supabase/functions/stripe-webhook/index.ts');
const mutations = read('supabase/functions/_shared/agent-tools-mutations.ts');
const contact = read('supabase/functions/_shared/get-or-fetch-contact.ts');

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
  const next = src.slice(from + signature.length).search(/\n(async function|function|const [A-Za-z]+: AgentTool|export |\/\*\* Relit)/);
  return next >= 0 ? src.slice(from, from + signature.length + next) : src.slice(from);
};

/** Bloc d'un outil de l'assistant (objet AgentTool). */
const toolBlock = (name) => {
  const from = mutations.indexOf(`  name: '${name}',`);
  assert.ok(from >= 0, `outil introuvable : ${name}`);
  const next = mutations.indexOf(': AgentTool = {', from);
  return mutations.slice(from, next >= 0 ? next : undefined);
};

// ------------------------------------------------------------ point 1 (D4)
test('D4 — Calendly : organisation du rendez-vous unique parmi les organisations reliées à Calendly, sinon rien', () => {
  const lookup = sliceBetween(calendly, 'if (candidateSlug) {', '// Get job title if we have a match');
  // Plus de « ligne la plus récente, toutes organisations confondues ».
  assert.doesNotMatch(lookup, /\.limit\(1\)/, 'lecture bornée à une ligne : organisation choisie au plus récent');
  assert.doesNotMatch(lookup, /candidateMatch = matches\[0\]/);
  // Organisations reliées à Calendly parmi celles qui suivent le profil.
  assert.match(lookup, /\.from\('organization_integrations'\)\s*\.select\('organization_id'\)\s*\.in\('organization_id', trackingOrgIds\)\s*\.eq\('calendly_connected', true\)/);
  // Zéro ou plusieurs : réponse sans rien écrire, avant toute session.
  assert.match(lookup, /if \(calendlyOrgIds\.length !== 1\) \{[\s\S]*?return new Response\(JSON\.stringify\(\{[\s\S]*?reason: 'ambiguous_org'/);
  assert.ok(calendly.indexOf("reason: 'ambiguous_org'") < calendly.indexOf(".from('qualification_sessions')\n      .insert("));
  assert.ok(calendly.indexOf("reason: 'ambiguous_org'") < calendly.indexOf("title: 'RDV pris, séquence arrêtée'"));
  // Le candidat retenu appartient à cette organisation.
  assert.match(lookup, /const orgMatches = matches\.filter\(\(m\) => m\.organization_id === bookingOrgId\);/);
  assert.match(lookup, /candidateMatch = orgMatches\[0\] \?\? null;/);
});

// Retrait de Notion, étape 2 (décision 16) : le rendez-vous n'écrit plus rien
// dans Notion, ni ne lit la configuration Notion de l'organisation.
test('D4 — Calendly : plus aucune écriture Notion', () => {
  assert.doesNotMatch(calendly, /\/\/ Try to update Notion|notionKey|api\.notion\.com/);
  assert.doesNotMatch(calendly, /notion_(api_key|connected|candidats_db_id|shortlist_db_id|candidate_id|shortlist_id)/);
  assert.doesNotMatch(calendly, /active_organization_id/);
});

// ------------------------------------------------------- points 2 et 3 (D1)
test('D1 — reconnexion LinkedIn : jamais de réactivation dans une séquence désactivée', () => {
  const resume = fnBody(webhook, 'async function resumeEnrollmentsAfterReconnect(');
  // Lecture avec la séquence, puis écritures par id.
  assert.match(resume, /\.select\('id, sequence:outreach_sequences\(is_active\)'\)\s*\.eq\(column, accountId\)\s*\.eq\('status', 'paused'\)\s*\.eq\('pause_reason', ACCOUNT_DISCONNECTED_PAUSE_REASON\)/);
  assert.match(resume, /if \(seq\?\.is_active === true\) activeSequenceIds\.add\(row\.id\);\s*else inactiveSequenceIds\.add\(row\.id\);/);
  // L'ancien update global par compte a disparu.
  assert.doesNotMatch(resume, /\.update\(\{ status: 'active'[^}]*\}\)\s*\.eq\(column, accountId\)/);
  assert.match(resume, /\.update\(\{ status: 'active', pause_reason: null, updated_at: nowIso \}\)\s*\.in\('id', activeIds\.slice\(i, i \+ 100\)\)\s*\.eq\('status', 'paused'\)\s*\.eq\('pause_reason', ACCOUNT_DISCONNECTED_PAUSE_REASON\)/);
  // Séquence désactivée : raison sequence_inactive, rien d'autre.
  assert.match(resume, /\.update\(\{ pause_reason: 'sequence_inactive', updated_at: nowIso \}\)\s*\.in\('id', inactiveIds\.slice\(i, i \+ 100\)\)\s*\.eq\('status', 'paused'\)\s*\.eq\('pause_reason', ACCOUNT_DISCONNECTED_PAUSE_REASON\)/);
  // Réarmement réservé aux inscriptions reprises, jamais avant la date prévue.
  assert.match(resume, /for \(const enrollmentId of resumedIds\)/);
  assert.match(resume, /scheduled_at: resumeDate\(cancelled\.scheduled_at, nowMs\)/);
  assert.doesNotMatch(resume, /scheduled_at: nowIso/);
});

test('D1 — souscription : jamais de réactivation dans une séquence désactivée', () => {
  const resume = fnBody(stripe, 'async function resumeSubscriptionPausedEnrollments(');
  assert.match(resume, /\.select\("id, sequence:outreach_sequences\(is_active\)"\)\s*\.eq\("organization_id", orgId\)\s*\.eq\("status", "paused"\)\s*\.eq\("pause_reason", "subscription_required"\)/);
  assert.match(resume, /if \(seq\?\.is_active === true\) activeIds\.push\(row\.id\);\s*else inactiveIds\.push\(row\.id\);/);
  // L'ancien update de toute l'organisation a disparu.
  assert.doesNotMatch(resume, /\.update\(\{ status: "active"[^}]*\}\)\s*\.eq\("organization_id", orgId\)/);
  assert.match(resume, /\.update\(\{ status: "active", pause_reason: null, updated_at: nowIso \}\)\s*\.in\("id", activeIds\.slice\(i, i \+ 100\)\)/);
  assert.match(resume, /\.update\(\{ pause_reason: "sequence_inactive", updated_at: nowIso \}\)\s*\.in\("id", inactiveIds\.slice\(i, i \+ 100\)\)[\s\S]*?\.eq\("status", "paused"\)\s*\.eq\("pause_reason", "subscription_required"\)/);
  assert.match(resume, /for \(const enrollmentId of resumed\)/);
  assert.doesNotMatch(resume, /scheduled_at: nowIso/);
});

// ------------------------------------------------------------------ point 4
test('hosted_auth : propriété du nouveau compte contrôlée avant l’arrêt de l’ancien', () => {
  const hosted = sliceBetween(webhook, "case 'account_connected': {", "case 'account_status_updated':");
  const ownersAt = hosted.indexOf(".from('member_linkedin_accounts')\n                .select('organization_id, user_id')\n                .eq('linkedin_account_id', payload.account_id);");
  const stopAt = hosted.indexOf('await stopLinkedInAccountSending(supabase, {');
  assert.ok(ownersAt > 0, 'contrôle de propriété absent');
  assert.ok(ownersAt < stopAt, 'arrêt de l’ancien compte avant le contrôle de propriété');
  assert.match(hosted, /r\.organization_id !== hostedState\.organizationId\)\) \{\s*throw Object\.assign\(new Error\([^)]*\), \{ code: '42501' \}\);/);
  assert.match(hosted, /r\.user_id !== hostedState\.userId\)\) \{\s*throw Object\.assign\(new Error\([^)]*\), \{ code: '23505' \}\);/);
  // Nouveau compte : montée en charge repartie de zéro, comme claim_linkedin_account.
  assert.match(hosted, /\.\.\.\(accountChanged \? \{ linked_at: nowIso \} : \{\}\),/);
});

// ------------------------------------------------------------------ point 5
test('assistant : inscription refusée sans offre qui permet l’envoi de séquences', () => {
  const verify = sliceBetween(toolBlock('enroll_in_sequence'), 'async verifyAccess(', 'async dryRun(');
  assert.match(verify, /const gate = await getSubscriptionGate\(ctx\.adminClient as unknown as GateClient, ctx\.organizationId\);/);
  assert.match(verify, /if \(!gate\.canSendSequences\) \{[\s\S]*?allowed: false,/);
  // Échec fermé si le plan ne peut pas être lu.
  assert.match(verify, /\} catch \{\s*return \{ allowed: false, reason: "Votre abonnement n'a pas pu être vérifié\./);
});

// ------------------------------------------------------------ point 6 (D2)
test('D2 — create_sequence : plus d’étape e-mail ni WhatsApp proposée', () => {
  // Lot 5e : la forme est celle de la rédaction commune (sequence-draft.ts),
  // dont les types d'étape ne comptent ni e-mail ni WhatsApp.
  const draft = read('supabase/functions/_shared/sequence-draft.ts');
  const types = sliceBetween(draft, "actionType: 'profile_visit'", ';');
  assert.doesNotMatch(types, /email|whatsapp/);
  assert.doesNotMatch(mutations, /const SEQ_STEP_TYPES/);
  const tool = toolBlock('create_sequence');
  const description = sliceBetween(tool, 'description:', 'category:');
  assert.doesNotMatch(description, /\|email\||emails \//);
  assert.match(description, /Email and WhatsApp steps are not available yet/);
});

// ------------------------------------------------------------------ point 7
test('assistant : compte déconnecté annoncé au vouvoiement, sans identifiant technique', () => {
  const verify = sliceBetween(toolBlock('send_linkedin_message'), 'async verifyAccess(', 'async dryRun(');
  assert.doesNotMatch(verify, /Reconnecte-le/);
  assert.doesNotMatch(verify, /Compte LinkedIn \$\{resolved\.account_id\}/);
  assert.match(verify, /Votre compte LinkedIn est déconnecté : reconnectez-le dans Paramètres > Mon compte avant d'envoyer\./);
});

// ------------------------------------------------------------------ point 8
test('RGPD : une seule ligne de registre par couple d’empreintes, même après une relance', () => {
  const rec = fnBody(contact, 'export async function recordGdprErasure(');
  const registry = sliceBetween(rec, 'if (orgId === null) {', '// 2. Inscriptions du candidat');
  const checkAt = registry.indexOf(".from('gdpr_erasures').select('id')");
  const insertAt = registry.indexOf('.insert({');
  assert.ok(checkAt > 0 && checkAt < insertAt, 'insertion sans contrôle d’existence');
  assert.match(registry, /existingQuery = emailHash \? existingQuery\.eq\('email_hash', emailHash\) : existingQuery\.is\('email_hash', null\);/);
  assert.match(registry, /if \(!existingErasure \|\| existingErasure\.length === 0\) \{/);
});

// ------------------------------------------------------------------ D5
test('D5 — RGPD : marqueur durable sur toutes les inscriptions trouvées, fusion ligne par ligne', () => {
  assert.match(contact, /export const GDPR_ERASED_AT_KEY = 'gdpr_erased_at';/);
  const rec = fnBody(contact, 'export async function recordGdprErasure(');
  const marker = sliceBetween(rec, '// 3 bis.', '// 4. Exécutions');
  // Toutes les inscriptions (allIds), pas seulement celles en cours.
  assert.match(marker, /for \(let i = 0; i < allIds\.length; i \+= 100\)/);
  assert.doesNotMatch(marker, /liveIds/);
  // tracking_data relu puis fusionné ligne par ligne, date déjà posée gardée.
  assert.match(marker, /\.select\('id, tracking_data'\)/);
  assert.match(marker, /if \(typeof tracking\[GDPR_ERASED_AT_KEY\] === 'string'\) continue;/);
  assert.match(marker, /\.update\(\{ tracking_data: \{ \.\.\.tracking, \[GDPR_ERASED_AT_KEY\]: nowIso \}, updated_at: nowIso \}\)\s*\.eq\('id', row\.id\)/);
  assert.match(marker, /if \(markError\) return fail\(/);
  // Posé après l'arrêt des inscriptions en cours.
  assert.ok(rec.indexOf('// 3 bis.') > rec.indexOf("return fail('arrêt des inscriptions', error);"));
});

// ------------------------------------------------------- points 9 et 11
test('unipile-accounts : arrêt des envois et dissociation jamais bloqués par l’absence d’identifiants', () => {
  assert.match(accounts, /const DATABASE_ONLY_ACTIONS = new Set\(\['unlink_linkedin_account', 'stop_member_linkedin', 'unlink_email_account'\]\);/);
  assert.match(accounts, /if \(!credentials && !DATABASE_ONLY_ACTIONS\.has\(action\)\) \{[\s\S]*?LinkedIn non configuré pour cette organisation/);
  assert.doesNotMatch(accounts, /if \(!credentials\) \{\s*return new Response/);
  // Ces actions n'appellent pas le prestataire (identifiants vides admis).
  for (const name of ['unlink_linkedin_account', 'stop_member_linkedin']) {
    const start = accounts.indexOf(`      case '${name}': {`);
    const end = accounts.indexOf("\n      case '", start + 1);
    const block = accounts.slice(start, end);
    assert.doesNotMatch(block, /apiKey|baseUrl|fetchWithTimeout/, `${name} appelle le prestataire`);
  }
});

// ------------------------------------------- dernière passe, points 1 à 4 (D3, §8)
test('D3 — assistant : rôle exact lu dans organization_members, échec fermé, « member » garde tous les droits', () => {
  assert.match(mutations, /const FULL_SEQUENCE_ROLES = new Set\(\['owner', 'admin', 'member'\]\);/);
  const helper = fnBody(mutations, 'async function readCallerOrgRole(ctx: ToolContext): Promise<string | null> {');
  assert.match(helper, /\.from\('organization_members'\)\s*\.select\('role'\)\s*\.eq\('organization_id', ctx\.organizationId\)\s*\.eq\('user_id', ctx\.userId\)\s*\.maybeSingle\(\);/);
  assert.match(helper, /if \(error \|\| !data \|\| typeof data\.role !== 'string'\) return null;/);
  // Pas le resolveRole des lectures, qui range « member » parmi les collaborateurs.
  assert.doesNotMatch(mutations, /resolveRole\s*\(|import[^;]*resolveRole/);
});

test('D3 — pause_sequence refusée à tout collaborateur, avant toute écriture en clé de service', () => {
  const verify = sliceBetween(toolBlock('pause_sequence'), 'async verifyAccess(', 'async dryRun(');
  const roleAt = verify.indexOf('const role = await readCallerOrgRole(ctx);');
  const allowAt = verify.lastIndexOf('return { allowed: true };');
  assert.ok(roleAt > 0 && roleAt < allowAt, 'rôle non lu avant l’autorisation');
  assert.match(verify, /if \(!role\) return \{ allowed: false, reason: RIGHTS_UNVERIFIED_MESSAGE \};/);
  // Même auteur de la séquence : aucune exception sur created_by.
  assert.match(verify, /if \(!FULL_SEQUENCE_ROLES\.has\(role\)\) \{\s*return \{\s*allowed: false,/);
  assert.doesNotMatch(verify, /created_by/);
});

test('D3 — resume_sequence : collaborateur limité à ses séquences, et jamais sans son JWT', () => {
  const verify = sliceBetween(toolBlock('resume_sequence'), 'async verifyAccess(', 'async dryRun(');
  assert.match(verify, /\.select\('id, organization_id, created_by'\)/);
  assert.match(verify, /if \(!role\) return \{ allowed: false, reason: RIGHTS_UNVERIFIED_MESSAGE \};/);
  assert.match(verify, /if \(!FULL_SEQUENCE_ROLES\.has\(role\)\) \{\s*if \(seq\.created_by !== ctx\.userId\) \{\s*return \{ allowed: false,/);
  assert.match(verify, /if \(!ctx\.userBearer\) \{\s*return \{\s*allowed: false,/);
  // Contrôle de rôle avant celui du plan (et donc avant l'autorisation).
  assert.ok(verify.indexOf('readCallerOrgRole(ctx)') < verify.indexOf('getSubscriptionGate('));
});

test('D3 — resume_sequence : process-sequences appelé avec le JWT du collaborateur, clé de service pour les autres rôles', () => {
  const execute = toolBlock('resume_sequence').slice(toolBlock('resume_sequence').indexOf('async execute('));
  assert.match(execute, /const actsForWholeSequence = FULL_SEQUENCE_ROLES\.has\(role\);/);
  assert.match(execute, /const callerToken = actsForWholeSequence \? serviceKey : ctx\.userBearer;/);
  assert.match(execute, /headers: \{ Authorization: `Bearer \$\{callerToken\}`, 'Content-Type': 'application\/json' \}/);
  assert.doesNotMatch(execute, /Bearer \$\{serviceKey\}/, 'clé de service envoyée quel que soit le rôle');
  // Collaborateur sans JWT : refus AVANT la réactivation de la séquence.
  const refuseAt = execute.search(/if \(!actsForWholeSequence && !ctx\.userBearer\) \{\s*return \{\s*success: false,/);
  const updateAt = execute.indexOf('.update({ is_active: true })');
  assert.ok(refuseAt > 0 && refuseAt < updateAt, 'séquence réactivée avant le contrôle du JWT');
  // Inscriptions de collègues laissées en pause : annoncées (champ additif du §8).
  assert.match(execute, /typeof body\.other_members === 'number' && body\.other_members > 0/);
  // Aperçu : un collaborateur ne compte que ses inscriptions.
  const dry = sliceBetween(toolBlock('resume_sequence'), 'async dryRun(', 'async execute(');
  assert.match(dry, /if \(!role \|\| !FULL_SEQUENCE_ROLES\.has\(role\)\) toResumeQuery = toResumeQuery\.eq\('created_by', ctx\.userId\);/);
});

test('D3 — enroll_in_sequence : un collaborateur n’inscrit que dans une séquence qu’il voit (la sienne ou celle de son équipe de mission)', () => {
  const verify = sliceBetween(toolBlock('enroll_in_sequence'), 'async verifyAccess(', 'async dryRun(');
  assert.match(verify, /\.select\('id, organization_id, name, is_active, created_by, project_id'\)/);
  const guard = sliceBetween(verify, 'if (seq.created_by !== ctx.userId) {', '// Job must also belong to org');
  assert.match(guard, /if \(!FULL_SEQUENCE_ROLES\.has\(role\)\) \{/);
  assert.match(guard, /\.from\('mission_team'\)\s*\.select\('id'\)\s*\.eq\('project_id', seq\.project_id\)\s*\.eq\('user_id', ctx\.userId\)/);
  assert.match(guard, /if \(teamError\) return \{ allowed: false, reason: RIGHTS_UNVERIFIED_MESSAGE \};/);
  assert.match(guard, /if \(!inMissionTeam\) \{\s*return \{\s*allowed: false,/);
});
