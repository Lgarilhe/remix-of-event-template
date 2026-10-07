/**
 * Lot 5e-2 : style des messages rédigés par l'IA et niveau de l'IA qui rédige,
 * prouvés contre la stack locale pour chaque rédacteur de prise de contact :
 * draft-sequence (draft), text-action en contexte séquence (« Demander à
 * l'IA »), generate-outreach-message (messages IA par candidat), et les outils
 * de l'assistant draft_outreach_message et create_sequence.
 *
 * Contrat (docs/refonte-mission/lot5-plan.md, section 5e-2, « Tests à écrire ») :
 * - chaque rédacteur appelle le modèle de son niveau (Rapide, Équilibré,
 *   Avancé), lu dans le journal du faux modèle ; `_ai_model` d'un modèle
 *   supérieur est ignoré ;
 * - niveau au-dessus du plafond de l'organisation : 403 AI_LEVEL_NOT_ALLOWED,
 *   sans appel au modèle ni débit, jamais rétrogradé en silence ; valeur hors
 *   liste : 400 ;
 * - coût annoncé (prepare, carte de l'assistant, barème des niveaux) égal au
 *   coût débité, par niveau, quand le modèle consomme le volume type de
 *   l'action (réponse scriptée avec ses jetons) ; 402 sur l'estimation du
 *   niveau, sans appel ;
 * - consigne de style présente dans la requête au modèle ; défauts de la
 *   personne appliqués quand la requête n'envoie pas de style ; défauts d'une
 *   autre personne de l'organisation jamais lus ;
 * - generate-outreach-message : sans organisation vérifiée (organisation
 *   active nulle, aucune dans le corps) ou organisation d'autrui, 403 sans
 *   appel ;
 * - draft_outreach_message : niveau par défaut de l'organisation, jamais choisi
 *   par le modèle de la conversation ; coût de la carte égal au débit ;
 * - create_sequence : conversation dont le modèle dépasse le plafond refusée à
 *   la proposition ;
 * - niveaux de l'organisation (agency_permissions.ai_writing) : écriture par
 *   l'API refusée à l'administrateur (ORG_OWNER_ONLY), sans effet pour un
 *   membre, permise au propriétaire et lue aussitôt par les rédacteurs.
 *
 * Réponses du faux modèle (e2e/local-stack/vendor-mock.mjs) : par marqueur,
 * placé dans ce que lit le modèle (contexte IA de l'organisation, texte de
 * l'étape, profil du candidat). Pour le coût, une route de la clé « * »
 * (`times: 1`, jetons du volume type) répond au seul appel suivant ; elle est
 * retirée après chaque test. Elle vaut pour tout appel au modèle : ce fichier
 * se joue sur un seul worker, comme toute la stack locale (`--workers=1` sous
 * le verrou), sans quoi un autre test pourrait la consommer. Chaque test a sa
 * propre organisation. Ignoré sans
 * la stack locale ; les blocs de l'assistant passent par la sonde Deno
 * e2e/helpers/agent-tool-probe.ts (DENO_BIN, sinon deno, sinon npx deno).
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { E2E } from '../helpers/env';
import {
  addMember,
  admin,
  createOrg,
  deleteOrg,
  seedMission,
  setOrgPlan,
  signIn,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import {
  ENGINE_SKIP_REASON,
  MOCK_URL,
  callFunction,
  engineAvailable,
  mockCalls,
  rand,
  setMockMode,
  type MockCall,
} from '../helpers/sequence-engine';
import { WRITING_LEVEL_MODELS, getAnthropicModelId } from '../../supabase/functions/_shared/ai-config';

test.skip(!engineAvailable, ENGINE_SKIP_REASON);
test.setTimeout(240_000);

type Json = Record<string, unknown>;
type Level = keyof typeof WRITING_LEVEL_MODELS;
const LEVELS: Level[] = ['rapide', 'equilibre', 'avance'];
const LABELS: Record<Level, string> = { rapide: 'Rapide', equilibre: 'Équilibré', avance: 'Avancé' };

/** Identifiant envoyé au modèle pour un niveau (table unique d'ai-config.ts). */
const modelOf = (level: Level) => getAnthropicModelId(WRITING_LEVEL_MODELS[level]);

/** Barème annoncé par niveau (formule du garde des crédits, épinglée par writing-style.test.ts). */
const COSTS = {
  sequence_draft: { rapide: 3, equilibre: 7, avance: 11 },
  outreach_message: { rapide: 2, equilibre: 5, avance: 8 },
  rewrite_text: { rapide: 1, equilibre: 2, avance: 3 },
} as const;
/** Volume type de chaque action (ACTION_COSTS.typicalTokens) : consommé, il coûte exactement l'estimation. */
const TYPICAL_TOKENS = { sequence_draft: 7_000, outreach_message: 5_000, rewrite_text: 1_500 } as const;

const NOT_ALLOWED_AVANCE = "Votre organisation n'autorise pas le niveau Avancé. Choisissez Rapide ou Équilibré.";

const JOB = {
  title: 'Directeur financier',
  mission_description: 'Piloter deux acquisitions dans les 18 mois et structurer la direction financière du groupe.',
  context: 'Création du poste dans un groupe industriel en croissance.',
  team_size: 14,
  reports_to: 'Président',
  seniority: 'Senior',
  location: 'Lyon',
  contract_type: 'cdi',
  skills_must_have: ['Consolidation', 'Fusions et acquisitions'],
};

const GOOD_INVITATION = JSON.stringify({
  invitation_note: 'Bonjour {{prenom}}, je recrute un directeur financier à Lyon pour un groupe industriel. Votre parcours m’a donné envie d’échanger. {{mon_prenom}}',
  first_message: { body: 'Bonjour {{prenom}},\n\nJ’accompagne un groupe industriel qui cherche son directeur financier, rattaché au président, avec deux acquisitions à mener. Cela vous parlerait-il ?\n\n{{mon_prenom}}' },
  relances: [
    { body: 'Bonjour {{prenom}}, je reviens vers vous au sujet du poste de {{poste_recherche}} : une équipe de 14 personnes et deux acquisitions à piloter. Seriez-vous curieux d’en savoir plus ?\n\n{{mon_prenom}}' },
    { body: 'Bonjour {{prenom}}, dernier message de ma part sur ce poste de {{poste_recherche}}. Si le moment n’est pas le bon, je le comprends tout à fait.\n\n{{mon_prenom}}' },
  ],
});
const PROPOSAL = 'Bonjour {{prenom}}, un poste de directeur financier à Lyon vous intéresserait-il ? {{mon_prenom}}';
const OUTREACH_REPLY = (name: string) => JSON.stringify({
  subject: '',
  message: `Bonjour ${name}, une mission de direction financière à Lyon pourrait vous parler. Seriez-vous ouvert à en échanger ?`,
  personalization_points: [],
});
const ASSISTANT_DRAFT = JSON.stringify({
  subject: null,
  body: 'Bonjour Camille, votre parcours en consolidation m’a frappé. Un poste de directeur financier à Lyon pourrait vous parler. Seriez-vous ouvert à en échanger ?',
});

// ─── Nettoyage ──────────────────────────────────────────────────────────────

const tracked: Array<{ org: TestOrg; extra: TestUser[] }> = [];
const cleanups: Array<() => PromiseLike<unknown>> = [];

test.afterEach(async () => {
  while (cleanups.length) await Promise.resolve(cleanups.pop()!()).catch(() => undefined);
  // Route de jetons non consommée : jamais laissée au test suivant.
  await setMockMode('*', {});
  while (tracked.length) {
    const { org, extra } = tracked.pop()!;
    for (const table of ['agent_tool_executions', 'job_candidate_status', 'ai_credit_transactions', 'ai_credit_balances', 'organization_subscriptions']) {
      await admin().from(table).delete().eq('organization_id', org.orgId);
    }
    await deleteOrg(org, extra).catch(() => undefined);
  }
});

