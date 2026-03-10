// PDL (PeopleDataLabs) Person Search Edge Function
// Uses the SQL-style query API: https://docs.peopledatalabs.com/docs/reference-person-search-api

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const PDL_BASE = 'https://api.peopledatalabs.com/v5';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const PDL_API_KEY = Deno.env.get('PDL_API_KEY');
    if (!PDL_API_KEY) {
      return new Response(JSON.stringify({ success: false, error: 'PDL_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const {
      job_title, job_title_role, job_title_levels,
      job_company_name, job_company_industry, job_company_size,
      location_country, location_region, location_locality,
      skills, intent_job_change,
      // New filters
      years_experience, education_school, job_company_founded, recently_funded,
      size,
    } = body;

    // Build SQL WHERE clauses
    const conditions: string[] = [];

    // Job title - use LIKE for flexible matching
    if (job_title) {
      const titles = job_title.split(',').map((t: string) => t.trim()).filter(Boolean);
      if (titles.length === 1) {
        conditions.push(`job_title LIKE '%${titles[0]}%'`);
      } else {
        const orParts = titles.map((t: string) => `job_title LIKE '%${t}%'`).join(' OR ');
        conditions.push(`(${orParts})`);
      }
    }

    // Job title role - canonical enum, exact match
    if (job_title_role) {
      conditions.push(`job_title_role='${job_title_role}'`);
    }

    // Job title levels - canonical enum, exact match
    if (job_title_levels && Array.isArray(job_title_levels) && job_title_levels.length > 0) {
      if (job_title_levels.length === 1) {
        conditions.push(`job_title_levels='${job_title_levels[0]}'`);
      } else {
        const orParts = job_title_levels.map((l: string) => `job_title_levels='${l}'`).join(' OR ');
        conditions.push(`(${orParts})`);
      }
    }

    // Company name - LIKE for flexibility
    if (job_company_name) {
      conditions.push(`job_company_name LIKE '%${job_company_name}%'`);
    }

    // Industry - canonical value, exact match
    if (job_company_industry) {
      conditions.push(`job_company_industry='${job_company_industry}'`);
    }

    // Company size - enum, exact match
    if (job_company_size && job_company_size !== 'all') {
      conditions.push(`job_company_size='${job_company_size}'`);
    }

    // Location country - canonical lowercase
    if (location_country) {
      conditions.push(`location_country='${location_country}'`);
    }

    // Location region - LIKE for flexibility
    if (location_region) {
      conditions.push(`location_region LIKE '%${location_region}%'`);
    }

    // Location locality (city) - LIKE for flexibility
    if (location_locality) {
      conditions.push(`location_locality LIKE '%${location_locality}%'`);
    }

    // Skills - array of strings, OR match
    if (skills && Array.isArray(skills) && skills.length > 0) {
      const skillParts = skills.map((s: string) => `skills='${s}'`).join(' OR ');
      conditions.push(`(${skillParts})`);
    }

    // Intent: recent job change (started within last 6 months)
    if (intent_job_change) {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      conditions.push(`job_start_date>='${sixMonthsAgo.toISOString().split('T')[0]}'`);
    }

    if (conditions.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Au moins un critère de recherche est requis' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sqlQuery = `SELECT * FROM person WHERE ${conditions.join(' AND ')}`;
    console.log('[PDL] SQL query:', sqlQuery);

    const searchBody = {
      sql: sqlQuery,
      size: Math.min(size || 50, 100),
      dataset: 'all',
    };

    const pdlResponse = await fetch(`${PDL_BASE}/person/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': PDL_API_KEY,
      },
      body: JSON.stringify(searchBody),
    });

    if (!pdlResponse.ok) {
      const errText = await pdlResponse.text();
      console.error('[PDL] API error:', pdlResponse.status, errText);

      // PDL returns 404 + type=not_found when there are no matches
      if (pdlResponse.status === 404) {
        try {
          const parsed = JSON.parse(errText);
          if (parsed?.error?.type === 'not_found') {
            return new Response(JSON.stringify({ success: true, prospects: [], total: 0 }), {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        } catch {
          // fall through
        }
      }

      return new Response(JSON.stringify({ success: false, error: `PDL API error: ${pdlResponse.status}`, details: errText }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const pdlData = await pdlResponse.json();
    const rawProfiles = pdlData.data || [];

    const prospects = rawProfiles.map((p: any) => {
      const jobStartDate = p.job_start_date;
      const isRecentJobChange = jobStartDate
        ? new Date(jobStartDate) > new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000)
        : false;

      const lastFundingDate = p.job_company_funding_details?.last_funding_date;
      const isRecentlyFunded = lastFundingDate
        ? new Date(lastFundingDate) > new Date(Date.now() - 12 * 30 * 24 * 60 * 60 * 1000)
        : false;

      return {
        id: p.id || crypto.randomUUID(),
        full_name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
        first_name: p.first_name,
        last_name: p.last_name,
        headline: p.headline,
        profile_pic_url: p.profile_pic_url || null,
        job_title: p.job_title,
        job_title_role: p.job_title_role,
        job_title_levels: p.job_title_levels,
        job_company_name: p.job_company_name,
        job_company_industry: p.job_company_industry,
        job_company_size: p.job_company_size,
        job_company_founded: p.job_company_founded,
        job_company_funding_raised: p.job_company_total_funding_raised,
        job_company_funding_stage: p.job_company_funding_details?.last_funding_round_type,
        job_company_website: p.job_company_website || null,
        job_company_linkedin_url: p.job_company_linkedin_url || null,
        job_start_date: p.job_start_date,
        location_name: p.location_name,
        location_country: p.location_country,
        location_region: p.location_region,
        location_locality: p.location_locality,
        linkedin_url: p.linkedin_url,
        emails: (Array.isArray(p.emails) ? p.emails : []).map((e: any) => typeof e === 'string' ? e : e?.address).filter(Boolean),
        phone_numbers: (Array.isArray(p.phone_numbers) ? p.phone_numbers : []).map((ph: any) => typeof ph === 'string' ? ph : ph?.number).filter(Boolean),
        skills: p.skills || [],
        experience: (p.experience || []).slice(0, 5).map((exp: any) => ({
          title: exp.title?.name,
          company: exp.company?.name,
          start_date: exp.start_date,
          end_date: exp.end_date,
        })),
        education: (p.education || []).slice(0, 3).map((edu: any) => ({
          school: edu.school?.name,
          degree: edu.degrees?.join(', '),
        })),
        intent_signals: {
          job_change: isRecentJobChange,
          recently_funded: isRecentlyFunded,
          hiring: false,
        },
      };
    });

    return new Response(JSON.stringify({ success: true, prospects, total: pdlData.total || prospects.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[PDL] Error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
