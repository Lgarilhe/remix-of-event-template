const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
        // Search LinkedIn profiles
        const {
          keywords,
          service = 'RECRUITER', // CLASSIC, RECRUITER, SALES_NAVIGATOR
          limit = 25,
          cursor,
          // Common filters
          location,
          company,
          industry,
          job_title,
          school,
          seniority,
          // Recruiter specific filters
          hiring_project,
          talent_pool,
          spotlight,
          years_of_experience_min,
          years_of_experience_max,
          open_to_work,
          // Additional filters
          current_company,
          past_company,
          language,
          skills,
        } = params;

        // Build query params
        const queryParams = new URLSearchParams();
        queryParams.set('account_id', account_id);
        queryParams.set('api', service);
        if (limit) queryParams.set('limit', limit.toString());
        if (cursor) queryParams.set('cursor', cursor);
        if (keywords) queryParams.set('keywords', keywords);
        
        // Location filters
        if (location?.length > 0) {
          location.forEach((loc: string) => queryParams.append('location', loc));
        }
        
        // Company filters
        if (company?.length > 0) {
          company.forEach((c: string) => queryParams.append('current_company', c));
        }
        if (current_company?.length > 0) {
          current_company.forEach((c: string) => queryParams.append('current_company', c));
        }
        if (past_company?.length > 0) {
          past_company.forEach((c: string) => queryParams.append('past_company', c));
        }
        
        // Industry filter
        if (industry?.length > 0) {
          industry.forEach((i: string) => queryParams.append('industry', i));
        }
        
        // Job title filter
        if (job_title?.length > 0) {
          job_title.forEach((jt: string) => queryParams.append('job_title', jt));
        }
        
        // School filter
        if (school?.length > 0) {
          school.forEach((s: string) => queryParams.append('school', s));
        }
        
        // Seniority filter
        if (seniority?.length > 0) {
          seniority.forEach((s: string) => queryParams.append('seniority', s));
        }
        
        // Skills filter
        if (skills?.length > 0) {
          skills.forEach((s: string) => queryParams.append('skill', s));
        }
        
        // Language filter
        if (language?.length > 0) {
          language.forEach((l: string) => queryParams.append('language', l));
        }
        
        // Recruiter specific filters
        if (hiring_project) queryParams.set('hiring_project', hiring_project);
        if (talent_pool) queryParams.set('talent_pool', talent_pool);
        if (spotlight) queryParams.set('spotlight', spotlight);
        if (years_of_experience_min) queryParams.set('years_of_experience_min', years_of_experience_min.toString());
        if (years_of_experience_max) queryParams.set('years_of_experience_max', years_of_experience_max.toString());
        if (open_to_work !== undefined) queryParams.set('open_to_work', open_to_work ? 'true' : 'false');

        console.log('Search URL:', `${baseUrl}/linkedin/search?${queryParams.toString()}`);

        const response = await fetch(`${baseUrl}/linkedin/search?${queryParams.toString()}`, {
          headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
          },
        });

        const data = await response.json();

        if (!response.ok) {
          console.error('Search error:', data);
          return new Response(
            JSON.stringify({ success: false, error: data.message || 'Erreur de recherche' }),
            { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ 
            success: true, 
            results: data.items || [],
            cursor: data.cursor,
            total: data.total,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_parameters': {
        // Get search parameter IDs (LinkedIn requires IDs not text)
        const { type, keywords, service = 'RECRUITER' } = params;

        if (!type) {
          return new Response(
            JSON.stringify({ success: false, error: 'Type de paramètre requis' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const queryParams = new URLSearchParams();
        queryParams.set('account_id', account_id);
        queryParams.set('type', type);
        queryParams.set('service', service);
        queryParams.set('limit', '100');
        if (keywords) queryParams.set('keywords', keywords);

        const response = await fetch(`${baseUrl}/linkedin/search/parameters?${queryParams.toString()}`, {
          headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
          },
        });

        const data = await response.json();

        if (!response.ok) {
          console.error('Parameters error:', data);
          return new Response(
            JSON.stringify({ success: false, error: data.message || 'Erreur de récupération' }),
            { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, items: data.items || [] }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_profile': {
        // Get full profile details
        const { profile_id } = params;

        if (!profile_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'Profile ID requis' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const response = await fetch(`${baseUrl}/users/${profile_id}?account_id=${account_id}`, {
          headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
          },
        });

        const data = await response.json();

        if (!response.ok) {
          return new Response(
            JSON.stringify({ success: false, error: data.message || 'Profil non trouvé' }),
            { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, profile: data }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
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
