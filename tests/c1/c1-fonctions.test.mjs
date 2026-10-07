/**
 * Lot C1, réparations des fuites : garde-fous statiques des fonctions edge.
 *
 * Même forme que tests/agent et tests/ux : lecture du source et assertions sur
 * les motifs, sans navigateur, sans base ni runtime Deno. Couvre R1 (renforcé
 * par le retrait de Notion hors connexion de l'assistant, étapes 1 et 2 des
 * 28 et 29/09), R2, R3 (points 2 et 3),
 * R4 (fonction edge), R8 et R11 (send-team-invitation, e-mail d'invitation de
 * mission).
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

test('Les catégories automatiques sont écrites dans l’organisation vérifiée du compte, lisible par sa RLS', () => {
  const src = read(AUTO_ANALYZE);
  const category = src.slice(src.indexOf('// 6. Update chat_categories'), src.indexOf('// 7. Trigger full AI analysis'));
  assert.match(category, /if \([^\n]*&& accountOrgId\)/);
  assert.match(category, /\.eq\('organization_id', accountOrgId\)/);
  assert.match(category, /\.upsert\(\{[^}]*organization_id: accountOrgId,/s);
  assert.doesNotMatch(category, /organization_id:\s*organization_id\b/);
});
const ADD_TO_SHORTLIST = 'supabase/functions/add-to-shortlist/index.ts';
const SUBMIT_APP = 'supabase/functions/submit-application/index.ts';
const SCORE = 'supabase/functions/score-profile-job/index.ts';
const WORKER = 'supabase/functions/process-agent-tasks/index.ts';
const RUN_AGENT = 'supabase/functions/run-agent-search/index.ts';
const AGENT_CHAT = 'supabase/functions/search-agent-chat/index.ts';
const TEAM_INVITE = 'supabase/functions/send-team-invitation/index.ts';
const PORTAL = 'supabase/functions/client-portal-data/index.ts';
const MISSION_EMAIL = 'supabase/functions/_shared/transactional-email-templates/mission-invitation.tsx';

// ─── R1 : plus de Notion hors connexion de l'assistant (décision 16) ────────
//
// Étape 1 du retrait (2026-09-28) : l'ancienne synchro Notion par clé API sort
// du code. Étape 2 (2026-09-29) : process-sequences et calendly-webhook suivent,
// la carte « Notion par clé » quitte les Paramètres, et une migration supprime
// les colonnes. Visés partout (supabase/functions et src) : l'API REST de
// Notion, les secrets de la plateforme NOTION_API_KEY et NOTION_<BASE>_DB_ID,
// les colonnes notion_* de organization_integrations, job_candidate_status et
// qualification_sessions, la table notion_api_cache. La connexion Notion de
// l'assistant passe par mcp.notion.com : ses secrets
// (NOTION_TOKEN_ENCRYPTION_KEY, NOTION_ALLOWED_RETURN_ORIGINS) et ses tables
// OAuth ne sont pas visés.

const NOTION_REST_API = /api\.notion\.com/;
const PLATFORM_NOTION_SECRET = /NOTION_(?:API_KEY|[A-Z]+_DB_ID)/;
const LEGACY_NOTION_COLUMN =
  /\bnotion_(?:api_key(?:_hint)?|connected|candidats_db_id|shortlist_db_id|postes_db_id|candidate_id|shortlist_id|synced_at|api_cache)\b/;
// Seuls fichiers autorisés à citer un identifiant notion_* : ceux de la
// connexion Notion de l'assistant (tables OAuth, paramètres de retour).
const MCP_FILES = new Set([
  'supabase/functions/notion-mcp-oauth/index.ts',
  'supabase/functions/_shared/notion-mcp-connection.ts',
  'supabase/functions/_shared/notion-secret-crypto.ts',
  'supabase/functions/_shared/notion-oauth-policy.mjs',
  'supabase/functions/_shared/connector-selection.mjs',
]);

// Les cinq fonctions de l'ancienne synchro, supprimées le 2026-09-28.
const REMOVED_NOTION_FUNCTIONS = [
  'fetch-notion-jobs',
  'fetch-notion-candidates',
  'update-notion-job',
  'notify-notion',
  'update-candidate-stage',
];

test("R1 : aucune fonction n'appelle l'API REST de Notion ni ne lit ses secrets de plateforme", () => {
  const offenders = listSources('supabase/functions')
    .flatMap((f) => {
      const src = read(f);
      return [
        ...(NOTION_REST_API.test(src) ? [`${f} : api.notion.com`] : []),
        ...(PLATFORM_NOTION_SECRET.test(src) ? [`${f} : ${src.match(PLATFORM_NOTION_SECRET)[0]}`] : []),
      ];
    });
  assert.deepEqual(offenders, []);
});

test("R1 : aucune fonction ne lit ni n'écrit une colonne notion_* de l'ancienne synchro", () => {
  const offenders = listSources('supabase/functions')
    .flatMap((f) => {
      const src = read(f);
      const legacy = src.match(LEGACY_NOTION_COLUMN);
      if (legacy) return [`${f} : ${legacy[0]}`];
      // Hors connexion de l'assistant, aucun identifiant notion_* du tout.
      const any = MCP_FILES.has(f) ? null : src.match(/\bnotion_[a-z]\w*/);
      return any ? [`${f} : ${any[0]}`] : [];
    });
  assert.deepEqual(offenders, []);
});

