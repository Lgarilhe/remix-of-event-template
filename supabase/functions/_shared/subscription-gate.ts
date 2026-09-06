/**
 * subscription-gate : plan effectif et sièges d'une organisation, lus côté
 * serveur avec un client service-role (lot P0-C, docs/p0-plan-2026-09-06.md).
 *
 * Même règle que la RPC get_subscription_state (migration 20260906181806) et
 * que le hook front useSubscriptionState :
 *   - plan effectif = free si la ligne d'abonnement est absente, si
 *     plan_id = 'free', si status ∈ (canceled, unpaid), ou si l'essai est
 *     expiré (trialing avec trial_ends_at < now()) ;
 *   - sièges autorisés : plan effectif free → limits.max_members du plan (1) ;
 *     essai en cours → TRIAL_SEAT_ALLOWANCE ; sinon organization_subscriptions.seats ;
 *   - un siège = une ligne organization_members, tous rôles.
 *
 * Aucun appel réseau externe : trois lectures Supabase au plus.
 *
 *   import { getSubscriptionGate } from "../_shared/subscription-gate.ts";
 *   const gate = await getSubscriptionGate(admin, organizationId);
 *   if (gate.seatCount >= gate.seatLimit) { ... 403 seats_exceeded ... }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
type SupabaseClient = ReturnType<typeof createClient>;

/** Sièges autorisés pendant l'essai (aucune quantité facturée à ce stade). Miroir de TRIAL_SEAT_ALLOWANCE côté front. */
export const TRIAL_SEAT_ALLOWANCE = 10;

export interface SubscriptionGate {
  /** Plan réellement applicable (free après annulation, impayé ou essai expiré). */
  effectivePlanId: string;
  /** Statut tel que le verrait get_subscription_state (essai expiré → active). */
  status: string;
  isTrialing: boolean;
  seatLimit: number;
  /** Nombre de lignes organization_members, tous rôles. */
  seatCount: number;
  canSendSequences: boolean;
  canEnrichContacts: boolean;
}

function toSeatNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.trunc(n)) : fallback;
}

export async function getSubscriptionGate(
  admin: SupabaseClient,
  organizationId: string,
): Promise<SubscriptionGate> {
  const { data: sub, error: subError } = await admin
    .from("organization_subscriptions")
    .select("plan_id, status, trial_ends_at, seats")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (subError) {
    console.error("[subscription-gate] organization_subscriptions read failed:", subError.message);
    throw new Error("Impossible de vérifier l'abonnement de l'organisation");
  }

  const rawStatus = String(sub?.status ?? "active");
  const trialEndsAt = sub?.trial_ends_at ? Date.parse(String(sub.trial_ends_at)) : NaN;
  const trialExpired = rawStatus === "trialing" && Number.isFinite(trialEndsAt) && trialEndsAt < Date.now();

  const effectivePlanId =
    !sub || sub.plan_id === "free" || rawStatus === "canceled" || rawStatus === "unpaid" || trialExpired
      ? "free"
      : String(sub.plan_id);
  const status = trialExpired ? "active" : rawStatus;
  const isTrialing = rawStatus === "trialing" && !trialExpired;

  let seatLimit: number;
  if (effectivePlanId === "free") {
    const { data: plan, error: planError } = await admin
      .from("subscription_plans")
      .select("limits")
      .eq("id", "free")
      .maybeSingle();

    if (planError) {
      console.error("[subscription-gate] subscription_plans read failed:", planError.message);
      throw new Error("Impossible de vérifier l'abonnement de l'organisation");
    }

    const limits = (plan?.limits ?? {}) as { max_members?: unknown };
    seatLimit = toSeatNumber(limits.max_members, 1);
  } else if (isTrialing) {
    seatLimit = TRIAL_SEAT_ALLOWANCE;
  } else {
    seatLimit = toSeatNumber(sub?.seats, 1);
  }

  const { count, error: countError } = await admin
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  if (countError) {
    console.error("[subscription-gate] organization_members count failed:", countError.message);
    throw new Error("Impossible de vérifier les sièges de l'organisation");
  }

  return {
    effectivePlanId,
    status,
    isTrialing,
    seatLimit,
    seatCount: count ?? 0,
    canSendSequences: effectivePlanId !== "free",
    canEnrichContacts: effectivePlanId !== "free",
  };
}
