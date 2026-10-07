/**
 * Garde statique du lot 5e-2 (style et niveau de l'IA qui rédige), partie serveur.
 * Contrat : docs/refonte-mission/lot5-plan.md, section 5e-2.
 *
 * Épingle, pour chaque rédacteur de prise de contact (draft-sequence draft,
 * text-action en contexte séquence, generate-outreach-message,
 * draft_outreach_message, create_sequence) :
 * - organisation vérifiée, niveau résolu (plafond : 403, jamais rétrogradé)
 *   AVANT le garde des crédits, garde au prix du modèle du niveau, appel, puis
 *   débit sur le modèle appelé ;
 * - aucun modèle tiré de _ai_model, aucune action de _ai_action ;
 * - aucun identifiant de modèle écrit en dur hors de ai-config.ts ;
 * - consigne de style et contrôles de sortie toujours appliqués, tutoiement
 *   refusé, contexte IA sans « Ton imposé » ;
 * - niveaux de l'organisation dans agency_permissions.ai_writing : aucune
 *   migration, contrôles dans org_writes_audit.sql ;
 * - réglages lus pour l'appelant (jamais un utilisateur venu du corps), lecture
 *   en échec refusée, style de la requête analysé avant tout appel ;
 * - aucun nom de modèle dans les textes rendus par les rédacteurs ; vouvoiement
 *   écrit dans chaque consigne, aucun ton ni réglage au tutoiement ;
 * - branchement CI (job agent-safety, comme lot5e-redaction).
 *
 * Lancer : node --test tests/c1/lot5e2-style-niveau.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const AI_CONFIG = 'supabase/functions/_shared/ai-config.ts';
const STYLE = 'supabase/functions/_shared/writing-style.ts';
const SETTINGS = 'supabase/functions/_shared/writing-settings.ts';
const SEQUENCE_DRAFT = 'supabase/functions/_shared/sequence-draft.ts';
const AI_CONTEXT = 'supabase/functions/_shared/ai-context.ts';
const COMPOSE = 'supabase/functions/draft-sequence/compose.ts';
const TEXT_ACTION = 'supabase/functions/text-action/index.ts';
const OUTREACH = 'supabase/functions/generate-outreach-message/index.ts';
const MUTATIONS = 'supabase/functions/_shared/agent-tools-mutations.ts';
const REGISTRY = 'supabase/functions/_shared/agent-tools.ts';
const CHAT = 'supabase/functions/search-agent-chat/index.ts';
const BROWSER_INVOKE = 'src/lib/invokeEdgeFunction.ts';
const ORG_AUDIT = 'supabase/tests/org_writes_audit.sql';

/** Position d'un motif, échec explicite s'il est absent. */
function at(src, needle, from = 0) {
  const i = src.indexOf(needle, from);
  assert.ok(i >= 0, `${needle} introuvable`);
  return i;
}

/** Corps d'une fonction de premier niveau : jusqu'à la première accolade fermante en colonne 0. */
function fnBody(src, signature) {
  const start = at(src, signature);
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, `fin de ${signature} introuvable`);
  return src.slice(start, end);
}

/** Objet de premier niveau déclaré par `const nom: Type = {` : jusqu'à `\n};`. */
function objectBlock(src, declaration) {
  const start = at(src, declaration);
  const end = src.indexOf('\n};\n', start);
  assert.ok(end > start, `fin de ${declaration} introuvable`);
  return src.slice(start, end);
}