// ─── Aides ──────────────────────────────────────────────────────────────────

async function newOrg(credits = 60): Promise<{ org: TestOrg; token: string; extra: TestUser[] }> {
  const org = await createOrg('agency', 'E2E style et niveau');
  const entry = { org, extra: [] as TestUser[] };
  tracked.push(entry);
  await setOrgPlan(org.orgId, 'cabinet');
  await setCredits(org.orgId, credits);
  return { org, token: await tokenOf(org.owner), extra: entry.extra };
}

async function tokenOf(user: TestUser): Promise<string> {
  return (await signIn(user.email, user.password)).access_token;
}

async function setCredits(orgId: string, credits: number) {
  const end = new Date(Date.now() + 20 * 86_400_000).toISOString();
  const { error } = await admin().from('ai_credit_balances').upsert({
    organization_id: orgId, plan_credits: credits, topup_credits: 0, credits_total: credits, credits_remaining: credits,
    period_start: new Date().toISOString(), period_end: end,
  }, { onConflict: 'organization_id' });
  if (error) throw new Error(`ai_credit_balances : ${error.message}`);
}

/** Niveau par défaut et niveau maximal de l'organisation (réglage du propriétaire). */
async function setLevels(orgId: string, level: Level, max: Level) {
  const { error } = await admin().from('organizations').update({ agency_permissions: { ai_writing: { level, max } } }).eq('id', orgId);
  if (error) throw new Error(`agency_permissions : ${error.message}`);
}

/** « Votre style » d'une personne (Paramètres › Rédaction). */
async function setStyle(userId: string, style: Json) {
  const { error } = await admin().from('profiles').update({ ai_context: { writing_style: style } }).eq('user_id', userId);
  if (error) throw new Error(`profiles.ai_context : ${error.message}`);
}

/** Réponse du faux modèle à toute requête qui contient le marqueur (clé fictive propre au test). */
async function scriptModel(marker: string, text: string) {
  const key = `ai-${marker}`;
  await setMockMode(key, { ai_markers: { [marker]: text } });
  cleanups.push(() => setMockMode(key, { ai_markers: {} }));
}

/**
 * Le seul appel au modèle suivant répond `text` en consommant `totalTokens`
 * jetons, avec l'identifiant du modèle du niveau (le prestataire le renvoie).
 */
async function scriptUsageOnce(level: Level, text: string, totalTokens: number) {
  await setMockMode('*', {
    routes: [{
      method: 'POST', path: '^/v1/messages$', times: 1, status: 200,
      body: {
        id: `msg_usage_${rand()}`, type: 'message', role: 'assistant', model: modelOf(level),
        content: [{ type: 'text', text }], stop_reason: 'end_turn',
        usage: { input_tokens: totalTokens - 400, output_tokens: 400 },
      },
    }],
  });
}

/** Marqueur dans le contexte IA de l'organisation, lu par la consigne de la rédaction. */
async function markOrgContext(orgId: string, marker: string) {
  const { error } = await admin().from('organizations').update({ ai_context: { free_text: `Cabinet ${marker}, recrutement de cadres.` } }).eq('id', orgId);
  if (error) throw new Error(`ai_context : ${error.message}`);
}

async function aiCallsWith(marker: string): Promise<MockCall[]> {
  return (await mockCalls()).filter((c) => c.method === 'POST' && c.path === '/v1/messages' && JSON.stringify(c.body).includes(marker));
}

/** Modèle et consigne de l'unique appel qui porte le marqueur. */
async function onlyCallWith(marker: string): Promise<{ model: string; prompt: string }> {
  const calls = await aiCallsWith(marker);
  expect(calls, `un seul appel au modèle pour ${marker}`).toHaveLength(1);
  return { model: String((calls[0].body as Json).model), prompt: JSON.stringify(calls[0].body) };
}

/**
 * Le nouvel appel qui porte le marqueur, après `before` appels déjà vus :
 * exactement un. Le contexte IA de l'organisation (où vit le marqueur de la
 * rédaction) reste en cache cinq minutes dans la fonction : un seul marqueur
 * par organisation, posé avant le premier appel.
 */
async function newCallWith(marker: string, before: number): Promise<{ model: string; prompt: string }> {
  const calls = await aiCallsWith(marker);
  expect(calls.length - before, `un seul nouvel appel au modèle pour ${marker}`).toBe(1);
  const last = calls[calls.length - 1];
  return { model: String((last.body as Json).model), prompt: JSON.stringify(last.body) };
}

async function debits(orgId: string, action: string) {
  const { data } = await admin()
    .from('ai_credit_transactions')
    .select('credits_used, model_id, created_at')
    .eq('organization_id', orgId)
    .eq('action', action)
    .order('created_at', { ascending: true });
  return (data ?? []) as Array<{ credits_used: number; model_id: string | null }>;
}

const draftSequence = (token: string, body: Json) => callFunction('draft-sequence', token, body);
const textAction = (token: string, body: Json) => callFunction('text-action', token, body);
const outreach = (token: string, body: Json) => callFunction('generate-outreach-message', token, body);

function textBody(orgId: string, marker: string, over: Json = {}): Json {
  return {
    action: 'shorten', context: 'sequence', organization_id: orgId,
    text: `Bonjour {{prenom}}, je vous écris au sujet d’un poste de direction financière à Lyon, ${marker}. {{mon_prenom}}`,
    step: { action_type: 'message', is_first_message: false },
    ...over,
  };
}

function outreachBody(marker: string, over: Json = {}): Json {
  return {
    profile: { name: 'Lucie Martin', headline: `Ingénieure financière ${marker}`, currentCompany: 'Groupe Rhône', location: 'Lyon' },
    job: { title: 'Directeur financier', skills: ['Consolidation'], location: 'Lyon' },
    ...over,
  };
}

// ─── Sonde de l'assistant ───────────────────────────────────────────────────

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function denoCommand(): { cmd: string; pre: string[] } {
  if (process.env.DENO_BIN) return { cmd: process.env.DENO_BIN, pre: [] };
  try {
    execFileSync('deno', ['--version'], { stdio: 'ignore' });
    return { cmd: 'deno', pre: [] };
  } catch {
    return { cmd: 'npx', pre: ['-y', 'deno'] };
  }
}

interface ProposedCall {
  outcome: 'executed_inline' | 'awaiting_approval' | 'denied';
  executionId?: string;
  payload: { error?: unknown } & Json;
}

