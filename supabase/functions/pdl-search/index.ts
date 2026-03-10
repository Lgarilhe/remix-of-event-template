// PDL (PeopleDataLabs) Person Search Edge Function

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
      job_title,
      company,
      location,
      industry,
      company_size,
      skills,
      intent_job_change,
    } = body;

    // Build SQL WHERE clauses for PDL Person Search API
    const conditions: string[] = [];

    if (job_title) {
      const titles = job_title.split(',').map((t: string) => t.trim()).filter(Boolean);
      if (titles.length === 1) {
        conditions.push(`job_title='${titles[0]}'`);
      } else {
        const orParts = titles.map((t: string) => `job_title='${t}'`).join(' OR ');
        conditions.push(`(${orParts})`);
      }
    }

    if (company) {
      conditions.push(`job_company_name='${company}'`);
    }

    if (location) {
      const locations = location.split(',').map((l: string) => l.trim()).filter(Boolean);
      if (locations.length === 1) {
        conditions.push(`location_name='${locations[0]}'`);
      } else {
        const orParts = locations.map((l: string) => `location_name='${l}'`).join(' OR ');
        conditions.push(`(${orParts})`);
      }
    }

    if (industry) {
      conditions.push(`job_company_industry='${industry}'`);
    }

    if (company_size && company_size !== 'all') {
      conditions.push(`job_company_size='${company_size}'`);
    }

    if (skills && Array.isArray(skills) && skills.length > 0) {
      const skillParts = skills.map((s: string) => `skills='${s}'`).join(' OR ');
      conditions.push(`(${skillParts})`);
    }

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
      size: 50,
      dataset: 'all',
    };

    // PDL Person Search uses GET with a body
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
        job_title: p.job_title,
        job_company_name: p.job_company_name,
        job_company_industry: p.job_company_industry,
        job_company_size: p.job_company_size,
        job_company_founded: p.job_company_founded,
        job_company_funding_raised: p.job_company_total_funding_raised,
        job_company_funding_stage: p.job_company_funding_details?.last_funding_round_type,
        job_start_date: p.job_start_date,
        location_name: p.location_name,
        linkedin_url: p.linkedin_url,
        emails: (p.emails || []).map((e: any) => e.address).filter(Boolean),
        phone_numbers: (p.phone_numbers || []).map((ph: any) => ph.number).filter(Boolean),
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
