import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
      funding_stage,
      intent_job_change,
      intent_funding,
      intent_hiring,
    } = body;

    // Build PDL person search query
    const query_parts: string[] = [];

    if (job_title) {
      query_parts.push(`job_title='${job_title}'`);
    }
    if (company) {
      query_parts.push(`job_company_name='${company}'`);
    }
    if (location) {
      query_parts.push(`location_name='${location}'`);
    }
    if (industry) {
      query_parts.push(`job_company_industry='${industry}'`);
    }
    if (company_size && company_size !== 'all') {
      query_parts.push(`job_company_size='${company_size}'`);
    }
    if (skills && skills.length > 0) {
      const skillsQuery = skills.map((s: string) => `'${s}'`).join(' OR ');
      query_parts.push(`skills=(${skillsQuery})`);
    }

    // Intent: recently changed jobs (within last 6 months)
    if (intent_job_change) {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      query_parts.push(`job_start_date>='${sixMonthsAgo.toISOString().split('T')[0]}'`);
    }

    if (query_parts.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Au moins un critère de recherche est requis' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const esQuery = query_parts.join(' AND ');
    console.log('[PDL] Search query:', esQuery);

    // PDL Person Search API
    const pdlResponse = await fetch(`${PDL_BASE}/person/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': PDL_API_KEY,
      },
      body: JSON.stringify({
        query: {
          bool: {
            must: buildElasticQuery({
              job_title,
              company,
              location,
              industry,
              company_size,
              skills,
              intent_job_change,
            }),
          },
        },
        size: 50,
        dataset: 'all',
      }),
    });

    if (!pdlResponse.ok) {
      const errText = await pdlResponse.text();
      console.error('[PDL] API error:', pdlResponse.status, errText);
      return new Response(JSON.stringify({ success: false, error: `PDL API error: ${pdlResponse.status}` }), {
        status: pdlResponse.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const pdlData = await pdlResponse.json();
    const rawProfiles = pdlData.data || [];

    // Map PDL profiles to our format + add intent signals
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
          hiring: false, // Would need a separate company search
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

/**
 * Build Elasticsearch-style query for PDL Person Search API
 */
function buildElasticQuery(params: {
  job_title?: string;
  company?: string;
  location?: string;
  industry?: string;
  company_size?: string;
  skills?: string[];
  intent_job_change?: boolean;
}): any[] {
  const must: any[] = [];

  if (params.job_title) {
    must.push({
      bool: {
        should: params.job_title.split(',').map(t => ({
          match: { job_title: t.trim() },
        })),
      },
    });
  }

  if (params.company) {
    must.push({ match: { job_company_name: params.company } });
  }

  if (params.location) {
    must.push({
      bool: {
        should: params.location.split(',').map(l => ({
          match: { location_name: l.trim() },
        })),
      },
    });
  }

  if (params.industry) {
    must.push({ match: { job_company_industry: params.industry } });
  }

  if (params.company_size && params.company_size !== 'all') {
    must.push({ match: { job_company_size: params.company_size } });
  }

  if (params.skills && params.skills.length > 0) {
    must.push({
      bool: {
        should: params.skills.map(s => ({
          match: { skills: s },
        })),
        minimum_should_match: 1,
      },
    });
  }

  if (params.intent_job_change) {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    must.push({
      range: {
        job_start_date: { gte: sixMonthsAgo.toISOString().split('T')[0] },
      },
    });
  }

  return must;
}
