/**
 * Unipile LinkedIn Search Edge Function
 * Supports: Classic, Sales Navigator, and Recruiter APIs
 * Based on Unipile API Reference: https://developer.unipile.com/docs/linkedin-search
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Timeout wrapper for all external fetch calls (Unipile, Anthropic, Notion)
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

interface SearchParams {
  api?: 'classic' | 'recruiter' | 'sales_navigator';
  category?: 'people' | 'companies' | 'jobs' | 'posts';
  keywords?: string;
  limit?: number;
  cursor?: string;
  
  // ID-based filters
  location?: string[];
  location_within_area?: number; // Search radius in miles (Recruiter only)
  company?: { include?: string[]; exclude?: string[] } | string[];
  company_keywords?: Array<{ keywords: string; priority: string; scope: string }>; // Keywords-based (Recruiter only)
  industry?: { include?: string[]; exclude?: string[] } | string[];
  school?: string[] | Array<{ id: string; priority: string }>;
  
  // Priority filters (Recruiter/Sales Nav)
  job_title?: Array<{ id: string; priority: string }>;
  skills?: Array<{ id: string; priority: string }>;
  
  // Role filter (Recruiter)
  role?: Array<{ keywords: string; priority: string; scope: string }>;
  
  // Function/Department filter (Recruiter/Sales Nav)
  function?: { include?: string[]; exclude?: string[] } | string[];
  
  // Enum filters
  seniority?: string[];
  network_distance?: number[];
  profile_language?: string[];
  
  // Range filters
  years_of_experience?: { min?: number; max?: number };
  tenure?: Array<{ min?: number; max?: number }>;
  tenure_at_company?: Array<{ min?: number; max?: number }>;
  tenure_at_role?: Array<{ min?: number; max?: number }>;
  
  // Boolean/enum filters
  open_to_work?: boolean;
  open_to?: string[];
  
  // Recruiter specific
  hiring_project?: string;
  talent_pool?: string;
  // Unipile schema: `spotlights` is an array of strings (LinkedIn native filter)
  spotlights?: string[];
  // Backward compat (older frontend used singular)
  spotlight?: string;
  
  // Recruiting activity filter (Recruiter)
  recruiting_activity?: Array<{
    id: 'messages' | 'tags' | 'notes' | 'projects' | 'resumes' | 'reviews';
    priority: 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE';
    timespan?: number; // Days since today
  }>;
  
  // Degree filter (Recruiter) - { include: string[], exclude: string[] }
  degree?: { include?: string[]; exclude?: string[] };
  
  // Company filters (Sales Navigator)
  company_headcount?: Array<{ min?: number; max?: number }> | string[];
  company_type?: string[];
  company_location?: { include?: string[]; exclude?: string[] };
  
  // Groups (Sales Navigator)
  groups?: string[];
  
  // Past filters
  past_company?: { include?: string[]; exclude?: string[] } | string[];
  past_job_title?: Array<{ id: string; priority: string }>;
  
  // Advanced keywords (Classic)
  advanced_keywords?: {
    first_name?: string;
    last_name?: string;
    title?: string;
    company?: string;
    school?: string;
  };
  
  // Saved/Recent searches (Sales Navigator)
  saved_search_id?: string;
  recent_search_id?: string;
}

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';

/**
 * Resolve Unipile credentials: try org-specific first, then fall back to env vars.
 */
