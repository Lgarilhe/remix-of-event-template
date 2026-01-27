// Types for LinkedIn Outreach filters - Based on Unipile API Reference

// A filter item with both ID (for API) and display name
export interface FilterItem {
  id: string;
  name: string;
}

// Priority for advanced filters (Recruiter)
export type FilterPriority = 'MUST_HAVE' | 'SHOULD_HAVE' | 'DOESNT_HAVE';

// Scope for role/title filters
export type FilterScope = 'CURRENT' | 'PAST' | 'CURRENT_OR_PAST';

// Advanced filter with priority
export interface PriorityFilterItem extends FilterItem {
  priority: FilterPriority;
}

// Role filter with keywords, priority and scope
export interface RoleFilter {
  keywords: string;
  priority: FilterPriority;
  scope: FilterScope;
}

// LinkedIn API type (service)
export type LinkedInApiType = 'classic' | 'recruiter' | 'sales_navigator';

// Search category
export type SearchCategory = 'people' | 'companies' | 'jobs' | 'posts';

// Open to work types
export type OpenToType = 'all' | 'jobs' | 'hiring' | 'services' | 'providing';

// Spotlight types for Recruiter
export type SpotlightType = 
  | 'RECENTLY_CHANGED_JOBS'
  | 'RECENTLY_PROMOTED' 
  | 'OPEN_LINK'
  | 'SHARED_EXPERIENCES'
  | 'LIKELY_TO_RESPOND'
  | 'VETERAN'
  | 'PREMIUM'
  | 'OPEN_TO_WORK';

// Full LinkedIn filters state
export interface LinkedInFiltersState {
  // Basic search
  keywords: string;
  
  // API service type
  api: LinkedInApiType;
  category: SearchCategory;
  
  // Simple ID-based filters (store both id and name for display)
  location: FilterItem[];
  company: FilterItem[];
  industry: FilterItem[];
  school: FilterItem[];
  
  // Advanced filters with priority
  job_title: PriorityFilterItem[];
  skills: PriorityFilterItem[];
  
  // Role filter (Recruiter specific with keywords + scope)
  role: RoleFilter[];
  
  // Simple enum filters - using string arrays as per API
  seniority: string[];
  network_distance: number[];
  
  // Languages
  profile_language: string[];
  
  // Numeric ranges
  years_of_experience_min: number | null;
  years_of_experience_max: number | null;
  
  // Tenure filters (Sales Navigator/Recruiter)
  tenure_at_company_min: number | null;
  tenure_at_company_max: number | null;
  tenure_at_role_min: number | null;
  tenure_at_role_max: number | null;
  
  // Boolean/enum filters
  open_to_work: boolean | null;
  open_to: OpenToType[];
  
  // Recruiter specific
  hiring_project: string;
  talent_pool: string;
  spotlight: SpotlightType | '';
  
  // Company filters (Sales Navigator)
  company_headcount: string[];
  company_type: string[];
  company_revenue: string[];
  
  // Past filters
  past_company: FilterItem[];
  past_job_title: PriorityFilterItem[];
}

export const INITIAL_FILTERS: LinkedInFiltersState = {
  keywords: '',
  api: 'recruiter',
  category: 'people',
  location: [],
  company: [],
  industry: [],
  school: [],
  job_title: [],
  skills: [],
  role: [],
  seniority: [],
  network_distance: [],
  profile_language: [],
  years_of_experience_min: null,
  years_of_experience_max: null,
  tenure_at_company_min: null,
  tenure_at_company_max: null,
  tenure_at_role_min: null,
  tenure_at_role_max: null,
  open_to_work: null,
  open_to: [],
  hiring_project: '',
  talent_pool: '',
  spotlight: '',
  company_headcount: [],
  company_type: [],
  company_revenue: [],
  past_company: [],
  past_job_title: [],
};

// LinkedIn profile from search results
export interface LinkedInProfile {
  id: string;
  type?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  profile_url?: string;
  public_profile_url?: string;
  profile_picture_url?: string;
  location?: string;
  industry?: string;
  network_distance?: string | number;
  open_to_work?: boolean;
  premium?: boolean;
  open_profile?: boolean;
  pending_invitation?: boolean;
  can_send_inmail?: boolean;
  recruiter_candidate_id?: string;
  member_urn?: string;
  public_identifier?: string;
  current_positions?: Array<{
    company?: string;
    company_id?: string;
    role?: string;
    description?: string;
    location?: string;
    start?: { month?: number; year?: number };
    tenure_at_company?: { years?: number; months?: number };
    tenure_at_role?: { years?: number; months?: number };
  }>;
  past_positions?: Array<{
    company?: string;
    company_id?: string;
    role?: string;
    description?: string;
    location?: string;
    start?: { month?: number; year?: number };
    end?: { month?: number; year?: number };
  }>;
}

// API type options
export const API_TYPE_OPTIONS = [
  { value: 'recruiter', label: 'Recruiter', requiresSubscription: true },
  { value: 'sales_navigator', label: 'Sales Navigator', requiresSubscription: true },
  { value: 'classic', label: 'LinkedIn Classic', requiresSubscription: false },
];