test('R1 : le front ne lit ni n\'écrit plus de colonne notion_* de l\'ancienne synchro, ni l\'API ni ses secrets', () => {
  // types.ts, généré depuis le schéma, suit la migration qui supprime les
  // colonnes : il a son propre contrôle, avec cette migration.
  const legacyAll = new RegExp(LEGACY_NOTION_COLUMN.source, 'g');
  const offenders = listSources('src')
    .filter((f) => f !== 'src/integrations/supabase/types.ts')
    .flatMap((f) => {
      const src = read(f);
      return [
        ...[...new Set(src.match(legacyAll) ?? [])],
        ...(NOTION_REST_API.test(src) ? ['api.notion.com'] : []),
        ...(PLATFORM_NOTION_SECRET.test(src) ? [src.match(PLATFORM_NOTION_SECRET)[0]] : []),
      ].map((h) => `${f} : ${h}`);
    });
  assert.deepEqual(offenders, []);
});

test("R1 : les cinq fonctions de l'ancienne synchro Notion sont supprimées, config.toml compris", () => {
  const config = read('supabase/config.toml');
  for (const name of REMOVED_NOTION_FUNCTIONS) {
    assert.ok(!existsSync(join(ROOT, 'supabase/functions', name)), `supabase/functions/${name} existe encore`);
    assert.ok(!config.includes(`[functions.${name}]`), `section [functions.${name}] encore dans config.toml`);
  }
  // La connexion Notion de l'assistant reste.
  assert.ok(existsSync(join(ROOT, 'supabase/functions/notion-mcp-oauth/index.ts')));
  assert.ok(config.includes('[functions.notion-mcp-oauth]'));
});

test('R1 : plus aucun appel aux fonctions retirées ni à resolveNotionCredentials', () => {
  const names = REMOVED_NOTION_FUNCTIONS.join('|');
  // Un nom entre guillemets (invokeEdgeFunction, functions.invoke) ou dans une
  // URL functions/v1/ ; un commentaire qui cite le nom ne compte pas.
  const call = new RegExp(`['"\`](?:${names})['"\`]|functions/v1/(?:${names})\\b`);
  const offenders = [...listSources('src'), ...listSources('supabase/functions'), ...listSources('e2e')]
    .flatMap((f) => {
      const src = read(f);
      const hit = src.match(call) ?? src.match(/\bresolveNotionCredentials\b/);
      return hit ? [`${f} : ${hit[0]}`] : [];
    });
  assert.deepEqual(offenders, []);
});

