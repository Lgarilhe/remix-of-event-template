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
  | 'function'
  | 'degree'
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
  | 'company_location'
  | 'groups'
  | 'past_company'
  | 'past_job_title'
  | 'advanced_keywords'
  | 'activity'
  | 'tags';

// Filter support matrix based on Unipile API documentation
export const FILTER_API_SUPPORT: Record<LinkedInApiType, Record<FilterKey, FilterSupport>> = {
  classic: {
    keywords: { supported: true },
    location: { supported: true },
    company: { supported: true },
    industry: { supported: true },
    school: { supported: true },
    job_title: { supported: false, tooltip: "Utilisez 'Mots-clés avancés > Titre' ou le filtre 'Mots-clés' en mode Classic" },
    skills: { supported: false, tooltip: "Les compétences ne sont pas disponibles en mode Classic. Utilisez Recruiter" },
    role: { supported: false, tooltip: "Le filtre de rôle booléen n'est disponible qu'en mode Recruiter" },
    function: { supported: false, tooltip: "Le département n'est pas disponible en mode Classic" },
    degree: { supported: false, tooltip: "Le niveau d'études n'est pas disponible en mode Classic" },
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
    company_location: { supported: false, tooltip: "La localisation de l'entreprise n'est pas disponible en mode Classic" },
    groups: { supported: false, tooltip: "Les groupes ne sont disponibles qu'en mode Sales Navigator" },
    past_company: { supported: true },
    past_job_title: { supported: false, tooltip: "Les titres passés ne sont pas filtrables en mode Classic" },
    advanced_keywords: { supported: true }, // first_name, last_name, title, company, school
    activity: { supported: false, tooltip: "Les filtres d'activité ne sont disponibles qu'en mode Recruiter" },
    tags: { supported: false, tooltip: "Les tags ne sont disponibles qu'en mode Recruiter" },
  },
  recruiter: {
    keywords: { supported: true },
    location: { supported: true },
    company: { supported: true },
    industry: { supported: true },
    school: { supported: true }, // With priority
    job_title: { supported: true }, // With priority
    skills: { supported: true }, // With priority
    role: { supported: true }, // With keywords, priority, scope
    function: { supported: true }, // Department filter
    degree: { supported: true }, // With priority
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
    company_location: { supported: false, tooltip: "Utilisez Sales Navigator pour filtrer par localisation d'entreprise" },
    groups: { supported: false, tooltip: "Les groupes ne sont disponibles qu'en mode Sales Navigator" },
    past_company: { supported: true },
    past_job_title: { supported: true }, // With priority
    advanced_keywords: { supported: false, tooltip: "Utilisez les filtres de rôle et titre de poste en mode Recruiter" },
    activity: { supported: true }, // recruiting_activity with id, priority, timespan
    tags: { supported: true }, // Via recruiting_activity with id='tags'
  },
  sales_navigator: {
    keywords: { supported: true },
    location: { supported: true }, // With include/exclude
    company: { supported: true }, // With include/exclude
    industry: { supported: true }, // With include/exclude
    school: { supported: true }, // With include/exclude
    job_title: { supported: true }, // current_job_title with priority
    skills: { supported: false, tooltip: "Les compétences ne sont pas disponibles en Sales Navigator. Utilisez Recruiter" },
    role: { supported: false, tooltip: "Le filtre de rôle booléen n'est disponible qu'en mode Recruiter" },
    function: { supported: true }, // Department with include/exclude
    degree: { supported: false, tooltip: "Le niveau d'études n'est pas disponible en Sales Navigator" },
    seniority: { supported: true },
    network_distance: { supported: true },
    profile_language: { supported: true },
    years_of_experience: { supported: true }, // tenure
    tenure_at_company: { supported: true },
    tenure_at_role: { supported: false, tooltip: "L'ancienneté au poste n'est pas disponible en Sales Navigator" },
    open_to_work: { supported: false, tooltip: "Open to Work n'est pas disponible en Sales Navigator" },
    open_to: { supported: false, tooltip: "Open to n'est pas disponible en Sales Navigator" },
    spotlight: { supported: false, tooltip: "Spotlight n'est disponible qu'en mode Recruiter" },
    hiring_project: { supported: false, tooltip: "Les projets de recrutement ne sont disponibles qu'en mode Recruiter" },
    talent_pool: { supported: false, tooltip: "Les talent pools ne sont disponibles qu'en mode Recruiter" },
    company_headcount: { supported: true },
    company_type: { supported: true },
    company_location: { supported: true }, // With include/exclude
    groups: { supported: true },
    past_company: { supported: true }, // With include/exclude
    past_job_title: { supported: true }, // With priority
    advanced_keywords: { supported: false, tooltip: "Utilisez les filtres de nom et titre en mode Sales Navigator" },
    activity: { supported: false, tooltip: "Les filtres d'activité ne sont disponibles qu'en mode Recruiter" },
    tags: { supported: false, tooltip: "Les tags ne sont disponibles qu'en mode Recruiter" },
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
