// draft-sequence, actions prepare et draft (refonte mission, lot 5e) : la
// séquence de la mission rédigée par l'IA à partir du poste.
//
// prepare (gratuite, sans IA, n'écrit rien)
//   Entrée  { action: 'prepare', organization_id, mission_id }
//   Sortie  { ok, mission: { id, title }, facts: [{ id, label }] (les plus forts d'abord), messages: string[],
//             angles: [{ id, label, description, why, recommended }],
//             defaults: { angle, relances, first_contact, profile_visit },
//             cost: { estimated, label, remaining, sufficient }, notice,
//             style, style_summary, level, level_label, max_level,
//             levels: [{ id, label, credits, allowed }], has_calendly_link }
//   Arguments retenus du poste (liste fermée), « Vos messages » repris du
//   Cadrage, trois angles fixes dont un « Recommandé », coût annoncé au niveau
//   par défaut et pour chaque niveau (lot 5e-2), style par défaut de la personne.
//
// draft (payante : un appel au modèle, une correction au plus)
//   Entrée  { action: 'draft', organization_id, mission_id, angle?, kept_fact_ids?,
//             extra_arguments?, relances? (1 à 3), profile_visit?, first_contact?
//             ('invitation' | 'inmail'), ai_level? ('rapide' | 'equilibre' | 'avance'),
//             style? (partiel : length, tone, spontaneity, hook, cta) }
//   Sortie  { ok, mission_id, angle, draft: { name, description, steps }, flags,
//             correction, credits: { used, remaining }, level, level_label,
//             style, style_summary }
//   steps : étapes au format de l'éditeur (SequenceStep), jamais enregistrées ;
//   flags : « À rédiger » (texte retiré, l'enregistrement est bloqué) et « À relire ».
//   Ordre : membre de l'organisation, mission lue dans cette organisation (sinon
//   404), poste assez décrit (422), arguments ajoutés contrôlés (422), niveau
//   (lot 5e-2 : absent → défaut de l'organisation, au-dessus du plafond → 403
//   AI_LEVEL_NOT_ALLOWED, inconnu → 400), style (400 STYLE_INVALID), crédits
//   au modèle du niveau (assertCredits, 402 sans appel), appel (call-claude.ts,
//   30 s au plus), correction s'il reste 30 s sur les 60, settleCredits sur le
//   modèle appelé. _ai_model n'est plus lu. Aucune garde d'offre
//   (décision 6 : la formule gratuite rédige dans la limite de ses crédits).
//   Seule écriture : le débit de crédits.
// Erreurs : { error, error_code } (convention de invokeEdgeFunction).
// Contrat : docs/refonte-mission/lot5-plan.md, section 5e.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { verifyOrgMembership } from "../_shared/require-auth.ts";
import { callClaudeCompat, type OpenAIMessage } from "../_shared/call-claude.ts";
import { getAnthropicModelId } from "../_shared/ai-config.ts";
import { assertCredits } from "../_shared/credit-guard.ts";
import { settleCredits } from "../_shared/settle-credits.ts";
import { loadAndBuildAiContext } from "../_shared/ai-context.ts";
import { hasTimeForAiCorrection } from "../_shared/sequence-send-rules.ts";
import { loadWritingSettings } from "../_shared/writing-settings.ts";
import {
  AI_LEVEL_LABELS,
  levelChoices,
  levelCredits,
  mergeStyle,
  modelForLevel,
  resolveAiLevel,
  styleSummary,
  type StyleLength,
} from "../_shared/writing-style.ts";
import {
  DRAFT_CREDITS_MESSAGE,
  DRAFT_DEFAULT_RELANCES,
  DRAFT_JOB_TOO_THIN_MESSAGE,
  DRAFT_NOTICE,
  DRAFT_UNAVAILABLE_MESSAGE,
  applyClientAlias,
  applyDraftReview,
  briefForbiddenValues,
  buildCorrectionRequest,
  buildDraftPrompt,
  buildDraftSkeleton,
  checkDraftTexts,
  checkExtraArgument,
  deriveAngles,
  draftCheckContextFor,
  draftCostLabel,
  draftSequenceDescription,
  draftSequenceName,
  factsByStrength,
  isJobTooThin,
  needsCorrection,
  outreachSummary,
  parseDraftRequest,
  parseDraftResponse,
  parsePrepareRequest,
  pickBestTexts,
  pickBriefFacts,
  quoteFr,
  recommendedAngle,
  type BriefFacts,
  type BriefForbiddenValues,
  type DraftCheckContext,
  type DraftIssue,
  type DraftSkeleton,
  type DraftSlotText,
} from "../_shared/sequence-draft.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;

