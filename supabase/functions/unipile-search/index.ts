/**
 * Unipile LinkedIn Search Edge Function
 * Supports: Classic, Sales Navigator, and Recruiter APIs
 * Based on Unipile API Reference: https://developer.unipile.com/docs/linkedin-search
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SearchParams {
  api?: 'classic' | 'recruiter' | 'sales_navigator';
  category?: 'people' | 'companies' | 'jobs' | 'posts';
  keywords?: string;
  limit?: number;
  cursor?: string;
  
  // ID-based filters
  location?: string[];
  company?: { include?: string[]; exclude?: string[] } | string[];
  industry?: { include?: string[] } | string[];
  school?: string[];
  
  // Priority filters (Recruiter)
  job_title?: Array<{ id: string; priority: string }>;
  current_job_title?: Array<{ id: string; priority: string }>;
  skills?: Array<{ id: string; priority: string }>;
  
  // Role filter (Recruiter)
  role?: Array<{ keywords: string; priority: string; scope: string }>;
  
  // Enum filters
  seniority?: string[];
  network_distance?: number[];
  profile_language?: string[];
  
  // Range filters
  years_of_experience?: { min?: number; max?: number };
  tenure?: Array<{ min?: number; max?: number }>;
  
  // Boolean/enum filters
  open_to_work?: boolean;
  open_to?: string[];
  
  // Recruiter specific
  hiring_project?: string;
  talent_pool?: string;
  spotlight?: string;
  
  // Company filters (Sales Navigator)
  company_headcount?: string[];
  company_type?: string[];
  
  // Past filters
  past_company?: { include?: string[] };
  past_job_title?: Array<{ id: string; priority: string }>;
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
    company,
    industry,
    school,
    job_title,
    skills,
    role,
    seniority,
    network_distance,
    profile_language,
    years_of_experience,
    tenure,
    open_to_work,
    open_to,
    hiring_project,
    talent_pool,
    spotlight,
    company_headcount,
    company_type,
    past_company,
    past_job_title,
  } = params;

  // Build request body based on API type
  const searchBody: Record<string, unknown> = {
    api: api.toLowerCase(),
    category,
    limit,
  };

  // Pagination cursor
  if (cursor) searchBody.cursor = cursor;

  // Keywords (all APIs)
  if (keywords) searchBody.keywords = keywords;

  // Location (all APIs) - array of IDs
  if (location?.length) searchBody.location = location;

  // Company filter - supports include/exclude structure
  if (company) {
    if (Array.isArray(company)) {
      if (company.length > 0) {
        searchBody.company = { include: company };
      }
    } else if (company.include?.length || company.exclude?.length) {
      searchBody.company = company;
    }
  }

  // Industry - with include structure for Recruiter/SalesNav
  if (industry) {
    if (Array.isArray(industry)) {
      if (industry.length > 0) {
        searchBody.industry = { include: industry };
      }
    } else if (industry.include?.length) {
      searchBody.industry = industry;
    }
  }

  // School (all APIs)
  if (school?.length) searchBody.school = school;

  // Job title - different handling per API
  if (job_title?.length) {
    if (api === 'recruiter') {
      // Recruiter uses current_job_title with priority
      searchBody.current_job_title = job_title.map(t => ({
        id: t.id,
        priority: t.priority,
      }));
    } else if (api === 'sales_navigator') {
      // Sales Navigator also supports priority
      searchBody.current_job_title = job_title.map(t => ({
        id: t.id,
        priority: t.priority,
      }));
    } else {
      // Classic - just IDs
      searchBody.job_title = job_title.map(t => t.id);
    }
  }

  // Skills with priority (Recruiter/SalesNav)
  if (skills?.length) {
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

  // Seniority (all APIs)
  if (seniority?.length) searchBody.seniority = seniority;

  // Network distance (all APIs)
  if (network_distance?.length) searchBody.network_distance = network_distance;

  // Profile language
  if (profile_language?.length) searchBody.profile_language = profile_language;

  // Years of experience
  if (years_of_experience && (years_of_experience.min !== undefined || years_of_experience.max !== undefined)) {
    searchBody.years_of_experience = years_of_experience;
  }

  // Tenure at company/role (Sales Navigator/Recruiter)
  if (tenure?.length) {
    searchBody.tenure = tenure;
  }

  // Open to work
  if (open_to_work === true) {
    searchBody.open_to = open_to?.length ? open_to : ['all'];
  } else if (open_to?.length) {
    searchBody.open_to = open_to;
  }

  // Recruiter specific filters
  if (api === 'recruiter') {
    if (hiring_project) searchBody.hiring_project = hiring_project;
    if (talent_pool) searchBody.talent_pool = talent_pool;
    if (spotlight) searchBody.spotlight = spotlight;
  }

  // Company headcount (Sales Navigator)
  if (company_headcount?.length && api === 'sales_navigator') {
    searchBody.company_headcount = company_headcount;
  }

  // Company type
  if (company_type?.length) {
    searchBody.company_type = company_type;
  }

  // Past company
  if (past_company) {
    if (Array.isArray(past_company)) {
      if (past_company.length > 0) {
        searchBody.past_company = { include: past_company };
      }
    } else if (past_company.include?.length) {
      searchBody.past_company = past_company;
    }
  }

  // Past job title
  if (past_job_title?.length) {
    searchBody.past_job_title = past_job_title.map(t => ({
      id: t.id,
      priority: t.priority,
    }));
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
    console.error('Search error:', data);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: data.detail || data.message || 'Erreur de recherche',
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