/** Appel d'outil traité comme search-agent-chat le traite, avec le modèle de la conversation. */
function proposeLikeChat(orgId: string, user: TestUser, tool: string, params: Json, modelId: string | null = null): ProposedCall {
  const { cmd, pre } = denoCommand();
  const out = execFileSync(cmd, [
    ...pre, 'run', '-A', '--no-check',
    `--import-map=${REPO_ROOT}e2e/local-stack/import_map.json`,
    `${REPO_ROOT}e2e/helpers/agent-tool-probe.ts`,
  ], {
    input: JSON.stringify({ tool, params, userId: user.userId, organizationId: orgId, userBearer: null, modelId }),
    env: {
      ...process.env,
      SUPABASE_URL: E2E.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: E2E.serviceRoleKey,
      VENDOR_MOCK_URL: MOCK_URL,
      APP_URL: 'http://localhost:8080',
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
    },
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const line = out.split('\n').find((l) => l.startsWith('__PROBE__'));
  if (!line) throw new Error(`sonde sans résultat : ${out.slice(-2000)}`);
  return JSON.parse(line.slice('__PROBE__'.length)) as ProposedCall;
}

async function dryRunDetails(executionId: string): Promise<Json> {
  const { data } = await admin().from('agent_tool_executions').select('dry_run_result').eq('id', executionId).single();
  return ((data?.dry_run_result as { details?: Json } | null)?.details ?? {}) as Json;
}

function approve(token: string, executionId: string) {
  return callFunction('agent-tool-action', token, { execution_id: executionId, action: 'approve' });
}

async function seedCandidate(orgId: string, createdBy: string, projectId: string, name: string): Promise<string> {
  const candidateId = `ACoAAE2E${rand()}${rand()}`;
  const { error } = await admin().from('job_candidate_status').insert({
    organization_id: orgId, created_by: createdBy, candidate_id: candidateId, candidate_name: name,
    candidate_headline: 'Responsable consolidation', job_id: `project:${projectId}`, project_id: projectId,
    status: 'new', pipeline_stage: 'Nouveau',
  });
  if (error) throw new Error(`seedCandidate : ${error.message}`);
  return candidateId;
}

// ═══ draft-sequence ══════════════════════════════════════════════════════════

test.describe('draft-sequence : niveau et style (lot 5e-2)', () => {
  test('@critical prepare annonce le coût de chaque niveau ; draft appelle le modèle du niveau et débite le coût annoncé', async () => {
    const { org, token } = await newOrg(60);
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Directeur financier', job_details: JOB });

    const prepared = await draftSequence(token, { action: 'prepare', organization_id: org.orgId, mission_id: missionId });
    expect(prepared.status, JSON.stringify(prepared.body)).toBe(200);
    // Organisation sans réglage : Équilibré par défaut, tout ouvert.
    expect(prepared.body).toMatchObject({ level: 'equilibre', level_label: 'Équilibré', max_level: 'avance', has_calendly_link: false });
    expect(prepared.body.levels).toEqual(LEVELS.map((id) => ({ id, label: LABELS[id], credits: COSTS.sequence_draft[id], allowed: true })));
    expect((prepared.body.cost as Json).estimated).toBe(COSTS.sequence_draft.equilibre);
    const announced = Object.fromEntries((prepared.body.levels as Array<{ id: Level; credits: number }>).map((l) => [l.id, l.credits]));

    const marker = `Lumen${rand()}`;
    await markOrgContext(org.orgId, marker);
    for (const level of LEVELS) {
      const before = (await aiCallsWith(marker)).length;
      await scriptUsageOnce(level, GOOD_INVITATION, TYPICAL_TOKENS.sequence_draft);
      const res = await draftSequence(token, { action: 'draft', organization_id: org.orgId, mission_id: missionId, ai_level: level, profile_visit: false });
      expect(res.status, `${level} : ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body).toMatchObject({ level, level_label: LABELS[level], correction: false });
      const { model } = await newCallWith(marker, before);
      expect(model, `${level} : modèle appelé`).toBe(modelOf(level));
      const charged = await debits(org.orgId, 'sequence_draft');
      const last = charged[charged.length - 1];
      expect(last.credits_used, `${level} : débit = coût annoncé`).toBe(announced[level]);
      expect((res.body.credits as Json).used).toBe(announced[level]);
      expect(last.model_id).toBe(WRITING_LEVEL_MODELS[level]);
    }
    expect(await debits(org.orgId, 'sequence_draft')).toHaveLength(3);
  });

  test('@critical plafond Équilibré : Avancé refusé (403) sans appel ni débit ; défaut de l’organisation appliqué, _ai_model ignoré', async () => {
    const { org, token } = await newOrg(60);
    await setLevels(org.orgId, 'rapide', 'equilibre');
    const marker = `Lumen${rand()}`;
    await scriptModel(marker, GOOD_INVITATION);
    await markOrgContext(org.orgId, marker);
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Directeur financier', job_details: JOB });

    const prepared = await draftSequence(token, { action: 'prepare', organization_id: org.orgId, mission_id: missionId });
    expect(prepared.body).toMatchObject({ level: 'rapide', max_level: 'equilibre' });
    expect((prepared.body.levels as Array<{ id: string; allowed: boolean }>).map((l) => [l.id, l.allowed])).toEqual([['rapide', true], ['equilibre', true], ['avance', false]]);
    expect((prepared.body.cost as Json).estimated).toBe(COSTS.sequence_draft.rapide);

    const above = await draftSequence(token, { action: 'draft', organization_id: org.orgId, mission_id: missionId, ai_level: 'avance' });
    expect(above.status, JSON.stringify(above.body)).toBe(403);
    expect(above.body).toEqual({ error: NOT_ALLOWED_AVANCE, error_code: 'AI_LEVEL_NOT_ALLOWED' });
    for (const [bad, code] of [[{ ai_level: 'expert' }, 'AI_LEVEL_INVALID'], [{ ai_level: 'Avancé' }, 'AI_LEVEL_INVALID'], [{ style: { tone: 'tutoiement' } }, 'STYLE_INVALID']] as const) {
      const res = await draftSequence(token, { action: 'draft', organization_id: org.orgId, mission_id: missionId, ...bad });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error_code).toBe(code);
    }
    expect(await aiCallsWith(marker), 'aucun appel au modèle').toEqual([]);
    expect(await debits(org.orgId, 'sequence_draft'), 'aucun débit').toEqual([]);

    // Sans niveau demandé, avec un modèle supérieur glissé dans le corps : défaut de l'organisation (Rapide).
    const res = await draftSequence(token, { action: 'draft', organization_id: org.orgId, mission_id: missionId, _ai_model: 'claude-opus-5-5' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.level).toBe('rapide');
    expect((await onlyCallWith(marker)).model).toBe(modelOf('rapide'));
    const charged = await debits(org.orgId, 'sequence_draft');
    expect(charged).toHaveLength(1);
    expect(charged[0].model_id).toBe(WRITING_LEVEL_MODELS.rapide);
  });

  test('crédits sous l’estimation du niveau : 402 sans appel ; un niveau moins cher passe', async () => {
    const { org, token } = await newOrg(5);
    const marker = `Lumen${rand()}`;
    await scriptModel(marker, GOOD_INVITATION);
    await markOrgContext(org.orgId, marker);
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Directeur financier', job_details: JOB });

    for (const level of ['avance', 'equilibre'] as const) {
      const res = await draftSequence(token, { action: 'draft', organization_id: org.orgId, mission_id: missionId, ai_level: level });
      expect(res.status, `${level} : ${JSON.stringify(res.body)}`).toBe(402);
      expect(res.body).toMatchObject({ error_code: 'INSUFFICIENT_CREDITS', remaining: 5, credits_required: COSTS.sequence_draft[level] });
    }
    expect(await aiCallsWith(marker), 'aucun appel au modèle').toEqual([]);
    expect(await debits(org.orgId, 'sequence_draft')).toEqual([]);
    const fast = await draftSequence(token, { action: 'draft', organization_id: org.orgId, mission_id: missionId, ai_level: 'rapide' });
    expect(fast.status, JSON.stringify(fast.body)).toBe(200);
    expect((await onlyCallWith(marker)).model).toBe(modelOf('rapide'));
  });

  test('@critical style : défauts de la personne sans style demandé, style demandé fusionné, jamais le style d’un collègue', async () => {
    const { org, token, extra } = await newOrg(80);
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Directeur financier', job_details: JOB });
    const ownerStyle = { length: 'court', tone: 'chaleureux', spontaneity: 'ecrit', hook: 'entreprise', cta: 'question' };
    const colleagueStyle = { length: 'detaille', tone: 'direct', spontaneity: 'spontane', hook: 'poste', cta: 'echange' };
    await setStyle(org.owner.userId, ownerStyle);
    const colleague = await addMember(org.orgId, 'member', 'collegue');
    const newcomer = await addMember(org.orgId, 'member', 'nouveau');
    extra.push(colleague, newcomer);
    await setStyle(colleague.userId, colleagueStyle);

    const prepared = await draftSequence(token, { action: 'prepare', organization_id: org.orgId, mission_id: missionId });
    expect(prepared.body.style).toEqual(ownerStyle);
    expect(prepared.body.style_summary).toBe("Court, chaleureux, écrit, accroche sur l'entreprise, question ouverte");

    const marker = `Lumen${rand()}`;
    await scriptModel(marker, GOOD_INVITATION);
    await markOrgContext(org.orgId, marker);
    const draftAs = async (userToken: string, extraBody: Json = {}) => {
      const before = (await aiCallsWith(marker)).length;
      const res = await draftSequence(userToken, { action: 'draft', organization_id: org.orgId, mission_id: missionId, profile_visit: false, ...extraBody });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return { body: res.body, prompt: (await newCallWith(marker, before)).prompt };
    };

    // Propriétaire, sans style demandé : son style enregistré, dans la consigne et dans la réponse.
    const own = await draftAs(token);
    expect(own.body.style).toEqual(ownerStyle);
    expect(own.prompt).toContain("Note d'invitation : de 100 à 150 caractères, 300 au plus variables comprises.");
    expect(own.prompt).toContain('Premier message : de 120 à 200 caractères.');
    expect(own.prompt).toContain('Registre chaleureux');
    expect(own.prompt).toContain('Style écrit');
    expect(own.prompt).toContain("Accroche : ouvrez la note et le premier message sur l'entreprise qui recrute");
    expect(own.prompt).toContain('posez une question ouverte');
    expect(own.prompt).toContain('Vouvoyez le candidat dans chaque texte');
    // Rien du style du collègue.
    expect(own.prompt).not.toContain('Premier message : de 400 à 650 caractères.');
    expect(own.prompt).not.toContain('Registre direct');

    // Style demandé pour cette rédaction : fusionné avec le style de la personne.
    const asked = await draftAs(token, { style: { length: 'detaille', tone: 'direct' } });
    expect(asked.body.style).toEqual({ ...ownerStyle, length: 'detaille', tone: 'direct' });
    expect(asked.prompt).toContain('Premier message : de 400 à 650 caractères.');
    expect(asked.prompt).toContain('Registre direct');
    expect(asked.prompt).toContain('Style écrit');

    // Le collègue : son propre style ; un nouveau venu sans style : les défauts, jamais celui d'un autre.
    const theirs = await draftAs(await tokenOf(colleague));
    expect(theirs.body.style).toEqual(colleagueStyle);
    expect(theirs.prompt).toContain('Premier message : de 400 à 650 caractères.');
    expect(theirs.prompt).toContain('Style spontané');
    const fresh = await draftAs(await tokenOf(newcomer));
    expect(fresh.body.style).toEqual({ length: 'standard', tone: 'formel', spontaneity: 'naturel', hook: 'parcours', cta: 'echange' });
    expect(fresh.prompt).toContain('Premier message : de 200 à 400 caractères.');
    expect(fresh.prompt).toContain('Registre formel');
    for (const foreign of ['Registre chaleureux', 'Registre direct', 'Style écrit', 'Style spontané']) expect(fresh.prompt).not.toContain(foreign);
  });
});

// ═══ text-action (« Demander à l'IA ») ═══════════════════════════════════════

test.describe('text-action : « Demander à l’IA » au niveau choisi (lot 5e-2)', () => {
  test('@critical modèle du niveau et coût débité du niveau ; au-dessus du plafond : 403 sans appel ni débit ; _ai_model ignoré', async () => {
    const { org, token } = await newOrg(60);
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Directeur financier', job_details: JOB });

    for (const level of LEVELS) {
      const marker = `Atelier${rand()}`;
      await scriptUsageOnce(level, JSON.stringify({ text: PROPOSAL }), TYPICAL_TOKENS.rewrite_text);
      const res = await textAction(token, textBody(org.orgId, marker, { mission_id: missionId, ai_level: level }));
      expect(res.status, `${level} : ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body).toMatchObject({ success: true, text: PROPOSAL, level, level_label: LABELS[level] });
      expect((await onlyCallWith(marker)).model, `${level} : modèle appelé`).toBe(modelOf(level));
      expect(res.body.credits_used, `${level} : débit = barème du niveau`).toBe(COSTS.rewrite_text[level]);
    }
    const before = await debits(org.orgId, 'rewrite_text');
    expect(before.map((d) => d.credits_used)).toEqual(LEVELS.map((l) => COSTS.rewrite_text[l]));

    await setLevels(org.orgId, 'equilibre', 'equilibre');
    const marker = `Atelier${rand()}`;
    await scriptModel(marker, JSON.stringify({ text: PROPOSAL }));
    const above = await textAction(token, textBody(org.orgId, marker, { ai_level: 'avance' }));
    expect(above.status, JSON.stringify(above.body)).toBe(403);
    expect(above.body).toEqual({ error: NOT_ALLOWED_AVANCE, error_code: 'AI_LEVEL_NOT_ALLOWED' });
    const invalid = await textAction(token, textBody(org.orgId, marker, { ai_level: 'turbo' }));
    expect(invalid.status).toBe(400);
    expect(invalid.body.error_code).toBe('AI_LEVEL_INVALID');
    expect(await aiCallsWith(marker), 'aucun appel au modèle').toEqual([]);
    expect(await debits(org.orgId, 'rewrite_text'), 'aucun nouveau débit').toHaveLength(before.length);

    // Sans niveau : défaut de l'organisation, même avec un modèle supérieur glissé dans le corps.
    const res = await textAction(token, textBody(org.orgId, marker, { _ai_model: 'claude-opus-5-5' }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.level).toBe('equilibre');
    expect((await onlyCallWith(marker)).model).toBe(modelOf('equilibre'));
  });

  test('« Réécrire dans votre style » : consigne du style de la personne, puis du style demandé ; jamais celui d’un collègue', async () => {
    const { org, token, extra } = await newOrg(60);
    const ownerStyle = { length: 'court', tone: 'direct', spontaneity: 'spontane', hook: 'poste', cta: 'question' };
    await setStyle(org.owner.userId, ownerStyle);
    const colleague = await addMember(org.orgId, 'member', 'collegue');
    extra.push(colleague);
    await setStyle(colleague.userId, { length: 'detaille', tone: 'chaleureux', spontaneity: 'ecrit', hook: 'parcours', cta: 'echange' });

    const restyle = async (userToken: string, over: Json = {}) => {
      const marker = `Atelier${rand()}`;
      await scriptModel(marker, JSON.stringify({ text: PROPOSAL }));
      const res = await textAction(userToken, textBody(org.orgId, marker, { action: 'restyle', ...over }));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return { body: res.body, prompt: (await onlyCallWith(marker)).prompt };
    };

    const own = await restyle(token);
    expect(own.body.style).toEqual(ownerStyle);
    expect(own.prompt).toContain('Style demandé :');
    expect(own.prompt).toContain('Relances : de 80 à 160 caractères.');
    expect(own.prompt).toContain('Registre direct');
    expect(own.prompt).toContain('Style spontané');
    expect(own.prompt).toContain("Appel à l'action : posez une question ouverte");
    expect(own.prompt).not.toContain('Registre chaleureux');

    const asked = await restyle(token, { style: { length: 'detaille' } });
    expect(asked.body.style).toEqual({ ...ownerStyle, length: 'detaille' });
    expect(asked.prompt).toContain('Relances : de 350 à 550 caractères.');
    expect(asked.prompt).toContain('Registre direct');

    const theirs = await restyle(await tokenOf(colleague));
    expect(theirs.prompt).toContain('Registre chaleureux');
    expect(theirs.prompt).not.toContain('Registre direct');

    // Style illisible : 400 avant tout appel.
    const marker = `Atelier${rand()}`;
    await scriptModel(marker, JSON.stringify({ text: PROPOSAL }));
    const bad = await textAction(token, textBody(org.orgId, marker, { action: 'restyle', style: { cta: 'appel' } }));
    expect(bad.status).toBe(400);
    expect(bad.body.error_code).toBe('STYLE_INVALID');
    expect(await aiCallsWith(marker)).toEqual([]);
  });
});

// ═══ generate-outreach-message ═══════════════════════════════════════════════

test.describe('generate-outreach-message : messages IA par candidat (lot 5e-2)', () => {
  test('@critical modèle et coût du niveau ; au-dessus du plafond : 403 sans appel ni débit ; _ai_model ignoré', async () => {
    const { org, token } = await newOrg(60);

    for (const level of LEVELS) {
      const marker = `MKS${rand()}`;
      await scriptUsageOnce(level, OUTREACH_REPLY('Lucie'), TYPICAL_TOKENS.outreach_message);
      const res = await outreach(token, outreachBody(marker, { organization_id: org.orgId, ai_level: level }));
      expect(res.status, `${level} : ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body).toMatchObject({ success: true, level, level_label: LABELS[level] });
      expect((await onlyCallWith(marker)).model, `${level} : modèle appelé`).toBe(modelOf(level));
    }
    const charged = await debits(org.orgId, 'outreach_message');
    expect(charged.map((d) => d.credits_used), 'débit = barème du niveau').toEqual(LEVELS.map((l) => COSTS.outreach_message[l]));
    expect(charged.map((d) => d.model_id)).toEqual(LEVELS.map((l) => WRITING_LEVEL_MODELS[l]));

    await setLevels(org.orgId, 'rapide', 'equilibre');
    const marker = `MKS${rand()}`;
    await scriptModel(marker, OUTREACH_REPLY('Lucie'));
    const above = await outreach(token, outreachBody(marker, { organization_id: org.orgId, ai_level: 'avance' }));
    expect(above.status, JSON.stringify(above.body)).toBe(403);
    expect(above.body).toEqual({ error: NOT_ALLOWED_AVANCE, error_code: 'AI_LEVEL_NOT_ALLOWED' });
    expect(await aiCallsWith(marker), 'aucun appel au modèle').toEqual([]);
    expect(await debits(org.orgId, 'outreach_message'), 'aucun nouveau débit').toHaveLength(3);

    const res = await outreach(token, outreachBody(marker, { organization_id: org.orgId, _ai_model: 'claude-opus-5-5', _ai_action: 'agent_chat' }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.level).toBe('rapide');
    expect((await onlyCallWith(marker)).model).toBe(modelOf('rapide'));
    // Action fixée par le serveur : le débit reste sur outreach_message.
    expect(await debits(org.orgId, 'outreach_message')).toHaveLength(4);
    expect(await debits(org.orgId, 'agent_chat')).toEqual([]);
  });

  test('@critical organisation vérifiée : sans organisation (active nulle, aucune dans le corps) ou organisation d’autrui, 403 sans appel ni débit', async () => {
    const { org, token } = await newOrg(60);
    const { org: other } = await newOrg(60);
    const marker = `MKS${rand()}`;
    await scriptModel(marker, OUTREACH_REPLY('Lucie'));

    const foreign = await outreach(token, outreachBody(marker, { organization_id: other.orgId }));
    expect(foreign.status, JSON.stringify(foreign.body)).toBe(403);
    expect(foreign.body.error_code).toBe('AI_ORG_FORBIDDEN');

    await admin().from('profiles').update({ active_organization_id: null }).eq('user_id', org.owner.userId);
    const orphan = await outreach(token, outreachBody(marker));
    expect(orphan.status, JSON.stringify(orphan.body)).toBe(403);
    expect(orphan.body.error_code).toBe('AI_ORG_REQUIRED');
    expect(await aiCallsWith(marker), 'aucun appel au modèle').toEqual([]);
    for (const id of [org.orgId, other.orgId]) expect(await debits(id, 'outreach_message')).toEqual([]);

    // Organisation active vérifiée, rien dans le corps : elle porte le garde et le débit.
    await admin().from('profiles').update({ active_organization_id: org.orgId }).eq('user_id', org.owner.userId);
    const active = await outreach(token, outreachBody(marker));
    expect(active.status, JSON.stringify(active.body)).toBe(200);
    expect(await debits(org.orgId, 'outreach_message')).toHaveLength(1);
    expect(await debits(other.orgId, 'outreach_message')).toEqual([]);
  });

  test('style : bloc prioritaire du style de la personne ; style demandé ; ancien ton converti au vouvoiement ; lien d’agenda selon le contexte', async () => {
    const { org, token, extra } = await newOrg(80);
    await setStyle(org.owner.userId, { length: 'court', tone: 'chaleureux', spontaneity: 'naturel', hook: 'parcours', cta: 'echange' });
    const newcomer = await addMember(org.orgId, 'member', 'nouveau');
    extra.push(newcomer);

    const generate = async (userToken: string, over: Json = {}) => {
      const marker = `MKS${rand()}`;
      await scriptModel(marker, OUTREACH_REPLY('Lucie'));
      const res = await outreach(userToken, outreachBody(marker, { organization_id: org.orgId, ...over }));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return { body: res.body, prompt: (await onlyCallWith(marker)).prompt };
    };

    const own = await generate(token);
    expect(own.prompt).toContain('=== STYLE DEMANDÉ (PRIORITAIRE SUR LES EXEMPLES, LES LONGUEURS ET LES OBJECTIFS CI-DESSUS) ===');
    expect(own.prompt).toContain('Premier message : de 120 à 200 caractères.');
    expect(own.prompt).toContain('Registre chaleureux');
    expect(own.body.style_summary).toBe('Court, chaleureux, naturel, accroche sur son parcours, court échange');

    const asked = await generate(token, { style: { length: 'detaille', tone: 'direct' } });
    expect(asked.prompt).toContain('Premier message : de 400 à 650 caractères.');
    expect(asked.prompt).toContain('Registre direct');

    // Client ancien (ton « casual » sans style) : ton chaleureux, toujours au vouvoiement, jamais le style du propriétaire.
    const legacy = await generate(await tokenOf(newcomer), { tone: 'casual' });
    expect(legacy.body.style).toEqual({ length: 'standard', tone: 'chaleureux', spontaneity: 'naturel', hook: 'parcours', cta: 'echange' });
    expect(legacy.prompt).toContain('Premier message : de 200 à 400 caractères.');
    expect(legacy.prompt).toContain('Vouvoyez le candidat dans chaque texte');
    expect(legacy.prompt).not.toMatch(/Tutoiement naturel|tutoiement, style conversationnel/);

    // Fenêtre de message (hors séquence) avec l'adresse fournie : agenda permis dès le premier message.
    const url = await generate(token, { style: { cta: 'agenda' }, calendlyLink: 'https://calendly.com/e2e-recruteur' });
    expect(url.prompt).toContain('lien de rendez-vous fourni, écrit tel quel');
    // Relance de séquence d'une mission sans lien : repli annoncé, jamais {{lien_calendly}}.
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Directeur financier', job_details: JOB });
    const relance = { currentActionType: 'message', prevSentSteps: [{ actionType: 'message', finalMessage: 'Bonjour Lucie, premier message.' }] };
    const noLink = await generate(token, { style: { cta: 'agenda' }, missionId, sequenceContext: relance });
    expect(noLink.prompt).toContain("la mission n'a pas de lien d'agenda");
    expect(noLink.prompt).not.toContain('créneau avec {{lien_calendly}}');
    // Même relance, mission avec un lien : la variable, jamais l'adresse.
    await admin().from('sourcing_projects').update({ calendly_link: 'https://calendly.com/e2e-mission' }).eq('id', missionId);
    const withLink = await generate(token, { style: { cta: 'agenda' }, missionId, sequenceContext: relance });
    expect(withLink.prompt).toContain('créneau avec {{lien_calendly}}');
  });
});

// ═══ Assistant ═══════════════════════════════════════════════════════════════

test.describe('Assistant : draft_outreach_message et create_sequence (lot 5e-2)', () => {
  test('@critical draft_outreach_message : niveau par défaut de l’organisation (jamais celui demandé par le modèle), style de la personne, coût de la carte = débit', async () => {
    const { org, token } = await newOrg(60);
    await setLevels(org.orgId, 'rapide', 'avance');
    await setStyle(org.owner.userId, { length: 'court', tone: 'direct', spontaneity: 'naturel', hook: 'parcours', cta: 'echange' });
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Directeur financier', job_details: JOB });

    for (const level of ['rapide', 'avance'] as const) {
      await setLevels(org.orgId, level, 'avance');
      const marker = `Brouillon${rand()}`;
      const candidateId = await seedCandidate(org.orgId, org.owner.userId, missionId, `Camille ${marker}`);
      // Le modèle de la conversation demande un autre niveau : sans effet (aucune entrée ai_level).
      const proposed = proposeLikeChat(org.orgId, org.owner, 'draft_outreach_message', {
        candidate_id: candidateId, job_id: missionId, channel: 'linkedin_dm', ai_level: level === 'rapide' ? 'avance' : 'rapide',
      });
      expect(proposed.outcome, JSON.stringify(proposed.payload)).toBe('awaiting_approval');
      const details = await dryRunDetails(proposed.executionId!);
      expect(details).toMatchObject({
        ai_level: level,
        ai_level_label: LABELS[level],
        estimated_credits: COSTS.outreach_message[level],
        style_summary: 'Court, direct, naturel, accroche sur son parcours, court échange',
      });

      await scriptUsageOnce(level, ASSISTANT_DRAFT, TYPICAL_TOKENS.outreach_message);
      const approved = await approve(token, proposed.executionId!);
      expect(approved.body.success, JSON.stringify(approved.body)).toBe(true);
      const { model, prompt } = await onlyCallWith(marker);
      expect(model, `${level} : modèle appelé`).toBe(modelOf(level));
      expect(prompt).toContain('STYLE DEMANDÉ');
      expect(prompt).toContain('Premier message : de 120 à 200 caractères.');
      expect(prompt).toContain('Registre direct');
      const charged = await debits(org.orgId, 'outreach_message');
      expect(charged[charged.length - 1].credits_used, `${level} : débit = coût de la carte`).toBe(details.estimated_credits);
    }
    expect(await debits(org.orgId, 'outreach_message')).toHaveLength(2);
  });

  test('@critical create_sequence : conversation au-dessus du plafond refusée à la proposition ; à son niveau ou en dessous, proposée', async () => {
    const { org } = await newOrg(60);
    await setLevels(org.orgId, 'equilibre', 'equilibre');
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Directeur financier', job_details: JOB });
    const params = {
      mission_id: missionId, first_contact: 'invitation', relances: 1, profile_visit: false,
      invitation_note: "Bonjour {{prenom}}, je recrute pour un poste de {{poste_recherche}}. Votre parcours m'a donné envie d'échanger. {{mon_prenom}}",
      first_message: "Bonjour {{prenom}},\n\nJe vous écris au sujet d'un poste de {{poste_recherche}} dans une équipe en croissance. Cela vous parlerait-il ?\n\n{{mon_prenom}}",
      relance_1: "Bonjour {{prenom}}, je reviens vers vous au sujet du poste de {{poste_recherche}}. Seriez-vous curieux d'en savoir plus ?\n\n{{mon_prenom}}",
    };

    const refused = proposeLikeChat(org.orgId, org.owner, 'create_sequence', params, 'claude-opus-5-5');
    expect(refused.outcome).toBe('denied');
    expect(String(refused.payload.error)).toBe(
      "Le niveau de l'IA de cette conversation (Avancé) dépasse le niveau maximal de votre organisation pour rédiger des messages (Équilibré). " +
      "Choisissez un modèle d'un niveau autorisé, puis redemandez la séquence.",
    );
    expect(refused.executionId).toBeUndefined();

    for (const [modelId, level] of [['claude-sonnet-4-6', 'equilibre'], ['claude-haiku-4-5-20251001', 'rapide']] as const) {
      const proposed = proposeLikeChat(org.orgId, org.owner, 'create_sequence', params, modelId);
      expect(proposed.outcome, `${modelId} : ${JSON.stringify(proposed.payload)}`).toBe('awaiting_approval');
      expect(await dryRunDetails(proposed.executionId!)).toMatchObject({ ai_level: level, ai_level_label: LABELS[level] });
    }
    // Plafond relevé par le propriétaire : la même conversation est permise.
    await setLevels(org.orgId, 'equilibre', 'avance');
    const allowed = proposeLikeChat(org.orgId, org.owner, 'create_sequence', params, 'claude-opus-5-5');
    expect(allowed.outcome, JSON.stringify(allowed.payload)).toBe('awaiting_approval');
    expect((await admin().from('outreach_sequences').select('id').eq('organization_id', org.orgId)).data ?? [], 'rien de créé sans clic').toEqual([]);
  });
});

// ═══ Niveaux de l'organisation : écriture ════════════════════════════════════

test.describe('Niveaux de l’organisation : réservés au propriétaire (lot 5e-2)', () => {
  test('@critical administrateur refusé par l’API (ORG_OWNER_ONLY), membre sans effet, propriétaire écrit ; le plafond s’applique aussitôt', async () => {
    const { org, extra } = await newOrg(60);
    await admin().from('organizations').update({ agency_permissions: { hide_payments_from_members: true } }).eq('id', org.orgId);
    const adminUser = await addMember(org.orgId, 'admin', 'admin');
    const member = await addMember(org.orgId, 'member', 'membre');
    extra.push(adminUser, member);
    const clientOf = async (user: TestUser) => createClient(E2E.supabaseUrl, E2E.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${await tokenOf(user)}` } },
    });
    const wanted = { hide_payments_from_members: true, ai_writing: { level: 'rapide', max: 'rapide' } };
    const current = async () => (await admin().from('organizations').select('agency_permissions').eq('id', org.orgId).single()).data?.agency_permissions;

    const byAdmin = await (await clientOf(adminUser)).from('organizations').update({ agency_permissions: wanted }).eq('id', org.orgId).select('id');
    expect(byAdmin.error?.code, JSON.stringify(byAdmin)).toBe('42501');
    expect(byAdmin.error?.hint).toBe('ORG_OWNER_ONLY');
    const byMember = await (await clientOf(member)).from('organizations').update({ agency_permissions: wanted }).eq('id', org.orgId).select('id');
    expect(byMember.data ?? [], `membre : ${JSON.stringify(byMember.error)}`).toEqual([]);
    expect(await current(), 'rien n’a changé').toEqual({ hide_payments_from_members: true });

    const byOwner = await (await clientOf(org.owner)).from('organizations').update({ agency_permissions: wanted }).eq('id', org.orgId).select('id, agency_permissions');
    expect(byOwner.error, JSON.stringify(byOwner.error)).toBeNull();
    expect(byOwner.data).toEqual([{ id: org.orgId, agency_permissions: wanted }]);

    // Le membre rédige aussitôt sous le nouveau plafond : Équilibré refusé, Rapide par défaut.
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Directeur financier', job_details: JOB });
    const memberToken = await tokenOf(member);
    const prepared = await draftSequence(memberToken, { action: 'prepare', organization_id: org.orgId, mission_id: missionId });
    expect(prepared.body).toMatchObject({ level: 'rapide', max_level: 'rapide' });
    const marker = `Lumen${rand()}`;
    await scriptModel(marker, GOOD_INVITATION);
    await markOrgContext(org.orgId, marker);
    const refused = await draftSequence(memberToken, { action: 'draft', organization_id: org.orgId, mission_id: missionId, ai_level: 'equilibre' });
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    expect(refused.body).toEqual({ error: "Votre organisation n'autorise pas le niveau Équilibré. Choisissez Rapide.", error_code: 'AI_LEVEL_NOT_ALLOWED' });
    expect(await aiCallsWith(marker)).toEqual([]);
  });
});

// ═══ Corrections après relecture (06/10) ═════════════════════════════════════

/** Débits d'une action avec leurs jetons : un seul débit cumule tous les appels facturés. */
async function debitTokens(orgId: string, action: string) {
  const { data } = await admin()
    .from('ai_credit_transactions')
    .select('credits_used, tokens_input, tokens_output')
    .eq('organization_id', orgId)
    .eq('action', action)
    .order('created_at', { ascending: true });
  return (data ?? []) as Array<{ credits_used: number; tokens_input: number; tokens_output: number }>;
}

const outreachReply = (message: string) => JSON.stringify({ subject: '', message, personalization_points: [] });

test.describe('generate-outreach-message : contrôles de sortie bloquants, débit des appels consommés (corrections)', () => {
  test('@critical tutoiement, attentes salariales, prénom-pronom : corrigés une fois puis 422 PREVIEW_NOT_COMPLIANT, les deux appels débités', async () => {
    const { org, token } = await newOrg(80);
    const cases: Array<{ name: string; message: string; why: string; profile?: Json }> = [
      { name: 'tutoiement', message: 'Bonjour Lucie, tu as un parcours solide en consolidation. Ça te dirait d’en parler ?', why: 'tutoie le candidat' },
      { name: 'impératif', message: 'Bonjour Lucie, un poste de direction financière à Lyon pourrait vous parler. N’hésite pas à me répondre.', why: 'tutoie le candidat' },
      { name: 'attentes salariales', message: 'Bonjour Lucie, un poste de direction financière à Lyon. Quelles sont vos attentes salariales pour votre prochain poste ?', why: 'mentionne une rémunération' },
      // Prénom « Tu » : seule la salutation est un nom, le pronom reste du tutoiement.
      { name: 'prénom pronom', message: 'Bonjour Tu, tu as un parcours solide. Tu serais partant pour en parler ?', why: 'tutoie le candidat', profile: { name: 'Tu Nguyen' } },
    ];
    let expectedDebits = 0;
    for (const c of cases) {
      const marker = `MKS${rand()}`;
      await scriptModel(marker, outreachReply(c.message));
      const body = outreachBody(marker, { organization_id: org.orgId, ai_level: 'equilibre' });
      if (c.profile) body.profile = { ...(body.profile as Json), ...c.profile };
      const res = await outreach(token, body);
      expect(res.status, `${c.name} : ${JSON.stringify(res.body)}`).toBe(422);
      expect(res.body).toMatchObject({ success: false, error_code: 'PREVIEW_NOT_COMPLIANT' });
      expect(String(res.body.error), c.name).toBe(`Aperçu refusé : le message proposé ${c.why}, il ne peut pas partir. Régénérez l'aperçu.`);
      // Premier appel puis correction (le marqueur est dans les deux consignes).
      const calls = await aiCallsWith(marker);
      expect(calls, `${c.name} : appel puis correction`).toHaveLength(2);
      expect(JSON.stringify(calls[1].body), c.name).toContain('CORRECTION STRICTE');
      expectedDebits += 1;
      const charged = await debitTokens(org.orgId, 'outreach_message');
      expect(charged, `${c.name} : un débit`).toHaveLength(expectedDebits);
      // Les deux appels (10 + 10 jetons chacun, réponse du faux modèle) dans le même débit.
      expect(charged[charged.length - 1], c.name).toMatchObject({ tokens_input: 20, tokens_output: 20 });
    }
  });

  test('note d’invitation de 320 caractères : corrigée une fois puis 422, jamais rendue', async () => {
    const { org, token } = await newOrg(60);
    const marker = `MKS${rand()}`;
    const note = `Bonjour Lucie, votre parcours en consolidation chez Groupe Rhône m’a donné envie de vous écrire au sujet d’un poste de directeur financier à Lyon, dans un groupe industriel qui prépare deux acquisitions et structure sa direction financière. ${'Seriez-vous ouvert à en échanger cette semaine ? '.repeat(2)}`.slice(0, 320);
    expect(note.length).toBe(320);
    await scriptModel(marker, outreachReply(note));
    const res = await outreach(token, outreachBody(marker, {
      organization_id: org.orgId,
      sequenceContext: { currentActionType: 'connection_request', prevSentSteps: [] },
    }));
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body).toMatchObject({ error_code: 'PREVIEW_NOT_COMPLIANT' });
    expect(String(res.body.error)).toContain("dépasse 300 caractères pour une note d'invitation");
    expect(res.body.message, 'texte refusé jamais rendu').toBeUndefined();
    expect(await aiCallsWith(marker)).toHaveLength(2);
  });

  test('@critical correction refusée par le prestataire (429) : le premier appel facturé reste débité', async () => {
    const { org, token } = await newOrg(60);
    const marker = `MKS${rand()}`;
    await setMockMode('*', {
      routes: [
        {
          method: 'POST', path: '^/v1/messages$', times: 1, status: 200,
          body: {
            id: `msg_first_${rand()}`, type: 'message', role: 'assistant', model: modelOf('avance'),
            content: [{ type: 'text', text: outreachReply('Bonjour Lucie, tu as un parcours solide. Ça te dirait d’en parler ?') }],
            stop_reason: 'end_turn', usage: { input_tokens: 4_600, output_tokens: 400 },
          },
        },
        { method: 'POST', path: '^/v1/messages$', times: 1, status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } } },
      ],
    });
    const res = await outreach(token, outreachBody(marker, { organization_id: org.orgId, ai_level: 'avance' }));
    expect(res.status, JSON.stringify(res.body)).toBe(429);
    expect(await aiCallsWith(marker), 'premier appel puis correction').toHaveLength(2);
    const charged = await debitTokens(org.orgId, 'outreach_message');
    expect(charged, 'le premier appel est débité').toHaveLength(1);
    expect(charged[0]).toMatchObject({ tokens_input: 4_600, tokens_output: 400, credits_used: COSTS.outreach_message.avance });
  });

  test('@critical InMail hors séquence (InMail groupé, fenêtre de message) : longueurs et format de l’InMail ; valeur inconnue refusée sans appel', async () => {
    const { org, token } = await newOrg(60);
    const generate = async (over: Json) => {
      const marker = `MKS${rand()}`;
      await scriptModel(marker, outreachReply('Bonjour Lucie, une mission de direction financière à Lyon pourrait vous parler. Seriez-vous ouvert à en échanger ?'));
      const res = await outreach(token, outreachBody(marker, { organization_id: org.orgId, ...over }));
      return { res, marker };
    };

    const inmail = await generate({ message_kind: 'inmail', style: { length: 'detaille' } });
    expect(inmail.res.status, JSON.stringify(inmail.res.body)).toBe(200);
    const prompt = (await onlyCallWith(inmail.marker)).prompt;
    expect(prompt).toContain('InMail : corps de 400 à 800 caractères, objet de 40 caractères au plus.');
    expect(prompt).toContain('INMAIL RECRUITER');
    expect(prompt).not.toContain('Premier message : de 400 à 650 caractères.');

    // Sans canal : premier message, comme avant.
    const plain = await generate({ style: { length: 'detaille' } });
    expect(plain.res.status).toBe(200);
    expect((await onlyCallWith(plain.marker)).prompt).toContain('Premier message : de 400 à 650 caractères.');

    // Le type d'étape d'une séquence reste prioritaire sur le canal demandé.
    const seq = await generate({ message_kind: 'inmail', sequenceContext: { currentActionType: 'connection_request', prevSentSteps: [] } });
    expect(seq.res.status).toBe(200);
    expect((await onlyCallWith(seq.marker)).prompt).toContain("Note d'invitation : ");

    const bad = await generate({ message_kind: 'email' });
    expect(bad.res.status, JSON.stringify(bad.res.body)).toBe(400);
    expect(bad.res.body).toEqual({ error: 'Type de message inconnu. Rechargez la page.', error_code: 'MESSAGE_KIND_INVALID' });
    expect(await aiCallsWith(bad.marker), 'aucun appel').toEqual([]);
  });
});

