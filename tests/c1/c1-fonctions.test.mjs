/**
 * Lot C1, réparations des fuites : garde-fous statiques des fonctions edge.
 *
 * Même forme que tests/agent et tests/ux : lecture du source et assertions sur
 * les motifs, sans navigateur, sans base ni runtime Deno. Couvre R1 (partiel :
 * process-sequences reporté), R2, R3 (points 2 et 3), R4 (fonction edge), R8
 * et R11 (send-team-invitation, e-mail d'invitation de mission).
 *
 * Lancer : node --test tests/c1/c1-fonctions.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre (ex. une extraction de HEAD) : c'est
 * ainsi qu'on vérifie que ces tests échouent sur le code d'origine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

function listSources(dir) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...listSources(rel));
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(rel);
  }
  return out;
}

// Corps d'une fonction de premier niveau : de sa déclaration à la première
// accolade fermante en colonne 0.
function fnBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `${signature} introuvable`);
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, `fin de ${signature} introuvable`);
  return src.slice(start, end);
}

// Vendeurs et tiret long : jamais dans un texte que l'utilisateur lit.
const FORBIDDEN_IN_UI = /Unipile|Apollo|People Data Labs|\bPDL\b|Anthropic|Claude|Notion|—/;

const AUTO_ANALYZE = 'supabase/functions/auto-analyze-message/index.ts';
const ADD_TO_SHORTLIST = 'supabase/functions/add-to-shortlist/index.ts';
const RESOLVE_CREDS = 'supabase/functions/_shared/resolve-org-credentials.ts';
const SUBMIT_APP = 'supabase/functions/submit-application/index.ts';
const SCORE = 'supabase/functions/score-profile-job/index.ts';
const WORKER = 'supabase/functions/process-agent-tasks/index.ts';
const RUN_AGENT = 'supabase/functions/run-agent-search/index.ts';
const AGENT_CHAT = 'supabase/functions/search-agent-chat/index.ts';
const TEAM_INVITE = 'supabase/functions/send-team-invitation/index.ts';
const PORTAL = 'supabase/functions/client-portal-data/index.ts';
const MISSION_EMAIL = 'supabase/functions/_shared/transactional-email-templates/mission-invitation.tsx';

// ─── R1 : aucun secret Notion de la plateforme (décision 16) ────────────────

// NOTION_API_KEY et NOTION_<BASE>_DB_ID. Les secrets de la connexion Notion
// de l'assistant (NOTION_TOKEN_ENCRYPTION_KEY, NOTION_ALLOWED_RETURN_ORIGINS)
// ne sont pas visés.
const PLATFORM_NOTION_SECRET = /Deno\.env\.get\(\s*['"`]NOTION_(?:API_KEY|[A-Z]+_DB_ID)['"`]/;
// Reporté : process-sequences, réservé à une autre session. Neutralisé en
// production par le retrait des secrets. Retirer l'exception dès que son code
// n'en lit plus.
const DEFERRED = new Set(['supabase/functions/process-sequences/index.ts']);

test('R1 : aucune fonction ne lit les secrets Notion de la plateforme', () => {
  const offenders = listSources('supabase/functions')
    .filter((f) => !DEFERRED.has(f))
    .filter((f) => PLATFORM_NOTION_SECRET.test(read(f)));
  assert.deepEqual(offenders, []);
});

test("R1 : resolveNotionCredentials ne se replie jamais sur l'environnement", () => {
  const body = fnBody(read(RESOLVE_CREDS), 'export async function resolveNotionCredentials(');
  assert.doesNotMatch(body, /Deno\.env/);
  assert.match(body, /if \(!organizationId\) return null;/);
});

test("R1 : auto-analyze-message n'écrit dans Notion qu'avec la clé et la base de l'organisation", () => {
  const src = read(AUTO_ANALYZE);
  const creds = fnBody(src, 'async function resolveOrgCredentials(');
  assert.match(creds, /notionApiKey: null,/);
  assert.match(creds, /candidatsDbId: null,/);
  assert.match(creds, /shortlistDbId: null,/);
  for (const sig of ['async function findCandidateInNotion(', 'async function findShortlistsForCandidate(']) {
    assert.match(fnBody(src, sig), /if \(!creds\.notionApiKey \|\| !dbId\) return/, sig);
  }
  assert.match(src, /if \(!skipStatusUpdates && creds\.notionApiKey && creds\.candidatsDbId\)/);
});

test("R1 : add-to-shortlist exige la clé et les deux bases de l'organisation", () => {
  const body = fnBody(read(ADD_TO_SHORTLIST), 'async function resolveOrgCredentials(');
  assert.doesNotMatch(body, /Deno\.env/);
  assert.match(body, /!data\.notion_candidats_db_id/);
  assert.match(body, /!data\.notion_shortlist_db_id/);
});

// ─── R1 (arbitrage) : auto-analyze-message borné à l'organisation du compte ──

test("R1 : auto-analyze-message ne lit et n'écrit job_candidate_status que dans l'organisation du compte", () => {
  const src = read(AUTO_ANALYZE);
  assert.match(src, /if \(!skipStatusUpdates && candidateId && accountOrgId\) \{/);
  const queries = [...src.matchAll(/\.from\('job_candidate_status'\)[^;]*;/g)].map((m) => m[0]);
  assert.equal(queries.length, 3, 'lecture des lignes, mise à jour, repli des auteurs');
  for (const q of queries) {
    assert.match(q, /\.eq\('organization_id', accountOrgId\)/, q);
  }
  for (const q of queries.filter((x) => x.includes('.or('))) {
    assert.ok(
      q.indexOf(".eq('organization_id', accountOrgId)") < q.indexOf('.or('),
      'le filtre d\'organisation précède le .or(...)',
    );
  }
  assert.match(src, /if \(userIds\.length === 0 && candidateId && accountOrgId\)/);
});

test("R1 : l'analyse d'une réponse ne touche ni statut ni étape au-delà de « Contacté »", () => {
  const src = read(AUTO_ANALYZE);
  const loop = src.slice(src.indexOf('for (const record of statusRecords)'));
  assert.match(
    loop,
    /const isEarlyStage = stage === '' \|\| stage === 'Nouveau' \|\| stage === 'Contacté';/,
  );
  assert.match(loop, /\.\.\.\(isEarlyStage \? \{ status: appStatus, pipeline_stage: pipelineStage \} : \{\}\)/);
  const update = loop.slice(loop.indexOf('.update({'), loop.indexOf('.eq(\'id\', record.id)'));
  assert.doesNotMatch(update, /^\s*status: appStatus,/m, 'le statut ne doit plus être écrit sans condition');
});

// ─── R2 : submit-application neutralisée ────────────────────────────────────

test('R2 : submit-application répond 410 sans rien lire ni journaliser', () => {
  const block = read('supabase/config.toml').match(/\[functions\.submit-application\]\s*\n([^[]*)/);
  if (!existsSync(join(ROOT, 'supabase/functions/submit-application'))) {
    assert.equal(block, null, 'section [functions.submit-application] orpheline dans config.toml');
    return;
  }
  const src = read(SUBMIT_APP);
  assert.match(src, /status:\s*410/);
  assert.doesNotMatch(src, /\breq\b|Deno\.env|console\.|fetch\(|createClient|api\.notion\.com|\bimport\b/);
  assert.ok(block, 'section [functions.submit-application] absente de config.toml');
  assert.match(block[1], /^verify_jwt\s*=\s*true\s*$/m);
});

// ─── R3 : conversations de l'assistant, leur auteur seul ────────────────────

test("R3 : search-agent-chat refuse la conversation d'un autre, avec ou sans organisation", () => {
  const src = read(AGENT_CHAT);
  const guard = src.indexOf('if (conv.created_by !== user.id) {');
  const membership = src.indexOf('if (!createdConversation && conv.organization_id) {');
  assert.ok(guard > 0, 'contrôle de l\'auteur introuvable');
  assert.ok(membership > guard, 'le contrôle de l\'auteur précède celui de l\'appartenance');
  assert.doesNotMatch(
    src.slice(guard - 40, guard),
    /else\s*$/,
    'le contrôle de l\'auteur ne doit plus dépendre de l\'absence d\'organisation',
  );
  assert.match(src.slice(guard, guard + 250), /status: 403/);
});

test("R3 : run-agent-search refuse la conversation d'un autre, avec ou sans organisation", () => {
  const src = read(RUN_AGENT);
  const notFound = src.indexOf('"Conversation not found"');
  const guard = src.indexOf('if (conv.created_by !== user.id) {');
  const plan = src.indexOf('const searchPlan = conv.search_config');
  assert.ok(notFound > 0 && guard > notFound && plan > guard, 'contrôle de l\'auteur mal placé ou absent');
  assert.match(src.slice(guard, guard + 250), /status: 403/);
});

// ─── R4 : portail client, lecture par la fonction SQL ───────────────────────

test('R4 : client-portal-data ne lit plus les candidats en direct', () => {
  const src = read(PORTAL);
  assert.doesNotMatch(src, /\.from\("job_candidate_status"\)/);
  assert.equal((src.match(/rpc\(\s*"client_portal_candidates",\s*\{ p_token: token \}/g) || []).length, 2);
  assert.doesNotMatch(src, /\.select\("\*"\)/);
});

test('R4 : un lien sans date, illisible ou échu est refusé', () => {
  const src = read(PORTAL);
  const body = fnBody(src, 'function isExpired(');
  assert.match(body, /if \(!expiresAt\) return true;/);
  assert.match(body, /Number\.isNaN\(t\) \|\| t <= Date\.now\(\)/);
  assert.doesNotMatch(src, /tokenRow\.expires_at &&/);
  assert.equal((src.match(/if \(isExpired\(tokenRow\.expires_at\)\)/g) || []).length, 2);
});

test("R4 : l'avis du client ne vise qu'un candidat visible, sans maybeSingle sur la fonction", () => {
  const src = read(PORTAL);
  const post = src.slice(src.indexOf('async function handleSubmitEvaluation('));
  const call = post.slice(post.indexOf('.rpc("client_portal_candidates"'), post.indexOf('if (candErr)'));
  assert.match(call, /\.eq\("id", evaluation\.candidate_id\)/);
  assert.match(call, /\.limit\(1\)/);
  assert.doesNotMatch(call, /maybeSingle/);
  assert.match(post, /candidateRows\?\.\[0\] \?\? null/);
  assert.match(post, /UUID_RE\.test\(evaluation\.candidate_id\)/);
});

test('R4 : fonction SQL absente, réponse 503 claire', () => {
  const src = read(PORTAL);
  assert.match(fnBody(src, 'function isMissingPortalFunction('), /PGRST202/);
  assert.equal((src.match(/jsonResponse\(\{ error: PORTAL_UNAVAILABLE \}, 503\)/g) || []).length, 2);
});

// ─── R8 : la notation ne réécrit que son organisation ───────────────────────

test('R8 : la notation ne réécrit que les lignes de son organisation, statut filtré par ligne', () => {
  const src = read(SCORE);
  const body = fnBody(src, 'async function syncJobCandidateStatus(');
  assert.match(body, /if \(!organizationId\)/);
  assert.equal((body.match(/\.eq\('organization_id', organizationId\)/g) || []).length, 2);
  const noteOnly = body.indexOf(".not('status', 'in', AI_REWRITABLE_IN)");
  const withStatus = body.indexOf(".in('status', AI_REWRITABLE_STATUSES)");
  assert.ok(noteOnly > 0 && withStatus > 0, 'deux mises à jour disjointes attendues');
  assert.ok(noteOnly < withStatus, 'la note seule d\'abord : sinon une ligne passée en dismissed serait reprise');
  const list = src.match(/const AI_REWRITABLE_STATUSES = \[([^\]]*)\]/);
  assert.ok(list, 'AI_REWRITABLE_STATUSES introuvable');
  for (const s of ['messaged', 'replied', 'shortlisted', 'dismissed', 'interested', 'not_interested', 'qualification', 'contacted']) {
    assert.doesNotMatch(list[1], new RegExp(`'${s}'`), `${s} ne doit pas être réécrit par la notation`);
  }
  const calls = [...src.matchAll(/\b(?:setCachedScore|syncJobCandidateStatus)\(supabase,[^;]*\);/g)].map((m) => m[0]);
  assert.equal(calls.length, 6);
  for (const c of calls) assert.match(c, /(?:resolvedOrgId|organizationId)\);$/, c);
});

test('R8 : le cache de notation est lu et écrit par organisation', () => {
  const src = read(SCORE);
  const get = fnBody(src, 'async function getCachedScore(');
  assert.match(get, /if \(!organizationId\) return null;/);
  assert.match(get, /\.eq\("organization_id", organizationId\)/);
  const set = fnBody(src, 'async function setCachedScore(');
  assert.match(set, /organization_id: organizationId,/);
  assert.match(set, /!isDegradedResult\(result\) && organizationId/);
  assert.match(src, /getCachedScore\(supabase, candidateId, job\.id, resolvedOrgId\)/);
  const run = read(RUN_AGENT);
  const q = run.slice(run.indexOf('.from("match_scores")'), run.indexOf(';', run.indexOf('.from("match_scores")')));
  assert.match(q, /\.eq\("organization_id", orgId\)/);
});

test("R8 : un poste de mission d'une autre organisation est refusé (403)", () => {
  const src = read(SCORE);
  const handler = src.slice(src.indexOf('Deno.serve('));
  const check = handler.slice(handler.indexOf('const jobProjectId'), handler.indexOf('let enrichmentCtx'));
  assert.match(check, /\.from\("sourcing_projects"\)/);
  assert.match(check, /\.from\("mission_team"\)/);
  assert.match(check, /jobProject\.organization_id !== resolvedOrgId/);
  assert.match(check, /status: 403/);
  assert.ok(
    handler.indexOf('const jobProjectId') < handler.indexOf('getCachedScore('),
    'le contrôle précède toute lecture du cache',
  );
});

test("R8 : le worker de notation ne lit que les lignes de son organisation", () => {
  const src = read(WORKER);
  const queries = [...src.matchAll(/\.from\("job_candidate_status"\)[^;]*;/g)].map((m) => m[0]);
  assert.equal(queries.length, 5);
  for (const q of queries) assert.match(q, /\.eq\("organization_id", task\.organization_id\)/, q);
});

// ─── R11 : textes vrais, rôle « collaborator » gelé ─────────────────────────

test('R11 : send-team-invitation refuse le rôle collaborator avant toute écriture', () => {
  const src = read(TEAM_INVITE);
  const guard = src.indexOf('if (normalizedRole === "collaborator") {');
  assert.ok(guard > 0, 'refus du rôle collaborator introuvable');
  assert.ok(guard < src.indexOf('.from("organization_invitations")'), 'refus avant la première lecture ou écriture d\'invitation');
  const message = src.slice(guard, src.indexOf(');', guard));
  assert.match(message, /throw new Error\(/);
  assert.match(message, /n'est pas encore disponible/);
  assert.doesNotMatch(message, /prochaine version/);
  assert.doesNotMatch(message, FORBIDDEN_IN_UI);
});

test("R11 : l'e-mail d'invitation de mission ne promet plus de sourcer dans la mission", () => {
  const src = read(MISSION_EMAIL);
  assert.doesNotMatch(src, /commencer à sourcer/);
  const line = src.split('\n').find((l) => l.includes("pour accepter l'invitation"));
  assert.ok(line, 'phrase d\'acceptation introuvable');
  assert.match(line, /la fiche du poste et ses étapes d'entretien/);
  assert.doesNotMatch(line, FORBIDDEN_IN_UI);
});

test("R11 : l'outil d'invitation de l'assistant ne propose plus le rôle collaborator", () => {
  const src = read('supabase/functions/_shared/agent-tools-mutations.ts');
  assert.match(src, /const ALLOWED_INVITE_ROLES = \['admin', 'member'\] as const;/);
  assert.doesNotMatch(src, /: 'collaborator'\) as InviteRole/);
  assert.match(src, /One of: admin, member\. Default: member\./);
});

test('Décision 17 : marketplace-admin refuse la validation d\'un partenaire avant toute écriture', () => {
  const src = read('supabase/functions/marketplace-admin/index.ts');
  const guard = src.indexOf('if (action === "validate_partner") {');
  const write = src.indexOf('if (action === "validate_partner" || action === "suspend_partner")');
  assert.ok(guard > 0, 'refus de validate_partner introuvable');
  assert.ok(write > guard, 'le refus doit précéder la mise à jour du statut');
  assert.match(src.slice(guard, write), /MARKETPLACE_FROZEN[\s\S]*403/);
});

test('Textes ajoutés : français, sans nom de fournisseur ni tiret long', () => {
  const portal = read(PORTAL);
  const texts = [
    ...portal.matchAll(/"((?:Le portail|Ce lien|Ce candidat)[^"]*)"/g),
  ].map((m) => m[1]);
  assert.ok(texts.length >= 3, 'textes du portail introuvables');
  for (const t of texts) assert.doesNotMatch(t, FORBIDDEN_IN_UI, t);
});
