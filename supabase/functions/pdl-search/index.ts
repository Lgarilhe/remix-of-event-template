// PDL (PeopleDataLabs) Person Search Edge Function
// Uses the SQL-style query API: https://docs.peopledatalabs.com/docs/reference-person-search-api

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const PDL_BASE = 'https://api.peopledatalabs.com/v5';

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';

/** Escape a string value for PDL SQL syntax (doubles single quotes). */
function esc(value: string): string {
  return value.replace(/'/g, "''");
}

/** Validate and return a numeric string, or null if invalid. */
function numOrNull(value: string): string | null {
  const n = Number(value);
  return isFinite(n) ? String(n) : null;
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

    const PDL_API_KEY = Deno.env.get('PDL_API_KEY');
    if (!PDL_API_KEY) {
      return new Response(JSON.stringify({ success: false, error: 'PDL_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const conditions: string[] = [];

    // ── Person / Job Title ──
    if (body.job_title) {
      const titles = body.job_title.split(',').map((t: string) => t.trim()).filter(Boolean);
      if (titles.length === 1) conditions.push(`job_title LIKE '%${esc(titles[0])}%'`);
      else conditions.push(`(${titles.map((t: string) => `job_title LIKE '%${esc(t)}%'`).join(' OR ')})`);
    }
    if (body.job_title_role) conditions.push(`job_title_role='${esc(body.job_title_role)}'`);
    if (body.job_title_sub_role) conditions.push(`job_title_sub_role='${esc(body.job_title_sub_role)}'`);
    if (body.job_title_class) conditions.push(`job_title_class='${esc(body.job_title_class)}'`);
    if (body.job_title_levels?.length > 0) {
      if (body.job_title_levels.length === 1) conditions.push(`job_title_levels='${esc(body.job_title_levels[0])}'`);
      else conditions.push(`(${body.job_title_levels.map((l: string) => `job_title_levels='${esc(l)}'`).join(' OR ')})`);
    }

    // ── Company ──
    if (body.job_company_name) conditions.push(`job_company_name LIKE '%${esc(body.job_company_name)}%'`);
    if (body.job_company_industry) conditions.push(`job_company_industry='${esc(body.job_company_industry)}'`);
    if (body.job_company_size && body.job_company_size !== 'all') conditions.push(`job_company_size='${esc(body.job_company_size)}'`);
    if (body.job_company_type) conditions.push(`job_company_type='${esc(body.job_company_type)}'`);
    if (body.job_company_ticker) conditions.push(`job_company_ticker='${esc(body.job_company_ticker.toLowerCase())}'`);
    if (body.job_company_founded) {
      const v = body.job_company_founded.trim();
      const raw = v.startsWith('>') || v.startsWith('<') ? v.slice(1).trim() : v;
      const num = numOrNull(raw);
      if (num) {
        if (v.startsWith('>')) conditions.push(`job_company_founded>=${num}`);
        else if (v.startsWith('<')) conditions.push(`job_company_founded<=${num}`);
        else conditions.push(`job_company_founded=${num}`);
      }
    }
    if (body.job_company_inferred_revenue) conditions.push(`job_company_inferred_revenue='${esc(body.job_company_inferred_revenue)}'`);
    if (body.job_company_total_funding_raised_min) {
      const num = numOrNull(String(body.job_company_total_funding_raised_min));
      if (num) conditions.push(`job_company_total_funding_raised>=${num}`);
    }
    if (body.job_company_total_funding_raised_max) {
      const num = numOrNull(String(body.job_company_total_funding_raised_max));
      if (num) conditions.push(`job_company_total_funding_raised<=${num}`);
    }
    if (body.job_company_12mo_employee_growth_rate) {
      const v = body.job_company_12mo_employee_growth_rate.trim();
      const raw = v.startsWith('>') || v.startsWith('<') ? v.slice(1).trim() : v;
      const num = numOrNull(raw);
      if (num) {
        if (v.startsWith('>')) conditions.push(`job_company_12mo_employee_growth_rate>=${num}`);
        else if (v.startsWith('<')) conditions.push(`job_company_12mo_employee_growth_rate<=${num}`);
        else conditions.push(`job_company_12mo_employee_growth_rate>=${num}`);
      }
    }

    // ── Company HQ Location ──
    if (body.job_company_location_country) conditions.push(`job_company_location_country='${esc(body.job_company_location_country)}'`);
    if (body.job_company_location_region) conditions.push(`job_company_location_region LIKE '%${esc(body.job_company_location_region)}%'`);
    if (body.job_company_location_locality) conditions.push(`job_company_location_locality LIKE '%${esc(body.job_company_location_locality)}%'`);

    // ── Person Location ──
    if (body.location_country) conditions.push(`location_country='${esc(body.location_country)}'`);
    if (body.location_continent) conditions.push(`location_continent='${esc(body.location_continent)}'`);
    if (body.location_region) conditions.push(`location_region LIKE '%${esc(body.location_region)}%'`);
    if (body.location_metro) conditions.push(`location_metro LIKE '%${esc(body.location_metro)}%'`);
    if (body.location_locality) conditions.push(`location_locality LIKE '%${esc(body.location_locality)}%'`);

    // ── Skills ──
    if (body.skills?.length > 0) {
      conditions.push(`(${body.skills.map((s: string) => `skills LIKE '%${esc(s)}%'`).join(' OR ')})`);
    }

    // ── Experience ──
    if (body.years_experience) {
      const [minStr, maxStr] = body.years_experience.split('-');
      const min = parseInt(minStr);
      if (!isNaN(min)) conditions.push(`inferred_years_experience>=${min}`);
      if (maxStr && !maxStr.includes('+')) {
        const max = parseInt(maxStr);
        if (!isNaN(max)) conditions.push(`inferred_years_experience<=${max}`);
      }
    }
    if (body.inferred_salary) conditions.push(`inferred_salary='${esc(body.inferred_salary)}'`);
    if (body.industry) conditions.push(`industry='${esc(body.industry)}'`);

    // ── Education ──
    if (body.education_school) conditions.push(`education.school.name LIKE '%${esc(body.education_school)}%'`);
    if (body.education_degree) conditions.push(`education.degrees='${esc(body.education_degree)}'`);
    if (body.education_major) conditions.push(`education.majors LIKE '%${esc(body.education_major)}%'`);

    // ── Languages ──
    if (body.languages) {
      const langs = body.languages.split(',').map((l: string) => l.trim().toLowerCase()).filter(Boolean);
      if (langs.length > 0) conditions.push(`(${langs.map((l: string) => `languages.name='${esc(l)}'`).join(' OR ')})`);
    }

    // ── Certifications ──
    if (body.certifications) conditions.push(`certifications.name LIKE '%${esc(body.certifications)}%'`);

    // ── Interests ──
    if (body.interests) {
      const ints = body.interests.split(',').map((i: string) => i.trim().toLowerCase()).filter(Boolean);
      if (ints.length > 0) conditions.push(`(${ints.map((i: string) => `interests='${esc(i)}'`).join(' OR ')})`);
    }

    // ── Summary / Bio ──
    if (body.summary) conditions.push(`summary LIKE '%${esc(body.summary)}%'`);

    // ── Intent signals ──
    if (body.intent_job_change) {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      conditions.push(`job_start_date>='${sixMonthsAgo.toISOString().split('T')[0]}'`);
    }
    if (body.recently_funded) {
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      conditions.push(`job_company_funding_details.last_funding_date>='${oneYearAgo.toISOString().split('T')[0]}'`);
    }

    if (conditions.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Au moins un critère de recherche est requis' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sqlQuery = `SELECT * FROM person WHERE ${conditions.join(' AND ')}`;
    console.log('[PDL] SQL query:', sqlQuery);

    const searchBody = { sql: sqlQuery, size: Math.min(body.size || 50, 100), dataset: 'all' };

    const pdlResponse = await fetch(`${PDL_BASE}/person/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': PDL_API_KEY },
      body: JSON.stringify(searchBody),
    });

    if (!pdlResponse.ok) {
      const errText = await pdlResponse.text();
      console.error('[PDL] API error:', pdlResponse.status, errText);
      if (pdlResponse.status === 404) {
        try {
          const parsed = JSON.parse(errText);
          if (parsed?.error?.type === 'not_found') {
            return new Response(JSON.stringify({ success: true, prospects: [], total: 0 }), {
              status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        } catch { /* fall through */ }
      }
      return new Response(JSON.stringify({ success: false, error: `PDL API error: ${pdlResponse.status}`, details: errText }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const pdlData = await pdlResponse.json();
    const rawProfiles = pdlData.data || [];

    const prospects = rawProfiles.map((p: any) => {
      const jobStartDate = p.job_start_date;
      const isRecentJobChange = jobStartDate ? new Date(jobStartDate) > new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000) : false;
      const lastFundingDate = p.job_company_funding_details?.last_funding_date;
      const isRecentlyFunded = lastFundingDate ? new Date(lastFundingDate) > new Date(Date.now() - 12 * 30 * 24 * 60 * 60 * 1000) : false;

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
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
