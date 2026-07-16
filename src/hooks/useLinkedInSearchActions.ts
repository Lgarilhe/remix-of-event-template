import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { invokeCoresignal } from '@/lib/invokeCoresignal';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { LinkedInFiltersState, LinkedInProfile, LinkedInApiType } from '@/components/outreach/types';
import { filterByCalculatedExperience } from '@/components/outreach/calculateExperience';
import { classifyFromProfile, CompanyType } from '@/lib/companyClassification';
import { Job } from '@/types/jobs';
import { JobMatchResult } from '@/components/outreach/JobScoreDisplay';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { calculatePreScore, PreScoreResult } from '@/hooks/linkedin/preScoring';
import { toast } from 'sonner';

const RESULTS_PER_BATCH = 25;

// Known geo IDs → location keywords for client-side filtering
const GEO_ID_TO_KEYWORDS: Record<string, string[]> = {
  '105015875': ['france', 'paris', 'lyon', 'marseille', 'toulouse', 'nantes', 'bordeaux', 'lille', 'strasbourg', 'rennes', 'montpellier', 'nice', 'île-de-france', 'ile-de-france', 'idf', 'auvergne', 'rhône', 'provence', 'occitanie', 'bretagne', 'normandie', 'nouvelle-aquitaine', 'hauts-de-france', 'grand est', 'pays de la loire', 'bourgogne', 'centre-val de loire', 'corse', 'fr'],
  '106383538': ['paris', 'île-de-france', 'ile-de-france', 'idf', 'greater paris', 'region parisienne', 'région parisienne', 'hauts-de-seine', 'seine-saint-denis', 'val-de-marne', 'essonne', 'yvelines', 'val-d\'oise', 'seine-et-marne', 'nanterre', 'boulogne', 'saint-denis', 'montreuil', 'versailles', 'creteil', 'créteil', 'evry', 'évry', 'cergy', 'melun', 'bobigny', 'la defense', 'la défense', 'neuilly', 'levallois', 'issy', 'courbevoie', 'puteaux', 'rueil', 'massy', 'saclay', 'france'],
  '101165590': ['united kingdom', 'uk', 'london', 'manchester', 'birmingham', 'leeds', 'glasgow', 'edinburgh', 'england', 'scotland', 'wales'],
  '101174742': ['germany', 'deutschland', 'berlin', 'munich', 'münchen', 'hamburg', 'frankfurt', 'cologne', 'köln', 'düsseldorf', 'stuttgart'],
  '103644278': ['united states', 'usa', 'us', 'new york', 'san francisco', 'los angeles', 'chicago', 'boston', 'seattle', 'austin', 'california', 'texas'],
  '106155005': ['spain', 'españa', 'madrid', 'barcelona', 'valencia', 'seville', 'sevilla'],
  '103350119': ['italy', 'italia', 'rome', 'roma', 'milan', 'milano', 'turin', 'torino', 'naples', 'napoli'],
  '100565514': ['belgium', 'belgique', 'belgi[eë]', 'brussels', 'bruxelles', 'antwerp', 'anvers', 'gent', 'liège'],
  '103883259': ['switzerland', 'suisse', 'schweiz', 'zurich', 'zürich', 'geneva', 'genève', 'bern', 'basel', 'lausanne'],
  '102890719': ['netherlands', 'nederland', 'amsterdam', 'rotterdam', 'the hague', 'den haag', 'utrecht'],
  '100364837': ['portugal', 'lisbon', 'lisboa', 'porto'],
  '104738515': ['canada', 'toronto', 'montreal', 'montréal', 'vancouver', 'ottawa', 'calgary'],
  '101620260': ['australia', 'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide'],
  '102478259': ['singapore', 'singapour'],
  '104305776': ['luxembourg', 'luxemburg'],
  '105646813': ['morocco', 'maroc', 'casablanca', 'rabat', 'marrakech', 'tanger'],
  '102713980': ['india', 'mumbai', 'bangalore', 'bengaluru', 'delhi', 'hyderabad', 'chennai', 'pune', 'kolkata'],
};

/**
 * Client-side location filter — removes profiles whose location field
 * doesn't match any of the requested location filters.
 * LinkedIn API sometimes returns profiles outside the requested location.
 */
function filterByLocation(
  profiles: LinkedInProfile[],
  locationFilters: { id: string; name?: string }[],
): LinkedInProfile[] {
  // Build list of keywords from all active location filters
  const keywords: string[] = [];
  for (const loc of locationFilters) {
    const geoKeywords = GEO_ID_TO_KEYWORDS[loc.id];
    if (geoKeywords) {
      keywords.push(...geoKeywords);
    }
    // Also use the filter's display name if available
    if (loc.name) {
      keywords.push(loc.name.toLowerCase());
    }
  }

  if (keywords.length === 0) return profiles;

  const filtered = profiles.filter(p => {
    if (!p.location) return true; // Don't exclude profiles without location data
    const loc = p.location.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const normalizedKeywords = keywords.map(k =>
      k.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    );
    return normalizedKeywords.some(kw => loc.includes(kw));
  });

  const removed = profiles.length - filtered.length;
  if (removed > 0) {
    console.log(`[LinkedInSearch] Location filter: removed ${removed}/${profiles.length} profiles outside requested location`);
  }

  return filtered;
}

interface SearchContext {
  selectedAccount: string | null;
  selectedJob: Job | null;
  filters: LinkedInFiltersState;
  filtersRef: React.MutableRefObject<LinkedInFiltersState>;
  cursor: string | null;
  results: LinkedInProfile[];
  activeProject?: SourcingProject | null;
  autoHideTreatedRef: React.MutableRefObject<boolean>;
  /** Search source: 'linkedin' (default) or 'database' (Konekt base) */
  searchSource?: 'linkedin' | 'database';
  /** Optional pedigree/competitors augmentation : injecte les IDs résolus
   *  dans filters.school + filters.company avant submit Unipile. */
  pedigreeAugmentation?: SearchAugmentation | null;
  quota: {
    canPerformAction: (action: string, count: number) => boolean;
    recordAction: (action: string, count: number) => void;
    isNearLimit: (action: string) => boolean;
  };
  candidateStatus: {
    treatedIds: Set<string>;
    dismissedIds: Set<string>;
    getStatus?: (id: string) => { status: string } | undefined;
    batchDiscover?: (profiles: Array<{
      id: string;
      name?: string;
      headline?: string;
      profileUrl?: string;
      linkedinProfileData?: any;
    }>) => Promise<void>;
  };
}

