/**
 * Unipile LinkedIn Search Edge Function
 * Supports: Classic, Sales Navigator, and Recruiter APIs
 * Based on Unipile API Reference: https://developer.unipile.com/docs/linkedin-search
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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
  current_job_title?: Array<{ id: string; priority: string }>;
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
  spotlight?: string;
  
  // Recruiting activity filter (Recruiter)
  recruiting_activity?: Array<{
    id: 'messages' | 'tags' | 'notes' | 'projects' | 'resumes' | 'reviews';
    priority: 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE';
    timespan?: number; // Days since today
  }>;
  
  // Degree filter (Recruiter)
  degree?: Array<{ id: string; priority: string }>;
  
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('UNIPILE_API_KEY');
    const dsn = Deno.env.get('UNIPILE_DSN');

    if (!apiKey || !dsn) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unipile not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { action, account_id, ...params } = await req.json();

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

  // Keywords (all APIs)
  if (keywords) searchBody.keywords = keywords;

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

  // Company filter - uses include/exclude structure for recruiter/sales_nav
  if (company) {
    if (Array.isArray(company)) {
      if (company.length > 0) {
        const needsInclude = api === 'recruiter' || api === 'sales_navigator';
        searchBody.company = needsInclude ? { include: company } : company;
      }
    } else if (company.include?.length || company.exclude?.length) {
      searchBody.company = company;
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
  if (job_title?.length) {
    if (api === 'recruiter') {
      // Recruiter uses current_job_title with priority
      searchBody.current_job_title = job_title.map(t => ({
        id: t.id,
        priority: t.priority,
      }));
    } else if (api === 'sales_navigator') {
      // Sales Navigator uses current_job_title with include/exclude structure
      searchBody.current_job_title = job_title.map(t => ({
        id: t.id,
        priority: t.priority,
      }));
    } else {
      // Classic - just IDs via advanced_keywords.title or keywords
      // Classic doesn't have job_title filter, use keywords instead
    }
  }

  // Skills with priority (Recruiter only - not supported in Sales Navigator)
  if (skills?.length && api === 'recruiter') {
    searchBody.skills = skills.map(s => ({
      id: s.id,
      priority: s.priority,
    }));
  }

  // Role filter - Recruiter specific with keywords, priority, scope
  if (role?.length && api === 'recruiter') {
    searchBody.role = role.map(r => ({
      keywords: r.keywords,
      priority: r.priority,
      scope: r.scope,
    }));
  }

  // Function/Department filter (Recruiter/Sales Navigator)
  if (functionFilter) {
    if (api === 'recruiter' || api === 'sales_navigator') {
      if (Array.isArray(functionFilter)) {
        if (functionFilter.length > 0) {
          searchBody.function = { include: functionFilter };
        }
      } else if (functionFilter.include?.length || functionFilter.exclude?.length) {
        searchBody.function = functionFilter;
      }
    }
  }

  // Degree filter (Recruiter) - array of objects with id and priority
  if (degree?.length && api === 'recruiter') {
    searchBody.degree = degree.map(d => ({
      id: d.id,
      priority: d.priority,
    }));
  }

  // Seniority (all APIs but different values)
  if (seniority?.length) {
    searchBody.seniority = seniority;
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
  if (api === 'recruiter') {
    // Recruiter uses years_of_experience as object
    if (years_of_experience && (years_of_experience.min !== undefined || years_of_experience.max !== undefined)) {
      searchBody.years_of_experience = years_of_experience;
    }
  } else if (api === 'sales_navigator') {
    // Sales Navigator uses tenure array of ranges
    if (tenure?.length) {
      searchBody.tenure = tenure;
    }
  }

  // Tenure at company (Sales Navigator/Recruiter)
  if (tenure_at_company?.length) {
    searchBody.tenure_at_company = tenure_at_company;
  }

  // Tenure at role (Recruiter)
  if (tenure_at_role?.length && api === 'recruiter') {
    searchBody.tenure_at_role = tenure_at_role;
  }

  // Open to work / Open to
  if (api === 'classic') {
    // Classic only supports proBono, boardMember
    if (open_to?.length) {
      searchBody.open_to = open_to;
    }
  } else if (api === 'recruiter') {
    // Recruiter has open_to_work boolean and spotlight for OPEN_TO_WORK
    if (open_to_work === true) {
      // Use spotlight instead
      if (!spotlight) {
        searchBody.spotlight = 'OPEN_TO_WORK';
      }
    }
    if (open_to?.length) {
      searchBody.open_to = open_to;
    }
  }

  // Recruiter specific filters
  if (api === 'recruiter') {
    if (hiring_project) searchBody.hiring_project = hiring_project;
    if (talent_pool) searchBody.talent_pool = talent_pool;
    if (spotlight) searchBody.spotlight = spotlight;
    
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

  // Company headcount - different format per API
  if (company_headcount?.length) {
    if (api === 'sales_navigator') {
      // Sales Navigator uses array of ranges: [{ min: 1, max: 10 }, { min: 11, max: 50 }]
      // Convert our string values to ranges
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

  // Groups (Sales Navigator)
  if (groups?.length && api === 'sales_navigator') {
    searchBody.groups = groups;
  }

  // Past company
  if (past_company) {
    if (Array.isArray(past_company)) {
      if (past_company.length > 0) {
        const needsInclude = api === 'recruiter' || api === 'sales_navigator';
        searchBody.past_company = needsInclude ? { include: past_company } : past_company;
      }
    } else if (past_company.include?.length || past_company.exclude?.length) {
      searchBody.past_company = past_company;
    }
  }

  // Past job title (Recruiter/Sales Navigator)
  if (past_job_title?.length) {
    if (api === 'recruiter' || api === 'sales_navigator') {
      searchBody.past_job_title = past_job_title.map(t => ({
        id: t.id,
        priority: t.priority,
      }));
    }
  }

  const searchUrl = `${baseUrl}/linkedin/search?account_id=${accountId}`;
  console.log('Search URL:', searchUrl);
  console.log('Search body:', JSON.stringify(searchBody));

  const response = await fetch(searchUrl, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(searchBody),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Search error:', JSON.stringify(data, null, 2));
    console.error('Request body was:', JSON.stringify(searchBody, null, 2));
    
    // Try to extract more useful error info
    let errorMessage = 'Erreur de recherche';
    if (data.detail) {
      // Extract just the main error message, not the full schema
      const detailMatch = data.detail.match(/^([^\n{]+)/);
      errorMessage = detailMatch ? detailMatch[1].trim() : data.detail.substring(0, 200);
    } else if (data.message) {
      errorMessage = data.message;
    }
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage,
        errorType: data.type,
        debug: { status: response.status, body: searchBody }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

  const response = await fetch(url, {
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
    },
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Parameters error:', data);
    // Return 200 with success: false to avoid throwing on client
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: data.detail || data.message || 'Erreur de récupération',
        items: [] 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
  const { profile_id } = params;

  if (!profile_id) {
    return new Response(
      JSON.stringify({ success: false, error: 'Profile ID requis' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const response = await fetch(`${baseUrl}/users/${profile_id}?account_id=${accountId}`, {
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
    },
  });

  const data = await response.json();

  if (!response.ok) {
    return new Response(
      JSON.stringify({ success: false, error: data.message || 'Profil non trouvé' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ success: true, profile: data }),
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
 */
