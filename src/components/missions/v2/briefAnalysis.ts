/**
 * Brief IA : types et aides pures (sans React) de la fenêtre de création de
 * mission. Séparés de CreateMissionV2 pour être testés seuls
 * (tests/ux/creation-mission-brief.test.mjs).
 *
 * La réponse vient de l'edge function generate-search-filters, action
 * « brief_analysis ». Elle porte les filtres de recherche (filters_snapshot) et
 * le brief structuré (job_details), que ce module met en forme.
 */

import type { EdgeFunctionError } from '@/lib/invokeEdgeFunction';

export const MIN_BRIEF_CHARS = 20;
/** Limite lue par generate-search-filters : au-delà, le texte n'est pas transmis au modèle. */
export const MAX_BRIEF_CHARS = 12000;
/** Sous ce seuil, l'analyse reste possible mais s'appuie sur peu de matière. */
export const SHORT_BRIEF_CHARS = 300;
/** En dessous, un « salaire annuel brut » est une erreur de lecture (taux journalier, k€ sans unité). */
const MIN_PLAUSIBLE_ANNUAL_SALARY = 10000;

export interface BriefAnalysisData {
  suggested_title?: string | null;
  role_keywords?: string[];
  skills_to_search?: string[];
  location_hint?: string | null;
  years_experience_min?: number | null;
  years_experience_max?: number | null;
  experience_rationale?: string | null;
  job_category?: string;
  detected_company?: string | null;
  // Brief structuré, pré-remplit job_details
  skills_must_have?: string[];
  skills_should_have?: string[];
  skills_nice_to_have?: string[];
  salary_min?: number | null;
  salary_max?: number | null;
  contract_type?: 'cdi' | 'cdd' | 'freelance' | 'stage' | 'alternance' | 'interim' | null;
  remote_policy?: 'onsite' | 'hybrid' | 'full_remote' | null;
  remote_days?: number | null;
  start_date?: string | null;
  mission_description?: string | null;
  context?: string | null;
  seniority?: string | null;
  evaluation_criteria?: string[];
}

export interface BriefAnalysis {
  filters: Record<string, unknown>;
  analysis: BriefAnalysisData;
}

export interface AnalyzeResponse {
  success?: boolean;
  /** Vrai quand le modèle a répondu de façon illisible : les filtres ne viennent que du titre. */
  degraded?: boolean;
  filters?: Record<string, unknown>;
  analysis?: BriefAnalysisData;
}

export interface ExtractedField {
  id: string;
  label: string;
  value?: string;
  chips?: string[];
  /** Phrase de vérification, sous la valeur. */
  hint?: string;
}

// ─── Libellés ──────────────────────────────────────────────────────────────

const CONTRACT_LABELS: Record<string, string> = {
  cdi: 'CDI',
  cdd: 'CDD',
  freelance: 'Freelance',
  stage: 'Stage',
  alternance: 'Alternance',
  interim: 'Intérim',
};