interface SearchSetters {
  setLoading: (v: boolean) => void;
  setLoadingMore: (v: boolean) => void;
  setResults: React.Dispatch<React.SetStateAction<LinkedInProfile[]>>;
  setCursor: (v: string | null) => void;
  setHasMoreResults: (v: boolean) => void;
  setTotal: (v: number | null) => void;
  setHasSearched: (v: boolean) => void;
}

/** Optional augmentation : injecte des IDs LinkedIn pré-résolus (annuaire
 *  pedigree global ou concurrents client) dans les filtres avant submit. */
export interface SearchAugmentation {
  schoolIds?: Array<{ id: string; name: string }>;
  /** Mode "ajout" : merge dans filters.company (élargit les sources). */
  companyIds?: Array<{ id: string; name: string }>;
  /** Mode "restrict" : si true, les companyIds REMPLACENT filters.company
   *  (mode chirurgical / poach — recherche restreinte aux concurrents). */
  restrictCompaniesToAugmented?: boolean;
  /** Mots-clés à exclure côté company_keywords (priority DOESNT_HAVE).
   *  - Recruiter : injecté dans `filters.company_keywords` avec DOESNT_HAVE
   *  - Sales Nav : routé vers `baseParams.company.exclude` (par nom texte,
   *    supporté par l'API native Sales Nav)
   *  - Classic : pas d'exclusion supportée par l'API → drop (scoring-only) */
  excludeCompanyKeywords?: string[];
  /** Niveaux de séniorité LinkedIn ('1'..'10') à merger dans filters.seniority.
   *  Recruiter + Database les transforment en Boolean OR keyword injecté dans
   *  role. Sur Sales Nav, on utilise plutôt salesNavSeniorityInclude. */
  seniorityLevels?: string[];
  /** Enum natif Sales Navigator pour `seniority.include` (ex: senior,
   *  experienced_manager, director, vice_president, cxo). Utilisé uniquement
   *  quand filters.api === 'sales_navigator'. */
  salesNavSeniorityInclude?: string[];
}

