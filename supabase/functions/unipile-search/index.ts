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
        // Search LinkedIn profiles using POST method
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

        // Build request body for POST
        const searchBody: Record<string, unknown> = {
          api: service,
          limit,
        };

        if (cursor) searchBody.cursor = cursor;
        if (keywords) searchBody.keywords = keywords;
        
        // Location filters
        if (location?.length > 0) {
          searchBody.location = location;
        }
        
        // Company filters
        if (company?.length > 0 || current_company?.length > 0) {
          searchBody.current_company = [...(company || []), ...(current_company || [])];
        }
        if (past_company?.length > 0) {
          searchBody.past_company = past_company;
        }
        
        // Industry filter
        if (industry?.length > 0) {
          searchBody.industry = industry;
        }
        
        // Job title filter
        if (job_title?.length > 0) {
          searchBody.job_title = job_title;
        }
        
        // School filter
        if (school?.length > 0) {
          searchBody.school = school;
        }
        
        // Seniority filter
        if (seniority?.length > 0) {
          searchBody.seniority = seniority;
        }
        
        // Skills filter
        if (skills?.length > 0) {
          searchBody.skill = skills;
        }
        
        // Language filter
        if (language?.length > 0) {
          searchBody.language = language;
        }
        
        // Recruiter specific filters
        if (hiring_project) searchBody.hiring_project = hiring_project;
        if (talent_pool) searchBody.talent_pool = talent_pool;
        if (spotlight) searchBody.spotlight = spotlight;
        if (years_of_experience_min) searchBody.years_of_experience_min = years_of_experience_min;
        if (years_of_experience_max) searchBody.years_of_experience_max = years_of_experience_max;
        if (open_to_work !== undefined) searchBody.open_to_work = open_to_work;

        const searchUrl = `${baseUrl}/linkedin/search?account_id=${account_id}`;
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
            JSON.stringify({ success: false, error: data.detail || data.message || 'Erreur de recherche' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
