/**
 * assertCredits : refus AVANT l'appel au modèle.
 *
 * Pourquoi ce garde existe. La déduction (settleCredits) a besoin de
 * result.usage, donc elle ne peut tourner qu'APRÈS la réponse du modèle.
 * Une organisation à zéro crédit voyait donc chacun de ses appels partir,
 * être facturé chez le fournisseur, puis tomber dans la branche « solde
 * insuffisant » de settle-credits.ts : un console.warn, aucune ligne dans
 * ai_credit_transactions, et la réponse IA renvoyée quand même. Le seul refus
 * vivait dans le navigateur (src/lib/invokeWithCredits.ts, action preauth),
 * qui laisse passer à la moindre erreur et qu'un appel direct à l'edge
 * function contourne. Sans ce fichier, le solde reste un compteur a
 * posteriori, jamais une barrière.
 *
 * Câblage dans une fonction IA, juste avant l'appel au modèle :
 *
 *   import { assertCredits, creditGateResponse } from "../_shared/credit-guard.ts";
 *
 *   const gate = await assertCredits({ userId, organizationId, aiAction, modelId });
 *   if (!gate.ok) return creditGateResponse(gate, corsHeaders);
 *
 * L'estimation utilisée ici est celle de l'action preauth de ai-credits
 * (estimateActionCredits, exportée plus bas et importée par ai-credits) :
 * le navigateur et le serveur refusent donc au même moment.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
type SupabaseClient = ReturnType<typeof createClient>;
import { ACTION_COSTS, estimateCredits, getModel } from "./ai-config.ts";
import { resolveOrgIdFromUser } from "./resolve-org-credentials.ts";

// ─── Estimation partagée avec preauth ───────────────────────────────────────

/**
 * Coût estimé d'une action, et modèle retenu pour l'estimer.
 *
 * Unique implémentation : ai-credits/index.ts (action preauth) l'appelle aussi.
 * Deux estimations divergentes laisseraient le navigateur autoriser un appel
 * que le serveur refuse, ou l'inverse.
 */
export function estimateActionCredits(
  aiAction: string,
  modelId?: string | null,
): { estimated: number; model: string } {
  const routingTier = ACTION_COSTS[aiAction]?.routingTier ?? "default";
  const model = getModel(routingTier, modelId ?? undefined, undefined, aiAction);
  return { estimated: estimateCredits(aiAction, model), model };
}

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Corps du 402.
 *
 * `error` porte la phrase française : invokeEdgeFunction la remonte en priorité
 * comme message d'erreur, et c'est donc elle que l'utilisateur voit. Le jeton
 * technique vit dans `error_code`, seul champ à tester côté code. `message`
 * répète la phrase pour les lecteurs qui lisent ce champ.
 */
export interface InsufficientCreditsBody {
  error: string;
  error_code: "INSUFFICIENT_CREDITS";
  message: string;
  remaining: number;
  credits_required: number;
}

export type CreditGate =
  | {
      ok: true;
      estimated: number;
      /** null quand le solde n'a pas pu être lu (appel laissé passer). */
      remaining: number | null;
      organizationId: string | null;
      model: string;
    }
  | {
      ok: false;
      estimated: number;
      remaining: number;
      organizationId: string;
      model: string;
      body: InsufficientCreditsBody;
    };

/**
 * Ligne de ai_credit_balances utile au garde et au renouvellement. Le solde
 * vaut plan_credits + topup_credits : credits_remaining et credits_total ne
 * sont que des miroirs du restant écrits par settleCredits, jamais lus ici.
 */
export interface PeriodBalance {
  plan_credits: number;
  topup_credits: number;
  period_start: string | null;
  period_end: string | null;
  updated_at: string | null;
}

const BALANCE_COLUMNS = "plan_credits, topup_credits, period_start, period_end, updated_at";

/** Enveloppe retenue quand le plan n'expose pas limits.ai_credits (même valeur que le trigger SQL). */
const DEFAULT_PLAN_CREDITS = 100;

/** Sentinelle « illimité » : limits.ai_credits négatif, miroir de sync_credit_balance_from_subscription. */
export const UNLIMITED_PLAN_CREDITS = 999999;

function toPeriodBalance(row: Record<string, unknown> | null): PeriodBalance | null {
  if (!row) return null;
  return {
    plan_credits: Number(row.plan_credits ?? 0),
    topup_credits: Number(row.topup_credits ?? 0),
    period_start: (row.period_start as string | null) ?? null,
    period_end: (row.period_end as string | null) ?? null,
    updated_at: (row.updated_at as string | null) ?? null,
  };
}