export function buildSearchParams(
  filtersInput: LinkedInFiltersState,
  selectedAccount: string,
  augmentation?: SearchAugmentation,
): Record<string, unknown> {
  // Clone défensif : l'augmentation pedigree mute filters.school / filters.company
  // / filters.company_keywords / filters.seniority ci-dessous, on évite de
  // modifier l'objet du caller.
  const filters: LinkedInFiltersState = augmentation
    ? {
      ...filtersInput,
      school: [...filtersInput.school],
      company: [...filtersInput.company],
      company_keywords: [...filtersInput.company_keywords],
      seniority: [...filtersInput.seniority],
    }
    : filtersInput;

  const baseParams: Record<string, unknown> = {
    action: 'search',
    account_id: selectedAccount,
    api: filters.api,
    category: filters.category,
  };

  // Keywords
  if (filters.keywords) baseParams.keywords = filters.keywords;

  // Country-level LinkedIn geo IDs — radius doesn't apply to these
  const COUNTRY_GEO_IDS = new Set([
    '105015875', // France
    '101165590', // United Kingdom
    '101174742', // Germany
    '102713980', // India
    '103644278', // United States
    '106155005', // Spain
    '103350119', // Italy
    '100565514', // Belgium
    '103883259', // Switzerland
    '102890719', // Netherlands
    '100364837', // Portugal
    '104738515', // Canada
    '101620260', // Australia
    '102478259', // Singapore
    '104305776', // Luxembourg
    '105646813', // Morocco
  ]);

  // Location
  if (filters.location.length) {
    if (filters.api === 'recruiter') {
      baseParams.location = filters.location.map(f => ({
        id: f.id,
        name: f.name,
        priority: f.priority || 'MUST_HAVE',
        scope: f.scope || 'CURRENT_OR_OPEN_TO_RELOCATE',
      }));
      // Don't send location_within_area if any location is a country (radius doesn't apply)
      const hasCountryLocation = filters.location.some(f => COUNTRY_GEO_IDS.has(f.id));
      if (filters.location_within_area !== null && !hasCountryLocation) {
        baseParams.location_within_area = filters.location_within_area;
      }
    } else if (filters.api === 'database') {
      // Database mode: send name + id so the backend gets text locations.
      // DOESNT_HAVE dropped: the mapping puts every location in an inclusive
      // clause — an "excluded" location would flip into a positive criterion.
      baseParams.location = filters.location
        .filter(f => f.priority !== 'DOESNT_HAVE')
        .map(f => ({ id: f.id, name: f.name }));
    } else {
      // classic / sales_nav: bare IDs, priority not supported — drop exclusions
      // rather than inverting them into includes.
      baseParams.location = filters.location
        .filter(f => f.priority !== 'DOESNT_HAVE')
        .map(f => f.id);
    }
  }

  // ─── Augmentation : merge IDs annuaire (preset.schools_required) ───
  // Les écoles requises par le preset sont déjà résolues en IDs LinkedIn
  // par le cron resolve-pedigree-directory. On les ajoute au filtre school
  // pour pré-filtrer côté Unipile (au lieu de scorer après search).
  if (augmentation?.schoolIds?.length) {
    const existing = new Set(filters.school.map(s => s.id));
    for (const aug of augmentation.schoolIds) {
      if (!existing.has(aug.id)) {
        filters.school.push({ id: aug.id, name: aug.name } as typeof filters.school[number]);
        existing.add(aug.id);
      }
    }
  }

  // School - with priority handling
  const effectiveSchool =
    filters.api === 'recruiter'
      ? filters.school.filter((f) => (f.priority || 'MUST_HAVE') !== 'CAN_HAVE')
      : filters.school;

  if (effectiveSchool.length) {
    if (filters.api === 'recruiter') {
      const includeSchools = effectiveSchool.filter(f => f.priority !== 'DOESNT_HAVE');
      const excludeSchools = effectiveSchool.filter(f => f.priority === 'DOESNT_HAVE');
      
      const schoolFilters = [
        ...includeSchools.map(f => ({ id: f.id, priority: 'CAN_HAVE' as const })),
        ...excludeSchools.map(f => ({ id: f.id, priority: 'DOESNT_HAVE' as const })),
      ];
      
      if (schoolFilters.length > 0) {
        baseParams.school = schoolFilters;
      }
    } else if (filters.api === 'database') {
      // Database: send names (Apollo rejects numeric IDs)
      baseParams.school = effectiveSchool.map(f => ({ id: f.id, name: f.name || f.id }));
    } else {
      // classic / sales_nav: bare IDs wrapped in {include} by the edge —
      // a DOESNT_HAVE school would become an INCLUDE criterion. Drop them.
      baseParams.school = effectiveSchool
        .filter(f => f.priority !== 'DOESNT_HAVE')
        .map(f => f.id);
    }
  }

  // Industry — send names for database mode (Apollo uses text tags, not LinkedIn IDs)
  if (filters.industry.length) {
    if (filters.api === 'database') {
      baseParams.industry = filters.industry.map(f => f.name || f.id).filter(n => !/^\d+$/.test(n));
    } else {
      baseParams.industry = { include: filters.industry.map(f => f.id) };
    }
  }

  // ─── Augmentation : merge ou remplace les IDs entreprise ──────────────
  // Mode "ajout" (preset companies_specific_required + provenance) : on
  // élargit le filtre company avec les IDs résolus.
  // Mode "restrict" (mode chirurgical concurrents) : on REMPLACE le filtre
  // par les IDs des concurrents → search Unipile restreinte.
  if (augmentation?.companyIds?.length) {
    if (augmentation.restrictCompaniesToAugmented) {
      filters.company = augmentation.companyIds.map(c => ({ id: c.id, name: c.name } as typeof filters.company[number]));
    } else {
      const existing = new Set(filters.company.map(c => c.id));
      for (const aug of augmentation.companyIds) {
        if (!existing.has(aug.id)) {
          filters.company.push({ id: aug.id, name: aug.name } as typeof filters.company[number]);
          existing.add(aug.id);
        }
      }
    }
  }

  // Company — send names for database mode (Apollo searches by name, not LinkedIn IDs)
  if (filters.company.length) {
    if (filters.api === 'database') {
      baseParams.company = filters.company.map(f => f.name || f.id).filter(n => !/^\d+$/.test(n));
    } else {
      baseParams.company = { include: filters.company.map(f => f.id) };
    }
  }

  // ─── Augmentation : companies_avoid → exclude natif sur Sales Navigator ─
  // L'API Sales Nav supporte `company.exclude[]` avec noms texte (pattern .+).
  // Pour Recruiter + Database, l'exclusion passe par filters.company_keywords
  // DOESNT_HAVE (bloc plus bas). Classic n'a pas de support natif → scoring-only.
  if (filters.api === 'sales_navigator' && augmentation?.excludeCompanyKeywords?.length) {
    const currentCompany = (baseParams.company as { include?: string[]; exclude?: string[] } | undefined) || {};
    baseParams.company = {
      ...(currentCompany.include?.length ? { include: currentCompany.include } : {}),
      exclude: [
        ...(currentCompany.exclude || []),
        ...augmentation.excludeCompanyKeywords,
      ],
    };
  }

  // ─── Augmentation : companies_avoid → company_keywords DOESNT_HAVE ─────
  // Le preset companies_avoid résout des catégories en noms d'entreprises
  // canoniques. On les injecte ici comme keywords à exclure. Le bloc
  // company_keywords ci-dessous gate déjà sur Recruiter + Database (les seules
  // licences qui supportent company_keywords avec priority).
  if (augmentation?.excludeCompanyKeywords?.length) {
    const existing = new Set(filters.company_keywords.map(c => `${c.keywords.toLowerCase()}|${c.priority}`));
    for (const kw of augmentation.excludeCompanyKeywords) {
      const sig = `${kw.toLowerCase()}|DOESNT_HAVE`;
      if (existing.has(sig)) continue;
      existing.add(sig);
      filters.company_keywords.push({
        keywords: kw,
        priority: 'DOESNT_HAVE',
        scope: 'CURRENT_OR_PAST',
      });
    }
  }

  // Company keywords (Recruiter + Database)
  if ((filters.api === 'recruiter' || filters.api === 'database') && filters.company_keywords.length) {
    baseParams.company_keywords = filters.company_keywords.map(c => ({
      keywords: c.keywords,
      priority: c.priority,
      scope: c.scope,
    }));
  }

  // Function/Department
  if (filters.function.length) {
    baseParams.function = filters.function.map((f) => f.id);
  }

  // Degree (Recruiter)
  if (filters.degree.length && filters.api === 'recruiter') {
    const sanitiseDegreeIds = (ids: string[]) => {
      return ids.filter((id) => {
        const n = Number(id);
        return Number.isFinite(n) && n > 10;
      });
    };

    const includeIds = sanitiseDegreeIds(
      filters.degree.filter(d => d.priority !== 'DOESNT_HAVE').map(d => d.id)
    );
    const excludeIds = sanitiseDegreeIds(
      filters.degree.filter(d => d.priority === 'DOESNT_HAVE').map(d => d.id)
    );

    if (includeIds.length > 0 || excludeIds.length > 0) {
      baseParams.degree = {
        ...(includeIds.length > 0 && { include: includeIds }),
        ...(excludeIds.length > 0 && { exclude: excludeIds }),
      };
    }
  }

  // Groups (Sales Navigator)
  if (filters.groups.length && filters.api === 'sales_navigator') {
    baseParams.groups = filters.groups.map(f => f.id);
  }

  // Company location (Sales Navigator + Database)
  if (filters.company_location.length && (filters.api === 'sales_navigator' || filters.api === 'database')) {
    if (filters.api === 'database') {
      baseParams.company_location = filters.company_location.map(f => ({ id: f.id, name: f.name || f.id }));
    } else {
      baseParams.company_location = { include: filters.company_location.map(f => f.id) };
    }
  }

  // Job title — include name for database mode (Apollo rejects numeric IDs)
  if (filters.job_title.length) {
    baseParams.job_title = filters.job_title.map(item => ({
      id: item.id,
      name: item.name || item.id,
      priority: item.priority,
    }));
  }

  // Skills - support both ID-based (numeric) and keywords-based formats
  if (filters.skills.length) {
    baseParams.skills = filters.skills.map(item => {
      const isNumericId = Number.isFinite(Number(item.id)) && Number(item.id) > 0;
      if (filters.api === 'database') {
        // Database: always send name (Apollo rejects numeric IDs)
        return { keywords: item.name || item.id, name: item.name || item.id, priority: item.priority };
      }
      if (isNumericId) {
        return { id: item.id, name: item.name, priority: item.priority };
      }
      // Keywords-based: use the name field
      return { keywords: item.name || item.id, priority: item.priority };
    });
  }

  // Role with seniority handling
  let allRoles = filters.role.map(r => ({
    keywords: r.keywords,
    priority: r.priority as 'MUST_HAVE' | 'DOESNT_HAVE',
    scope: r.scope as 'CURRENT' | 'PAST' | 'CURRENT_OR_PAST',
  }));

  // ─── Augmentation : min_seniority → merge dans filters.seniority ───────
  // Recruiter/Database vont transformer en Boolean OR keyword dans role
  // (block ci-dessous). Sales Nav / Classic : laissé à l'edge function
  // unipile-search qui a sa propre logique seniority par licence.
  if (augmentation?.seniorityLevels?.length) {
    const existing = new Set(filters.seniority);
    for (const lvl of augmentation.seniorityLevels) {
      if (!existing.has(lvl)) {
        filters.seniority.push(lvl);
        existing.add(lvl);
      }
    }
  }

  if ((filters.api === 'recruiter' || filters.api === 'database') && filters.seniority.length) {
    const titlesByLevel: Record<string, string[]> = {
      '1': ['Intern', 'Internship', 'Stagiaire', 'Apprentice', 'Trainee', 'Graduate'],
      '2': ['Associate', 'Junior', 'Assistant', 'Consultant', 'Analyst'],
      '3': ['Intermediate', 'Confirmé', 'Confirmed', 'Mid', 'Middle'],
      '4': ['Senior', 'Sr', 'Principal', 'Staff', 'Lead'],
      '5': ['Manager', 'Team Lead', 'Head of', 'Engineering Manager', 'Product Manager'],
      '6': ['Director', 'Directeur', 'Head of', 'Senior Director'],
      '7': ['VP', 'Vice President', 'Vice-President', 'SVP', 'EVP'],
      '8': ['CEO', 'CTO', 'CFO', 'COO', 'CMO', 'CIO', 'CHRO', 'Chief', 'C-Level', 'President', 'Président', 'Managing Director'],
      '9': ['Partner', 'Associé', 'Principal', 'Managing Partner'],
      '10': ['Owner', 'Founder', 'Co-Founder', 'Fondateur', 'Propriétaire', 'Entrepreneur'],
    };

    const seniorityKeywords = Array.from(
      new Set(filters.seniority.flatMap((level) => titlesByLevel[level] ?? []))
    ).join(' OR ');

    if (seniorityKeywords) {
      const hasMustHaveRole = allRoles.some(r => r.priority === 'MUST_HAVE');
      if (!hasMustHaveRole) {
        allRoles.push({
          keywords: seniorityKeywords,
          priority: 'MUST_HAVE',
          scope: 'CURRENT',
        });
      }
    }
  }

  if (allRoles.length) {
    baseParams.role = allRoles;
  }

  // ─── Augmentation : min_seniority → seniority natif sur Sales Navigator ─
  // Sales Nav supporte `seniority: { include: [enum] }`. L'edge function
  // unipile-search prend un array de strings, normalise par licence et wrappe
  // automatiquement en {include} pour SN/Recruiter (voir normaliseSeniority +
  // bloc seniority de l'edge function). On envoie donc l'enum SN brut.
  if (filters.api === 'sales_navigator' && augmentation?.salesNavSeniorityInclude?.length) {
    baseParams.seniority = augmentation.salesNavSeniorityInclude;
  }

  if (filters.network_distance.length) baseParams.network_distance = filters.network_distance;
  if (filters.profile_language.length) baseParams.profile_language = filters.profile_language;

  // Years of experience
  const explicitMin = filters.years_of_experience_min;
  const explicitMax = filters.years_of_experience_max;

  if (explicitMin !== null || explicitMax !== null) {
    if (filters.api === 'recruiter') {
      const yearsExp: Record<string, number> = {};
      if (explicitMin !== null) yearsExp.min = explicitMin;
      if (explicitMax !== null) yearsExp.max = explicitMax;
      if (Object.keys(yearsExp).length) {
        baseParams.years_of_experience = yearsExp;
      }
    } else if (filters.api === 'sales_navigator') {
      const tenure: Record<string, number> = {};
      if (explicitMin !== null) tenure.min = explicitMin;
      if (explicitMax !== null) tenure.max = explicitMax;
      if (Object.keys(tenure).length) {
        baseParams.tenure = [tenure];
      }
    }
  }

  // Tenure filters — clé dédiée tenure_at_company : l'edge la mappe en
  // tenure_in_company (Recruiter) / tenure_at_company (SN). L'ancienne clé
  // `tenure` signifie expérience TOTALE côté edge et écrasait years_of_experience.
  if (filters.tenure_at_company_min !== null || filters.tenure_at_company_max !== null) {
    const tenure: Record<string, number> = {};
    if (filters.tenure_at_company_min !== null) tenure.min = filters.tenure_at_company_min;
    if (filters.tenure_at_company_max !== null) tenure.max = filters.tenure_at_company_max;
    baseParams.tenure_at_company = [tenure];
  }

  // Boolean filters
  if (filters.open_to.length) baseParams.open_to = filters.open_to;

  // Recruiter specific
  if (filters.hiring_project) baseParams.hiring_project = filters.hiring_project;

  // Spotlights (Recruiter)
  if (filters.api === 'recruiter') {
    const spotlights = Array.from(
      new Set([
        ...(filters.open_to_work === true ? ['OPEN_TO_WORK'] : []),
        ...(filters.spotlight ? [filters.spotlight] : []),
      ].filter(Boolean))
    ) as string[];

    if (spotlights.length) {
      baseParams.spotlights = spotlights;
    }
  }

  // Recruiting activity
  const recruitingActivity: Array<{
    id: 'messages' | 'tags' | 'notes' | 'projects' | 'resumes' | 'reviews';
    priority: 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE';
    timespan?: number;
  }> = [];

  if (filters.activity_messages) {
    recruitingActivity.push({
      id: 'messages',
      priority: filters.activity_messages === 'with_message' ? 'MUST_HAVE' : 'DOESNT_HAVE',
      timespan: filters.activity_messages_days ?? 3650,
    });
  }

  if (filters.activity_notes) {
    recruitingActivity.push({
      id: 'notes',
      priority: filters.activity_notes === 'with_note' ? 'MUST_HAVE' : 'DOESNT_HAVE',
      timespan: filters.activity_notes_days ?? 3650,
    });
  }

  if (filters.tags.length) {
    recruitingActivity.push({
      id: 'tags',
      priority: 'MUST_HAVE',
      timespan: 3650,
    });
  }

  if (recruitingActivity.length) {
    baseParams.recruiting_activity = recruitingActivity;
  }

  // Company filters (Sales Navigator)
  if (filters.company_headcount.length) baseParams.company_headcount = filters.company_headcount;
  if (filters.company_type.length) baseParams.company_type = filters.company_type;

  // Smart company filters — exclude consulting/ESN
  if (filters.exclude_consulting) {
    // Exclude IT Services & Consulting industry via industry filter
    const consultingIndustries = ['96', '4', '104']; // IT Services, Staffing, Outsourcing LinkedIn IDs
    const currentIndustry = baseParams.industry as any;
    if (currentIndustry?.exclude) {
      currentIndustry.exclude.push(...consultingIndustries);
    } else {
      baseParams.industry = { ...(currentIndustry || {}), exclude: consultingIndustries };
    }
  }

  // Smart company filters — company category (startup/scaleup/enterprise)
  if (filters.company_category) {
    const headcountMap: Record<string, string[]> = {
      startup: ['B', 'C', 'D'],      // 1-200 employees
      scaleup: ['D', 'E', 'F'],      // 51-1000 employees
      enterprise: ['G', 'H', 'I'],   // 1001+ employees
    };
    const codes = headcountMap[filters.company_category];
    if (codes && !filters.company_headcount.length) {
      baseParams.company_headcount = codes;
    }
  }

  // Past filters
  if (filters.past_company.length) {
    baseParams.past_company = { include: filters.past_company.map(f => f.id) };
  }
  if (filters.past_job_title.length) {
    baseParams.past_job_title = filters.past_job_title.map(item => ({
      id: item.id,
      priority: item.priority,
    }));
  }

  // AI-generated keyword-based skills → inject into Boolean keywords for broader matching
  if (filters.skills_keywords?.length) {
    const currentKeywords = String(baseParams.keywords ?? '');
    const existingKeywordsLower = currentKeywords.toLowerCase();
    const newSkills = (filters.skills_keywords as string[])
      .filter((skill: string) => !existingKeywordsLower.includes(skill.toLowerCase()))
      .map((skill) => `"${skill.replace(/"/g, '')}"`) // Sanitize quotes
      .slice(0, 5); // Max 5 skills to avoid overly long Boolean

    if (newSkills.length > 0) {
      const skillsGroup = newSkills.join(' OR ');
      baseParams.keywords = currentKeywords
        ? `(${currentKeywords}) AND (${skillsGroup})`
        : skillsGroup;
    }
  }

  // AI-generated industry keywords → add as context in keywords if no ID-based industry
  if (filters.industry_keywords?.length && !filters.industry?.length) {
    baseParams.industry_keywords = filters.industry_keywords;
  }

  // Database-specific filters (Base Konekt)
  if (filters.api === 'database') {
    if (filters.db_technologies?.length) baseParams.db_technologies = filters.db_technologies;
    if (filters.db_email_verified) baseParams.db_email_verified = true;
    if (filters.db_revenue_min) baseParams.db_revenue_min = filters.db_revenue_min;
    if (filters.db_revenue_max) baseParams.db_revenue_max = filters.db_revenue_max;
    if (filters.db_funding_stage) baseParams.db_funding_stage = filters.db_funding_stage;
    if (filters.db_company_domain) baseParams.db_company_domain = filters.db_company_domain;

    // Hiring velocity (org job count)
    if (filters.db_org_num_jobs_min) baseParams.db_org_num_jobs_min = Number(filters.db_org_num_jobs_min);
    if (filters.db_org_num_jobs_max) baseParams.db_org_num_jobs_max = Number(filters.db_org_num_jobs_max);

    // Apollo advanced filters
    if (filters.db_tech_must_have_all?.length) baseParams.db_tech_must_have_all = filters.db_tech_must_have_all;
    if (filters.db_tech_exclude?.length) baseParams.db_tech_exclude = filters.db_tech_exclude;
    if (filters.db_org_job_locations?.length) baseParams.db_org_job_locations = filters.db_org_job_locations;
    if (filters.db_latest_funding_date_min) baseParams.db_latest_funding_date_min = filters.db_latest_funding_date_min;
    if (filters.db_total_funding_min) baseParams.db_total_funding_min = filters.db_total_funding_min;
    if (filters.db_total_funding_max) baseParams.db_total_funding_max = filters.db_total_funding_max;
    if (filters.db_org_not_locations?.length) baseParams.db_org_not_locations = filters.db_org_not_locations;
  }

  // Tenure at role (all API modes that support it)
  if (filters.api === 'recruiter' || filters.api === 'database') {
    if (filters.tenure_at_role_min != null) baseParams.tenure_at_role_min = filters.tenure_at_role_min;
    if (filters.tenure_at_role_max != null) baseParams.tenure_at_role_max = filters.tenure_at_role_max;
    // Recruiter : l'edge ne lit que la forme array tenure_at_role[{min,max}]
    // (mappée en tenure_in_position) — les clés plates ci-dessus sont ignorées.
    if (filters.api === 'recruiter' && (filters.tenure_at_role_min != null || filters.tenure_at_role_max != null)) {
      const range: Record<string, number> = {};
      if (filters.tenure_at_role_min != null) range.min = filters.tenure_at_role_min;
      if (filters.tenure_at_role_max != null) range.max = filters.tenure_at_role_max;
      baseParams.tenure_at_role = [range];
    }
  }

  // ── Sales Navigator signal filters ──
  if (filters.api === 'sales_navigator') {
    if (filters.changed_jobs === true) baseParams.changed_jobs = true;
    if (filters.posted_on_linkedin === true) baseParams.posted_on_linkedin = true;
    if (filters.following_your_company === true) baseParams.following_your_company = true;
    if (filters.viewed_your_profile === true) baseParams.viewed_your_profile_recently = true;
    if (filters.past_colleague === true) baseParams.past_colleague = true;
    // Sales Nav tenure_at_role (array format) — le schéma n'accepte que des
    // paliers fixes (min ∈ {0,1,3,6,10}, max ∈ {1,2,5,10}) : on arrondit de
    // façon conservatrice (min au palier inférieur, max au palier supérieur)
    // au lieu d'envoyer une valeur libre qui invaliderait toute la requête.
    if (filters.tenure_at_role_min != null || filters.tenure_at_role_max != null) {
      const SN_TENURE_MIN_BUCKETS = [10, 6, 3, 1, 0];
      const SN_TENURE_MAX_BUCKETS = [1, 2, 5, 10];
      const range: Record<string, number> = {};
      if (filters.tenure_at_role_min != null) {
        range.min = SN_TENURE_MIN_BUCKETS.find(b => b <= filters.tenure_at_role_min!) ?? 0;
      }
      if (filters.tenure_at_role_max != null) {
        range.max = SN_TENURE_MAX_BUCKETS.find(b => b >= filters.tenure_at_role_max!) ?? 10;
      }
      baseParams.tenure_at_role = [range];
    }
  }

  // ── Recruiter advanced filters ──
  if (filters.api === 'recruiter') {
    if (filters.employment_type?.length) baseParams.employment_type = filters.employment_type;
    if (filters.spoken_languages?.length) baseParams.spoken_languages = filters.spoken_languages;
    if (filters.recently_joined_min != null || filters.recently_joined_max != null) {
      baseParams.recently_joined = [{
        ...(filters.recently_joined_min != null && { min: filters.recently_joined_min }),
        ...(filters.recently_joined_max != null && { max: filters.recently_joined_max }),
      }];
    }
    if (filters.graduation_year_min != null || filters.graduation_year_max != null) {
      const grad: Record<string, number> = {};
      if (filters.graduation_year_min != null) grad.min = filters.graduation_year_min;
      if (filters.graduation_year_max != null) grad.max = filters.graduation_year_max;
      baseParams.graduation_year = grad;
    }
    if (filters.hide_previously_viewed != null) {
      baseParams.hide_previously_viewed = { timespan: filters.hide_previously_viewed };
    }
  }

  // Past company (all modes)
  if (filters.past_company?.length) {
    baseParams.past_company = { include: filters.past_company.map(f => f.id) };
  }

  // Past job title (Recruiter + Sales Nav)
  if ((filters.api === 'recruiter' || filters.api === 'sales_navigator') && filters.past_job_title?.length) {
    baseParams.past_job_title = filters.past_job_title.map(item => ({
      id: item.id,
      name: item.name,
      priority: item.priority,
    }));
  }

  return baseParams;
}