/** Code sans commentaires, pour ne juger que ce qui s'exécute. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

const MODEL_ID_RE = /['"`]claude-(?:haiku|sonnet|opus)-\d/;

test('ai-config : une seule table niveau → modèle ; Équilibré = modèle par défaut actuel', () => {
  const config = read(AI_CONFIG);
  assert.match(config, /export const WRITING_LEVEL_MODELS = \{\n\s*rapide: "claude-haiku-4-5",\n\s*equilibre: "claude-sonnet-4-6",\n\s*avance: "claude-opus-5-5",\n\} as const;/);
  assert.match(config, /default: "claude-sonnet-4-6",/);
  const style = read(STYLE);
  assert.match(style, /export function modelForLevel\(level: AiLevel\): string \{\n\s*return WRITING_LEVEL_MODELS\[level\];/);
  assert.match(style, /export function levelCredits\(action: string, level: AiLevel\): number \{\n\s*return estimateCredits\(action, modelForLevel\(level\)\);/);
  // Jamais de rétrogradation silencieuse : au-dessus du plafond, 403.
  const resolve = fnBody(style, 'export function resolveAiLevel(');
  assert.match(resolve, /status: 403, code: 'AI_LEVEL_NOT_ALLOWED'/);
  assert.doesNotMatch(resolve, /level: org\.maxLevel/);
});

test('rédacteurs : aucun identifiant de modèle écrit en dur, aucun modèle de _ai_model', () => {
  for (const rel of [COMPOSE, TEXT_ACTION, OUTREACH, STYLE, SETTINGS, SEQUENCE_DRAFT]) {
    assert.doesNotMatch(codeOnly(read(rel)), MODEL_ID_RE, `${rel} écrit un identifiant de modèle`);
  }
  const draft = objectBlock(read(MUTATIONS), 'const draftOutreachMessage: AgentTool = {');
  assert.doesNotMatch(codeOnly(draft), MODEL_ID_RE);
  // _ai_model n'est plus lu par la rédaction de séquence ni par generate-outreach-message.
  assert.doesNotMatch(codeOnly(read(SEQUENCE_DRAFT)), /_ai_model/);
  assert.doesNotMatch(codeOnly(read(COMPOSE)), /_ai_model|ai_model\b|draftModel|ai_model_default/);
  const outreach = codeOnly(read(OUTREACH));
  assert.doesNotMatch(outreach, /extractAIParams|_ai_model|_ai_action/);
  assert.match(outreach, /const AI_ACTION = "outreach_message";/);
});

test('draft-sequence : niveau et style avant le garde, garde au modèle du niveau, débit sur le modèle appelé', () => {
  const draft = fnBody(read(COMPOSE), 'async function draft(');
  const settings = at(draft, 'const settings = await loadWritingSettings(admin, { organizationId, userId: ctx.userId });');
  const level = at(draft, 'const resolved = resolveAiLevel(request.ai_level, settings);');
  const refused = at(draft, 'if (!resolved.ok) return json({ error: resolved.error, error_code: resolved.code }, resolved.status);');
  const model = at(draft, 'const modelId = modelForLevel(level);');
  const gate = at(draft, 'const gate = await assertCredits({');
  const call = at(draft, 'first = await callModel(baseMessages);');
  const settle = at(draft, 'const settled = await settleCredits(admin, {');
  assert.ok(settings < level && level < refused && refused < model && model < gate && gate < call && call < settle);
  assert.match(draft, /const style = mergeStyle\(settings\.style, request\.style\);/);
  assert.match(draft, /loadAndBuildAiContext\(admin, \{ orgId: organizationId, userId: ctx\.userId, omitTone: true \}\)/);
  assert.match(draft, /max_tokens: MAX_OUTPUT_TOKENS\[style\.length\],/);
  // Le style entre dans la consigne de la rédaction, à la place des longueurs fixes du lot 5e.
  const prompt = fnBody(read(SEQUENCE_DRAFT), 'export function buildDraftPrompt(');
  assert.match(prompt, /draftStyleRules\(input\.style \?\? DEFAULT_WRITING_STYLE, skeleton, facts\)/);
  assert.doesNotMatch(prompt, /`- Longueurs : note d'invitation/);
  // prepare : coût de chaque niveau et défauts de la personne, sans débit.
  const prepare = fnBody(read(COMPOSE), 'async function prepare(');
  assert.match(prepare, /levels: levelChoices\(AI_ACTION, settings\),/);
  assert.match(prepare, /style: settings\.style,/);
  assert.doesNotMatch(prepare, /assertCredits|settleCredits|callClaudeCompat/);
});

test('text-action (séquence) : niveau avant le garde, modèle du niveau, consigne de style, contrôle de la proposition', () => {
  const src = read(TEXT_ACTION);
  const level = at(src, 'const resolved = resolveAiLevel(body.ai_level, settings);');
  const model = at(src, 'const modelId = sequenceLevel ? modelForLevel(sequenceLevel) : _aiParams.modelId;');
  const gate = at(src, 'const gate = await assertCredits({');
  const call = at(src, 'result = await callModel();');
  const settle = at(src, 'await settleCredits(adminClient, {');
  const review = at(src, 'const review = reviewTextProposal(');
  assert.ok(level < model && model < gate && gate < call && call < settle && settle < review);
  // Action fixée par le serveur, jamais _ai_action.
  assert.match(src.slice(gate, gate + 300), /\n\s*aiAction,\n/);
  assert.match(src, /'rewrite' \|\| action === 'restyle' \|\| SINGLE_TEXT_ACTIONS\.has\(action\) \? 'rewrite_text'/);
  assert.match(src, /action === 'restyle'\n\s*\? \['Style demandé :', buildStyleInstructions\(sequenceStyle, \{/);
  assert.match(src, /omitTone: sequenceContext,/);
  // Une réécriture « restyle » hors séquence n'existe pas.
  assert.match(src, /if \(!sequenceContext && action === 'restyle'\) \{\n\s*return json\(\{ error: 'Invalid action' \}, 400\);/);
});

test('generate-outreach-message : organisation vérifiée sans repli permissif, niveau, garde, contrôles bloquants', () => {
  const src = read(OUTREACH);
  const org = at(src, "if (!verifiedOrgId) return json({ error: ORG_REQUIRED_MESSAGE, error_code: 'AI_ORG_REQUIRED' }, 403);");
  const level = at(src, 'const resolvedLevel = resolveAiLevel(_body?.ai_level, settings);');
  const model = at(src, 'const modelId = modelForLevel(level);');
  const gate = at(src, 'const gate = await assertCredits({');
  const call = at(src, 'first = await callAnthropic(prompt);');
  const settleDef = at(src, 'const settleConsumed = async () => {');
  const settle = at(src, 'await settleCredits(svc, {');
  assert.ok(org < level && level < model && model < gate && gate < call);
  // Débit défini une fois (settleConsumed), appelé sur chaque sortie après un appel facturé :
  // correction en échec (429, 402 : le premier appel reste débité) et sortie normale.
  assert.ok(settleDef < settle && settle < call);
  const correctionFailed = at(src, 'if (second && !second.ok) {');
  assert.match(src.slice(correctionFailed, correctionFailed + 200), /await settleConsumed\(\);\n\s*return second\.response;/);
  assert.ok(at(src, 'await settleConsumed();\n\n    if (remainingBlocking.length > 0) {') > correctionFailed);
  assert.doesNotMatch(src, /if \(second && !second\.ok\) return second\.response;/);
  // Garde et débit sur l'organisation vérifiée, au modèle du niveau.
  assert.match(src.slice(gate, gate + 200), /organizationId: orgId,\n\s*aiAction: AI_ACTION,\n\s*modelId,/);
  assert.match(src.slice(settle, settle + 200), /organizationId: orgId, userId,\n\s*aiAction: AI_ACTION, modelId,/);
  assert.doesNotMatch(src, /resolveOrgIdFromUser/);
  // Organisation du corps refusée si l'appelant n'en est pas membre.
  assert.match(src, /error_code: 'AI_ORG_FORBIDDEN' \}, 403\)/);
  // Consigne de style prioritaire, plus aucun ton qui tutoie.
  assert.match(src, /=== STYLE DEMANDÉ \(PRIORITAIRE SUR LES EXEMPLES, LES LONGUEURS ET LES OBJECTIFS CI-DESSUS\) ===\n\$\{styleRules\}/);
  assert.doesNotMatch(src, /Tutoiement naturel|toneInstructions\[tone\]/);
  assert.match(src, /loadAndBuildAiContext\(svc, \{ userId, orgId, omitTone: true \}\)/);
  // Contrôles bloquants : moteur, tutoiement (noms connus masqués), note de 300 caractères ; même règle avant et après correction.
  const checks = at(src, 'const blockingViolations = (draft: { message: string; subject?: string }): string[] => {');
  assert.match(src.slice(checks, checks + 700), /detectSequenceViolations\(isRPO, draft\.message, draft\.subject\)/);
  assert.match(src.slice(checks, checks + 700), /hasTutoiement\(`\$\{draft\.subject \|\| ''\}\\n\$\{draft\.message \|\| ''\}`, knownNames\)/);
  assert.match(src.slice(checks, checks + 700), /INVITATION_NOTE_HARD_MAX\) labels\.push\(INVITE_TOO_LONG_LABEL\)/);
  assert.match(src, /const remainingBlocking = blockingViolations\(parsed\);/);
  // Délai : échéance de la requête, correction seulement s'il reste 30 s.
  assert.match(src, /const timeoutMs = Math\.min\(MODEL_TIMEOUT_MS, deadline - Date\.now\(\) - RESPONSE_MARGIN_MS\);/);
  assert.match(src, /if \(violations\.length > 0 && hasTimeForAiCorrection\(deadline, Date\.now\(\)\)\) \{/);
  // Lien d'agenda : variable seulement si la mission a un lien ; adresse fournie hors séquence.
  assert.match(src, /\? \(missionHasCalendlyLink \? 'variable' : 'none'\)\n\s*: \(calendlyLink \? 'url' : 'none'\);/);
  // Le navigateur attend la fin de la génération (90 s).
  const invoke = read(BROWSER_INVOKE);
  assert.match(invoke, /'generate-outreach-message',\n\s*'text-action',\n\]\);/);
});

test('draft_outreach_message : niveau par défaut de l’organisation (jamais choisi par le modèle), style, coût affiché', () => {
  const src = read(MUTATIONS);
  const tool = objectBlock(src, 'const draftOutreachMessage: AgentTool = {');
  const schema = tool.slice(at(tool, 'inputSchema: {'), at(tool, 'required:'));
  assert.doesNotMatch(schema, /ai_level/);
  assert.match(schema, /style: STYLE_INPUT_SCHEMA,/);
  const settings = fnBody(src, 'async function draftMessageSettings(');
  assert.match(settings, /ok: true,\n\s*level: settings\.defaultLevel,\n\s*maxLevel: settings\.maxLevel,\n\s*style:/);
  const dry = tool.slice(at(tool, 'async dryRun('), at(tool, 'async execute('));
  assert.match(dry, /estimated_credits: credits,/);
  assert.match(dry, /ai_level_label: AI_LEVEL_LABELS\[settings\.level\],/);
  const exec = tool.slice(at(tool, 'async execute('));
  const resolved = at(exec, 'const settings = await draftMessageSettings(params, ctx);');
  // Niveau de la carte approuvée (coût annoncé), refusé s'il dépasse le plafond relu ; jamais un autre niveau.
  const approved = at(exec, 'const approvedLevel = ctx.approvedDetails?.ai_level;');
  assert.match(exec.slice(approved, approved + 400), /levelRank\(approvedLevel\) > levelRank\(settings\.maxLevel\)\) \{\n\s*return \{ success: false, error: DRAFT_LEVEL_CHANGED_MESSAGE \};\n\s*\}\n\s*level = approvedLevel;/);
  assert.match(src, /const DRAFT_LEVEL_CHANGED_MESSAGE = 'Le niveau de rédaction a changé, demandez une nouvelle proposition\.';/);
  const model = at(exec, 'const modelId = modelForLevel(level);');
  const gate = at(exec, 'const gate = await assertCredits({');
  const call = at(exec, 'const result = await callClaudeCompat({');
  assert.ok(resolved < approved && approved < model && model < gate && gate < call);
  // Approbation immédiate (carte, Journal) : les détails de la carte arrivent à cet outil, qui les
  // demande ; les autres gardent la décision 34 (détails seulement sur le chemin programmé).
  assert.match(tool, /requiresApproval: true,\n[^\n]*\n\s*approvedDetailsOnConfirm: true,/);
  const registry = read(REGISTRY);
  const confirm = registry.slice(at(registry, 'export async function confirmToolExecution('), at(registry, 'export async function executeScheduledAction('));
  assert.match(confirm, /const approvedDetailsRaw = dryRunDetails\.details;/);
  assert.match(confirm, /\.\.\.\(tool\.approvedDetailsOnConfirm\n\s*\? \{\n\s*approvedDetails: approvedDetailsRaw && typeof approvedDetailsRaw === 'object' && !Array\.isArray\(approvedDetailsRaw\)/);
});

test('create_sequence : modèle de la conversation au-dessus du plafond refusé à la proposition ; règles de style lues par l’assistant', () => {
  const registry = read(REGISTRY);
  assert.match(registry, /modelId\?: string \| null;/);
  const chat = read(CHAT);
  assert.match(chat, /modelId: normalizeModelId\(resolvedModel\),/);
  assert.match(chat, /Tout message d'approche à un candidat passe par draft_outreach_message/);
  const src = read(MUTATIONS);
  const tool = objectBlock(src, 'const createSequence: AgentTool = {');
  const verify = tool.slice(at(tool, 'async verifyAccess('), at(tool, 'async dryRun('));
  assert.match(verify, /if \(ctx\.modelId\) \{\n\s*const refusal = await conversationLevelRefusal\(ctx\.modelId, ctx\);/);
  const refusal = fnBody(src, 'async function conversationLevelRefusal(');
  assert.match(refusal, /if \(!settings\.ok\) return /, 'plafond illisible : refus');
  assert.match(refusal, /levelRank\(level\) <= levelRank\(settings\.maxLevel\)/);
  // Aucun style déclaré par le modèle sur la carte : pas d'entrée style.
  const schema = tool.slice(at(tool, 'inputSchema: {'), at(tool, 'required:'));
  assert.doesNotMatch(schema, /style/);
  assert.doesNotMatch(tool, /200 to 400 characters|200 to 350 characters/);
  const facts = objectBlock(src, 'const getSequenceDraftFacts: AgentTool = {');
  assert.match(facts, /style_rules: \{\n\s*invitation: draftStyleRules\(style,/);
});

test('vouvoiement : tutoiement refusé (pas seulement signalé), noms propres connus masqués ; contexte IA sans ton imposé', () => {
  const check = fnBody(read(SEQUENCE_DRAFT), 'export function checkDraftTexts(');
  assert.match(check, /if \(hasTutoiement\(plain, \[ctx\.organizationName, \.\.\.\(ctx\.knownNames \?\? \[\]\)\]\)\) \{\n\s*refuse\(field, 'tutoiement'/);
  assert.doesNotMatch(check, /warn\(field, 'tutoiement'/);
  const style = read(STYLE);
  const tutoiement = fnBody(style, 'export function hasTutoiement(');
  assert.match(tutoiement, /masked = masked\.replace\(word\(pattern, 'giu'\), 'Xx'\);/);
  // Anciens tons : jamais de tutoiement ni de « spontané ».
  const legacy = fnBody(style, 'export function styleFromLegacyTone(');
  assert.match(legacy, /case 'tu':\n\s*return \{ tone: 'chaleureux', spontaneity: 'naturel' \};/);
  const ctx = read(AI_CONTEXT);
  assert.match(ctx, /const cacheKey = `\$\{orgId \|\| "-"\}\|\$\{userId \|\| "-"\}\$\{omitTone \? "\|sans-ton" : ""\}`;/);
  assert.match(ctx, /if \(omitTone\) ctx = \{ \.\.\.ctx, tone: null \};/);
});

test('niveaux de l’organisation : agency_permissions.ai_writing, aucune migration, audit des écritures', () => {
  const settings = read(SETTINGS);
  assert.match(settings, /admin\.from\('organizations'\)\.select\('agency_permissions'\)/);
  assert.match(read(STYLE), /isRecord\(agencyPermissions\.ai_writing\)/);
  const migrations = readdirSync(join(ROOT, 'supabase/migrations'));
  for (const name of migrations) {
    const sql = read(`supabase/migrations/${name}`);
    assert.doesNotMatch(sql, /ai_writing_level/, `${name} : migration de niveau inattendue (rangé dans agency_permissions)`);
  }
  const audit = read(ORG_AUDIT);
  assert.match(audit, /-- 4b\. Niveau de l'IA qui rédige/);
  assert.match(audit, /'\{"ai_writing": \{"level": "avance", "max": "avance"\}\}'::jsonb/);
  assert.match(audit, /-- 10b\. Niveau de l'IA qui rédige/);
  assert.match(audit, /RAISE NOTICE 'org_writes_audit : 20 contrôles OK';/);
});

// ─── Compléments : réglages lus par chaque rédacteur, refus, textes, CI ─────

/** Littéraux de chaîne d'un code sans commentaires ni imports. */
function stringLiterals(code) {
  const src = code.replace(/^import .*$/gm, '');
  return [...src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

const MODEL_NAME_RE = /\b(?:Claude|Haiku|Sonnet|Opus|Anthropic)\b/;

test('chaque rédacteur lit les réglages de l’appelant (jamais d’un utilisateur venu du corps), fusionne le style demandé', () => {
  const compose = read(COMPOSE);
  for (const name of ['async function prepare(', 'async function draft(']) {
    const body = fnBody(compose, name);
    assert.match(body, /loadWritingSettings\(admin, \{ organizationId, userId: ctx\.userId \}\)/, name);
    // Lecture en échec : refus, jamais un niveau supposé.
    assert.match(body, /if \(!settings\.ok\) return json\(\{ error: SETTINGS_UNAVAILABLE_MESSAGE, error_code: "AI_SETTINGS_UNAVAILABLE" \}, 503\);/, name);
  }
  const text = read(TEXT_ACTION);
  assert.match(text, /const settings = await loadWritingSettings\(adminClient, \{ organizationId: body\.organization_id!, userId: userId! \}\);/);
  assert.match(text, /if \(!settings\.ok\) return json\(\{ error: SETTINGS_UNAVAILABLE_MESSAGE, error_code: 'AI_SETTINGS_UNAVAILABLE' \}, 503\);/);
  assert.match(text, /sequenceStyle = mergeStyle\(settings\.style, styleOverrides\);/);
  // userId de text-action : celui du jeton (requireAuth).
  assert.match(text, /const \{ userId, method: authMethod \} = await requireAuth\(req, corsHeaders\);/);
  const outreach = read(OUTREACH);
  assert.match(outreach, /const settings = await loadWritingSettings\(svc, \{ organizationId: orgId, userId \}\);/);
  assert.match(outreach, /const userId = claimsData\.user\.id;/);
  assert.match(outreach, /const style = mergeStyle\(mergeStyle\(settings\.style, legacyTone\), parsedStyle\.overrides\);/);
  // Ancien ton : converti seulement sans style, jamais au tutoiement (styleFromLegacyTone).
  assert.match(outreach, /const legacyTone = _body\?\.style == null && tone !== 'professional' \? styleFromLegacyTone\(tone\) : \{\};/);
  const mutations = read(MUTATIONS);
  const draftSettings = fnBody(mutations, 'async function draftMessageSettings(');
  assert.match(draftSettings, /loadWritingSettings\(ctx\.adminClient, \{ organizationId: ctx\.organizationId, userId: ctx\.userId \}\)/);
  assert.match(draftSettings, /mergeStyle\(mergeStyle\(settings\.style, legacy\), overrides\.overrides\)/);
  const facts = objectBlock(mutations, 'const getSequenceDraftFacts: AgentTool = {');
  assert.match(facts, /loadWritingSettings\(ctx\.adminClient, \{ organizationId: ctx\.organizationId, userId: ctx\.userId \}\)/);
  assert.match(facts, /const style = mergeStyle\(settings\.style, overrides\.overrides\);/);
  const refusal = fnBody(mutations, 'async function conversationLevelRefusal(');
  assert.match(refusal, /loadWritingSettings\(ctx\.adminClient, \{ organizationId: ctx\.organizationId, userId: ctx\.userId \}\)/);
  // writing-settings : le profil par user_id de l'appelant, l'organisation par son identifiant.
  const settings = read(SETTINGS);
  assert.match(settings, /admin\.from\('profiles'\)\.select\('ai_context'\)\.eq\('user_id', params\.userId\)\.maybeSingle\(\)/);
  assert.match(settings, /\.eq\('id', params\.organizationId\)\.maybeSingle\(\)/);
});

test('style d’une requête analysé strictement avant tout appel, dans chaque rédacteur HTTP', () => {
  assert.match(fnBody(read(SEQUENCE_DRAFT), 'export function parseDraftRequest('), /const style = parseStyleOverrides\(b\.style\);\n\s*if \(!style\.ok\) return style;/);
  const text = read(TEXT_ACTION);
  const parsed = at(text, 'const parsedStyle = parseStyleOverrides(body.style);');
  assert.ok(parsed < at(text, 'const gate = await assertCredits({'));
  const outreach = read(OUTREACH);
  assert.ok(at(outreach, 'const parsedStyle = parseStyleOverrides(_body?.style);') < at(outreach, 'const gate = await assertCredits({'));
  assert.match(outreach, /if \(!parsedStyle\.ok\) return json\(\{ error: parsedStyle\.error, error_code: parsedStyle\.code \}, parsedStyle\.status\);/);
});

test('débit sur le modèle appelé, jamais sur un modèle par défaut', () => {
  const text = read(TEXT_ACTION);
  const settle = text.slice(at(text, 'const settled = await settleCredits(adminClient, {'));
  assert.match(settle.slice(0, 300), /modelId: result\.model \|\| modelId,/);
  const draft = objectBlock(read(MUTATIONS), 'const draftOutreachMessage: AgentTool = {');
  const exec = draft.slice(at(draft, 'async execute('));
  assert.ok(at(exec, 'const gate = await assertCredits({') < at(exec, 'await settleClaudeUsage({'));
  assert.match(exec, /aiAction: 'outreach_message',\n\s*modelId,\n\s*adminClient: ctx\.adminClient,/);
  assert.match(exec, /model: getAnthropicModelId\(modelId\),/);
  assert.match(exec, /usage: result\.usage,\n\s*modelId: result\.model,/);
});

test('textes visibles des rédacteurs : aucun nom de modèle ni de prestataire', () => {
  for (const rel of [STYLE, SETTINGS, COMPOSE]) {
    for (const literal of stringLiterals(codeOnly(read(rel)))) {
      assert.doesNotMatch(literal, MODEL_NAME_RE, `${rel} : « ${literal.slice(0, 80)} »`);
    }
  }
  // Messages d'erreur rendus par text-action et generate-outreach-message.
  for (const rel of [TEXT_ACTION, OUTREACH]) {
    const code = codeOnly(read(rel));
    const messages = [
      ...[...code.matchAll(/const [A-Z_]+_MESSAGE = (['"`])((?:(?!\1).)*)\1/g)].map((m) => m[2]),
      ...[...code.matchAll(/error: (['"`])((?:(?!\1).)*)\1/g)].map((m) => m[2]),
    ];
    assert.ok(messages.length > 3, `${rel} : messages trouvés`);
    for (const message of messages) assert.doesNotMatch(message, MODEL_NAME_RE, `${rel} : « ${message} »`);
  }
  // Refus et résumés des outils de l'assistant : niveaux nommés par leur libellé.
  const mutations = codeOnly(read(MUTATIONS));
  for (const block of [
    fnBody(mutations, 'async function draftMessageSettings('),
    fnBody(mutations, 'async function conversationLevelRefusal('),
    objectBlock(mutations, 'const draftOutreachMessage: AgentTool = {').split('async execute(')[0],
  ]) {
    for (const literal of stringLiterals(block)) assert.doesNotMatch(literal, MODEL_NAME_RE, literal);
  }
  assert.match(fnBody(mutations, 'async function conversationLevelRefusal('), /AI_LEVEL_LABELS\[level\]/);
  const style = read(STYLE);
  assert.match(style, /rapide: 'Rapide',\n\s*equilibre: 'Équilibré',\n\s*avance: 'Avancé',/);
});

test('vouvoiement imposé par chaque rédacteur ; aucun réglage ni ton n’ouvre le tutoiement', () => {
  const style = read(STYLE);
  assert.match(style, /tone: \['formel', 'chaleureux', 'direct'\],/);
  assert.doesNotMatch(objectBlock(style, 'export const STYLE_VALUES: Readonly<{'), /'tu'|tutoi/);
  assert.match(fnBody(style, 'export function buildStyleInstructions('), /const lines: string\[\] = \[VOUVOIEMENT_LINE\];/);
  // Rédaction de séquence.
  assert.match(fnBody(read(SEQUENCE_DRAFT), 'export function buildDraftPrompt('), /- Vouvoiement obligatoire dans chaque texte/);
  // « Demander à l'IA » : règle écrite, ton familier refusé.
  const text = read(TEXT_ACTION);
  assert.match(text, /"- Vouvoiement obligatoire dans le texte, même si le texte d'origine tutoie ou si un autre ton est indiqué plus haut\."/);
  assert.match(text, /if \(body\.tone === 'casual'\) \{\n\s*return json\(\{ error: SEQUENCE_TONE_REFUSED_MESSAGE, error_code: 'SEQUENCE_TONE_REFUSED' \}, 400\);/);
  // Messages par candidat : tutoiement bloquant, corrigé une fois puis refusé.
  const outreach = read(OUTREACH);
  assert.match(outreach, /'- Vouvoiement obligatoire : jamais de tutoiement, quel que soit le style\.'/);
  // Brouillon de l'assistant : tons vouvoyés seulement, refus du tutoiement.
  const mutations = read(MUTATIONS);
  const draft = objectBlock(mutations, 'const draftOutreachMessage: AgentTool = {');
  assert.match(draft, /enum: \['professional', 'concise'\],/);
  assert.match(draft, /- Vouvoiement obligatoire, jamais de tutoiement/);
  assert.match(draft, /i\.severity === 'refuse' \|\| i\.code === 'tutoiement'/);
  const schema = objectBlock(mutations, 'const STYLE_INPUT_SCHEMA = {');
  assert.match(schema, /tone: \{ type: 'string', enum: \[\.\.\.STYLE_VALUES\.tone\] \}/);
  // create_sequence : la consigne de l'outil l'écrit, les textes qui tutoient sont refusés (checkDraftTexts).
  const create = objectBlock(mutations, 'const createSequence: AgentTool = {');
  assert.match(create, /always addressing the ` \+\n\s*"candidate with 'vous' \(vouvoiement\), never 'tu': a text that uses 'tu' is refused\./);
});

test('CI : la garde du lot 5e-2 tourne avec celle du lot 5e, le test des écrans dans le job build', () => {
  const ci = read('.github/workflows/ci.yml');
  const agent = ci.slice(ci.indexOf('agent-safety:'), ci.indexOf('\n  migrations:'));
  assert.match(agent, /run: node --test tests\/c1\/lot5e-redaction\.test\.mjs/);
  assert.match(agent, /run: node --test tests\/c1\/lot5e2-style-niveau\.test\.mjs/);
  const build = ci.slice(ci.indexOf('\n  build:'), ci.indexOf('\n  typecheck:'));
  assert.match(build, /node --test tests\/ux\/lot5e2-style-niveau\.test\.mjs/);
});

test('generate-outreach-message : canal hors séquence fermé (message_kind), prioritaire sur le premier message par défaut', () => {
  const src = read(OUTREACH);
  assert.match(src, /if \(rawMessageKind !== undefined && rawMessageKind !== null && rawMessageKind !== 'message' && rawMessageKind !== 'inmail'\) \{\n\s*return json\(\{ error: 'Type de message inconnu\. Rechargez la page\.', error_code: 'MESSAGE_KIND_INVALID' \}, 400\);/);
  // Le type d'étape d'une séquence reste prioritaire ; sinon le canal demandé ; sinon premier message.
  assert.match(src, /const currentActionType = sequenceContext\?\.currentActionType \|\| messageKind \|\| 'message';/);
  assert.match(src, /const at = \(sequenceContext\?\.currentActionType \|\| messageKind \|\| ''\)\.toLowerCase\(\);/);
  // Lu avant tout appel au modèle et tout débit.
  assert.ok(at(src, "error_code: 'MESSAGE_KIND_INVALID'") < at(src, 'const gate = await assertCredits({'));
});

test('appel à l’action « question ouverte » : jamais d’argent ; attentes salariales refusées par les deux gardes', () => {
  assert.match(read('supabase/functions/_shared/writing-style.ts'), /jamais sur la rémunération ni les attentes salariales\./);
  const rules = read('supabase/functions/_shared/sequence-send-rules.ts');
  assert.match(rules, /export const SALARY_EXPECTATION_SRC =/);
  assert.match(rules, /\.test\(text\) \|\| SALARY_EXPECTATION_RE\.test\(text\)\) \{\n\s*add\('mention de salaire\/rémunération', true\);/);
  const draftSrc = read('supabase/functions/_shared/sequence-draft.ts');
  assert.match(draftSrc, /import \{ SALARY_EXPECTATION_SRC, detectSequenceViolations \} from '\.\/sequence-send-rules\.ts';/);
  assert.match(draftSrc, /word\(SALARY_EXPECTATION_SRC\),/);
});
