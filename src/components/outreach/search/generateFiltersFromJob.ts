/**
 * Génère des filtres LinkedIn à partir d'un poste (brief) via l'IA Konekt
 * (`generate-search-filters`), puis mappe le format IA → LinkedInFiltersState.
 *
 * Extrait pour être partagé par la barre de recherche en langage naturel
 * (`SearchPromptBar`) : la phrase de l'utilisateur augmente le brief (voir
 * `buildAugmentedJob`), et le reste du pipeline est identique à l'auto-fill.
 *
 * NB : la logique de mapping duplique volontairement celle de
 * `AutoFillFiltersButton` pour ne pas toucher au flux auto-fill existant
 * (consolidation prévue dans un second temps).
 */
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { invokeUnipile } from '@/lib/invokeUnipile';
import {
  LinkedInFiltersState,
  RoleFilter,
  PriorityFilterItem,
  CompanyKeywordFilter,
  LocationFilterItem,
  SpotlightType,
} from '@/components/outreach/types';
import { Job } from '@/types/jobs';
import type { FilterSuggestions } from './SearchFiltersPanel';

export interface GeneratedFilters {
  keywords: string;
  role: Array<{ keywords: string; priority: string; scope: string }>;
  seniority: string[];
  years_of_experience_min: number | null;
  years_of_experience_max: number | null;
  skills_keywords: string[];
  industry_keywords: string[];
  location_keywords: string[];
  location_within_area: number | null;
  company_keywords: Array<{ keywords: string; priority: string; scope: string }>;
  school: Array<{ id: string; name: string; priority: string }>;
  spotlight: string;
  open_to_work: boolean;
}

/**
 * Construit un poste synthétique où la phrase libre vient s'ajouter au brief
 * comme consigne de sourcing. Le brief reste la source de vérité ; la phrase
 * l'affine. Hors contexte mission (pas de brief), la phrase devient la
 * description et sa 1re proposition sert de titre de repli.
 */
export function buildAugmentedJob(baseJob: Job | null, phrase: string): Job {
  const trimmed = phrase.trim();
  if (!baseJob) {
    const firstClause = trimmed.split(/[,.\n]/)[0]?.trim() || trimmed;
    return {
      id: 'prompt:adhoc',
      title: firstClause.slice(0, 120),
      description: trimmed,
    } as Job;
  }
  const priorCriteria = (baseJob as any).sourcingCriteria as string | undefined;
  const mergedCriteria = [priorCriteria, trimmed].filter(Boolean).join('\n');
  return { ...baseJob, sourcingCriteria: mergedCriteria } as Job;
}

export interface GenerateFiltersResult {
  update: Partial<LinkedInFiltersState>;
  suggestions: FilterSuggestions | null;
  filterCount: number;
}

