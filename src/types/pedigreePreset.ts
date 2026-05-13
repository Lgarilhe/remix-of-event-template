/**
 * Pedigree presets — critères de sélection client réutilisables sur le scoring.
 *
 * Permet de définir une fois "Pour ce client, j'exige top école FR + scale-up
 * Series B+" et l'appliquer automatiquement sur toutes les missions du client.
 *
 * ⚠️ RGPD : les libellés exposés à l'user sont neutres et focusés sur des
 * critères objectifs (école/diplôme délivré par établissement, type
 * d'entreprise) — pas sur l'origine ethnique/nationalité du candidat (illégal).
 */

/** Catégories d'entreprises (pour required/avoid). */
export type CompanyProvenance =
  | 'gafam'                  // Google, Apple, Facebook/Meta, Amazon, Microsoft
  | 'big_tech_us'            // Stripe, Airbnb, Uber, Datadog, Snowflake...
  | 'scale_up'               // Scale-up reconnue (Series B+, 100+ employés)
  | 'startup_funded'         // Startup early-stage funded (Series A ou Seed)
  | 'banque_assurance'       // BNP, SG, AXA, etc.
  | 'cabinet_strategy'       // McKinsey, BCG, Bain, etc.
  | 'esn';                   // ESN/SSII (Capgemini, Sopra, Atos...)

export type CompanyAvoidCategory =
  | 'esn_body_shopping'      // Body shopping pure (rotation 3-6 mois, junior)
  | 'small_consulting';      // Petits cabinets de conseil non-spécialisés

export type DiplomaOrigin = 'france' | 'eu' | 'any';

export type SeniorityLevel = 'junior' | 'mid' | 'senior' | 'lead' | 'staff' | 'principal';

/**
 * Stade de financement (montant proxy via Apollo).
 * Source : annuaire global pedigree_company_directory mis à jour mensuellement
 * par l'edge function refresh-pedigree-by-funding-stage. Catégorisation par
 * montant de la dernière levée (cf brackets dans l'edge function).
 */
export type FundingStage =
  | 'seed'           // 0-5M
  | 'series_a'       // 5M-25M
  | 'series_b'       // 25M-75M
  | 'series_c'       // 75M-200M
  | 'series_d_plus'; // 200M+

/**
 * Structure du preset stockée en DB (jsonb). Tous les champs sont optionnels —
 * un preset peut ne configurer que certains critères.
 */
export interface PedigreeRequirements {
  /**
   * Liste d'écoles spécifiquement requises (au moins une suffit).
   * Le LLM matche en utilisant la connaissance des aliases (ex: "X" = "Polytechnique",
   * "CentraleSupélec" = "Centrale" = "Supélec").
   */
  schools_required?: string[];

  /**
   * Origine géographique exigée pour le diplôme.
   * - 'france' : diplôme délivré par un établissement français
   * - 'eu' : Europe (incluant FR, UK, DE, ES, IT...)
   * - 'any' : pas de contrainte géographique (= règle d'équité par défaut)
   *
   * ⚠️ RGPD : ce critère cible le diplôme (objectif), pas la nationalité du
   * candidat (illégal). Un candidat tunisien diplômé EPITA = OK avec 'france'.
   */
  diploma_must_be_from?: DiplomaOrigin;

  /**
   * Catégories d'entreprises où le candidat doit avoir au moins une expérience
   * significative (1+ an, poste pertinent).
   */
  companies_required_provenance?: CompanyProvenance[];

  /**
   * Liste d'entreprises spécifiques où le candidat doit avoir bossé
   * (ex: ["Stripe", "Doctolib", "Datadog"]). Au moins une suffit.
   */
  companies_specific_required?: string[];

  /**
   * Catégories d'entreprises à éviter (signal négatif fort dans le scoring).
   */
  companies_avoid?: CompanyAvoidCategory[];

