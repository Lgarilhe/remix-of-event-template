// Filter support per API type based on Unipile API documentation
// Extracted from schema validation errors in edge function logs

import { LinkedInApiType } from './types';

export interface FilterSupport {
  supported: boolean;
  tooltip?: string;
}

export type FilterKey = 
  | 'keywords'
  | 'location'
  | 'company'
  | 'industry'
  | 'school'
  | 'job_title'
  | 'skills'
  | 'role'
  | 'seniority'
  | 'network_distance'
  | 'profile_language'
  | 'years_of_experience'
  | 'tenure_at_company'
  | 'tenure_at_role'
  | 'open_to_work'
  | 'open_to'
  | 'spotlight'
  | 'hiring_project'
  | 'talent_pool'
  | 'company_headcount'
  | 'company_type'
  | 'past_company'
  | 'past_job_title';

// Filter support matrix based on Unipile API documentation
export const FILTER_API_SUPPORT: Record<LinkedInApiType, Record<FilterKey, FilterSupport>> = {
  classic: {
    keywords: { supported: true },
    location: { supported: true },
    company: { supported: true },
    industry: { supported: true },
    school: { supported: true },
    job_title: { supported: false, tooltip: "Utilisez le filtre 'Mots-clés' pour rechercher par titre de poste en mode Classic" },
    skills: { supported: false, tooltip: "Les compétences ne sont pas disponibles en mode Classic. Utilisez Recruiter ou Sales Navigator" },
    role: { supported: false, tooltip: "Le filtre de rôle booléen n'est disponible qu'en mode Recruiter" },
    seniority: { supported: false, tooltip: "Le niveau de séniorité n'est pas disponible en mode Classic" },
    network_distance: { supported: true },
    profile_language: { supported: true },
    years_of_experience: { supported: false, tooltip: "L'expérience n'est pas filtrable en mode Classic" },
    tenure_at_company: { supported: false, tooltip: "L'ancienneté n'est pas disponible en mode Classic" },
    tenure_at_role: { supported: false, tooltip: "L'ancienneté n'est pas disponible en mode Classic" },
    open_to_work: { supported: false, tooltip: "Open to Work n'est pas disponible en mode Classic" },
    open_to: { supported: true }, // Classic supports proBono, boardMember
    spotlight: { supported: false, tooltip: "Spotlight n'est disponible qu'en mode Recruiter" },
    hiring_project: { supported: false, tooltip: "Les projets de recrutement ne sont disponibles qu'en mode Recruiter" },
    talent_pool: { supported: false, tooltip: "Les talent pools ne sont disponibles qu'en mode Recruiter" },
    company_headcount: { supported: false, tooltip: "La taille d'entreprise n'est pas disponible en mode Classic" },
    company_type: { supported: false, tooltip: "Le type d'entreprise n'est pas disponible en mode Classic" },
    past_company: { supported: true },
    past_job_title: { supported: false, tooltip: "Les titres passés ne sont pas filtrables en mode Classic" },
  },
  recruiter: {
    keywords: { supported: true },
    location: { supported: true },
    company: { supported: true },
    industry: { supported: true },
    school: { supported: false, tooltip: "Le filtre école n'est pas supporté par l'API Recruiter. Utilisez le mode Classic ou ajoutez l'école dans les mots-clés" },
    job_title: { supported: true },
    skills: { supported: true },
    role: { supported: true },
    seniority: { supported: true },
    network_distance: { supported: true },
    profile_language: { supported: true },
    years_of_experience: { supported: true },
    tenure_at_company: { supported: true },
    tenure_at_role: { supported: true },
    open_to_work: { supported: true },
    open_to: { supported: true },
    spotlight: { supported: true },
    hiring_project: { supported: true },
    talent_pool: { supported: true },
    company_headcount: { supported: false, tooltip: "Utilisez Sales Navigator pour filtrer par taille d'entreprise" },
    company_type: { supported: false, tooltip: "Utilisez Sales Navigator pour filtrer par type d'entreprise" },
    past_company: { supported: true },
    past_job_title: { supported: true },
  },
  sales_navigator: {
    keywords: { supported: true },
    location: { supported: true },
    company: { supported: true },
    industry: { supported: true },
    school: { supported: true },
    job_title: { supported: true },
    skills: { supported: false, tooltip: "Les compétences ne sont pas disponibles en Sales Navigator. Utilisez Recruiter" },
    role: { supported: false, tooltip: "Le filtre de rôle booléen n'est disponible qu'en mode Recruiter" },
    seniority: { supported: true },
    network_distance: { supported: true },
    profile_language: { supported: true },
    years_of_experience: { supported: true },
    tenure_at_company: { supported: true },
    tenure_at_role: { supported: true },
    open_to_work: { supported: false, tooltip: "Open to Work n'est pas disponible en Sales Navigator" },
    open_to: { supported: false, tooltip: "Open to n'est pas disponible en Sales Navigator" },
    spotlight: { supported: false, tooltip: "Spotlight n'est disponible qu'en mode Recruiter" },
    hiring_project: { supported: false, tooltip: "Les projets de recrutement ne sont disponibles qu'en mode Recruiter" },
    talent_pool: { supported: false, tooltip: "Les talent pools ne sont disponibles qu'en mode Recruiter" },
    company_headcount: { supported: true },
    company_type: { supported: true },
    past_company: { supported: true },
    past_job_title: { supported: true },
  },
};

// Helper to check if a filter is supported for current API
export const isFilterSupported = (api: LinkedInApiType, filterKey: FilterKey): boolean => {
  return FILTER_API_SUPPORT[api]?.[filterKey]?.supported ?? false;
};

// Helper to get tooltip for unsupported filter
export const getFilterTooltip = (api: LinkedInApiType, filterKey: FilterKey): string | undefined => {
  return FILTER_API_SUPPORT[api]?.[filterKey]?.tooltip;
};

// Count active filters that are supported
export const countSupportedFilters = (api: LinkedInApiType, filters: FilterKey[]): number => {
  return filters.filter(f => isFilterSupported(api, f)).length;
};
