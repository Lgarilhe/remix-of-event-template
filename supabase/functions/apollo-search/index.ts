// Apollo.io People Search Edge Function
// Docs: https://docs.apollo.io/reference/people-api-search

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const APOLLO_BASE = 'https://api.apollo.io';

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth: validate JWT ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabaseAuth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const user = { id: claimsData.claims.sub as string };

    const APOLLO_API_KEY = Deno.env.get('APOLLO_API_KEY');
    if (!APOLLO_API_KEY) {
      return new Response(JSON.stringify({ success: false, error: 'APOLLO_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();

    // Build Apollo search payload
    const searchPayload: Record<string, any> = {
      per_page: Math.min(body.size || 50, 100),
      page: body.page || 1,
    };

    // ── Person filters ──

    // Job title
    if (body.job_title) {
      searchPayload.person_titles = body.job_title.split(',').map((t: string) => t.trim()).filter(Boolean);
    }

    // Keywords (full-profile search)
    if (body.q_keywords) {
      searchPayload.q_keywords = body.q_keywords;
    }

    // Seniority levels
    if (body.job_title_levels?.length > 0) {
      const seniorityMap: Record<string, string> = {
        'cxo': 'c_suite', 'vp': 'vp', 'head': 'head', 'director': 'director',
        'manager': 'manager', 'senior': 'senior', 'entry': 'entry',
        'owner': 'owner', 'founder': 'founder', 'partner': 'partner', 'training': 'intern',
      };
      searchPayload.person_seniorities = body.job_title_levels
        .map((l: string) => seniorityMap[l] || l).filter(Boolean);
    }

    // Department (from job_title_role)
    if (body.job_title_role) {
      const deptMap: Record<string, string> = {
        'engineering': 'engineering', 'sales': 'sales', 'marketing': 'marketing',
        'operations': 'operations', 'finance': 'finance', 'human_resources': 'human_resources',
        'product': 'product_management', 'legal': 'legal', 'health': 'medical_health',
        'education': 'education', 'research': 'data_science', 'creative': 'design',
      };
      searchPayload.person_departments = [deptMap[body.job_title_role] || body.job_title_role];
    }

    // Person locations
    if (body.person_locations) {
      const locs = typeof body.person_locations === 'string'
        ? body.person_locations.split(',').map((s: string) => s.trim()).filter(Boolean)
        : body.person_locations;
      if (locs.length > 0) searchPayload.person_locations = locs;
    }
    if (body.location_country) {
      searchPayload.person_locations = [...(searchPayload.person_locations || []), body.location_country];
    }

    // Email status
    if (body.email_status) {
      searchPayload.contact_email_status = [body.email_status];
    }

    // ── Company filters ──

    // Company name
    if (body.job_company_name) {
      searchPayload.q_organization_name = body.job_company_name;
    }

    // Company domains
    if (body.company_domains?.length > 0) {
      searchPayload.q_organization_domains_list = body.company_domains;
    }

    // Industry
    if (body.job_company_industry) {
      searchPayload.q_organization_keyword_tags = [body.job_company_industry];
    }

    // Company size
    if (body.job_company_size && body.job_company_size !== 'all') {
      const sizeMap: Record<string, string> = {
        '1-10': '1,10', '11-50': '11,50', '51-200': '51,200', '201-500': '201,500',
        '501-1000': '501,1000', '1001-5000': '1001,5000', '5001-10000': '5001,10000', '10001+': '10001,1000000',
      };
      if (sizeMap[body.job_company_size]) {
        searchPayload.organization_num_employees_ranges = [sizeMap[body.job_company_size]];
      }
    }

    // Organization HQ locations
    if (body.organization_locations) {
      const locs = typeof body.organization_locations === 'string'
        ? body.organization_locations.split(',').map((s: string) => s.trim()).filter(Boolean)
        : body.organization_locations;
      if (locs.length > 0) searchPayload.organization_locations = locs;
    }

    // Technologies
    if (body.technologies?.length > 0) {
      searchPayload.currently_using_any_of_technology_uids = body.technologies.map(
        (t: string) => t.toLowerCase().replace(/\s+/g, '_').replace(/\./g, '_')
      );
    }

    // Revenue range
    if (body.revenue_range && body.revenue_range !== 'all') {
      const [min, max] = body.revenue_range.split(',').map(Number);
      if (min >= 0) searchPayload['revenue_range[min]'] = min;
      if (max > 0) searchPayload['revenue_range[max]'] = max;
    }

    // Funding stage
    if (body.funding_stage && body.funding_stage !== 'all') {
      searchPayload.organization_latest_funding_stage_cd = [body.funding_stage];
    }

    // Hiring intent - job postings
    if (body.is_hiring) {
      searchPayload['organization_num_jobs_range[min]'] = 1;
    }

    // Hiring job titles
    if (body.hiring_job_titles?.length > 0) {
      searchPayload.q_organization_job_titles = body.hiring_job_titles;
    }

    // Hiring locations
    if (body.hiring_locations?.length > 0) {
      searchPayload.organization_job_locations = body.hiring_locations;
    }

    // Employee growth
    if (body.employee_growth) {
      // Not directly in API — skip for now
    }

    console.log('[Apollo] Search payload:', JSON.stringify(searchPayload));

    const apolloResponse = await fetchWithTimeout(`${APOLLO_BASE}/v1/mixed_people/api_search`, {
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
        status: 502,
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
        profile_pic_url: p.photo_url || p.photoUrl || p.profile_pic_url || p.profile_picture_url || p.person_photo_url || null,
        job_title: p.title,
        job_title_role: null,
        job_title_levels: p.seniority ? [p.seniority] : [],
        job_company_name: p.organization_name || org.name || p.company || null,
        job_company_industry: org.industry || org.industry_tag || null,
        job_company_size: org.estimated_num_employees ? String(org.estimated_num_employees) : null,
        job_company_founded: org.founded_year,
        job_company_funding_raised: org.total_funding ? Number(org.total_funding) : null,
        job_company_funding_stage: org.latest_funding_stage,
        job_company_website: org.website_url || (org.primary_domain ? `https://${org.primary_domain}` : null),
        job_company_linkedin_url: org.linkedin_url || org.linkedinUrl || null,
        job_start_date: null,
        location_name: [p.city, p.state, p.country].filter(Boolean).join(', '),
        location_country: p.country,
        location_region: p.state,
        location_locality: p.city,
        linkedin_url: p.linkedin_url || p.linkedinUrl || p.linkedin_profile_url || p.public_profile_url || null,
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