  /**
   * Stade(s) de financement requis pour les entreprises de l'expérience du
   * candidat. Au moins une expérience significative dans une boîte à un de ces
   * stades. Résolu via l'annuaire (mis à jour mensuellement via Apollo).
   * Ex: ['series_b', 'series_c', 'series_d_plus'] = "candidat passé par une
   * scale-up Series B+".
   */
  funding_stages_required?: FundingStage[];

  /**
   * Séniorité minimale requise (en plus de l'XP en années).
   */
  min_seniority?: SeniorityLevel;

  /**
   * Mode strict : tout profil non-conforme aux critères ci-dessus est plafonné
   * à 50 (force "Skip" ou "Maybe"). Sinon, les critères sont des "préférences"
   * qui ajustent le score sans le plafonner.
   */
  strict_mode?: boolean;

  /**
   * Instructions additionnelles libres pour le LLM (max 400 chars).
   * Ex: "Préférer profils ayant fait Polytechnique X-15 ou X-16 + 3 ans Stripe minimum."
   */
  custom_instructions?: string;
}

/**
 * Row complet de la table client_pedigree_presets.
 */
export interface ClientPedigreePreset {
  id: string;
  organization_id: string;
  name: string;
  description?: string | null;
  client_company_name?: string | null;
  pedigree_requirements: PedigreeRequirements;
  is_default_for_client: boolean;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Catégories pour l'UI (label + description).
 */
export const COMPANY_PROVENANCE_LABELS: Record<CompanyProvenance, { label: string; description: string }> = {
  gafam: { label: 'GAFAM', description: 'Google, Apple, Meta, Amazon, Microsoft' },
  big_tech_us: { label: 'Big Tech US', description: 'Stripe, Airbnb, Uber, Datadog, Snowflake, Databricks…' },
  scale_up: { label: 'Scale-up', description: 'Series B+ ou 100+ employés (Doctolib, Alan, Qonto, Mirakl, Ankorstore…)' },
  startup_funded: { label: 'Startup funded', description: 'Seed / Series A early-stage' },
  banque_assurance: { label: 'Banque / Assurance', description: 'BNP, SG, AXA, Crédit Agricole, Allianz…' },
  cabinet_strategy: { label: 'Cabinet stratégie', description: 'McKinsey, BCG, Bain, Roland Berger…' },
  esn: { label: 'ESN / SSII', description: 'Capgemini, Sopra Steria, Atos, CGI…' },
};

export const COMPANY_AVOID_LABELS: Record<CompanyAvoidCategory, { label: string; description: string }> = {
  esn_body_shopping: { label: 'ESN body shopping', description: 'Rotation 3-6 mois, junior, missions génériques' },
  small_consulting: { label: 'Petit cabinet conseil', description: 'Consulting non-spécialisé' },
};

export const DIPLOMA_ORIGIN_LABELS: Record<DiplomaOrigin, string> = {
  france: 'Diplôme délivré par établissement français',
  eu: 'Diplôme délivré par établissement UE',
  any: 'Pas de contrainte géographique',
};

export const SENIORITY_LABELS: Record<SeniorityLevel, string> = {
  junior: 'Junior',
  mid: 'Mid',
  senior: 'Senior',
  lead: 'Lead',
  staff: 'Staff',
  principal: 'Principal',
};

export const FUNDING_STAGE_LABELS: Record<FundingStage, { label: string; description: string }> = {
  seed:          { label: 'Seed',       description: 'Levée < 5M $ (early-stage, équipe restreinte)' },
  series_a:      { label: 'Series A',   description: '5M – 25M $ (product-market fit, scaling team)' },
  series_b:      { label: 'Series B',   description: '25M – 75M $ (scale-up confirmée)' },
  series_c:      { label: 'Series C',   description: '75M – 200M $ (expansion internationale)' },
  series_d_plus: { label: 'Series D+',  description: '200M $+ (pré-IPO, late-stage)' },
};
