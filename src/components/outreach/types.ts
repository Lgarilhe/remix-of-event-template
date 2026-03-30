// Types for LinkedIn Outreach filters - Based on Unipile API Reference

// A filter item with both ID (for API) and display name
export interface FilterItem {
  id: string;
  name: string;
}

// Priority for advanced filters (Recruiter/Sales Navigator)
// CAN_HAVE = Nice to have, MUST_HAVE = Required, DOESNT_HAVE = Exclude
export type FilterPriority = 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE';

// Scope for role/title filters
export type FilterScope = 'CURRENT' | 'PAST' | 'CURRENT_OR_PAST';

// Location scope (different from role scope - for Recruiter location filter)
export type LocationScope = 'CURRENT' | 'OPEN_TO_RELOCATE_ONLY' | 'CURRENT_OR_OPEN_TO_RELOCATE';

// Advanced filter with priority
export interface PriorityFilterItem extends FilterItem {
  priority: FilterPriority;
}

// Location filter with priority and scope (Recruiter specific)
export interface LocationFilterItem extends FilterItem {
  priority: FilterPriority;
  scope: LocationScope;
}

// Role filter with keywords, priority and scope
export interface RoleFilter {
  keywords: string;
  priority: FilterPriority;
  scope: FilterScope;
}

// API type (service) — includes 'database' for Base Konekt search
export type LinkedInApiType = 'classic' | 'recruiter' | 'sales_navigator' | 'database';

// Search category
export type SearchCategory = 'people' | 'companies' | 'jobs' | 'posts';

// Open to work types
export type OpenToType = 'all' | 'jobs' | 'hiring' | 'services' | 'providing' | 'proBono' | 'boardMember';

// Spotlight types for Recruiter (valid Unipile API values)
export type SpotlightType = 
  | 'OPEN_TO_WORK'
  | 'ACTIVE_TALENT'
  | 'REDISCOVERED_CANDIDATES'
  | 'INTERNAL_CANDIDATES'
  | 'INTERESTED_IN_YOUR_COMPANY'
  | 'HAVE_COMPANY_CONNECTIONS';

// Full LinkedIn filters state
// Activity filter types (Recruiter specific)
export type ActivityMessageType = 'with_message' | 'without_message' | null;
export type ActivityNoteType = 'with_note' | 'without_note' | null;

// Backward compatibility
export type ActivityType = 'with_message' | 'without_message' | 'with_note' | 'without_note';

// Company keyword filter (Recruiter specific)
export type CompanyPriority = 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE';
export type CompanyScope = 'CURRENT_OR_PAST' | 'CURRENT' | 'PAST' | 'PAST_NOT_CURRENT';

export interface CompanyKeywordFilter {
  keywords: string;
  priority: CompanyPriority;
  scope: CompanyScope;
}

export interface LinkedInFiltersState {
  // Basic search
  keywords: string;
  
  // API service type
  api: LinkedInApiType;
  category: SearchCategory;
  
  // Location filter - uses LocationFilterItem for Recruiter with priority/scope
  location: LocationFilterItem[];
  location_within_area: number | null; // Search radius in miles (Recruiter only)
  
  // Company filters - ID-based (all APIs) and Keywords-based (Recruiter only)
  company: FilterItem[];
  company_keywords: CompanyKeywordFilter[]; // Keywords with priority/scope (Recruiter only)
  
  industry: FilterItem[];
  school: PriorityFilterItem[]; // Now supports priority for Recruiter
  
  // Advanced filters with priority
  job_title: PriorityFilterItem[];
  skills: PriorityFilterItem[];
  
  // Role filter (Recruiter specific with keywords + scope)
  role: RoleFilter[];
  
  // Function/Department filter (Recruiter/Sales Nav)
  function: FilterItem[];
  
  // Degree filter (Recruiter)
  degree: PriorityFilterItem[];
  
  // Simple enum filters - using string arrays as per API
  seniority: string[];
  network_distance: number[];
  
  // Languages
  profile_language: string[];
  
  // Numeric ranges (API-based - may not work reliably)
  years_of_experience_min: number | null;
  years_of_experience_max: number | null;
  
  // CLIENT-SIDE experience filter (calculated from education end date)
  // This is more reliable than LinkedIn's years_of_experience
  calculated_experience_min: number | null;
  calculated_experience_max: number | null;
  
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
  company_location: FilterItem[];
  
