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
        const {
          keywords,
          service = 'recruiter',
          limit = 25,
          cursor,
          location,
          company,
          industry,
          job_title,
          school,
          seniority,
          skills,
          role,
          network_distance,
          years_of_experience,
          open_to_work,
          hiring_project,
          talent_pool,
          spotlight,
        } = params;

        const apiType = service.toLowerCase();
        const searchBody: Record<string, unknown> = {
          api: apiType,
          category: 'people',
          limit,
        };

        if (cursor) searchBody.cursor = cursor;
        if (keywords) searchBody.keywords = keywords;
        if (location?.length > 0) searchBody.location = location;
        
        // Company with include/exclude structure
        if (company?.include?.length > 0 || company?.exclude?.length > 0) {
          searchBody.company = company;
        } else if (Array.isArray(company) && company.length > 0) {
          searchBody.company = { include: company };
        }

        // Industry with include structure
        if (industry?.length > 0) {
          searchBody.industry = { include: industry };
        }

        // School
        if (school?.length > 0) searchBody.school = school;

        // Seniority
        if (seniority?.length > 0) searchBody.seniority = seniority;

        // Network distance
        if (network_distance?.length > 0) searchBody.network_distance = network_distance;

        // Skills with priority (MUST_HAVE, SHOULD_HAVE, DOESNT_HAVE)
        if (skills?.length > 0) {
          searchBody.skills = skills.map((s: { id: string; priority: string }) => ({
            id: s.id,
            priority: s.priority,
          }));
        }

        // Job title with priority
        if (job_title?.length > 0) {
          if (apiType === 'recruiter') {
            searchBody.current_job_title = job_title.map((t: { id: string; priority: string }) => ({
              id: t.id,
              priority: t.priority,
            }));
          } else {
            searchBody.job_title = job_title.map((t: { id: string }) => t.id);
          }
        }

        // Role with keywords, priority, scope (Recruiter specific)
        if (role?.length > 0 && apiType === 'recruiter') {
          searchBody.role = role;
        }

        // Years of experience
        if (years_of_experience) {
          searchBody.years_of_experience = years_of_experience;
        }

        // Open to work
        if (open_to_work === true) {
          searchBody.open_to = ['all'];
        }

        // Recruiter specific
        if (hiring_project) searchBody.hiring_project = hiring_project;
        if (talent_pool) searchBody.talent_pool = talent_pool;
        if (spotlight) searchBody.spotlight = spotlight;

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
            total: data.paging?.total_count || data.total,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_parameters': {
        const { type, keywords, service = 'RECRUITER' } = params;

        if (!type) {
          return new Response(
            JSON.stringify({ success: false, error: 'Type de paramètre requis' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const serviceType = service.toUpperCase();
        const queryParams = new URLSearchParams();
        queryParams.set('account_id', account_id);
        queryParams.set('type', type);
        queryParams.set('service', serviceType);
        queryParams.set('limit', '100');
        if (keywords) queryParams.set('keywords', keywords);

        console.log('Get parameters URL:', `${baseUrl}/linkedin/search/parameters?${queryParams.toString()}`);

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

        // Map API response: 'title' -> consistent format
        const items = (data.items || []).map((item: { id: string; title: string }) => ({
          id: item.id,
          title: item.title,
        }));

        return new Response(
          JSON.stringify({ success: true, items }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_profile': {
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