// Seniority levels (Recruiter uses different values)
export const SENIORITY_LEVELS = [
  { value: '1', label: 'Débutant (0-2 ans)', apiValue: 'Entry' },
  { value: '2', label: 'Associé', apiValue: 'Associate' },
  { value: '3', label: 'Intermédiaire (3-5 ans)', apiValue: 'Mid' },
  { value: '4', label: 'Senior (6-9 ans)', apiValue: 'Senior' },
  { value: '5', label: 'Manager', apiValue: 'Manager' },
  { value: '6', label: 'Directeur', apiValue: 'Director' },
  { value: '7', label: 'VP', apiValue: 'VP' },
  { value: '8', label: 'C-Level', apiValue: 'CXO' },
  { value: '9', label: 'Partner', apiValue: 'Partner' },
  { value: '10', label: 'Owner', apiValue: 'Owner' },
];

// Network distances
export const NETWORK_DISTANCES = [
  { value: 1, label: '1er degré (Connexions)' },
  { value: 2, label: '2ème degré' },
  { value: 3, label: '3ème degré' },
];

// Priority options
export const PRIORITY_OPTIONS = [
  { value: 'MUST_HAVE', label: 'Obligatoire', color: 'bg-green-100 text-green-700', icon: '✓' },
  { value: 'SHOULD_HAVE', label: 'Préféré', color: 'bg-blue-100 text-blue-700', icon: '○' },
  { value: 'DOESNT_HAVE', label: 'Exclure', color: 'bg-red-100 text-red-700', icon: '✕' },
];

// Scope options for role/title
export const SCOPE_OPTIONS = [
  { value: 'CURRENT', label: 'Poste actuel' },
  { value: 'PAST', label: 'Poste passé' },
  { value: 'CURRENT_OR_PAST', label: 'Actuel ou passé' },
];

// Spotlight options (Recruiter specific)
export const SPOTLIGHT_OPTIONS = [
  { value: '', label: 'Tous les profils' },
  { value: 'RECENTLY_CHANGED_JOBS', label: 'Changement de poste récent' },
  { value: 'RECENTLY_PROMOTED', label: 'Récemment promu' },
  { value: 'OPEN_LINK', label: 'Open Link (InMail gratuit)' },
  { value: 'OPEN_TO_WORK', label: 'Open to Work' },
  { value: 'LIKELY_TO_RESPOND', label: 'Susceptible de répondre' },
  { value: 'SHARED_EXPERIENCES', label: 'Expériences communes' },
  { value: 'VETERAN', label: 'Vétéran' },
  { value: 'PREMIUM', label: 'Compte Premium' },
];

// Profile languages
export const PROFILE_LANGUAGES = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'Anglais' },
  { value: 'es', label: 'Espagnol' },
  { value: 'de', label: 'Allemand' },
  { value: 'it', label: 'Italien' },
  { value: 'pt', label: 'Portugais' },
  { value: 'nl', label: 'Néerlandais' },
  { value: 'zh', label: 'Chinois' },
  { value: 'ja', label: 'Japonais' },
  { value: 'ar', label: 'Arabe' },
];

// Company headcount ranges (Sales Navigator)
export const COMPANY_HEADCOUNT_OPTIONS = [
  { value: 'A', label: 'Auto-entrepreneur (1)' },
  { value: 'B', label: '2-10' },
  { value: 'C', label: '11-50' },
  { value: 'D', label: '51-200' },
  { value: 'E', label: '201-500' },
  { value: 'F', label: '501-1000' },
  { value: 'G', label: '1001-5000' },
  { value: 'H', label: '5001-10000' },
  { value: 'I', label: '10001+' },
];

// Company types
export const COMPANY_TYPE_OPTIONS = [
  { value: 'C', label: 'Entreprise publique' },
  { value: 'D', label: 'Détenue par le gouvernement' },
  { value: 'E', label: 'Association' },
  { value: 'G', label: 'Auto-entrepreneur' },
  { value: 'O', label: 'Entreprise privée' },
  { value: 'P', label: 'Partenariat' },
  { value: 'S', label: 'Établissement éducatif' },
];

// Open to types
export const OPEN_TO_OPTIONS = [
  { value: 'all', label: 'Tous (Open to Work)' },
  { value: 'jobs', label: 'Ouvert aux opportunités' },
  { value: 'hiring', label: 'En recrutement' },
  { value: 'services', label: 'Services' },
];

// Parameter types for autocomplete API
export const PARAMETER_TYPES = {
  LOCATION: 'LOCATION',
  COMPANY: 'COMPANY',
  SCHOOL: 'SCHOOL',
  INDUSTRY: 'INDUSTRY',
  JOB_TITLE: 'JOB_TITLE',
  SKILL: 'SKILL',
  SERVICE: 'SERVICE',
  JOB_FUNCTION: 'JOB_FUNCTION',
  PEOPLE: 'PEOPLE',
  CONNECTIONS: 'CONNECTIONS',
  // Recruiter specific
  HIRING_PROJECTS: 'HIRING_PROJECTS',
  TALENT_POOLS: 'TALENT_POOLS',
  SAVED_SEARCHES: 'SAVED_SEARCHES',
  // Sales Navigator specific
  GROUPS: 'GROUPS',
  ACCOUNT_LISTS: 'ACCOUNT_LISTS',
  LEAD_LISTS: 'LEAD_LISTS',
  REGION: 'REGION',
  POSTAL_CODE: 'POSTAL_CODE',
} as const;
