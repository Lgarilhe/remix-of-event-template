/**
 * Company Enrichment Edge Function
 * Combines Apollo (company data) + Firecrawl (website scraping + web search fallback) to enrich company info.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { company_name } = await req.json();
    if (!company_name || company_name.trim().length < 2) {
      return new Response(JSON.stringify({ success: false, error: 'company_name required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const APOLLO_API_KEY = Deno.env.get('APOLLO_API_KEY');
    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');

    const result: Record<string, any> = {
      name: company_name.trim(),
      domain: null,
      industry: null,
      size: null,
      location: null,
      funding: null,
      description: null,
      techStack: [],
      insights: [],
      decisionMakers: [],
      openRoles: [],
      linkedinUrl: null,
      websiteUrl: null,
      logoUrl: null,
    };

    // ── 1. Apollo Organization Search ──
    let apolloOrg: any = null;
    if (APOLLO_API_KEY) {
      try {
        console.log('[enrich-company] Apollo org search:', company_name);
        const orgRes = await fetch('https://api.apollo.io/v1/mixed_companies/api_search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': APOLLO_API_KEY },
          body: JSON.stringify({ q_organization_name: company_name.trim(), per_page: 1 }),
        });
        if (orgRes.ok) {
          const orgData = await orgRes.json();
          console.log('[enrich-company] Apollo response keys:', Object.keys(orgData));
          apolloOrg = orgData.organizations?.[0] || orgData.accounts?.[0] || null;
          if (!apolloOrg) {
            console.log('[enrich-company] Apollo returned no organizations/accounts');
          }
        } else {
          console.warn('[enrich-company] Apollo returned status:', orgRes.status);
        }
      } catch (e) {
        console.warn('[enrich-company] Apollo org search failed:', e);
      }
    }

    if (apolloOrg) {
      result.domain = apolloOrg.primary_domain || apolloOrg.website_url?.replace(/^https?:\/\//, '').replace(/\/.*/, '') || null;
      result.industry = [apolloOrg.industry, apolloOrg.industry_tag].filter(Boolean).join(' · ') || null;
      result.size = apolloOrg.estimated_num_employees ? String(apolloOrg.estimated_num_employees) : null;
      result.location = [apolloOrg.city, apolloOrg.state, apolloOrg.country].filter(Boolean).join(', ') || null;
      result.funding = apolloOrg.latest_funding_stage
        ? `${apolloOrg.latest_funding_stage}${apolloOrg.total_funding ? ' · ' + formatFunding(apolloOrg.total_funding) : ''}`
        : null;
      result.description = apolloOrg.short_description || apolloOrg.seo_description || null;
      result.linkedinUrl = apolloOrg.linkedin_url || null;
      result.websiteUrl = apolloOrg.website_url || (result.domain ? `https://${result.domain}` : null);
      result.logoUrl = apolloOrg.logo_url || null;
      result.techStack = (apolloOrg.technology_names || []).slice(0, 12);
    }

    // ── 1b. Firecrawl Web Search Fallback (if Apollo found nothing) ──
    if (!result.domain && FIRECRAWL_API_KEY) {
      try {
        console.log('[enrich-company] Apollo empty → Firecrawl web search fallback for:', company_name);
        const searchRes = await fetch('https://api.firecrawl.dev/v1/search', {
          method: 'POST',
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `${company_name.trim()} company website`,
            limit: 3,
            scrapeOptions: { formats: ['markdown'] },
          }),
        });
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const results = searchData.data || [];
          console.log('[enrich-company] Firecrawl search returned', results.length, 'results');

          if (results.length > 0) {
            // Extract domain from the first result URL
            const firstUrl = results[0].url || '';
            const domainMatch = firstUrl.match(/^https?:\/\/(?:www\.)?([^\/]+)/);
            if (domainMatch) {
              result.domain = domainMatch[1];
              result.websiteUrl = firstUrl;
              console.log('[enrich-company] Found domain via search:', result.domain);
            }

            // Do NOT override result.name — keep the user's original input

            if (results[0].description && !result.description) {
              result.description = results[0].description;
            }

            // Extract description from markdown if available
            if (!result.description && results[0].markdown) {
              result.description = results[0].markdown.slice(0, 300).replace(/\n/g, ' ').replace(/[#*_\[\]]/g, '').trim();
            }

            // Look for LinkedIn URL in results
            for (const r of results) {
              if (r.url?.includes('linkedin.com/company/')) {
                result.linkedinUrl = r.url;
                break;
              }
            }
          }
        }
      } catch (e) {
        console.warn('[enrich-company] Firecrawl search fallback failed:', e);
      }
    }

    // ── 2. Apollo People Search (Decision Makers) ──
    if (APOLLO_API_KEY) {
      try {
        const peopleRes = await fetch('https://api.apollo.io/v1/mixed_people/api_search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': APOLLO_API_KEY },
          body: JSON.stringify({
            q_organization_name: company_name.trim(),
            person_titles: ['CEO', 'CTO', 'DRH', 'VP Engineering', 'VP People', 'Head of HR', 'Head of Engineering', 'Directeur Technique', 'Directeur RH'],
            per_page: 5,
          }),
        });
        if (peopleRes.ok) {
          const peopleData = await peopleRes.json();
          result.decisionMakers = (peopleData.people || []).slice(0, 5).map((p: any) => ({
            name: p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
            role: p.title || '',
            linkedinUrl: p.linkedin_url || null,
          }));
        }
      } catch (e) {
        console.warn('[enrich-company] Apollo people search failed:', e);
      }
    }

    // ── 3. Firecrawl: Scrape website for more data ──
    if (FIRECRAWL_API_KEY && result.domain) {
      try {
        console.log('[enrich-company] Firecrawl scraping:', result.domain);
        const scrapeRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: `https://${result.domain}`,
            formats: ['markdown', 'links'],
            onlyMainContent: true,
          }),
        });
        if (scrapeRes.ok) {
          const scrapeData = await scrapeRes.json();
          const md = scrapeData.data?.markdown || scrapeData.markdown || '';
          const links = scrapeData.data?.links || scrapeData.links || [];

          // Extract description if not from Apollo
          if (!result.description && md.length > 50) {
            result.description = md.slice(0, 300).replace(/\n/g, ' ').trim();
          }

          // Try to find careers page
          const careersLink = links.find((l: string) =>
            /carri[eè]re|career|job|recrutement|join|talent/i.test(l)
          );
          if (careersLink) {
            result.careersUrl = careersLink;
          }
        }
      } catch (e) {
        console.warn('[enrich-company] Firecrawl scrape failed:', e);
      }

      // Scrape careers page if found
      if (result.careersUrl) {
        try {
          const careersRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: result.careersUrl,
              formats: [{ type: 'json', prompt: 'Extract all open job positions with their title, location, and department. Return as array of objects with fields: title, location, department.' }],
            }),
          });
          if (careersRes.ok) {
            const careersData = await careersRes.json();
            const jobs = careersData.data?.json || careersData.json;
            if (Array.isArray(jobs)) {
              result.openRoles = jobs.slice(0, 10).map((j: any) => ({
                title: j.title || j.name || 'Poste',
                location: j.location || j.city || '',
                source: 'Site carrière',
              }));
            } else if (jobs && typeof jobs === 'object') {
              const arr = Object.values(jobs).find(v => Array.isArray(v)) as any[];
              if (arr) {
                result.openRoles = arr.slice(0, 10).map((j: any) => ({
                  title: j.title || j.name || j.role || 'Poste',
                  location: j.location || j.city || '',
                  source: 'Site carrière',
                }));
              }
            }
          }
        } catch (e) {
          console.warn('[enrich-company] Firecrawl careers scrape failed:', e);
        }
      }
    }

    // ── 4. Generate insights with AI ──
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (LOVABLE_API_KEY && (result.description || result.industry)) {
      try {
        const prompt = `Given this company data, generate 3-4 short actionable insights for a recruiter in French. Company: ${result.name}. Industry: ${result.industry || 'unknown'}. Size: ${result.size || 'unknown'}. Funding: ${result.funding || 'unknown'}. Tech stack: ${result.techStack.join(', ') || 'unknown'}. Description: ${(result.description || '').slice(0, 500)}. Open roles: ${result.openRoles.length}. Return a JSON array of strings, each starting with an emoji. Example: ["🔥 Marché en forte croissance", "⚡ Profils DevOps très demandés"]`;

        const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash-lite',
            messages: [
              { role: 'system', content: 'You are a recruitment market analyst. Return ONLY valid JSON arrays of strings.' },
              { role: 'user', content: prompt },
            ],
            tools: [{
              type: 'function',
              function: {
                name: 'return_insights',
                description: 'Return market insights as an array of strings',
                parameters: {
                  type: 'object',
                  properties: {
                    insights: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['insights'],
                  additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: 'function', function: { name: 'return_insights' } },
          }),
        });

        if (aiRes.ok) {
          const aiData = await aiRes.json();
          const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
          if (toolCall) {
            const parsed = JSON.parse(toolCall.function.arguments);
            result.insights = parsed.insights || [];
          }
        }
      } catch (e) {
        console.warn('[enrich-company] AI insights failed:', e);
      }
    }

    console.log('[enrich-company] Done. Domain:', result.domain, 'Roles:', result.openRoles.length, 'Insights:', result.insights.length);

    return new Response(JSON.stringify({ success: true, company: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[enrich-company] Error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function formatFunding(amount: number): string {
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B€`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(0)}M€`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K€`;
  return `${amount}€`;
}