/**
 * Recharge plan_credits quand period_end est dépassé, et renvoie le solde
 * effectif.
 *
 * Unique implémentation du renouvellement : ai-credits (get_balance, preauth,
 * settle) et le garde l'appellent tous les deux. Tant que ce renouvellement
 * vivait dans le seul ai-credits, une organisation dont le navigateur
 * n'appelait pas get_balance restait sur une période échue, et le garde devait
 * la laisser passer sans plafond. Les 17 organisations de production ont la
 * même date de fin de période : le contournement se serait ouvert pour toutes
 * le même jour.
 *
 * L'écriture est conditionnée sur la période lue (`period_end`), donc deux
 * appels simultanés sur une période échue ne rechargent qu'une fois : le
 * perdant relit la ligne au lieu de recharger à son tour.
 */
export async function renewPlanCreditsIfExpired(
  admin: SupabaseClient,
  organizationId: string,
  current: PeriodBalance,
): Promise<PeriodBalance> {
  const periodEnd = current.period_end ? new Date(current.period_end).getTime() : NaN;
  if (!Number.isFinite(periodEnd) || periodEnd >= Date.now()) return current;

  // Le plan effectif passe par get_subscription_state, jamais par la ligne brute
  // d'organization_subscriptions : celle-ci donne un essai échu ou un abonnement
  // annulé comme s'ils étaient actifs, et rechargerait alors le forfait d'un plan
  // auquel l'organisation n'a plus droit. La RPC expire l'essai à la lecture.
  const { data: state } = await admin.rpc("get_subscription_state", {
    p_organization_id: organizationId,
  });
  const row = Array.isArray(state) ? state[0] : state;
  const planId = (row as { effective_plan_id?: string | null } | null)?.effective_plan_id;
  // Sans plan effectif, rien à recharger : on rend le solde tel quel, le garde
  // tranchera dessus.
  if (!planId) return current;

  const { data: plan } = await admin
    .from("subscription_plans")
    .select("limits")
    .eq("id", planId)
    .maybeSingle();

  const planLimits = (plan as { limits?: { ai_credits?: number } | null } | null)?.limits ?? null;
  // limits.ai_credits est l'unique source de vérité (migration 20260906181044) :
  // absent → 100 comme le trigger SQL, négatif (-1) → illimité, jamais de solde négatif.
  const rawPlanCredits = Number(planLimits?.ai_credits ?? NaN);
  const newPlanCredits = !Number.isFinite(rawPlanCredits)
    ? DEFAULT_PLAN_CREDITS
    : rawPlanCredits < 0
      ? UNLIMITED_PLAN_CREDITS
      : Math.floor(rawPlanCredits);

  const now = new Date();
  const nextEnd = new Date(now);
  nextEnd.setMonth(nextEnd.getMonth() + 1);

  const { data: written, error: writeError } = await admin
    .from("ai_credit_balances")
    .update({
      plan_credits: newPlanCredits,
      credits_total: newPlanCredits + current.topup_credits,
      period_start: now.toISOString(),
      period_end: nextEnd.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("period_end", current.period_end)
    .select(BALANCE_COLUMNS);

  if (writeError) {
    console.error(`[credit-guard] renouvellement en échec (org=${organizationId}):`, writeError.message);
    return current;
  }

  const renewed = toPeriodBalance((written as Record<string, unknown>[] | null)?.[0] ?? null);
  if (renewed) return renewed;

  // 0 ligne : une autre requête a rechargé entre notre lecture et notre
  // écriture. On relit plutôt que de recharger une seconde fois.
  const { data: fresh } = await admin
    .from("ai_credit_balances")
    .select(BALANCE_COLUMNS)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return toPeriodBalance(fresh as Record<string, unknown> | null) ?? current;
}

export interface AssertCreditsParams {
  /** User à l'origine de l'appel. Sert à résoudre l'org si elle n'est pas fournie. */
  userId?: string | null;
  /** Org à débiter (body de la requête, après verifyOrgMembership). */
  organizationId?: string | null;
  /** Action id, entrée de ACTION_COSTS (ex: "scoring"). */
  aiAction: string;
  /** Modèle résolu, celui de extractAIParams. Absent : même défaut que preauth. */
  modelId?: string | null;
  /**
   * Traitement automatique SANS utilisateur identifiable : cron, file de
   * traitement. Passe sans lecture de solde, car ces appels n'ont pas d'org
   * fiable à débiter au moment du garde et les couper ferait échouer les files.
   * Le décompte a posteriori (settleCredits) continue de s'appliquer.
   *
   * À ne PAS confondre avec « appelé en service_role » : le copilot appelle
   * certaines fonctions en service-role avec un user_id_override, après
   * une demande de l'utilisateur dans le chat. L'utilisateur est alors connu et
   * le garde doit s'appliquer. La bonne condition est donc
   * `auth.method === "service_role" && !userIdOverride`.
   */
  systemCall?: boolean;
  /** Client service-role déjà construit par la fonction appelante. */
  adminClient?: SupabaseClient;
}

// ─── Garde ──────────────────────────────────────────────────────────────────

function pass(
  estimated: number,
  model: string,
  organizationId: string | null,
  remaining: number | null = null,
): CreditGate {
  return { ok: true, estimated, remaining, organizationId, model };
}

/**
 * Vérifie que l'organisation a de quoi payer l'estimation de l'action.
 *
 * Comportement en cas de panne : si la ligne de solde est illisible (erreur
 * réseau, table absente, org introuvable, ligne jamais créée), on LAISSE
 * PASSER en journalisant en console.error. Refuser sur une panne de lecture
 * couperait toute l'IA du produit pendant un incident base, pour un garde qui
 * ne fait que déplacer un refus déjà appliqué après coup. Le seul cas qui
 * change le comportement actuel est celui d'un solde lu et réellement
 * insuffisant : là, on refuse.
 */
export async function assertCredits(params: AssertCreditsParams): Promise<CreditGate> {
  const { aiAction, modelId } = params;
  const { estimated, model } = estimateActionCredits(aiAction, modelId);

  if (params.systemCall) {
    return pass(estimated, model, params.organizationId ?? null);
  }

  try {
    const admin = params.adminClient ?? createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!,
    );

    let organizationId = params.organizationId ?? null;
    if (!organizationId && params.userId) {
      organizationId = await resolveOrgIdFromUser(params.userId, admin);
    }
    if (!organizationId) {
      console.error(
        `[credit-guard] org introuvable (action=${aiAction} user=${params.userId ?? "none"}), appel laissé passer`,
      );
      return pass(estimated, model, null);
    }

    const { data, error } = await admin
      .from("ai_credit_balances")
      .select(BALANCE_COLUMNS)
      .eq("organization_id", organizationId)
      .maybeSingle();
    // Le client admin n'est pas typé par le schéma : on nomme la ligne lue.
    const bal = toPeriodBalance(data as Record<string, unknown> | null);

    if (error) {
      console.error(`[credit-guard] lecture du solde en échec (org=${organizationId}):`, error.message);
      return pass(estimated, model, organizationId);
    }
    if (!bal) {
      // Aucune ligne : org jamais approvisionnée, ce qui n'est pas la même
      // chose qu'une org à sec. On ne peut pas distinguer un solde épuisé
      // d'un défaut d'initialisation, donc on ne refuse pas.
      console.error(`[credit-guard] aucune ligne ai_credit_balances pour org=${organizationId}, appel laissé passer`);
      return pass(estimated, model, organizationId);
    }

    // Période échue : on recharge ici, avec le même écrit idempotent que
    // ai-credits, puis on compare au solde rechargé. Laisser passer aurait
    // désarmé le garde pour toute organisation qui ne repasse pas par le
    // navigateur, c'est-à-dire pour toutes le jour de l'échéance.
    const effective = await renewPlanCreditsIfExpired(admin, organizationId, bal);

    const remaining = effective.plan_credits + effective.topup_credits;
    if (remaining >= estimated) {
      return pass(estimated, model, organizationId, remaining);
    }

    console.warn(
      `[credit-guard] refus org=${organizationId} action=${aiAction} model=${model} restant=${remaining} requis=${estimated}`,
    );
    const userMessage =
      `Crédits IA insuffisants (${remaining} restants, ${estimated} requis). Rechargez depuis Paramètres, onglet Crédits IA.`;
    return {
      ok: false,
      estimated,
      remaining,
      organizationId,
      model,
      body: {
        // La phrase française occupe `error` : c'est le champ que le navigateur
        // affiche. Le jeton machine reste lisible sous `error_code`.
        error: userMessage,
        error_code: "INSUFFICIENT_CREDITS",
        message: userMessage,
        remaining,
        credits_required: estimated,
      },
    };
  } catch (err) {
    console.error(`[credit-guard] solde illisible (action=${aiAction}), appel laissé passer:`, err);
    return pass(estimated, model, params.organizationId ?? null);
  }
}

/**
 * Réponse 402 prête à renvoyer, pour éviter que chaque fonction réécrive
 * l'enveloppe JSON et les en-têtes CORS.
 */
export function creditGateResponse(
  gate: Extract<CreditGate, { ok: false }>,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(gate.body), {
    status: 402,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