test.describe('Crédits sous l’estimation du niveau Avancé : 402 sans appel ni débit (corrections)', () => {
  test('text-action : Avancé refusé (402), Rapide passe', async () => {
    const { org, token } = await newOrg(2);
    const marker = `Atelier${rand()}`;
    await scriptModel(marker, JSON.stringify({ text: PROPOSAL }));
    const above = await textAction(token, textBody(org.orgId, marker, { ai_level: 'avance' }));
    expect(above.status, JSON.stringify(above.body)).toBe(402);
    expect(above.body).toMatchObject({ error_code: 'INSUFFICIENT_CREDITS', credits_required: COSTS.rewrite_text.avance });
    expect(await aiCallsWith(marker), 'aucun appel').toEqual([]);
    expect(await debits(org.orgId, 'rewrite_text')).toEqual([]);
    const fast = await textAction(token, textBody(org.orgId, marker, { ai_level: 'rapide' }));
    expect(fast.status, JSON.stringify(fast.body)).toBe(200);
    expect((await onlyCallWith(marker)).model).toBe(modelOf('rapide'));
  });

  test('generate-outreach-message : Avancé refusé (402), Équilibré passe', async () => {
    const { org, token } = await newOrg(6);
    const marker = `MKS${rand()}`;
    await scriptModel(marker, OUTREACH_REPLY('Lucie'));
    const above = await outreach(token, outreachBody(marker, { organization_id: org.orgId, ai_level: 'avance' }));
    expect(above.status, JSON.stringify(above.body)).toBe(402);
    expect(above.body).toMatchObject({ error_code: 'INSUFFICIENT_CREDITS', credits_required: COSTS.outreach_message.avance });
    expect(await aiCallsWith(marker), 'aucun appel').toEqual([]);
    expect(await debits(org.orgId, 'outreach_message')).toEqual([]);
    const balanced = await outreach(token, outreachBody(marker, { organization_id: org.orgId, ai_level: 'equilibre' }));
    expect(balanced.status, JSON.stringify(balanced.body)).toBe(200);
    expect((await onlyCallWith(marker)).model).toBe(modelOf('equilibre'));
  });

  test('draft_outreach_message : carte au niveau Avancé, solde insuffisant à l’approbation, refus sans appel ni débit', async () => {
    const { org, token } = await newOrg(6);
    await setLevels(org.orgId, 'avance', 'avance');
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Directeur financier', job_details: JOB });
    const marker = `Brouillon${rand()}`;
    const candidateId = await seedCandidate(org.orgId, org.owner.userId, missionId, `Camille ${marker}`);
    await scriptModel(marker, ASSISTANT_DRAFT);
    const proposed = proposeLikeChat(org.orgId, org.owner, 'draft_outreach_message', { candidate_id: candidateId, job_id: missionId, channel: 'linkedin_dm' });
    expect(proposed.outcome, JSON.stringify(proposed.payload)).toBe('awaiting_approval');
    expect(await dryRunDetails(proposed.executionId!)).toMatchObject({ ai_level: 'avance', estimated_credits: COSTS.outreach_message.avance });
    const approved = await approve(token, proposed.executionId!);
    expect(approved.status, JSON.stringify(approved.body)).toBe(400);
    expect(String(approved.body.error)).toBe('Crédits IA insuffisants pour rédiger ce message.');
    expect(await aiCallsWith(marker), 'aucun appel').toEqual([]);
    expect(await debits(org.orgId, 'outreach_message')).toEqual([]);
  });
});