  // Groups (Sales Navigator)
  groups: FilterItem[];
  
  // Past filters
  past_company: FilterItem[];
  past_job_title: PriorityFilterItem[];
  
  // Advanced keywords (Classic)
  first_name: string;
  last_name: string;
  title_keywords: string;
  
  // AI-generated keyword-based filters (from generate-search-filters)
  skills_keywords: string[];              // Skills/certs/domains identified by AI
  industry_keywords: string[];            // Industries identified by AI

  // Company type filters (smart filtering)
  exclude_consulting: boolean;            // Exclude ESN/consulting firms (IT Services industry)
  company_category: 'all' | 'startup' | 'scaleup' | 'enterprise' | ''; // Filter by company size category

  // Activity filters (Recruiter specific)
  activity_messages: ActivityMessageType;  // with_message, without_message
  activity_messages_days: number | null;   // Since X days (null = all time)
  activity_notes: ActivityNoteType;        // with_note, without_note
  activity_notes_days: number | null;      // Since X days (null = all time)
  tags: string[];                          // Tag IDs
}

export const INITIAL_FILTERS: LinkedInFiltersState = {
  keywords: '',
  api: 'recruiter',
  category: 'people',
  location: [],
  location_within_area: null,
  company: [],
  company_keywords: [],
  industry: [],
  school: [],
  job_title: [],
  skills: [],
  role: [],
  function: [],
  degree: [],
  seniority: [],
  network_distance: [],
  profile_language: [],
  years_of_experience_min: null,
  years_of_experience_max: null,
  calculated_experience_min: null,
  calculated_experience_max: null,
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
  company_location: [],
  groups: [],
  past_company: [],
  past_job_title: [],
  first_name: '',
  last_name: '',
  title_keywords: '',
  // AI-generated keyword filters
  skills_keywords: [],
  industry_keywords: [],
  // Company type filters
  exclude_consulting: false,
  company_category: '',
  // Activity filters
  activity_messages: 'without_message',
  activity_messages_days: 90,
  activity_notes: null,
  activity_notes_days: null,
  tags: [],
};

// Predefined day ranges for activity filters
export const ACTIVITY_DAYS_OPTIONS = [
  { value: null, label: 'Tout le temps' },
  { value: 7, label: '7 derniers jours' },
  { value: 14, label: '14 derniers jours' },
  { value: 30, label: '30 derniers jours' },
  { value: 60, label: '60 derniers jours' },
  { value: 90, label: '90 derniers jours' },
  { value: 180, label: '6 derniers mois' },
  { value: 365, label: '12 derniers mois' },
];

// Activity filter options
export const ACTIVITY_MESSAGE_OPTIONS = [
  { value: 'with_message', label: 'Avec messages' },
  { value: 'without_message', label: 'Sans messages' },
];

export const ACTIVITY_NOTE_OPTIONS = [
  { value: 'with_note', label: 'Avec notes' },
  { value: 'without_note', label: 'Sans notes' },
];