async function handleGetChats(
  baseUrl: string,
  apiKey: string,
  accountId: string,
  params: Record<string, unknown>
): Promise<Response> {
  const { attendee_provider_id, limit = 50, cursor } = params;

  const queryParams = new URLSearchParams();
  queryParams.set('account_id', accountId);
  queryParams.set('limit', String(limit));
  
  if (cursor) {
    queryParams.set('cursor', String(cursor));
  }

  // If we have an attendee_provider_id, use the dedicated endpoint
  // This is more efficient than listing all chats and filtering client-side
  let url: string;
  if (attendee_provider_id) {
    url = `${baseUrl}/chat_attendees/${encodeURIComponent(String(attendee_provider_id))}/chats?${queryParams.toString()}`;
    console.log('Get chats by attendee URL:', url);
  } else {
    url = `${baseUrl}/chats?${queryParams.toString()}`;
    console.log('Get all chats URL:', url);
  }

  const response = await fetch(url, {
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
    },
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Chats error:', data);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: data.detail || data.message || 'Erreur de récupération des conversations',
        chats: [] 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ 
      success: true, 
      chats: data.items || [],
      cursor: data.cursor,
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

  const response = await fetch(url, {
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
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
 * Handle Send Message - Send a message to an existing chat
 * API: POST /chats/{chat_id}/messages
 * Uses multipart/form-data with 'text' field
 */
async function handleSendMessage(
  baseUrl: string,
  apiKey: string,
  accountId: string,
  params: Record<string, unknown>
): Promise<Response> {
  const { chat_id, text } = params;

  if (!chat_id) {
    return new Response(
      JSON.stringify({ success: false, error: 'Chat ID requis' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return new Response(
      JSON.stringify({ success: false, error: 'Message vide' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Build multipart form data
  const formData = new FormData();
  formData.append('text', text.trim());

  const url = `${baseUrl}/chats/${chat_id}/messages`;
  console.log('Send message URL:', url);

  const response = await fetch(url, {
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
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