test.describe('draft_outreach_message : niveau de la carte approuvée (corrections)', () => {
  test('@critical défaut relevé entre la proposition et l’approbation : rédigé au niveau de la carte, débit = coût affiché ; plafond abaissé : refus sans appel', async () => {
    const { org, token } = await newOrg(60);
    await setLevels(org.orgId, 'rapide', 'avance');
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Directeur financier', job_details: JOB });

    // Carte en Rapide ; le propriétaire passe le défaut à Avancé avant l'approbation.
    const marker = `Brouillon${rand()}`;
    const candidateId = await seedCandidate(org.orgId, org.owner.userId, missionId, `Camille ${marker}`);
    const proposed = proposeLikeChat(org.orgId, org.owner, 'draft_outreach_message', { candidate_id: candidateId, job_id: missionId, channel: 'linkedin_dm' });
    expect(proposed.outcome, JSON.stringify(proposed.payload)).toBe('awaiting_approval');
    const details = await dryRunDetails(proposed.executionId!);
    expect(details).toMatchObject({ ai_level: 'rapide', estimated_credits: COSTS.outreach_message.rapide });
    await setLevels(org.orgId, 'avance', 'avance');
    await scriptUsageOnce('rapide', ASSISTANT_DRAFT, TYPICAL_TOKENS.outreach_message);
    const approved = await approve(token, proposed.executionId!);
    expect(approved.body.success, JSON.stringify(approved.body)).toBe(true);
    const { model, prompt } = await onlyCallWith(marker);
    expect(model, 'niveau de la carte, pas le nouveau défaut').toBe(modelOf('rapide'));
    console.log(`[mesure] draft_outreach_message : ${prompt.length} caractères envoyés au modèle (corps JSON de la requête)`);
    const charged = await debits(org.orgId, 'outreach_message');
    expect(charged).toHaveLength(1);
    expect(charged[0].credits_used, 'débit = coût de la carte').toBe(details.estimated_credits);

    // Carte en Avancé ; le propriétaire abaisse le plafond à Rapide avant l'approbation.
    const marker2 = `Brouillon${rand()}`;
    const candidate2 = await seedCandidate(org.orgId, org.owner.userId, missionId, `Camille ${marker2}`);
    await scriptModel(marker2, ASSISTANT_DRAFT);
    const proposed2 = proposeLikeChat(org.orgId, org.owner, 'draft_outreach_message', { candidate_id: candidate2, job_id: missionId, channel: 'linkedin_dm' });
    expect(await dryRunDetails(proposed2.executionId!)).toMatchObject({ ai_level: 'avance' });
    await setLevels(org.orgId, 'rapide', 'rapide');
    const refused = await approve(token, proposed2.executionId!);
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect(String(refused.body.error)).toBe('Le niveau de rédaction a changé, demandez une nouvelle proposition.');
    expect(await aiCallsWith(marker2), 'aucun appel').toEqual([]);
    expect(await debits(org.orgId, 'outreach_message'), 'aucun nouveau débit').toHaveLength(1);
  });

  test('get_sequence_draft_facts : style demandé fusionné, règles de longueur du style dans style_rules', async () => {
    const { org } = await newOrg(60);
    await setStyle(org.owner.userId, { length: 'standard', tone: 'chaleureux', spontaneity: 'naturel', hook: 'parcours', cta: 'echange' });
    const missionId = await seedMission(org.orgId, org.owner.userId, { name: 'Directeur financier', job_details: JOB });
    const read = proposeLikeChat(org.orgId, org.owner, 'get_sequence_draft_facts', { mission_id: missionId, style: { length: 'court' } });
    expect(read.outcome, JSON.stringify(read.payload)).toBe('executed_inline');
    expect(read.payload.style).toEqual({ length: 'court', tone: 'chaleureux', spontaneity: 'naturel', hook: 'parcours', cta: 'echange' });
    const rules = read.payload.style_rules as Json;
    expect(String(rules.invitation)).toContain("Note d'invitation : de 100 à 150 caractères, 300 au plus variables comprises.");
    expect(String(rules.invitation)).toContain('Registre chaleureux');
    expect(String(rules.inmail)).toContain('InMail : corps de 120 à 220 caractères');
    // Style inconnu : refus avant toute lecture.
    const bad = proposeLikeChat(org.orgId, org.owner, 'get_sequence_draft_facts', { mission_id: missionId, style: { length: 'tres-long' } });
    expect(bad.outcome).toBe('denied');
  });
});