// LinkedIn profile from search results
export interface LinkedInProfile {
  id: string;
  type?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  summary?: string;
  profile_url?: string;
  public_profile_url?: string;
  profile_picture_url?: string;
  profile_picture_url_large?: string;
  background_picture_url?: string;
  location?: string;
  industry?: string;
  network_distance?: string | number;
  open_to_work?: boolean;
  is_open_to_work?: boolean; // Profile API format
  premium?: boolean;
  is_premium?: boolean; // Profile API format
  open_profile?: boolean;
  is_open_profile?: boolean; // Profile API format
  is_hiring?: boolean;
  is_influencer?: boolean;
  is_creator?: boolean;
  pending_invitation?: boolean;
  invitation?: { type: 'SENT' | 'RECEIVED'; status: 'PENDING' | 'IGNORED' | 'WITHDRAWN' };
  can_send_inmail?: boolean;
  recruiter_candidate_id?: string;
  member_urn?: string;
  public_identifier?: string;
  provider_id?: string;
  pronoun?: string;
  connections_count?: number;
  followers_count?: number;
  shared_connections_count?: number;
  interests?: string[];
  // Contact info (profile API only)
  contact_info?: {
    emails?: string[];
    phones?: string[];
    adresses?: string[];
    socials?: Array<{ type: string; name: string }>;
  };
  primary_locale?: { country: string; language: string };
  skills?: Array<{
    name: string;
    endorsement_count?: number;
    endorsement_id?: number | null;
    insights?: string[];
    endorsed?: boolean;
  }>;
  education?: Array<{
    id?: string;
    school?: string;
    school_id?: string;
    school_url?: string;
    school_picture_url?: string;
    degree?: string;
    grade?: string;
    description?: string;
    activities?: string;
    field_of_study?: string;
    skills?: string[];
    start?: string | { year?: number; month?: number } | null;
    end?: string | { year?: number; month?: number } | null;
    school_details?: {
      name?: string;
      employeeCount?: number;
      location?: string;
      description?: string;
      url?: string;
      logo?: string | null;
    };
  }>;
  // API returns work_experience (full history)
  work_experience?: Array<{
    id?: string;
    company?: string;
    company_id?: string;
    company_url?: string;
    company_picture_url?: string;
    company_description?: string;
    company_headcount?: { min?: number; max?: number } | null;
    industry?: string | string[];
    location?: string;
    role?: string; // Search API field name
    position?: string; // Profile API field name (normalized to role by edge function)
    description?: string;
    current?: boolean;
    status?: string;
    skills?: Array<{ name: string; endorsement_count?: number }> | string[];
    logo?: string;
    start?: string | { month?: number; year?: number } | null;
    end?: string | { month?: number; year?: number } | null;
  }>;
  // Certifications
  certifications?: Array<{
    name?: string;
    organization?: string;
    url?: string;
  }>;
  // Projects
  projects?: Array<{
    name?: string;
    description?: string;
    skills?: string[];
    start?: string | null;
    end?: string | null;
  }>;
  // Volunteering
  volunteering_experience?: Array<{
    company?: string;
    description?: string;
    role?: string;
    cause?: string;
    start?: string | null;
    end?: string | null;
  }>;
  // Languages
  languages?: Array<{
    name: string;
    proficiency?: string;
  }>;
  // Recommendations received
  recommendations?: {
    received?: Array<{
      text?: string;
      caption?: string;
      actor?: { first_name?: string; last_name?: string; provider_id?: string; headline?: string; public_identifier?: string; public_profile_url?: string };
    }>;
    received_total_count?: number;
    given?: Array<{
      text?: string;
      caption?: string;
    }>;
    given_total_count?: number;
  };
  // Hashtags / creator topics
  hashtags?: string[];
  // Websites
  websites?: string[];
  // Tags (Recruiter)
  tags?: Array<{ id: string; name: string }>;
  // Recruiter notes
  notes?: Array<{ project_id: string; content: string; created_at: number; author: any }>;
  // Recruiting activity (profile API)
  recruiting_activity?: Array<Record<string, unknown>>;
  // Throttled sections indicator
  throttled_sections?: string[];
  // Recent posts (fetched separately via /users/{id}/posts)
  recent_posts?: Array<{
    text?: string;
    title?: string;
    date?: string;
    reaction_counter?: number;
    comment_counter?: number;
    repost_counter?: number;
  }>;
  // Search result specific fields
  keywords_match?: string;
  recently_hired?: boolean;
  mentioned_in_the_news?: boolean;
  verified?: boolean;
  hiddenCandidate?: boolean;
  interestLikelihood?: string;
  last_outreach_activity?: { type: string; performed_at: string };
  recent_posts_count?: number;
  // Legacy fields (may still be used by some endpoints)
  current_positions?: Array<{
    company?: string;
    company_id?: string;
    company_url?: string;
    company_description?: string;
    company_headcount?: { min?: number; max?: number } | null;
    logo?: string;
    role?: string;
    description?: string;
    location?: string;
    industry?: string[];
    skills?: Array<{ name: string; endorsement_count?: number }> | null;
    start?: string | { month?: number; year?: number };
    end?: string | { month?: number; year?: number };
    tenure_at_company?: { years?: number; months?: number };
    tenure_at_role?: { years?: number; months?: number };
  }>;
  past_positions?: Array<{
    company?: string;
    company_id?: string;
    role?: string;
    description?: string;
    location?: string;
    start?: string | { month?: number; year?: number };
    end?: string | { month?: number; year?: number };
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

// Priority options for all filters that support priority
export const PRIORITY_OPTIONS = [
  { value: 'MUST_HAVE', label: 'Obligatoire', color: 'bg-green-100 text-green-700', icon: '✓' },
  { value: 'CAN_HAVE', label: 'Souhaité', color: 'bg-blue-100 text-blue-700', icon: '○' },
  { value: 'DOESNT_HAVE', label: 'Exclure', color: 'bg-red-100 text-red-700', icon: '✕' },
];

// Role-specific priority options (CAN_HAVE may not be supported for role filter)
export const ROLE_PRIORITY_OPTIONS = [
  { value: 'MUST_HAVE', label: 'Obligatoire', color: 'bg-green-100 text-green-700', icon: '✓' },
  { value: 'DOESNT_HAVE', label: 'Exclure', color: 'bg-red-100 text-red-700', icon: '✕' },
];

// Scope options for role/title
export const SCOPE_OPTIONS = [
  { value: 'CURRENT', label: 'Poste actuel' },
  { value: 'PAST', label: 'Poste passé' },
  { value: 'CURRENT_OR_PAST', label: 'Actuel ou passé' },
];

// Location scope options (Recruiter specific)
export const LOCATION_SCOPE_OPTIONS = [
  { value: 'CURRENT', label: 'Localisation actuelle' },
  { value: 'OPEN_TO_RELOCATE_ONLY', label: 'Ouvert à la relocalisation' },
  { value: 'CURRENT_OR_OPEN_TO_RELOCATE', label: 'Actuel ou ouvert' },
];

// Location radius options in miles (Recruiter specific)
export const LOCATION_RADIUS_OPTIONS = [
  { value: null, label: 'Pas de limite' },
  { value: 10, label: '10 miles (~16 km)' },
  { value: 25, label: '25 miles (~40 km)' },
  { value: 35, label: '35 miles (~56 km)' },
  { value: 50, label: '50 miles (~80 km)' },
  { value: 75, label: '75 miles (~120 km)' },
  { value: 100, label: '100 miles (~160 km)' },
];

// Spotlight options (Recruiter specific - valid Unipile API values)
export const SPOTLIGHT_OPTIONS = [
  { value: '', label: 'Tous les profils' },
  { value: 'OPEN_TO_WORK', label: 'Open to Work' },
  { value: 'ACTIVE_TALENT', label: 'Talent actif' },
  { value: 'REDISCOVERED_CANDIDATES', label: 'Candidats redécouverts' },
  { value: 'INTERNAL_CANDIDATES', label: 'Candidats internes' },
  { value: 'INTERESTED_IN_YOUR_COMPANY', label: 'Intéressé par votre entreprise' },
  { value: 'HAVE_COMPANY_CONNECTIONS', label: 'Connexions dans l\'entreprise' },
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

// Company types (Sales Navigator)
export const COMPANY_TYPE_OPTIONS = [
  { value: 'public_company', label: 'Entreprise publique' },
  { value: 'privately_held', label: 'Entreprise privée' },
  { value: 'non_profit', label: 'Association' },
  { value: 'educational_institution', label: 'Établissement éducatif' },
  { value: 'partnership', label: 'Partenariat' },
  { value: 'self_employed', label: 'Auto-entrepreneur' },
  { value: 'government_agency', label: 'Agence gouvernementale' },
];

// Open to types (different per API)
export const OPEN_TO_OPTIONS_CLASSIC = [
  { value: 'proBono', label: 'Pro Bono' },
  { value: 'boardMember', label: 'Board Member' },
];

export const OPEN_TO_OPTIONS_RECRUITER = [
  { value: 'all', label: 'Tous (Open to Work)' },
  { value: 'jobs', label: 'Ouvert aux opportunités' },
  { value: 'hiring', label: 'En recrutement' },
  { value: 'services', label: 'Services' },
];

// Degree options (Recruiter)
export const DEGREE_OPTIONS = [
  { value: '1', label: 'Baccalauréat / High School' },
  { value: '2', label: 'Licence / Bachelor\'s' },
  { value: '3', label: 'Master / Master\'s' },
  { value: '4', label: 'MBA' },
  { value: '5', label: 'Doctorat / PhD' },
  { value: '6', label: 'Autre' },
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
  DEGREE: 'DEGREE',
  DEPARTMENT: 'DEPARTMENT',
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
  SALES_INDUSTRY: 'SALES_INDUSTRY',
} as const;