const newAdminClient = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
type AdminClient = ReturnType<typeof newAdminClient>;

const AI_ACTION = "sequence_draft";
/** Durée d'exécution d'une fonction : l'appel et sa correction doivent y tenir. */
const FUNCTION_BUDGET_MS = 60_000;
/** Délai d'un appel au modèle (convention : 30 s pour un appel LLM). */
const MODEL_TIMEOUT_MS = 30_000;
/** Marge gardée pour le débit et la réponse. */
const RESPONSE_MARGIN_MS = 5_000;
/** Jetons de sortie selon la longueur demandée (Standard = valeur du lot 5e). */
const MAX_OUTPUT_TOKENS: Readonly<Record<StyleLength, number>> = { court: 1_500, standard: 2_000, detaille: 3_000 };
const FAILED_MESSAGE = "La rédaction n'a pas pu être préparée. Réessayez dans un instant.";
const SETTINGS_UNAVAILABLE_MESSAGE = "Vos réglages de rédaction n'ont pas pu être lus. Réessayez dans un instant.";

export interface ComposeContext {
  userId: string;
  corsHeaders: Record<string, string>;
  /** Début de la requête, pour le budget de 60 s. */
  startedAt: number;
}

interface MissionRow {
  id: string;
  name: string | null;
  job_details: unknown;
  client_name: string | null;
  calendly_link: string | null;
}

interface OrgRow {
  name: string | null;
  org_type: string | null;
}

type Loaded =
  | { ok: true; admin: AdminClient; mission: MissionRow; org: OrgRow; facts: BriefFacts; forbidden: BriefForbiddenValues }
  | { ok: false; response: Response };