/** « "A" OR "B" OR C » devient ['A', 'B', 'C'] : le modèle renvoie un groupe booléen, pas une liste. */
export function splitBooleanTitles(values: string[] | undefined | null): string[] {
  const titles = new Set<string>();
  for (const value of values ?? []) {
    if (typeof value !== 'string') continue;
    for (const part of value.split(/\s+OR\s+/i)) {
      const title = part.replace(/^[("'\s]+|[)"'\s]+$/g, '').trim();
      if (title) titles.add(title);
    }
  }
  return [...titles];
}

export function experienceLabel(a: BriefAnalysisData): string | null {
  const min = a.years_experience_min;
  const max = a.years_experience_max;
  if (typeof min !== 'number') return null;
  return typeof max === 'number' && max > min ? `${min} à ${max} ans` : `${min} ans et plus`;
}

export function remoteLabel(a: BriefAnalysisData): string | null {
  if (a.remote_policy === 'full_remote') return 'Télétravail complet';
  if (a.remote_policy === 'onsite') return 'Sur site';
  if (a.remote_policy === 'hybrid') {
    return typeof a.remote_days === 'number' && a.remote_days > 0
      ? `Hybride, ${a.remote_days} j de télétravail par semaine`
      : 'Hybride';
  }
  return null;
}

export function salaryLabel(a: BriefAnalysisData): string | null {
  const min = typeof a.salary_min === 'number' && a.salary_min >= MIN_PLAUSIBLE_ANNUAL_SALARY ? a.salary_min : null;
  const max = typeof a.salary_max === 'number' && a.salary_max >= MIN_PLAUSIBLE_ANNUAL_SALARY ? a.salary_max : null;
  const k = (n: number) => `${Math.round(n / 1000)} k€`;
  if (min && max) return `${k(min)} à ${k(max)} brut par an`;
  if (min) return `À partir de ${k(min)} brut par an`;
  if (max) return `Jusqu'à ${k(max)} brut par an`;
  return null;
}

/**
 * Lignes affichées dans le panneau de droite, et les informations que la fiche
 * ne donne pas (à compléter dans le brief, ou à ajouter à la fiche).
 */
export function buildExtractedFields(
  a: BriefAnalysisData,
  clientName: string,
): { fields: ExtractedField[]; missing: string[] } {
  const fields: ExtractedField[] = [];
  const missing: string[] = [];

  if (a.suggested_title) fields.push({ id: 'title', label: 'Poste', value: a.suggested_title });

  // Le client saisi par l'utilisateur est déjà dans le formulaire : on n'affiche que celui trouvé dans la fiche.
  if (!clientName.trim() && a.detected_company) {
    fields.push({ id: 'client', label: 'Client', value: a.detected_company });
  }

  if (a.location_hint) fields.push({ id: 'location', label: 'Lieu', value: a.location_hint });
  else missing.push('lieu');

  const experience = experienceLabel(a);
  if (experience) {
    fields.push({
      id: 'experience',
      label: 'Expérience',
      value: experience,
      hint: a.experience_rationale || undefined,
    });
  } else {
    missing.push('expérience');
  }

  const contract = a.contract_type ? CONTRACT_LABELS[a.contract_type] : null;
  if (contract) fields.push({ id: 'contract', label: 'Contrat', value: contract });
  else missing.push('contrat');

  const remote = remoteLabel(a);
  if (remote) fields.push({ id: 'remote', label: 'Télétravail', value: remote });
  else missing.push('télétravail');

  const salary = salaryLabel(a);
  if (salary) fields.push({ id: 'salary', label: 'Rémunération', value: salary });
  else missing.push('rémunération');

  if (a.start_date) fields.push({ id: 'start', label: 'Démarrage', value: a.start_date });
  else missing.push('date de démarrage');

  const skills = (a.skills_must_have?.length ? a.skills_must_have : a.skills_to_search) ?? [];
  if (skills.length > 0) fields.push({ id: 'skills', label: 'Compétences', chips: skills.slice(0, 8) });

  const titles = splitBooleanTitles(a.role_keywords).slice(0, 6);
  if (titles.length > 0) fields.push({ id: 'roles', label: 'Intitulés ciblés', chips: titles });

  return { fields, missing };
}

/** Nom de mission de repli quand le modèle ne propose pas de titre. */
export function suggestedMissionName(a: BriefAnalysisData): string {
  const role = splitBooleanTitles(a.role_keywords)[0];
  if (!role) return 'Mission';
  return a.location_hint ? `${role}, ${a.location_hint}` : role;
}

/**
 * Brief structuré enregistré avec la mission (job_details). Il alimente le
 * scoring des candidats (compétences, description, critères) et le Cadrage.
 */
export function buildJobDetails(
  a: BriefAnalysisData,
  ctx: { briefName: string; briefText: string; clientName: string },
): Record<string, unknown> {
  const briefText = ctx.briefText.trim();
  const jobDetails: Record<string, unknown> = {
    title: a.suggested_title || ctx.briefName || briefText.split('\n')[0].slice(0, 80),
    mission_description: a.mission_description || briefText.slice(0, 600),
    raw_brief: briefText,
    brief_source: 'imported',
  };
  if (a.context) jobDetails.context = a.context;
  if (ctx.clientName || a.detected_company) {
    jobDetails.client = { name: ctx.clientName || a.detected_company };
  }
  if (a.location_hint) jobDetails.location = a.location_hint;
  if (a.remote_policy) jobDetails.remote_policy = a.remote_policy;
  if (typeof a.remote_days === 'number') jobDetails.remote_days = a.remote_days;
  if (a.contract_type) jobDetails.contract_type = a.contract_type;
  if (a.start_date) jobDetails.start_date = a.start_date;
  if (a.seniority) jobDetails.seniority = a.seniority;
  if (typeof a.years_experience_min === 'number') jobDetails.experience_min = a.years_experience_min;
  if (typeof a.years_experience_max === 'number') jobDetails.experience_max = a.years_experience_max;

  const salaryMin = typeof a.salary_min === 'number' && a.salary_min >= MIN_PLAUSIBLE_ANNUAL_SALARY ? a.salary_min : null;
  const salaryMax = typeof a.salary_max === 'number' && a.salary_max >= MIN_PLAUSIBLE_ANNUAL_SALARY ? a.salary_max : null;
  if (salaryMin) jobDetails.salary_min = salaryMin;
  if (salaryMax) jobDetails.salary_max = salaryMax;
  if (salaryMin || salaryMax) {
    jobDetails.salary_currency = 'EUR';
    jobDetails.salary_type = 'annual';
  }

  if (a.skills_must_have?.length) {
    jobDetails.skills_must_have = a.skills_must_have;
  } else if (a.skills_to_search?.length) {
    // Repli : les compétences de recherche tiennent lieu d'indispensables.
    jobDetails.skills_must_have = a.skills_to_search.slice(0, 8);
  }
  if (a.skills_should_have?.length) jobDetails.skills_should_have = a.skills_should_have;
  if (a.skills_nice_to_have?.length) jobDetails.skills_nice_to_have = a.skills_nice_to_have;
  if (a.evaluation_criteria?.length) {
    // Format de JobDetails.evaluation_criteria.
    jobDetails.evaluation_criteria = a.evaluation_criteria.map((label, i) => ({
      id: `auto-${i + 1}`,
      label,
      description: '',
      category: 'technical' as const,
      weight: 2 as const,
    }));
  }
  return jobDetails;
}

/**
 * Message affiché quand l'analyse échoue. Le texte du serveur n'est repris que
 * pour une limite de débit ou une surcharge (phrases françaises écrites pour
 * l'utilisateur) ; le reste ne montre jamais le message technique.
 */
export function analysisErrorMessage(err: unknown): string {
  const status = (err as EdgeFunctionError | null | undefined)?.status;
  if ((status === 429 || status === 503) && err instanceof Error && err.message) return err.message;
  return "Le service n'a pas répondu comme prévu. Réessayez dans un instant, ou créez la mission sans analyse.";
}

export const CREDITS_EXHAUSTED_MESSAGE =
  'Vos crédits IA sont épuisés. Vous pouvez créer la mission sans analyse et compléter le brief ensuite.';
