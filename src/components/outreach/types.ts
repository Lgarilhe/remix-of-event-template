// Types for LinkedIn Outreach filters

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

// Full LinkedIn filters state
export interface LinkedInFiltersState {
  keywords: string;
  
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
  
  // Simple enum filters
  seniority: string[];
  network_distance: number[];
  
  // Numeric range
  years_of_experience_min: number | null;
  years_of_experience_max: number | null;
  
  // Boolean filters
  open_to_work: boolean | null;
  
  // Recruiter specific IDs
  hiring_project: string;
  talent_pool: string;
  spotlight: string;
}

export const INITIAL_FILTERS: LinkedInFiltersState = {
  keywords: '',
  location: [],
  company: [],
  industry: [],
  school: [],
  job_title: [],
  skills: [],
  role: [],
  seniority: [],
  network_distance: [],
  years_of_experience_min: null,
  years_of_experience_max: null,
  open_to_work: null,
  hiring_project: '',
  talent_pool: '',
  spotlight: '',
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
  member_urn?: string;
  public_identifier?: string;
  current_positions?: Array<{
    company?: string;
    company_id?: string;
    role?: string;
    description?: string;
    location?: string;
    tenure_at_company?: { years?: number; months?: number };
    tenure_at_role?: { years?: number; months?: number };
  }>;
}

// Seniority levels
export const SENIORITY_LEVELS = [
  { value: 'Entry', label: 'Débutant' },
  { value: 'Mid', label: 'Intermédiaire' },
  { value: 'Senior', label: 'Senior' },
  { value: 'Director', label: 'Directeur' },
  { value: 'VP', label: 'VP' },
  { value: 'CXO', label: 'C-Level' },
];

// Network distances
export const NETWORK_DISTANCES = [
  { value: 1, label: '1er degré' },
  { value: 2, label: '2ème degré' },
  { value: 3, label: '3ème degré' },
];

// Priority options
export const PRIORITY_OPTIONS = [
  { value: 'MUST_HAVE', label: 'Obligatoire', color: 'bg-green-100 text-green-700' },
  { value: 'SHOULD_HAVE', label: 'Préféré', color: 'bg-blue-100 text-blue-700' },
  { value: 'DOESNT_HAVE', label: 'Exclure', color: 'bg-red-100 text-red-700' },
];

// Scope options
export const SCOPE_OPTIONS = [
  { value: 'CURRENT', label: 'Actuel' },
  { value: 'PAST', label: 'Passé' },
  { value: 'CURRENT_OR_PAST', label: 'Actuel ou passé' },
];

// Spotlight options (Recruiter)
export const SPOTLIGHT_OPTIONS = [
  { value: '', label: 'Tous' },
  { value: 'RECENTLY_CHANGED_JOBS', label: 'Changement récent de poste' },
  { value: 'RECENTLY_PROMOTED', label: 'Promu récemment' },
  { value: 'OPEN_LINK', label: 'Open Link' },
];