export async function generateFiltersFromJob(params: {
  job: Job;
  accountId: string | null;
  searchSource: 'linkedin' | 'database';
  currentLocation?: LocationFilterItem[];
  modelOverride?: string;
}): Promise<GenerateFiltersResult> {
  const { job, accountId, searchSource, currentLocation, modelOverride } = params;

  const { data, error } = await invokeWithCredits<{
    filters?: GeneratedFilters;
    suggestions?: FilterSuggestions | null;
    success?: boolean;
    error?: string;
  }>(
    'generate-search-filters',
    'filter_generation',
    { job, search_source: searchSource || 'linkedin' },
    { modelOverride: modelOverride ?? undefined }
  );

  if (error) throw error;
  if (!data?.success || !data?.filters) {
    throw new Error(data?.error || "Réponse invalide de l'API");
  }

  const generated = data.filters;
  const suggestions =
    data.suggestions && Object.values(data.suggestions).some(v => Array.isArray(v) && v.length > 0)
      ? data.suggestions
      : null;

  const update: Partial<LinkedInFiltersState> = {};

  if (generated.keywords) update.keywords = generated.keywords;

  if (generated.role?.length) {
    update.role = generated.role.map(r => ({
      keywords: r.keywords,
      priority: r.priority as 'MUST_HAVE' | 'DOESNT_HAVE',
      scope: r.scope as 'CURRENT' | 'PAST' | 'CURRENT_OR_PAST',
    })) as RoleFilter[];
  }

  if (generated.seniority?.length) update.seniority = generated.seniority;

  const hasXpMin = typeof generated.years_of_experience_min === 'number';
  const hasXpMax = typeof generated.years_of_experience_max === 'number';
  if (hasXpMin || hasXpMax) {
    update.calculated_experience_min = hasXpMin ? generated.years_of_experience_min : null;
    update.calculated_experience_max = hasXpMax ? generated.years_of_experience_max : null;
    update.years_of_experience_min = hasXpMin ? generated.years_of_experience_min : null;
    update.years_of_experience_max = hasXpMax ? generated.years_of_experience_max : null;
  }

  if (generated.location_within_area !== undefined) {
    update.location_within_area = generated.location_within_area;
  }

  // Résolution de localisation : ne jamais écraser une localisation valide
  // déjà sélectionnée par l'utilisateur.
  const hasValidExistingLocation = (currentLocation || []).some(loc => /^\d+$/.test(String(loc.id)));
  const locationKeywords = (generated.location_keywords || []).map(k => k.trim()).filter(Boolean);

  if (!hasValidExistingLocation && locationKeywords.length > 0 && accountId) {
    const resolvedLocations: LocationFilterItem[] = [];
    for (const keyword of locationKeywords.slice(0, 3)) {
      try {
        const { data: paramData } = await invokeUnipile({
          body: { action: 'get_parameters', account_id: accountId, type: 'LOCATION', keywords: keyword, service: 'RECRUITER' },
        });
        const items = Array.isArray(paramData?.items) ? (paramData.items as any[]) : [];
        if (paramData?.success && items.length > 0) {
          const normalized = keyword.toLowerCase();
          const best =
            items.find((it: any) => String(it.title || '').toLowerCase() === normalized) ||
            items.find((it: any) => String(it.title || '').toLowerCase().includes(normalized)) ||
            items[0];
          if (best?.id && best?.title && !resolvedLocations.some(l => l.id === String(best.id))) {
            resolvedLocations.push({
              id: String(best.id),
              name: String(best.title),
              priority: 'MUST_HAVE',
              scope: 'CURRENT_OR_OPEN_TO_RELOCATE',
            });
            break;
          }
        }
      } catch (e) {
        console.warn('[generateFiltersFromJob] location resolve failed:', keyword, e);
      }
    }
    if (resolvedLocations.length > 0) update.location = resolvedLocations;
  }

  if (generated.company_keywords?.length) {
    update.company_keywords = generated.company_keywords.map(c => ({
      keywords: c.keywords,
      priority: c.priority as 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE',
      scope: c.scope as 'CURRENT' | 'PAST' | 'CURRENT_OR_PAST' | 'PAST_NOT_CURRENT',
    })) as CompanyKeywordFilter[];
  }

  if (generated.school?.length) {
    update.school = generated.school.map(s => ({
      id: s.id,
      name: s.name,
      priority: 'CAN_HAVE' as const,
    })) as PriorityFilterItem[];
  }

  if (generated.skills_keywords?.length) update.skills_keywords = generated.skills_keywords;
  if (generated.industry_keywords?.length) update.industry_keywords = generated.industry_keywords;
  if (generated.spotlight) update.spotlight = generated.spotlight as SpotlightType | '';
  if (generated.open_to_work !== undefined) update.open_to_work = generated.open_to_work;

  const filterCount =
    (update.keywords ? 1 : 0) +
    (update.role?.length || 0) +
    (update.seniority?.length || 0) +
    (update.calculated_experience_min !== null || update.calculated_experience_max !== null ? 1 : 0) +
    (update.company_keywords?.length || 0) +
    (update.school?.length || 0) +
    (update.skills_keywords?.length || 0);

  return { update, suggestions, filterCount };
}