test("R1 : add-to-shortlist retient par apply_mission_candidate_stage, pour une organisation de l'appelant", () => {
  const src = read(ADD_TO_SHORTLIST);
  // Plus aucune écriture directe : seule l'appartenance est lue en table.
  const tables = [...src.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tables)].sort(), ['organization_members']);
  assert.doesNotMatch(src, /job_candidate_status'\)/, 'aucun .from(\'job_candidate_status\')');
  assert.doesNotMatch(src, /\.(update|upsert|insert)\(/, 'aucune écriture directe');
  // Hors commentaires : ni l'ancien couple, ni ses valeurs.
  assert.doesNotMatch(src.replace(/^\s*\/\/[^\n]*$/gm, ''), /pipeline_stage|status: '|'shortlisted'|'Pressenti'/);
  const iMember = src.indexOf(".from('organization_members')");
  const iRequired = src.indexOf("if (!data.organization_id) throw");
  const iRpc = src.indexOf("rpc('apply_mission_candidate_stage'");
  assert.ok(iMember > 0 && iRequired > iMember && iRpc > iRequired, 'appartenance et organisation vérifiées avant toute écriture');
  assert.match(src.slice(iMember, iRequired), /status: 403/);
  // « Contacté » : ignoré, sans écriture, avant la mission.
  const iContact = src.indexOf("if (data.etape === 'Contacté') {");
  assert.ok(iContact > iRequired && iContact < iRpc, 'branche Contacté avant l’appel');
  assert.match(src.slice(iContact, iContact + 200), /return jsonResponse\(\{ success: true, ignored: 'contact' \}\);/);
  // Mission obligatoire (400), sans « project: », forme uuid.
  assert.match(src, /const raw = typeof jobId === 'string' \? jobId\.trim\(\)\.replace\(\/\^project:\/, ''\) : '';/);
  assert.match(src, /return UUID_RE\.test\(raw\) \? raw\.toLowerCase\(\) : null;/);
  const iMission = src.indexOf('const projectId = missionIdOf(data.jobId);');
  assert.ok(iMission > iContact && iMission < iRpc, 'mission contrôlée avant l’appel');
  assert.match(src.slice(iMission, iRpc), /if \(!projectId\) \{\s*return jsonResponse\(\{ success: false, error: 'Choisissez une mission' \}, 400\);/);
  // Appel : Retenu, origine user, depuis À trier, Retenu ou Écarté. Réutilise la ligne déjà
  // suivie dans la mission, quel qu'en soit l'auteur, au lieu d'en créer une seconde : une
  // ligne de l'appelant n'est créée que si la mission n'en a aucune.
  const call = src.slice(iRpc, src.indexOf('});', iRpc));
  assert.match(call, /p_organization_id: data\.organization_id,/);
  assert.match(call, /p_project_id: projectId,/);
  assert.match(call, /ids: linkedinId \? \[linkedinId\] : \[\],/);
  assert.match(call, /profile_url: linkedinUrl/);
  assert.match(call, /p_stage: 'retained',/);
  assert.match(call, /p_source: 'user',/);
  assert.match(call, /p_from_stages: RETAIN_FROM_STAGES,/);
  assert.match(call, /p_create_by: user\.id,/);
  assert.match(call, /p_only_created_by: null,/);
  assert.match(src, /const RETAIN_FROM_STAGES = \['to_sort', 'retained', 'rejected'\];/);
  // alreadyExists : toutes les lignes laissées à leur étape.
  assert.match(src, /const alreadyExists = rows\.every\(\(r\) => r\.result === 'skipped'\);/);
  assert.match(src, /jsonResponse\(\{ success: true, \.\.\.\(alreadyExists \? \{ alreadyExists: true \} : \{\}\) \}\)/);
});

// ─── R1 (arbitrage) : auto-analyze-message borné à l'organisation du compte ──

test("R1 : auto-analyze-message ne lit et n'écrit job_candidate_status que dans l'organisation du compte", () => {
  const src = read(AUTO_ANALYZE);
  // Lot 0b-2a : plus aucune écriture directe ; il reste la lecture du repli
  // des auteurs (catégorie de conversation), bornée à l'organisation du compte.
  const queries = [...src.matchAll(/\.from\('job_candidate_status'\)[^;]*;/g)].map((m) => m[0]);
  assert.equal(queries.length, 1, 'seul le repli des auteurs lit encore les lignes');
  for (const q of queries) {
    assert.match(q, /\.eq\('organization_id', accountOrgId\)/, q);
    assert.doesNotMatch(q, /\.(update|upsert|insert|delete)\(/, 'lecture seule');
    assert.ok(
      q.indexOf(".eq('organization_id', accountOrgId)") < q.indexOf('.or('),
      'le filtre d\'organisation précède le .or(...)',
    );
  }
  assert.match(src, /if \(userIds\.length === 0 && candidateId && accountOrgId\)/);
  // Résumé et rattrapage : fonctions SQL serveur, dans l'organisation du compte.
  assert.match(src, /recordReplySummary\(supabase, \{\s*organizationId: accountOrgId,/);
  assert.match(src, /recordInbound\(supabase, \{\s*organizationId: accountOrgId,[\s\S]*?receivedAt: lastCandidateAt,/);
  const events = read('supabase/functions/_shared/candidate-stage-events.ts');
  assert.match(events, /callStageRpc\(client, 'record_reply_summary', \{/);
  assert.match(events, /callStageRpc\(client, 'record_candidate_inbound', \{[\s\S]*?p_received_at: input\.receivedAt \?\? null,/);
});

test("R1 : l'analyse d'une réponse n'écrit plus ni statut, ni étape, ni recommandation", () => {
  const src = read(AUTO_ANALYZE);
  // Lot 0b-2a (décision 8) : l'étape vient des écrivains SQL seulement.
  assert.doesNotMatch(src, /\bstatus: appStatus\b|\bpipeline_stage:|\brecommendation:/);
  assert.doesNotMatch(src, /for \(const record of statusRecords\)/);
  // Rattrapage borné : avant l'analyse (même si elle échoue), date du dernier
  // message du candidat ; le résumé n'est écrit qu'après une analyse réussie.
  const catchUp = src.indexOf('await recordInbound(');
  const analyze = src.indexOf('await analyzeIntent(');
  const summary = src.indexOf('await recordReplySummary(');
  assert.ok(catchUp > 0 && analyze > catchUp && summary > analyze, 'rattrapage, analyse, puis résumé');
  assert.match(src, /const lastCandidateAt = lastCandidateMessageAt\(messages\);/);
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
  const membership = src.indexOf('if (conv.organization_id) {');
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
  // Affichage, avis du client (validation), puis lecture de l'identifiant du profil (lot 1 scorecard).
  assert.equal((src.match(/jsonResponse\(\{ error: PORTAL_UNAVAILABLE \}, 503\)/g) || []).length, 3);
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
  // Lot 0b : la notation n'écarte plus personne.
  assert.doesNotMatch(body, /'dismissed'/, 'aucun « dismissed » écrit par la notation');
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

// ─── R1, étape 2 : la migration supprime les colonnes de l'ancienne synchro ──

const NOTION_STEP2_MIGRATION = readdirSync(join(ROOT, 'supabase/migrations'))
  .filter((f) => /^\d{14}_retrait_notion_etape2\.sql$/.test(f));
// SQL sans commentaires : les assertions ne portent que sur les instructions.
const sqlCode = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
// Texte de `start` (inclus) à la première occurrence de `end` qui suit.
function between(src, start, end) {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `repère introuvable : ${start}`);
  const to = src.indexOf(end, from + start.length);
  assert.ok(to > from, `repère de fin introuvable : ${end}`);
  return src.slice(from, to);
}

test('R1 étape 2 : une seule migration, version unique et postérieure au lot 0b', () => {
  assert.equal(NOTION_STEP2_MIGRATION.length, 1, 'un seul fichier *_retrait_notion_etape2.sql');
  const version = NOTION_STEP2_MIGRATION[0].slice(0, 14);
  assert.ok(version > '20260928235358', 'postérieure à la dernière migration au départ');
  const same = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.startsWith(`${version}_`));
  assert.equal(same.length, 1, 'version unique');
});

test('R1 étape 2 : la migration supprime les colonnes, les index et le cache, sous garde', () => {
  const sql = sqlCode(read(`supabase/migrations/${NOTION_STEP2_MIGRATION[0]}`));
  const dropped = {
    job_candidate_status: ['notion_candidate_id', 'notion_shortlist_id', 'notion_synced_at'],
    organization_integrations: ['notion_api_key', 'notion_candidats_db_id', 'notion_connected', 'notion_postes_db_id', 'notion_shortlist_db_id'],
    qualification_sessions: ['notion_candidate_id', 'notion_shortlist_id', 'notion_synced_at'],
  };
  for (const [table, columns] of Object.entries(dropped)) {
    const alter = between(sql, `ALTER TABLE public.${table}\n`, ';');
    for (const c of columns) assert.match(alter, new RegExp(`DROP COLUMN IF EXISTS ${c}\\b`), `${table}.${c}`);
  }
  assert.match(sql, /DROP INDEX IF EXISTS public\.idx_jcs_notion_candidate_id;/);
  assert.match(sql, /DROP INDEX IF EXISTS public\.idx_jcs_notion_shortlist_id;/);
  // notion_api_cache n'existe qu'en prod : jamais de DROP sans garde.
  assert.match(sql, /IF to_regclass\('public\.notion_api_cache'\) IS NOT NULL THEN\s*DROP TABLE public\.notion_api_cache;/);
  // La vue est recréée avant le retrait des colonnes dont elle dépend.
  assert.ok(sql.indexOf('CREATE VIEW public.organization_integrations_public') < sql.indexOf('ALTER TABLE public.organization_integrations'));
});

test('R1 étape 2 : vue et RPC recréées sans Notion, mêmes options et mêmes droits', () => {
  const sql = sqlCode(read(`supabase/migrations/${NOTION_STEP2_MIGRATION[0]}`));
  const view = between(sql, 'CREATE VIEW public.organization_integrations_public', ';');
  assert.match(view, /WITH \(security_barrier = true\) AS/);
  assert.match(view, /WHERE auth\.uid\(\) IS NOT NULL\s*AND public\.get_org_role\(auth\.uid\(\), oi\.organization_id\) IN \('owner', 'admin'\)/);
  assert.doesNotMatch(view, /notion/i);
  for (const hint of ['calendly_api_key_hint', 'airtable_api_key_hint', 'aircall_api_token_hint']) assert.ok(view.includes(hint), hint);
  assert.match(sql, /DROP VIEW IF EXISTS public\.organization_integrations_public;/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\.organization_integrations_public FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.organization_integrations_public TO authenticated, service_role;/);
  for (const [fn, sig] of [['set_integration_secret', 'uuid, text, text'], ['update_integration_settings', 'uuid, jsonb']]) {
    const body = between(sql, `CREATE OR REPLACE FUNCTION public.${fn}(`, '$$;');
    assert.match(body, /SECURITY DEFINER\s*SET search_path = public, pg_temp/, fn);
    assert.doesNotMatch(body, /notion/i, `${fn} sans champ Notion`);
    assert.match(body, /RAISE EXCEPTION 'Champ non autorisé[^']*'[^;]*USING ERRCODE = '22023'/, `${fn} refuse un champ inconnu`);
    assert.ok(sql.includes(`REVOKE EXECUTE ON FUNCTION public.${fn}(${sig}) FROM PUBLIC, anon;`), `${fn} fermée à anon`);
    assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION public.${fn}(${sig}) TO authenticated, service_role;`), `${fn} ouverte aux membres`);
  }
});

test('R1 étape 2 : la connexion Notion de l\'assistant reste intacte', () => {
  const sql = sqlCode(read(`supabase/migrations/${NOTION_STEP2_MIGRATION[0]}`));
  assert.doesNotMatch(sql, /organization_notion_connections|notion_oauth_states|notion_mcp_oauth_clients|claim_notion_token_refresh/);
  assert.doesNotMatch(sql, /\bCASCADE\b/, 'aucune suppression en cascade');
  // Seuls objets supprimés : la vue recréée, les deux index, les colonnes et le cache.
  const drops = [...sql.matchAll(/DROP (TABLE|VIEW|INDEX|FUNCTION|POLICY|TRIGGER)(?: IF EXISTS)? ([\w.]+)/g)].map((m) => `${m[1]} ${m[2]}`).sort();
  assert.deepEqual(drops, [
    'INDEX public.idx_jcs_notion_candidate_id',
    'INDEX public.idx_jcs_notion_shortlist_id',
    'TABLE public.notion_api_cache',
    'VIEW public.organization_integrations_public',
  ]);
});

test('R1 étape 2 : types.ts ne décrit plus les colonnes ni le cache retirés', () => {
  const types = read('src/integrations/supabase/types.ts');
  const legacyAll = new RegExp(LEGACY_NOTION_COLUMN.source, 'g');
  assert.deepEqual([...new Set(types.match(legacyAll) ?? [])], []);
  assert.ok(types.includes('organization_integrations_public: {'), 'la vue reste typée');
});

// ─── Passerelle : chaque fonction déclare son verify_jwt ────────────────────
// supabase/config.toml : la passerelle ne valide que les jetons HS256, alors que
// les sessions du projet signent en ES256 ; l'authentification se fait dans la
// fonction (_shared/require-auth.ts). Une fonction sans entrée est déployée avec
// verify_jwt = true et refuse tous les appels du navigateur (cas de
// resolve-client-logo, arrivée sans entrée avec #261). Seule exception voulue :
// submit-application, neutralisée au lot C1 (R2).
test('Passerelle : chaque fonction a son entrée, verify_jwt = false sauf submit-application', () => {
  const config = read('supabase/config.toml');
  const functions = readdirSync(join(ROOT, 'supabase/functions')).filter(
    (name) => !name.startsWith('_') && statSync(join(ROOT, 'supabase/functions', name)).isDirectory(),
  );
  assert.ok(functions.length > 50, 'liste des fonctions introuvable');
  const settingOf = (name) => {
    const m = config.match(new RegExp(`^\\[functions\\.${name}\\]\\nverify_jwt = (true|false)$`, 'm'));
    return m ? m[1] : null;
  };
  const missing = functions.filter((name) => settingOf(name) === null);
  assert.deepEqual(missing, [], `fonctions sans entrée dans config.toml : ${missing.join(', ')}`);
  const verified = functions.filter((name) => settingOf(name) === 'true');
  assert.deepEqual(verified, ['submit-application'], `verify_jwt = true inattendu : ${verified.join(', ')}`);
});

// ─── Calendly : annulation et déplacement d'un rendez-vous ──────────────────
// calendly-webhook ne traitait que invitee.created : une séance annulée dans
// l'agenda restait « scheduled » (BUG-078 de docs/audit-2026-09-01.md). Le
// comportement se rejoue dans e2e/api/seq-meeting.spec.ts et
// tests/ux/calendly-annulation.test.mjs ; ici, les invariants qui ne doivent
// pas sauter sans bruit.
const CALENDLY_WEBHOOK = 'supabase/functions/calendly-webhook/index.ts';
const CALENDLY_SETUP = 'supabase/functions/setup-calendly-webhook/index.ts';

test('Calendly : invitee.canceled est traité après la vérification de signature, avant le filtre « invitee.created »', () => {
  const src = read(CALENDLY_WEBHOOK);
  const serve = src.slice(src.indexOf('Deno.serve('));
  const verify = serve.indexOf('verifyCalendlySignature(req, rawBody)');
  const canceled = serve.indexOf("body.event === 'invitee.canceled'");
  const onlyCreated = serve.indexOf("body.event !== 'invitee.created'");
  assert.ok(verify >= 0 && canceled > verify, 'annulation traitée après la signature');
  assert.ok(onlyCreated > canceled, 'annulation traitée avant le filtre invitee.created');
  assert.match(serve, /handleInviteeCanceled\(body\.payload\)/);
});

test('Calendly : toute écriture sur une séance filtre par organisation et par statut ouvert', () => {
  const src = read(CALENDLY_WEBHOOK);
  assert.match(src, /const SESSION_OPEN_STATUSES = \['scheduled', 'in_progress'\];/);
  const writer = fnBody(src, 'async function updateOpenSessions(');
  assert.match(writer, /\.update\(patch\)\s*\.eq\('id', row\.id\)\s*\.eq\('organization_id', row\.organization_id\)\s*\.in\('status', SESSION_OPEN_STATUSES\)/);
  assert.match(writer, /if \(!row\.organization_id\)/, 'une séance sans organisation n’est jamais modifiée');
  // Aucune autre écriture sur qualification_sessions dans les nouveaux gestionnaires.
  for (const signature of ['async function handleInviteeCanceled(', 'async function moveRescheduledSession(']) {
    assert.doesNotMatch(fnBody(src, signature), /\.update\(|\.delete\(|\.insert\(/, `${signature} écrit par updateOpenSessions seulement`);
  }
});

test('Calendly : l’annulation pose « cancelled », un déplacement n’annule jamais', () => {
  const src = read(CALENDLY_WEBHOOK);
  const cancel = fnBody(src, 'async function handleInviteeCanceled(');
  assert.match(cancel, /payload\?\.rescheduled === true/);
  assert.match(cancel, /updateOpenSessions\(rows, \{ status: 'cancelled' \}\)/);
  const move = fnBody(src, 'async function moveRescheduledSession(');
  assert.match(move, /payload\?\.old_invitee/);
  assert.doesNotMatch(move, /status:/, 'le déplacement ne change pas le statut');
  assert.match(src, /const moved = await moveRescheduledSession\(payload\);\s*if \(moved\.handled\)/);
});

test('Calendly : l’abonnement demande les deux événements, signés, et un abonnement incomplet est recréé', () => {
  const src = read(CALENDLY_SETUP);
  assert.match(src, /const WEBHOOK_EVENTS = \['invitee\.created', 'invitee\.canceled'\];/);
  assert.match(src, /events: WEBHOOK_EVENTS,/);
  assert.match(src, /WEBHOOK_EVENTS\.every\(\(ev\) => \(wh\.events \?\? \[\]\)\.includes\(ev\)\)/, '« déjà configuré » exige les deux événements');
  assert.match(src, /signing_key: signingKey,/);
  assert.ok(
    src.indexOf("Deno.env.get('CALENDLY_WEBHOOK_SIGNING_KEY')") < src.indexOf("method: 'DELETE'"),
    'la clé est exigée avant de supprimer un abonnement existant',
  );
});

test('Calendly : la barre latérale ignore les entretiens annulés', () => {
  const src = read('src/lib/sidebarSignals.ts');
  assert.match(src, /row\.status === 'completed' \|\| row\.status === 'cancelled'/);
});
