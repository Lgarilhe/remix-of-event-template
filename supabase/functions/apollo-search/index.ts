// Apollo.io People Search Edge Function
// Uses the People Search API: https://apolloio.github.io/apollo-api-docs/

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const APOLLO_BASE = 'https://api.apollo.io';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const APOLLO_API_KEY = Deno.env.get('APOLLO_API_KEY');
    if (!APOLLO_API_KEY) {
      return new Response(JSON.stringify({ success: false, error: 'APOLLO_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const {
      job_title,
      job_title_role,
      job_title_levels,
      job_company_name,
      job_company_industry,
      job_company_size,
      location_country,
      location_region,
      location_locality,
      skills,
      // Apollo-specific filters
      intent_topics,
      is_hiring,
      technologies,
      revenue_range,
      funding_stage,
      employee_growth,
      // Pagination
      size,
      page,
    } = body;

    // Build Apollo search payload
    const searchPayload: Record<string, any> = {
      per_page: Math.min(size || 50, 100),
      page: page || 1,
    };

    // Person title
    if (job_title) {
      searchPayload.person_titles = job_title.split(',').map((t: string) => t.trim()).filter(Boolean);
    }

    // Seniorities (map our levels to Apollo's seniority values)
    if (job_title_levels && Array.isArray(job_title_levels) && job_title_levels.length > 0) {
      const seniorityMap: Record<string, string> = {
        'cxo': 'c_suite',
        'vp': 'vp',
        'director': 'director',
        'manager': 'manager',
        'senior': 'senior',
        'entry': 'entry',
        'owner': 'owner',
        'partner': 'partner',
        'training': 'intern',
      };
      searchPayload.person_seniorities = job_title_levels
        .map((l: string) => seniorityMap[l] || l)
        .filter(Boolean);
    }

    // Department (from job_title_role)
    if (job_title_role) {
      const deptMap: Record<string, string> = {
        'engineering': 'engineering',
        'sales': 'sales',
        'marketing': 'marketing',
        'operations': 'operations',
        'finance': 'finance',
        'human_resources': 'human_resources',
        'product': 'product_management',
        'legal': 'legal',
        'health': 'medical_health',
        'education': 'education',
        'research': 'data_science',
        'creative': 'design',
      };
      searchPayload.person_departments = [deptMap[job_title_role] || job_title_role];
    }

    // Company name
    if (job_company_name) {
      searchPayload.q_organization_name = job_company_name;
    }

    // Industry
    if (job_company_industry) {
      searchPayload.organization_industry_tag_ids = [];
      // Apollo uses industry keywords
      searchPayload.q_organization_keyword_tags = [job_company_industry];
    }

    // Company size (Apollo uses num_employees_ranges)
    if (job_company_size && job_company_size !== 'all') {
      const sizeMap: Record<string, string> = {
        '1-10': '1,10',
        '11-50': '11,50',
        '51-200': '51,200',
        '201-500': '201,500',
        '501-1000': '501,1000',
        '1001-5000': '1001,5000',
        '5001-10000': '5001,10000',
        '10001+': '10001,1000000',
      };
      if (sizeMap[job_company_size]) {
        searchPayload.organization_num_employees_ranges = [sizeMap[job_company_size]];
      }
    }

    // Location
    if (location_country || location_region || location_locality) {
      const locations: string[] = [];
      if (location_locality) locations.push(location_locality);
      if (location_region) locations.push(location_region);
      if (location_country) locations.push(location_country);
      searchPayload.person_locations = locations;
    }

    // Technologies (Apollo-specific)
    if (technologies && Array.isArray(technologies) && technologies.length > 0) {
      searchPayload.currently_using_any_of_technology_uids = technologies;
    }

    // Intent topics (Apollo-specific)
    if (intent_topics && Array.isArray(intent_topics) && intent_topics.length > 0) {
      searchPayload.q_person_intent_topics = intent_topics;
    }

    // Hiring intent (Apollo-specific)
    if (is_hiring) {
      searchPayload.organization_job_locations = [''];  // trick: any job posting = hiring
      searchPayload.is_hiring = true;
    }

    // Revenue range
    if (revenue_range) {
      searchPayload.organization_revenue_ranges = [revenue_range];
    }

    // Funding stage
    if (funding_stage) {
      const fundingMap: Record<string, string> = {
        'seed': 'seed',
        'series_a': 'series_a',
        'series_b': 'series_b',
        'series_c': 'series_c',
        'series_d': 'series_d',
        'ipo': 'ipo',
      };
      searchPayload.organization_latest_funding_stage_cd = [fundingMap[funding_stage] || funding_stage];
    }

    // Employee growth
    if (employee_growth) {
      searchPayload.organization_employee_growth_rate_ranges = [employee_growth];
    }

    console.log('[Apollo] Search payload:', JSON.stringify(searchPayload));

    const apolloResponse = await fetch(`${APOLLO_BASE}/v1/mixed_people/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': APOLLO_API_KEY,
      },
      body: JSON.stringify(searchPayload),
    });

    if (!apolloResponse.ok) {
      const errText = await apolloResponse.text();
      console.error('[Apollo] API error:', apolloResponse.status, errText);
      return new Response(JSON.stringify({ success: false, error: `Apollo API error: ${apolloResponse.status}`, details: errText }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apolloData = await apolloResponse.json();
    const rawPeople = apolloData.people || [];

    const prospects = rawPeople.map((p: any) => {
      const org = p.organization || {};
      
      return {
        id: p.id || crypto.randomUUID(),
        full_name: p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
        first_name: p.first_name,
        last_name: p.last_name,
        headline: p.headline || p.title,
        profile_pic_url: p.photo_url || null,
        job_title: p.title,
        job_title_role: null,
        job_title_levels: p.seniority ? [p.seniority] : [],
        job_company_name: p.organization_name || org.name,
        job_company_industry: org.industry,
        job_company_size: org.estimated_num_employees ? String(org.estimated_num_employees) : null,
        job_company_founded: org.founded_year,
        job_company_funding_raised: org.total_funding ? Number(org.total_funding) : null,
        job_company_funding_stage: org.latest_funding_stage,
        job_company_website: org.website_url || null,
        job_company_linkedin_url: org.linkedin_url || null,
        job_start_date: null,
        location_name: [p.city, p.state, p.country].filter(Boolean).join(', '),
        location_country: p.country,
        location_region: p.state,
        location_locality: p.city,
        linkedin_url: p.linkedin_url,
        emails: [p.email].filter(Boolean),
        phone_numbers: p.phone_numbers?.map((ph: any) => ph.sanitized_number || ph.raw_number).filter(Boolean) || [],
        skills: [],
        experience: (p.employment_history || []).slice(0, 5).map((exp: any) => ({
          title: exp.title,
          company: exp.organization_name,
          start_date: exp.start_date,
          end_date: exp.end_date,
        })),
        education: [],
        intent_signals: {
          job_change: false,
          recently_funded: !!org.latest_funding_stage,
          hiring: !!(org.job_postings_count && org.job_postings_count > 0),
        },
        source: 'apollo',
      };
    });

    return new Response(JSON.stringify({ 
      success: true, 
      prospects, 
      total: apolloData.pagination?.total_entries || prospects.length,
      page: apolloData.pagination?.page || 1,
      total_pages: apolloData.pagination?.total_pages || 1,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[Apollo] Error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
