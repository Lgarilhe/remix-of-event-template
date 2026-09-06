/**
 * Feature gating by organization type (enterprise / agency / freelance).
 * Based on the product architecture doc section 1.3.
 *
 * Second axe (lot P0-C) : gating par plan d'abonnement, voir hasPlanFeature.
 * Les deux gardes se combinent (ET) : une feature est ouverte si le type
 * d'organisation ET le plan effectif l'autorisent.
 */

export type OrgType = 'enterprise' | 'agency' | 'freelance';

export type Feature =
  | 'create_missions'
  | 'edit_brief'
  | 'edit_process'
  | 'sourcing'
  | 'pipeline'
  | 'outreach'
  | 'team_management'
  | 'agency_settings'
  | 'marketplace_publish'
  | 'marketplace_browse'
  | 'client_portal'
  | 'billing'
  | 'integrations'
  | 'live_coaching';

const FEATURE_MATRIX: Record<Feature, Record<OrgType, boolean>> = {
  // Un freelance est un recruteur indépendant avec ses propres clients : mêmes
  // droits qu'un cabinet sur ses missions (décision produit 2026-09).
  create_missions:     { enterprise: true,  agency: true,  freelance: true  },
  edit_brief:          { enterprise: true,  agency: true,  freelance: true  },
  edit_process:        { enterprise: true,  agency: true,  freelance: true  },
  sourcing:            { enterprise: true,  agency: true,  freelance: true  },
  pipeline:            { enterprise: true,  agency: true,  freelance: true  },
  outreach:            { enterprise: true,  agency: true,  freelance: true  },
  team_management:     { enterprise: true,  agency: true,  freelance: false },
  agency_settings:     { enterprise: false, agency: true,  freelance: false },
  marketplace_publish: { enterprise: true,  agency: false, freelance: false },
  marketplace_browse:  { enterprise: false, agency: true,  freelance: true  },
  client_portal:       { enterprise: false, agency: true,  freelance: true  },
  billing:             { enterprise: true,  agency: true,  freelance: true  },
  integrations:        { enterprise: true,  agency: true,  freelance: true  },
  live_coaching:       { enterprise: true,  agency: true,  freelance: true  },
};

/** Check if a feature is available for the given org type */
export function hasFeature(orgType: OrgType | null | undefined, feature: Feature): boolean {
  // Fail-closed : orgType est null pendant le chargement de l'org (ou si
  // org_type n'est pas renseigné) — on ne doit jamais ouvrir toutes les
  // features par défaut dans cette fenêtre.
  if (!orgType) return false;
  return FEATURE_MATRIX[feature]?.[orgType] ?? false;
}

// ─── Gating par plan d'abonnement (docs/p0-plan-2026-09-06.md, section 2) ───

/** Identifiants de subscription_plans. pro et enterprise sont désactivés mais
 *  restent référencés par d'anciens abonnements : pro = cabinet, enterprise = entreprise. */
export type PlanId = 'free' | 'solo' | 'cabinet' | 'entreprise' | 'pro' | 'enterprise';

export type PlanFeature =
  | 'sequences_send'
  | 'contact_enrichment'
  | 'team'
  | 'client_portal'
  | 'agency_settings'
  | 'marketplace_publish';

const CABINET_FEATURES: Record<PlanFeature, boolean> = {
  sequences_send: true, contact_enrichment: true, team: true, client_portal: true, agency_settings: true, marketplace_publish: false,
};
const ENTREPRISE_FEATURES: Record<PlanFeature, boolean> = {
  sequences_send: true, contact_enrichment: true, team: true, client_portal: true, agency_settings: true, marketplace_publish: true,
};

const PLAN_FEATURES: Record<PlanId, Record<PlanFeature, boolean>> = {
  // Palier d'atterrissage après essai : les données restent lisibles, le portail client aussi.
  free:       { sequences_send: false, contact_enrichment: false, team: false, client_portal: true, agency_settings: false, marketplace_publish: false },
  solo:       { sequences_send: true,  contact_enrichment: true,  team: false, client_portal: true, agency_settings: false, marketplace_publish: false },
  cabinet:    CABINET_FEATURES,
  entreprise: ENTREPRISE_FEATURES,
  pro:        CABINET_FEATURES,
  enterprise: ENTREPRISE_FEATURES,
};

/**
 * Check if a feature is included in the given subscription plan.
 * `planId` est le plan effectif (useSubscriptionState().effectivePlanId).
 * Fail-closed : null, undefined ou identifiant inconnu → false.
 */
export function hasPlanFeature(planId: string | null | undefined, feature: PlanFeature): boolean {
  if (!planId) return false;
  return PLAN_FEATURES[planId as PlanId]?.[feature] ?? false;
}

/** Human-readable label for org type */
export function getOrgTypeLabel(orgType: OrgType | null | undefined): string {
  switch (orgType) {
    case 'enterprise': return 'Entreprise';
    case 'agency': return 'Cabinet';
    case 'freelance': return 'Freelance';
    default: return 'Organisation';
  }
}

/** Emoji for org type */
export function getOrgTypeEmoji(orgType: OrgType | null | undefined): string {
  switch (orgType) {
    case 'enterprise': return '🏢';
    case 'agency': return '🏛️';
    case 'freelance': return '👤';
    default: return '🏢';
  }
}