export function useLinkedInSearchActions(
  context: SearchContext,
  setters: SearchSetters
) {
  const {
    selectedAccount,
    selectedJob,
    filters,
    cursor,
    results,
    activeProject,
    autoHideTreatedRef,
    quota,
    candidateStatus,
    pedigreeAugmentation,
  } = context;

  const {
    setLoading,
    setLoadingMore,
    setResults,
    setCursor,
    setHasMoreResults,
    setTotal,
    setHasSearched,
  } = setters;

  const handleSearch = useCallback(async (appendMode = false, retryCount = 0) => {
    const isDatabase = context.searchSource === 'database';

    if (!isDatabase && !selectedAccount) {
      toast.error('Sélectionnez un compte LinkedIn');
      return;
    }

    if (!selectedJob) {
      toast.error('Sélectionnez un poste pour lancer la recherche');
      return;
    }

    const isStandaloneSearch = activeProject?.kind === 'search';
    if (!selectedJob.title || selectedJob.title.trim().length < 3) {
      toast.error(isStandaloneSearch
        ? 'Renseigne l’intitulé du poste en haut de la page.'
        : 'Complétez au minimum le titre du poste dans le brief.');
      return;
    }
    if (!selectedJob.skills?.length && !selectedJob.mustHave && !selectedJob.description) {
      toast.info(isStandaloneSearch
        ? 'Recherche peu ciblée — décris ta cible via le Prompt IA pour de meilleurs résultats.'
        : 'Brief peu détaillé — les résultats seront génériques. Complétez le brief pour de meilleurs résultats.',
        { duration: 8000 });
    }

    if (!isDatabase && !quota.canPerformAction('searchResultsFetched', RESULTS_PER_BATCH)) {
      toast.error('Quota de recherche journalier atteint. Réessayez demain.');
      return;
    }

    if (appendMode) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

    try {
      const currentFilters = context.filtersRef.current;
      
      // Accumulate profiles across multiple API calls until we reach the target batch size
      let allCollected: LinkedInProfile[] = [];
      let currentCursor = appendMode ? cursor : null;
      let latestTotal: number | null = null;
      let exhausted = false;
      const seen = new Set<string>();
      // Dynamic limit: keep fetching until we have enough or API is exhausted
      // In append mode we allow more rounds since heavy filtering + dedup can yield few new profiles
      const MAX_FETCH_ROUNDS = appendMode ? 15 : 10;

      // Pre-populate seen set with existing results for dedup
      if (appendMode) {
        results.forEach((p) => p?.id && seen.add(p.id));
      }

      for (let round = 0; round < MAX_FETCH_ROUNDS; round++) {
        // Yield to the event loop between rounds to prevent browser freeze
        if (round > 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }

        const baseParams = buildSearchParams(currentFilters, selectedAccount, pedigreeAugmentation || undefined);
        const params: Record<string, unknown> = {
          ...baseParams,
          limit: RESULTS_PER_BATCH,
          ...(currentCursor ? { cursor: currentCursor } : {}),
        };

        if (round === 0) {
          console.log('[LinkedInSearch] Search params:', params);
        }

        // Sourcing double source :
        //  - LinkedIn (Unipile) : recherche live via la session LinkedIn de l'user.
        //  - Base Konekt (Coresignal) : recherche base de données, identité visible,
        //    sans toucher au compte LinkedIn. Cf. docs/coresignal-integration-audit.md
        //    (« Coresignal pour lire, Unipile pour agir »).
        // Pagination Base Konekt : curseur opaque géré côté edge (pagination
        // profonde sans plafond, triée par pertinence). Le front l'échoie tel quel.
        const result = isDatabase
          ? await invokeCoresignal({
              body: {
                action: 'preview',
                filters: currentFilters,
                // Curseur opaque (pagination profonde sans plafond, cf. edge).
                // 1er appel : null → 1re page.
                cursor: currentCursor ?? null,
              },
            })
          : await invokeUnipile({ body: params });
        const data: Record<string, unknown> = result.data || {};

        if (!data?.success) {
          const apiError = new Error(data?.error as string || 'Erreur lors de la recherche');
          (apiError as Error & { errorType?: string; retryable?: boolean }).errorType = data?.errorType as string;
          (apiError as Error & { errorType?: string; retryable?: boolean }).retryable = data?.retryable as boolean;
          throw apiError;
        }

        let batch: LinkedInProfile[] = (data.results as LinkedInProfile[]) || [];
        // Recherche spotlight OPEN_TO_WORK : l'API ne renvoie pas le flag par
        // profil dans les résultats de recherche, mais tous les profils d'une
        // recherche filtrée OTW le sont par construction → on tague pour que
        // le badge s'affiche et que le flag soit persisté dans le pool.
        if (currentFilters.open_to_work === true && currentFilters.api === 'recruiter') {
          batch = batch.map(p => ({ ...p, open_to_work: true }));
        }
        const batchCursor: string | null = (data.cursor as string) || null;
        const fetchedTotal: number | null = (data.total as number) || null;

        if (fetchedTotal !== null) latestTotal = fetchedTotal;
        // Le quota de recherche LinkedIn (anti-ban) ne concerne QUE LinkedIn.
        // La Base Konekt ne touche pas le compte LinkedIn → ne pas décompter,
        // sinon elle épuise le compteur et bloque sa propre pagination.
        if (!isDatabase) quota.recordAction('searchResultsFetched', batch.length);

        // Apply client-side experience filter
        const filteredBatch = filterByCalculatedExperience(
          batch,
          currentFilters.calculated_experience_min,
          currentFilters.calculated_experience_max
        );

        // Apply client-side location filter only for LinkedIn results.
        // Base Konekt already filters location server-side, and local geo keyword
        // matching is too lossy for some labels like "Paris et périphérie".
        const hasRadiusSearch = currentFilters.location_within_area && currentFilters.location_within_area > 0;
        const locationFiltered = currentFilters.location.length > 0 && !hasRadiusSearch && !isDatabase
          ? filterByLocation(filteredBatch, currentFilters.location)
          : filteredBatch;

        // Apply client-side company category filter
        const companyFiltered = currentFilters.company_category
          ? locationFiltered.filter(p => {
              const classification = classifyFromProfile({
                current_company: (p as any).current_company || (p as any).company,
                company_headcount: (p as any).employee_count || (p as any).company_headcount,
                company_industry: (p as any).industry,
                company_type: (p as any).organization_type,
              });
              return classification.type === currentFilters.company_category
                || classification.type === 'other'; // Keep "other" — can't classify = don't exclude
            })
          : locationFiltered;

        // Dedupe
        for (const p of companyFiltered) {
          if (!p?.id) continue;
          if (seen.has(p.id)) continue;
          seen.add(p.id);
          allCollected.push(p);
        }

        // Check if API is exhausted
        if (batch.length === 0 || !batchCursor) {
          exhausted = true;
          currentCursor = null;
          break;
        }

        currentCursor = batchCursor;

        // If we've collected enough, stop
        if (allCollected.length >= RESULTS_PER_BATCH) {
          break;
        }

        // Check quota before next round
        if (!quota.canPerformAction('searchResultsFetched', RESULTS_PER_BATCH)) {
          console.log('[LinkedInSearch] Quota limit reached, stopping auto-fetch');
          break;
        }

        console.log(`[LinkedInSearch] Round ${round + 1}: only ${allCollected.length} after filtering, fetching more...`);
      }

      // Determine if there are more results
      const totalLoaded = appendMode ? results.length + allCollected.length : allCollected.length;
      const reachedTotal = latestTotal !== null && totalLoaded >= latestTotal;
      
      // Persist cursor and total for next "load more" call
      setCursor(currentCursor);
      if (latestTotal !== null) setTotal(latestTotal);

      if (exhausted || reachedTotal) {
        setHasMoreResults(false);
      } else {
        setHasMoreResults(true);
      }

      if (quota.isNearLimit('searchResultsFetched')) {
        toast.warning('Attention: vous approchez de la limite quotidienne de résultats de recherche');
      }

      // Persist newly discovered profiles to DB (non-blocking, won't overwrite existing statuses)
      if (candidateStatus.batchDiscover && allCollected.length > 0) {
        const profilesToDiscover = allCollected.map(p => ({
          id: p.id,
          name: p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || undefined,
          headline: p.headline,
          profileUrl: p.public_profile_url || p.profile_url,
          linkedinProfileData: {
            name: p.name,
            first_name: p.first_name,
            last_name: p.last_name,
            headline: p.headline,
            location: p.location,
            summary: p.summary,
            skills: p.skills,
            work_experience: p.work_experience,
            education: p.education,
            current_positions: p.current_positions,
            past_positions: p.past_positions,
            profile_picture_url: p.profile_picture_url,
            network_distance: p.network_distance,
            connections_count: p.connections_count,
            industry: p.industry,
            open_to_work: p.open_to_work,
            public_profile_url: p.public_profile_url,
            profile_url: p.profile_url,
          },
        }));
        // Fire and forget — don't block the UI
        candidateStatus.batchDiscover(profilesToDiscover).catch(console.error);
      }

      // Yield before pre-scoring to prevent freeze on large batches
      await new Promise(resolve => setTimeout(resolve, 0));

      // Calculate pre-scores in chunks to avoid blocking the main thread
      let scoredBatch: LinkedInProfile[];
      if (selectedJob && allCollected.length > 0) {
        const CHUNK_SIZE = 10;
        const scored: LinkedInProfile[] = [];
        for (let i = 0; i < allCollected.length; i += CHUNK_SIZE) {
          const chunk = allCollected.slice(i, i + CHUNK_SIZE);
          scored.push(...chunk.map(profile => ({
            ...profile,
            _preScore: calculatePreScore(profile, selectedJob, selectedJob.skills || []),
          })));
          // Yield every chunk to keep UI responsive
          if (i + CHUNK_SIZE < allCollected.length) {
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
        scoredBatch = scored;
      } else {
        scoredBatch = allCollected;
      }

      const noMoreResults = exhausted || reachedTotal;

      if (appendMode) {
        if (scoredBatch.length === 0) {
          toast.info('Aucun nouveau profil trouvé. Essayez d\'élargir vos filtres ou de modifier vos mots-clés.', { id: 'no-new-results', duration: 5000 });
        } else if (scoredBatch.length < 5 && noMoreResults) {
          toast.info(`Seulement ${scoredBatch.length} nouveau${scoredBatch.length > 1 ? 'x' : ''} profil${scoredBatch.length > 1 ? 's' : ''} trouvé${scoredBatch.length > 1 ? 's' : ''}. Fin des résultats LinkedIn pour ces filtres.`, { id: 'few-new-results', duration: 5000 });
        }
        setResults(prev => [...prev, ...scoredBatch]);
      } else {
        setResults(scoredBatch);
        setHasSearched(true);
      }

    } catch (error: any) {
      console.error('[LinkedInSearch] Search error:', error);

      const errorMessage = String(error?.message || '');
      const errorType = String(error?.errorType || '').toLowerCase();
      const isMultipleSessionsError =
        errorType.includes('multiple_sessions') ||
        errorMessage.toLowerCase().includes('multiple sessions');
      // « unable to process » est le message GÉNÉRIQUE du provider quand
      // LinkedIn rejette la recherche (payload trop lourd, combinaison de
      // filtres invalide) — rien à voir avec un conflit de session. Il était
      // classé multiple_sessions → toast « Conflit de session » trompeur
      // alors que le compte allait très bien.
      const isUnprocessableSearch = errorMessage.toLowerCase().includes('unable to process');

      // NEVER auto-retry on session conflicts
      if (isMultipleSessionsError) {
        toast.error(
          isStandaloneSearch
            ? 'Conflit de session LinkedIn — votre compte est utilisé ailleurs. Si ça se répète, reconnectez-le avec la méthode cookie (Réglages → Connecteurs) : elle partage la session au lieu d’en créer une deuxième.'
            : 'Conflit de session LinkedIn. Attendez 2-3 minutes, ou si ça se répète, reconnectez votre compte avec la méthode cookie (Réglages → Connecteurs) : elle partage la session au lieu d’en créer une deuxième.',
          {
            id: 'search-error',
            duration: 15000,
            action: {
              label: 'Reconnecter',
              onClick: () => window.location.href = '/settings?tab=connectors',
            },
          }
        );
      } else if (
        errorMessage?.includes("not found") ||
        errorMessage?.includes("404") ||
        errorMessage?.includes("CREDENTIALS") ||
        errorMessage?.includes("disconnected") ||
        errorMessage?.includes("unauthorized")
      ) {
        // 🆕 Opus audit fix : différencier les raisons d'erreur d'auth pour
        // pointer l'user vers la bonne action (avant : message générique
        // "reconnectez votre compte" identique pour tous les cas)
        const lowerErr = errorMessage?.toLowerCase() || '';
        let detail = 'Reconnectez votre compte dans Paramètres > Mon compte.';
        if (lowerErr.includes('captcha')) {
          detail = 'LinkedIn demande une vérification captcha. Allez sur linkedin.com pour la valider, puis revenez.';
        } else if (lowerErr.includes('rate') || lowerErr.includes('429')) {
          detail = 'Trop de requêtes LinkedIn. Patientez 5-10 min avant de relancer.';
        } else if (lowerErr.includes('credentials') || lowerErr.includes('expired')) {
          detail = 'Session LinkedIn expirée. Reconnectez votre compte avec un nouveau cookie li_at.';
        } else if (lowerErr.includes('not found') || lowerErr.includes('404')) {
          detail = 'Compte LinkedIn introuvable. Reconnectez ou recréez le mapping.';
        }

        toast.error(`Compte LinkedIn indisponible — ${detail}`, {
          id: "search-error",
          duration: 15000,
          action: {
            label: "Reconnecter",
            onClick: () => { window.location.href = "/settings?tab=account"; },
          },
        });
      } else if (isUnprocessableSearch) {
        toast.error(
          'LinkedIn n’a pas pu traiter cette recherche — la combinaison de filtres est probablement trop lourde. Retire un critère ou raccourcis les mots-clés, puis relance.',
          { id: 'search-error', duration: 12000 },
        );
      } else if (/unexpected token|not valid json|<!doctype|<html/i.test(errorMessage || '')) {
        // Erreur de parsing brute (réponse HTML du provider) — jamais montrer ça à l'user
        toast.error('Le service LinkedIn a renvoyé une réponse invalide. Réessaie dans quelques instants.', { id: 'search-error' });
      } else {
        toast.error(errorMessage || "Erreur lors de la recherche", { id: "search-error" });
      }
      // Stop infinite scroll from retrying on error
      setHasMoreResults(false);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [selectedAccount, selectedJob, filters, cursor, results, quota, candidateStatus, autoHideTreatedRef, activeProject?.kind, setLoading, setLoadingMore, setResults, setCursor, setHasMoreResults, setTotal, setHasSearched]);

  const handleLoadMore = useCallback(() => {
    if (!cursor) return;
    const isDatabase = context.searchSource === 'database';
    // La Base Konekt n'est pas soumise au quota de recherche LinkedIn (anti-ban) :
    // la 1re page l'ignore déjà (cf. handleSearch), la pagination doit aussi —
    // sinon « Lot suivant » reste sans effet une fois le compteur LinkedIn plein.
    if (isDatabase || context.quota.canPerformAction('searchResultsFetched', RESULTS_PER_BATCH)) {
      handleSearch(true);
    }
  }, [cursor, handleSearch, context.quota, context.searchSource]);

  return {
    handleSearch,
    handleLoadMore,
  };
}