async function resolveUnipileCredentials(organizationId?: string): Promise<{ apiKey: string; dsn: string } | null> {
  // Try org-specific credentials
  if (organizationId) {
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const sb = createClient(supabaseUrl, serviceKey);
      
      const { data } = await sb
        .from('organization_integrations')
        .select('unipile_api_key, unipile_dsn, unipile_connected')
        .eq('organization_id', organizationId)
        .single();
      
      if (data?.unipile_connected && data?.unipile_api_key && data?.unipile_dsn) {
        const rawDsn = data.unipile_dsn;
        const dsn = rawDsn.startsWith('http') ? rawDsn.replace(/^https?:\/\//, '') : rawDsn;
        console.log(`[unipile-search] Using org-specific credentials for org ${organizationId}`);
        return { apiKey: data.unipile_api_key, dsn };
      }
    } catch (e) {
      console.warn('[unipile-search] Failed to resolve org credentials:', e);
    }
  }
  
  // Unipile is a platform-level integration (one account shared by all orgs).
  // Fall back to env vars for orgs that haven't configured org-specific credentials.
  const envApiKey = Deno.env.get('UNIPILE_API_KEY');
  const envDsn = Deno.env.get('UNIPILE_DSN');
  if (envApiKey && envDsn) {
    const dsn = envDsn.startsWith('http') ? envDsn.replace(/^https?:\/\//, '') : envDsn;
    console.log(`[unipile-search] Using platform env var credentials (org ${organizationId} has no org-specific config)`);
    return { apiKey: envApiKey, dsn };
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth: validate JWT and org membership ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { action, account_id, organization_id, ...params } = await req.json();

    if (organization_id) {
      const sb = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data: membership } = await sb.from('organization_members').select('id').eq('user_id', user.id).eq('organization_id', organization_id).maybeSingle();
      if (!membership) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // --- Rate limiting: 60 requests per minute per user (skip for service_role) ---
    {
      const sbService = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data: allowed } = await sbService.rpc('check_rate_limit', {
        p_user_id: user.id,
        p_action: 'unipile_search',
        p_max_requests: 60,
        p_window_seconds: 60,
      });
      if (allowed === false) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Rate limit exceeded',
          errorType: 'RATE_LIMIT',
          retryAfter: 60,
        }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const credentials = await resolveUnipileCredentials(organization_id);
    if (!credentials) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unipile not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { apiKey, dsn } = credentials;

    if (!account_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Account ID requis' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const baseUrl = `https://${dsn}/api/v1`;

    switch (action) {
      case 'search': {
        return await handleSearch(baseUrl, apiKey, account_id, params);
      }

      case 'get_parameters': {
        return await handleGetParameters(baseUrl, apiKey, account_id, params);
      }

      case 'get_profile': {
        return await handleGetProfile(baseUrl, apiKey, account_id, params);
      }

      case 'get_chats': {
        return await handleGetChats(baseUrl, apiKey, account_id, params);
      }

      case 'get_messages': {
        return await handleGetMessages(baseUrl, apiKey, account_id, params);
      }

      case 'send_message': {
        return await handleSendMessage(baseUrl, apiKey, account_id, params);
      }

      case 'mark_as_read': {
        return await handleMarkAsRead(baseUrl, apiKey, params);
      }

      case 'get_user_posts': {
        return await handleGetUserPosts(baseUrl, apiKey, account_id, params);
      }

      case 'endorse_skill': {
        return await handleEndorseSkill(baseUrl, apiKey, account_id, params);
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: 'Action non reconnue' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Erreur interne' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Handle LinkedIn Search
 * Supports all three APIs: classic, recruiter, sales_navigator
 */
async function handleSearch(
  baseUrl: string,
  apiKey: string,
  accountId: string,
  params: SearchParams
): Promise<Response> {
  const {
    api = 'recruiter',
    category = 'people',
    keywords,
    limit = 25,
    cursor,
    location,
    location_within_area,
    company,
    company_keywords,
    industry,
    school,
    job_title,
    skills,
    role,
    function: functionFilter,
    seniority,
    network_distance,
    profile_language,
    years_of_experience,
    tenure,
    tenure_at_company,
    tenure_at_role,
    open_to_work,
    open_to,
    hiring_project,
    talent_pool,
    spotlights,
    spotlight,
    degree,
    company_headcount,
    company_type,
    company_location,
    groups,
    past_company,
    past_job_title,
    advanced_keywords,
    saved_search_id,
    recent_search_id,
  } = params;

  // Build request body based on API type
  const searchBody: Record<string, unknown> = {
    api: api.toLowerCase(),
    category,
    limit,
  };

  // Normalise seniority values per API type.
  // Each API has different valid enum values:
  // - Classic Jobs: intern | entry | associate | mid_senior | director | executive
  // - Recruiter People: owner | partner | cxo | vp | director | manager | senior | entry | training | unpaid
  // - Sales Navigator People: owner/partner | cxo | vice_president | director | experienced_manager | entry_level_manager | strategic | senior | entry_level | in_training
  const normaliseSeniority = (value: string, apiType: string): string | null => {
    const v = String(value).trim().toLowerCase();
    if (!v) return null;

    if (apiType === 'recruiter') {
      // Recruiter valid: owner, partner, cxo, vp, director, manager, senior, entry, training, unpaid
      const RECRUITER_MAP: Record<string, string> = {
        owner: 'owner', partner: 'partner', cxo: 'cxo', vp: 'vp',
        director: 'director', directeur: 'director', manager: 'manager',
        senior: 'senior', entry: 'entry', junior: 'entry', training: 'training',
        intern: 'training', unpaid: 'unpaid',
        'c-level': 'cxo', executive: 'cxo', 'mid-senior': 'senior', mid_senior: 'senior',
        'mid senior': 'senior', mid: 'senior', associate: 'entry',
        débutant: 'entry', debutant: 'entry',
      };
      return RECRUITER_MAP[v] || null;
    }

    if (apiType === 'sales_navigator') {
      // Sales Nav valid: owner/partner, cxo, vice_president, director, experienced_manager, entry_level_manager, strategic, senior, entry_level, in_training
      const SN_MAP: Record<string, string> = {
        'owner/partner': 'owner/partner', owner: 'owner/partner', partner: 'owner/partner',
        cxo: 'cxo', 'c-level': 'cxo', executive: 'cxo',
        vp: 'vice_president', vice_president: 'vice_president',
        director: 'director', directeur: 'director',
        manager: 'experienced_manager', experienced_manager: 'experienced_manager',
        entry_level_manager: 'entry_level_manager',
        strategic: 'strategic', senior: 'senior', 'mid-senior': 'senior', mid_senior: 'senior', mid: 'senior',
        entry: 'entry_level', entry_level: 'entry_level', junior: 'entry_level',
        associate: 'entry_level', débutant: 'entry_level', debutant: 'entry_level',
        intern: 'in_training', in_training: 'in_training', training: 'in_training',
      };
      return SN_MAP[v] || null;
    }

    // Classic Jobs: intern | entry | associate | mid_senior | director | executive
    const CLASSIC_MAP: Record<string, string> = {
      intern: 'intern', entry: 'entry', junior: 'entry', débutant: 'entry', debutant: 'entry',
      associate: 'associate',
      mid: 'mid_senior', senior: 'mid_senior', 'mid-senior': 'mid_senior', mid_senior: 'mid_senior', 'mid senior': 'mid_senior',
      manager: 'director', director: 'director', directeur: 'director',
      vp: 'executive', cxo: 'executive', 'c-level': 'executive', executive: 'executive', partner: 'executive', owner: 'executive',
    };
    return CLASSIC_MAP[v] || null;
  };

  // Pagination cursor
  if (cursor) searchBody.cursor = cursor;

  // Saved/Recent search IDs (Sales Navigator) - overrides other filters
  if (api === 'sales_navigator') {
    if (saved_search_id) {
      searchBody.saved_search_id = saved_search_id;
    }
    if (recent_search_id) {
      searchBody.recent_search_id = recent_search_id;
    }
  }

  // Keywords (all APIs) - truncate if too long to avoid content_too_large errors
  if (keywords) {
    // LinkedIn Classic API has strict payload limits; cap keywords to ~200 chars
    if (keywords.length > 200) {
      // Try to keep complete boolean groups by trimming the last AND group
      let truncated = keywords;
      while (truncated.length > 200) {
        const lastAnd = truncated.lastIndexOf(' AND ');
        if (lastAnd > 0) {
          truncated = truncated.substring(0, lastAnd);
        } else {
          // No more AND groups, just hard truncate
          truncated = truncated.substring(0, 200);
          break;
        }
      }
      console.log(`[search] Keywords truncated: ${keywords.length} → ${truncated.length} chars`);
      searchBody.keywords = truncated;
    } else {
      searchBody.keywords = keywords;
    }
  }

  // Advanced keywords (Classic only)
  if (api === 'classic' && advanced_keywords) {
    const advKw: Record<string, string> = {};
    if (advanced_keywords.first_name) advKw.first_name = advanced_keywords.first_name;
    if (advanced_keywords.last_name) advKw.last_name = advanced_keywords.last_name;
    if (advanced_keywords.title) advKw.title = advanced_keywords.title;
    if (advanced_keywords.company) advKw.company = advanced_keywords.company;
    if (advanced_keywords.school) advKw.school = advanced_keywords.school;
    if (Object.keys(advKw).length > 0) {
      searchBody.advanced_keywords = advKw;
    }
  }

  // Location - different format per API:
  // - Classic: "location" as simple array of IDs
  // - Recruiter: "location" as array of objects with id, priority, scope (sent from frontend)
  // - Sales Navigator: "location" with { include: [...], exclude: [...] }
  if (location?.length) {
    if (api === 'recruiter') {
      // Recruiter expects array of objects: { id, priority, scope }
      // Frontend sends objects with id, priority, scope - or strings for backward compat
      searchBody.location = location.map((loc: string | { id: string; priority?: string; scope?: string }) => {
        if (typeof loc === 'object' && loc.id) {
          return {
            id: loc.id,
            priority: loc.priority || 'MUST_HAVE',
            scope: loc.scope || 'CURRENT_OR_OPEN_TO_RELOCATE'
          };
        }
        // Fallback for string IDs
        return {
          id: loc as string,
          priority: 'MUST_HAVE',
          scope: 'CURRENT_OR_OPEN_TO_RELOCATE'
        };
      });
    } else if (api === 'sales_navigator') {
      // Sales Navigator expects include array of IDs
      const locationIds = location.map((loc: string | { id: string }) => 
        typeof loc === 'object' ? loc.id : loc
      );
      searchBody.location = { include: locationIds };
    } else {
      // Classic uses simple array of IDs
      const locationIds = location.map((loc: string | { id: string }) => 
        typeof loc === 'object' ? loc.id : loc
      );
      searchBody.location = locationIds;
    }
  }

  // Location within area (radius in miles) - Recruiter only
  if (api === 'recruiter' && location_within_area !== undefined && location_within_area !== null) {
    searchBody.location_within_area = location_within_area;
  }

  // Company filter - different format per API:
  // - Classic: simple array of string IDs
  // - Recruiter: array of objects [{ id, name?, priority?, scope? }] or [{ keywords, priority?, scope? }]
  // - Sales Navigator: { include: string[], exclude?: string[] }
  if (company) {
    if (Array.isArray(company)) {
      if (company.length > 0) {
        if (api === 'recruiter') {
          // Recruiter expects array of objects with id, priority, scope
          searchBody.company = company.map((c: string | { id?: string; keywords?: string; priority?: string; scope?: string }) => {
            if (typeof c === 'object') return c;
            return { id: c, priority: 'MUST_HAVE', scope: 'CURRENT_OR_PAST' };
          });
        } else if (api === 'sales_navigator') {
          searchBody.company = { include: company };
        } else {
          searchBody.company = company;
        }
      }
    } else if (company.include?.length || company.exclude?.length) {
      if (api === 'recruiter') {
        // Recruiter doesn't use { include, exclude } - convert to array of objects
        const items = [
          ...(company.include || []).map((id: string) => ({ id, priority: 'MUST_HAVE', scope: 'CURRENT_OR_PAST' })),
          ...(company.exclude || []).map((id: string) => ({ id, priority: 'DOESNT_HAVE', scope: 'CURRENT_OR_PAST' })),
        ];
        if (items.length > 0) searchBody.company = items;
      } else {
        searchBody.company = company;
      }
    }
  }

  // Company keywords filter (Recruiter only) - keywords-based with priority and scope
  if (api === 'recruiter' && company_keywords?.length) {
    // If we already have ID-based company filter, we need to merge or prioritize
    // According to the API doc, company can be an array of objects with keywords, priority, scope
    // So we can add keyword-based companies to the company array
    const keywordCompanies = company_keywords.map(c => ({
      keywords: c.keywords,
      priority: c.priority,
      scope: c.scope,
    }));
    
    // If company is already set as an object with include, we need to handle this differently
    // The API allows mixing ID-based and keyword-based in the company array
    if (searchBody.company && typeof searchBody.company === 'object' && 'include' in searchBody.company) {
      // According to API docs, company for recruiter can be an array mixing ID objects and keyword objects
      // Transform to array format: [{ id: "..." }, { keywords: "...", priority: "...", scope: "..." }]
      const idCompanies = ((searchBody.company as { include?: string[] }).include || []).map(id => ({ id }));
      searchBody.company = [...idCompanies, ...keywordCompanies];
    } else {
      searchBody.company = keywordCompanies;
    }
  }

  // Industry - with include structure for Recruiter/SalesNav
  if (industry) {
    const needsInclude = api === 'recruiter' || api === 'sales_navigator';
    if (Array.isArray(industry)) {
      if (industry.length > 0) {
        searchBody.industry = needsInclude ? { include: industry } : industry;
      }
    } else if (industry.include?.length || industry.exclude?.length) {
      searchBody.industry = industry;
    }
  }

  // School - different format per API:
  // - Classic: simple array of IDs
  // - Sales Navigator: { include: [...], exclude: [...] }
  // - Recruiter: array of objects with id and priority
  if (school?.length) {
    if (api === 'classic') {
      searchBody.school = school;
    } else if (api === 'sales_navigator') {
      // Check if it's already formatted with priority
      if (typeof school[0] === 'object' && 'id' in school[0]) {
        searchBody.school = { include: (school as Array<{ id: string }>).map(s => s.id) };
      } else {
        searchBody.school = { include: school };
      }
    } else if (api === 'recruiter') {
      // Recruiter uses priority format: [{ id: "123", priority: "MUST_HAVE" }]
      if (typeof school[0] === 'object' && 'id' in school[0]) {
        searchBody.school = school;
      } else {
        searchBody.school = (school as string[]).map((id: string) => ({
          id,
          priority: 'MUST_HAVE',
        }));
      }
    }
  }

  // Job title - different handling per API
  // - Recruiter: uses `role` with array of objects { id, is_selection, priority?, scope? } or { keywords, priority?, scope? }
  // - Sales Navigator: uses `role` with { include: [...], exclude: [...] }
  // - Classic: no direct job_title filter
  if (job_title?.length) {
    if (api === 'recruiter') {
      // Recruiter uses `role` (not current_job_title)
      searchBody.role = job_title.map((t: { id?: string; keywords?: string; priority?: string; scope?: string; is_selection?: boolean }) => {
        if (t.keywords) {
          return { keywords: t.keywords, priority: t.priority || 'MUST_HAVE', scope: t.scope || 'CURRENT_OR_PAST' };
        }
        return {
          id: t.id,
          is_selection: t.is_selection ?? false,
          priority: t.priority || 'MUST_HAVE',
          scope: t.scope || 'CURRENT_OR_PAST',
        };
      });
    } else if (api === 'sales_navigator') {
      // Sales Navigator uses `role` with { include, exclude }
      const includeIds = job_title.filter(t => t.priority !== 'DOESNT_HAVE').map(t => t.id);
      const excludeIds = job_title.filter(t => t.priority === 'DOESNT_HAVE').map(t => t.id);
      const roleObj: Record<string, string[]> = {};
      if (includeIds.length) roleObj.include = includeIds;
      if (excludeIds.length) roleObj.exclude = excludeIds;
      if (Object.keys(roleObj).length) searchBody.role = roleObj;
    }
  }

  // Skills with priority (Recruiter only - not supported in Sales Navigator)
  // Supports both id-based ({ id, priority }) and keywords-based ({ keywords, priority })
  if (skills?.length && api === 'recruiter') {
    searchBody.skills = skills.map((s: Record<string, unknown>) => {
      if (s.keywords) {
        return { keywords: s.keywords, priority: s.priority };
      }
      return { id: s.id, priority: s.priority };
    });
  }

  // Role filter - Recruiter specific with keywords, priority, scope
  // Note: if job_title already set `role`, append keyword-based roles
  if (role?.length && api === 'recruiter') {
    const keywordRoles = role.map(r => ({
      keywords: r.keywords,
      priority: r.priority || 'MUST_HAVE',
      scope: r.scope || 'CURRENT_OR_PAST',
    }));
    // Merge with ID-based roles from job_title if any
    if (Array.isArray(searchBody.role)) {
      (searchBody.role as unknown[]).push(...keywordRoles);
    } else {
      searchBody.role = keywordRoles;
    }
  }

  // Function/Department filter
  // - Recruiter: simple array of string IDs
  // - Sales Navigator: { include: [...], exclude: [...] }
  if (functionFilter) {
    if (api === 'recruiter') {
      // Recruiter: function is a simple string[] of department IDs
      if (Array.isArray(functionFilter)) {
        if (functionFilter.length > 0) searchBody.function = functionFilter;
      } else if (functionFilter.include?.length) {
        searchBody.function = functionFilter.include;
      }
    } else if (api === 'sales_navigator') {
      // Sales Navigator: function is { include: [...], exclude: [...] }
      if (Array.isArray(functionFilter)) {
        if (functionFilter.length > 0) searchBody.function = { include: functionFilter };
      } else if (functionFilter.include?.length || functionFilter.exclude?.length) {
        searchBody.function = functionFilter;
      }
    }
  }

  // Degree filter (Recruiter) - Doc: { include: string[], exclude: string[] }
  if (degree && api === 'recruiter') {
    const hasInclude = degree.include?.length;
    const hasExclude = degree.exclude?.length;
    if (hasInclude || hasExclude) {
      searchBody.degree = {
        ...(hasInclude && { include: degree.include }),
        ...(hasExclude && { exclude: degree.exclude }),
      };
    }
  }

  // Seniority - different format per API:
  // - Classic Jobs: simple array of strings
  // - Recruiter People: { include: [...], exclude: [...] } with recruiter-specific enums
  // - Sales Navigator People: { include: [...], exclude: [...] } with SN-specific enums
  if (seniority?.length) {
    const normalised = seniority.map(s => normaliseSeniority(s, api)).filter((v): v is string => Boolean(v));
    console.log('Seniority received:', seniority, '→ normalised:', normalised, 'API:', api, 'category:', category);
    if (normalised.length) {
      if (category === 'jobs') {
        // Classic Jobs: simple array
        searchBody.seniority = normalised;
      } else if (api === 'recruiter' || api === 'sales_navigator') {
        // People searches: { include: [...] }
        searchBody.seniority = { include: normalised };
      }
    }
  }

  // Network distance (all APIs)
  if (network_distance?.length) {
    searchBody.network_distance = network_distance;
  }

  // Profile language
  if (profile_language?.length) {
    searchBody.profile_language = profile_language;
  }

  // Years of experience / Tenure - different per API
  // - Recruiter: `tenure` as { min, max } object
  // - Sales Navigator: `tenure` as array of { min, max } ranges
  if (api === 'recruiter') {
    // Recruiter uses `tenure` as a single object { min, max }
    // Frontend may send as years_of_experience or tenure
    const tenureSource = years_of_experience || (tenure?.length ? tenure[0] : null);
    if (tenureSource && (tenureSource.min !== undefined || tenureSource.max !== undefined)) {
      searchBody.tenure = tenureSource;
    }
  } else if (api === 'sales_navigator') {
    // Sales Navigator uses tenure as array of { min, max } ranges
    if (tenure?.length) {
      searchBody.tenure = tenure;
    } else if (years_of_experience && (years_of_experience.min !== undefined || years_of_experience.max !== undefined)) {
      // Fallback: convert single object to array
      searchBody.tenure = [years_of_experience];
    }
  }

  // Tenure at company - different per API:
  // - Recruiter: `tenure_in_company` as { min, max } object
  // - Sales Navigator: `tenure_at_company` as array of { min, max }
  if (tenure_at_company?.length) {
    if (api === 'recruiter') {
      searchBody.tenure_in_company = tenure_at_company[0]; // single object
    } else if (api === 'sales_navigator') {
      searchBody.tenure_at_company = tenure_at_company;
    }
  }

  // Tenure at role - different per API:
  // - Recruiter: `tenure_in_position` as { min, max } object
  // - Sales Navigator: `tenure_at_role` as array of { min, max }
  if (tenure_at_role?.length) {
    if (api === 'recruiter') {
      searchBody.tenure_in_position = tenure_at_role[0]; // single object
    } else if (api === 'sales_navigator') {
      searchBody.tenure_at_role = tenure_at_role;
    }
  }

  // Open to work / Open to
  if (api === 'classic') {
    // Classic only supports proBono, boardMember
    if (open_to?.length) {
      searchBody.open_to = open_to;
    }
  } else if (api === 'recruiter') {
    // Unipile Recruiter API supports spotlights with these valid values:
    // OPEN_TO_WORK, ACTIVE_TALENT, REDISCOVERED_CANDIDATES, INTERNAL_CANDIDATES,
    // INTERESTED_IN_YOUR_COMPANY, HAVE_COMPANY_CONNECTIONS
    const VALID_RECRUITER_SPOTLIGHTS = new Set([
      'OPEN_TO_WORK', 'ACTIVE_TALENT', 'REDISCOVERED_CANDIDATES',
      'INTERNAL_CANDIDATES', 'INTERESTED_IN_YOUR_COMPANY', 'HAVE_COMPANY_CONNECTIONS',
    ]);

    const mergedSpotlights = Array.from(
      new Set(
        [
          ...(Array.isArray(spotlights) ? spotlights : []),
          ...(spotlight ? [spotlight] : []),
          ...(open_to_work === true ? ['OPEN_TO_WORK'] : []),
        ].filter(Boolean)
      )
    ).filter(s => VALID_RECRUITER_SPOTLIGHTS.has(s as string)) as string[];

    if (mergedSpotlights.length) {
      searchBody.spotlights = mergedSpotlights;
      console.log('[Search] Applied spotlights:', mergedSpotlights);
    }

    if (open_to?.length) {
      searchBody.open_to = open_to;
    }
  }

  // Recruiter specific filters
  if (api === 'recruiter') {
    if (hiring_project) searchBody.hiring_projects = { include: [hiring_project] };
    if (talent_pool) searchBody.talent_pool = talent_pool;
    // NOTE: spotlights are handled above (merged from open_to_work + spotlight + spotlights)
    
    // Recruiting activity (messages, notes, tags, etc.)
    if (params.recruiting_activity?.length) {
      searchBody.recruiting_activity = params.recruiting_activity.map(activity => {
        const item: Record<string, unknown> = {
          id: activity.id,
          priority: activity.priority,
        };
        if (activity.timespan !== undefined && activity.timespan !== null) {
          item.timespan = activity.timespan;
        }
        return item;
      });
    }
  }

  // Company headcount - supported by both Recruiter and Sales Navigator
  // Both use array of { min, max } objects
  if (company_headcount?.length) {
    if (api === 'sales_navigator' || api === 'recruiter') {
      const headcountMap: Record<string, { min: number; max?: number }> = {
        'A': { min: 1, max: 1 },
        'B': { min: 1, max: 10 },
        'C': { min: 11, max: 50 },
        'D': { min: 51, max: 200 },
        'E': { min: 201, max: 500 },
        'F': { min: 501, max: 1000 },
        'G': { min: 1001, max: 5000 },
        'H': { min: 5001, max: 10000 },
        'I': { min: 10001 },
      };
      
      if (typeof company_headcount[0] === 'string') {
        const ranges = company_headcount
          .map(h => headcountMap[h as string])
          .filter(Boolean);
        if (ranges.length > 0) {
          searchBody.company_headcount = ranges;
        }
      } else {
        searchBody.company_headcount = company_headcount;
      }
    }
  }

  // Company type (Sales Navigator)
  if (company_type?.length && api === 'sales_navigator') {
    // Map our values to API format
    const typeMap: Record<string, string> = {
      'C': 'public_company',
      'O': 'privately_held',
      'E': 'non_profit',
      'S': 'educational_institution',
      'P': 'partnership',
      'G': 'self_employed',
      'D': 'government_agency',
    };
    
    const mappedTypes = company_type.map(t => typeMap[t] || t);
    searchBody.company_type = mappedTypes;
  }

  // Company location (Sales Navigator)
  if (company_location && api === 'sales_navigator') {
    if (company_location.include?.length || company_location.exclude?.length) {
      searchBody.company_location = company_location;
    }
  }

  // Groups (Sales Navigator + Recruiter)
  if (groups?.length && (api === 'sales_navigator' || api === 'recruiter')) {
    searchBody.groups = groups;
  }

  // Past company
  // Past company - different per API:
  // - Classic: simple array of string IDs
  // - Recruiter: array of objects [{ id, priority }]
  // - Sales Navigator: { include: [...], exclude: [...] }
  if (past_company) {
    if (Array.isArray(past_company)) {
      if (past_company.length > 0) {
        if (api === 'recruiter') {
          searchBody.past_company = past_company.map((c: string | { id: string; priority?: string }) => {
            if (typeof c === 'object') return c;
            return { id: c, priority: 'MUST_HAVE' };
          });
        } else if (api === 'sales_navigator') {
          searchBody.past_company = { include: past_company };
        } else {
          searchBody.past_company = past_company;
        }
      }
    } else if (past_company.include?.length || past_company.exclude?.length) {
      if (api === 'recruiter') {
        // Convert include/exclude to array of objects
        const items = [
          ...(past_company.include || []).map((id: string) => ({ id, priority: 'MUST_HAVE' })),
          ...(past_company.exclude || []).map((id: string) => ({ id, priority: 'DOESNT_HAVE' })),
        ];
        if (items.length > 0) searchBody.past_company = items;
      } else {
        searchBody.past_company = past_company;
      }
    }
  }

  // Past job title - different per API:
  // - Recruiter: merged into `role` with scope: 'PAST' (not a separate param)
  // - Sales Navigator: `past_role` with { include: [...], exclude: [...] }
  if (past_job_title?.length) {
    if (api === 'recruiter') {
      // Recruiter doesn't have a separate past_job_title. Past titles go into `role` with scope: 'PAST'
      const pastRoles = past_job_title.map(t => ({
        id: t.id,
        is_selection: false,
        priority: t.priority || 'MUST_HAVE',
        scope: 'PAST',
      }));
      if (Array.isArray(searchBody.role)) {
        (searchBody.role as unknown[]).push(...pastRoles);
      } else {
        searchBody.role = pastRoles;
      }
    } else if (api === 'sales_navigator') {
      // Sales Navigator uses `past_role` with { include, exclude }
      const includeIds = past_job_title.filter(t => t.priority !== 'DOESNT_HAVE').map(t => t.id);
      const excludeIds = past_job_title.filter(t => t.priority === 'DOESNT_HAVE').map(t => t.id);
      const pastRoleObj: Record<string, string[]> = {};
      if (includeIds.length) pastRoleObj.include = includeIds;
      if (excludeIds.length) pastRoleObj.exclude = excludeIds;
      if (Object.keys(pastRoleObj).length) searchBody.past_role = pastRoleObj;
    }
  }

  const searchUrl = `${baseUrl}/linkedin/search?account_id=${accountId}`;
  console.log('Search URL:', searchUrl);
  console.log('Search body:', JSON.stringify(searchBody));

  // Retry logic for multiple_sessions errors (server-side)
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [0, 6000, 15000]; // ms: immediate, 6s, 15s
  let response: globalThis.Response | null = null;
  let data: Record<string, unknown> = {};

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(`[search] Retry attempt ${attempt + 1}/${MAX_RETRIES} after multiple_sessions error, waiting ${RETRY_DELAYS[attempt]}ms`);
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
    }

    response = await fetchWithTimeout(searchUrl, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(searchBody),
    });

    data = await response.json();

    // If success or non-retryable error, break
    if (response.ok) break;
    
    const isMultipleSessions = data.type?.toString().includes('multiple_sessions') || 
      data.detail?.toString().includes('multiple sessions') ||
      data.message?.toString().includes('multiple sessions');
    
    if (!isMultipleSessions) break; // non-retryable error
    
    console.log(`[search] multiple_sessions error on attempt ${attempt + 1}`);
  }

  if (!response!.ok) {
    console.error('Search error:', JSON.stringify(data, null, 2));
    console.error('Request body was:', JSON.stringify(searchBody, null, 2));
    
    // Handle content_too_large (400) - payload rejected by LinkedIn
    if (response!.status === 400 && data.type?.toString().includes('content_too_large')) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'La requête est trop volumineuse. Essayez de réduire les mots-clés ou les filtres.',
          errorType: 'CONTENT_TOO_LARGE',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Handle rate limiting (429) and server errors (500)
    if (response!.status === 429 || response!.status === 500) {
      const isRateLimit = response!.status === 429 || 
        (data.detail && String(data.detail).toLowerCase().includes('limit')) ||
        (data.detail && String(data.detail).toLowerCase().includes('quota'));
      
      if (isRateLimit) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Limite LinkedIn atteinte. Espacez vos requêtes et réessayez plus tard.',
            errorType: 'RATE_LIMIT',
            retryAfter: 60,
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }
    
    // Try to extract more useful error info
    let errorMessage = 'Erreur de recherche';
    if (data.detail) {
      const detailMatch = String(data.detail).match(/^([^\n{]+)/);
      errorMessage = detailMatch ? detailMatch[1].trim() : String(data.detail).substring(0, 200);
    } else if (data.message) {
      errorMessage = String(data.message);
    }
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage,
        errorType: data.type,
        debug: { status: response!.status, body: searchBody }
      }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      results: data.items || [],
      cursor: data.cursor,
      total: data.paging?.total_count || data.total,
      config: data.config,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Handle Get Parameters (autocomplete for filters)
 * Used to get IDs for location, company, job_title, skills, etc.
 */
async function handleGetParameters(
  baseUrl: string,
  apiKey: string,
  accountId: string,
  params: Record<string, unknown>
): Promise<Response> {
  const { type, keywords, service = 'RECRUITER', limit = 100 } = params;

  if (!type) {
    return new Response(
      JSON.stringify({ success: false, error: 'Type de paramètre requis' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Service must be uppercase for this endpoint
  const serviceType = String(service).toUpperCase();
  
  const queryParams = new URLSearchParams();
  queryParams.set('account_id', accountId);
  queryParams.set('type', String(type));
  queryParams.set('service', serviceType);
  queryParams.set('limit', String(limit));
  
  if (keywords) {
    queryParams.set('keywords', String(keywords));
  }

  const url = `${baseUrl}/linkedin/search/parameters?${queryParams.toString()}`;
  console.log('Get parameters URL:', url);

  const response = await fetchWithTimeout(url, {
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
    },
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Parameters error:', data);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: data.detail || data.message || 'Erreur de récupération',
        items: [] 
      }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Map API response to consistent format
  const items = (data.items || []).map((item: { id: string; title: string }) => ({
    id: item.id,
    title: item.title,
  }));

  return new Response(
    JSON.stringify({ success: true, items }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Handle Get Profile details
 */
async function handleGetProfile(
  baseUrl: string,
  apiKey: string,
  accountId: string,
  params: Record<string, unknown>
): Promise<Response> {
  let { profile_id, profile_url } = params as { profile_id?: string; profile_url?: string };

  // If profile_url is provided but not profile_id, extract the slug from the URL
  if (!profile_id && profile_url) {
    const slug = String(profile_url).replace(/\/+$/, '').split('/').pop();
    if (slug) {
      profile_id = slug;
    }
  }

  if (!profile_id) {
    return new Response(
      JSON.stringify({ success: false, error: 'Profile ID requis' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const response = await fetchWithTimeout(`${baseUrl}/users/${profile_id}?account_id=${accountId}`, {
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
    },
  });

  const data = await response.json();

  if (!response.ok) {
    return new Response(
      JSON.stringify({ success: false, error: data.message || 'Profil non trouvé' }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Normalize profile data to match search result format
  const normalized = normalizeProfileData(data);

  return new Response(
    JSON.stringify({ success: true, profile: normalized }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Handle Get Chats - List conversations for an account
 * If attendee_provider_id is provided, use the dedicated endpoint to find chats for that specific attendee
 * Otherwise list all chats for the account
 * 
 * API Docs: 
 * - List all chats: GET /chats?account_id={account_id}
 * - List chats by attendee: GET /chat_attendees/{attendee_id}/chats?account_id={account_id}
 * - Get chat details with attendees: GET /chats/{chat_id}
 */
async function handleGetChats(
  baseUrl: string,
  apiKey: string,
  accountId: string,
  params: Record<string, unknown>
): Promise<Response> {
  const { attendee_provider_id, limit = 100, cursor, folder, cursors } = params;

  // If we have an attendee_provider_id, use the dedicated endpoint
  if (attendee_provider_id) {
    const queryParams = new URLSearchParams();
    queryParams.set('account_id', accountId);
    queryParams.set('limit', String(Math.min(Number(limit), 250)));
    if (cursor) queryParams.set('cursor', String(cursor));
    
    const url = `${baseUrl}/chat_attendees/${encodeURIComponent(String(attendee_provider_id))}/chats?${queryParams.toString()}`;
    console.log('Get chats by attendee URL:', url);
    
    const response = await fetchWithTimeout(url, {
      headers: { 'X-API-KEY': apiKey, 'Accept': 'application/json' },
    });
    
    const data = await response.json();
    if (!response.ok) {
      console.warn('Chats attendee lookup failed (status', response.status, '):', data.detail || data.message);
      // Return 200 with success:false so the frontend gracefully shows "no conversation"
      return new Response(
        JSON.stringify({ success: false, error: data.detail || data.message || 'Erreur', chats: [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Return directly for attendee-based queries (simpler case)
    const attendeeChats = data.items || [];
    console.log('Chats fetched by attendee:', attendeeChats.length);
    
    // Quick enrichment for attendee-based query
    const enrichedAttendeeChats = attendeeChats.map((chat: Record<string, unknown>) => ({
      ...chat,
      attendees: chat.attendees || [],
    }));
    
    return new Response(
      JSON.stringify({ success: true, chats: enrichedAttendeeChats, cursor: data.cursor }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // For inbox: fetch LinkedIn Classic, Recruiter, AND generic INBOX folders in parallel
  // Support per-folder cursors for proper pagination across merged folders
  const folderNames = ['INBOX_LINKEDIN_CLASSIC', 'INBOX_LINKEDIN_RECRUITER', 'INBOX'];
  
  // Parse per-folder cursors: { INBOX_LINKEDIN_CLASSIC: "xxx", INBOX_LINKEDIN_RECRUITER: null, INBOX: "yyy" }
  // A cursor value of null means that folder is exhausted. undefined means first fetch.
  const folderCursors = (cursors as Record<string, string | null> | undefined) || {};
  
  console.log('Fetching chats from folders:', folderNames, '| Account:', accountId, '| Cursors:', JSON.stringify(folderCursors));
  
  const fetchFromFolder = async (folderName: string): Promise<{ items: Record<string, unknown>[]; cursor: string | null }> => {
    // If cursor is explicitly null (not undefined), this folder is exhausted
    if (folderCursors[folderName] === null && Object.prototype.hasOwnProperty.call(folderCursors, folderName)) {
      console.log(`Folder ${folderName}: exhausted (cursor=null), skipping`);
      return { items: [], cursor: null };
    }
    
    const folderCursor = folderCursors[folderName]; // undefined on first fetch, string on subsequent
    
    const queryParams = new URLSearchParams();
    queryParams.set('account_id', accountId);
    queryParams.set('limit', String(Math.min(Number(limit), 125)));
    queryParams.set('folder', folderName);
    if (folderCursor) queryParams.set('cursor', String(folderCursor));
    
    const url = `${baseUrl}/chats?${queryParams.toString()}`;
    console.log(`Fetching folder ${folderName}:`, url);
    
    try {
      const response = await fetchWithTimeout(url, {
        headers: { 'X-API-KEY': apiKey, 'Accept': 'application/json' },
      });
      
      const data = await response.json();
      if (!response.ok) {
        console.error(`Error fetching ${folderName}:`, data);
        return { items: [], cursor: null };
      }
      
      const items = data.items || [];
      console.log(`Folder ${folderName}: ${items.length} chats, cursor: ${data.cursor || 'null'}`);
      return { items, cursor: data.cursor || null };
    } catch (error) {
      console.error(`Exception fetching ${folderName}:`, error);
      return { items: [], cursor: null };
    }
  };
  
  // Fetch all folders in parallel
  const [classicResult, recruiterResult, genericResult] = await Promise.all([
    fetchFromFolder('INBOX_LINKEDIN_CLASSIC'),
    fetchFromFolder('INBOX_LINKEDIN_RECRUITER'),
    fetchFromFolder('INBOX'),
  ]);
  
  // Build next cursors object
  const nextCursors: Record<string, string | null> = {
    INBOX_LINKEDIN_CLASSIC: classicResult.cursor,
    INBOX_LINKEDIN_RECRUITER: recruiterResult.cursor,
    INBOX: genericResult.cursor,
  };
  
  // hasMore = at least one folder still has a cursor
  const hasMore = Object.values(nextCursors).some(c => c !== null);
  
  // Merge and dedupe by chat ID, then sort by timestamp (most recent first)
  const chatMap = new Map<string, Record<string, unknown>>();
  
  [...classicResult.items, ...recruiterResult.items, ...genericResult.items].forEach((chat: Record<string, unknown>) => {
    const chatId = chat.id as string;
    if (!chatMap.has(chatId)) {
      chatMap.set(chatId, chat);
    }
  });
  
  const chats = Array.from(chatMap.values()).sort((a, b) => {
    const timeA = new Date(a.timestamp as string).getTime();
    const timeB = new Date(b.timestamp as string).getTime();
    return timeB - timeA; // Most recent first
  });
  
  console.log(`Total merged chats: ${chats.length} (Classic: ${classicResult.items.length}, Recruiter: ${recruiterResult.items.length}, Generic: ${genericResult.items.length})`);

  // Log folder distribution for debugging
  const folderCounts: Record<string, number> = {};
  chats.forEach((chat: Record<string, unknown>) => {
    const folders = (chat.folder as string[]) || [];
    folders.forEach((f: string) => {
      folderCounts[f] = (folderCounts[f] || 0) + 1;
    });
  });
  console.log('Chats fetched:', chats.length, '| Folder distribution:', JSON.stringify(folderCounts));
  
  // Cache for attendee info to avoid duplicate fetches
  const attendeeCache = new Map<string, Record<string, unknown>>();
  
  // Enrich chats with attendee details (name/picture) for ALL returned chats.
  // The list endpoint returns attendee_provider_id but not the full attendee info,
  // so we fetch /chat_attendees/{id} (cached by attendee_provider_id).
  // NOTE: We do this in small batches to avoid flooding the upstream API.
  // Helper: fetch last message for a chat to determine is_sender
  const fetchLastMessage = async (chatId: string): Promise<{ is_sender: boolean; text?: string; timestamp?: string } | null> => {
    try {
      const msgUrl = `${baseUrl}/chats/${encodeURIComponent(chatId)}/messages?limit=1`;
      const msgResponse = await fetchWithTimeout(msgUrl, {
        headers: { 'X-API-KEY': apiKey, 'Accept': 'application/json' },
      });
      if (msgResponse.ok) {
        const msgData = await msgResponse.json();
        const items = msgData.items || msgData || [];
        const lastMsg = Array.isArray(items) ? items[0] : null;
        if (lastMsg) {
          return {
            is_sender: !!lastMsg.is_sender,
            text: lastMsg.text || lastMsg.text_content || '',
            timestamp: lastMsg.timestamp,
          };
        }
      }
    } catch (e) {
      console.error('Error fetching last message for chat', chatId, e);
    }
    return null;
  };

  const enrichChat = async (chat: Record<string, unknown>) => {
    try {
      // Parallel: fetch attendee info + last message
      const attendeeProviderId = chat.attendee_provider_id as string | undefined;
      const providedAttendees = (chat.attendees as Record<string, unknown>[] | undefined) || [];
      
      const promises: Promise<unknown>[] = [];
      
      // Attendee fetch (if needed)
      // Fetch attendee info if we don't have attendees, or if existing attendees lack an `id` field
      let needsAttendeeFetch = attendeeProviderId && !attendeeCache.has(attendeeProviderId) && 
        (providedAttendees.length === 0 || (providedAttendees.length > 0 && !providedAttendees[0].id));
      if (needsAttendeeFetch) {
        promises.push(
          fetchWithTimeout(`${baseUrl}/chat_attendees/${encodeURIComponent(attendeeProviderId!)}`, {
            headers: { 'X-API-KEY': apiKey, 'Accept': 'application/json' },
          }).then(r => r.ok ? r.json() : null).catch(() => null)
        );
      } else {
        promises.push(Promise.resolve(null));
      }
      
      // Last message fetch
      promises.push(fetchLastMessage(chat.id as string));
      
      const [attendeeResult, lastMsgResult] = await Promise.all(promises) as [Record<string, unknown> | null, { is_sender: boolean; text?: string; timestamp?: string } | null];
      
      // Build attendees — ensure each attendee has its `id` field
      let attendees = providedAttendees;
      if (attendees.length === 0 && attendeeProviderId) {
        if (attendeeCache.has(attendeeProviderId)) {
          attendees = [attendeeCache.get(attendeeProviderId)!];
        } else if (attendeeResult) {
          attendeeCache.set(attendeeProviderId, attendeeResult);
          attendees = [attendeeResult];
        }
      }
      // If attendees were already provided but don't have an `id` field,
      // and we fetched attendee data, merge in the id
      if (attendees.length > 0 && !attendees[0].id && attendeeResult?.id) {
        attendees = [{ ...attendees[0], id: attendeeResult.id }];
      }
      // If we still don't have attendee id but have attendee_provider_id, set it as id fallback
      if (attendees.length > 0 && !attendees[0].id && attendeeProviderId) {
        // Try to get from cache
        const cached = attendeeCache.get(attendeeProviderId);
        if (cached?.id) {
          attendees = [{ ...attendees[0], id: cached.id }];
        }
      }
      
      // Build last_message info
      const existingLastMessage = (chat.last_message as Record<string, unknown>) || {};
      const enrichedLastMessage = lastMsgResult
        ? { ...existingLastMessage, is_sender: lastMsgResult.is_sender, text: lastMsgResult.text, timestamp: lastMsgResult.timestamp }
        : existingLastMessage;
      
      return {
        ...chat,
        attendees,
        last_message: enrichedLastMessage,
      };
    } catch (error) {
      console.error('Error enriching chat:', chat.id, error);
      return chat;
    }
  };

  const enrichedChats: Record<string, unknown>[] = [];
  const BATCH_SIZE = 10;
  for (let i = 0; i < chats.length; i += BATCH_SIZE) {
    const batch = chats.slice(i, i + BATCH_SIZE);
    const enrichedBatch = await Promise.all(batch.map(enrichChat));
    enrichedChats.push(...enrichedBatch);
  }

  return new Response(
    JSON.stringify({ 
      success: true, 
      chats: enrichedChats,
      cursors: nextCursors,
      cursor: hasMore ? '__has_more__' : null,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Handle Get Messages - Get message history from a specific chat
 */
async function handleGetMessages(
  baseUrl: string,
  apiKey: string,
  accountId: string,
  params: Record<string, unknown>
): Promise<Response> {
  const { chat_id, limit = 50, cursor } = params;

  if (!chat_id) {
    return new Response(
      JSON.stringify({ success: false, error: 'Chat ID requis' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const queryParams = new URLSearchParams();
  if (cursor) {
    queryParams.set('cursor', String(cursor));
  }
  queryParams.set('limit', String(limit));

  const url = `${baseUrl}/chats/${chat_id}/messages?${queryParams.toString()}`;
  console.log('Get messages URL:', url);

  const response = await fetchWithTimeout(url, {
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
    },
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Messages error:', data);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: data.detail || data.message || 'Erreur de récupération des messages',
        messages: [] 
      }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ 
      success: true, 
      messages: data.items || [],
      cursor: data.cursor,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Send message to a LinkedIn user
 * Supports both direct messages (for 1st degree) and InMails (for 2nd/3rd degree)
 * Uses multipart/form-data format required by Unipile
 */
async function handleSendMessage(
  baseUrl: string,
  apiKey: string,
  accountId: string,
  params: Record<string, unknown>
): Promise<Response> {
  const { chat_id, recipient_id, text, message, subject, is_inmail } = params;
  const messageText = (text || message) as string;

  // Need either chat_id (existing conversation) or recipient_id (new message)
  if (!chat_id && !recipient_id) {
    return new Response(
      JSON.stringify({ success: false, error: 'Chat ID ou Recipient ID requis' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (!messageText || typeof messageText !== 'string' || messageText.trim().length === 0) {
    return new Response(
      JSON.stringify({ success: false, error: 'Message vide' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Build multipart form data
  const formData = new FormData();
  formData.append('text', messageText.trim());

  let url: string;

  if (chat_id) {
    // Send to existing chat
    url = `${baseUrl}/chats/${chat_id}/messages`;
  } else {
    // Create new chat/message to recipient
    // For InMails (2nd/3rd degree), we need to use the LinkedIn Recruiter API format
    url = `${baseUrl}/chats`;
    formData.append('account_id', accountId);
    formData.append('attendees_ids', recipient_id as string);
    
    // Add LinkedIn-specific options for InMail
    if (is_inmail) {
      formData.append('linkedin[api]', 'recruiter');
      formData.append('linkedin[inmail]', 'true');
      if (subject) {
        formData.append('subject', subject as string);
      }
    }
  }

  console.log('Send message URL:', url, 'is_inmail:', is_inmail);

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
    },
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Send message error:', data);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: data.detail || data.message || "Erreur lors de l'envoi du message",
        code: data.status_code || response.status,
      }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  console.log('Message sent successfully:', data);

  return new Response(
    JSON.stringify({ 
      success: true, 
      message: data,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Mark a chat as read via Unipile PATCH /chats/{chat_id}
 * API Docs: https://developer.unipile.com/reference/chatscontroller_patchchat
 */
async function handleMarkAsRead(
  baseUrl: string,
  apiKey: string,
  params: Record<string, unknown>
): Promise<Response> {
  const { chat_id } = params;

  if (!chat_id) {
    return new Response(
      JSON.stringify({ success: false, error: 'Chat ID requis' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const url = `${baseUrl}/chats/${chat_id}`;
    console.log('Mark as read URL:', url);

    const response = await fetchWithTimeout(url, {
      method: 'PATCH',
      headers: {
        'X-API-KEY': apiKey,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'setReadStatus',
        value: true,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      console.error('Mark as read error:', data);
      return new Response(
        JSON.stringify({ success: false, error: data.detail || data.message || 'Erreur' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Chat marked as read:', chat_id);
    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Mark as read exception:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Erreur' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle fetching user posts
 */
async function handleGetUserPosts(
  baseUrl: string,
  apiKey: string,
  accountId: string,
  params: any
): Promise<Response> {
  try {
    const { identifier, limit = 5 } = params;
    if (!identifier) {
      return new Response(
        JSON.stringify({ success: false, error: 'identifier requis' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const url = `${baseUrl}/users/${encodeURIComponent(identifier)}/posts?account_id=${accountId}&limit=${limit}`;
    console.log('Fetching user posts:', url);

    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'X-API-KEY': apiKey,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      console.error('Posts fetch error:', data);
      return new Response(
        JSON.stringify({ success: false, error: data.detail || data.message || 'Erreur récupération posts' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    return new Response(
      JSON.stringify({ success: true, items: data.items || [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Get user posts exception:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Erreur' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Parse a Unipile date value (string like "2019-01" or "2019") into {year, month} object.
 * Profile API returns strings, Search API returns objects — this normalizes both.
 */
function parseDateValue(value: unknown): { year?: number; month?: number } | null {
  if (!value) return null;
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if (obj.year) return { year: Number(obj.year), month: obj.month ? Number(obj.month) : undefined };
    return null;
  }
  if (typeof value === 'string') {
    const parts = value.split('-');
    const year = parseInt(parts[0], 10);
    if (isNaN(year) || year < 1900) return null;
    const month = parts[1] ? parseInt(parts[1], 10) : undefined;
    return { year, month: month && !isNaN(month) ? month : undefined };
  }
  return null;
}

/**
 * Normalize a Unipile profile response (from /users/{id}) to match our frontend interface.
 * Key differences from search results:
 * - work_experience uses "position" instead of "role"
 * - work_experience.skills is string[] instead of {name, endorsement_count}[]
 * - dates are strings instead of {year, month} objects
 * - boolean flags use "is_" prefix (is_open_to_work, is_premium, is_open_profile)
 * - network_distance uses FIRST_DEGREE format instead of DISTANCE_1
 */
function normalizeProfileData(raw: Record<string, unknown>): Record<string, unknown> {
  const result = { ...raw };

  // Normalize boolean flags: is_open_to_work → open_to_work, etc.
  if (raw.is_open_to_work !== undefined && raw.open_to_work === undefined) {
    result.open_to_work = raw.is_open_to_work;
  }
  if (raw.is_premium !== undefined && raw.premium === undefined) {
    result.premium = raw.is_premium;
  }
  if (raw.is_open_profile !== undefined && raw.open_profile === undefined) {
    result.open_profile = raw.is_open_profile;
  }

  // Normalize network_distance: FIRST_DEGREE → DISTANCE_1
  if (typeof raw.network_distance === 'string') {
    const distMap: Record<string, string> = {
      'FIRST_DEGREE': 'DISTANCE_1',
      'SECOND_DEGREE': 'DISTANCE_2',
      'THIRD_DEGREE': 'DISTANCE_3',
    };
    result.network_distance = distMap[raw.network_distance as string] || raw.network_distance;
  }

  // Normalize work_experience
  if (Array.isArray(raw.work_experience)) {
    result.work_experience = (raw.work_experience as Record<string, unknown>[]).map(exp => {
      const normalized: Record<string, unknown> = { ...exp };
      
      // position → role
      if (exp.position && !exp.role) {
        normalized.role = exp.position;
      }
      
      // skills: string[] → {name, endorsement_count}[]
      if (Array.isArray(exp.skills)) {
        normalized.skills = (exp.skills as unknown[]).map(s => 
          typeof s === 'string' ? { name: s, endorsement_count: 0 } : s
        );
      }

      // Normalize dates: string → {year, month}
      normalized.start = parseDateValue(exp.start);
      normalized.end = parseDateValue(exp.end);

      // current boolean → infer from end being null
      if (exp.current === true && normalized.end) {
        // keep end if explicitly set
      }

      return normalized;
    });
  }

  // Normalize education dates
  if (Array.isArray(raw.education)) {
    result.education = (raw.education as Record<string, unknown>[]).map(edu => ({
      ...edu,
      start: parseDateValue(edu.start),
      end: parseDateValue(edu.end),
    }));
  }

  // Normalize volunteering_experience dates
  if (Array.isArray(raw.volunteering_experience)) {
    result.volunteering_experience = (raw.volunteering_experience as Record<string, unknown>[]).map(vol => ({
      ...vol,
      start: parseDateValue(vol.start),
      end: parseDateValue(vol.end),
    }));
  }

  // Normalize projects dates
  if (Array.isArray(raw.projects)) {
    result.projects = (raw.projects as Record<string, unknown>[]).map(proj => ({
      ...proj,
      start: parseDateValue(proj.start),
      end: parseDateValue(proj.end),
    }));
  }

  // Ensure contact_info is preserved
  // provider_id -> keep for reference

  return result;
}

/**
 * Handle LinkedIn Skill Endorsement
 * Uses POST /api/v1/linkedin/profile/endorse
 */
async function handleEndorseSkill(
  baseUrl: string,
  apiKey: string,
  accountId: string,
  params: Record<string, unknown>
): Promise<Response> {
  const { profile_id, skill_endorsement_id } = params;

  if (!profile_id || !skill_endorsement_id) {
    return new Response(
      JSON.stringify({ success: false, error: 'profile_id et skill_endorsement_id requis' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const response = await fetchWithTimeout(`${baseUrl}/linkedin/profile/endorse`, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      account_id: accountId,
      profile_id: String(profile_id),
      skill_endorsement_id: Number(skill_endorsement_id),
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error('[endorse_skill] Error:', response.status, data);
    return new Response(
      JSON.stringify({ success: false, error: data?.message || data?.error || `Erreur ${response.status}` }),
      { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ success: true, ...data }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