function responder(corsHeaders: Record<string, string>) {
  return (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * Appartenance à l'organisation, mission lue dans cette organisation seulement
 * (une mission d'une autre organisation est introuvable), poste assez décrit.
 */
async function loadMission(organizationId: string, missionId: string, ctx: ComposeContext): Promise<Loaded> {
  const json = responder(ctx.corsHeaders);
  const admin = newAdminClient();
  if (!await verifyOrgMembership(admin, ctx.userId, organizationId)) {
    return { ok: false, response: json({ error: "Vous n'êtes pas membre de cette organisation.", error_code: "DRAFT_FORBIDDEN" }, 403) };
  }
  const [{ data: mission, error: missionError }, { data: org, error: orgError }] = await Promise.all([
    admin
      .from("sourcing_projects")
      .select("id, name, job_details, client_name, calendly_link")
      .eq("id", missionId)
      .eq("organization_id", organizationId)
      .maybeSingle(),
    admin.from("organizations").select("name, org_type").eq("id", organizationId).maybeSingle(),
  ]);
  if (missionError || orgError) {
    console.error("[draft-sequence] lecture de la mission:", missionError?.message ?? orgError?.message);
    return { ok: false, response: json({ error: FAILED_MESSAGE, error_code: "DRAFT_FAILED" }, 500) };
  }
  if (!mission) {
    return { ok: false, response: json({ error: "Mission introuvable dans cette organisation.", error_code: "MISSION_NOT_FOUND" }, 404) };
  }
  const row = mission as MissionRow;
  const orgRow = (org ?? { name: null, org_type: null }) as OrgRow;
  const facts = pickBriefFacts({
    jobDetails: row.job_details,
    missionName: row.name ?? "",
    clientName: row.client_name,
    calendlyLink: row.calendly_link,
    orgType: orgRow.org_type,
  });
  if (isJobTooThin(facts)) {
    return { ok: false, response: json({ error: DRAFT_JOB_TOO_THIN_MESSAGE, error_code: "DRAFT_JOB_TOO_THIN" }, 422) };
  }
  return { ok: true, admin, mission: row, org: orgRow, facts, forbidden: briefForbiddenValues(row.job_details) };
}


/** Solde lu sans écriture ; null quand il est illisible ou que la période est échue (rechargée au prochain débit). */
async function readRemainingCredits(admin: AdminClient, organizationId: string): Promise<number | null> {
  const { data, error } = await admin
    .from("ai_credit_balances")
    .select("plan_credits, topup_credits, period_end")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { plan_credits?: number | null; topup_credits?: number | null; period_end?: string | null };
  const periodEnd = row.period_end ? new Date(row.period_end).getTime() : NaN;
  if (Number.isFinite(periodEnd) && periodEnd < Date.now()) return null;
  return Number(row.plan_credits ?? 0) + Number(row.topup_credits ?? 0);
}

// ─── prepare ────────────────────────────────────────────────────────────────

async function prepare(body: unknown, ctx: ComposeContext): Promise<Response> {
  const json = responder(ctx.corsHeaders);
  const parsed = parsePrepareRequest(body);
  if (!parsed.ok) return json({ error: parsed.error, error_code: parsed.code }, parsed.status);
  const { organization_id: organizationId, mission_id: missionId } = parsed.request;

  const loaded = await loadMission(organizationId, missionId, ctx);
  if (!loaded.ok) return loaded.response;
  const { admin, facts } = loaded;

  // Réglages de rédaction (lot 5e-2) : niveaux de l'organisation, style de la personne.
  const settings = await loadWritingSettings(admin, { organizationId, userId: ctx.userId });
  if (!settings.ok) return json({ error: SETTINGS_UNAVAILABLE_MESSAGE, error_code: "AI_SETTINGS_UNAVAILABLE" }, 503);

  const angles = deriveAngles(facts);
  const estimated = levelCredits(AI_ACTION, settings.defaultLevel);
  const remaining = await readRemainingCredits(admin, organizationId);

  return json({
    ok: true,
    mission: { id: missionId, title: facts.title },
    // Les plus forts d'abord : l'écran en montre cinq et replie les autres.
    facts: factsByStrength(facts.facts).map((f) => ({ id: f.id, label: f.label })),
    messages: outreachSummary(facts),
    angles: angles.map((a) => ({ id: a.id, label: a.label, description: a.description, why: a.why, recommended: a.recommended })),
    defaults: {
      angle: angles.find((a) => a.recommended)?.id ?? "role",
      relances: DRAFT_DEFAULT_RELANCES,
      first_contact: "invitation",
      profile_visit: true,
    },
    cost: {
      estimated,
      label: draftCostLabel(estimated),
      remaining,
      sufficient: remaining === null ? null : remaining >= estimated,
    },
    notice: DRAFT_NOTICE,
    style: settings.style,
    style_summary: styleSummary(settings.style),
    level: settings.defaultLevel,
    level_label: AI_LEVEL_LABELS[settings.defaultLevel],
    max_level: settings.maxLevel,
    levels: levelChoices(AI_ACTION, settings),
    has_calendly_link: facts.hasCalendlyLink,
  });
}

// ─── draft ──────────────────────────────────────────────────────────────────

interface ModelTurn {
  content: string;
  tokensInput: number;
  tokensOutput: number;
}

/** Textes lus dans une réponse ; réponse illisible : tous les emplacements vides (« À rédiger »). */
function readTexts(raw: string, skeleton: DraftSkeleton, facts: BriefFacts): { texts: DraftSlotText[]; readable: boolean } {
  const parsed = parseDraftResponse(raw, skeleton);
  if (!parsed.ok) {
    return { texts: skeleton.slots.map((s) => ({ slot: s.slot, subject: "", body: "" })), readable: false };
  }
  return { texts: applyClientAlias(parsed.texts, facts.company.hiddenNames, facts.outreach.alias), readable: true };
}

async function draft(body: unknown, ctx: ComposeContext): Promise<Response> {
  const json = responder(ctx.corsHeaders);
  const deadline = ctx.startedAt + FUNCTION_BUDGET_MS;
  const parsed = parseDraftRequest(body);
  if (!parsed.ok) return json({ error: parsed.error, error_code: parsed.code }, parsed.status);
  const request = parsed.request;
  const { organization_id: organizationId, mission_id: missionId } = request;

  const loaded = await loadMission(organizationId, missionId, ctx);
  if (!loaded.ok) return loaded.response;
  const { admin, org, facts, forbidden } = loaded;
  const organizationName = (org.name ?? "").trim();

  // Arguments ajoutés : mêmes interdits que la sortie, refusés avant tout appel.
  for (const [index, argument] of request.extra_arguments.entries()) {
    const refusal = checkExtraArgument(argument, organizationName, { hiddenClientNames: facts.company.hiddenNames, forbidden });
    if (refusal) return json({ error: refusal, error_code: "DRAFT_ARGUMENT_REFUSED", argument_index: index }, 422);
  }

  // Niveau et style (lot 5e-2), avant le garde des crédits : un niveau
  // au-dessus du plafond de l'organisation est refusé sans appel ni débit.
  const settings = await loadWritingSettings(admin, { organizationId, userId: ctx.userId });
  if (!settings.ok) return json({ error: SETTINGS_UNAVAILABLE_MESSAGE, error_code: "AI_SETTINGS_UNAVAILABLE" }, 503);
  const resolved = resolveAiLevel(request.ai_level, settings);
  if (!resolved.ok) return json({ error: resolved.error, error_code: resolved.code }, resolved.status);
  const level = resolved.level;
  const style = mergeStyle(settings.style, request.style);

  // Crédits avant tout appel au modèle, au prix du modèle du niveau : 402 sans appel ni débit.
  const modelId = modelForLevel(level);
  const gate = await assertCredits({ userId: ctx.userId, organizationId, aiAction: AI_ACTION, modelId, adminClient: admin });
  if (!gate.ok) {
    return json({
      error: DRAFT_CREDITS_MESSAGE,
      error_code: "INSUFFICIENT_CREDITS",
      message: DRAFT_CREDITS_MESSAGE,
      remaining: gate.remaining,
      credits_required: gate.estimated,
    }, 402);
  }

  const skeleton = buildDraftSkeleton({
    firstContact: request.first_contact,
    relances: request.relances,
    profileVisit: request.profile_visit,
  });
  const angle = request.angle ?? recommendedAngle(facts);
  const prompt = buildDraftPrompt({
    facts,
    keptFactIds: request.kept_fact_ids,
    extraArguments: request.extra_arguments,
    angle,
    skeleton,
    organizationName,
    style,
  });
  // Sans « Ton imposé » : le vouvoiement et le style de la rédaction priment.
  const aiContext = await loadAndBuildAiContext(admin, { orgId: organizationId, userId: ctx.userId, omitTone: true });
  const anthropicModel = getAnthropicModelId(modelId);

  const callModel = async (messages: OpenAIMessage[]): Promise<ModelTurn> => {
    const timeoutMs = Math.min(MODEL_TIMEOUT_MS, deadline - Date.now() - RESPONSE_MARGIN_MS);
    if (timeoutMs <= 0) throw new Error("budget de la fonction épuisé");
    const result = await callClaudeCompat({
      model: anthropicModel,
      messages,
      max_tokens: MAX_OUTPUT_TOKENS[style.length],
      antiAiStyle: "full",
      aiContext,
      response_format: { type: "json_object" },
      timeoutMs,
      // Aucune nouvelle tentative : elle ne tiendrait pas dans les 60 s avec la correction.
      maxRetries: 0,
    });
    return { content: result.content, tokensInput: result.usage.input_tokens, tokensOutput: result.usage.output_tokens };
  };

  const baseMessages: OpenAIMessage[] = [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ];
  let first: ModelTurn;
  try {
    first = await callModel(baseMessages);
  } catch (err) {
    // Aucun jeton consommé : rien à débiter.
    console.error("[draft-sequence] appel au modèle:", err instanceof Error ? err.message : err);
    return json({ error: DRAFT_UNAVAILABLE_MESSAGE, error_code: "DRAFT_UNAVAILABLE" }, 503);
  }
  let tokensInput = first.tokensInput;
  let tokensOutput = first.tokensOutput;

  const checkContext: DraftCheckContext = draftCheckContextFor(facts, {
    organizationName,
    firstContact: request.first_contact,
    extraArguments: request.extra_arguments,
    forbidden,
  });

  let { texts, readable } = readTexts(first.content, skeleton, facts);
  let issues: DraftIssue[] = checkDraftTexts(texts, checkContext);
  let correction = false;

  // Une seule correction, et seulement s'il reste 30 s sur les 60.
  if ((!readable || needsCorrection(issues)) && hasTimeForAiCorrection(deadline, Date.now())) {
    correction = true;
    const fix = readable
      ? buildCorrectionRequest(issues)
      : "Votre réponse n'était pas un objet JSON valide. Rendez uniquement l'objet JSON demandé, au format indiqué.";
    try {
      const second = await callModel([...baseMessages, { role: "assistant", content: first.content }, { role: "user", content: fix }]);
      tokensInput += second.tokensInput;
      tokensOutput += second.tokensOutput;
      const fixed = readTexts(second.content, skeleton, facts);
      if (fixed.readable) {
        const fixedIssues = checkDraftTexts(fixed.texts, checkContext);
        ({ texts, issues } = readable
          ? pickBestTexts(texts, issues, fixed.texts, fixedIssues)
          : { texts: fixed.texts, issues: fixedIssues });
        readable = true;
      }
    } catch (err) {
      // La première proposition reste, avec ses textes retirés et ses signalements.
      console.warn("[draft-sequence] correction:", err instanceof Error ? err.message : err);
    }
  }

  // Débit des jetons consommés, texte retiré compris.
  const settled = await settleCredits(admin, {
    organizationId,
    userId: ctx.userId,
    aiAction: AI_ACTION,
    modelId,
    tokensInput,
    tokensOutput,
    description: `Séquence rédigée à partir du poste ${quoteFr(facts.title)} (mission ${missionId})`,
  });

  const { steps, flags } = applyDraftReview(skeleton, texts, issues);
  const remaining = await readRemainingCredits(admin, organizationId);
  return json({
    ok: true,
    mission_id: missionId,
    angle,
    draft: {
      name: draftSequenceName(facts.title),
      description: draftSequenceDescription(new Date()),
      steps,
    },
    flags,
    correction,
    credits: { used: settled.charged, remaining },
    level,
    level_label: AI_LEVEL_LABELS[level],
    style,
    style_summary: styleSummary(style),
  });
}

// ─── Points d'entrée ────────────────────────────────────────────────────────

/** Erreur imprévue : réponse propre à la rédaction (et non le message de l'aperçu d'index.ts). */
function guarded(action: string, run: (body: unknown, ctx: ComposeContext) => Promise<Response>) {
  return async (body: unknown, ctx: ComposeContext): Promise<Response> => {
    try {
      return await run(body, ctx);
    } catch (err) {
      console.error(`[draft-sequence] ${action}:`, err);
      return responder(ctx.corsHeaders)({ error: FAILED_MESSAGE, error_code: "DRAFT_FAILED" }, 500);
    }
  };
}

export const handlePrepare = guarded("prepare", prepare);
export const handleDraft = guarded("draft", draft);
